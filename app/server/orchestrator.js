import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAgentFiles, loadAgent } from './agents.js';
import { resolveInWorkspace, SandboxViolationError } from './tool-runtime.js';
import { parseHandoff } from './handoff.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const AGENTS_DIR = path.join(repoRoot, '.claude', 'agents');

// Full model IDs a role's frontmatter tier resolves to. Runs go through the
// Claude Agent SDK, which shells out to the same `claude` CLI session
// already authenticated on this machine (claude login) — so these calls
// bill against the operator's Claude subscription, not a metered API key.
const MODEL_FOR_TIER = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
};

// Haiku 4.5 doesn't support adaptive thinking or the effort parameter —
// only opus/sonnet tiers get them below.
const EFFORT_FOR_TIER = { opus: 'high', sonnet: 'medium' };

// Safety caps enforced by us, not by the model's own self-discipline in
// docs/team-protocol.md — this run is spending your real subscription
// usage, so a prompt-following bug shouldn't be able to turn into an
// unbounded number of role invocations or tool-call turns.
const MAX_ROLE_INVOCATIONS_PER_RUN = 40;
const MAX_TURNS_PER_ROLE = 40;

// Matches docs/team-protocol.md § Triage rubric's top severity tier — always
// loops `ceo` in; enforced here rather than trusted to prompt-following,
// same reasoning as the caps above.
const CRITICAL_SEVERITY = 'critical';

// Human-approval-gated tools — Read/Grep/Glob/WebSearch/WebFetch run without
// a pause; Write/Edit/Bash pause for the same UI approval flow as before.
const GATED_TOOLS = new Set(['Write', 'Edit', 'Bash']);

// Input keys that carry a model-supplied path on the built-in tools we grant
// (file_path on Read/Write/Edit, path on Grep/Glob) — checked against the
// run's workspace boundary before any of them are allowed to execute.
const PATH_INPUT_KEYS = ['file_path', 'path'];

const DELEGATE_TOOL = 'mcp__aiteam__delegate';

// Assistant-turn errors worth retrying — a subscription usage window
// (5-hour/7-day) or the API's own capacity, both of which recover on their
// own. We wait rather than fail the run: see RETRYABLE_ASSISTANT_ERRORS below.
const RETRYABLE_ASSISTANT_ERRORS = new Set(['rate_limit', 'overloaded', 'server_error', 'unknown']);

// Assistant-turn errors that won't fix themselves by waiting — each maps to
// the guidance surfaced in the thrown RunAbortedError.
const NON_RETRYABLE_ASSISTANT_ERRORS = {
  authentication_failed: 'Claude Code is not logged in on this machine — run `claude login` in a terminal ' +
    '(or `claude /login` inside a session) to authenticate with your Claude subscription, then retry.',
  oauth_org_not_allowed: 'this Claude Code login is not permitted to use the API from this organization — check with your Claude Code admin.',
  invalid_request: 'the request was malformed (a prompt-construction bug, not a capacity issue) — this needs a code fix, not a wait.',
  model_not_found: 'the configured model ID was not found — check MODEL_FOR_TIER in orchestrator.js.',
  billing_error: 'there is a billing problem with this Claude account (e.g. a failed payment) — resolve it in your Anthropic/Claude account, waiting will not fix it.',
};

// Fallback backoff for retryable errors that don't carry a known reset time
// (rate_limit_event does; overloaded/server_error/unknown don't) — starts
// short and backs off, capped, rather than hammering a struggling service.
const BACKOFF_START_MS = 30 * 1000;
const BACKOFF_MAX_MS = 10 * 60 * 1000;
// Small cushion past a reported usage-window reset time, and the poll
// interval used when a rate-limit rejection carries no resetsAt at all.
const RATE_LIMIT_BUFFER_MS = 30 * 1000;
const RATE_LIMIT_POLL_MS = 5 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `resetsAt` on SDKRateLimitInfo is documented as a number but not which
// unit; treat anything too small to be a millisecond epoch as seconds.
function normalizeEpochMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value > 1e12 ? value : value * 1000;
}

export class RunAbortedError extends Error {}

// Runs the AITeam pipeline for one project. `onEvent` receives a stream of
// plain objects for the UI (role_start/text/handoff/role_end/warning/error);
// `requestApproval(role, toolName, input)` must return a Promise resolving
// to `{ approved, reason? }` — the caller (app/server/index.js) owns pausing
// for a UI click and answering it via POST /api/runs/:id/approve.
export async function runProject({ workspaceDir, brief, onEvent, requestApproval }) {
  const roster = new Set(listAgentFiles(AGENTS_DIR).map((f) => f.replace(/\.md$/, '')));
  let invocationCount = 0;

  // Only `ceo` and `dev-lead` are granted this tool (see the `tools` filter
  // in runRole below), mirroring "only ceo and dev-lead hold the Agent tool"
  // in docs/team-protocol.md. Calling it recurses into runRole and returns
  // the delegate's final reply as the tool result, exactly like the custom
  // `Agent` tool the previous API-key-based orchestrator implemented by hand.
  const delegateTool = tool(
    'delegate',
    'Delegate a task to another AITeam role and get back its final reply.',
    { subagent_type: z.string().describe('the role name, e.g. product-owner'), prompt: z.string() },
    async ({ subagent_type, prompt }) => {
      const result = await runRole(subagent_type, prompt);
      return { content: [{ type: 'text', text: result.text }] };
    },
  );
  const aiteamServer = createSdkMcpServer({ name: 'aiteam', tools: [delegateTool] });

  async function runRole(roleName, task) {
    if (!roster.has(roleName)) {
      throw new Error(`unknown role named in a HANDOFF/delegate call: ${roleName}`);
    }
    invocationCount += 1;
    if (invocationCount > MAX_ROLE_INVOCATIONS_PER_RUN) {
      throw new RunAbortedError(`hit the ${MAX_ROLE_INVOCATIONS_PER_RUN}-role-invocation safety cap for this run`);
    }

    const agent = loadAgent(AGENTS_DIR, roleName);
    onEvent({ type: 'role_start', role: roleName, task });

    const sdkTools = agent.tools.filter((t) => t !== 'Agent');
    if (agent.tools.includes('Agent')) sdkTools.push(DELEGATE_TOOL);

    const options = {
      cwd: workspaceDir,
      model: MODEL_FOR_TIER[agent.model],
      systemPrompt: agent.systemPrompt,
      tools: sdkTools,
      mcpServers: { aiteam: aiteamServer },
      maxTurns: MAX_TURNS_PER_ROLE,
      persistSession: false,
      canUseTool: async (toolName, input) => {
        for (const key of PATH_INPUT_KEYS) {
          if (typeof input[key] !== 'string') continue;
          try {
            resolveInWorkspace(workspaceDir, input[key]);
          } catch (error) {
            if (!(error instanceof SandboxViolationError)) throw error;
            return { behavior: 'deny', message: error.message };
          }
        }
        if (!GATED_TOOLS.has(toolName)) return { behavior: 'allow', updatedInput: input };
        const decision = await requestApproval(roleName, toolName, input);
        if (!decision.approved) {
          return {
            behavior: 'deny',
            message: `User denied this ${toolName} call${decision.reason ? `: ${decision.reason}` : '.'} ` +
              'Do not retry the same action — ask for guidance or pick a different approach.',
          };
        }
        return { behavior: 'allow', updatedInput: input };
      },
    };
    if (agent.model !== 'haiku') {
      options.thinking = { type: 'adaptive' };
      options.effort = EFFORT_FOR_TIER[agent.model];
    }

    // Retries a rate-limited/overloaded/transiently-failed role turn from
    // scratch after waiting — never fails the run over something that fixes
    // itself with time. Doesn't count against MAX_ROLE_INVOCATIONS_PER_RUN,
    // which guards against runaway pipelines, not external throttling.
    let text;
    let resultMessage;
    let backoffMs = BACKOFF_START_MS;
    for (;;) {
      text = '';
      resultMessage = undefined;
      let pendingRateLimit = null;
      let retryableError = null;

      for await (const message of query({ prompt: task, options })) {
        if (message.type === 'system' && message.subtype === 'init') {
          onEvent({ type: 'auth', role: roleName, apiKeySource: message.apiKeySource, model: message.model });
        } else if (message.type === 'rate_limit_event') {
          const info = message.rate_limit_info;
          if (info.status === 'rejected') {
            pendingRateLimit = info;
          } else if (info.status === 'allowed_warning') {
            onEvent({ type: 'rate_limit_warning', role: roleName, rateLimitType: info.rateLimitType, utilization: info.utilization });
          }
        } else if (message.type === 'assistant') {
          if (message.error) {
            if (message.error in NON_RETRYABLE_ASSISTANT_ERRORS) {
              throw new RunAbortedError(`${roleName} hit a non-retryable error (${message.error}): ${NON_RETRYABLE_ASSISTANT_ERRORS[message.error]}`);
            }
            if (RETRYABLE_ASSISTANT_ERRORS.has(message.error)) {
              retryableError = message.error;
            }
          }
          for (const block of message.message.content ?? []) {
            if (block.type === 'text' && block.text) {
              text += block.text;
              onEvent({ type: 'text', role: roleName, text: block.text });
            }
          }
        } else if (message.type === 'result') {
          resultMessage = message;
        }
      }

      if (pendingRateLimit) {
        const resumeAtMs = normalizeEpochMs(pendingRateLimit.resetsAt) ?? (Date.now() + RATE_LIMIT_POLL_MS);
        const resumeAt = new Date(resumeAtMs).toISOString();
        onEvent({ type: 'rate_limited', role: roleName, rateLimitType: pendingRateLimit.rateLimitType, resumeAt });
        await sleep(Math.max(0, resumeAtMs - Date.now()) + RATE_LIMIT_BUFFER_MS);
        onEvent({ type: 'resumed', role: roleName });
        continue;
      }

      if (retryableError) {
        const resumeAt = new Date(Date.now() + backoffMs).toISOString();
        onEvent({ type: 'rate_limited', role: roleName, reason: retryableError, resumeAt });
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
        onEvent({ type: 'resumed', role: roleName });
        continue;
      }

      break;
    }

    if (resultMessage && resultMessage.subtype !== 'success') {
      onEvent({
        type: 'warning',
        role: roleName,
        text: `role turn ended with ${resultMessage.subtype}` +
          (resultMessage.terminal_reason ? ` (${resultMessage.terminal_reason})` : ''),
      });
    }

    const handoff = parseHandoff(text);
    if (handoff) {
      onEvent({
        type: 'handoff',
        from: roleName,
        to: handoff.role,
        task: handoff.task,
        area: handoff.area,
        severity: handoff.severity,
        inputs: handoff.inputs,
      });

      if (handoff.severity === CRITICAL_SEVERITY) {
        onEvent({
          type: 'critical_handoff',
          from: roleName,
          to: handoff.role,
          task: handoff.task,
          area: handoff.area,
          severity: handoff.severity,
        });
        // Reuse the same approval pause used for Write/Edit/Bash so a
        // critical-severity item can't sail through an autonomous
        // ceo/dev-lead chain unacknowledged, whichever role raised it.
        const decision = await requestApproval(roleName, 'CriticalSeverityHandoff', {
          to: handoff.role,
          task: handoff.task,
          area: handoff.area,
          severity: handoff.severity,
        });
        if (!decision.approved) {
          throw new RunAbortedError(
            `human stopped a critical-severity handoff from ${roleName} to ${handoff.role}` +
            (decision.reason ? `: ${decision.reason}` : '.'),
          );
        }
      }
    }
    onEvent({ type: 'role_end', role: roleName, text });
    return { text, handoff };
  }

  return runRole('ceo', brief);
}
