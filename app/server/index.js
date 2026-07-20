import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readConfig, writeConfig, hasConfig } from './config.js';
import { runProject, RunAbortedError } from './orchestrator.js';
import { prepareWorkspace, commitAndPush, listUserRepos, listBranches } from './github.js';
import { listProjects, getProject, createProject, setProjectRepo, recordRunStart, recordRunFinish } from './projects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
const workspacesRoot = path.join(appRoot, 'workspaces');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(appRoot, 'public')));

/** @type {Map<string, {projectId: string, events: object[], listeners: Set<import('express').Response>, pendingApprovals: Map<string, (decision: {approved: boolean, reason?: string}) => void>, done: boolean}>} */
const runs = new Map();

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
    res.status(502).json({ error: error.message });
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
    res.status(502).json({ error: error.message });
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
  const run = { projectId: project.id, events: [], listeners: new Set(), pendingApprovals: new Map(), done: false };
  runs.set(runId, run);
  recordRunStart(project.id, { runId, brief, autonomous: Boolean(autonomous) });
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
      });

      const pushResult = commitAndPush({
        workspaceDir,
        branch: repo.branch,
        message: `AITeam: ${brief.slice(0, 72)}`,
      });
      emit(run, { type: 'finished', repo, push: pushResult, summary: result.text });
      recordRunFinish(project.id, runId, { status: 'finished', summary: result.text });
    } catch (error) {
      const aborted = error instanceof RunAbortedError;
      emit(run, { type: 'error', aborted, message: error.message });
      recordRunFinish(project.id, runId, { status: aborted ? 'aborted' : 'error', error: error.message });
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

app.post('/api/runs/:id/approve', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();
  const { approvalId, approved, reason } = req.body ?? {};
  const resolve = run.pendingApprovals.get(approvalId);
  if (!resolve) return res.status(404).json({ error: 'no pending approval with that id' });
  run.pendingApprovals.delete(approvalId);
  resolve({ approved: Boolean(approved), reason });
  emit(run, { type: 'approval_resolved', approvalId, approved: Boolean(approved), reason });
  res.status(204).end();
});

const port = process.env.PORT || 8877;
const server = app.listen(port, () => {
  console.log(`AITeam runner listening on http://localhost:${port}`);
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use by another process. Set PORT=<other-port> and try again.`);
    process.exit(1);
  }
  throw error;
});
