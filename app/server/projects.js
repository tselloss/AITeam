import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_PATH = path.join(__dirname, '..', 'projects.json');

// Persists the project list (target repo + run history) so it survives a
// server restart — separate from the in-memory `runs` Map in index.js,
// which only holds live SSE state for runs still streaming. Reads/writes
// are synchronous on purpose: this is a low-volume local dev tool, and
// synchronous fs calls can't interleave with each other the way concurrent
// awaited ones could, which keeps read-modify-write updates from two runs
// finishing at nearly the same time from clobbering each other.
function readAll() {
  if (!fs.existsSync(PROJECTS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(projects) {
  fs.writeFileSync(PROJECTS_PATH, JSON.stringify(projects, null, 2), 'utf8');
}

export function listProjects() {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id) {
  return readAll().find((p) => p.id === id) ?? null;
}

// Creates a project the first time a brief runs against a target repo.
// `target` is the same shape POST /api/runs already accepts
// ({mode: 'clone', repoUrl} or {mode: 'create', name, isPrivate}); `repo`
// is filled in once prepareWorkspace resolves the actual owner/repo (only
// known upfront for 'clone', only known after creation for 'create').
export function createProject({ name, target, repo }) {
  const projects = readAll();
  const now = new Date().toISOString();
  const project = { id: randomUUID(), name, target, repo: repo ?? null, createdAt: now, updatedAt: now, runs: [] };
  projects.push(project);
  writeAll(projects);
  return project;
}

export function setProjectRepo(id, repo) {
  const projects = readAll();
  const project = projects.find((p) => p.id === id);
  if (!project) return;
  project.repo = repo;
  project.updatedAt = new Date().toISOString();
  writeAll(projects);
}

export function recordRunStart(projectId, { runId, brief, autonomous }) {
  const projects = readAll();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;
  project.runs.unshift({ runId, brief, autonomous, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, summary: null, error: null });
  project.updatedAt = new Date().toISOString();
  writeAll(projects);
}

export function recordRunFinish(projectId, runId, { status, summary, error }) {
  const projects = readAll();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;
  const run = project.runs.find((r) => r.runId === runId);
  if (run) {
    run.status = status;
    run.summary = summary ?? null;
    run.error = error ?? null;
    run.finishedAt = new Date().toISOString();
  }
  project.updatedAt = new Date().toISOString();
  writeAll(projects);
}
