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

  // Admin allowlist: the only accounts that exist. Seeded on boot; sign-ups
  // are disabled and sign-in is restricted to these identities.
  // ADMIN_USERS adds admins beyond the primary pair as comma-separated
  // email:password entries; extra credentials live in the environment, not
  // in code defaults.
  ADMIN_EMAIL: z.string().email().default("vishnu@stackaisolutions.com"),
  ADMIN_PASSWORD: z.string().min(8).default("Password1234!"),
  ADMIN_USERS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
          const sep = pair.indexOf(":");
          return {
            email: pair
              .slice(0, sep < 0 ? pair.length : sep)
              .trim()
              .toLowerCase(),
            password: sep < 0 ? "" : pair.slice(sep + 1),
          };
        }),
    )
    .pipe(z.array(z.object({ email: z.string().email(), password: z.string().min(8) }))),

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

// Primary pair first so its password wins if the same email also appears in
// ADMIN_USERS.
const admins = [{ email: raw.ADMIN_EMAIL.toLowerCase(), password: raw.ADMIN_PASSWORD }];
for (const a of raw.ADMIN_USERS) {
  if (!admins.some((x) => x.email === a.email)) admins.push(a);
}

export const env = {
  NODE_ENV: raw.NODE_ENV,
  DATABASE_URL: raw.DATABASE_URL_AUTH,
  BETTER_AUTH_SECRET: raw.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: raw.BETTER_AUTH_URL,
  COOKIE_DOMAIN: raw.COOKIE_DOMAIN,
  PORT: raw.PORT ?? raw.AUTH_PORT,
  TRUSTED_ORIGINS: raw.AUTH_TRUSTED_ORIGINS,
  ADMINS: admins,
} as const;
