import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export class SandboxViolationError extends Error {}

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const MAX_READ_BYTES = 1_000_000;
const MAX_OUTPUT_CHARS = 200_000;

// Resolves a model-supplied path against the run's workspace directory and
// refuses anything that would land outside it — lexical `..` traversal, an
// absolute path elsewhere on disk, or a symlink whose real target escapes.
// Every tool below routes through this before touching the filesystem.
export function resolveInWorkspace(workspaceDir, inputPath) {
  const root = path.resolve(workspaceDir);
  const candidate = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(root, inputPath);
  const lexicalRel = path.relative(root, candidate);
  if (lexicalRel !== '' && (lexicalRel.startsWith('..') || path.isAbsolute(lexicalRel))) {
    throw new SandboxViolationError(`path escapes the workspace: ${inputPath}`);
  }

  let existingAncestor = candidate;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      existingAncestor = root;
      break;
    }
    existingAncestor = parent;
  }
  const realRoot = fs.realpathSync(root);
  const realAncestor = fs.realpathSync(existingAncestor);
  const realRel = path.relative(realRoot, realAncestor);
  if (realRel !== '' && (realRel.startsWith('..') || path.isAbsolute(realRel))) {
    throw new SandboxViolationError(`path escapes the workspace via a symlink: ${inputPath}`);
  }

  return candidate;
}

export function readFile(workspaceDir, { file_path }) {
  const target = resolveInWorkspace(workspaceDir, file_path);
  const stat = fs.statSync(target);
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`${file_path} is ${stat.size} bytes, over the ${MAX_READ_BYTES}-byte read limit`);
  }
  return fs.readFileSync(target, 'utf8');
}

export function writeFile(workspaceDir, { file_path, content }) {
  const target = resolveInWorkspace(workspaceDir, file_path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return `wrote ${content.length} chars to ${file_path}`;
}

export function editFile(workspaceDir, { file_path, old_string, new_string, replace_all = false }) {
  const target = resolveInWorkspace(workspaceDir, file_path);
  const current = fs.readFileSync(target, 'utf8');
  const occurrences = current.split(old_string).length - 1;
  if (occurrences === 0) {
    throw new Error(`old_string not found in ${file_path}`);
  }
  if (occurrences > 1 && !replace_all) {
    throw new Error(`old_string occurs ${occurrences} times in ${file_path}; pass replace_all or make it unique`);
  }
  const updated = replace_all ? current.split(old_string).join(new_string) : current.replace(old_string, new_string);
  fs.writeFileSync(target, updated, 'utf8');
  return `replaced ${occurrences} occurrence(s) in ${file_path}`;
}

function walk(workspaceDir, onFile) {
  const root = path.resolve(workspaceDir);
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        onFile(full, path.relative(root, full).split(path.sep).join('/'));
      }
    }
  }
}

// Minimal glob: supports `*` (within a segment), `**` (across segments), and `?`.
function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') i++;
      re += '.*';
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function glob(workspaceDir, { pattern }) {
  const regex = globToRegExp(pattern);
  const matches = [];
  walk(workspaceDir, (_full, rel) => {
    if (regex.test(rel)) matches.push(rel);
  });
  matches.sort();
  return matches.slice(0, 500).join('\n') || '(no matches)';
}

export function grep(workspaceDir, { pattern, glob: globFilter }) {
  const regex = new RegExp(pattern);
  const filterRegex = globFilter ? globToRegExp(globFilter) : null;
  const results = [];
  walk(workspaceDir, (full, rel) => {
    if (filterRegex && !filterRegex.test(rel)) return;
    if (results.length >= 500) return;
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      return; // binary or unreadable — skip
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length && results.length < 500; i++) {
      if (regex.test(lines[i])) {
        results.push(`${rel}:${i + 1}:${lines[i]}`);
      }
    }
  });
  return results.join('\n') || '(no matches)';
}

export function bash(workspaceDir, { command }) {
  try {
    const output = execSync(command, {
      cwd: path.resolve(workspaceDir),
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 10_000_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return truncate(output);
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    throw new Error(`command failed (exit ${error.status ?? 'unknown'}): ${truncate(output || error.message)}`);
  }
}

function truncate(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n...(truncated)`;
}
