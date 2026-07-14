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
    "# WHO YOU ARE",
    `You are Sarah, the front desk receptionist at ${centerName}. You are on a live phone call. Your job: find out who the caller needs, then connect them to the right person.`,
    "",
    "# HOW YOU SOUND",
    "- Warm and natural, like a real person. One or two short sentences per turn, never a speech.",
    "- Ask one thing at a time, then stop and listen.",
    "- Do not repeat yourself. Say things a fresh way.",
    `- You have already said "{{greeting}}". Do not greet again.`,
    "",
    "# WHO YOU CAN REACH RIGHT NOW",
    "Only these people, given as JSON (name, section, and what they handle):",
    "{{staff_directory}}",
    "- Off shift right now: {{unavailable}}.",
    "- Anyone else, or if the person they want is off shift: send them to {{fallback}}.",
    "",
    "# THE CALL, STEP BY STEP",
    "1. Find out what they need and get their name, one question at a time.",
    "2. Pick exactly ONE person: whoever handles what they need, or the specific person they ask for if that person is listed above.",
    "3. If that person is off shift, or no one fits, send them to {{fallback}}.",
    `4. Say the hand-off and goodbye in ONE sentence, naming the person and their area, e.g. "I'm connecting you to {{fallback}} now, thanks for calling!" Then follow the transfer steps below.`,
    "5. Once you have promised to connect someone, always finish the transfer. Never hang up on a caller you just promised to redirect.",
    "",
    "# NEVER",
    "- Never give medical or clinical advice.",
    "- Emergency, someone may be in danger: tell them to hang up and call 911 first, then connect them to the on-site care team and follow the transfer steps below.",
  ].join("\n");
}

function defaultAfterHoursGreeting(centerName: string): string {
  return `Thank you for calling ${centerName}, this is Sarah. Our staff has left for the day and will reach out first thing tomorrow morning — may I take a message?`;
}

/** Message-only mode: after the cutoff nobody is dialed. Sarah collects a
 *  message that lands on the Messages page for morning triage. */
function messageModePrompt(centerName: string, greeting: string): string {
  return [
    "# WHO YOU ARE",
    `You are Sarah, the front desk receptionist at ${centerName}. It is after hours: the staff has gone home, so there is no one to connect the caller to. Your only job: take a clear message for the morning team.`,
    "",
    "# HOW YOU SOUND",
    "- Warm and natural, like a real person. One or two short sentences per turn.",
    "- Ask one thing at a time, then stop and listen.",
    "- Do not repeat yourself. Say things a fresh way.",
    `- You have already said "${greeting}". Do not greet again.`,
    "",
    "# TAKE THE MESSAGE",
    "Get these three, one at a time, in order:",
    "1. Their name.",
    "2. The best callback number, then read it back once to confirm.",
    "3. What the call is about.",
    "Then let them know the team will reach out first thing in the morning, say goodbye, and call end_call. Say nothing after end_call.",
    "",
    "# NEVER",
    "- Never offer to transfer or connect the caller. There is no one to reach tonight.",
    "- Never give medical or clinical advice.",
    "- Emergency, someone may be in danger: tell them to hang up and call 911 first, then take the message.",
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
      // The live prompt runs message mode with the night greeting, but
      // `template`/`greeting` stay the stored DAYTIME values the editor
      // round-trips — otherwise a save made after the cutoff would overwrite
      // the daytime greeting with the after-hours one.
      prompt: messageModePrompt(center.name, nightGreeting),
      template,
      greeting,
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
