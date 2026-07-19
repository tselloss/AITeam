import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveInWorkspace, SandboxViolationError } from '../app/server/tool-runtime.js';

let workspace;

before(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aiteam-workspace-'));
});

after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('resolveInWorkspace allows a plain relative path inside the workspace', () => {
  const resolved = resolveInWorkspace(workspace, 'notes.md');
  assert.equal(resolved, path.join(workspace, 'notes.md'));
});

test('resolveInWorkspace rejects ../ traversal', () => {
  assert.throws(() => resolveInWorkspace(workspace, '../outside.txt'), SandboxViolationError);
});

test('resolveInWorkspace rejects an absolute path outside the workspace', () => {
  const elsewhere = path.join(os.tmpdir(), 'definitely-not-the-workspace.txt');
  assert.throws(() => resolveInWorkspace(workspace, elsewhere), SandboxViolationError);
});

test('resolveInWorkspace rejects escaping via a symlinked directory', (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aiteam-outside-'));
  const linkPath = path.join(workspace, 'escape-link');
  try {
    fs.symlinkSync(outside, linkPath, 'dir');
  } catch (error) {
    t.skip(`cannot create symlinks in this environment: ${error.message}`);
    return;
  }
  assert.throws(() => resolveInWorkspace(workspace, 'escape-link/file.txt'), SandboxViolationError);
});
