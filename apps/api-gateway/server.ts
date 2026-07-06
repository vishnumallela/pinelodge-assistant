import { createCall, endCall, getCall, listCalls, logCallEvent, saveTranscript } from "./src/calls";
import { ensureSchema } from "./src/db";
import { env } from "./src/env";
import { getAgentPrompt, saveTemplate, DEFAULT_GREETING, DEFAULT_TEMPLATE } from "./src/prompt";
import { enqueueSummary, startSummaryWorker } from "./src/queue";
import type { TranscriptTurn } from "./src/schema";
import {
  getSipSecret,
  handleSipWebhook,
  listRegisteredNumbers,
  registerNumber,
  sipEnabled,
} from "./src/sip";
import {
  handleTwilioIncoming,
  handleTwilioResume,
  twilioEnabled,
  twilioWebSocketHandlers,
  type TwilioSocketData,
} from "./src/twilio";
import {
  createStaff,
  deleteStaff,
  listStaff,
  readStaffInput,
  seedDefaultStaff,
  updateStaff,
} from "./src/staff";

await ensureSchema();
await seedDefaultStaff();
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
 *  Single-admin application: any identity other than ADMIN_EMAIL is rejected. */
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
    if (email !== env.ADMIN_EMAIL) return null;
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

async function handleCalls(req: Request, path: string): Promise<Response> {
  // rest is "", "/:id", "/:id/transcript", or "/:id/end"
  const rest = path.slice("/api/calls".length);
  const segments = rest.split("/").filter(Boolean);

  // /api/calls
  if (segments.length === 0) {
    if (req.method === "GET") return json({ calls: await listCalls() });
    if (req.method === "POST") {
      const call = await createCall("console");
      await logCallEvent(call.id, "call created", "console");
      return json({ call }, 201);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  const id = segments[0]!;
  const sub = segments[1];

  // /api/calls/:id
  if (!sub) {
    if (req.method === "GET") {
      const call = await getCall(id);
      return call ? json({ call }) : json({ error: "Call not found" }, 404);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  const body = await req.json().catch(() => ({}));

  // /api/calls/:id/transcript
  if (sub === "transcript" && req.method === "PUT") {
    const ok = await saveTranscript(id, readTranscript(body));
    return ok ? json({ ok: true }) : json({ error: "Call is locked or not found" }, 409);
  }

  // /api/calls/:id/end
  if (sub === "end" && req.method === "POST") {
    const row = await endCall(id, readTranscript(body));
    if (!row) return json({ error: "Call is locked or not found" }, 409);
    await logCallEvent(id, "call ended", `console, ${row.durationSeconds ?? 0}s`);
    await enqueueSummary({ callId: row.id });
    return json({ call: row });
  }

  return json({ error: "Not found" }, 404);
}

async function handleStaff(req: Request, path: string): Promise<Response> {
  const segments = path.slice("/api/staff".length).split("/").filter(Boolean);

  if (segments.length === 0) {
    if (req.method === "GET") return json({ staff: await listStaff() });
    if (req.method === "POST") {
      const input = readStaffInput(await req.json().catch(() => null));
      if (!input) return json({ error: "Name and section are required." }, 400);
      return json({ staff: await createStaff(input) }, 201);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  const id = segments[0]!;
  if (req.method === "PUT") {
    const input = readStaffInput(await req.json().catch(() => null));
    if (!input) return json({ error: "Name and section are required." }, 400);
    const row = await updateStaff(id, input);
    return row ? json({ staff: row }) : json({ error: "Staff member not found" }, 404);
  }
  if (req.method === "DELETE") {
    const ok = await deleteStaff(id);
    return ok ? json({ ok: true }) : json({ error: "Staff member not found" }, 404);
  }
  return json({ error: "Method not allowed" }, 405);
}

/** Public URL of this deployment, from proxy headers (Railway) or the request. */
function publicUrl(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

async function handlePhoneConfig(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const secret = await getSipSecret();
    const origin = publicUrl(req);
    return json({
      twilio: {
        enabled: twilioEnabled(),
        hasApiKey: Boolean(env.XAI_API_KEY),
        voiceWebhookUrl: `${origin}/api/twilio/incoming`,
        streamUrl: `${origin.replace(/^http/, "ws")}/api/twilio/stream`,
      },
      sip: {
        enabled: Boolean(secret && env.XAI_API_KEY),
        hasApiKey: Boolean(env.XAI_API_KEY),
        hasSecret: Boolean(secret),
        secretSource: env.XAI_SIP_WEBHOOK_SECRET ? "env" : secret ? "registered" : null,
        webhookUrl: `${origin}/api/sip/incoming`,
        sipHost: "sip.voice.x.ai",
        numbers: (await listRegisteredNumbers()) ?? [],
      },
    });
  }
  return json({ error: "Method not allowed" }, 405);
}

async function handleSipRegister(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    phoneNumber?: unknown;
    name?: unknown;
    authUsername?: unknown;
    authPassword?: unknown;
    allowedAddresses?: unknown;
  } | null;
  const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  if (!/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
    return json({ error: "Phone number must be E.164, e.g. +14155550100." }, 400);
  }
  const result = await registerNumber(
    {
      phoneNumber,
      name: typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "Front desk",
      authUsername: typeof body?.authUsername === "string" ? body.authUsername.trim() : undefined,
      authPassword: typeof body?.authPassword === "string" ? body.authPassword : undefined,
      allowedAddresses: Array.isArray(body?.allowedAddresses)
        ? body.allowedAddresses.filter((a): a is string => typeof a === "string" && a.trim() !== "")
        : undefined,
    },
    `${publicUrl(req)}/api/sip/incoming`,
  );
  if ("error" in result) return json({ error: result.error }, result.status);
  return json(result, 201);
}

async function handleAgentPrompt(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const data = await getAgentPrompt();
    return json({
      ...data,
      defaults: { template: DEFAULT_TEMPLATE, greeting: DEFAULT_GREETING },
    });
  }
  if (req.method === "PUT") {
    const body = (await req.json().catch(() => null)) as {
      template?: unknown;
      greeting?: unknown;
    } | null;
    const template = typeof body?.template === "string" ? body.template.trim() : "";
    const greeting = typeof body?.greeting === "string" ? body.greeting.trim() : "";
    if (!template || !greeting) return json({ error: "Template and greeting are required." }, 400);
    await saveTemplate(template, greeting);
    const data = await getAgentPrompt();
    return json({
      ...data,
      defaults: { template: DEFAULT_TEMPLATE, greeting: DEFAULT_GREETING },
    });
  }
  return json({ error: "Method not allowed" }, 405);
}

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

    // Twilio media stream: upgrade before any session/CORS handling.
    if (path === "/api/twilio/stream") {
      if (!twilioEnabled()) return json({ error: "Twilio bridge is not configured." }, 503);
      if (srv.upgrade(req, { data: { bridge: null } })) return undefined as unknown as Response;
      return json({ error: "Expected a WebSocket upgrade." }, 400);
    }

    let res: Response;

    if (path === "/health") {
      res = json({
        ok: true,
        service: "api-gateway",
        sip: await sipEnabled(),
        twilio: twilioEnabled(),
      });
    } else if (path === "/api/sip/incoming" && req.method === "POST") {
      // Authenticated by webhook signature, not by a browser session.
      res = await handleSipWebhook(req);
    } else if (path === "/api/twilio/incoming" && req.method === "POST") {
      // Authenticated by X-Twilio-Signature, not by a browser session.
      res = await handleTwilioIncoming(req, publicUrl(req));
    } else if (path === "/api/twilio/resume" && req.method === "POST") {
      res = await handleTwilioResume(req, publicUrl(req));
    } else {
      const user = await sessionUser(req);
      if (!user) {
        res = json({ error: "Sign in to continue." }, 401);
      } else if (path === "/api/realtime/token" && req.method === "POST") {
        res = await mintVoiceToken(user.id);
      } else if (path === "/api/calls" || path.startsWith("/api/calls/")) {
        res = await handleCalls(req, path);
      } else if (path === "/api/staff" || path.startsWith("/api/staff/")) {
        res = await handleStaff(req, path);
      } else if (path === "/api/agent/prompt") {
        res = await handleAgentPrompt(req);
      } else if (path === "/api/phone/config") {
        res = await handlePhoneConfig(req);
      } else if (path === "/api/sip/register" && req.method === "POST") {
        res = await handleSipRegister(req);
      } else {
        res = json({ error: "Not found" }, 404);
      }
    }

    return withCors(res, origin);
  },
});

console.log(`[api-gateway] http://localhost:${server.port}`);
