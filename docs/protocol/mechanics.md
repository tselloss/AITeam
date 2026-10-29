<!-- Generated from docs/team-protocol.md by scripts/split-protocol.mjs. Edit the source, then run: npm run build:protocol -->
# Mechanics

- Every agent reply ends with a `HANDOFF` block:
  `HANDOFF → <agent-name>: <what they must do> | Area: <work area> | Severity: <level> | Inputs: <files/context>`
  — except when a role's output is a genuine dead end with no further owner (e.g.
  `tech-writer` with nothing left to route, `cfo` returning a memo to whoever asked
  rather than escalating a dispute), in which case the reply omits the block entirely
  rather than inventing a placeholder target. `Area` and `Severity` are optional — omit
  either when a role isn't triaging against the rubric (e.g. `dev` finishing an
  implementation task) — but when present, use the exact tokens from § Triage rubric so
  routing stays machine-parseable. Canonical field order is Area, then Severity, then
  Inputs; the parser accepts any order, but keep the canonical order when writing one
  for readability.
- Only `ceo` and `dev-lead` hold the `Agent` tool and actually execute handoffs by
  invoking the named agent. Every other role's handoff is a recommendation that
  returns to its caller for execution.
- A role without the `Agent` tool (`cto`, `cpo`, and every other non-`ceo`/`dev-lead`
  role) cannot consult another role synchronously mid-turn. When its guardrails say to
  "consult" or "route before finalizing," that means: produce the artifact, end the
  reply with a `HANDOFF` to the reviewing role, and treat the artifact as provisional
  until the caller (`ceo` or `dev-lead`) invokes that review and a clear result comes
  back. A reject or approve-with-changes sends the caller back to re-invoke the
  original role with revisions — it never gets silently treated as final in the
  meantime.
- Shared artifacts are the interface between roles, not conversational memory:
  - `docs/decisions/` — CEO decision memos and CTO ADRs
  - `docs/product/roadmap.md` — CPO roadmap
  - `docs/backlog/` — Product Owner epics/stories
  - `docs/design/` — Designer specs and tokens
  - `docs/requirements/` — Business Analyst requirements docs
  - `docs/architecture/` and `CONTRIBUTING.md` — Documentation Engineer's architecture
    reference and contributor guide
  - `docs/sales/` — Sales Engineer scoping memos
  - `docs/customers/` — Customer Success account summaries
  - `docs/intelligence/` — Data Analyst findings memos
- These directories are created on demand by the role that owns them; they do not
  exist until first used.
