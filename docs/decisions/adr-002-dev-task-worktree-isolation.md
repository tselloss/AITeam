# ADR 002: Isolate `dev` implementation tasks in a git worktree; do not confuse this with parallel fan-out

- Status: Accepted (binding on `dev-lead` and `dev` until superseded)
- Date: 2026-07-30
- Owner: `cto`
- Area: backend (orchestration) / infra-ci (branching model)
- Extends (does not supersede): `adr-001-synchronous-recursive-delegation.md`

## Context

Under the current model, when `dev-lead` delegates an implementation task to `dev` via
the `Agent` tool, `dev` cuts a feature branch and works in the shared primary checkout
(§ Version control). Two problems follow from doing branch work in the primary checkout:

- A human or another process inspecting the primary working tree mid-task is disrupted
  by `dev`'s in-flight branch switch and uncommitted edits.
- An abandoned or failed task can leave partial edits behind in the main checkout.

The `Agent` tool already supports an `isolation: "worktree"` parameter (used elsewhere in
this repo): passing it runs the delegated invocation's branch work in a separate git
worktree instead of switching branches in the primary checkout.

This is **not** a concurrency question. ADR-001 makes delegation strictly sequential —
`dev-lead` never has two `dev` `Agent` calls in flight at once — so there are, by
construction, no concurrent-worker merge conflicts to solve here. The value is purely the
two working-tree-hygiene problems above, for a single active task.

ADR-001's Consequences section lists "per-worker isolation (git worktrees or separate
clones)" as the **first** of four preconditions that would have to be cleared before the
deferred bounded parallel fan-out could ever be revisited (the others being single-active-
role UI rework, unverified SDK same-turn fan-out semantics, and a CFO cost review of
concurrent model-turn burn). Adopting worktree isolation now for the sequential case
touches that first precondition, which is exactly why this needs a binding record rather
than a bare protocol line: readers must not misread "we now use worktrees" as "parallel
fan-out is unblocked." That precise misreading — a prompt promising a concurrency
capability the runtime never implemented — is the documented root cause of the seven-
recurrence `dev-lead` fan-out fault (`2026-07-23-dev-lead-delegation-fault-root-cause-and-fix.md`).

## Decision

1. **`dev-lead` passes `isolation: "worktree"` on every `Agent` delegation to `dev` for an
   implementation task.** `dev`'s branch work happens in a separate git worktree, keeping
   the primary checkout stable for anyone inspecting it and preventing abandoned/failed
   tasks from leaving partial edits in the main checkout.

2. **The § Version control branch/commit/push/merge mechanics are unchanged.** `dev` still
   cuts `feature/<slug>` from `main`, commits on it, and pushes the branch to `origin`
   before handing back; `dev-lead` still opens and merges the PR. Because the branch
   reaches `origin` before handoff, `dev-lead`'s merge reads the branch from the remote and
   is unaffected by which working tree `dev` used — worktree isolation is transparent to
   the merge flow.

3. **This does not enable, adopt, or partially adopt parallel fan-out.** Delegation stays
   strictly sequential, one `dev` at a time, per ADR-001. Establishing the worktree-per-
   task mechanism for the sequential case does prove the primitive the deferred parallel
   fan-out would eventually reuse, but it does **not** lift ADR-001's deferral: the UI-
   rework, SDK-fan-out-semantics, and CFO-cost preconditions remain unmet, and parallel
   fan-out stays deferred behind them. Any future move to concurrency is a separate
   decision that must clear those remaining gates.

4. **Scope is `dev` implementation tasks only.** Verification roles (`qa-engineer`,
   `security-engineer`) are out of scope here; they verify against the pushed branch and do
   not need task-local worktree isolation. `ceo` is unaffected — it does not delegate to
   `dev` (that stays inside `dev-lead`'s fan-out).

## Alternatives considered and rejected

- **No isolation (status quo: `dev` works in the primary checkout).** Rejected. Leaves the
  two hygiene problems unsolved for zero saving — the isolation parameter already exists
  and costs nothing to pass.
- **Separate full clones per task instead of worktrees.** Rejected. Heavier (duplicates the
  whole object store), slower to set up, and unnecessary: a worktree already gives an
  isolated working tree while sharing the repo's object store and refs, which is exactly
  what a same-repo feature-branch task needs.
- **Apply `isolation: "worktree"` to all delegated roles, not just `dev`.** Rejected as
  out of scope. QA/security verify the pushed branch and gain nothing from a private
  working tree; broadening the rule adds surface without value. Revisit only if a
  verification role is later shown to mutate the working tree.
- **A bare line in § Version control, no ADR.** Rejected. It would touch the branching
  model ADR-001 governs without recording the "this is not parallel fan-out" boundary —
  the very ambiguity that produced the 7-recurrence fault. The boundary must be binding.

## Consequences

- The primary checkout stays clean and inspectable throughout a `dev` task; abandoned or
  failed tasks leave the main checkout untouched.
- One extra binding instruction on `dev-lead` (pass the parameter); no change to `dev`'s or
  any other role's commit/push/merge behavior.
- Leftover worktrees from abandoned tasks are a benign hygiene item, not a blocker; they
  can be reclaimed with `git worktree prune`/`git worktree remove` during read-only
  investigation if they accumulate. This is the good failure mode — the debris lives in a
  side worktree, not the primary checkout.
- The first of ADR-001's four parallel-fan-out preconditions now has its mechanism proven
  in the sequential case; the other three remain, so ADR-001's deferral stands unchanged.

## Cost / CFO gate

Not cost-significant; **binding immediately, not provisional.** Worktree isolation is a
local git feature and the `isolation` parameter already exists; it adds no paid service, no
infrastructure spend, and no model-tier cost. Critically, because the model stays strictly
sequential (one `dev` at a time), it introduces **none** of the concurrent model-turn burn
that ADR-001 flagged as the cost trigger for parallel fan-out. There is therefore no CFO
gate on this ADR — the § CFO gate remains attached only to the still-deferred parallel
fan-out, exactly as ADR-001 left it.
