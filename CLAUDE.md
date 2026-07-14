# AITeam

An AI company team: 13 Claude Code subagents (CEO, CTO, CPO, CFO, Product Owner, Dev
Lead, Developer, QA Engineer, DevOps Engineer, Security Engineer, Designer, Support
Engineer, Technical Writer) that can run a software project end to end from inside
Claude Code.

## How to invoke the team

Each role in `.claude/agents/*.md` is a subagent. From within a Claude Code session in
this repo, delegate work with the `Agent` tool and `subagent_type` set to the role's
`name` (e.g. `subagent_type: "product-owner"`). Only `ceo` and `dev-lead` hold the
`Agent` tool themselves, so they're the two entry points for multi-step delegation —
route new work through `ceo`, and route accepted engineering stories through
`dev-lead`. See `docs/org-chart.md` for the roster and `docs/team-protocol.md` for the
full handoff rules each agent follows.

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

## Running the team outside Claude Code

`app/` is a small local web app that runs the same roster standalone, against
your own Anthropic API key, and pushes the result to a GitHub repo — for when
you want to kick off a project without opening Claude Code. It reuses
`.claude/agents/*.md` as the only source of truth for each role's prompt,
tools, and model; nothing about the roster is duplicated.

```sh
npm install
npm start          # http://localhost:8877 (override with PORT=...)
```

Paste an Anthropic API key and a GitHub personal access token (repo scope)
into Settings, describe a project, pick a target repo (create new or clone
existing), and run. `Write`/`Edit`/`Bash` calls pause for your approval in
the UI before they touch disk; every path is sandboxed to that run's
directory under `app/workspaces/` (gitignored). See
`C:\Users\karac\.claude\plans\floating-rolling-seal.md` for the full design
if you need the reasoning behind it — the short version is `app/server/agents.js`
loads a role, `orchestrator.js` runs it through the Claude API's Tool Runner,
and `ceo`'s own `Agent` tool calls (per its autonomy instructions) are what
actually chain the pipeline from role to role.

## Structure

```
.claude/agents/   the 13 role definitions
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
  tool-runtime.test.mjs offline sandbox-escape tests for the local runner
  handoff.test.mjs      offline HANDOFF-line parser tests
```

`docs/decisions/`, `docs/backlog/`, `docs/product/`, and `docs/design/` are created on
demand by the roles that own them (`ceo`/`cto`, `product-owner`, `cpo`, `designer`
respectively) — they don't exist until first used.

## Extending the roster

Adding a role means: create `.claude/agents/<name>.md` with the required frontmatter
(`name`, `description`, `tools`, `model`) and body sections (`## Scope`,
`## Hands off to`, `## Guardrails`, `## Output format`), add it to the `POLICY` table
and `ROSTER` in `tests/agents.test.mjs`, and mention it in `docs/team-protocol.md`.
The test suite fails closed if any of these three are missed.
