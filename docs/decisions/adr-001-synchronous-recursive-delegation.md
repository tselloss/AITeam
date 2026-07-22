# ADR 001: Keep synchronous recursive delegation; decline the worker-pool proposal as an error fix

- Status: Accepted (binding on `dev-lead` and `dev` until superseded)
- Date: 2026-07-22
- Owner: `cto`
- Area: backend (orchestration)

## Context

An operator observed a stack trace when `dev-lead` delegates to `dev` in the `app/`
local runner and proposed: "Create a multiple agent pool — whoever is available starts
running the task — no more errors." The stated theory is that a concurrent worker pool
of `dev` instances would eliminate the delegation error.

Current architecture (`app/server/orchestrator.js`) is fully synchronous and recursive:

- `ceo`/`dev-lead` are the only roles granted the `Agent` tool, surfaced to the SDK as
  a per-invocation `delegate` MCP tool (`mcp__aiteam__delegate`).
- The tool handler calls `await runRole(subagent_type, prompt)` and returns the nested
  role's final text (orchestrator.js:167-175). The delegating role's own `query()` is
  suspended awaiting that single tool result.
- The MCP server is built **fresh per invocation** (orchestrator.js:159-176) precisely
  because the SDK enforces one live transport per MCP-server instance — connecting the
  same instance twice throws "Already connected to a transport."
- Retryable assistant errors (`rate_limit`, `overloaded`, `server_error`, `unknown`,
  plus subscription usage-window exhaustion) are resumed via session-resume with
  backoff and never fail the run. Non-retryable errors (`authentication_failed`,
  `oauth_org_not_allowed`, `invalid_request`, `model_not_found`, `billing_error`) throw
  `RunAbortedError` and kill the run by design (orchestrator.js:54-65, 252-260).
- Safety caps: `MAX_ROLE_INVOCATIONS_PER_RUN = 40`, `MAX_TURNS_PER_ROLE = 40` for leaf roles.
  Updated 2026-07-22: `ceo`/`dev-lead` (the only roles holding `Agent`) get
  `MAX_TURNS_FOR_DELEGATING_ROLE = 150` instead — a minimal 2-story `dev-lead` fan-out
  exhausted the flat 40-turn cap without completing, because reviewing and
  merging each delegated task (Bash/Read/Grep review, `gh pr create`/merge/push)
  costs real turns on top of the delegate() calls themselves. See
  `app/workspaces/*/docs/decisions/2026-07-20-phase-10-*-tooling.md` for the
  reproduction history.

## Decision

1. **The operator's causal theory is unsound — a worker pool would not eliminate the
   observed error.** The error class described (a stack trace on `dev-lead → dev`
   delegation) is either a deterministic non-retryable condition
   (`invalid_request`/prompt-construction bug, `model_not_found`, an unknown/misspelled
   `subagent_type` hitting the `unknown role` throw at orchestrator.js:139-141) or a
   transport/setup fault. None of these are contention or availability problems.
   Concurrency changes *which worker* runs a task and *when* — it does not change
   *whether* a deterministic call succeeds. Every worker in a pool would hit the
   identical error. This is a misdiagnosis: the fix is to capture the trace and correct
   the underlying deterministic fault, not to add parallelism.

2. **Synchronous recursive delegation remains the binding delegation model** for the
   `app/` runner. It is the correct shape for the pipeline, which is overwhelmingly a
   chain of data-dependent steps (cpo → product-owner → dev-lead → dev → qa → ...) that
   cannot parallelize regardless of worker count.

3. **Broad concurrent/worker-pool delegation is declined.** Beyond being the wrong fix,
   it collides with hard constraints of the current architecture (see Consequences).

4. **Bounded parallel fan-out** (one `dev-lead` dispatching *independent* `dev` tasks
   concurrently) is the *only* place concurrency is even conceptually useful. It is
   **deferred, not adopted**, and gated behind explicit preconditions below. It is a
   throughput/latency optimization with real cost, not an error remedy — and must not
   be justified as one.

## Alternatives considered and rejected

- **Global worker pool where "whoever is available" picks up any task (as proposed).**
  Rejected. Sequential pipeline stages are data-dependent and cannot be parallelized;
  a pool buys nothing for them. It does not address the reported error. It multiplies
  every failure mode below without a corresponding benefit.

- **Speculative / redundant execution (run the same task on multiple workers, take the
  first success).** Rejected. The failing errors are deterministic, so redundancy just
  reproduces the same failure N times while multiplying subscription usage. It also
  breaks the git-per-task model (multiple workers mutating one working tree).

- **Parallel fan-out of independent `dev` tasks from `dev-lead`, adopted now.**
  Rejected *now*, deferred behind preconditions. It is feasible in principle but blocked
  by workspace isolation, UI, and cost issues that are not yet solved (see below).

## Consequences

Keeping the status quo: no new cost, no new failure modes, and the actual bug still
needs the trace to fix. The synchronous model stays easy to reason about — one active
role, one ordered event stream, one working tree.

If bounded parallel fan-out is ever revisited, these are the blockers that must be
cleared first, and they define why it is not free:

- **Shared git working tree.** All roles share a single `workspaceDir`
  (orchestrator.js:185). The § Version control protocol puts every `dev` task on its own
  feature branch in that one working tree. Concurrent `dev`s doing `git checkout`/commit
  in the same working directory would corrupt each other. Parallel fan-out **requires**
  per-worker isolation (git worktrees or separate clones) before it is even safe.
- **Single-active-role UI/event stream.** `onEvent` emits an ordered
  `role_start … text … role_end` narrative consumed as one linear timeline
  (index.js:188). The approval layer keys by `approvalId` in a Map so it *can* hold
  several pending approvals, but interleaved concurrent role streams and interleaved
  Write/Edit/Bash approval prompts would need deliberate UI rework.
- **The one-transport-per-MCP-instance constraint is satisfiable but subtle.** Each
  `runRole` already builds its own `aiteamServer`, so N concurrent nested `runRole`
  calls each get an independent instance — no shared-transport clash at that layer. The
  hazard is any future refactor that hoists the server to run scope.
- **Suspended-query fan-out semantics.** `dev-lead` would have to emit N `delegate`
  tool_use blocks whose handler promises run concurrently; whether the SDK dispatches
  same-turn tool calls concurrently or serially is an SDK behavior we would have to
  verify, not assume.
- **Cost.** Concurrent opus/sonnet turns burn subscription usage in parallel and reach
  the 5-hour/7-day usage windows and API capacity limits faster, converting the
  currently-graceful serial backoff into simultaneous stalls. This makes parallel
  fan-out a **cost-significant infrastructure change**: adopting it triggers the § CFO
  gate as a hard precondition, not an afterthought.

**Provisional status note:** the *binding decision here* (keep the synchronous model;
decline/defer the pool) introduces **no** new cost, so it is not itself gated on `cfo`.
The deferred parallel-fan-out option is what would carry cost — hence it stays deferred
behind the CFO gate rather than being pre-approved by this ADR.

## Follow-up required

The real defect is unaddressed until the trace is captured. Next step is to reproduce
the `dev-lead → dev` delegation and capture the actual stack trace / SDK error subtype,
then fix the deterministic fault (most likely `invalid_request` prompt construction or a
bad `subagent_type`). That is an engineering diagnosis task, not an architecture change.
