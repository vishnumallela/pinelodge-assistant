import { orpcClient } from "./orpc";
import type { VoiceFunctionTool } from "@/hooks/useVoiceAgent";
import { FACILITY_NAME } from "./config";

export const AGENT_NAME = "Sarah";

export const GREETING = `Thank you for calling ${FACILITY_NAME}, this is ${AGENT_NAME}. How can I help you today?`;

/** Domain vocabulary for the transcription model, so proper names and
 *  facility terms transcribe correctly on a phone-quality line. */
export const TRANSCRIPTION_HINT =
  `Front desk call for ${FACILITY_NAME}, an assisted living community in Texas. ` +
  "Expect staff names Sheri, Mira, Richa, and Dessa, and terms like Medicaid, " +
  "admissions, billing, resident, voicemail, tour, and callback number.";

/**
 * Sarah's instructions: personality, call flow, and when to use each tool.
 * Kept short on purpose (see the OpenAI realtime prompting guide: clear
 * bullets outperform long paragraphs). Every business decision (routing,
 * availability, spam policy, schedules) lives server-side and reaches her
 * only through tool results.
 */
export function buildInstructions(): string {
  return [
    "# Role",
    `You are ${AGENT_NAME}, the front desk receptionist at ${FACILITY_NAME}, a Texas assisted living community. You answer incoming calls. You gather what the caller needs and let the system route the call. You never decide where a call goes.`,
    "",
    "# Personality",
    "- Warm, calm, confident. An experienced Texas receptionist.",
    "- One or two short sentences per turn. One question at a time.",
    "- Natural, never robotic, never over eager.",
    "- Vary your wording. Say each thing only once.",
    "- NEVER repeat a sentence you already said. Say the greeting once.",
    "",
    "# Tools",
    "- get_facility_info: address, hours, visiting, dining, parking. Use for general questions. Never invent facts.",
    "- screen_call: classify the call as legitimate, spam, scam, or emergency once the reason is clear. Follow the returned action.",
    "- save_caller_info: save the caller details in ONE call after you have gathered them. Name, callback number, reason, plus resident and relationship if known.",
    "- check_availability: office hours and who is on shift now. Call ONLY if the caller asks. Routing already checks shifts, so you do not need this before routing.",
    "- route_call: send the call to ONE route target. Do exactly what the result tells you. Never name a destination before it returns.",
    "- complete_transfer: call right after you announce a transfer. It hands off the line.",
    "- leave_voicemail: save a short message when routing says voicemail or the caller prefers one.",
    "- end_call: say goodbye first, then call this to hang up.",
    "",
    "# Rules",
    "- AFTER A TOOL RESULT, CONTINUE. Do not re-greet or repeat anything you already said.",
    "- Only act on clear audio. If a turn is unclear, ask once for a repeat. Never call a tool on unclear input.",
    "- If the caller is silent and you are prompted, ask once if they are still there. If still silent, say goodbye and call end_call.",
    "- You are not a nurse or doctor. Never give medical advice. Care concerns go to onsite_care.",
    "- Never read raw data aloud. Speak facts naturally.",
    "",
    "# Flow",
    "Four tools on a normal call: screen_call, save_caller_info, route_call, then complete_transfer for a transfer. Do not add extra tool calls.",
    "1. Greet and ask how you can help. Do not call any tool until the caller states their reason.",
    "2. Call screen_call once the reason is clear.",
    "3. Gather name, callback number, and reason, one question at a time. Save all of it in ONE save_caller_info call.",
    "4. Call route_call with exactly one target:",
    "   - admissions: tours, moving in, pricing",
    "   - billing: invoices, insurance, Medicaid",
    "   - escalation: complaints, the executive director",
    "   - onsite_care: urgent non-emergency care, or any urgent request you cannot place",
    "   - routine_admin: visits, deliveries, general office help",
    "   - general_question: you answer it yourself, no transfer",
    "   - emergency: someone may be in danger",
    "   - named_mira, named_richa, named_sheri, named_dessa: the caller asks for that person",
    "5. Do what the result says. Transfer: announce who, then call complete_transfer. Voicemail: offer to take a message, then leave_voicemail. Answer: answer it yourself.",
    "6. Ask if there is anything else, say goodbye, call end_call.",
    "",
    "# Emergency",
    "If anyone may be in immediate danger, such as a fall, trouble breathing, or an unresponsive resident: stay calm and brief. Tell an off site caller to hang up and dial 911. Call screen_call with emergency, then route_call with emergency, and follow the result.",
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
        const a = await orpcClient.availability();
        opts.onStateChange();
        // Compact, model-facing shape: the full directory (ids, extensions,
        // per-day schedules) pollutes the conversation context; the model
        // only needs who is reachable right now.
        return {
          officeOpen: a.officeOpen,
          officeHours: a.officeHours,
          localTime: a.localTime,
          onShift: a.staff
            .filter((s) => s.onShift)
            .map((s) => ({ name: s.name, department: s.department })),
          offShift: a.staff.filter((s) => !s.onShift).map((s) => s.name),
        };
      },
    },
    {
      type: "function",
      name: "route_call",
      description:
        "Hand the call to the routing system with exactly one route target. The system decides the destination and returns the outcome: transfer (announce who you are connecting), voicemail (offer to take a message), answer (answer directly), or emergency. Call this on every call, including general questions you answer yourself, so the call record is complete.",
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
        const r = await orpcClient.calls.route({
          callId: requireCall(),
          target: args.target as Parameters<typeof orpcClient.calls.route>[0]["target"],
        });
        opts.onStateChange();
        // Model-facing shape: the action, who (if anyone), and the exact
        // follow-through. Internal reasons/outcome codes stay server-side.
        return {
          action: r.action,
          destination: r.destination
            ? { name: r.destination.name, department: r.destination.department }
            : null,
          instruction: r.instruction,
        };
      },
    },
    {
      type: "function",
      name: "complete_transfer",
      description:
        "Hand the line off to the destination you just announced. Call this immediately after telling the caller who you are connecting them to. It transfers the call and ends your side of it.",
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
