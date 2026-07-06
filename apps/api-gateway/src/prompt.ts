import { eq } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import { settings } from "./schema";
import { listStaff, type StaffWithAvailability } from "./staff";

/**
 * The agent prompt is a template with placeholders, stored in settings so it
 * can be tuned live from the prompt editor. Rendering injects the current
 * staff directory (with availability computed at that moment) and the
 * fallback destination.
 *
 * Placeholders: {{greeting}} {{staff_directory}} {{unavailable}} {{fallback}}
 */

export const DEFAULT_GREETING = `Thank you for calling ${env.FACILITY_NAME}, this is Sarah. How can I help you today?`;

export const DEFAULT_TEMPLATE = [
  `You are Sarah, the front desk receptionist at ${env.FACILITY_NAME}. Be warm and brief: one or two short sentences per turn, one question at a time. Never repeat yourself.`,
  "",
  `The call opens with you having already said: "{{greeting}}" — never greet again.`,
  "",
  "Staff available right now:",
  "{{staff_directory}}",
  "",
  "Unavailable at the moment: {{unavailable}}. If a caller asks for someone unavailable, or you cannot place the request, redirect to {{fallback}}.",
  "",
  `Ask what the caller needs and their name, pick the one available person who handles it (or whoever they ask for by name, if available), then in ONE utterance announce the redirect and say goodbye, e.g. "I'm redirecting you to {{fallback}} now. Thanks for calling, goodbye!" — then call end_call immediately and say nothing more.`,
  "",
  "Never give medical advice. If anyone may be in immediate danger, tell the caller to hang up and dial 911, then say you are redirecting them to the on-site care team, say goodbye, and call end_call.",
].join("\n");

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row ? (row.value as T) : fallback;
}

async function putSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export function getTemplate(): Promise<string> {
  return getSetting("prompt_template", DEFAULT_TEMPLATE);
}

export function getGreeting(): Promise<string> {
  return getSetting("greeting", DEFAULT_GREETING);
}

export async function saveTemplate(template: string, greeting: string): Promise<void> {
  await putSetting("prompt_template", template);
  await putSetting("greeting", greeting);
}

export function renderPrompt(
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
}

/** Everything the console and the prompt editor need, in one shot. */
export async function getAgentPrompt(): Promise<AgentPrompt> {
  const [template, greeting, staffRows] = await Promise.all([
    getTemplate(),
    getGreeting(),
    listStaff(),
  ]);
  return {
    prompt: renderPrompt(template, greeting, staffRows),
    template,
    greeting,
    staff: staffRows,
  };
}
