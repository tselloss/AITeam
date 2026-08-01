import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', '.env.local');

function parse(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    values[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return values;
}

// This file is gitignored (see .gitignore) and never rendered back to the
// UI — the settings form only ever writes to it, never reads a value out.
// There is no Anthropic API key here: runs authenticate via the Claude Agent
// SDK, which shells out to the same `claude` CLI session already logged in
// on this machine (subscription billing) — see orchestrator.js.
export function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { githubToken: '' };
  const values = parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return { githubToken: values.GITHUB_TOKEN ?? '' };
}

export function writeConfig({ githubToken }) {
  const current = readConfig();
  const next = { githubToken: githubToken || current.githubToken };
  const contents = `GITHUB_TOKEN=${next.githubToken}\n`;
  fs.writeFileSync(CONFIG_PATH, contents, { encoding: 'utf8', mode: 0o600 });
  return { hasGithubToken: Boolean(next.githubToken) };
}

export function hasConfig() {
  const { githubToken } = readConfig();
  return { hasGithubToken: Boolean(githubToken) };
}
