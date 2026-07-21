import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readConfig, writeConfig, hasConfig } from './config.js';
import { runProject, RunAbortedError } from './orchestrator.js';
import { prepareWorkspace, commitAndPush, listUserRepos, listBranches, redactCredentials } from './github.js';
import { listProjects, getProject, createProject, setProjectRepo, recordRunStart, recordRunFinish } from './projects.js';
import { startBuildRun } from './build-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
const workspacesRoot = path.join(appRoot, 'workspaces');

const port = process.env.PORT || 8877;
const selfOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);

const app = express();
app.use(express.json({ limit: '2mb' }));
// Content-Type sniffing alone isn't a real CSRF defense (it doesn't stop a
// bare script/curl, only browser cross-origin fetches) — reject any request
// carrying an Origin header that isn't this server itself. Requests with no
// Origin (curl, same-tab navigation) are left alone.
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && !selfOrigins.has(origin)) {
    return res.status(403).json({ error: 'cross-origin requests are not allowed' });
  }
  next();
});
app.use(express.static(path.join(appRoot, 'public')));

/** @type {Map<string, {projectId: string, events: object[], listeners: Set<import('express').Response>, pendingApprovals: Map<string, (decision: {approved: boolean, reason?: string}) => void>, done: boolean, abortController: AbortController}>} */
const runs = new Map();

// "Build & Run" previews (build-runner.js) — separate from `runs` above,
// keyed by the same runId, but polled rather than streamed over SSE (see
// GET /api/runs/:id/build) since they're commonly started well after that
// run's own event stream has already closed.
/** @type {Map<string, import('./build-runner.js').BuildRun>} */
const buildRuns = new Map();
// A live dev server/static server holds a port open — don't leave one
// orphaned just because the parent process exited.
process.on('exit', () => {
  for (const buildRun of buildRuns.values()) buildRun.stop();
});

function emit(run, event) {
  run.events.push(event);
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of run.listeners) res.write(line);
}

function finish(run) {
  run.done = true;
  for (const res of run.listeners) res.end();
  run.listeners.clear();
}

function slugify(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'project';
}

// The runId still active for a project, if any — computed from the
// in-memory `runs` Map rather than stored, since "active" is inherently
// ephemeral (lost on restart) unlike the persisted project/run history.
function activeRunIdFor(projectId) {
  for (const [runId, run] of runs) {
    if (run.projectId === projectId && !run.done) return runId;
  }
  return null;
}

// Default mode pauses for a UI click on Write/Edit/Bash and on any
// critical-severity handoff (see docs/team-protocol.md § Autonomous
// execution). Autonomous mode skips every pause so a run can be left
// unattended end to end — including critical-severity items, which is a
// deliberate tradeoff the run creator opts into per run, not a default.
function makeRequestApproval(run, autonomous) {
  if (!autonomous) {
    return (role, toolName, input) =>
      new Promise((resolve) => {
        const approvalId = randomUUID();
        run.pendingApprovals.set(approvalId, resolve);
        emit(run, { type: 'approval_requested', approvalId, role, toolName, input });
      });
  }
  return async (role, toolName, input) => {
    emit(run, { type: 'auto_approved', role, toolName, input });
    return { approved: true, reason: 'autonomous mode' };
  };
}

app.get('/api/config', (_req, res) => {
  res.json(hasConfig());
});

app.post('/api/config', (req, res) => {
  const { githubToken } = req.body ?? {};
  res.json(writeConfig({ githubToken }));
});

app.get('/api/github/repos', async (_req, res) => {
  const { githubToken } = readConfig();
  if (!githubToken) {
    return res.status(400).json({ error: 'save your GitHub token in Settings first' });
  }
  try {
    res.json(await listUserRepos({ token: githubToken }));
  } catch (error) {
    res.status(502).json({ error: redactCredentials(error.message) });
  }
});

app.get('/api/github/repos/:owner/:repo/branches', async (req, res) => {
  const { githubToken } = readConfig();
  if (!githubToken) {
    return res.status(400).json({ error: 'save your GitHub token in Settings first' });
  }
  try {
    res.json(await listBranches({ token: githubToken, owner: req.params.owner, repo: req.params.repo }));
  } catch (error) {
    res.status(502).json({ error: redactCredentials(error.message) });
  }
});

app.get('/api/projects', (_req, res) => {
  const projects = listProjects().map((project) => ({ ...project, activeRunId: activeRunIdFor(project.id) }));
  res.json(projects);
});

// Starts a run. Either `target` (new project — a fresh clone/create) or
// `projectId` (continue an existing project against its already-known
// repo, no need to re-enter a URL) must be given, not both.
app.post('/api/runs', async (req, res) => {
  const { brief, target, projectId, autonomous } = req.body ?? {};
  if (!brief || typeof brief !== 'string') {
    return res.status(400).json({ error: 'brief is required' });
  }

  let project;
  if (projectId) {
    project = getProject(projectId);
    if (!project) return res.status(404).json({ error: `no project with id ${projectId}` });
    if (activeRunIdFor(projectId)) {
      return res.status(409).json({ error: 'this project already has a run in progress' });
    }
  } else {
    if (!target || (target.mode !== 'clone' && target.mode !== 'create')) {
      return res.status(400).json({ error: 'target.mode must be "clone" or "create" (or pass projectId to continue an existing project)' });
    }
    const name = target.mode === 'clone' ? target.repoUrl : target.name;
    project = createProject({ name, target, repo: null });
  }

  const { githubToken } = readConfig();
  if (!githubToken) {
    return res.status(400).json({ error: 'save your GitHub token in Settings first' });
  }

  const runId = randomUUID();
  const workspaceDir = path.join(workspacesRoot, `${slugify(brief)}-${Date.now()}`);
  const run = {
    projectId: project.id,
    events: [],
    listeners: new Set(),
    pendingApprovals: new Map(),
    done: false,
    abortController: new AbortController(),
  };
  runs.set(runId, run);
  recordRunStart(project.id, { runId, brief, autonomous: Boolean(autonomous), workspaceDir });
  res.status(202).json({ runId, projectId: project.id });

  (async () => {
    try {
      emit(run, { type: 'workspace_preparing', target: project.target });
      const repo = await prepareWorkspace({ token: githubToken, target: project.target, workspaceDir });
      setProjectRepo(project.id, repo);
      emit(run, { type: 'workspace_ready', repo });

      const requestApproval = makeRequestApproval(run, Boolean(autonomous));

      const result = await runProject({
        workspaceDir,
        brief,
        onEvent: (event) => emit(run, event),
        requestApproval,
        abortController: run.abortController,
      });

      const pushResult = commitAndPush({
        workspaceDir,
        branch: repo.branch,
        message: `AITeam: ${brief.slice(0, 72)}`,
        token: githubToken,
      });
      emit(run, { type: 'finished', repo, push: pushResult, summary: result.text });
      recordRunFinish(project.id, runId, { status: 'finished', summary: result.text });
    } catch (error) {
      const aborted = error instanceof RunAbortedError;
      const message = redactCredentials(error.message);
      emit(run, { type: 'error', aborted, message });
      recordRunFinish(project.id, runId, { status: aborted ? 'aborted' : 'error', error: message });
    } finally {
      finish(run);
    }
  })();
});

app.get('/api/runs/:id/events', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  for (const event of run.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  if (run.done) {
    res.end();
    return;
  }
  run.listeners.add(res);
  req.on('close', () => run.listeners.delete(res));
});

// Shared by the single-approval endpoint below and the stop endpoint, which
// must resolve every approval still pending on a run (not just one) so an
// awaited canUseTool call doesn't hang forever after abortController.abort().
function resolvePendingApproval(run, approvalId, decision) {
  const resolve = run.pendingApprovals.get(approvalId);
  if (!resolve) return false;
  run.pendingApprovals.delete(approvalId);
  resolve(decision);
  emit(run, { type: 'approval_resolved', approvalId, approved: decision.approved, reason: decision.reason });
  return true;
}

app.post('/api/runs/:id/approve', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();
  const { approvalId, approved, reason } = req.body ?? {};
  if (!resolvePendingApproval(run, approvalId, { approved: Boolean(approved), reason })) {
    return res.status(404).json({ error: 'no pending approval with that id' });
  }
  res.status(204).end();
});

// Lets the run creator bail out early — e.g. after realizing the first
// prompt was wrong — instead of waiting for the pipeline to run its course.
// Aborts the shared AbortController (orchestrator.js checks it before every
// role and threads it into every query() call) and unblocks any approval
// the run is currently paused on, which would otherwise hang forever.
app.post('/api/runs/:id/stop', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();
  if (run.done) return res.status(409).json({ error: 'this run has already finished' });
  run.abortController.abort();
  for (const approvalId of [...run.pendingApprovals.keys()]) {
    resolvePendingApproval(run, approvalId, { approved: false, reason: 'run stopped by user' });
  }
  emit(run, { type: 'stop_requested' });
  res.status(202).json({ stopping: true });
});

// Looks a run's workspaceDir up from the persisted project record rather
// than the in-memory `runs` Map, so "Build & Run" also works for a run from
// before the last server restart (the in-memory entry doesn't survive one,
// the project.json record does).
function findRunWorkspaceDir(projectId, runId) {
  const project = getProject(projectId);
  const run = project?.runs.find((r) => r.runId === runId);
  return run?.workspaceDir ?? null;
}

// Installs and starts whatever the agents just wrote, directly against the
// run's local workspace (not the pushed repo, so it reflects on-disk state
// even after an error before any commit). Only ever starts on this explicit
// call — never automatically — since it runs the agents' own install/start
// scripts unattended.
app.post('/api/runs/:id/build', (req, res) => {
  const runId = req.params.id;
  const { projectId } = req.body ?? {};
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  const workspaceDir = findRunWorkspaceDir(projectId, runId);
  if (!workspaceDir) return res.status(404).json({ error: 'no workspace found for this run' });

  buildRuns.get(runId)?.stop();
  buildRuns.set(runId, startBuildRun(workspaceDir));
  res.status(202).json({ started: true });
});

// Polled rather than streamed (see the buildRuns comment above) — cheap
// enough for a UI checking in every second or two while it waits.
app.get('/api/runs/:id/build', (req, res) => {
  const buildRun = buildRuns.get(req.params.id);
  if (!buildRun) return res.status(404).json({ error: 'no build/run started for this run' });
  res.json({
    status: buildRun.status,
    url: buildRun.url,
    message: buildRun.message,
    log: buildRun.logLines.slice(-60),
  });
});

app.post('/api/runs/:id/build/stop', (req, res) => {
  const buildRun = buildRuns.get(req.params.id);
  if (!buildRun) return res.status(404).end();
  buildRun.stop();
  buildRuns.delete(req.params.id);
  res.status(204).end();
});

// Bind explicitly to loopback — the UI has no auth beyond same-origin
// checking, so accepting connections on other interfaces would let anyone
// on the same network reach every /api/* route, GitHub token included.
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`AITeam runner listening on http://localhost:${port}`);
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use by another process. Set PORT=<other-port> and try again.`);
    process.exit(1);
  }
  throw error;
});
