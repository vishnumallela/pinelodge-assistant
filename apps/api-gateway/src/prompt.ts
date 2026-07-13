import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { getCenter, isAfterHours } from "./centers";
import { centerSettings, type CenterRow } from "./schema";
import { listStaff, type StaffWithAvailability } from "./staff";

/**
 * The agent prompt is a template with placeholders, stored per center so each
 * location can tune its receptionist live from the prompt editor. Rendering
 * injects that center's staff directory (with availability computed at that
 * moment in the center's timezone) and the fallback destination.
 *
 * Placeholders: {{greeting}} {{staff_directory}} {{unavailable}} {{fallback}}
 */

export function defaultGreeting(centerName: string): string {
  return `Thank you for calling ${centerName}, this is Sarah. How can I help you today?`;
}

export function defaultTemplate(centerName: string): string {
  return [
    `You are Sarah, the front desk receptionist at ${centerName}. Be warm and brief: one or two short sentences per turn, one question at a time. Never repeat yourself.`,
    "",
    `The call opens with you having already said: "{{greeting}}" — never greet again.`,
    "",
    "Staff available right now:",
    "{{staff_directory}}",
    "",
    "Unavailable at the moment: {{unavailable}}. If a caller asks for someone unavailable, or you cannot place the request, redirect to {{fallback}}.",
    "",
    `Ask what the caller needs and their name, pick the one available person who handles it (or whoever they ask for by name, if available), then in ONE utterance announce the redirect and say goodbye, e.g. "I'm redirecting you to {{fallback}} now. Thanks for calling, goodbye!" — then follow the transfer steps below. Once you have told a caller you are redirecting them, never just hang up on them.`,
    "",
    "Never give medical advice. If anyone may be in immediate danger, tell the caller to hang up and dial 911, then announce a redirect to the on-site care team, say goodbye, and follow the transfer steps below.",
  ].join("\n");
}

export function defaultAfterHoursGreeting(centerName: string): string {
  return `Thank you for calling ${centerName}, this is Sarah. Our staff has left for the day and will reach out first thing tomorrow morning — may I take a message?`;
}

/** Message-only mode: after the cutoff nobody is dialed. Sarah collects a
 *  message that lands on the Messages page for morning triage. */
function messageModePrompt(centerName: string, greeting: string): string {
  return [
    `You are Sarah, the front desk receptionist at ${centerName}, taking after-hours messages. The staff has left for the day. Be warm and brief: one or two short sentences per turn, one question at a time. Never repeat yourself.`,
    "",
    `The call opens with you having already said: "${greeting}" — never greet again.`,
    "",
    "Collect three things, one at a time: the caller's name, the best callback number, and what the call is about. Confirm the callback number by reading it back once.",
    "Then tell them the team will reach out first thing tomorrow morning, say goodbye, and call end_call. Say nothing after calling it.",
    "Never offer to transfer or connect the caller to anyone — nobody is available. Never give medical advice. If anyone may be in immediate danger, tell the caller to hang up and dial 911 first, then take the message.",
  ].join("\n");
}

/** Appended to the rendered prompt on real phone calls, where the redirect
 *  is an actual transfer instead of an announcement. */
export const PHONE_TRANSFER_APPENDIX = [
  "This caller is on a real phone line and you can actually connect them. Transfers follow this exact order, never any other:",
  '1. FIRST say the redirect line out loud, naming the person and section, e.g. "I\'m redirecting you to Mira in Billing now. Thanks for calling, goodbye!"',
  '2. ONLY AFTER saying that line, call transfer_call with the person\'s exact name from the directory, e.g. {"name": "Mira"}. Never call transfer_call before you have said the redirect line. Say nothing after calling it.',
  "3. If transfer_call returns an error, apologize, say the front office will call them back shortly, then say goodbye and call end_call.",
  "When the caller asks for a department, service, or topic instead of a person, pick the one available person from the directory who handles it and transfer to them by name the same way.",
  "Announcing a redirect ALWAYS ends with transfer_call, never end_call — even if an earlier instruction says otherwise. Use end_call only when there is nothing to transfer (wrong number, caller done, silence).",
].join("\n");

async function getSetting<T>(centerId: string, key: string, fallback: T): Promise<T> {
  const [row] = await db
    .select()
    .from(centerSettings)
    .where(and(eq(centerSettings.centerId, centerId), eq(centerSettings.key, key)))
    .limit(1);
  return row ? (row.value as T) : fallback;
}

async function putSetting(centerId: string, key: string, value: unknown): Promise<void> {
  await db
    .insert(centerSettings)
    .values({ centerId, key, value })
    .onConflictDoUpdate({ target: [centerSettings.centerId, centerSettings.key], set: { value } });
}

function getTemplate(center: CenterRow): Promise<string> {
  return getSetting(center.id, "prompt_template", defaultTemplate(center.name));
}

function getGreeting(center: CenterRow): Promise<string> {
  return getSetting(center.id, "greeting", defaultGreeting(center.name));
}

export async function saveTemplate(
  centerId: string,
  template: string,
  greeting: string,
): Promise<void> {
  await putSetting(centerId, "prompt_template", template);
  await putSetting(centerId, "greeting", greeting);
}

function renderPrompt(
  template: string,
  greeting: string,
  staffRows: StaffWithAvailability[],
): string {
  const available = staffRows.filter((s) => s.availableNow);
  const unavailable = staffRows.filter((s) => s.active && !s.availableNow);
  const fallback = staffRows.find((s) => s.isFallback && s.active);
  const fallbackLabel = fallback ? `${fallback.name} in ${fallback.section}` : "the front office";

  const directory =
    available.length > 0
      ? JSON.stringify(
          available.map(({ name, section, handles }) => ({ name, section, handles })),
          null,
          2,
        )
      : `(nobody is on shift — take a message and redirect everything to ${fallbackLabel})`;

  return template
    .replaceAll("{{greeting}}", greeting)
    .replaceAll("{{staff_directory}}", directory)
    .replaceAll("{{unavailable}}", unavailable.map((s) => s.name).join(", ") || "nobody")
    .replaceAll("{{fallback}}", fallbackLabel);
}

export interface AgentPrompt {
  prompt: string;
  template: string;
  greeting: string;
  staff: StaffWithAvailability[];
  center: CenterRow;
  /** "message" after the center's cutoff — no transfers, take a message. */
  mode: "standard" | "message";
}

/** Everything the console, the phone bridge, and the prompt editor need for
 *  one center, in one shot. Null when the center does not exist. After the
 *  center's cutoff the prompt switches to message-only mode. */
export async function getAgentPrompt(centerId: string): Promise<AgentPrompt | null> {
  const center = await getCenter(centerId);
  if (!center) return null;
  const [template, greeting, staffRows] = await Promise.all([
    getTemplate(center),
    getGreeting(center),
    listStaff(center),
  ]);
  if (isAfterHours(center)) {
    const nightGreeting = center.afterHoursGreeting || defaultAfterHoursGreeting(center.name);
    return {
      prompt: messageModePrompt(center.name, nightGreeting),
      template,
      greeting: nightGreeting,
      staff: staffRows,
      center,
      mode: "message",
    };
  }
  return {
    prompt: renderPrompt(template, greeting, staffRows),
    template,
    greeting,
    staff: staffRows,
    center,
    mode: "standard",
  };
}
