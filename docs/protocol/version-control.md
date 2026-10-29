<!-- Generated from docs/team-protocol.md by scripts/split-protocol.mjs. Edit the source, then run: npm run build:protocol -->
# Version control

- Every engineering task runs on its own feature branch cut from `main` (e.g.
  `feature/<short-slug>`), never directly on `main`.
- When `dev-lead` delegates an implementation task to `dev` via the `Agent` tool, it
  passes `isolation: "worktree"` so `dev`'s in-progress branch work happens in a
  separate git worktree instead of switching branches in the primary checkout. This
  keeps the primary working tree stable for anyone (human or process) inspecting it
  mid-task and ensures an abandoned or failed task leaves no partial edits in the main
  checkout. The branch/commit/push and PR-merge mechanics in this section are
  unchanged: `dev` still commits on its feature branch and pushes it to `origin`
  before handing back, and `dev-lead` still opens and merges the PR from the pushed
  branch — because the branch reaches `origin`, the merge is unaffected by which
  working tree `dev` used. This does not enable parallel fan-out (still one `dev` at a
  time per ADR-001); it isolates only the single active task's working tree. Binding
  per `docs/decisions/adr-002-dev-task-worktree-isolation.md`.
- `dev` commits its work on that branch as the task completes and pushes the branch
  to `origin` before handing back to `dev-lead` — a task isn't done until its commits
  exist on the remote, not just locally.
- Once `dev-lead` code-reviews a task as merge-ready and any required gates
  (`qa-engineer`, `security-engineer`, `cfo`) have cleared, `dev-lead` opens a pull
  request for the branch (`gh pr create`) and merges it — via `gh pr merge` if the
  `gh` CLI is available, otherwise a local `git merge` into `main` followed by
  `git push` to `origin/main` — before starting or approving the next task. If `gh`
  is unavailable and a PR genuinely needs human review before merge, `dev-lead` pushes
  the branch, includes a ready-to-use PR title/description in its `HANDOFF`, and
  waits rather than merging unreviewed.
- This applies at both grains named in Autonomous execution: a finished `dev` task
  gets its branch pushed immediately, and a finished story/feature gets merged and
  pushed to `main` before the pipeline moves on to the next story — never batch
  multiple stories' commits before pushing.
- "Safe implementations" is not a separate step here — it's the existing bar every
  role already writes to (see guardrails on paid-dependency/ADR/scope limits, plus
  the Security gate above): code isn't merge-ready, and therefore isn't push-ready,
  until failing tests and unresolved `qa-engineer`/`security-engineer` findings are
  resolved.
