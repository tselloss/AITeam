import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAgentFiles } from '../app/server/agents.js';
import { toPluginText } from '../scripts/build-plugin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const agentsSourceDir = path.join(repoRoot, '.claude', 'agents');
const commandsSourceDir = path.join(repoRoot, '.claude', 'commands');
const pluginManifestPath = path.join(repoRoot, '.claude-plugin', 'plugin.json');
const marketplaceManifestPath = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
const askCommandSourcePath = path.join(commandsSourceDir, 'ask.md');

describe('plugin manifests', () => {
  test('.claude-plugin/plugin.json exists with required fields', () => {
    const manifest = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf8'));
    assert.match(manifest.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(manifest.description && manifest.description.length > 0);
    assert.ok(manifest.version && manifest.version.length > 0);
  });

  test('.claude-plugin/marketplace.json exists and lists the plugin, self-referencing', () => {
    const manifest = JSON.parse(fs.readFileSync(marketplaceManifestPath, 'utf8'));
    const pluginManifest = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf8'));
    assert.ok(Array.isArray(manifest.plugins) && manifest.plugins.length > 0);
    const entry = manifest.plugins.find((p) => p.name === pluginManifest.name);
    assert.ok(entry, `marketplace.json does not list the plugin named "${pluginManifest.name}"`);
    assert.equal(entry.source, './', 'plugin entry must self-reference the repo root with source "./"');
  });

  test('ceo.md description is written to trigger proactively', () => {
    const content = fs.readFileSync(path.join(agentsSourceDir, 'ceo.md'), 'utf8');
    const descriptionLine = content.split(/\r?\n/).find((l) => l.startsWith('description: '));
    assert.match(descriptionLine, /PROACTIVELY/, 'ceo.md description must instruct proactive/automatic use, so Claude Code auto-routes new asks to it');
  });

  test('.claude/commands/ask.md is a deterministic fallback trigger for the ceo intake', () => {
    assert.ok(fs.existsSync(askCommandSourcePath), '.claude/commands/ask.md is missing');
    const content = fs.readFileSync(askCommandSourcePath, 'utf8');
    assert.match(content, /^---\r?\n/, '.claude/commands/ask.md must start with a frontmatter block');
    assert.match(content, /description:\s*.+/, '.claude/commands/ask.md frontmatter must have a description');
    assert.match(content, /\$ARGUMENTS/, ".claude/commands/ask.md must forward the user's request via $ARGUMENTS");
    assert.match(content, /\bceo\b/, '.claude/commands/ask.md must invoke the ceo role');
  });
});

// Both agents/ and commands/ are generated plugin-scoped mirrors of their
// .claude/ source of truth (see scripts/build-plugin.mjs); this asserts
// neither can silently drift out of sync with what's actually authored.
function describePluginSync(label, sourceSubdir, pluginSubdir) {
  const sourceDir = path.join(repoRoot, '.claude', sourceSubdir);
  const pluginDir = path.join(repoRoot, pluginSubdir);

  describe(`plugin ${pluginSubdir}/ stays in sync with .claude/${sourceSubdir}/`, () => {
    const sourceFiles = fs.existsSync(sourceDir) ? listAgentFiles(sourceDir) : [];
    const pluginFiles = fs.existsSync(pluginDir) ? listAgentFiles(pluginDir) : [];

    test(`${pluginSubdir}/ has exactly one generated copy per ${label} in .claude/${sourceSubdir}/`, () => {
      assert.deepEqual(pluginFiles, sourceFiles);
    });

    for (const file of sourceFiles) {
      test(`${pluginSubdir}/${file} matches "npm run build:plugin" output for .claude/${sourceSubdir}/${file}`, () => {
        const expected = toPluginText(path.join(sourceDir, file));
        const actual = fs.readFileSync(path.join(pluginDir, file), 'utf8');
        assert.equal(actual, expected, `${pluginSubdir}/${file} is stale — run "npm run build:plugin"`);
      });
    }
  });
}

describePluginSync('role', 'agents', 'agents');
describePluginSync('command', 'commands', 'commands');
