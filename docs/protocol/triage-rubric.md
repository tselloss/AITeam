<!-- Generated from docs/team-protocol.md by scripts/split-protocol.mjs. Edit the source, then run: npm run build:protocol -->
# Triage rubric

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
