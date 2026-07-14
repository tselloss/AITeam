import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveInWorkspace,
  readFile,
  writeFile,
  editFile,
  glob,
  grep,
  bash,
  SandboxViolationError,
} from '../app/server/tool-runtime.js';

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

test('writeFile then readFile round-trips content, creating parent directories', () => {
  writeFile(workspace, { file_path: 'nested/dir/hello.txt', content: 'hello world' });
  assert.equal(readFile(workspace, { file_path: 'nested/dir/hello.txt' }), 'hello world');
});

test('editFile replaces a unique match', () => {
  writeFile(workspace, { file_path: 'edit-me.txt', content: 'foo bar foo' });
  editFile(workspace, { file_path: 'edit-me.txt', old_string: 'bar', new_string: 'baz' });
  assert.equal(readFile(workspace, { file_path: 'edit-me.txt' }), 'foo baz foo');
});

test('editFile refuses an ambiguous match without replace_all', () => {
  writeFile(workspace, { file_path: 'ambiguous.txt', content: 'foo foo' });
  assert.throws(() => editFile(workspace, { file_path: 'ambiguous.txt', old_string: 'foo', new_string: 'bar' }));
});

test('editFile replaces every match with replace_all', () => {
  writeFile(workspace, { file_path: 'all.txt', content: 'foo foo foo' });
  editFile(workspace, { file_path: 'all.txt', old_string: 'foo', new_string: 'bar', replace_all: true });
  assert.equal(readFile(workspace, { file_path: 'all.txt' }), 'bar bar bar');
});

test('editFile throws when old_string is not present', () => {
  writeFile(workspace, { file_path: 'missing.txt', content: 'hello' });
  assert.throws(() => editFile(workspace, { file_path: 'missing.txt', old_string: 'nope', new_string: 'x' }));
});

test('glob finds files by pattern, including across directories with **', () => {
  writeFile(workspace, { file_path: 'src/a.js', content: '' });
  writeFile(workspace, { file_path: 'src/deep/b.js', content: '' });
  writeFile(workspace, { file_path: 'readme.md', content: '' });
  const matches = glob(workspace, { pattern: '**/*.js' }).split('\n');
  assert.ok(matches.includes('src/a.js'));
  assert.ok(matches.includes('src/deep/b.js'));
  assert.ok(!matches.includes('readme.md'));
});

test('grep finds matching lines with file:line prefixes', () => {
  writeFile(workspace, { file_path: 'grep-me.txt', content: 'line one\nTARGET here\nline three' });
  const result = grep(workspace, { pattern: 'TARGET' });
  assert.match(result, /grep-me\.txt:2:TARGET here/);
});

test('bash runs a command in the workspace directory and returns stdout', () => {
  writeFile(workspace, { file_path: 'marker.txt', content: 'present' });
  const listing = bash(workspace, { command: process.platform === 'win32' ? 'dir /b' : 'ls' });
  assert.match(listing, /marker\.txt/);
});

test('bash throws with output on a failing command', () => {
  const failingCommand = process.platform === 'win32' ? 'exit 1' : 'exit 1';
  assert.throws(() => bash(workspace, { command: failingCommand }), /command failed/);
});
