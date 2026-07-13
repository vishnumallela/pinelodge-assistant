import { eq, inArray, notInArray } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import { appSettings } from "./schema";

/**
 * Application config, editable live from the dashboard's Settings page.
 * Every value resolves DB row → env var → built-in default, so existing
 * env-configured deployments keep working untouched and a dashboard edit
 * applies to the next call without a redeploy. Infrastructure config
 * (database, Redis, ports, auth service, admin allowlist) intentionally
 * stays env-only — the app cannot boot from a database it cannot reach.
 */

export interface AppConfig {
  xaiApiKey: string;
  grokRealtimeModel: string;
  grokRealtimeVoice: string;
  xaiSummaryModel: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpAuthMethod: "login" | "plain";
  emailFrom: string;
  appUrl: string;
}

type ConfigKey = keyof AppConfig;

export interface ConfigFieldDef {
  key: ConfigKey;
  label: string;
  group: "xai" | "twilio" | "email";
  kind: "text" | "number" | "boolean" | "select";
  secret?: boolean;
  options?: readonly string[];
  help?: string;
}

/** Known-good option lists — the Settings page renders these as dropdowns
 *  and the save endpoint rejects anything else, so a stray string can never
 *  reach the xAI API. Extend here when xAI ships new models/voices. */
export const GROK_REALTIME_MODELS = [
  "grok-voice-think-fast-1.0",
  "grok-voice-fast-1.0",
  "grok-voice-latest",
] as const;
export const GROK_VOICES = ["ara", "eve", "leo", "rex", "sal"] as const;
export const XAI_SUMMARY_MODELS = ["grok-4.3"] as const;

/**
 * Editable fields shown on the Settings page. Order matters — it's the render
 * order. The xAI API key is deliberately NOT here: it's env-only
 * (`XAI_API_KEY`), the one credential the whole app shares, so a stored
 * override can never collide with — and silently break — the deployment key.
 */
export const CONFIG_FIELDS: readonly ConfigFieldDef[] = [
  {
    key: "grokRealtimeModel",
    label: "Realtime voice model",
    group: "xai",
    kind: "select",
    options: GROK_REALTIME_MODELS,
    help: "Prefer a pinned id over -latest so the model never migrates silently.",
  },
  {
    key: "grokRealtimeVoice",
    label: "Default voice",
    group: "xai",
    kind: "select",
    options: GROK_VOICES,
  },
  {
    key: "xaiSummaryModel",
    label: "Summary model",
    group: "xai",
    kind: "select",
    options: XAI_SUMMARY_MODELS,
    help: "Text model that writes call summaries and transfer briefs.",
  },
  {
    key: "twilioAccountSid",
    label: "Account SID",
    group: "twilio",
    kind: "text",
    help: "With the auth token, lets centers search, buy, and wire up numbers from /centers.",
  },
  {
    key: "twilioAuthToken",
    label: "Auth token",
    group: "twilio",
    kind: "text",
    secret: true,
    help: "Enables the phone bridge and validates Twilio webhook signatures.",
  },
  {
    key: "smtpHost",
    label: "SMTP host",
    group: "email",
    kind: "text",
    help: "With a from address, enables transfer-brief emails.",
  },
  { key: "smtpPort", label: "SMTP port", group: "email", kind: "number" },
  {
    key: "smtpSecure",
    label: "Full-session TLS (port 465)",
    group: "email",
    kind: "boolean",
    help: "Leave off for STARTTLS on 587.",
  },
  { key: "smtpUser", label: "SMTP user", group: "email", kind: "text" },
  { key: "smtpPass", label: "SMTP password", group: "email", kind: "text", secret: true },
  {
    key: "smtpAuthMethod",
    label: "Auth method",
    group: "email",
    kind: "select",
    options: ["login", "plain"],
    help: "Office 365 only accepts login.",
  },
  {
    key: "emailFrom",
    label: "From address",
    group: "email",
    kind: "text",
    help: 'e.g. "Sarah at Pine Lodge <sarah@pinelodge.example>"',
  },
  {
    key: "appUrl",
    label: "Dashboard URL",
    group: "email",
    kind: "text",
    help: 'Origin for the "view the full call" link in emails. Defaults to the first trusted origin.',
  },
];

function envFallbacks(): AppConfig {
  return {
    xaiApiKey: env.XAI_API_KEY ?? "",
    grokRealtimeModel: env.GROK_REALTIME_MODEL,
    grokRealtimeVoice: env.GROK_REALTIME_VOICE,
    xaiSummaryModel: env.XAI_SUMMARY_MODEL,
    twilioAccountSid: env.TWILIO_ACCOUNT_SID ?? "",
    twilioAuthToken: env.TWILIO_AUTH_TOKEN ?? "",
    smtpHost: env.SMTP_HOST ?? "",
    smtpPort: env.SMTP_PORT,
    smtpSecure: env.SMTP_SECURE,
    smtpUser: env.SMTP_USER ?? "",
    smtpPass: env.SMTP_PASS ?? "",
    smtpAuthMethod: env.SMTP_AUTH_METHOD,
    emailFrom: env.EMAIL_FROM ?? "",
    appUrl: env.APP_URL ?? "",
  };
}

/** Keep the stored value the right shape even if a row was hand-edited:
 *  numbers stay numbers, booleans stay booleans, and dropdown fields only
 *  ever resolve to one of their known-good options. */
function sanitize(key: ConfigKey, value: unknown, fallback: AppConfig): AppConfig[ConfigKey] {
  switch (key) {
    case "smtpPort": {
      const n = Number(value);
      return Number.isInteger(n) && n > 0 ? n : fallback.smtpPort;
    }
    case "smtpSecure":
      return typeof value === "boolean" ? value : fallback.smtpSecure;
    default: {
      if (typeof value !== "string") return fallback[key];
      const options = CONFIG_FIELDS.find((f) => f.key === key)?.options;
      if (options && !options.includes(value)) return fallback[key];
      return value as AppConfig[ConfigKey];
    }
  }
}

const CACHE_TTL_MS = 10_000;
let cache: { at: number; config: AppConfig; overridden: Set<ConfigKey> } | null = null;

async function load(): Promise<NonNullable<typeof cache>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  const keys = CONFIG_FIELDS.map((f) => f.key as string);
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  const fallback = envFallbacks();
  const config = { ...fallback };
  const overridden = new Set<ConfigKey>();
  for (const row of rows) {
    const key = row.key as ConfigKey;
    overridden.add(key);
    (config as Record<ConfigKey, unknown>)[key] = sanitize(key, row.value, fallback);
  }
  cache = { at: Date.now(), config, overridden };
  return cache;
}

/** Effective config right now: settings row → env var → default. */
export async function getConfig(): Promise<AppConfig> {
  return (await load()).config;
}

export type ConfigSource = "settings" | "env" | "default";

export interface ConfigFieldState extends ConfigFieldDef {
  /** Plaintext for normal fields; always "" for secrets. */
  value: string | number | boolean;
  /** Whether a non-empty value is in effect (mainly for masked secrets). */
  set: boolean;
  source: ConfigSource;
}

/** What the Settings page renders: every field with its effective state,
 *  secrets masked down to a set/unset flag. */
export async function describeConfig(): Promise<ConfigFieldState[]> {
  const { config, overridden } = await load();
  const fallback = envFallbacks();
  return CONFIG_FIELDS.map((f) => {
    const value = config[f.key];
    const source: ConfigSource = overridden.has(f.key)
      ? "settings"
      : value !== "" && value === fallback[f.key] && hasEnvValue(f.key)
        ? "env"
        : "default";
    return {
      ...f,
      value: f.secret ? "" : value,
      set: value !== "",
      source,
    };
  });
}

function hasEnvValue(key: ConfigKey): boolean {
  switch (key) {
    case "twilioAccountSid":
      return Boolean(env.TWILIO_ACCOUNT_SID);
    case "twilioAuthToken":
      return Boolean(env.TWILIO_AUTH_TOKEN);
    case "smtpHost":
      return Boolean(env.SMTP_HOST);
    case "smtpUser":
      return Boolean(env.SMTP_USER);
    case "smtpPass":
      return Boolean(env.SMTP_PASS);
    case "emailFrom":
      return Boolean(env.EMAIL_FROM);
    case "appUrl":
      return Boolean(env.APP_URL);
    default:
      // Models, voice, port, method always have a usable default.
      return true;
  }
}

/** Drop any app_settings row whose key is no longer an editable field —
 *  e.g. a previously-stored xAI key now that the key is env-only. Runs once
 *  at boot so a stale override can't shadow the env value. */
export async function pruneOrphanSettings(): Promise<void> {
  const known = CONFIG_FIELDS.map((f) => f.key as string);
  await db.delete(appSettings).where(notInArray(appSettings.key, known));
  cache = null;
}

/** Save dashboard edits. `null` (or "" on string fields) deletes the row,
 *  reverting that key to its env/default fallback. */
export async function saveConfig(
  patch: Partial<Record<ConfigKey, string | number | boolean | null>>,
): Promise<void> {
  for (const field of CONFIG_FIELDS) {
    if (!(field.key in patch)) continue;
    const raw = patch[field.key];
    if (raw === null || raw === "") {
      await db.delete(appSettings).where(eq(appSettings.key, field.key));
      continue;
    }
    await db
      .insert(appSettings)
      .values({ key: field.key, value: raw, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: raw, updatedAt: new Date() },
      });
  }
  cache = null;
}
