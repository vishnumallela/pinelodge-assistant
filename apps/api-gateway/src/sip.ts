import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { endCall as lockCall, logCallEvent, saveTranscript } from "./calls";
import { db } from "./db";
import { env } from "./env";
import { getAgentPrompt, PHONE_TRANSFER_APPENDIX } from "./prompt";
import { enqueueSummary } from "./queue";
import { calls, settings, type TranscriptTurn } from "./schema";
import { findTransferTarget } from "./staff";

/**
 * SIP integration (xAI Direct SIP), env-gated by XAI_SIP_WEBHOOK_SECRET.
 *
 * Flow per xAI docs (docs.x.ai → voice-agent → SIP Phone Calls):
 *   1. Register a Direct SIP phone number with xAI (origin "byo_trunk" for a
 *      customer-owned number) pointing carriers at
 *      sip:{number}@sip.voice.x.ai;transport=tls, with this service's
 *      /api/sip/incoming as the webhook URL. xAI returns the signing secret
 *      once — that's XAI_SIP_WEBHOOK_SECRET.
 *   2. On an inbound call xAI POSTs a signed `realtime.call.incoming` event
 *      carrying data.call_id.
 *   3. We open wss://api.x.ai/v1/realtime?call_id={call_id} authenticated
 *      with the standard API key (ephemeral secrets are not allowed for SIP)
 *      and run the same receptionist session the browser console runs:
 *      live prompt from the database, force_message greeting, end_call tool.
 *   4. Turns persist to the calls table as they complete; hangup goes through
 *      POST /v1/realtime/calls/{call_id}/hangup; on close the record locks
 *      and the summary job enqueues — identical lifecycle to console calls.
 */

const SIP_USER_PREFIX = "sip";
const SECRET_KEY = "sip_webhook_secret";
const NUMBERS_KEY = "sip_numbers";

/** Registering a number in the UI stores the signing secret here; the env var
 *  overrides it (e.g. for a number registered outside the app). */
async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row ? (row.value as T) : null;
}

async function putSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function getSipSecret(): Promise<string | null> {
  return env.XAI_SIP_WEBHOOK_SECRET ?? (await getSetting<string>(SECRET_KEY));
}

export async function sipEnabled(): Promise<boolean> {
  return Boolean(env.XAI_API_KEY && (await getSipSecret()));
}

export interface RegisteredNumber {
  phoneNumberId: string;
  phoneNumber: string;
  name: string;
  sipHost: string;
  createdAt: string;
}

export function listRegisteredNumbers(): Promise<RegisteredNumber[] | null> {
  return getSetting<RegisteredNumber[]>(NUMBERS_KEY);
}

/** Standard-Webhooks signature check: HMAC-SHA256 over "id.timestamp.body". */
function verifySipSignature(headers: Headers, rawBody: string, secretRaw: string): boolean {
  if (!secretRaw) return false;
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;
  // Reject replays outside a 5-minute window.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const secret = secretRaw.startsWith("whsec_")
    ? Buffer.from(secretRaw.slice(6), "base64")
    : Buffer.from(secretRaw, "utf8");
  const expected = createHmac("sha256", secret).update(`${id}.${timestamp}.${rawBody}`).digest();
  // Header may list several space-separated "v1,<base64>" candidates.
  return signatureHeader.split(" ").some((part) => {
    const value = part.includes(",") ? part.split(",")[1]! : part;
    try {
      const candidate = Buffer.from(value, "base64");
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    } catch {
      return false;
    }
  });
}

export interface RegisterNumberInput {
  phoneNumber: string;
  name: string;
  authUsername?: string;
  authPassword?: string;
  allowedAddresses?: string[];
}

/** Register a customer-owned (byo_trunk) Direct SIP number with xAI, pointing
 *  its incoming-call webhook at this service. The dispatch signing secret is
 *  returned once by xAI — we persist it in settings so the webhook verifies
 *  immediately, and echo it back for the operator's records. */
export async function registerNumber(
  input: RegisterNumberInput,
  webhookUrl: string,
): Promise<{ number: RegisteredNumber; secret: string } | { error: string; status: number }> {
  if (!env.XAI_API_KEY) return { error: "XAI_API_KEY is not set.", status: 500 };
  const sipAuth: Record<string, unknown> = {};
  if (input.authUsername && input.authPassword) {
    sipAuth.auth_username = input.authUsername;
    sipAuth.auth_password = input.authPassword;
  }
  if (input.allowedAddresses && input.allowedAddresses.length > 0) {
    sipAuth.allowed_addresses = input.allowedAddresses;
  }
  if (Object.keys(sipAuth).length === 0) {
    return { error: "Provide SIP digest credentials or allowed signaling addresses.", status: 400 };
  }
  const r = await fetch("https://api.x.ai/v2/phone-numbers", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.XAI_API_KEY}` },
    body: JSON.stringify({
      origin: "byo_trunk",
      name: input.name,
      phone_number: input.phoneNumber,
      sip_auth: sipAuth,
      webhook: { name: "pinelodge-incoming-calls", url: webhookUrl },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  if (!r.ok) {
    console.error("[sip] number registration failed:", r.status, text);
    return {
      error: `xAI rejected the registration (${r.status}): ${text.slice(0, 300)}`,
      status: 502,
    };
  }
  let data: {
    phone_number?: {
      phone_number_id?: string;
      phone_number?: string;
      name?: string;
      sip_host?: string;
    };
    webhook?: { dispatch_signing_secret?: string };
  } = {};
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    /* fall through to the guard below */
  }
  const secret = data.webhook?.dispatch_signing_secret ?? "";
  const number: RegisteredNumber = {
    phoneNumberId: data.phone_number?.phone_number_id ?? "",
    phoneNumber: data.phone_number?.phone_number ?? input.phoneNumber,
    name: data.phone_number?.name ?? input.name,
    sipHost: data.phone_number?.sip_host ?? "sip.voice.x.ai",
    createdAt: new Date().toISOString(),
  };
  if (secret) await putSetting(SECRET_KEY, secret);
  const existing = (await listRegisteredNumbers()) ?? [];
  await putSetting(NUMBERS_KEY, [...existing, number]);
  return { number, secret };
}

interface IncomingCallEvent {
  type?: string;
  data?: {
    call_id?: string;
    sip_headers?: { name?: string; value?: string }[];
  };
}

/** Webhook entrypoint: verify, ack fast, run the agent in the background. */
export async function handleSipWebhook(req: Request): Promise<Response> {
  const secret = await getSipSecret();
  if (!secret || !env.XAI_API_KEY) {
    return Response.json({ error: "SIP is not configured on this deployment." }, { status: 503 });
  }
  const rawBody = await req.text();
  if (!verifySipSignature(req.headers, rawBody, secret)) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  let event: IncomingCallEvent = {};
  try {
    event = JSON.parse(rawBody) as IncomingCallEvent;
  } catch {
    return Response.json({ error: "Malformed payload." }, { status: 400 });
  }
  if (event.type !== "realtime.call.incoming" || !event.data?.call_id) {
    // Acknowledge unrelated event types so xAI doesn't retry them.
    return Response.json({ ok: true, ignored: event.type ?? "unknown" });
  }
  const from =
    event.data.sip_headers?.find((h) => h.name?.toLowerCase() === "from")?.value ?? "unknown";
  void runSipAgent(event.data.call_id, from).catch((e) => {
    console.error("[sip] agent crashed:", e instanceof Error ? e.message : e);
  });
  return Response.json({ ok: true });
}

/** Resolve a spoken name and REFER the SIP leg to their phone. */
async function handleSipTransfer(
  sipCallId: string,
  rowId: string,
  toolCallId: string,
  argsRaw: string,
  transcript: TranscriptTurn[],
  send: (e: Record<string, unknown>) => void,
): Promise<void> {
  let name = "";
  try {
    name = String((JSON.parse(argsRaw) as { name?: unknown }).name ?? "");
  } catch {
    /* leave empty */
  }
  const target = name ? await findTransferTarget(name) : null;
  if (!target) {
    void logCallEvent(rowId, "transfer failed", `asked for "${name}", nobody reachable`);
    send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: toolCallId,
        output: JSON.stringify({ error: "Nobody is available to take this transfer right now." }),
      },
    });
    send({ type: "response.create" });
    return;
  }
  transcript.push({
    role: "assistant",
    text: `(transferring the caller to ${target.name} in ${target.section})`,
  });
  send({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: toolCallId,
      output: JSON.stringify({ ok: true, connecting: target.name }),
    },
  });
  void logCallEvent(rowId, "transfer via REFER", `${target.name} at ${target.phone}`);
  // xAI SIP call control: REFER the call leg to the target number.
  try {
    await fetch(`https://api.x.ai/v1/realtime/calls/${sipCallId}/refer`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.XAI_API_KEY}` },
      body: JSON.stringify({ target_uri: `tel:${target.phone}` }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    /* the socket close path still finalizes the record */
  }
}

/** Drive one inbound SIP call end-to-end over the realtime WebSocket. */
async function runSipAgent(callId: string, from: string): Promise<void> {
  const [row] = await db
    .insert(calls)
    .values({ userId: `${SIP_USER_PREFIX}:${from}` })
    .returning();
  const rowId = row!.id;
  await logCallEvent(rowId, "call created", `sip webhook from ${from}`);

  const { prompt, greeting } = await getAgentPrompt();
  const transcript: TranscriptTurn[] = [];
  // item_id -> index: Grok re-sends cumulative transcripts per item, so turns
  // are replaced in place, never appended twice.
  const turnIndex = new Map<string, number>();
  let hangupRequested = false;

  const finalize = async () => {
    const locked = await lockCall(rowId, transcript);
    if (locked) {
      await logCallEvent(rowId, "call ended", `sip leg closed, ${locked.durationSeconds ?? 0}s`);
      await enqueueSummary({ callId: rowId });
    }
  };

  const hangup = async () => {
    try {
      await fetch(`https://api.x.ai/v1/realtime/calls/${callId}/hangup`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.XAI_API_KEY}` },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      /* the socket close path still finalizes the record */
    }
  };

  await new Promise<void>((resolve) => {
    const ws = new WebSocket(`wss://api.x.ai/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
      // Bun supports custom headers on client WebSockets.
      headers: { authorization: `Bearer ${env.XAI_API_KEY}` },
    } as unknown as string[]);

    const send = (e: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
    };
    const persist = () => void saveTranscript(rowId, transcript).catch(() => {});
    const upsertTurn = (itemId: string, role: "caller" | "assistant", text: string) => {
      const key = `${role}:${itemId}`;
      const at = turnIndex.get(key);
      if (at !== undefined) {
        transcript[at] = { role, text };
      } else {
        turnIndex.set(key, transcript.length);
        transcript.push({ role, text });
      }
      persist();
    };

    // Safety net: a stuck call ends after 10 minutes.
    const cap = setTimeout(() => void hangup(), 10 * 60 * 1000);

    ws.addEventListener("open", () => {
      send({
        type: "session.update",
        session: {
          type: "realtime",
          voice: env.GROK_REALTIME_VOICE,
          instructions: `${prompt}\n\n${PHONE_TRANSFER_APPENDIX}`,
          reasoning: { effort: "none" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.6,
            silence_duration_ms: 300,
            prefix_padding_ms: 300,
            idle_timeout_ms: 15000,
          },
          audio: { input: { transcription: { model: "grok-transcribe" } } },
          tools: [
            {
              type: "function",
              name: "transfer_call",
              description:
                "Connect the caller to a staff member's phone. Call this right after you announce the redirect and say goodbye.",
              parameters: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: "Exact name of the staff member from the directory",
                  },
                },
                required: ["name"],
              },
            },
            {
              type: "function",
              name: "end_call",
              description:
                "Hang up without transferring. Use when no transfer is possible, after saying goodbye.",
              parameters: { type: "object", properties: {}, required: [] },
            },
          ],
        },
      });
      send({
        type: "conversation.item.create",
        item: {
          type: "force_message",
          role: "assistant",
          content: [{ type: "output_text", text: greeting }],
        },
      });
      // force_message injects a full response lifecycle, so its transcript
      // arrives through the normal event below - no manual push, no double.
    });

    ws.addEventListener("message", (msg) => {
      let ev: { type?: string; [k: string]: unknown } = {};
      try {
        ev = JSON.parse(String(msg.data)) as { type?: string };
      } catch {
        return;
      }
      switch (ev.type) {
        case "conversation.item.input_audio_transcription.updated":
        case "conversation.item.input_audio_transcription.completed": {
          const text = String(ev.transcript ?? "").trim();
          const itemId = String(ev.item_id ?? "");
          if (text && itemId) upsertTurn(itemId, "caller", text);
          break;
        }
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done": {
          const text = String(ev.transcript ?? "").trim();
          const itemId = String(ev.item_id ?? `resp:${String(ev.response_id ?? "")}`);
          if (text) upsertTurn(itemId, "assistant", text);
          break;
        }
        case "response.function_call_arguments.done":
          if (ev.name === "end_call") {
            send({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: ev.call_id,
                output: JSON.stringify({ ok: true }),
              },
            });
            hangupRequested = true;
          } else if (ev.name === "transfer_call") {
            void handleSipTransfer(
              callId,
              rowId,
              String(ev.call_id ?? ""),
              String(ev.arguments ?? ""),
              transcript,
              send,
            );
          }
          break;
        case "response.done":
          // Give the goodbye audio a moment to play out before hanging up.
          if (hangupRequested) setTimeout(() => void hangup(), 2500);
          break;
        default:
          break;
      }
    });

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(cap);
      // The settled flag guarantees a single resolution; the rule can't see it.
      // oxlint-disable-next-line promise/no-multiple-resolved
      resolve();
    };
    ws.addEventListener("close", settle, { once: true });
    ws.addEventListener("error", () => {
      /* close follows */
    });
  });

  await finalize();
}
