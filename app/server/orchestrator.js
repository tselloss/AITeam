import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAgentFiles, loadAgent } from './agents.js';
import * as toolRuntime from './tool-runtime.js';
import { parseHandoff } from './handoff.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const AGENTS_DIR = path.join(repoRoot, '.claude', 'agents');

const MODEL_FOR_TIER = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
};

const EFFORT_FOR_TIER = { opus: 'high', sonnet: 'medium', haiku: 'low' };

// Safety caps enforced by us, not by the model's own self-discipline in
// docs/team-protocol.md — this run is spending your real API budget, so a
// prompt-following bug shouldn't be able to turn into an unbounded bill.
const MAX_ROLE_INVOCATIONS_PER_RUN = 40;
const MAX_TOOL_ITERATIONS_PER_ROLE = 40;

// Matches docs/team-protocol.md § Triage rubric's top severity tier — always
// loops `ceo` in; enforced here rather than trusted to prompt-following,
// same reasoning as the caps above.
const CRITICAL_SEVERITY = 'critical';

export class RunAbortedError extends Error {}

function buildTools({ agent, workspaceDir, onEvent, requestApproval, runRole }) {
  const tools = [];

  const gated = (toolName, description, properties, required, execute) =>
    betaTool({
      name: toolName,
      description,
      inputSchema: { type: 'object', properties, required },
      run: async (input) => {
        const decision = await requestApproval(agent.name, toolName, input);
        if (!decision.approved) {
          return `User denied this ${toolName} call${decision.reason ? `: ${decision.reason}` : '.'} ` +
            'Do not retry the same action — ask for guidance or pick a different approach.';
        }
        return execute(input);
      },
    });

  for (const toolName of agent.tools) {
    switch (toolName) {
      case 'Read':
        tools.push(betaTool({
          name: 'Read',
          description: 'Read a file from the project workspace.',
          inputSchema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
          run: async (input) => toolRuntime.readFile(workspaceDir, input),
        }));
        break;
      case 'Grep':
        tools.push(betaTool({
          name: 'Grep',
          description: 'Search file contents in the project workspace with a regular expression.',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              glob: { type: 'string', description: 'optional glob filter, e.g. **/*.js' },
            },
            required: ['pattern'],
          },
          run: async (input) => toolRuntime.grep(workspaceDir, input),
        }));
        break;
      case 'Glob':
        tools.push(betaTool({
          name: 'Glob',
          description: 'Find files in the project workspace matching a glob pattern.',
          inputSchema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
          run: async (input) => toolRuntime.glob(workspaceDir, input),
        }));
        break;
      case 'Write':
        tools.push(gated(
          'Write',
          'Write (create or overwrite) a file in the project workspace.',
          { file_path: { type: 'string' }, content: { type: 'string' } },
          ['file_path', 'content'],
          (input) => toolRuntime.writeFile(workspaceDir, input),
        ));
        break;
      case 'Edit':
        tools.push(gated(
          'Edit',
          'Replace an exact string match in a file in the project workspace.',
          {
            file_path: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' },
          },
          ['file_path', 'old_string', 'new_string'],
          (input) => toolRuntime.editFile(workspaceDir, input),
        ));
        break;
      case 'Bash':
        tools.push(gated(
          'Bash',
          'Run a shell command in the project workspace.',
          { command: { type: 'string' } },
          ['command'],
          (input) => toolRuntime.bash(workspaceDir, input),
        ));
        break;
      case 'WebSearch':
        tools.push({ type: 'web_search_20260209', name: 'web_search' });
        break;
      case 'WebFetch':
        tools.push({ type: 'web_fetch_20260209', name: 'web_fetch' });
        break;
      case 'Agent':
        tools.push(betaTool({
          name: 'Agent',
          description: 'Delegate a task to another AITeam role and get back its final reply.',
          inputSchema: {
            type: 'object',
            properties: {
              subagent_type: { type: 'string', description: 'the role name, e.g. product-owner' },
              prompt: { type: 'string' },
            },
            required: ['subagent_type', 'prompt'],
          },
          run: async ({ subagent_type, prompt }) => {
            const result = await runRole(subagent_type, prompt);
            return result.text;
          },
        }));
        break;
      default:
        throw new Error(`no tool-runtime mapping for tool: ${toolName}`);
    }
  }
  return tools;
}

// Runs the AITeam pipeline for one project. `onEvent` receives a stream of
// plain objects for the UI (role_start/text/handoff/role_end/warning/error);
// `requestApproval(role, toolName, input)` must return a Promise resolving
// to `{ approved, reason? }` — the caller (app/server/index.js) owns pausing
// for a UI click and answering it via POST /api/runs/:id/approve.
export async function runProject({ apiKey, workspaceDir, brief, onEvent, requestApproval }) {
  const client = new Anthropic({ apiKey });
  const roster = new Set(listAgentFiles(AGENTS_DIR).map((f) => f.replace(/\.md$/, '')));
  let invocationCount = 0;

  async function runRole(roleName, task) {
    if (!roster.has(roleName)) {
      throw new Error(`unknown role named in a HANDOFF/Agent call: ${roleName}`);
    }
    invocationCount += 1;
    if (invocationCount > MAX_ROLE_INVOCATIONS_PER_RUN) {
      throw new RunAbortedError(`hit the ${MAX_ROLE_INVOCATIONS_PER_RUN}-role-invocation safety cap for this run`);
    }

    const agent = loadAgent(AGENTS_DIR, roleName);
    onEvent({ type: 'role_start', role: roleName, task });

    const tools = buildTools({ agent, workspaceDir, onEvent, requestApproval, runRole });
    const runner = client.beta.messages.toolRunner({
      model: MODEL_FOR_TIER[agent.model],
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT_FOR_TIER[agent.model] },
      // A role's system prompt and tool list are byte-identical on every
      // invocation (dev-lead alone may call runRole('dev', ...) many times
      // in one project run) — the cache_control breakpoint here caches both,
      // since the API renders tools before system. Only the task text after
      // it is ever new, so repeat calls to the same role are billed at the
      // ~0.1x cache-read rate for everything but that task.
      system: [{ type: 'text', text: agent.systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools,
      messages: [{ role: 'user', content: task }],
    });

    let finalMessage;
    let iterations = 0;
    for await (const message of runner) {
      iterations += 1;
      finalMessage = message;
      for (const block of message.content ?? []) {
        if (block.type === 'text' && block.text) {
          onEvent({ type: 'text', role: roleName, text: block.text });
        }
      }
      if (iterations >= MAX_TOOL_ITERATIONS_PER_ROLE) {
        onEvent({
          type: 'warning',
          role: roleName,
          text: `hit the ${MAX_TOOL_ITERATIONS_PER_ROLE}-iteration safety cap for this role invocation; stopping early`,
        });
        break;
      }
    }

    const text = (finalMessage?.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
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
