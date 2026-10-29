// docs/protocol/*.md are generated from docs/team-protocol.md so roles can read
// only the sections they need. These tests fail closed if the copies drift or a
// role points at a section that doesn't exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitProtocol, SOURCE, OUT_DIR } from '../scripts/split-protocol.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, OUT_DIR);

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []);
}

test('docs/protocol/ matches a fresh split of docs/team-protocol.md (run npm run build:protocol)', () => {
  const expected = splitProtocol(fs.readFileSync(path.join(repoRoot, SOURCE), 'utf8'));
  const actual = fs.readdirSync(outDir).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(actual, Object.keys(expected).sort());
  for (const [name, content] of Object.entries(expected)) {
    assert.equal(fs.readFileSync(path.join(outDir, name), 'utf8'), content, `${OUT_DIR}/${name} is stale`);
  }
});

test('every docs/protocol/ section a role names exists, and section-reading roles include mechanics', () => {
  for (const file of walk(path.join(repoRoot, '.claude', 'agents'))) {
    const text = fs.readFileSync(file, 'utf8');
    const refs = [...text.matchAll(/docs\/protocol\/([a-z0-9-]+\.md)/g)].map((m) => m[1]);
    for (const ref of refs) assert.ok(fs.existsSync(path.join(outDir, ref)), `${path.basename(file)} names missing ${OUT_DIR}/${ref}`);
    if (refs.length > 0) assert.ok(refs.includes('mechanics.md'), `${path.basename(file)} reads protocol sections but not mechanics.md`);
  }
});
