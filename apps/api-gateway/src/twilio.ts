import type { ServerWebSocket } from "bun";
import twilioSdk from "twilio";
import { getConfig } from "./app-config";
import { endCall as lockCall, logCallEvent, saveTranscript } from "./calls";
import { findCenterByNumber, getCenter, getDefaultCenter, isAfterHours } from "./centers";
import { db } from "./db";
import { getAgentPrompt, PHONE_TRANSFER_APPENDIX } from "./prompt";
import { enqueueSummary, enqueueTransferEmail } from "./queue";
import { calls, type CenterRow, type TranscriptTurn } from "./schema";
import { findTransferTarget, type TransferTarget } from "./staff";

/**
 * Twilio Media Streams bridge — the phone path that needs no gated xAI
 * agents API, only the plain realtime endpoint this key already has.
 *
 *   caller → Twilio number → POST /api/twilio/incoming (signature-verified)
 *   → TwiML <Connect><Stream> → Twilio opens wss://…/api/twilio/stream
 *   → we bridge G.711 μ-law audio 1:1 into wss://api.x.ai/v1/realtime
 *     (xAI accepts and emits audio/pcmu natively — pure base64 passthrough)
 *
 * The session is the same receptionist the console runs: live prompt from
 * the database, force_message greeting, end_call tool. Turns persist as the
 * call runs; when either side hangs up the record locks and the summary job
 * enqueues — identical lifecycle to console calls.
 */

export async function twilioEnabled(): Promise<boolean> {
  const config = await getConfig();
  return Boolean(config.twilioAuthToken && config.xaiApiKey);
}

/** Transfers agreed mid-call, consumed by the resume webhook after the
 *  stream closes. rowId → destination. Entries expire after five minutes. */
const pendingTransfers = new Map<string, TransferTarget & { at: number }>();

function setPendingTransfer(rowId: string, target: TransferTarget): void {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [k, v] of pendingTransfers) if (v.at < cutoff) pendingTransfers.delete(k);
  pendingTransfers.set(rowId, { ...target, at: Date.now() });
}

function takePendingTransfer(rowId: string): TransferTarget | null {
  const t = pendingTransfers.get(rowId);
  if (!t) return null;
  pendingTransfers.delete(rowId);
  return Date.now() - t.at < 5 * 60 * 1000 ? t : null;
}

/** Twilio request validation, via the SDK's X-Twilio-Signature check. */
async function verifyTwilioSignature(
  url: string,
  params: URLSearchParams,
  signature: string | null,
): Promise<boolean> {
  const { twilioAuthToken } = await getConfig();
  if (!twilioAuthToken || !signature) return false;
  return twilioSdk.validateRequest(twilioAuthToken, signature, url, Object.fromEntries(params));
}

/** Voice webhook: create the call record and hand Twilio the stream TwiML. */
export async function handleTwilioIncoming(req: Request, publicOrigin: string): Promise<Response> {
  if (!(await twilioEnabled())) {
    return Response.json(
      { error: "Twilio bridge is not configured (add the Twilio auth token in Settings)." },
      { status: 503 },
    );
  }
  const reqUrl = new URL(req.url);
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const url = `${publicOrigin}${reqUrl.pathname}${reqUrl.search}`;
  if (!(await verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature")))) {
    return Response.json({ error: "Invalid Twilio signature." }, { status: 401 });
  }
  const from = params.get("From") ?? "unknown";
  // The dialed number picks the center: each center's Twilio number routes to
  // its own roster and prompt. Unmatched numbers land on the default center
  // so a half-configured line still answers.
  const to = params.get("To") ?? "";
  const center = (await findCenterByNumber(to)) ?? (await getDefaultCenter());
  if (!center) {
    return Response.json({ error: "No center is configured." }, { status: 503 });
  }
  // Past the center's cutoff the whole call is a message: message-only
  // prompt, no transfers, triaged on the Messages page next morning.
  const afterHours = isAfterHours(center);
  const [row] = await db
    .insert(calls)
    .values({
      userId: `phone:${from}`,
      centerId: center.id,
      kind: afterHours ? "message" : "standard",
      triage: afterHours ? "open" : "none",
    })
    .returning();
  await logCallEvent(
    row!.id,
    "call created",
    `twilio webhook from ${from} to ${to || "unknown"} (${center.name}${afterHours ? ", after hours" : ""})`,
  );
  const streamUrl = `${publicOrigin.replace(/^http/, "ws")}/api/twilio/stream`;
  // When the stream closes, TwiML continues to <Redirect>: the resume handler
  // dials the agreed transfer target, or hangs up if there is none.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="rowId" value="${row!.id}" />
      <Parameter name="centerId" value="${center.id}" />
      <Parameter name="from" value="${from.replaceAll('"', "")}" />
    </Stream>
  </Connect>
  <Redirect method="POST">${publicOrigin}/api/twilio/resume?rowId=${row!.id}</Redirect>
</Response>`;
  return new Response(twiml, { headers: { "content-type": "text/xml" } });
}

/** After the stream ends: connect the caller to the transfer target, if the
 *  agent arranged one, otherwise end the call. */
export async function handleTwilioResume(req: Request, publicOrigin: string): Promise<Response> {
  if (!(await twilioEnabled())) {
    return Response.json({ error: "Twilio bridge is not configured." }, { status: 503 });
  }
  const reqUrl = new URL(req.url);
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const url = `${publicOrigin}${reqUrl.pathname}${reqUrl.search}`;
  if (!(await verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature")))) {
    return Response.json({ error: "Invalid Twilio signature." }, { status: 401 });
  }
  const rowId = reqUrl.searchParams.get("rowId") ?? "";
  const target = rowId ? takePendingTransfer(rowId) : null;
  if (rowId) {
    await logCallEvent(
      rowId,
      target ? "dialing transfer" : "no transfer arranged, hanging up",
      target ? `${target.name} at ${target.phone}` : undefined,
    );
  }
  const twiml = target
    ? `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>${target.phone}</Dial>
</Response>`
    : `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;
  return new Response(twiml, { headers: { "content-type": "text/xml" } });
}

/* ── the media-stream bridge ──────────────────────────────────────────── */

interface TwilioStartEvent {
  event: "start";
  streamSid?: string;
  start?: { streamSid?: string; callSid?: string; customParameters?: Record<string, string> };
}
interface TwilioMediaEvent {
  event: "media";
  media?: { payload?: string; track?: string };
}
type TwilioEvent = TwilioStartEvent | TwilioMediaEvent | { event: string };

export interface TwilioSocketData {
  bridge: TwilioBridge | null;
}
type TwilioSocket = ServerWebSocket<TwilioSocketData>;

class TwilioBridge {
  private readonly twilio: TwilioSocket;
  private xai: WebSocket | null = null;
  private streamSid = "";
  private rowId = "";
  private centerId = "";
  /** Resolved once the xAI session opens; transfers scope to this roster. */
  private center: CenterRow | null = null;
  private from = "";
  private readonly transcript: TranscriptTurn[] = [];
  /** item_id -> transcript index: Grok re-sends cumulative transcripts per
   *  item, so turns are replaced in place, never appended twice. */
  private readonly turnIndex = new Map<string, number>();
  private hangupRequested = false;
  private finalized = false;
  private readonly cap: ReturnType<typeof setTimeout>;
  /** Live-redirect state: the Twilio CallSid (from the stream start event),
   *  the agreed target, and the fallback timer in case the mark echo — the
   *  signal that the goodbye audio finished playing — never arrives. */
  private callSid = "";
  private transferTarget: TransferTarget | null = null;
  private transferStarted = false;
  private transferTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(twilio: TwilioSocket) {
    this.twilio = twilio;
    // Safety net: a stuck call ends after 10 minutes.
    this.cap = setTimeout(() => this.shutdown(), 10 * 60 * 1000);
  }

  handleTwilio(raw: string): void {
    let ev: TwilioEvent;
    try {
      ev = JSON.parse(raw) as TwilioEvent;
    } catch {
      return;
    }
    switch (ev.event) {
      case "start": {
        const start = ev as TwilioStartEvent;
        this.streamSid = start.start?.streamSid ?? start.streamSid ?? "";
        this.callSid = start.start?.callSid ?? "";
        this.rowId = start.start?.customParameters?.rowId ?? "";
        this.centerId = start.start?.customParameters?.centerId ?? "";
        this.from = start.start?.customParameters?.from ?? "";
        if (this.rowId) void logCallEvent(this.rowId, "media stream started");
        void this.openXai();
        break;
      }
      case "media": {
        const media = ev as TwilioMediaEvent;
        const payload = media.media?.payload;
        if (payload && this.xai?.readyState === WebSocket.OPEN) {
          this.xai.send(JSON.stringify({ type: "input_audio_buffer.append", audio: payload }));
        }
        break;
      }
      case "mark":
        // Twilio echoes the mark once every queued audio before it has
        // played to the caller — the goodbye is done, transfer now.
        if (this.transferTarget) void this.executeTransfer();
        break;
      case "stop":
        this.shutdown();
        break;
      default:
        break;
    }
  }

  /** Redirect the live call to the target's phone through the REST API —
   *  immediate, no waiting for stream teardown. Falls back to the old
   *  close-stream → <Redirect> → <Dial> path if REST isn't possible. */
  private async executeTransfer(): Promise<void> {
    if (this.transferStarted || this.finalized) return;
    this.transferStarted = true;
    if (this.transferTimer) clearTimeout(this.transferTimer);
    const target = this.transferTarget;
    const config = await getConfig();
    if (target && this.callSid && config.twilioAccountSid && config.twilioAuthToken) {
      try {
        const twiml = `<Response><Dial>${target.phone}</Dial></Response>`;
        await twilioSdk(config.twilioAccountSid, config.twilioAuthToken)
          .calls(this.callSid)
          .update({ twiml });
        if (this.rowId) {
          await logCallEvent(
            this.rowId,
            "dialing transfer",
            `live redirect to ${target.name} at ${target.phone}`,
          );
        }
      } catch (e) {
        // REST refused (old creds, mid-hangup) — the stashed pendingTransfer
        // still dials through the resume webhook when the stream closes.
        if (this.rowId) {
          void logCallEvent(
            this.rowId,
            "live redirect failed, falling back",
            e instanceof Error ? e.message.slice(0, 150) : undefined,
          );
        }
      }
    }
    this.shutdown();
  }

  private async openXai(): Promise<void> {
    // Stale centerId (deleted mid-call, legacy stream) falls back to the
    // default center rather than dropping the caller.
    const center =
      (this.centerId ? await getCenter(this.centerId) : null) ?? (await getDefaultCenter());
    if (!center) {
      if (this.rowId) void logCallEvent(this.rowId, "no center found, ending call");
      this.shutdown();
      return;
    }
    this.center = center;
    const agent = await getAgentPrompt(center.id);
    if (!agent) {
      this.shutdown();
      return;
    }
    const { prompt, greeting, mode } = agent;
    const config = await getConfig();
    const params = new URLSearchParams({
      model: config.grokRealtimeModel,
      "reasoning.effort": "none",
    });
    const xai = new WebSocket(`wss://api.x.ai/v1/realtime?${params.toString()}`, {
      headers: { authorization: `Bearer ${config.xaiApiKey}` },
    } as unknown as string[]);
    this.xai = xai;

    const send = (e: Record<string, unknown>) => {
      if (xai.readyState === WebSocket.OPEN) xai.send(JSON.stringify(e));
    };

    xai.addEventListener("open", () => {
      send({
        type: "session.update",
        session: {
          type: "realtime",
          voice: config.grokRealtimeVoice,
          // Message mode has no transfer path — the appendix would fight it.
          instructions: mode === "message" ? prompt : `${prompt}\n\n${PHONE_TRANSFER_APPENDIX}`,
          reasoning: { effort: "none" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.6,
            silence_duration_ms: 300,
            prefix_padding_ms: 300,
            idle_timeout_ms: 15000,
          },
          audio: {
            // Twilio Media Streams speak G.711 μ-law @8k; xAI accepts and
            // emits it natively, so both directions are base64 passthrough.
            input: { format: { type: "audio/pcmu" }, transcription: { model: "grok-transcribe" } },
            output: { format: { type: "audio/pcmu" } },
          },
          // Message mode gets no transfer tool at all — after hours there
          // is nobody to dial, whatever the model decides.
          tools: [
            ...(mode === "message"
              ? []
              : [
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
                ]),
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
      if (this.rowId) void logCallEvent(this.rowId, "xai session opened, greeting sent");
    });

    xai.addEventListener("message", (msg) => {
      let ev: { type?: string; [k: string]: unknown } = {};
      try {
        ev = JSON.parse(String(msg.data)) as { type?: string };
      } catch {
        return;
      }
      switch (ev.type) {
        case "response.output_audio.delta":
        case "response.audio.delta": {
          const delta = ev.delta as string | undefined;
          if (delta && this.twilio.readyState === 1) {
            this.twilio.send(
              JSON.stringify({
                event: "media",
                streamSid: this.streamSid,
                media: { payload: delta },
              }),
            );
          }
          break;
        }
        case "input_audio_buffer.speech_started":
          // Barge-in: drop whatever Twilio has buffered toward the caller.
          if (this.twilio.readyState === 1) {
            this.twilio.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
          }
          break;
        case "conversation.item.input_audio_transcription.updated":
        case "conversation.item.input_audio_transcription.completed": {
          const text = String(ev.transcript ?? "").trim();
          const itemId = String(ev.item_id ?? "");
          if (text && itemId) this.upsertTurn(itemId, "caller", text);
          break;
        }
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done": {
          const text = String(ev.transcript ?? "").trim();
          const itemId = String(ev.item_id ?? `resp:${String(ev.response_id ?? "")}`);
          if (text) this.upsertTurn(itemId, "assistant", text);
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
            this.hangupRequested = true;
            if (this.rowId) void logCallEvent(this.rowId, "agent requested hangup (end_call)");
          } else if (ev.name === "transfer_call") {
            void this.handleTransfer(String(ev.call_id ?? ""), String(ev.arguments ?? ""), send);
          }
          break;
        case "response.done":
          // Give the goodbye audio a moment to reach the caller, then end.
          // Transfers don't ride on this — their mark echo/timer redirects
          // the live call and shutting down here would preempt it. The mark
          // is sent now, behind ALL queued goodbye audio; Twilio echoes it
          // when that audio has played to the caller.
          if (this.transferTarget) {
            if (this.twilio.readyState === 1) {
              this.twilio.send(
                JSON.stringify({
                  event: "mark",
                  streamSid: this.streamSid,
                  mark: { name: "transfer-goodbye" },
                }),
              );
            }
          } else if (this.hangupRequested) {
            setTimeout(() => this.shutdown(), 3000);
          }
          break;
        default:
          break;
      }
    });

    xai.addEventListener("close", () => this.shutdown(), { once: true });
    xai.addEventListener("error", () => {
      /* close follows */
    });
  }

  /** Resolve the spoken name to a reachable number; on success the resume
   *  webhook dials it once the stream closes. */
  private async handleTransfer(
    callId: string,
    argsRaw: string,
    send: (e: Record<string, unknown>) => void,
  ): Promise<void> {
    let name = "";
    try {
      name = String((JSON.parse(argsRaw) as { name?: unknown }).name ?? "");
    } catch {
      /* leave empty */
    }
    const target = name && this.center ? await findTransferTarget(name, this.center) : null;
    if (target && this.rowId) {
      setPendingTransfer(this.rowId, target);
      void logCallEvent(
        this.rowId,
        "transfer arranged",
        `asked for "${name}" -> ${target.name} (${target.section}) at ${target.phone}`,
      );
      this.transcript.push({
        role: "assistant",
        text: `(transferring the caller to ${target.name} in ${target.section})`,
      });
      this.persist();
      // Brief the receiver right now, while the goodbye still plays and
      // Twilio has yet to dial them.
      void enqueueTransferEmail({
        callId: this.rowId,
        target: { name: target.name, section: target.section, email: target.email },
        transcript: [...this.transcript],
        sourceLabel: this.from ? `Phone call from ${this.from}` : "Phone call",
        transferredAt: new Date().toISOString(),
        ...(this.center
          ? { center: { name: this.center.name, timezone: this.center.timezone } }
          : {}),
      });
      send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ ok: true, connecting: `${target.name} in ${target.section}` }),
        },
      });
      // Immediate hand-off: a mark rides behind the queued goodbye audio;
      // Twilio echoes it the moment that audio has played, and the echo
      // triggers the live REST redirect. The timer covers a lost echo, and
      // never racing on response.done fixes transfers that used to hang
      // until the idle timeout.
      this.hangupRequested = true;
      this.transferTarget = target;
      this.transferTimer = setTimeout(() => void this.executeTransfer(), 4000);
    } else {
      if (this.rowId) {
        void logCallEvent(this.rowId, "transfer failed", `asked for "${name}", nobody reachable`);
      }
      send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            error: "Nobody is available to take this transfer right now.",
          }),
        },
      });
      // Let the agent recover: apologize, offer a callback, then end_call.
      send({ type: "response.create" });
    }
  }

  private upsertTurn(itemId: string, role: "caller" | "assistant", text: string): void {
    const key = `${role}:${itemId}`;
    const at = this.turnIndex.get(key);
    if (at !== undefined) {
      this.transcript[at] = { role, text };
    } else {
      this.turnIndex.set(key, this.transcript.length);
      this.transcript.push({ role, text });
    }
    this.persist();
  }

  private persist(): void {
    if (this.rowId) {
      void saveTranscript(this.rowId, [...this.transcript]).catch(() => {});
    }
  }

  /** Close both legs and lock + summarize the record — exactly once. */
  shutdown(): void {
    if (this.finalized) return;
    this.finalized = true;
    clearTimeout(this.cap);
    if (this.transferTimer) clearTimeout(this.transferTimer);
    try {
      this.xai?.close();
    } catch {
      /* ignore */
    }
    try {
      // Closing the stream ends <Connect>, and with no further TwiML the
      // call hangs up on Twilio's side.
      this.twilio.close();
    } catch {
      /* ignore */
    }
    if (this.rowId) {
      const rowId = this.rowId;
      const transcript = [...this.transcript];
      void (async () => {
        const locked = await lockCall(rowId, transcript);
        if (locked) {
          await logCallEvent(rowId, "call ended", `stream closed, ${locked.durationSeconds ?? 0}s`);
          await enqueueSummary({ callId: rowId });
        }
      })().catch((e) => console.error("[twilio] finalize failed:", e));
    }
  }
}

export const twilioWebSocketHandlers = {
  open(ws: TwilioSocket): void {
    ws.data.bridge = new TwilioBridge(ws);
  },
  message(ws: TwilioSocket, message: string | Buffer): void {
    ws.data.bridge?.handleTwilio(String(message));
  },
  close(ws: TwilioSocket): void {
    ws.data.bridge?.shutdown();
    ws.data.bridge = null;
  },
};
