import { describe, expect, it } from "vitest";
import type { VoiceFunctionTool } from "@/hooks/useVoiceAgent";
import { buildReceptionistTools } from "@/lib/receptionist-agent";
import { validateTools } from "@/lib/validate-tools";

const noop = (): void => undefined;
const tools = buildReceptionistTools({
  getCallId: () => "test-call",
  onStateChange: noop,
  onEndCall: noop,
});

describe("agent tool hygiene", () => {
  it("the receptionist tool set passes hygiene checks", () => {
    expect(validateTools(tools)).toEqual([]);
  });

  // Locks the toolset: any add/remove/rename shows up here so it's a conscious,
  // reviewed change — the guard against silent tool drift (e.g. a name collision).
  it("locks the receptionist tool inventory", () => {
    expect(tools.map((t) => t.name).toSorted()).toEqual([
      "check_availability",
      "complete_transfer",
      "end_call",
      "get_facility_info",
      "leave_voicemail",
      "route_call",
      "save_caller_info",
      "screen_call",
    ]);
  });

  it("flags a malformed tool set", () => {
    const bad: VoiceFunctionTool[] = [
      { type: "function", name: "Bad Name", description: "x", parameters: {} },
    ];
    expect(validateTools(bad).length).toBeGreaterThan(0);
  });
});
