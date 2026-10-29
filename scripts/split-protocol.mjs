// Generates docs/protocol/<section>.md from docs/team-protocol.md, the single
// source of truth. Roles read only the sections they need instead of the whole
// protocol on every invocation, which cuts the tokens each delegation spends
// re-reading it. Edit docs/team-protocol.md, then run `npm run build:protocol`.
// tests/protocol-split.test.mjs fails if the generated files drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = 'docs/team-protocol.md';
export const OUT_DIR = 'docs/protocol';
// "## Pipelines" is split one level deeper: each role follows one or two pipelines.
const SPLIT_DEEPER = new Set(['Pipelines']);

export function slug(title) {
  return title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function splitProtocol(text) {
  const lines = text.split('\n');
  const sections = []; // { title, slug, body[] }
  let current = null;
  let parentIntro = null; // text between "## Pipelines" and its first "###"
  let deeper = false;
  const start = (title) => { current = { title, slug: slug(title), body: [] }; sections.push(current); };

  for (const line of lines) {
    const h2 = line.match(/^## (.+?)\s*$/);
    const h3 = line.match(/^### (.+?)\s*$/);
    if (h2) {
      deeper = SPLIT_DEEPER.has(h2[1]);
      if (deeper) { parentIntro = []; current = null; } else { parentIntro = null; start(h2[1]); }
      continue;
    }
    if (h3 && deeper) {
      start(h3[1]);
      if (parentIntro && parentIntro.join('').trim()) current.body.push(...parentIntro, '');
      continue;
    }
    if (current) current.body.push(line);
    else if (parentIntro) parentIntro.push(line);
  }

  const files = {};
  for (const s of sections) {
    const body = s.body.join('\n').replace(/^\n+|\n+$/g, '');
    files[`${s.slug}.md`] =
      `<!-- Generated from ${SOURCE} by scripts/split-protocol.mjs. Edit the source, then run: npm run build:protocol -->\n` +
      `# ${s.title}\n\n${body}\n`;
  }
  return files;
}

export function buildProtocol(repoRoot) {
  const text = fs.readFileSync(path.join(repoRoot, SOURCE), 'utf8');
  const files = splitProtocol(text);
  const outDir = path.join(repoRoot, OUT_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (f.endsWith('.md') && !(f in files)) fs.unlinkSync(path.join(outDir, f));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), content);
  return Object.keys(files);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const names = buildProtocol(repoRoot);
  console.log(`Wrote ${names.length} protocol section file(s) to ${OUT_DIR}/: ${names.join(', ')}`);
}
