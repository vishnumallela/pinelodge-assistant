import type { VoiceFunctionTool } from "@/hooks/useVoiceAgent";

type Schema = { type?: string; properties?: Record<string, unknown>; required?: string[] };

// Static hygiene checks for an agent's tool set — catches duplicate names, weak
// descriptions, and malformed parameter schemas before they ever reach the model.
// Returns a list of human-readable problems; an empty list means the set is clean.
export function validateTools(tools: VoiceFunctionTool[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of tools) {
    if (!/^[a-z][a-z0-9_]*$/.test(t.name)) problems.push(`invalid tool name: "${t.name}"`);
    if (seen.has(t.name)) problems.push(`duplicate tool name: "${t.name}"`);
    seen.add(t.name);
    if (!t.description || t.description.trim().length < 10) {
      problems.push(`${t.name}: description is missing or too short`);
    }
    const p = t.parameters as Schema;
    if (!p || p.type !== "object" || typeof p.properties !== "object" || p.properties === null) {
      problems.push(`${t.name}: parameters must be a JSON-schema object`);
      continue;
    }
    for (const req of p.required ?? []) {
      if (!(req in p.properties)) {
        problems.push(`${t.name}: required param "${req}" is not in properties`);
      }
    }
  }
  return problems;
}
