import { RPCHandler } from "@orpc/server/fetch";
import { db, initDb } from "./src/db";
import { env } from "./src/env";
import { router } from "./src/routers";
import { seedDefaultStaff } from "./src/lib/staff";

await initDb();
await seedDefaultStaff(db);

const rpc = new RPCHandler(router);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/* ── CORS (frontend calls us cross-origin with credentials) ── */
const allowed = new Set(env.ALLOWED_ORIGINS);
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && allowed.has(origin) ? origin : (env.ALLOWED_ORIGINS[0] ?? "");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
function withCors(res: Response, origin: string | null): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Resolve the signed-in user from the auth service (cookie/bearer forwarded). */
async function sessionUser(req: Request): Promise<{ id: string } | null> {
  const cookie = req.headers.get("cookie");
  const authz = req.headers.get("authorization");
  if (!cookie && !authz) return null;
  try {
    const res = await fetch(`${env.AUTH_URL}/api/auth/get-session`, {
      headers: { ...(cookie ? { cookie } : {}), ...(authz ? { authorization: authz } : {}) },
      signal: AbortSignal.timeout(5000),
    });
    const data = res.ok ? ((await res.json()) as { user?: Record<string, unknown> } | null) : null;
    if (!data?.user) return null;
    return { id: String(data.user.id) };
  } catch {
    return null;
  }
}

// Mint a short-lived OpenAI Realtime client secret (ek_...) so the browser can
// open a WebRTC call directly against the realtime model without ever seeing
// our standard API key. Voice/model are pinned here; per-call instructions and
// tools are applied client-side via session.update on the data channel.
async function mintVoiceToken(req: Request): Promise<Response> {
  const user = await sessionUser(req);
  if (!user) return json({ error: "Sign in to start a call." }, 401);
  if (!env.OPENAI_API_KEY) {
    return json({ error: "OPENAI_API_KEY is not set. Add it to .env and restart." }, 500);
  }
  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: env.OPENAI_REALTIME_MODEL,
        audio: { output: { voice: env.OPENAI_REALTIME_VOICE } },
      },
    }),
  });
  const text = await r.text();
  if (!r.ok) {
    console.error("[api-gateway] voice token mint failed:", r.status, text);
    return json({ error: `voice token mint failed (${r.status})` }, 502);
  }
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  const token =
    (data.value as string | undefined) ??
    (data.client_secret as { value?: string } | undefined)?.value ??
    "";
  if (!token) return json({ error: "Could not parse token from provider." }, 502);
  return json({
    token,
    model: env.OPENAI_REALTIME_MODEL,
    voice: env.OPENAI_REALTIME_VOICE,
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL,
  });
}

const server = Bun.serve({
  hostname: "::",
  port: env.PORT,
  idleTimeout: 120,
  async fetch(req) {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const path = new URL(req.url).pathname;
    let res: Response;

    if (path === "/health") res = json({ ok: true, service: "api-gateway" });
    else if (path === "/api/realtime/token" && req.method === "POST")
      res = await mintVoiceToken(req);
    else if (path.startsWith("/orpc")) {
      const { matched, response } = await rpc.handle(req, {
        prefix: "/orpc",
        context: { headers: req.headers },
      });
      res = matched && response ? response : json({ error: "Not found" }, 404);
    } else res = json({ error: "Not found" }, 404);

    return withCors(res, origin);
  },
});

console.log(`[api-gateway] http://localhost:${server.port}`);
