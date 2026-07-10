import type { VoiceFunctionTool } from "@/hooks/useVoiceAgent";

export const AGENT_NAME = "Sarah";

/** Openers shown as suggestion chips in the console. */
export const CALLER_PROMPTS = [
  "I'd like to schedule a tour for my mother.",
  "I have a question about my father's invoice.",
  "Can I speak with Mira, please?",
  "My mom fell and she's not responding.",
];

/** Appended to the rendered prompt on console calls. There is no dial leg to
 *  move, but transfer_call briefs the named staff member by email while the
 *  redirect is announced — so it must be called, not just spoken about. */
export const CONSOLE_TRANSFER_APPENDIX = [
  "Console transfer:",
  '1. FIRST say the redirect line out loud, naming the person and section, and say goodbye, e.g. "I\'m redirecting you to Mira in Billing now. Thanks for calling, goodbye!"',
  '2. ONLY AFTER saying that line, call transfer_call with the person\'s exact name from the directory, e.g. {"name": "Mira"}. Say nothing after calling it — the call ends by itself.',
  "3. If transfer_call returns an error, apologize, say the front office will call them back shortly, then say goodbye and call end_call.",
  "When the caller asks for a department, service, or topic instead of a person, pick the one available person from the directory who handles it and transfer to them by name the same way.",
  "Announcing a redirect ALWAYS ends with transfer_call, never end_call — even if an earlier instruction says otherwise. Call end_call directly only when you are not redirecting the caller to anyone.",
].join("\n");

export interface TransferResult {
  ok: boolean;
  connecting?: string;
  error?: string;
}

/** The prompt itself lives server-side (see the Prompt editor); the client
 *  contributes the end_call and transfer_call tools. */
export function buildReceptionistTools(opts: {
  onEndCall: () => void;
  onTransfer: (name: string) => Promise<TransferResult>;
}): VoiceFunctionTool[] {
  return [
    {
      type: "function",
      name: "transfer_call",
      description:
        "Redirect the caller to a staff member and brief them about the call. Call this right after you announce the redirect and say goodbye.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Exact name of the staff member from the directory",
          },
        },
        required: ["name"],
      },
      handler: async (args) => {
        const name = typeof args.name === "string" ? args.name : "";
        if (!name) return { error: "Provide the staff member's name." };
        return opts.onTransfer(name);
      },
    },
    {
      type: "function",
      name: "end_call",
      description:
        "Hang up without transferring. Use only when there is no one to redirect the caller to, after saying goodbye.",
      parameters: { type: "object", properties: {}, required: [] },
      suppressResponse: true,
      handler: () => {
        opts.onEndCall();
        return { ok: true };
      },
    },
  ];
}
