import { orpcClient } from "./orpc";
import type { VoiceFunctionTool } from "@/hooks/useVoiceAgent";
import { FACILITY_NAME } from "./config";

export const AGENT_NAME = "Sarah";

export const GREETING = `Thank you for calling ${FACILITY_NAME}, this is ${AGENT_NAME}. How can I help you today?`;

/**
 * Sarah's instructions are purely conversational: personality, call flow, and
 * when to use each tool. Every business decision — routing, availability,
 * spam policy, schedules — lives server-side and reaches her only through
 * tool results.
 */
export function buildInstructions(): string {
  return [
    "# Role & Objective",
    `You are ${AGENT_NAME}, the front-desk receptionist for ${FACILITY_NAME}, a licensed assisted living community in Texas, answering an incoming phone call. On every call you greet the caller, understand why they are calling, gather their details, and let the phone system route the call. The system decides where calls go — never you.`,
    "",
    "# Personality & Tone",
    "- An experienced Texas assisted-living receptionist: warm, calm, confident, professional.",
    "- Concise. One or two short sentences per turn, one question at a time.",
    "- Natural and human. Never robotic, never overly enthusiastic, never verbose.",
    "- Vary your acknowledgements; do not repeat the caller's name more than once or twice.",
    "",
    "# Tools",
    "- get_facility_info: facts about the community (address, hours, visiting, dining, parking). Use it for general questions; never invent facility details.",
    "- screen_call: classify the call once its nature is clear: legitimate, spam, scam, or emergency. Then follow the returned action exactly — continue; decline_and_end (politely decline, say goodbye, end_call); emergency (switch to the emergency steps).",
    "- save_caller_info: after you have gathered the caller's details in conversation, save them in one call — name, callback number, reason, plus resident, relationship, callback time, urgency, or requested staff if learned. One save per call unless new information surfaces later.",
    "- check_availability: office hours and who is on shift right now. Call it before routing so you can set expectations naturally.",
    "- route_call: once you have the required details, call this with exactly one route target. The system routes the call and returns what happened plus the exact follow-through — do what it says. Never promise a destination before the tool returns.",
    "- complete_transfer: after you announce a transfer, call this immediately to hand the line off. It ends your side of the call.",
    "- leave_voicemail: when routing says voicemail, or the caller prefers it, take down a short message and save it.",
    "- end_call: say goodbye first, then call this to hang up.",
    "",
    "# Conversation flow (every call)",
    "Never call tools before the caller has told you why they are calling. The greeting is just a greeting.",
    "1. Greet the caller and ask how you can help.",
    "2. Screen: call screen_call as soon as the caller's purpose is clear.",
    "3. Collect: caller name, callback number, and reason for calling are required before routing whenever reasonably possible. Resident name, relationship, and preferred callback time when relevant. Weave questions in naturally — never fire several at once. Gather everything first, then save once with save_caller_info.",
    "4. Check availability with check_availability.",
    "5. Classify: once the caller's need is clear, pick exactly one route target and call route_call. For a pure question you will answer yourself, use target general_question at the moment you answer it.",
    "   - admissions: tours, moving in, pricing questions.",
    "   - billing: invoices, insurance, Medicaid.",
    "   - escalation: complaints, or asking for the executive director.",
    "   - onsite_care: urgent but non-emergency care for a resident, or an urgent request you cannot otherwise place.",
    "   - routine_admin: visit arrangements, deliveries, general office help.",
    "   - general_question: you answer directly from get_facility_info; no transfer.",
    "   - emergency: someone may be in immediate danger.",
    "   - named_mira / named_richa / named_sheri / named_dessa: the caller asks for that person by name.",
    "6. Relay the result: for a transfer, say who you are connecting them to, then immediately call complete_transfer — that hands the line off and ends your side; for voicemail, offer to take a message and use leave_voicemail; for answer, answer the question yourself.",
    "7. Wrap up: recap anything you took down, ask if there is anything else, say goodbye, then end_call.",
    "",
    "# Emergency",
    "If anyone may be in immediate danger — a medical emergency, a fall with injury, trouble breathing, an unresponsive resident — stay calm and brief. Tell an off-site caller to hang up and dial 911. Call screen_call with emergency, then route_call with emergency, and follow what they return.",
    "",
    "# Unclear audio",
    "Only act on clear audio. If a turn is unclear, partial, or noisy, ask once for a repeat. Do not guess and do not call tools on unclear input.",
    "",
    "# Boundaries",
    "- You are not a nurse or doctor. Never give medical advice; care concerns route to nursing.",
    "- Never invent schedules, availability, staff names, or facility facts — everything comes from tools.",
    "- Phrase tool results naturally; never read raw data aloud.",
    "- This is a phone call: keep everything short and easy to follow by ear.",
  ].join("\n");
}

/** Simulated caller openers shown as suggestions in the console. */
export const CALLER_PROMPTS = [
  "I'd like to schedule a tour for my mother.",
  "I have a question about my father's invoice.",
  "Can I speak with Mira, please?",
  "What are your visiting hours?",
  "My mom fell and she's not responding.",
];

export interface ReceptionistToolOptions {
  /** The active call's id; tools are inert until a call exists. */
  getCallId: () => string | null;
  /** Invoked after any tool persists state, so the console can refresh. */
  onStateChange: () => void;
  /** Request a hangup once the assistant finishes speaking (never mid-word). */
  onEndCall: () => void;
}

export function buildReceptionistTools(opts: ReceptionistToolOptions): VoiceFunctionTool[] {
  const requireCall = (): string => {
    const id = opts.getCallId();
    if (!id) throw new Error("No active call.");
    return id;
  };

  return [
    {
      type: "function",
      name: "get_facility_info",
      description:
        "Facts about the community: name, address, phone, office hours, visiting hours, care, dining and parking. Use for general questions instead of guessing.",
      parameters: { type: "object", properties: {}, required: [] },
      handler: () => orpcClient.facility.info(),
    },
    {
      type: "function",
      name: "screen_call",
      description:
        "Classify the call once its nature is clear: legitimate, spam, scam, or emergency. Returns the action to take; follow it exactly.",
      parameters: {
        type: "object",
        properties: {
          classification: {
            type: "string",
            enum: ["legitimate", "spam", "scam", "emergency"],
            description: "Exactly one classification for this call",
          },
        },
        required: ["classification"],
      },
      handler: async (args) => {
        const result = await orpcClient.calls.screen({
          callId: requireCall(),
          classification: args.classification as "legitimate" | "spam" | "scam" | "emergency",
        });
        opts.onStateChange();
        return result;
      },
    },
    {
      type: "function",
      name: "save_caller_info",
      description:
        "Persist the caller's details in ONE call after you have gathered them in conversation: name, callback number, and reason together (plus resident, relationship, and anything else you learned). Do not call this per fragment. Call it again only if genuinely new information surfaces later.",
      parameters: {
        type: "object",
        properties: {
          callerName: { type: "string", description: "The caller's name" },
          callerPhone: { type: "string", description: "Callback number" },
          reason: { type: "string", description: "Short reason for calling" },
          residentName: { type: "string", description: "Resident the call concerns, if any" },
          relationship: { type: "string", description: "Caller's relationship to the resident" },
          callbackTime: { type: "string", description: "Preferred callback time, if given" },
          urgency: {
            type: "string",
            enum: ["low", "normal", "urgent"],
            description: "How urgent the request sounds",
          },
          requestedStaff: { type: "string", description: "Staff member asked for by name" },
        },
        required: [],
      },
      handler: async (args) => {
        const result = await orpcClient.calls.saveCallerInfo({
          callId: requireCall(),
          ...(args as Record<string, string | undefined>),
        });
        opts.onStateChange();
        return result;
      },
    },
    {
      type: "function",
      name: "check_availability",
      description:
        "Office hours, staff schedules, and who is on shift right now. Call before routing so expectations you set match reality.",
      parameters: { type: "object", properties: {}, required: [] },
      handler: async () => {
        const result = await orpcClient.availability();
        opts.onStateChange();
        return result;
      },
    },
    {
      type: "function",
      name: "route_call",
      description:
        "Hand the call to the routing system with exactly one route target. The system decides the destination and returns the outcome: transfer (announce who you are connecting), voicemail (offer to take a message), answer (answer directly), or emergency. Call this on every call — including general questions you answer yourself — so the call record is complete.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: [
              "admissions",
              "billing",
              "escalation",
              "onsite_care",
              "routine_admin",
              "general_question",
              "emergency",
              "named_mira",
              "named_richa",
              "named_sheri",
              "named_dessa",
            ],
            description: "Exactly one route target for this call",
          },
        },
        required: ["target"],
      },
      handler: async (args) => {
        const result = await orpcClient.calls.route({
          callId: requireCall(),
          target: args.target as Parameters<typeof orpcClient.calls.route>[0]["target"],
        });
        opts.onStateChange();
        return result;
      },
    },
    {
      type: "function",
      name: "complete_transfer",
      description:
        "Hand the line off to the destination you just announced. Call this immediately after telling the caller who you are connecting them to — it transfers the call and ends your side of it.",
      parameters: { type: "object", properties: {}, required: [] },
      handler: async () => {
        const result = await orpcClient.calls.handoff({ callId: requireCall() });
        opts.onStateChange();
        opts.onEndCall();
        return result;
      },
    },
    {
      type: "function",
      name: "leave_voicemail",
      description:
        "Save the caller's message after routing said voicemail (or they asked to leave one). Confirm the gist back to the caller before saving.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message, including who it is for and any callback details",
          },
        },
        required: ["message"],
      },
      handler: async (args) => {
        const result = await orpcClient.calls.voicemail({
          callId: requireCall(),
          message: String(args.message),
        });
        opts.onStateChange();
        return result;
      },
    },
    {
      type: "function",
      name: "end_call",
      description: "Hang up. Say goodbye to the caller BEFORE calling this.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description:
              "One short phrase for the log, e.g. 'transfer complete' or 'spam declined'",
          },
        },
        required: [],
      },
      handler: () => {
        opts.onEndCall();
        return { ok: true };
      },
    },
  ];
}
