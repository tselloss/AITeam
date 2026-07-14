// Parses the `HANDOFF → <agent-name>: <task> | Inputs: <context>` line every
// role's reply ends with (see docs/team-protocol.md § Mechanics). Tolerates
// a plain "->" in place of the unicode arrow and backticks around the name.
const HANDOFF_RE = /HANDOFF\s*(?:→|->)\s*`?([a-z][a-z0-9-]*)`?\s*:\s*([^\n|]+?)(?:\s*\|\s*Inputs\s*:\s*([^\n]*))?\s*$/im;

export function parseHandoff(text) {
  const match = HANDOFF_RE.exec(text);
  if (!match) return null;
  return {
    role: match[1].trim(),
    task: match[2].trim(),
    inputs: match[3] ? match[3].trim() : '',
  };
}
