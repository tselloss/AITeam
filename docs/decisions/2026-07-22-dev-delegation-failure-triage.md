# Triage: "dev can't work" delegation failure + worker-pool proposal

- Date: 2026-07-22
- Author: ceo
- Type: triage / routing disposition (not an arbitration — no inter-role conflict)
- Area: backend · Severity: high (dev-lead cannot delegate to dev; core pipeline step blocked)

## Context

Operator reported, against the `app/` local runner (localhost:8877, Claude Agent
SDK orchestration), that `dev-lead` fails to delegate to `dev` (a stack trace was
observed). No stack trace was captured — the report is a recollection. Operator
proposed a "multiple agent pool / whoever is available runs the task" fix on the
theory it would eliminate the errors.

## Decision

1. **Worker-pool proposal is declined as a misdiagnosis.** Per CTO assessment and
   ADR-001 (`docs/decisions/adr-001-synchronous-recursive-delegation.md`), the
   reported failure is a deterministic fault (bad role name, malformed request, or
   missing/malformed agent file), not a contention/availability problem.
   Concurrency cannot fix a deterministic throw — a hard non-retryable error
   throws `RunAbortedError` regardless of how many workers exist. The synchronous
   recursive delegation model stands.
2. **The bug needs its actual stack trace before any fix is designed.**
   support-engineer enumerated six candidate failure modes in
   `app/server/orchestrator.js`, none confirmable from code alone. Routed to
   `dev-lead` to reproduce and capture the real trace.
3. Ruled out by CEO spot-check: the "missing/malformed `dev.md`" candidate —
   `.claude/agents/dev.md` exists, is clean UTF-8 (no BOM), and `node --test`
   passes 177/177 (structural validation of every agent file).

## Future work (not authorized now)

Bounded parallel `dev` fan-out, if ever revisited, is gated behind the blockers
CTO flagged (shared git worktree, single-active-role event stream) and a CFO cost
review. Not in scope for this bug.

## Owner of next step

`dev-lead` — reproduce and capture the stack trace, then scope the fix.
