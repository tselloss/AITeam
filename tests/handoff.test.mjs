import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHandoff } from '../app/server/handoff.js';

test('parses a standard HANDOFF line with backticks and the unicode arrow', () => {
  const text = 'Some reply text.\n\nHANDOFF → `product-owner`: decompose the initiative | Inputs: docs/product/roadmap.md';
  assert.deepEqual(parseHandoff(text), {
    role: 'product-owner',
    task: 'decompose the initiative',
    inputs: 'docs/product/roadmap.md',
  });
});

test('accepts a plain "->" arrow and no backticks', () => {
  const text = 'HANDOFF -> dev-lead: implement the story | Inputs: docs/backlog/story-12.md';
  const parsed = parseHandoff(text);
  assert.equal(parsed.role, 'dev-lead');
  assert.equal(parsed.task, 'implement the story');
  assert.equal(parsed.inputs, 'docs/backlog/story-12.md');
});

test('handles a missing Inputs section', () => {
  const text = 'HANDOFF → ceo: escalating, story is blocked';
  const parsed = parseHandoff(text);
  assert.equal(parsed.role, 'ceo');
  assert.equal(parsed.task, 'escalating, story is blocked');
  assert.equal(parsed.inputs, '');
});

test('returns null when there is no HANDOFF block', () => {
  assert.equal(parseHandoff('Just a plain reply with no handoff.'), null);
});
