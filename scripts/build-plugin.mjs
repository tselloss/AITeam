// Regenerates the plugin-facing copies of agents/ and commands/ from their
// single sources of truth in .claude/agents/ and .claude/commands/. The only
// difference between each source file and its plugin copy is how it locates
// docs/team-protocol.md: project-level files read it relative to the project
// they're working in, while the plugin copies resolve it via
// ${CLAUDE_PLUGIN_ROOT} so the reference still works when this repo is
// installed as a plugin into someone else's project. Run after editing any
// file in .claude/agents/ or .claude/commands/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgentFile, listAgentFiles } from '../app/server/agents.js';

export const PROTOCOL_PATH = 'docs/team-protocol.md';
export const PLUGIN_PROTOCOL_PATH = '${CLAUDE_PLUGIN_ROOT}/docs/team-protocol.md';

export function toPluginText(sourcePath) {
  parseAgentFile(sourcePath); // validates frontmatter/BOM before we trust the raw text
  const raw = fs.readFileSync(sourcePath, 'utf8');
  return raw.split(PROTOCOL_PATH).join(PLUGIN_PROTOCOL_PATH);
}

// Back-compat name used by tests/plugin.test.mjs's per-agent-file assertions.
export const toPluginAgentText = toPluginText;

function buildPluginDir(repoRoot, sourceSubdir, targetSubdir) {
  const sourceDir = path.join(repoRoot, '.claude', sourceSubdir);
  const targetDir = path.join(repoRoot, targetSubdir);
  fs.mkdirSync(targetDir, { recursive: true });

  const sourceFiles = fs.existsSync(sourceDir) ? listAgentFiles(sourceDir) : [];
  for (const file of sourceFiles) {
    const text = toPluginText(path.join(sourceDir, file));
    fs.writeFileSync(path.join(targetDir, file), text);
  }

  const stale = fs
    .readdirSync(targetDir)
    .filter((f) => f.endsWith('.md') && !sourceFiles.includes(f));
  for (const file of stale) {
    fs.unlinkSync(path.join(targetDir, file));
  }

  return { written: sourceFiles, removed: stale };
}

export function buildPlugin(repoRoot) {
  const agents = buildPluginDir(repoRoot, 'agents', 'agents');
  const commands = buildPluginDir(repoRoot, 'commands', 'commands');
  return { agents, commands };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { agents, commands } = buildPlugin(repoRoot);
  console.log(`Wrote ${agents.written.length} plugin agent file(s) to agents/`);
  if (agents.removed.length > 0) {
    console.log(`Removed ${agents.removed.length} stale plugin agent file(s): ${agents.removed.join(', ')}`);
  }
  console.log(`Wrote ${commands.written.length} plugin command file(s) to commands/`);
  if (commands.removed.length > 0) {
    console.log(`Removed ${commands.removed.length} stale plugin command file(s): ${commands.removed.join(', ')}`);
  }
}
