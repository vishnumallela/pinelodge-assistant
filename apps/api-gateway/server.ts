import { RPCHandler } from "@orpc/server/fetch";
import { getConfig, pruneOrphanSettings } from "./src/app-config";
import { finalizeOrphanedCalls, findStuckSummarizing } from "./src/calls";
import { requireDefaultCenter } from "./src/centers";
import { ensureSchema } from "./src/db";
import { env } from "./src/env";
import { enqueueSummary, startSummaryWorker, startTransferEmailWorker } from "./src/queue";
import {
  handleTwilioIncoming,
  handleTwilioResume,
  twilioEnabled,
  twilioWebSocketHandlers,
  type TwilioSocketData,
} from "./src/twilio";
import { seedDefaultStaff } from "./src/staff";
import { router, type RpcContext } from "./src/router";

await ensureSchema();
// Env-only keys (the xAI key) must never be shadowed by a stale stored row.
await pruneOrphanSettings();
const defaultCenter = await requireDefaultCenter();
await seedDefaultStaff(defaultCenter.id);
startSummaryWorker();
startTransferEmailWorker();

// Repair calls a previous run left dangling. Every 'active' call at boot is
// orphaned (its bridge process is gone — usually a redeploy mid-call), so
// finalize each and summarize it; a real conversation still gets its summary
// instead of hanging active with none. Also re-enqueue any row stuck in
// 'summarizing' whose summary job was lost.
void (async () => {
  try {
    const orphaned = await finalizeOrphanedCalls();
    const stuck = await findStuckSummarizing();
    const seen = new Set(orphaned.map((c) => c.id));
    for (const call of [...orphaned, ...stuck.filter((c) => !seen.has(c.id))]) {
      await enqueueSummary({ callId: call.id });
    }
    if (orphaned.length) console.log(`[api-gateway] finalized ${orphaned.length} orphaned call(s)`);
  } catch (e) {
    console.error("[api-gateway] boot repair failed:", e instanceof Error ? e.message : e);
  }
})();

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
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

/** Resolve the signed-in user from the auth service (cookie/bearer forwarded).
 *  Admin-only application: any identity outside the admin allowlist is rejected. */
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
    const email = String(data.user.email ?? "").toLowerCase();
    if (!env.ADMIN_EMAILS.includes(email)) return null;
    return { id: String(data.user.id) };
  } catch {
    return null;
  }
}

/** Mint a short-lived xAI realtime client secret so the browser can open a
 *  Grok voice WebSocket without ever seeing our standard API key. */
async function mintVoiceToken(userId: string): Promise<Response> {
  void userId;
  const config = await getConfig();
  if (!config.xaiApiKey) {
    return json({ error: "The xAI API key is not set. Add it in Settings." }, 500);
  }
  const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.xaiApiKey}` },
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
  return json({ token, model: config.grokRealtimeModel, voice: config.grokRealtimeVoice });
}

/** Public URL of this deployment, from proxy headers (Railway) or the request. */
function publicUrl(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

const rpc = new RPCHandler(router);

const server = Bun.serve<TwilioSocketData>({
  hostname: "::",
  port: env.PORT,
  idleTimeout: 120,
  websocket: twilioWebSocketHandlers,
  async fetch(req, srv) {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const path = new URL(req.url).pathname;

    // Twilio media stream: upgrade before any session/CORS handling. The
    // socket is authorized inside the bridge from the signed token in the
    // "start" frame (Twilio doesn't reliably forward URL query strings, but
    // always delivers Stream Parameters) — an unauthorized socket opens no
    // billed xAI session and touches no call row.
    if (path === "/api/twilio/stream") {
      if (!(await twilioEnabled())) {
        return json({ error: "Twilio bridge is not configured." }, 503);
      }
      if (srv.upgrade(req, { data: { bridge: null } })) return undefined as unknown as Response;
      return json({ error: "Expected a WebSocket upgrade." }, 400);
    }

    let res: Response;

    if (path === "/health") {
      res = json({
        ok: true,
        service: "api-gateway",
        twilio: await twilioEnabled(),
      });
    } else if (path === "/api/twilio/incoming" && req.method === "POST") {
      // Authenticated by X-Twilio-Signature, not by a browser session.
      res = await handleTwilioIncoming(req, publicUrl(req));
    } else if (path === "/api/twilio/resume" && req.method === "POST") {
      res = await handleTwilioResume(req, publicUrl(req));
    } else if (path.startsWith("/orpc")) {
      // Typed dashboard API; procedures enforce the admin check via context.
      const user = await sessionUser(req);
      const context: RpcContext = {
        admin: Boolean(user),
        userId: user?.id ?? "",
        origin: publicUrl(req),
      };
      const { matched, response } = await rpc.handle(req, { prefix: "/orpc", context });
      res = matched && response ? response : json({ error: "Not found" }, 404);
    } else {
      const user = await sessionUser(req);
      if (!user) {
        res = json({ error: "Sign in to continue." }, 401);
      } else if (path === "/api/realtime/token" && req.method === "POST") {
        res = await mintVoiceToken(user.id);
      } else {
        res = json({ error: "Not found" }, 404);
      }
    }

    return withCors(res, origin);
  },
});

console.log(`[api-gateway] http://localhost:${server.port}`);
