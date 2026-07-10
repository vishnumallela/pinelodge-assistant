import { initDb } from "./src/db";
import { env } from "./src/env";
import { auth } from "./src/lib/auth";

await initDb();

/* ── admin identities ──
 * Every account in env.ADMINS is seeded on boot and its configured password
 * is authoritative: if the account already exists its password is reset to
 * match. Sign-up endpoints are blocked below and sign-in is restricted to
 * the admin emails. */
async function seedAdmin(admin: { email: string; password: string }): Promise<void> {
  try {
    await auth.api.signUpEmail({
      body: {
        email: admin.email,
        password: admin.password,
        name: admin.email.split("@")[0] ?? "admin",
        username: (admin.email.split("@")[0] ?? "admin").replace(/[^a-z0-9_]/gi, ""),
      },
    });
    console.log(`[auth] seeded admin ${admin.email}`);
    return;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already|exist/i.test(msg)) {
      console.error(`[auth] admin seed failed for ${admin.email}:`, msg);
      return;
    }
  }
  // Account exists: enforce the configured password.
  try {
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.findUserByEmail(admin.email);
    if (!user) return;
    const hash = await ctx.password.hash(admin.password);
    await ctx.internalAdapter.updatePassword(user.user.id, hash);
    console.log(`[auth] admin ${admin.email} password enforced from env`);
  } catch (e) {
    console.error(
      `[auth] admin password enforce failed for ${admin.email}:`,
      e instanceof Error ? e.message : e,
    );
  }
}
for (const admin of env.ADMINS) await seedAdmin(admin);

const adminEmails = new Set(env.ADMINS.map((a) => a.email));

/** Reject sign-ups entirely, and sign-ins for anyone but the admins. */
async function guardAdminsOnly(req: Request): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (path.startsWith("/api/auth/sign-up")) {
    return Response.json(
      { error: "Sign-ups are disabled. This is an admin-only application." },
      { status: 403 },
    );
  }
  if (path.startsWith("/api/auth/sign-in") && req.method === "POST") {
    const body = (await req
      .clone()
      .json()
      .catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!adminEmails.has(email)) {
      return Response.json({ error: "Invalid email or password." }, { status: 401 });
    }
  }
  return null;
}

/* ── CORS for the browser-facing /api/auth/* ── */

const allowedOrigins = new Set(env.TRUSTED_ORIGINS);
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && allowedOrigins.has(origin) ? origin : (env.TRUSTED_ORIGINS[0] ?? "");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // Bearer plugin: the SPA must be able to read the session token cross-origin.
    "Access-Control-Expose-Headers": "set-auth-token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
async function withCors(req: Request, handler: (req: Request) => Response | Promise<Response>) {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  const res = (await guardAdminsOnly(req)) ?? (await handler(req));
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const server = Bun.serve({
  hostname: "::",
  port: env.PORT,
  development: env.NODE_ENV !== "production",
  routes: {
    "/health": Response.json({ ok: true, service: "auth" }),
    "/api/auth/*": (req) => withCors(req, auth.handler),
  },
  error(err) {
    console.error("[auth]", err);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  },
});

console.log(`[auth] http://localhost:${server.port}`);
