import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid env in @pinelodge/api-gateway:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}
const raw = parsed.data;

export const env = {
  NODE_ENV: raw.NODE_ENV,
  AUTH_URL: raw.BETTER_AUTH_URL,
  PORT: raw.PORT ?? raw.API_PORT,
  ALLOWED_ORIGINS: raw.AUTH_TRUSTED_ORIGINS,
  XAI_API_KEY: raw.XAI_API_KEY,
  GROK_REALTIME_MODEL: raw.GROK_REALTIME_MODEL,
  GROK_REALTIME_VOICE: raw.GROK_REALTIME_VOICE,
} as const;
