# AITeam Collaboration Protocol

This is the canonical description of how AITeam roles hand off work to one another.
Every agent definition in `.claude/agents/` points here; read it before delegating or
accepting a handoff you don't recognize.

## Roster

- `ceo` — top-level orchestrator: intake, routing, arbitration
- `cto` — technical strategy and architecture decisions (ADRs)
- `cpo` — product vision and roadmap prioritization
- `cfo` — cost/budget review gate
- `business-analyst` — requirements elicitation for complex initiatives (business rules, stakeholder needs, current-vs-future-state)
- `product-owner` — backlog: epics, stories, acceptance criteria
- `dev-lead` — engineering task breakdown, fan-out, code review
- `dev` — implementation
- `qa-engineer` — verification against acceptance criteria
- `devops-engineer` — CI/CD, build, release
- `security-engineer` — security review and release gate
- `designer` — UX/UI specs and design tokens
- `support-engineer` — inbound issue triage
- `tech-writer` — user-facing docs, changelog
- `docs-engineer` — developer-facing docs: architecture reference, CONTRIBUTING, load-bearing code comments

## Pipelines

### Feature pipeline

human/`ceo` → `cpo` (initiative brief) → `business-analyst` (requirements, complex initiatives only —
`cpo` may route straight to `product-owner` for narrowly-scoped asks) → `product-owner` (stories +
acceptance criteria) → `designer` (specs, UI stories only) → `dev-lead` (task breakdown) → `dev` ×N
(implement) → `qa-engineer` (verify) → `dev-lead` (review verdict) → `devops-engineer` (release)
→ `tech-writer` (user-facing docs + changelog), and → `docs-engineer` when the change was
architecturally significant (new module, changed integration, new public interface).

### Support pipeline

inbound issue → `support-engineer` (triage) →
defect: `dev-lead` | feature request: `product-owner` | doc gap: `tech-writer` | security smell: `ceo` → `security-engineer`.

### Fix loop

`qa-engineer` or `security-engineer` finding → `dev-lead` → `dev` fixes → the *same*
reviewer re-verifies. The original finder always re-verifies; nothing is closed by its
own author.

## Triage rubric

Every triage/routing/priority decision — `support-engineer` classifying an issue,
`security-engineer` rating a finding, `qa-engineer` rating a defect it finds,
`product-owner` setting backlog priority, `dev-lead` ordering fan-out, `ceo`
arbitrating or escalating — uses this shared area + severity rubric instead of a
per-role scale invented on the spot.

### Work areas

`frontend` (UI/client code) · `backend` (server/API/business logic) ·
`infra-ci` (build, CI/CD, release, hosting) · `security` (auth, crypto, secrets,
dependency/input-handling risk) · `data` (data models, storage, migrations) ·
`docs` (documentation, changelog) · `product-ux` (roadmap/priority/UX decisions).
Pick the single area that best fits; when a change spans areas, tag the
highest-risk one (e.g. an auth change touching the UI is `security`, not `frontend`).

### Severity scale

- `critical` — production down, data loss, an actively exploitable security hole,
  or a legal/compliance breach. Blocks release. Loops in `ceo` immediately — see
  Autonomous execution below.
- `high` — major functionality broken for many users, or a high-severity security
  finding. Blocks release; follows the existing security/QA gates.
- `medium` — partial impairment with a workaround, or a moderate defect. Normal
  queue priority.
- `low` — cosmetic, rare edge case, or a minor doc gap. Lowest queue priority.

This is the same scale `security-engineer` and `qa-engineer` rate findings/defects on;
`support-engineer` assigns it on every triage, and `product-owner` uses it as backlog
priority — one scale, four consumers, no incompatible variants.

### Routing + urgency

- **Area** picks the lane: `frontend`/`backend`/`data` route through `dev-lead` to
  `dev`; `infra-ci` routes to `devops-engineer`; `security` always includes the
  existing `security-engineer` gate no matter who else touches the change; `docs`
  routes to `tech-writer`; `product-ux` routes to `product-owner`/`cpo`.
- **Severity** picks the urgency: `critical` always loops `ceo` in immediately,
  regardless of area or who's already handling it — this extends the stop-conditions
  list in Autonomous execution, it is not a second escalation channel. `high` follows
  the existing security/QA release gates without requiring a human pause by itself.
  `medium`/`low` move through the normal queue.

## Authority rules

- `cto` ADRs in `docs/decisions/` are binding on `dev-lead` and `dev`. Disagreement
  escalates to `ceo`, who may request a new ADR but never silently overrides one.
- `cpo` owns priority; `product-owner` owns story content. Neither may alter the
  other's artifact.
- **CFO gate**: any choice introducing paid services, infrastructure spend, or
  model-tier cost goes to `cfo` before adoption.
- **Security gate**: `dev-lead` routes auth/crypto/dependency/input-handling changes
  to `security-engineer` before approving that story; critical/high findings block
  release. Independent of what was flagged during development, `security-engineer`
  also performs a mandatory audit before `devops-engineer` cuts any release — a
  release with nothing flagged is not exempt.
- **QA gate**: no story is done until `qa-engineer` passes every acceptance criterion.

## Definition of done

**A project** (routed through `ceo`) is done when every accepted roadmap item has
reached story-level done, been released by `devops-engineer`, and had its docs and
changelog updated by `tech-writer`. `ceo` is the sole judge of project-level done and
records it as a closing decision memo in `docs/decisions/`.

**A story** (routed through `dev-lead`) is done when: implementation is complete,
`qa-engineer` has passed every acceptance criterion, `security-engineer` has cleared
any flagged change, and the change is merged. `dev-lead` is the sole judge of
story-level done.

## Autonomous execution

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

## Mechanics

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
- These directories are created on demand by the role that owns them; they do not
  exist until first used.
