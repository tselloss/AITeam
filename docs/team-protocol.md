# AITeam Collaboration Protocol

This is the canonical description of how AITeam roles hand off work to one another.
Every agent definition in `.claude/agents/` points here; read it before delegating or
accepting a handoff you don't recognize.

## Roster

- `ceo` — top-level orchestrator: intake, routing, arbitration
- `cto` — technical strategy and architecture decisions (ADRs)
- `cpo` — product vision and roadmap prioritization
- `cfo` — cost/budget review gate
- `product-owner` — backlog: epics, stories, acceptance criteria
- `dev-lead` — engineering task breakdown, fan-out, code review
- `dev` — implementation
- `qa-engineer` — verification against acceptance criteria
- `devops-engineer` — CI/CD, build, release
- `security-engineer` — security review and release gate
- `designer` — UX/UI specs and design tokens
- `support-engineer` — inbound issue triage
- `tech-writer` — docs, changelog

## Pipelines

### Feature pipeline

human/`ceo` → `cpo` (initiative brief) → `product-owner` (stories + acceptance criteria)
→ `designer` (specs, UI stories only) → `dev-lead` (task breakdown) → `dev` ×N (implement)
→ `qa-engineer` (verify) → `dev-lead` (review verdict) → `devops-engineer` (release)
→ `tech-writer` (docs + changelog).

### Support pipeline

inbound issue → `support-engineer` (triage) →
defect: `dev-lead` | feature request: `product-owner` | doc gap: `tech-writer` | security smell: `ceo` → `security-engineer`.

### Fix loop

`qa-engineer` or `security-engineer` finding → `dev-lead` → `dev` fixes → the *same*
reviewer re-verifies. The original finder always re-verifies; nothing is closed by its
own author.

## Authority rules

- `cto` ADRs in `docs/decisions/` are binding on `dev-lead` and `dev`. Disagreement
  escalates to `ceo`, who may request a new ADR but never silently overrides one.
- `cpo` owns priority; `product-owner` owns story content. Neither may alter the
  other's artifact.
- **CFO gate**: any choice introducing paid services, infrastructure spend, or
  model-tier cost goes to `cfo` before adoption.
- **Security gate**: `dev-lead` routes auth/crypto/dependency/input-handling changes
  to `security-engineer` before approval; critical/high findings block release.
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
proceeds without waiting for human confirmation.

## Mechanics

- Every agent reply ends with a `HANDOFF` block:
  `HANDOFF → <agent-name>: <what they must do> | Inputs: <files/context>`
- Only `ceo` and `dev-lead` hold the `Agent` tool and actually execute handoffs by
  invoking the named agent. Every other role's handoff is a recommendation that
  returns to its caller for execution.
- Shared artifacts are the interface between roles, not conversational memory:
  - `docs/decisions/` — CEO decision memos and CTO ADRs
  - `docs/product/roadmap.md` — CPO roadmap
  - `docs/backlog/` — Product Owner epics/stories
  - `docs/design/` — Designer specs and tokens
- These directories are created on demand by the role that owns them; they do not
  exist until first used.
