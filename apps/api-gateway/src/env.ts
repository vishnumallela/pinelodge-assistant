import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // App database (calls, transcripts, summaries)
  DATABASE_URL_APP: z
    .string()
    .min(1)
    .default("postgres://pinelodge:pinelodge@localhost:5443/pinelodge_app"),

  // Redis backing the BullMQ summarization queue
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  // Auth service (identity lives there; we resolve sessions against it)
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),

  // Admin allowlist: only these identities may use the dashboard.
  // ADMIN_EMAILS adds admins beyond ADMIN_EMAIL, comma-separated.
  ADMIN_EMAIL: z.string().email().default("vishnu@stackaisolutions.com"),
  ADMIN_EMAILS: z
    .string()
    .default("ravi@stackaisolutions.com,ashok@theranow.com")
    .transform((s) =>
      s
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().email())),

  // Server (PORT is injected by hosts like Railway; API_PORT is the local default)
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().default(3002),
  AUTH_TRUSTED_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  XAI_API_KEY: z.string().optional(),
  // Pinned (not the -latest alias) so the model never migrates silently.
  GROK_REALTIME_MODEL: z.string().default("grok-voice-think-fast-1.0"),
  GROK_REALTIME_VOICE: z.string().default("ara"),
  // Text model that writes the post-call summary (never the realtime model).
  XAI_SUMMARY_MODEL: z.string().default("grok-4.3"),

  // Seed identity for the default center created on first boot; after that
  // every center carries its own name and timezone in the database.
  FACILITY_NAME: z.string().default("Pine Lodge Assisted Living"),
  FACILITY_TIMEZONE: z.string().default("America/Chicago"),

  // Twilio bridge (optional): the account's auth token enables
  // POST /api/twilio/incoming + the media-stream WebSocket, and validates
  // X-Twilio-Signature on the webhook. Works without xAI's gated agents API.
  TWILIO_AUTH_TOKEN: z.string().optional(),
  // Twilio number management (optional): with the Account SID set alongside
  // the auth token, centers can search, buy, and wire up their own inbound
  // numbers straight from the dashboard.
  TWILIO_ACCOUNT_SID: z.string().optional(),

  // Transfer briefs (optional): SMTP relay used to email a staff member the
  // moment a call transfers to them. Setting SMTP_HOST + EMAIL_FROM enables it.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // Full-session TLS (port 465). Leave false for STARTTLS on 587.
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // AUTH mechanism: Office 365 rejects PLAIN ("504 unrecognized authentication
  // type") but accepts LOGIN, which nearly every relay also supports.
  SMTP_AUTH_METHOD: z.enum(["login", "plain"]).default("login"),
  EMAIL_FROM: z.string().optional(),
  // Dashboard origin for links inside emails; falls back to the first
  // trusted origin when unset.
  APP_URL: z.string().url().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid env in @pinelodge/api-gateway:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}
const raw = parsed.data;

export const env = {
  NODE_ENV: raw.NODE_ENV,
  DATABASE_URL: raw.DATABASE_URL_APP,
  REDIS_URL: raw.REDIS_URL,
  AUTH_URL: raw.BETTER_AUTH_URL,
  ADMIN_EMAILS: [...new Set([raw.ADMIN_EMAIL.toLowerCase(), ...raw.ADMIN_EMAILS])],
  PORT: raw.PORT ?? raw.API_PORT,
  ALLOWED_ORIGINS: raw.AUTH_TRUSTED_ORIGINS,
  XAI_API_KEY: raw.XAI_API_KEY,
  GROK_REALTIME_MODEL: raw.GROK_REALTIME_MODEL,
  GROK_REALTIME_VOICE: raw.GROK_REALTIME_VOICE,
  XAI_SUMMARY_MODEL: raw.XAI_SUMMARY_MODEL,
  FACILITY_NAME: raw.FACILITY_NAME,
  FACILITY_TIMEZONE: raw.FACILITY_TIMEZONE,
  TWILIO_AUTH_TOKEN: raw.TWILIO_AUTH_TOKEN,
  TWILIO_ACCOUNT_SID: raw.TWILIO_ACCOUNT_SID,
  SMTP_HOST: raw.SMTP_HOST,
  SMTP_PORT: raw.SMTP_PORT,
  SMTP_SECURE: raw.SMTP_SECURE,
  SMTP_USER: raw.SMTP_USER,
  SMTP_PASS: raw.SMTP_PASS,
  SMTP_AUTH_METHOD: raw.SMTP_AUTH_METHOD,
  EMAIL_FROM: raw.EMAIL_FROM,
  APP_URL: raw.APP_URL?.replace(/\/$/, ""),
} as const;
