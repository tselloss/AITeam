<!-- Generated from docs/team-protocol.md by scripts/split-protocol.mjs. Edit the source, then run: npm run build:protocol -->
# Autonomous execution

`ceo` and `dev-lead` are expected to drive work to completion themselves, not to do
one handoff and stop. When a `HANDOFF` block names a role you hold the `Agent` tool
for, invoke it immediately and keep going — through the entire remaining pipeline if
nothing blocks you — rather than pausing to report progress and waiting for a human
to say "continue."

**Stop and report to the human instead of continuing when:**

- Any `HANDOFF` is tagged `Severity: critical` (see § Triage rubric), from any role
  and any area — surface it to `ceo` immediately. This is a loop-in, not necessarily a
  full stop: once `ceo` has seen it, the pipeline may keep moving, but it may never
  proceed unacknowledged.
- A `cfo` memo is `reject` or `approve-with-changes`, the requester disputes it, and
  `ceo` cannot resolve the dispute from information already available.
- `security-engineer` reports an unresolved critical/high finding after a remediation
  attempt has already been tried once and failed.
- The original project brief is ambiguous or missing information no agent in the
  roster can reasonably infer (e.g. target users, budget ceiling, legal constraints).
- A fix loop (`qa-engineer`/`security-engineer` finding → `dev` fix → re-verify) has
  run 3 times on the same story without passing — escalate to `ceo` as a blocked story
  rather than cycling a 4th time.

Everything else — ordinary handoffs, routine approvals, sequential pipeline steps —
proceeds without waiting for human confirmation. The local web app under `app/`
additionally pauses execution on a `critical`-severity handoff until a human
acknowledges it — see `app/server/orchestrator.js`.

### Context-compaction recovery

`ceo` and `dev-lead` drive long sequential `Agent` delegation chains, and a long chain is exactly where an agent's own context may be compacted or summarized mid-run. A compacted summary is not guaranteed to preserve the specifics of this protocol. If either role notices its own context has been compacted or summarized during a run — or is otherwise unsure it still holds the exact rules — it must re-ground itself by re-reading this file before issuing the next delegation, rather than trusting the summary. Re-verify in particular: the `HANDOFF` block format (§ Mechanics), the authority rules — ADR bindingness and the CFO/security/QA gates (§ Authority rules), the stop-and-report conditions (§ Autonomous execution), and the version-control mechanics (§ Version control). Re-grounding is cheap; drifting from a coordination rule mid-chain is not.
