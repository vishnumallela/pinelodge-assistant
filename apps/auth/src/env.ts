import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Database (the auth service owns the identity store)
  DATABASE_URL_AUTH: z
    .string()
    .min(1)
    .default("postgres://pinelodge:pinelodge@localhost:5444/pinelodge_auth"),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be at least 16 chars"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
  COOKIE_DOMAIN: z.string().optional(),

  // Server (PORT is injected by hosts like Railway; AUTH_PORT is the local default)
  PORT: z.coerce.number().int().positive().optional(),
  AUTH_PORT: z.coerce.number().int().positive().default(3001),
  AUTH_TRUSTED_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:3002")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid env in @pinelodge/auth:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}
const raw = parsed.data;

export const env = {
  NODE_ENV: raw.NODE_ENV,
  DATABASE_URL: raw.DATABASE_URL_AUTH,
  BETTER_AUTH_SECRET: raw.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: raw.BETTER_AUTH_URL,
  COOKIE_DOMAIN: raw.COOKIE_DOMAIN,
  PORT: raw.PORT ?? raw.AUTH_PORT,
  TRUSTED_ORIGINS: raw.AUTH_TRUSTED_ORIGINS,
} as const;
