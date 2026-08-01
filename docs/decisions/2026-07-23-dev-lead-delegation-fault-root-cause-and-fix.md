# Decision: dev-lead fan-out fault (7 recurrences) — root cause found, fixed

- Status: Resolved
- Date: 2026-07-23
- Owner: `cto` / repo maintainer
- Extends: `adr-001-synchronous-recursive-delegation.md`,
  `2026-07-22-dev-delegation-failure-triage.md`, and the chain of blocked-build memos
  it references (2026-07-20 phase-10, 2026-07-22 i11/i12, 2026-07-22 ADR-002 hardening,
  2026-07-23 roadmap audit) — same root cause across all seven, now closed.

## Root cause

`.claude/agents/dev-lead.md` instructed `dev-lead` to delegate to `dev` "via the `Agent`
tool — in parallel where tasks are independent." ADR-001 (accepted, binding) commits the
`app/` runner to a synchronous recursive delegation model: one live MCP transport per role
invocation, one in-flight `delegate` call at a time. The prompt promised a concurrency
capability the runtime never implemented — bounded parallel fan-out is explicitly
*deferred* in ADR-001, gated behind git-worktree isolation, UI rework, and a CFO cost
review that never happened.

When `dev-lead` acted on its own prompt and issued concurrent `Agent`/`delegate` tool
calls for independent tasks, the shared single-transport session broke — surfacing as
either 40-turn-cap exhaustion (retries after a failed concurrent attempt eating the
budget) or an outright mid-response connection error, depending on timing. Both are the
same underlying fault: a prompt/runtime capability mismatch, not an infra flakiness issue
and not something the earlier `MAX_TURNS_FOR_DELEGATING_ROLE=150` raise (2026-07-22) could
fix, since it didn't address the concurrent-call attempt itself.

## Fix

Corrected `.claude/agents/dev-lead.md` to match the binding ADR-001 model: delegate to
`dev` one task at a time, explicitly never issuing two `Agent` calls in the same turn, and
cited ADR-001 inline as the reason. Fan-out ordering (severity/risk-first, per the shared
triage rubric) is unchanged — only the false claim of concurrency is removed. Regenerated
the plugin copy (`npm run build:plugin`) and confirmed `node --test` (177/177) still
passes.

This restores dev-lead's designed delegation path with the review-and-merge gate intact —
the preferred option from the recurring escalation memos, over the direct-dev/qa-engineer
bypass exception.

## Follow-up

None required to unblock. Real bounded parallel fan-out remains deferred per ADR-001's
existing preconditions (worktree isolation, UI rework, CFO gate) if ever revisited later —
this fix does not adopt it.
