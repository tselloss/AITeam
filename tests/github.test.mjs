import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOwnerRepo, redactCredentials, authHeaderArg } from '../app/server/github.js';

test('parses a plain https clone URL', () => {
  assert.deepEqual(parseOwnerRepo('https://github.com/tselloss/AITeam'), {
    owner: 'tselloss',
    repo: 'AITeam',
    branch: undefined,
  });
});

test('parses a repo name containing a dot (not just a trailing .git)', () => {
  assert.deepEqual(parseOwnerRepo('https://github.com/tselloss/CargoCustoms.ai'), {
    owner: 'tselloss',
    repo: 'CargoCustoms.ai',
    branch: undefined,
  });
});

test('strips a trailing .git and/or slash', () => {
  assert.equal(parseOwnerRepo('https://github.com/foo/bar.git').repo, 'bar');
  assert.equal(parseOwnerRepo('https://github.com/foo/bar.git/').repo, 'bar');
  assert.equal(parseOwnerRepo('https://github.com/foo/bar/').repo, 'bar');
});

test('parses the SSH remote form', () => {
  assert.deepEqual(parseOwnerRepo('git@github.com:owner/repo.git'), {
    owner: 'owner',
    repo: 'repo',
    branch: undefined,
  });
});

test('extracts a branch from a /tree/<branch> browser URL', () => {
  assert.deepEqual(parseOwnerRepo('https://github.com/tselloss/CargoCustoms.ai/tree/DEV'), {
    owner: 'tselloss',
    repo: 'CargoCustoms.ai',
    branch: 'DEV',
  });
});

test('keeps slashes inside a branch name from /tree/<branch>', () => {
  assert.equal(parseOwnerRepo('https://github.com/owner/repo/tree/feature/nested-branch').branch, 'feature/nested-branch');
});

test('throws with the offending URL when it cannot parse', () => {
  assert.throws(() => parseOwnerRepo('not a url'), /could not parse a GitHub owner\/repo from: not a url/);
});

test('redactCredentials strips an embedded token from a command-echo message', () => {
  const message =
    "Command failed: git clone https://x-access-token:not-a-real-token@github.com/tselloss/CargoCustoms.ai.git /workspace\nremote: Write access to repository not granted.";
  const redacted = redactCredentials(message);
  assert.ok(!redacted.includes('not-a-real-token'), 'token must not survive redaction');
  assert.ok(redacted.includes('https://github.com/tselloss/CargoCustoms.ai.git'), 'the URL shape should stay readable');
});

test('redactCredentials strips a credential git itself echoes into a fatal: line', () => {
  const message = "fatal: Authentication failed for 'https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/owner/repo.git/'";
  const redacted = redactCredentials(message);
  assert.equal(redacted, "fatal: Authentication failed for 'https://github.com/owner/repo.git/'");
});

test('redactCredentials leaves credential-free text untouched', () => {
  const message = 'fatal: repository not found';
  assert.equal(redactCredentials(message), message);
});

test('authHeaderArg carries the token only inside the base64 payload, never in the clear', () => {
  const token = 'github_pat_super-secret-value';
  const arg = authHeaderArg(token);
  assert.ok(arg.startsWith('http.extraHeader=Authorization: Basic '));
  assert.ok(!arg.includes(token), 'the raw token must not appear unencoded in the config override');
  const encoded = arg.split('Basic ')[1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), `${token}:x-oauth-basic`);
});
