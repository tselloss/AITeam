# AITeam

An AI company team: 18 Claude Code subagents (CEO, CTO, CPO, CFO, Business Analyst,
Product Owner, Dev Lead, Developer, QA Engineer, DevOps Engineer, Security Engineer,
Designer, Support Engineer, Technical Writer, Documentation Engineer, Sales Engineer,
Customer Success, Data Analyst) that can run a software project — and the business
around it — end to end from inside Claude Code.

## How to invoke the team

Each role is a subagent defined under `.claude/agents/<department>/<name>.md` (e.g.
`.claude/agents/technical/dev.md`) — department subfolders (`c-level/`, `technical/`,
`product/`, `back-office/`, `marketing/`, `support/`, `sales/`, `customer/`,
`intelligence/`) are purely organizational: a role is identified by its frontmatter
`name`, not its path, and discovery recurses through subfolders. From within a Claude
Code session in this repo, delegate work with the `Agent` tool and `subagent_type` set
to the role's `name` (e.g. `subagent_type: "product-owner"`). Only `ceo` and `dev-lead`
hold the `Agent` tool themselves, so they're the two entry points for multi-step
delegation — route new work through `ceo`, and route accepted engineering stories
through `dev-lead`. See `docs/org-chart.md` for the roster and `docs/team-protocol.md`
for the full handoff rules each agent follows.

## Running the tests

The test suite statically validates every agent file (frontmatter shape, tool/model
policy, required sections) with zero network calls and zero dependencies:

```
node --test
```

(Run from the repo root. `node --test tests/agents.test.mjs` also works; passing just
`tests/` as a directory argument does not resolve on this Node build.)

An optional, off-by-default eval tier that would exercise real agent behavior via the
`claude` CLI is stubbed in `tests/agents.test.mjs`, gated behind
`RUN_AGENT_EVALS=1` since it needs an authenticated CLI and network access.

## Structure

```
.claude/agents/   the 18 role definitions (source of truth), one department
                  subfolder per: c-level/, technical/, product/, back-office/,
                  marketing/, support/, sales/, customer/, intelligence/
.claude-plugin/
  plugin.json       plugin manifest (name, version, author)
  marketplace.json  self-referencing marketplace listing the plugin above
agents/           generated plugin copies of .claude/agents/**/*.md, flattened —
                  do not hand-edit
scripts/
  build-plugin.mjs  regenerates agents/ from .claude/agents/
app/
  server/           the local runner: agents.js, orchestrator.js, tool-runtime.js,
                     handoff.js, github.js, config.js, index.js
  public/           the one-page UI
  workspaces/       gitignored — one directory per run
docs/
  org-chart.md      roster + pipelines, condensed
  team-protocol.md  canonical collaboration protocol agents read at runtime
tests/
  agents.test.mjs       offline structural + policy tests
  plugin.test.mjs       offline plugin manifest + agents/ sync tests
  tool-runtime.test.mjs offline sandbox-boundary tests for the runner's canUseTool gate
  handoff.test.mjs      offline HANDOFF-line parser tests
```

`docs/decisions/`, `docs/backlog/`, `docs/product/`, and `docs/design/` are created on
demand by the roles that own them (`ceo`/`cto`, `product-owner`, `cpo`, `designer`
respectively) — they don't exist until first used.

## Extending the roster

Adding a role means: create `.claude/agents/<department>/<name>.md` (an existing
department folder, or a new one — the folder is organizational only) with the required
frontmatter (`name`, `description`, `tools`, `model`) and body sections (`## Scope`,
`## Hands off to`, `## Guardrails`, `## Output format`), add it to the `POLICY` table
and `ROSTER` in `tests/agents.test.mjs`, mention it in `docs/team-protocol.md`, and run
`npm run build:plugin` to regenerate its plugin copy in `agents/`. The test suite
fails closed if any of these four are missed.

## More reference (read only when the task needs it)
- Installing as a plugin in other repos, and running the team outside Claude Code: `docs/claude-reference.md`

## Token rules (token-kit)
- Keep this file short; it is loaded on every turn.
- Global token rules live in ~/.claude/CLAUDE.md. One task per session; /clear between tasks.
