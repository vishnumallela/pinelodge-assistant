import { createHmac, timingSafeEqual } from "node:crypto";
import type { ServerWebSocket } from "bun";
import { endCall as lockCall, saveTranscript } from "./calls";
import { db } from "./db";
import { env } from "./env";
import { getAgentPrompt } from "./prompt";
import { enqueueSummary } from "./queue";
import { calls, type TranscriptTurn } from "./schema";

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

export function twilioEnabled(): boolean {
  return Boolean(env.TWILIO_AUTH_TOKEN && env.XAI_API_KEY);
}

/** Twilio request validation: base64(HMAC-SHA1(authToken, url + sorted params)). */
export function verifyTwilioSignature(
  url: string,
  params: URLSearchParams,
  signature: string | null,
): boolean {
  if (!env.TWILIO_AUTH_TOKEN || !signature) return false;
  const pieces = [...params.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}${v}`)
    .join("");
  const expected = createHmac("sha1", env.TWILIO_AUTH_TOKEN)
    .update(url + pieces)
    .digest();
  try {
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  } catch {
    return false;
  }
}

/** Voice webhook: create the call record and hand Twilio the stream TwiML. */
export async function handleTwilioIncoming(req: Request, publicOrigin: string): Promise<Response> {
  if (!twilioEnabled()) {
    return Response.json(
      { error: "Twilio bridge is not configured (set TWILIO_AUTH_TOKEN)." },
      { status: 503 },
    );
  }
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const url = `${publicOrigin}/api/twilio/incoming`;
  if (!verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature"))) {
    return Response.json({ error: "Invalid Twilio signature." }, { status: 401 });
  }
  const from = params.get("From") ?? "unknown";
  const [row] = await db
    .insert(calls)
    .values({ userId: `phone:${from}` })
    .returning();
  const streamUrl = `${publicOrigin.replace(/^http/, "ws")}/api/twilio/stream`;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="rowId" value="${row!.id}" />
      <Parameter name="from" value="${from.replaceAll('"', "")}" />
    </Stream>
  </Connect>
</Response>`;
  return new Response(twiml, { headers: { "content-type": "text/xml" } });
}

/* ── the media-stream bridge ──────────────────────────────────────────── */

interface TwilioStartEvent {
  event: "start";
  streamSid?: string;
  start?: { streamSid?: string; customParameters?: Record<string, string> };
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
  private userId = "";
  private readonly transcript: TranscriptTurn[] = [];
  private hangupRequested = false;
  private finalized = false;
  private readonly cap: ReturnType<typeof setTimeout>;

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
        this.rowId = start.start?.customParameters?.rowId ?? "";
        const from = start.start?.customParameters?.from ?? "unknown";
        this.userId = `phone:${from}`;
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
      case "stop":
        this.shutdown();
        break;
      default:
        break;
    }
  }

  private async openXai(): Promise<void> {
    const { prompt, greeting } = await getAgentPrompt();
    const params = new URLSearchParams({
      model: env.GROK_REALTIME_MODEL,
      "reasoning.effort": "none",
    });
    const xai = new WebSocket(`wss://api.x.ai/v1/realtime?${params.toString()}`, {
      headers: { authorization: `Bearer ${env.XAI_API_KEY}` },
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
          voice: env.GROK_REALTIME_VOICE,
          instructions: prompt,
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
          tools: [
            {
              type: "function",
              name: "end_call",
              description:
                "Hang up. Call this right after you say the redirect phrase and goodbye.",
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
      this.transcript.push({ role: "assistant", text: greeting });
      this.persist();
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
        case "conversation.item.input_audio_transcription.completed": {
          const text = String(ev.transcript ?? "").trim();
          if (text) {
            this.transcript.push({ role: "caller", text });
            this.persist();
          }
          break;
        }
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done": {
          const text = String(ev.transcript ?? "").trim();
          if (text) {
            this.transcript.push({ role: "assistant", text });
            this.persist();
          }
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
          }
          break;
        case "response.done":
          // Give the goodbye audio a moment to reach the caller, then end.
          if (this.hangupRequested) setTimeout(() => this.shutdown(), 3000);
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

  private persist(): void {
    if (this.rowId && this.userId) {
      void saveTranscript(this.userId, this.rowId, [...this.transcript]).catch(() => {});
    }
  }

  /** Close both legs and lock + summarize the record — exactly once. */
  shutdown(): void {
    if (this.finalized) return;
    this.finalized = true;
    clearTimeout(this.cap);
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
    if (this.rowId && this.userId) {
      const rowId = this.rowId;
      const userId = this.userId;
      const transcript = [...this.transcript];
      void (async () => {
        const locked = await lockCall(userId, rowId, transcript);
        if (locked) await enqueueSummary({ callId: rowId, userId });
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
