import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_TOOLS, ALLOWED_MODELS, parseAgentFile as parseAgentFileShared } from '../app/server/agents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const agentsDir = path.join(repoRoot, '.claude', 'agents');

const REQUIRED_KEYS = new Set(['name', 'description', 'tools', 'model']);
const REQUIRED_HEADINGS = ['## Scope', '## Hands off to', '## Guardrails', '## Output format'];

// Policy lock: any change to roster membership, tools, or model tier must be made
// here AND in the corresponding agent file, on purpose.
const POLICY = {
  'ceo': { tools: 'Read, Grep, Glob, Write, Agent', model: 'opus' },
  'cto': { tools: 'Read, Grep, Glob, Bash, WebSearch, WebFetch, Write', model: 'opus' },
  'cpo': { tools: 'Read, Grep, Glob, WebSearch, WebFetch, Write', model: 'opus' },
  'cfo': { tools: 'Read, Grep, Glob, WebSearch, WebFetch', model: 'sonnet' },
  'product-owner': { tools: 'Read, Grep, Glob, Write, Edit', model: 'sonnet' },
  'dev-lead': { tools: 'Read, Grep, Glob, Bash, Write, Agent', model: 'sonnet' },
  'dev': { tools: 'Read, Write, Edit, Grep, Glob, Bash, WebSearch, WebFetch', model: 'sonnet' },
  'qa-engineer': { tools: 'Read, Write, Edit, Grep, Glob, Bash', model: 'sonnet' },
  'devops-engineer': { tools: 'Read, Write, Edit, Grep, Glob, Bash, WebSearch, WebFetch', model: 'sonnet' },
  'security-engineer': { tools: 'Read, Grep, Glob, Bash, WebSearch, WebFetch', model: 'sonnet' },
  'designer': { tools: 'Read, Grep, Glob, Write, Edit, WebSearch, WebFetch', model: 'sonnet' },
  'support-engineer': { tools: 'Read, Grep, Glob, Bash', model: 'haiku' },
  'tech-writer': { tools: 'Read, Grep, Glob, Write, Edit', model: 'sonnet' },
};
const ROSTER = Object.keys(POLICY).sort();

const parseAgentFile = parseAgentFileShared;

const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort();

describe('agent file structure', () => {
  for (const file of files) {
    const filePath = path.join(agentsDir, file);
    const nameFromFile = file.replace(/\.md$/, '');

    test(`${file}: has exactly the required frontmatter keys`, () => {
      const { frontmatter } = parseAgentFile(filePath);
      for (const required of REQUIRED_KEYS) {
        assert.ok(frontmatter[required], `missing required key: ${required}`);
      }
      for (const key of Object.keys(frontmatter)) {
        assert.ok(REQUIRED_KEYS.has(key), `unexpected frontmatter key: ${key}`);
      }
    });

    test(`${file}: name is kebab-case and matches the filename`, () => {
      const { frontmatter } = parseAgentFile(filePath);
      assert.match(frontmatter.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.equal(frontmatter.name, nameFromFile);
    });

    test(`${file}: description is a non-empty single line under 300 chars`, () => {
      const { frontmatter } = parseAgentFile(filePath);
      assert.ok(frontmatter.description.length > 0);
      assert.ok(frontmatter.description.length <= 300);
    });

    test(`${file}: tools are from the allowed set with no duplicates`, () => {
      const { frontmatter } = parseAgentFile(filePath);
      const tools = frontmatter.tools.split(',').map((t) => t.trim());
      const seen = new Set();
      for (const tool of tools) {
        assert.ok(ALLOWED_TOOLS.has(tool), `unknown tool: ${tool}`);
        assert.ok(!seen.has(tool), `duplicate tool: ${tool}`);
        seen.add(tool);
      }
    });

    test(`${file}: model is a valid tier`, () => {
      const { frontmatter } = parseAgentFile(filePath);
      assert.ok(ALLOWED_MODELS.has(frontmatter.model), `invalid model: ${frontmatter.model}`);
    });

    test(`${file}: body opens in second person`, () => {
      const { body } = parseAgentFile(filePath);
      const firstNonBlankLines = body.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
      assert.ok(
        firstNonBlankLines.some((l) => l.includes('You are the') || l.includes('You are a')),
        'body must open with "You are the ..." or "You are a ..." within the first 3 non-blank lines',
      );
    });

    test(`${file}: body has all required section headings`, () => {
      const { body } = parseAgentFile(filePath);
      for (const heading of REQUIRED_HEADINGS) {
        assert.ok(body.includes(heading), `missing section: ${heading}`);
      }
    });

    test(`${file}: "Hands off to" section names a real roster member`, () => {
      const { body } = parseAgentFile(filePath);
      const start = body.indexOf('## Hands off to');
      const next = body.indexOf('\n## ', start + 1);
      const section = body.slice(start, next === -1 ? undefined : next);
      const mentioned = ROSTER.filter((role) => section.includes(`\`${role}\``));
      assert.ok(mentioned.length > 0, 'must name at least one backticked roster member');
    });
  }
});

describe('roster-wide policy', () => {
  test('exactly the 13-agent roster exists, no more, no less', () => {
    const names = files.map((f) => f.replace(/\.md$/, '')).sort();
    assert.deepEqual(names, ROSTER);
  });

  test('no duplicate agent names', () => {
    const names = files.map((f) => parseAgentFile(path.join(agentsDir, f)).frontmatter.name);
    assert.equal(new Set(names).size, names.length);
  });

  test('tools and model match the locked policy table', () => {
    for (const file of files) {
      const name = file.replace(/\.md$/, '');
      const { frontmatter } = parseAgentFile(path.join(agentsDir, file));
      const policy = POLICY[name];
      assert.ok(policy, `${name} is not in the POLICY table`);
      assert.equal(frontmatter.tools, policy.tools, `${name} tools drifted from policy`);
      assert.equal(frontmatter.model, policy.model, `${name} model drifted from policy`);
    }
  });

  test('Agent tool is granted only to ceo and dev-lead', () => {
    for (const file of files) {
      const name = file.replace(/\.md$/, '');
      const { frontmatter } = parseAgentFile(path.join(agentsDir, file));
      const hasAgentTool = frontmatter.tools.split(',').map((t) => t.trim()).includes('Agent');
      if (name === 'ceo' || name === 'dev-lead') {
        assert.ok(hasAgentTool, `${name} should hold the Agent tool`);
      } else {
        assert.ok(!hasAgentTool, `${name} should not hold the Agent tool`);
      }
    }
  });

  test('cfo, security-engineer, and support-engineer hold no Write/Edit', () => {
    for (const name of ['cfo', 'security-engineer', 'support-engineer']) {
      const { frontmatter } = parseAgentFile(path.join(agentsDir, `${name}.md`));
      const tools = frontmatter.tools.split(',').map((t) => t.trim());
      assert.ok(!tools.includes('Write'), `${name} should not hold Write`);
      assert.ok(!tools.includes('Edit'), `${name} should not hold Edit`);
    }
  });

  test('team-protocol.md exists and mentions every roster member', () => {
    const protocolPath = path.join(repoRoot, 'docs', 'team-protocol.md');
    assert.ok(fs.existsSync(protocolPath), 'docs/team-protocol.md is missing');
    const content = fs.readFileSync(protocolPath, 'utf8');
    for (const role of ROSTER) {
      assert.ok(content.includes(`\`${role}\``), `team-protocol.md never mentions \`${role}\``);
    }
  });

  test('team-protocol.md defines Definition of Done and Autonomous execution', () => {
    const protocolPath = path.join(repoRoot, 'docs', 'team-protocol.md');
    const content = fs.readFileSync(protocolPath, 'utf8');
    assert.ok(content.includes('## Definition of done'), 'missing "## Definition of done" section');
    assert.ok(content.includes('## Autonomous execution'), 'missing "## Autonomous execution" section');
    assert.ok(content.includes('3 times'), 'fix-loop iteration cap is not documented');
  });

  test('ceo and dev-lead are instructed to run autonomously to completion', () => {
    for (const name of ['ceo', 'dev-lead']) {
      const { body } = parseAgentFile(path.join(agentsDir, `${name}.md`));
      assert.ok(body.includes('## Autonomous execution'), `${name} is missing an "## Autonomous execution" section`);
      assert.ok(body.includes('Definition of Done'), `${name} does not reference the Definition of Done`);
    }
  });

  test('dev-lead caps the fix loop at 3 cycles before escalating', () => {
    const { body } = parseAgentFile(path.join(agentsDir, 'dev-lead.md'));
    assert.ok(/\b3\b.*cycle|cap the fix loop at 3/i.test(body), 'dev-lead.md does not document a 3-cycle fix-loop cap');
  });
});

// Opt-in eval tier: would exercise real agent behavior via the Claude Code CLI.
// Off by default since it needs an authenticated `claude` CLI and network access.
// Enable with: RUN_AGENT_EVALS=1 node --test tests/
const RUN_EVALS = process.env.RUN_AGENT_EVALS === '1';

describe('agent behavior evals (opt-in)', { skip: !RUN_EVALS && 'set RUN_AGENT_EVALS=1 to run' }, () => {
  test('placeholder: wire up scenario-based evals here', () => {
    assert.ok(RUN_EVALS);
  });
});
