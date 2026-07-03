import { initDb } from "./src/db";
import { env } from "./src/env";
import { auth } from "./src/lib/auth";

await initDb();

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
  const res = await handler(req);
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
