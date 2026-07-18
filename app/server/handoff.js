// Parses the `HANDOFF → <agent-name>: <task> | Area: <domain> | Severity: <level> | Inputs: <context>`
// line every role's reply ends with (see docs/team-protocol.md § Mechanics).
// Area/Severity/Inputs are optional `| Key: value` tags; they may appear in
// any order (canonical order is Area, Severity, then Inputs, but the parser
// doesn't require it — a model that emits fields out of order shouldn't fail
// the whole parse). Tolerates a plain "->" in place of the unicode arrow and
// backticks around the name.
const HEAD_RE = /HANDOFF\s*(?:→|->)\s*`?([a-z][a-z0-9-]*)`?\s*:\s*([^\n|]+?)\s*((?:\|[^\n]*)?)$/im;
const TAG_RE = /^\s*(Area|Severity|Inputs)\s*:\s*(.*)$/i;

export function parseHandoff(text) {
  const match = HEAD_RE.exec(text);
  if (!match) return null;

  const result = { role: match[1].trim(), task: match[2].trim(), area: '', severity: '', inputs: '' };
  const tagSegments = match[3] ? match[3].split('|').map((s) => s.trim()).filter(Boolean) : [];
  for (const segment of tagSegments) {
    const tagMatch = TAG_RE.exec(segment);
    if (!tagMatch) continue;
    const key = tagMatch[1].toLowerCase();
    const value = tagMatch[2].trim();
    if (key === 'area') result.area = value.toLowerCase();
    else if (key === 'severity') result.severity = value.toLowerCase();
    else if (key === 'inputs') result.inputs = value;
  }
  return result;
}
