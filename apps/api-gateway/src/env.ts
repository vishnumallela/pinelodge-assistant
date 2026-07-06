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

  // Facility identity: schedules and availability evaluate in this timezone.
  FACILITY_NAME: z.string().default("Pine Lodge Assisted Living"),
  FACILITY_TIMEZONE: z.string().default("America/Chicago"),

  // SIP (optional): set the webhook signing secret from the Direct SIP number
  // registration to enable POST /api/sip/incoming. The realtime WS for SIP
  // calls authenticates with XAI_API_KEY (ephemeral secrets are not allowed).
  XAI_SIP_WEBHOOK_SECRET: z.string().optional(),

  // Twilio bridge (optional): the account's auth token enables
  // POST /api/twilio/incoming + the media-stream WebSocket, and validates
  // X-Twilio-Signature on the webhook. Works without xAI's gated agents API.
  TWILIO_AUTH_TOKEN: z.string().optional(),
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
  PORT: raw.PORT ?? raw.API_PORT,
  ALLOWED_ORIGINS: raw.AUTH_TRUSTED_ORIGINS,
  XAI_API_KEY: raw.XAI_API_KEY,
  GROK_REALTIME_MODEL: raw.GROK_REALTIME_MODEL,
  GROK_REALTIME_VOICE: raw.GROK_REALTIME_VOICE,
  XAI_SUMMARY_MODEL: raw.XAI_SUMMARY_MODEL,
  FACILITY_NAME: raw.FACILITY_NAME,
  FACILITY_TIMEZONE: raw.FACILITY_TIMEZONE,
  XAI_SIP_WEBHOOK_SECRET: raw.XAI_SIP_WEBHOOK_SECRET,
  TWILIO_AUTH_TOKEN: raw.TWILIO_AUTH_TOKEN,
} as const;
