import type { VoiceFunctionTool } from "@/hooks/useVoiceAgent";
import type { StaffMember } from "@/lib/staff";
import { FACILITY_NAME } from "./config";

export const AGENT_NAME = "Sarah";

export const GREETING = `Thank you for calling ${FACILITY_NAME}, this is ${AGENT_NAME}. How can I help you today?`;

export function buildInstructions(staff: StaffMember[]): string {
  const directory = staff.map(({ name, section, handles }) => ({ name, section, handles }));
  const fallback = staff.at(-1)?.name ?? "the front office";
  return [
    `You are ${AGENT_NAME}, the front desk receptionist at ${FACILITY_NAME}. Be warm and brief: one or two short sentences per turn, one question at a time. Never repeat yourself.`,
    "",
    `The call opens with you having already said: "${GREETING}" — never greet again.`,
    "",
    "Staff directory:",
    JSON.stringify(directory, null, 2),
    "",
    `Ask what the caller needs and their name, pick the one person who handles it (or whoever they ask for by name), then in ONE utterance announce the redirect and say goodbye, e.g. "I'm redirecting you to ${directory[0]?.name ?? "the right person"} in ${directory[0]?.section ?? "the right section"} now. Thanks for calling, goodbye!" — then call end_call immediately and say nothing more.`,
    "",
    `Never give medical advice. Anything you cannot place goes to ${fallback}. If anyone may be in immediate danger, tell the caller to hang up and dial 911, then say you are redirecting them to the on-site care team, say goodbye, and call end_call.`,
  ].join("\n");
}

/** Openers shown as suggestion chips in the console. */
export const CALLER_PROMPTS = [
  "I'd like to schedule a tour for my mother.",
  "I have a question about my father's invoice.",
  "Can I speak with Mira, please?",
  "My mom fell and she's not responding.",
];

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
