import fs from 'node:fs';
import path from 'node:path';

export const ALLOWED_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch', 'Agent',
]);
export const ALLOWED_MODELS = new Set(['opus', 'sonnet', 'haiku']);

function hasBom(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return true;
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return true;
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return true;
  return false;
}

// Parses the .claude/agents/*.md format: a `---`-delimited frontmatter block
// of single-line `key: value` pairs, followed by a plain-text body. Shared
// between tests/agents.test.mjs (validation) and the runtime (loading a
// role's prompt/tools/model to actually run it) so there is exactly one
// place that understands the file format.
export function parseAgentFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (hasBom(buffer)) {
    throw new Error(`${filePath} has a byte-order mark; save as plain UTF-8 without BOM`);
  }

  const lines = buffer.toString('utf8').split(/\r?\n/);
  if (lines[0] !== '---') {
    throw new Error(`${filePath} must start with a --- frontmatter delimiter`);
  }
  const closeIndex = lines.indexOf('---', 1);
  if (closeIndex === -1) {
    throw new Error(`${filePath} frontmatter must be closed with a --- delimiter`);
  }

  const frontmatter = {};
  for (const line of lines.slice(1, closeIndex)) {
    if (!/^[a-z]+: .+$/.test(line)) {
      throw new Error(`${filePath} has a malformed frontmatter line: ${JSON.stringify(line)}`);
    }
    const separator = line.indexOf(': ');
    frontmatter[line.slice(0, separator)] = line.slice(separator + 2);
  }

  const body = lines.slice(closeIndex + 1).join('\n');
  return { frontmatter, body };
}

export function listAgentFiles(agentsDir) {
  return fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort();
}

// Loads one role: name, system prompt (the body), the tool list, and the
// model tier ('opus' | 'sonnet' | 'haiku') exactly as declared in its
// frontmatter — the runtime trusts what tests/agents.test.mjs already
// validated, it doesn't re-validate.
export function loadAgent(agentsDir, name) {
  const { frontmatter, body } = parseAgentFile(path.join(agentsDir, `${name}.md`));
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    tools: frontmatter.tools.split(',').map((t) => t.trim()),
    model: frontmatter.model,
    systemPrompt: body.trim(),
  };
}
