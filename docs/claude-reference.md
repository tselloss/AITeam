# AITeam reference (moved out of CLAUDE.md to keep per-turn context small)

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
(in any subfolder) with the same name as a plugin role, the project-level one wins
(project scope shadows plugin scope) — that's the escape hatch for per-repo
customization.

**`agents/*.md` is a generated build artifact, not a second source of truth.** It's
produced from `.claude/agents/**/*.md` by `scripts/build-plugin.mjs`, which flattens
department subfolders into a flat `agents/` directory — so the plugin's scoped
invocation stays `aiteam:<name>` regardless of which department folder a role's
source file lives in — and rewrites `docs/team-protocol.md` references to
`${CLAUDE_PLUGIN_ROOT}/docs/team-protocol.md`. Regenerate it after any edit to
`.claude/agents/`:

```sh
npm run build:plugin
```

`node --test` fails if `agents/` drifts out of sync with `.claude/agents/`, so this
can't silently go stale.

## Running the team outside Claude Code (optional, separate from the plugin)

Everyday use is the plugin path above — install once, then just ask, inside a normal
Claude Code session, on your existing subscription. `app/` is a *different*, optional
path: a small local web app that runs the same roster standalone from a browser,
without opening Claude Code at all, and pushes the result to a GitHub repo. It still
bills against your Claude subscription, not a metered API key — runs go through the
Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), which shells out to whichever
`claude` CLI session is already logged in on this machine (`claude login`), the same
credential the VS Code extension/CLI/desktop app use. It reuses `.claude/agents/**/*.md`
as the only source of truth for each role's prompt, tools, and model; nothing about
the roster is duplicated. Skip this section entirely if you're just using the plugin.

```sh
npm install
npm start          # http://localhost:8877 (override with PORT=...)
```

No Anthropic API key to paste — just make sure `claude login` has been run at least
once on this machine. Paste a GitHub personal access token (repo scope) into
Settings, describe a project, pick a target repo (create new or clone existing), and
run. `Write`/`Edit`/`Bash` calls pause for your approval in the UI before they touch
disk; every path is sandboxed to that run's directory under `app/workspaces/`
(gitignored) via a `canUseTool` permission gate in `orchestrator.js`. See
`C:\Users\karac\.claude\plans\floating-rolling-seal.md` for the original (API-key-based)
design rationale — the short version still holds: `app/server/agents.js` loads a role
and `orchestrator.js` runs it, one Agent SDK `query()` call per role invocation; only
`ceo` and `dev-lead` are granted a custom `delegate` MCP tool (an in-process
`createSdkMcpServer`), and calling it recurses into the next role and returns its
final reply — that recursion is what chains the pipeline from role to role, mirroring
the plugin path's real `Agent` tool.
