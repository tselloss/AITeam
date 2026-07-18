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

## Installing as a plugin in other repos

This repo is also a self-contained Claude Code plugin (`.claude-plugin/plugin.json` +
`.claude-plugin/marketplace.json`, self-referencing), so the roster can be installed
once and used from any other project on the same machine without copying files into
each one:

```
/plugin marketplace add /absolute/path/to/AITeam
/plugin install aiteam@aiteam-marketplace
```

Run those two commands from inside any Claude Code session (VS Code extension, CLI,
or desktop app all work). Installation defaults to user scope, so the roster then
shows up in every project you open on that machine, running on your existing Claude
subscription through Claude Code itself — no separate Anthropic API key, and no
`app/` web UI needed (that's a different, optional path; see below). Update after
pulling changes with `/plugin marketplace update aiteam-marketplace`.

Once installed, just describe what you need in a normal chat message — `ceo`'s
description is written to trigger proactively, so Claude Code routes new feature
ideas, bug reports, and technical questions to it automatically, the same way it
auto-selects any other specialized agent. If that doesn't fire (e.g. the ask is
phrased ambiguously), fall back to the bundled `/aiteam:ask <what you need>` slash
command, which deterministically invokes `ceo` — or invoke it explicitly yourself
with the `Agent` tool and `subagent_type: "aiteam:ceo"` (namespaced by plugin name)
instead of the bare `"ceo"` used when working directly inside this repo.

The plugin ships `agents/*.md` (generated, see below) and `docs/team-protocol.md`,
which plugin agents read via `${CLAUDE_PLUGIN_ROOT}/docs/team-protocol.md` so the
reference resolves correctly no matter which project the plugin is installed into.
It does not ship `app/` or `docs/decisions|backlog|design|product/` — those stay
specific to whichever project you're actually running the team against, and get
created inside *that* project's own working tree, not inside the plugin install.

If a target repo happens to define its own project-level `.claude/agents/<name>.md`
with the same name as a plugin role, the project-level one wins (project scope
shadows plugin scope) — that's the escape hatch for per-repo customization.

**`agents/*.md` is a generated build artifact, not a second source of truth.** It's
produced from `.claude/agents/*.md` by `scripts/build-plugin.mjs`; the only thing
that script changes is rewriting `docs/team-protocol.md` references to
`${CLAUDE_PLUGIN_ROOT}/docs/team-protocol.md`. Regenerate it after any edit to
`.claude/agents/`:

```sh
npm run build:plugin
```

`node --test` fails if `agents/` drifts out of sync with `.claude/agents/`, so this
can't silently go stale.

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

## Running the team outside Claude Code (optional, separate from the plugin)

Everyday use is the plugin path above — install once, then just ask, inside a normal
Claude Code session, on your existing subscription. `app/` is a *different*, optional
path: a small local web app that runs the same roster standalone, billed against your
own metered Anthropic API key instead of your Claude subscription, and pushes the
result to a GitHub repo — for when you want to kick off a project from a browser
without opening Claude Code at all. It reuses `.claude/agents/*.md` as the only source
of truth for each role's prompt, tools, and model; nothing about the roster is
duplicated. Skip this section entirely if you're just using the plugin.

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
.claude/agents/   the 13 role definitions (source of truth)
.claude-plugin/
  plugin.json       plugin manifest (name, version, author)
  marketplace.json  self-referencing marketplace listing the plugin above
agents/           generated plugin copies of .claude/agents/*.md — do not hand-edit
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
and `ROSTER` in `tests/agents.test.mjs`, mention it in `docs/team-protocol.md`, and run
`npm run build:plugin` to regenerate its plugin copy in `agents/`. The test suite
fails closed if any of these four are missed.
