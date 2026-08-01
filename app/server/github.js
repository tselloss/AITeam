import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// Strips embedded credentials from any https://<token>@host URL — git
// itself echoes the authenticated remote URL back into some of its own
// fatal: messages (e.g. on an auth failure), so this has to run on stderr
// too, not just on how we invoke the command.
export function redactCredentials(text) {
  return text.replace(/https:\/\/[^@/\s]+@/g, 'https://');
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    // Prefer the child's own stderr over error.message: message includes
    // the full invoked command line (args and all), which is exactly where
    // a token passed via authHeaderArg(...) would otherwise leak into logs
    // and the run UI.
    const detail = (error.stderr || error.message || '').toString().trim();
    throw new Error(redactCredentials(detail));
  }
}

// Accepts anything a user would plausibly paste: a bare clone URL
// (https://github.com/owner/repo[.git], with or without a trailing slash),
// an SSH remote (git@github.com:owner/repo.git), or a browser URL copied
// while looking at a specific branch (.../owner/repo/tree/<branch>, the
// shape GitHub's own UI puts in the address bar) — the last of which also
// yields a branch to check out after cloning.
export function parseOwnerRepo(repoUrl) {
  const afterHost = /github\.com[/:](.+)$/.exec(repoUrl.trim());
  if (!afterHost) throw new Error(`could not parse a GitHub owner/repo from: ${repoUrl}`);
  const segments = afterHost[1].replace(/\/+$/, '').split('/');
  const [owner, repoRaw, refType, ...refRest] = segments;
  if (!owner || !repoRaw) throw new Error(`could not parse a GitHub owner/repo from: ${repoUrl}`);
  const repo = repoRaw.replace(/\.git$/, '');
  const branch = (refType === 'tree' || refType === 'blob') && refRest.length > 0 ? refRest.join('/') : undefined;
  return { owner, repo, branch };
}

function remoteUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}.git`;
}

// A `-c` override that authenticates a single git invocation without ever
// putting the token in a URL — which git would otherwise persist verbatim
// into that repo's .git/config (on disk, indefinitely) the moment it's used
// in a clone/remote-add. Pass this only to the specific git() calls that
// talk to the remote (clone, push); the config override lives only for that
// one process, never written to disk.
export function authHeaderArg(token) {
  const basic = Buffer.from(`${token}:x-oauth-basic`).toString('base64');
  return `http.extraHeader=Authorization: Basic ${basic}`;
}

// Lists repos the token's owner can push to (own + collaborator + org),
// newest-activity first, so the UI can offer a picker instead of a URL field.
// Capped at 3 pages (300 repos) — plenty for an interactive dropdown.
export async function listUserRepos({ token }) {
  const repos = [];
  for (let page = 1; page <= 3; page += 1) {
    const response = await fetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub repo listing failed (${response.status}): ${await response.text()}`);
    }
    const data = await response.json();
    for (const repo of data) {
      repos.push({ fullName: repo.full_name, htmlUrl: repo.html_url, private: repo.private, defaultBranch: repo.default_branch });
    }
    if (data.length < 100) break;
  }
  return repos;
}

// Lists branches for one repo, newest-commit-activity order isn't available
// from this endpoint so we just pass GitHub's default (alphabetical) through.
export async function listBranches({ token, owner, repo }) {
  const branches = [];
  for (let page = 1; page <= 3; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub branch listing failed (${response.status}): ${await response.text()}`);
    }
    const data = await response.json();
    for (const branch of data) branches.push(branch.name);
    if (data.length < 100) break;
  }
  return branches;
}

async function createRepo({ token, name, isPrivate }) {
  const response = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, private: Boolean(isPrivate), auto_init: false }),
  });
  if (!response.ok) {
    throw new Error(`GitHub repo creation failed (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  return { owner: data.owner.login, repo: data.name, htmlUrl: data.html_url };
}

// `branch` (explicit — e.g. from the UI's branch dropdown) wins over any
// branch parsed out of a pasted /tree/<branch> URL; either way we clone
// first (fetches every remote-tracking branch) and check out the requested
// one after, rather than a --branch clone, so both sources share one path.
function setupClone({ token, repoUrl, branch, workspaceDir }) {
  const { owner, repo, branch: urlBranch } = parseOwnerRepo(repoUrl);
  const requestedBranch = branch || urlBranch;
  fs.mkdirSync(path.dirname(workspaceDir), { recursive: true });
  git(['-c', authHeaderArg(token), 'clone', remoteUrl(owner, repo), workspaceDir], path.dirname(workspaceDir));
  if (requestedBranch) git(['checkout', requestedBranch], workspaceDir);
  // The workspace can hold proprietary source before it's ever pushed —
  // block other local accounts from traversing into it at all.
  fs.chmodSync(workspaceDir, 0o700);
  const checkedOutBranch = git(['branch', '--show-current'], workspaceDir) || requestedBranch || 'main';
  return { owner, repo, branch: checkedOutBranch, htmlUrl: `https://github.com/${owner}/${repo}` };
}

function setupNewRepo({ owner, repo, workspaceDir }) {
  fs.mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
  git(['init'], workspaceDir);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], workspaceDir);
  git(['remote', 'add', 'origin', remoteUrl(owner, repo)], workspaceDir);
  return { owner, repo, branch: 'main', htmlUrl: `https://github.com/${owner}/${repo}` };
}

// Dispatches to an existing repo (cloned in) or a brand-new one (created via
// the GitHub API, then git-initialized locally) — either way `workspaceDir`
// ends up as a real, remote-tracked git checkout the pipeline can commit to.
export async function prepareWorkspace({ token, target, workspaceDir }) {
  if (target.mode === 'clone') {
    return setupClone({ token, repoUrl: target.repoUrl, branch: target.branch, workspaceDir });
  }
  if (target.mode === 'create') {
    const created = await createRepo({ token, name: target.name, isPrivate: target.isPrivate });
    return setupNewRepo({ owner: created.owner, repo: created.repo, workspaceDir });
  }
  throw new Error(`unknown target mode: ${target.mode}`);
}

export function commitAndPush({ workspaceDir, branch, message, token }) {
  git(['add', '-A'], workspaceDir);
  const status = git(['status', '--porcelain'], workspaceDir);
  if (!status) return { pushed: false, reason: 'nothing to commit' };
  git(['-c', 'user.email=aiteam@localhost', '-c', 'user.name=AITeam', 'commit', '-m', message], workspaceDir);
  git(['-c', authHeaderArg(token), 'push', '-u', 'origin', branch], workspaceDir);
  return { pushed: true };
}
