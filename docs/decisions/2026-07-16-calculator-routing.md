# Decision Memo: Routing "simple Calculator" request

- Date: 2026-07-16
- Author: CEO
- Status: Accepted
- Type: Routing / process-scope decision

## Context

Inbound request via the `/ask` intake path: "Generate me a simple Calculator."
Target: a new, self-contained standalone project at
`C:\Users\karac\source\repos\Calculator` (outside the AITeam repo). No further
spec was given; the human explicitly granted discretion on how much process a
"simple calculator" warrants and stated it does not need the full CPO
roadmap / product-owner backlog ceremony.

## Decision

Route as a **lightweight engineering pipeline**, not the full feature pipeline:

1. `dev-lead` — task breakdown + implementation (fans out to `dev`, verifies via
   `qa-engineer`). Owns story-level done.
2. `devops-engineer` — initialize the standalone repo and confirm the build/run
   path once QA clears (release step).
3. `tech-writer` — README + changelog for the new project.
4. CEO — record project-level Definition of Done.

### Scope of the calculator (inferred from an ambiguous-but-simple brief)

- Four basic operations: add, subtract, multiply, divide.
- Divide-by-zero handled gracefully (not a crash).
- Clean, minimal UI or CLI — stack choice delegated to `dev-lead`'s judgment for
  a small standalone demo.
- Small and complete over elaborate. Includes automated tests.

## Gates deliberately skipped and why

- **CPO / product-owner ceremony** — human explicitly waived it; overkill for a
  demo this small.
- **CFO gate** — no paid services, infra spend, or model-tier cost introduced.
- **Security gate** — no auth, crypto, secrets, or external/network input
  handling. Arithmetic input validation (e.g. divide-by-zero) is a correctness
  concern handled by QA, not a `security` area change. If `dev-lead` introduces
  third-party dependencies, that reopens the security gate.
- **CTO ADR** — stack selection for a trivial standalone calculator is delegated
  to `dev-lead`; no binding architecture constraint is needed.
- **Designer** — minimal surface; `dev-lead` may request a spec if it judges one
  necessary.

## Triage tags

- Area: `frontend` (or `backend`/CLI depending on `dev-lead`'s stack choice)
- Severity: `low` (demo, no production impact or urgency)

## Definition of Done for this project

Calculator implemented at `C:\Users\karac\source\repos\Calculator` with the four
operations working and tested, QA-passed, repo initialized and runnable
(devops), and README + changelog written (tech-writer). CEO records closing memo.
