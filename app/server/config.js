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
export function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { anthropicApiKey: '', githubToken: '' };
  const values = parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return {
    anthropicApiKey: values.ANTHROPIC_API_KEY ?? '',
    githubToken: values.GITHUB_TOKEN ?? '',
  };
}

export function writeConfig({ anthropicApiKey, githubToken }) {
  const current = readConfig();
  const next = {
    anthropicApiKey: anthropicApiKey || current.anthropicApiKey,
    githubToken: githubToken || current.githubToken,
  };
  const contents = `ANTHROPIC_API_KEY=${next.anthropicApiKey}\nGITHUB_TOKEN=${next.githubToken}\n`;
  fs.writeFileSync(CONFIG_PATH, contents, { encoding: 'utf8', mode: 0o600 });
  return { hasAnthropicApiKey: Boolean(next.anthropicApiKey), hasGithubToken: Boolean(next.githubToken) };
}

export function hasConfig() {
  const { anthropicApiKey, githubToken } = readConfig();
  return { hasAnthropicApiKey: Boolean(anthropicApiKey), hasGithubToken: Boolean(githubToken) };
}
