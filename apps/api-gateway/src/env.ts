import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // App database (domain data: staff, calls, transcripts, reports)
  DATABASE_URL_APP: z
    .string()
    .min(1)
    .default("postgres://pinelodge:pinelodge@localhost:5443/pinelodge_app"),

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

  // OpenAI: gpt-realtime powers the live call; a lower-cost model writes the
  // post-call report (never the realtime model).
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_REALTIME_MODEL: z.string().default("gpt-realtime-2"),
  OPENAI_REALTIME_VOICE: z.string().default("marin"),
  OPENAI_TRANSCRIBE_MODEL: z.string().default("gpt-4o-transcribe"),
  OPENAI_SUMMARY_MODEL: z.string().default("gpt-5-mini"),

  // Facility identity
  FACILITY_NAME: z.string().default("Pine Lodge Assisted Living"),
  FACILITY_TIMEZONE: z.string().default("America/Chicago"),
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
  AUTH_URL: raw.BETTER_AUTH_URL,
  PORT: raw.PORT ?? raw.API_PORT,
  ALLOWED_ORIGINS: raw.AUTH_TRUSTED_ORIGINS,
  OPENAI_API_KEY: raw.OPENAI_API_KEY,
  OPENAI_REALTIME_MODEL: raw.OPENAI_REALTIME_MODEL,
  OPENAI_REALTIME_VOICE: raw.OPENAI_REALTIME_VOICE,
  OPENAI_TRANSCRIBE_MODEL: raw.OPENAI_TRANSCRIBE_MODEL,
  OPENAI_SUMMARY_MODEL: raw.OPENAI_SUMMARY_MODEL,
  FACILITY_NAME: raw.FACILITY_NAME,
  FACILITY_TIMEZONE: raw.FACILITY_TIMEZONE,
} as const;
