import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHandoff } from '../app/server/handoff.js';

test('parses a standard HANDOFF line with backticks and the unicode arrow', () => {
  const text = 'Some reply text.\n\nHANDOFF → `product-owner`: decompose the initiative | Inputs: docs/product/roadmap.md';
  assert.deepEqual(parseHandoff(text), {
    role: 'product-owner',
    task: 'decompose the initiative',
    area: '',
    severity: '',
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

test('parses Area and Severity tags in canonical order', () => {
  const text = 'HANDOFF → `security-engineer`: fix SQL injection in login | Area: security | Severity: critical | Inputs: src/auth/login.js';
  assert.deepEqual(parseHandoff(text), {
    role: 'security-engineer',
    task: 'fix SQL injection in login',
    area: 'security',
    severity: 'critical',
    inputs: 'src/auth/login.js',
  });
});

test('accepts Area/Severity out of canonical order and with no Inputs', () => {
  const text = 'HANDOFF -> dev-lead: patch the CI pipeline | Severity: high | Area: infra-ci';
  const parsed = parseHandoff(text);
  assert.equal(parsed.area, 'infra-ci');
  assert.equal(parsed.severity, 'high');
  assert.equal(parsed.inputs, '');
});

test('normalizes Area/Severity to lowercase regardless of tag casing', () => {
  const text = 'HANDOFF → ceo: escalate immediately | AREA: Security | SEVERITY: Critical';
  const parsed = parseHandoff(text);
  assert.equal(parsed.area, 'security');
  assert.equal(parsed.severity, 'critical');
});
