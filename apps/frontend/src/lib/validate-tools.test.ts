import { describe, expect, it } from "vitest";
import type { VoiceFunctionTool } from "@/hooks/useVoiceAgent";
import { buildReceptionistTools } from "@/lib/receptionist-agent";
import { validateTools } from "@/lib/validate-tools";

const noop = (): void => undefined;
const tools = buildReceptionistTools({ onEndCall: noop });

describe("agent tool hygiene", () => {
  it("the receptionist tool set passes hygiene checks", () => {
    expect(validateTools(tools)).toEqual([]);
  });

  // Locks the toolset: any add/remove/rename shows up here so it's a conscious,
  // reviewed change — the guard against silent tool drift (e.g. a name collision).
  it("locks the receptionist tool inventory", () => {
    expect(tools.map((t) => t.name).toSorted()).toEqual(["end_call"]);
  });

  it("flags a malformed tool set", () => {
    const bad: VoiceFunctionTool[] = [
      { type: "function", name: "Bad Name", description: "x", parameters: {} },
    ];
    expect(validateTools(bad).length).toBeGreaterThan(0);
  });
});
