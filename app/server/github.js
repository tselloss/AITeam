import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function parseOwnerRepo(repoUrl) {
  const match = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/.exec(repoUrl.trim());
  if (!match) throw new Error(`could not parse a GitHub owner/repo from: ${repoUrl}`);
  return { owner: match[1], repo: match[2] };
}

function authenticatedUrl(owner, repo, token) {
  return `https://${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`;
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

function setupClone({ token, repoUrl, branch, workspaceDir }) {
  const { owner, repo } = parseOwnerRepo(repoUrl);
  fs.mkdirSync(path.dirname(workspaceDir), { recursive: true });
  const cloneArgs = ['clone', ...(branch ? ['--branch', branch] : []), authenticatedUrl(owner, repo, token), workspaceDir];
  git(cloneArgs, path.dirname(workspaceDir));
  const checkedOutBranch = git(['branch', '--show-current'], workspaceDir) || branch || 'main';
  return { owner, repo, branch: checkedOutBranch, htmlUrl: `https://github.com/${owner}/${repo}` };
}

function setupNewRepo({ token, owner, repo, workspaceDir }) {
  fs.mkdirSync(workspaceDir, { recursive: true });
  git(['init'], workspaceDir);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], workspaceDir);
  git(['remote', 'add', 'origin', authenticatedUrl(owner, repo, token)], workspaceDir);
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
    return setupNewRepo({ token, owner: created.owner, repo: created.repo, workspaceDir });
  }
  throw new Error(`unknown target mode: ${target.mode}`);
}

export function commitAndPush({ workspaceDir, branch, message }) {
  git(['add', '-A'], workspaceDir);
  const status = git(['status', '--porcelain'], workspaceDir);
  if (!status) return { pushed: false, reason: 'nothing to commit' };
  git(['-c', 'user.email=aiteam@localhost', '-c', 'user.name=AITeam', 'commit', '-m', message], workspaceDir);
  git(['push', '-u', 'origin', branch], workspaceDir);
  return { pushed: true };
}
