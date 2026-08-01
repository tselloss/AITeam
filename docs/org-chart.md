# AITeam Org Chart

18 roles, each a Claude Code subagent under `.claude/agents/<department>/`. A "team"
(e.g. "the dev team") is one agent definition invoked as many times as there are
parallel tasks — not one file per person. Department subfolders are purely
organizational: a role's identity comes from its frontmatter `name`, not its path, and
the generated plugin copy in `agents/` stays flat (`aiteam:<name>`) regardless of which
department folder the source lives in — see `scripts/build-plugin.mjs`.

| Department | Role | File | Model | Mandate |
|---|---|---|---|---|
| C-Level | CEO | `c-level/ceo.md` | opus | Top-level orchestrator: intake, routing, arbitration |
| Technical | CTO | `technical/cto.md` | opus | Technical strategy, architecture decisions (ADRs) |
| Technical | Dev Lead | `technical/dev-lead.md` | sonnet | Task breakdown, fan-out to devs, code review |
| Technical | Developer | `technical/dev.md` | sonnet | Implementation |
| Technical | QA Engineer | `technical/qa-engineer.md` | sonnet | Verification against acceptance criteria |
| Technical | DevOps Engineer | `technical/devops-engineer.md` | sonnet | CI/CD, build, release |
| Technical | Security Engineer | `technical/security-engineer.md` | sonnet | Security review, release gate |
| Technical | Documentation Engineer | `technical/docs-engineer.md` | sonnet | Architecture reference, CONTRIBUTING, code comments |
| Product | CPO | `product/cpo.md` | opus | Product vision, roadmap, portfolio prioritization |
| Product | Product Owner | `product/product-owner.md` | sonnet | Epics, user stories, acceptance criteria |
| Product | Business Analyst | `product/business-analyst.md` | sonnet | Requirements elicitation for complex initiatives |
| Product | Designer | `product/designer.md` | sonnet | UX/UI specs, design tokens |
| Back Office | CFO | `back-office/cfo.md` | sonnet | Cost/budget review gate |
| Marketing | Technical Writer | `marketing/tech-writer.md` | sonnet | User-facing docs, changelog |
| Support | Support Engineer | `support/support-engineer.md` | haiku | Inbound issue triage |
| Sales | Sales Engineer | `sales/sales-engineer.md` | sonnet | Pre-sales technical Q&A, non-binding scoping |
| Customer | Customer Success | `customer/customer-success.md` | sonnet | Account health, renewal risk, expansion feedback |
| Intelligence | Data Analyst | `intelligence/data-analyst.md` | sonnet | Usage/telemetry analysis for `cpo` and `cfo` |

Full responsibilities, guardrails, and tool grants are in each agent's own file. The
collaboration rules below are the condensed version of `docs/team-protocol.md`.

## Why each department head sits where it does

Each C-suite role heads its own department rather than all four (`ceo`/`cto`/`cpo`/
`cfo`) sitting together in one generic executive bucket: `cto` heads Technical, `cpo`
heads Product, `cfo` heads Back Office (cost/budget review, general org overhead), and
`ceo` alone remains in C-Level as the sole cross-functional, top-level orchestrator —
the one role with no department-specific mandate of its own.

## Roles added after the original roster

The original roster shipped without `business-analyst`, `docs-engineer`,
`sales-engineer`, `customer-success`, and `data-analyst` — each was added once the gap
it fills became real, not speculatively:

- **Delivery/Project Manager** was deliberately left out — `ceo` (cross-functional) and
  `dev-lead` (engineering) already own coordination; a third role would just relay
  messages between them.
- **`business-analyst`** and **`docs-engineer`** were added once nobody was doing
  requirements elicitation for genuinely ambiguous initiatives before `product-owner`
  had to guess, and nobody kept the codebase's own architecture/contributor docs in
  sync the way `tech-writer` does for user-facing ones.
- **`sales-engineer`**, **`customer-success`**, and **`data-analyst`** fill the Sales,
  Customer, and Intelligence departments: pre-sales technical scoping, post-sale
  account relationships, and usage/telemetry-backed findings for `cpo`/`cfo`,
  respectively. `data-analyst` produces nothing until real usage data exists to
  analyze — see its Guardrails — so it stays a thin, honest pass-through rather than
  fabricating trends in the meantime.

## Feature pipeline

```
human/ceo → cpo → business-analyst (complex initiatives only) → product-owner
  → designer (UI stories) → dev-lead → dev ×N → qa-engineer → dev-lead (verdict)
  → devops-engineer (release) → tech-writer (docs), docs-engineer (architecture docs,
    when the change was structurally significant)
```

## Support pipeline

```
inbound issue → support-engineer → dev-lead (defect)
                                  → product-owner (feature request)
                                  → tech-writer (doc gap)
                                  → ceo → security-engineer (security smell)
```

## Pre-sales & customer pipeline

```
prospect question → ceo → sales-engineer → cpo (roadmap gap) | dev-lead (committed task)
customer account question → ceo → customer-success → product-owner (feature request)
                                                     → support-engineer (bug report)
                                                     → ceo (renewal risk)
usage/cost question → cpo | cfo → data-analyst → cpo | cfo (findings)
```

## Delegation authority

Only `ceo` and `dev-lead` hold the `Agent` tool — they are the only roles that can
invoke another subagent directly. Everyone else ends their reply with a `HANDOFF`
block naming the next role; the caller (usually `ceo` or `dev-lead`) executes it. This
keeps delegation to two choke points instead of an uncontrolled agent-calling-agent
graph.

`ceo` and `dev-lead` run their part of the pipeline autonomously — they chain
handoffs themselves through to the Definition of Done instead of stopping after every
hop. They only surface control to the human at the stop conditions in
`docs/team-protocol.md`: a disputed CFO or security gate, an unresolved critical
security finding, a genuinely ambiguous brief, or a fix loop stuck past its 3-cycle
cap.

See `docs/team-protocol.md` for the full authority rules (ADR bindingness, the CFO
cost gate, the security gate, and the QA gate) and `tests/agents.test.mjs` for the
policy that locks each role's tools and model tier.
