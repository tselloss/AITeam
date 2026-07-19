import fs from 'node:fs';
import path from 'node:path';

export class SandboxViolationError extends Error {}

// Resolves a model-supplied path against the run's workspace directory and
// refuses anything that would land outside it — lexical `..` traversal, an
// absolute path elsewhere on disk, or a symlink whose real target escapes.
// Used by orchestrator.js's canUseTool permission gate before allowing any
// Agent-SDK built-in tool call that carries a path (Read/Write/Edit/Grep/Glob).
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
