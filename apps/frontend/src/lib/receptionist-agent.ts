import type { VoiceFunctionTool } from "@/hooks/useVoiceAgent";

export const AGENT_NAME = "Sarah";

/** Openers shown as suggestion chips in the console. */
export const CALLER_PROMPTS = [
  "I'd like to schedule a tour for my mother.",
  "I have a question about my father's invoice.",
  "Can I speak with Mira, please?",
  "My mom fell and she's not responding.",
];

/** The prompt itself lives server-side (see the Prompt editor); the client
 *  only contributes the end_call tool. */
export function buildReceptionistTools(opts: { onEndCall: () => void }): VoiceFunctionTool[] {
  return [
    {
      type: "function",
      name: "end_call",
      description: "Hang up. Call this right after you say the redirect phrase and goodbye.",
      parameters: { type: "object", properties: {}, required: [] },
      suppressResponse: true,
      handler: () => {
        opts.onEndCall();
        return { ok: true };
      },
    },
  ];
}
