# AITeam Org Chart

15 roles, each a Claude Code subagent in `.claude/agents/`. A "team" (e.g. "the dev
team") is one agent definition invoked as many times as there are parallel tasks — not
one file per person.

| Role | File | Model | Mandate |
|---|---|---|---|
| CEO | `ceo.md` | opus | Top-level orchestrator: intake, routing, arbitration |
| CTO | `cto.md` | opus | Technical strategy, architecture decisions (ADRs) |
| CPO | `cpo.md` | opus | Product vision, roadmap, portfolio prioritization |
| CFO | `cfo.md` | sonnet | Cost/budget review gate |
| Business Analyst | `business-analyst.md` | sonnet | Requirements elicitation for complex initiatives |
| Product Owner | `product-owner.md` | sonnet | Epics, user stories, acceptance criteria |
| Dev Lead | `dev-lead.md` | sonnet | Task breakdown, fan-out to devs, code review |
| Developer | `dev.md` | sonnet | Implementation |
| QA Engineer | `qa-engineer.md` | sonnet | Verification against acceptance criteria |
| DevOps Engineer | `devops-engineer.md` | sonnet | CI/CD, build, release |
| Security Engineer | `security-engineer.md` | sonnet | Security review, release gate |
| Designer | `designer.md` | sonnet | UX/UI specs, design tokens |
| Support Engineer | `support-engineer.md` | haiku | Inbound issue triage |
| Technical Writer | `tech-writer.md` | sonnet | User-facing docs, changelog |
| Documentation Engineer | `docs-engineer.md` | sonnet | Architecture reference, CONTRIBUTING, code comments |

Full responsibilities, guardrails, and tool grants are in each agent's own file. The
collaboration rules below are the condensed version of `docs/team-protocol.md`.

## Why this roster and not a bigger one

Three roles were deliberately left out to avoid redundant coordination layers:

- **Delivery/Project Manager** — `ceo` (cross-functional) and `dev-lead` (engineering)
  already own coordination; a third role would just relay messages between them.
- **Marketing** — no recurring workload inside a code repo; rare launch copy is covered
  by `tech-writer` (words) and `cpo` (positioning).
- **Data Analyst** — nothing to analyze until the project has real usage telemetry;
  `cfo` (cost) and `cpo` (product metrics) absorb ad-hoc analysis until then. This is
  distinct from `business-analyst`, who does requirements/process analysis (business
  rules, stakeholder needs, current-vs-future-state), not usage-data analysis — that
  gap still doesn't exist, so a data-analyst role still isn't warranted.

`business-analyst` and `docs-engineer` were added later, once the gaps they fill
became real: nobody was doing requirements elicitation for genuinely ambiguous
initiatives before `product-owner` had to guess, and nobody kept the codebase's own
architecture/contributor docs in sync the way `tech-writer` does for user-facing ones.

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
