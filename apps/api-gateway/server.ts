import { createCall, endCall, getCall, listCalls, saveTranscript } from "./src/calls";
import { ensureSchema } from "./src/db";
import { env } from "./src/env";
import { enqueueSummary, startSummaryWorker } from "./src/queue";
import type { TranscriptTurn } from "./src/schema";

await ensureSchema();
startSummaryWorker();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const allowed = new Set(env.ALLOWED_ORIGINS);
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && allowed.has(origin) ? origin : (env.ALLOWED_ORIGINS[0] ?? "");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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

/** Mint a short-lived xAI realtime client secret so the browser can open a
 *  Grok voice WebSocket without ever seeing our standard API key. */
async function mintVoiceToken(userId: string): Promise<Response> {
  void userId;
  if (!env.XAI_API_KEY) {
    return json({ error: "XAI_API_KEY is not set. Add it to .env and restart." }, 500);
  }
  const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.XAI_API_KEY}` },
    body: JSON.stringify({ expires_after: { seconds: 600 } }),
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
  const candidate =
    (data.value as string | undefined) ??
    (data.secret as string | undefined) ??
    (data.token as string | undefined) ??
    (data.client_secret as { value?: string } | undefined)?.value ??
    (typeof data.client_secret === "string" ? data.client_secret : undefined);
  const token = String(candidate ?? "").replace(/^xai-client-secret\./, "");
  if (!token) return json({ error: "Could not parse token from provider." }, 502);
  return json({ token, model: env.GROK_REALTIME_MODEL, voice: env.GROK_REALTIME_VOICE });
}

/** Coerce an arbitrary body into a clean transcript array. */
function readTranscript(body: unknown): TranscriptTurn[] {
  const raw = (body as { transcript?: unknown } | null)?.transcript;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      const role = (t as { role?: unknown }).role;
      const text = (t as { text?: unknown }).text;
      return {
        role: role === "assistant" ? ("assistant" as const) : ("caller" as const),
        text: typeof text === "string" ? text : "",
      };
    })
    .filter((t) => t.text.trim() !== "");
}

async function handleCalls(req: Request, userId: string, path: string): Promise<Response> {
  // rest is "", "/:id", "/:id/transcript", or "/:id/end"
  const rest = path.slice("/api/calls".length);
  const segments = rest.split("/").filter(Boolean);

  // /api/calls
  if (segments.length === 0) {
    if (req.method === "GET") return json({ calls: await listCalls(userId) });
    if (req.method === "POST") return json({ call: await createCall(userId) }, 201);
    return json({ error: "Method not allowed" }, 405);
  }

  const id = segments[0]!;
  const sub = segments[1];

  // /api/calls/:id
  if (!sub) {
    if (req.method === "GET") {
      const call = await getCall(userId, id);
      return call ? json({ call }) : json({ error: "Call not found" }, 404);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  const body = await req.json().catch(() => ({}));

  // /api/calls/:id/transcript
  if (sub === "transcript" && req.method === "PUT") {
    const ok = await saveTranscript(userId, id, readTranscript(body));
    return ok ? json({ ok: true }) : json({ error: "Call is locked or not found" }, 409);
  }

  // /api/calls/:id/end
  if (sub === "end" && req.method === "POST") {
    const row = await endCall(userId, id, readTranscript(body));
    if (!row) return json({ error: "Call is locked or not found" }, 409);
    await enqueueSummary({ callId: row.id, userId });
    return json({ call: row });
  }

  return json({ error: "Not found" }, 404);
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

    if (path === "/health") {
      res = json({ ok: true, service: "api-gateway" });
    } else {
      const user = await sessionUser(req);
      if (!user) {
        res = json({ error: "Sign in to continue." }, 401);
      } else if (path === "/api/realtime/token" && req.method === "POST") {
        res = await mintVoiceToken(user.id);
      } else if (path === "/api/calls" || path.startsWith("/api/calls/")) {
        res = await handleCalls(req, user.id, path);
      } else {
        res = json({ error: "Not found" }, 404);
      }
    }

    return withCors(res, origin);
  },
});

console.log(`[api-gateway] http://localhost:${server.port}`);
