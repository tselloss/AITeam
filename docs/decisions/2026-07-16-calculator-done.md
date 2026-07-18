# Decision Memo: "simple Calculator" project — Definition of Done

- Date: 2026-07-16
- Author: CEO
- Status: Closed / Done
- Supersedes: none
- Related: `2026-07-16-calculator-routing.md`

## Outcome

The standalone "simple Calculator" project requested via `/ask` is **DONE** and
lives at `C:\Users\karac\source\repos\Calculator` (a self-contained git repo,
entirely outside and unrelated to the AITeam repo).

## What shipped

- Zero-dependency calculator. Pure ES module `src/calculator.mjs` exposing
  `add` / `subtract` / `multiply` / `divide`, with a `DivisionByZeroError`
  (message "Cannot divide by zero.") thrown on divide-by-zero instead of
  returning `Infinity`/`NaN`, plus a finite-number `TypeError` input guard.
- Single-page UI: `public/index.html`, `public/app.js` (ES module importing the
  core), `public/styles.css`.
- Test suite `test/calculator.test.mjs` — 6 tests via Node's built-in
  `node:test` (four operations, divide-by-zero, non-finite input). 6/6 passing,
  no `npm install` required (zero dependencies).
- `README.md` and `CHANGELOG.md` (Keep a Changelog, `1.0.0` initial release),
  written and verified against source.
- Git history on `master`: `38a3cc3` (code, UI, tests) then `4a1305b`
  (docs). Working tree clean.

## Definition-of-Done check (per docs/team-protocol.md)

- Story-level done: implemented; `qa-engineer` passed all 5 acceptance criteria
  with a live 6/6 test run; no security gate triggered (no auth/crypto/secrets/
  deps/network input); merged. `dev-lead` judged story done.
- Released by `devops-engineer`: repo initialized standalone and both commits
  landed; run path (`npx serve public`) and test path (`npm test`) re-verified
  from a clean checkout.
- Docs + changelog by `tech-writer`: README + CHANGELOG written, verified,
  committed.

All conditions met. CEO closes the project.

## Pipeline used (lightweight, per routing memo)

`ceo` → `dev-lead` → (`dev` implement, `qa-engineer` verify) → `devops-engineer`
(init + release) → `tech-writer` (docs) → `devops-engineer` (docs commit) →
`ceo` (this memo). CPO/product-owner ceremony, CFO gate, security gate, and CTO
ADR were deliberately skipped for a demo of this size — see routing memo.

## Gates confirmed not reopened

Zero third-party runtime or dev dependencies were introduced anywhere, so the
CFO and security gates the routing memo skipped never needed reopening. `dev-lead`
and `qa-engineer` both confirmed this.

## Note (informational, out of scope)

`dev-lead` reported that the AITeam repo (`C:\Users\karac\source\repos\AITeam`)
had a pre-existing dirty working tree (an unrelated plugin-conversion diff) that
predates this session. Every agent in this run confirmed it made no `Write`/`Edit`
changes there — all Calculator work was confined to
`C:\Users\karac\source\repos\Calculator`. Flagged for the human's awareness only;
not part of this project.
