import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, username } from "better-auth/plugins";
import { db } from "../db";
import * as schema from "../db/schema";
import { env } from "../env";

const isProd = env.NODE_ENV === "production";

// The SPA calls BOTH this service and the api-gateway from the browser, so the
// session cookie has to survive cross-origin requests.
// - With a shared parent domain (COOKIE_DOMAIN=".example.com") the cookie is
//   scoped to every subdomain (app / api / auth) and stays first-party -> Lax.
// - Otherwise it is a foreign cookie and must be SameSite=None; Secure;
//   Partitioned (CHIPS) to be sent cross-site by modern browsers.
const crossDomainCookies = env.COOKIE_DOMAIN
  ? {
      crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN },
      defaultCookieAttributes: { sameSite: "lax" as const, secure: isProd },
    }
  : isProd
    ? {
        defaultCookieAttributes: {
          sameSite: "none" as const,
          secure: true,
          partitioned: true,
        },
      }
    : {};

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.TRUSTED_ORIGINS,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  // JWT is unused (the app authenticates by session + bearer token, not JWTs).
  plugins: [username(), bearer()],
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  advanced: {
    useSecureCookies: isProd,
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    ...crossDomainCookies,
  },
});
