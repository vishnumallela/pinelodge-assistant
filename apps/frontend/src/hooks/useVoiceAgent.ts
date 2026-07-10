/**
 * xAI Grok realtime voice hook — raw WebSocket to wss://api.x.ai/v1/realtime.
 *
 * Grok's realtime API is OpenAI-Realtime compatible at the event level; the
 * browser transport is a WebSocket carrying base64 PCM16 audio. Latency-first
 * design, per xAI docs + the official cookbook clients:
 *
 *   - capture: AudioWorklet on a shared 24 kHz AudioContext (the browser
 *     resamples the mic natively — no lossy JS resampler), ~21 ms frames
 *   - playback: AudioWorklet ring buffer, routed through an <audio> element
 *     via MediaStreamDestination so the browser echo canceller sees it —
 *     the mic no longer hears the agent, so barge-in is real speech only
 *   - mic frames buffer locally while the socket configures, then flush,
 *     so the caller can talk from the very first moment
 *   - reasoning.effort "none" + server_vad silence 300 ms for fast turns
 *   - greeting is a force_message item: server TTS speaks it verbatim with
 *     zero model latency
 *   - barge-in: flush the ring locally, drop late deltas of the cancelled
 *     item, response.cancel, then conversation.item.truncate from the flush
 *     ack (the only moment the played-frame count is exact)
 *   - resumption enabled; one automatic reconnect with conversation_id
 *
 * The xAI API key never reaches the browser: the backend mints a short-lived
 * ephemeral client secret, passed as the WS subprotocol.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TARGET_RATE = 24000;
const WS_ENDPOINT = "wss://api.x.ai/v1/realtime";
const DEFAULT_MODEL = "grok-voice-think-fast-1.0";
const DEFAULT_VOICE = "ara";
/** Cap on mic audio buffered before the session is configured (~3 s). */
const PREBUFFER_MAX_CHUNKS = 150;
/** Drop mic frames rather than queue them on a congested socket. */
const BACKPRESSURE_BYTES = 64 * 1024;

/* ── tunable session config ───────────────────────────────────────────────
 * The knobs that shape a call — model, voice, reasoning depth, VAD turn
 * detection, playback speed. Everything here is UI-tunable (see
 * VoiceSettingsProvider); the hook snapshots the config at connect() so a
 * reconnect resumes with the exact settings the call started with.
 */

export type ReasoningEffort = "high" | "none";

/** Grok voice models. Only -latest and -think-fast support reasoning. */
export const VOICE_MODELS = [
  "grok-voice-latest",
  "grok-voice-think-fast-1.0",
  "grok-voice-fast-1.0",
] as const;

/** Built-in xAI voices (GET /v1/tts/voices); a custom voice id also works. */
export const BUILTIN_VOICES = ["ara", "eve", "leo", "rex", "sal"] as const;

export function modelSupportsReasoning(model: string): boolean {
  return model === "grok-voice-latest" || model === "grok-voice-think-fast-1.0";
}

export interface VoiceTurnDetection {
  /** VAD sensitivity, 0–1. Higher = needs louder speech to trigger. */
  threshold: number;
  /** Silence after speech before the turn is committed. */
  silenceDurationMs: number;
  /** Audio kept before detected speech, so onsets aren't clipped. */
  prefixPaddingMs: number;
  /** Idle time before the server generates a proactive check-in. */
  idleTimeoutMs: number;
}

export interface VoiceSessionConfig {
  model?: string;
  voice?: string;
  reasoningEffort?: ReasoningEffort;
  turnDetection?: VoiceTurnDetection;
  /** Assistant playback speed multiplier (1.0 = normal). */
  outputSpeed?: number;
}

export const DEFAULT_TURN_DETECTION: VoiceTurnDetection = {
  threshold: 0.6,
  silenceDurationMs: 300,
  prefixPaddingMs: 300,
  idleTimeoutMs: 15000,
};

export const DEFAULT_VOICE_SESSION_CONFIG: Required<VoiceSessionConfig> = {
  model: DEFAULT_MODEL,
  voice: DEFAULT_VOICE,
  reasoningEffort: "none",
  turnDetection: DEFAULT_TURN_DETECTION,
  outputSpeed: 1.0,
};

/** Fill any missing field from defaults so partial configs are safe to use. */
function resolveSessionConfig(cfg: VoiceSessionConfig | undefined): Required<VoiceSessionConfig> {
  return {
    model: cfg?.model || DEFAULT_VOICE_SESSION_CONFIG.model,
    voice: cfg?.voice || DEFAULT_VOICE_SESSION_CONFIG.voice,
    reasoningEffort: cfg?.reasoningEffort ?? DEFAULT_VOICE_SESSION_CONFIG.reasoningEffort,
    turnDetection: { ...DEFAULT_TURN_DETECTION, ...cfg?.turnDetection },
    outputSpeed: cfg?.outputSpeed ?? DEFAULT_VOICE_SESSION_CONFIG.outputSpeed,
  };
}

export interface VoiceFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  handler?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  /** Skip the follow-up response.create (e.g. end_call — nothing to say). */
  suppressResponse?: boolean;
}

export interface VoiceTokenInfo {
  token: string;
  model?: string;
  voice?: string;
}

export interface UseVoiceAgentOptions {
  getToken: () => Promise<VoiceTokenInfo>;
  instructions?: string;
  tools?: VoiceFunctionTool[];
  /** Spoken verbatim by the server (force_message) as the call opens. */
  greeting?: string;
  /** UI-tunable session knobs; snapshotted per call. Missing fields default. */
  sessionConfig?: VoiceSessionConfig;
  onError?: (message: string) => void;
}

type VoiceStatus = "idle" | "connecting" | "connected" | "error" | "closed";

interface VoiceHistoryItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "in_progress" | "completed";
  responseId?: string;
}

export interface UseVoiceAgentReturn {
  status: VoiceStatus;
  isConnected: boolean;
  isUserSpeaking: boolean;
  isAgentSpeaking: boolean;
  isAgentThinking: boolean;
  isToolRunning: boolean;
  isMuted: boolean;
  history: VoiceHistoryItem[];
  connect: (overrides?: { instructions?: string; greeting?: string }) => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  sendText: (text: string) => void;
}

/* ── audio worklets ───────────────────────────────────────────────────────
 * Both processors live in one Blob module. Capture accumulates render quanta
 * and posts ~21 ms Float32 frames (transferred, zero-copy). The player is a
 * ring buffer: enqueue via port, 48 ms prebuffer after empty, sample-accurate
 * flush on barge-in, and it reports playing-state transitions + frames played
 * (the truncation clock — exact in the flush ack).
 */

const WORKLET_SOURCE = `
class PLCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.flush = options.processorOptions.flushFrames;
    this.buf = new Float32Array(this.flush);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const take = Math.min(ch.length - i, this.flush - this.n);
      this.buf.set(ch.subarray(i, i + take), this.n);
      this.n += take;
      i += take;
      if (this.n === this.flush) {
        const out = this.buf;
        this.port.postMessage(out, [out.buffer]);
        this.buf = new Float32Array(this.flush);
        this.n = 0;
      }
    }
    return true;
  }
}
class PLPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunks = [];
    this.offset = 0;
    this.buffered = 0;
    this.played = 0;
    this.playing = false;
    this.waiting = true;
    this.hold = options.processorOptions.holdFrames;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === "flush") {
        this.chunks = [];
        this.offset = 0;
        this.buffered = 0;
        this.waiting = true;
        this.port.postMessage({ type: "flushed", played: this.played });
        if (this.playing) {
          this.playing = false;
          this.port.postMessage({ type: "state", playing: false, played: this.played });
        }
      } else {
        this.chunks.push(d);
        this.buffered += d.length;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    if (this.waiting && this.buffered >= this.hold) this.waiting = false;
    if (this.waiting || this.buffered === 0) {
      if (this.buffered === 0) this.waiting = true;
      if (this.playing) {
        this.playing = false;
        this.port.postMessage({ type: "state", playing: false, played: this.played });
      }
      return true;
    }
    let i = 0;
    while (i < out.length && this.chunks.length > 0) {
      const head = this.chunks[0];
      const take = Math.min(out.length - i, head.length - this.offset);
      out.set(head.subarray(this.offset, this.offset + take), i);
      i += take;
      this.offset += take;
      this.buffered -= take;
      this.played += take;
      if (this.offset === head.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    if (!this.playing) {
      this.playing = true;
      this.port.postMessage({ type: "state", playing: true });
    }
    return true;
  }
}
registerProcessor("pl-capture", PLCapture);
registerProcessor("pl-player", PLPlayer);
`;

/* ── PCM helpers ──────────────────────────────────────────────────────── */

function floatToBase64PCM16(input: Float32Array): string {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f32[i] = int16[i]! / 32768;
  return f32;
}

/** Playback-only resample for the fallback path (context not at 24 kHz). */
function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.round(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = idx - i0;
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
  }
  return out;
}

/* ── the hook ─────────────────────────────────────────────────────────── */

export function useVoiceAgent(options: UseVoiceAgentOptions): UseVoiceAgentReturn {
  const optsRef = useRef(options);
  optsRef.current = options;

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [isToolRunning, setIsToolRunning] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [history, setHistory] = useState<VoiceHistoryItem[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const playerNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(false);
  const silentFrameRef = useRef<{ len: number; b64: string } | null>(null);
  const genRef = useRef(0);
  const connectingRef = useRef(false);
  const ctxRateRef = useRef(TARGET_RATE);
  const configSentRef = useRef(false);
  const preBufferRef = useRef<string[]>([]);
  const connectedTimerRef = useRef<number | null>(null);
  const userSpeakingRef = useRef(false);
  const agentSpeakingRef = useRef(false);
  const agentThinkingRef = useRef(false);
  const responseActiveRef = useRef(false);
  const pendingToolResponseRef = useRef(false);
  const voiceRef = useRef(DEFAULT_VOICE);
  const sessionConfigRef = useRef<Required<VoiceSessionConfig>>(DEFAULT_VOICE_SESSION_CONFIG);
  const instructionsRef = useRef<string | undefined>(undefined);
  const greetingRef = useRef<string | undefined>(undefined);
  const greetingSentRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const reconnectsLeftRef = useRef(1);
  const wasConnectedRef = useRef(false);
  // Truncation clock: frames enqueued to the player, and where the current
  // assistant audio item started — resynced to the exact played count on
  // every flush ack / drain (the ring is empty at those moments).
  const enqueuedFramesRef = useRef(0);
  const playedFramesRef = useRef(0);
  const currentItemRef = useRef<{ id: string; startFrame: number } | null>(null);
  const pendingTruncateRef = useRef<{ id: string; startFrame: number } | null>(null);
  const droppedItemRef = useRef<string | null>(null);

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }, []);

  const upsert = useCallback(
    (id: string, patch: Partial<VoiceHistoryItem> & { role: "user" | "assistant" }) => {
      setHistory((prev) => {
        const idx = prev.findIndex((h) => h.id === id);
        if (idx === -1) {
          return [
            ...prev,
            { id, role: patch.role, text: patch.text ?? "", status: patch.status ?? "in_progress" },
          ];
        }
        const next = prev.slice();
        next[idx] = { ...next[idx]!, ...patch };
        return next;
      });
    },
    [],
  );

  const teardown = useCallback(() => {
    if (connectedTimerRef.current != null) {
      window.clearTimeout(connectedTimerRef.current);
      connectedTimerRef.current = null;
    }
    captureNodeRef.current?.port.close();
    try {
      captureNodeRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    captureNodeRef.current = null;
    playerNodeRef.current?.port.close();
    try {
      playerNodeRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    playerNodeRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
    try {
      void ctxRef.current?.close();
    } catch {
      /* ignore */
    }
    ctxRef.current = null;
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    preBufferRef.current = [];
    configSentRef.current = false;
    agentSpeakingRef.current = false;
    agentThinkingRef.current = false;
    responseActiveRef.current = false;
    setIsUserSpeaking(false);
    setIsAgentSpeaking(false);
    setIsAgentThinking(false);
    setIsToolRunning(false);
  }, []);

  /** Terminal failure: release the mic and surface the message. */
  const fail = useCallback(
    (message: string) => {
      teardown();
      setStatus("error");
      try {
        optsRef.current.onError?.(message);
      } catch {
        /* ignore */
      }
    },
    [teardown],
  );

  const sendSessionConfig = useCallback(() => {
    if (configSentRef.current) return;
    configSentRef.current = true;
    const o = optsRef.current;
    const cfg = sessionConfigRef.current;
    const session: Record<string, unknown> = {
      type: "realtime",
      voice: voiceRef.current,
      // Snapshotted at connect() so a reconnect resumes with the exact
      // prompt the call started with.
      instructions: instructionsRef.current ?? "You are a helpful voice assistant.",
      turn_detection: {
        type: "server_vad",
        threshold: cfg.turnDetection.threshold,
        silence_duration_ms: cfg.turnDetection.silenceDurationMs,
        prefix_padding_ms: cfg.turnDetection.prefixPaddingMs,
        idle_timeout_ms: cfg.turnDetection.idleTimeoutMs,
      },
      resumption: { enabled: true },
      audio: {
        input: {
          format: { type: "audio/pcm", rate: ctxRateRef.current },
          transcription: { model: "grok-transcribe" },
        },
        output: {
          // Always 24 kHz from the server; the fallback path resamples
          // locally to the context rate on enqueue.
          format: { type: "audio/pcm", rate: TARGET_RATE },
          speed: cfg.outputSpeed,
        },
      },
      tools: (o.tools ?? []).map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
      // Server drops transcribed input that matches what the agent just
      // said — a second line of defence against echo re-triggering VAD.
      enable_echo_detection_filtering: true,
    };
    // Extended reasoning defaults on and costs ~0.5s time-to-first-audio; only
    // sent for models that support it (the fast model has no reasoning stage).
    if (modelSupportsReasoning(cfg.model)) {
      session.reasoning = { effort: cfg.reasoningEffort };
    }
    sendEvent({ type: "session.update", session });
    // Scripted greeting: the server TTS-speaks a force_message verbatim with
    // zero model latency; exactly once per call, never on reconnect.
    const greeting = greetingRef.current;
    if (greeting && !greetingSentRef.current) {
      greetingSentRef.current = true;
      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "force_message",
          role: "assistant",
          content: [{ type: "output_text", text: greeting }],
        },
      });
    }
    // Mic audio buffered during setup goes out now, oldest first.
    for (const audio of preBufferRef.current)
      sendEvent({ type: "input_audio_buffer.append", audio });
    preBufferRef.current = [];
    // xAI does not consistently ACK session.update; don't gate the call on it.
    if (connectedTimerRef.current != null) window.clearTimeout(connectedTimerRef.current);
    const myGen = genRef.current;
    connectedTimerRef.current = window.setTimeout(() => {
      if (myGen !== genRef.current) return;
      setStatus((s) => (s === "connecting" ? "connected" : s));
    }, 2000);
  }, [sendEvent]);

  const flushPlayback = useCallback(() => {
    // MessagePort.postMessage has no targetOrigin — the rule targets Window.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    playerNodeRef.current?.port.postMessage("flush");
    agentSpeakingRef.current = false;
    setIsAgentSpeaking(false);
  }, []);

  const runToolCall = useCallback(
    async (name: string, callId: string, argsRaw: string) => {
      let args: Record<string, unknown> = {};
      try {
        args = argsRaw ? (JSON.parse(argsRaw) as Record<string, unknown>) : {};
      } catch {
        /* leave empty */
      }
      setIsToolRunning(true);

      const tool = optsRef.current.tools?.find((t) => t.name === name);
      let output: unknown = { ok: true };
      if (tool?.handler) {
        try {
          output = await tool.handler(args);
        } catch (e) {
          output = { error: e instanceof Error ? e.message : String(e) };
        }
      }

      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: typeof output === "string" ? output : JSON.stringify(output),
        },
      });
      if (!tool?.suppressResponse) {
        // Defer the follow-up until the line is actually free: mid-utterance
        // or mid-playback response.create overlaps audio.
        if (userSpeakingRef.current || agentSpeakingRef.current) {
          pendingToolResponseRef.current = true;
        } else {
          sendEvent({ type: "response.create" });
        }
      }
      setIsToolRunning(false);
    },
    [sendEvent],
  );

  const maybeFirePendingResponse = useCallback(() => {
    if (pendingToolResponseRef.current && !userSpeakingRef.current && !agentSpeakingRef.current) {
      pendingToolResponseRef.current = false;
      sendEvent({ type: "response.create" });
    }
  }, [sendEvent]);

  const handleServerEvent = useCallback(
    (ev: { type: string; [k: string]: unknown }) => {
      switch (ev.type) {
        case "conversation.created":
          wasConnectedRef.current = true;
          conversationIdRef.current =
            ((ev.conversation as { id?: string } | undefined)?.id as string | undefined) ??
            (ev.conversation_id as string | undefined) ??
            conversationIdRef.current;
          sendSessionConfig();
          break;

        case "session.created":
          wasConnectedRef.current = true;
          sendSessionConfig();
          break;

        case "session.updated":
          if (connectedTimerRef.current != null) {
            window.clearTimeout(connectedTimerRef.current);
            connectedTimerRef.current = null;
          }
          setStatus("connected");
          break;

        case "input_audio_buffer.speech_started": {
          userSpeakingRef.current = true;
          setIsUserSpeaking(true);
          // Barge-in: anything generating or still in the ring (including the
          // prebuffer window before "playing" flips) gets cut. The truncate
          // itself is sent from the flush ack — the only exact played count.
          const audioPending = enqueuedFramesRef.current > playedFramesRef.current;
          if (
            agentSpeakingRef.current ||
            agentThinkingRef.current ||
            responseActiveRef.current ||
            audioPending
          ) {
            pendingTruncateRef.current = currentItemRef.current;
            droppedItemRef.current = currentItemRef.current?.id ?? null;
            flushPlayback();
            sendEvent({ type: "response.cancel" });
          }
          break;
        }

        case "input_audio_buffer.speech_stopped":
          userSpeakingRef.current = false;
          setIsUserSpeaking(false);
          maybeFirePendingResponse();
          break;

        // Grok streams a cumulative, self-correcting user transcript —
        // replace, never append.
        case "conversation.item.input_audio_transcription.updated": {
          const text = ((ev.transcript as string) ?? "").trim();
          const id = ev.item_id as string | undefined;
          if (text && id) upsert(id, { role: "user", text, status: "in_progress" });
          break;
        }

        case "conversation.item.input_audio_transcription.completed": {
          const text = ((ev.transcript as string) ?? "").trim();
          if (text) {
            upsert((ev.item_id as string) ?? crypto.randomUUID(), {
              role: "user",
              text,
              status: "completed",
            });
          }
          break;
        }

        case "response.created":
          responseActiveRef.current = true;
          agentThinkingRef.current = true;
          droppedItemRef.current = null;
          setIsAgentThinking(true);
          break;

        case "response.output_audio.delta":
        case "response.audio.delta": {
          const delta = ev.delta as string | undefined;
          if (!delta) break;
          const itemId = (ev.item_id as string | undefined) ?? "unknown";
          // Late frames of an interrupted item keep streaming after the
          // cancel — playing them would talk over the caller.
          if (droppedItemRef.current !== null && itemId === droppedItemRef.current) break;
          agentThinkingRef.current = false;
          setIsAgentThinking(false);
          if (currentItemRef.current?.id !== itemId) {
            currentItemRef.current = { id: itemId, startFrame: enqueuedFramesRef.current };
          }
          let f32 = base64ToFloat32(delta);
          if (ctxRateRef.current !== TARGET_RATE) {
            f32 = resampleLinear(f32, TARGET_RATE, ctxRateRef.current);
          }
          enqueuedFramesRef.current += f32.length;
          playerNodeRef.current?.port.postMessage(f32, [f32.buffer]);
          break;
        }

        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done": {
          const text = ((ev.transcript as string) ?? "").trim();
          if (text) {
            upsert((ev.item_id as string) ?? crypto.randomUUID(), {
              role: "assistant",
              text,
              status: "completed",
              responseId: ev.response_id as string | undefined,
            });
          }
          break;
        }

        case "response.function_call_arguments.done":
          void runToolCall(ev.name as string, ev.call_id as string, (ev.arguments as string) ?? "");
          break;

        case "response.done":
          responseActiveRef.current = false;
          agentThinkingRef.current = false;
          setIsAgentThinking(false);
          maybeFirePendingResponse();
          break;

        case "error": {
          const e = ev.error as { message?: string; code?: string } | undefined;
          const msg = e?.message ?? "Realtime error";
          const code = e?.code ?? "";
          // Benign races and optional features the server may not accept.
          if (
            /not found|no active response|cancel|already has an active response|truncate|echo_detection|force_message/i.test(
              `${msg} ${code}`,
            )
          ) {
            break;
          }
          fail(msg);
          break;
        }

        default:
          break;
      }
    },
    [
      fail,
      flushPlayback,
      maybeFirePendingResponse,
      runToolCall,
      sendEvent,
      sendSessionConfig,
      upsert,
    ],
  );

  /* ── audio pipeline ─────────────────────────────────────────────────── */

  const setupAudio = useCallback(async (): Promise<void> => {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        // Hardware voice isolation where available; ignored elsewhere.
        ...({ voiceIsolation: true } as MediaTrackConstraints),
      },
    });
    micStreamRef.current = mic;

    // One shared context at the wire rate: the browser sinc-resamples the mic
    // natively, so no lossy JS resampler and no server-side resample either.
    let attempt: AudioContext | undefined;
    let ctx: AudioContext;
    let source: MediaStreamAudioSourceNode;
    try {
      attempt = new AudioContext({ sampleRate: TARGET_RATE, latencyHint: "interactive" });
      source = attempt.createMediaStreamSource(mic);
      ctx = attempt;
      ctxRateRef.current = TARGET_RATE;
    } catch {
      // Older Firefox can't mix stream/context rates: run at the device rate,
      // declare it for input, and resample playback locally.
      try {
        void attempt?.close();
      } catch {
        /* ignore */
      }
      ctx = new AudioContext({ latencyHint: "interactive" });
      source = ctx.createMediaStreamSource(mic);
      ctxRateRef.current = Math.round(ctx.sampleRate);
    }
    ctxRef.current = ctx;
    void ctx.resume();

    const workletUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
    );
    try {
      await ctx.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }

    // ~21 ms mic frames, in whole render quanta.
    const flushFrames = Math.max(1, Math.round((ctxRateRef.current * 0.021) / 128)) * 128;
    const capture = new AudioWorkletNode(ctx, "pl-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { flushFrames },
    });
    captureNodeRef.current = capture;
    capture.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const ws = wsRef.current;
      const live = configSentRef.current && ws && ws.readyState === WebSocket.OPEN;
      if (live && ws.bufferedAmount > BACKPRESSURE_BYTES) return;
      // While muted, stream silence instead of nothing: dropping frames
      // freezes the server's VAD timeline mid-utterance.
      let audio: string;
      if (mutedRef.current) {
        if (silentFrameRef.current?.len !== e.data.length) {
          silentFrameRef.current = {
            len: e.data.length,
            b64: floatToBase64PCM16(new Float32Array(e.data.length)),
          };
        }
        audio = silentFrameRef.current.b64;
      } else {
        audio = floatToBase64PCM16(e.data);
      }
      if (live) {
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
      } else {
        preBufferRef.current.push(audio);
        if (preBufferRef.current.length > PREBUFFER_MAX_CHUNKS) preBufferRef.current.shift();
      }
    };
    source.connect(capture);

    // Player worklet → MediaStreamDestination → <audio>: media-element
    // playback runs through the echo-cancellation reference path, so the mic
    // does not hear the agent.
    const player = new AudioWorkletNode(ctx, "pl-player", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { holdFrames: Math.round(ctxRateRef.current * 0.048) },
    });
    playerNodeRef.current = player;
    player.port.onmessage = (
      e: MessageEvent<{ type: string; playing?: boolean; played?: number }>,
    ) => {
      const d = e.data;
      if (typeof d.played === "number") {
        playedFramesRef.current = d.played;
        // The ring is empty at every flush/drain report: the enqueue clock
        // re-anchors to reality (discarded frames never play).
        enqueuedFramesRef.current = d.played;
        if (d.type === "flushed") {
          currentItemRef.current = null;
          const t = pendingTruncateRef.current;
          pendingTruncateRef.current = null;
          if (t && t.id !== "unknown") {
            const playedMs = Math.max(
              0,
              Math.round(((d.played - t.startFrame) / ctxRateRef.current) * 1000),
            );
            sendEvent({
              type: "conversation.item.truncate",
              item_id: t.id,
              content_index: 0,
              audio_end_ms: playedMs,
            });
          }
        }
      }
      if (d.type === "state") {
        agentSpeakingRef.current = Boolean(d.playing);
        setIsAgentSpeaking(Boolean(d.playing));
        if (!d.playing) maybeFirePendingResponse();
      }
    };
    const sink = ctx.createMediaStreamDestination();
    player.connect(sink);
    const audioEl = new Audio();
    audioEl.srcObject = sink.stream;
    audioEl.autoplay = true;
    audioElRef.current = audioEl;
    void audioEl.play().catch(() => undefined);
  }, [maybeFirePendingResponse, sendEvent]);

  const disconnect = useCallback(() => {
    genRef.current++;
    connectingRef.current = false;
    teardown();
    conversationIdRef.current = null;
    wasConnectedRef.current = false;
    setStatus("closed");
  }, [teardown]);

  const openSocket = useCallback(
    (myGen: number, tokenInfo: VoiceTokenInfo) => {
      configSentRef.current = false;
      const key = tokenInfo.token;
      const proto = key.startsWith("xai-client-secret.") ? key : `xai-client-secret.${key}`;
      const cfg = sessionConfigRef.current;
      const model = cfg.model || tokenInfo.model || DEFAULT_MODEL;
      const params = new URLSearchParams({ model });
      if (modelSupportsReasoning(model)) params.set("reasoning.effort", cfg.reasoningEffort);
      if (conversationIdRef.current) params.set("conversation_id", conversationIdRef.current);
      const ws = new WebSocket(`${WS_ENDPOINT}?${params.toString()}`, [proto]);
      wsRef.current = ws;

      ws.onmessage = (msg) => {
        if (myGen !== genRef.current) return;
        try {
          handleServerEvent(JSON.parse(msg.data as string) as { type: string });
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onerror = () => {
        /* onclose always follows and carries the decision */
      };
      ws.onclose = () => {
        if (myGen !== genRef.current) return;
        // Unexpected drop mid-call: resume once with the conversation id —
        // the server replays cached history.
        if (wasConnectedRef.current && reconnectsLeftRef.current > 0) {
          reconnectsLeftRef.current--;
          setStatus("connecting");
          void (async () => {
            try {
              const t = await optsRef.current.getToken();
              if (myGen !== genRef.current) return;
              openSocket(myGen, t);
            } catch {
              if (myGen !== genRef.current) return;
              fail("Connection lost. Check your network and try again.");
            }
          })();
          return;
        }
        if (!wasConnectedRef.current) {
          fail("Could not reach the voice service. Try again.");
          return;
        }
        // Server ended the call: release the mic before reporting closed.
        teardown();
        setStatus((s) => (s === "error" ? s : "closed"));
      };
    },
    [fail, handleServerEvent, teardown],
  );

  const connect = useCallback(
    async (overrides?: { instructions?: string; greeting?: string }) => {
      if (wsRef.current || connectingRef.current) return;
      connectingRef.current = true;
      const myGen = ++genRef.current;
      setHistory([]);
      setStatus("connecting");
      conversationIdRef.current = null;
      wasConnectedRef.current = false;
      greetingSentRef.current = false;
      reconnectsLeftRef.current = 1;
      userSpeakingRef.current = false;
      agentSpeakingRef.current = false;
      agentThinkingRef.current = false;
      responseActiveRef.current = false;
      pendingToolResponseRef.current = false;
      pendingTruncateRef.current = null;
      droppedItemRef.current = null;
      preBufferRef.current = [];
      enqueuedFramesRef.current = 0;
      playedFramesRef.current = 0;
      currentItemRef.current = null;
      // Fresh values win over render-time options: the caller fetches the live
      // prompt (availability-dependent) right before connecting.
      instructionsRef.current = overrides?.instructions ?? optsRef.current.instructions;
      greetingRef.current = overrides?.greeting ?? optsRef.current.greeting;
      // Snapshot the tunable session config so a reconnect (openSocket runs
      // again) uses the exact model/voice/VAD the call started with.
      sessionConfigRef.current = resolveSessionConfig(optsRef.current.sessionConfig);
      voiceRef.current = sessionConfigRef.current.voice;

      try {
        // Token and audio pipeline in parallel — the mic buffers locally until
        // the session is configured, so nothing the caller says is lost.
        const [tokenResult, audioResult] = await Promise.allSettled([
          optsRef.current.getToken(),
          setupAudio(),
        ]);
        if (myGen !== genRef.current) {
          teardown();
          return;
        }
        if (audioResult.status === "rejected") {
          const e = audioResult.reason as Error;
          fail(
            e?.name === "NotAllowedError"
              ? "Microphone permission denied"
              : `Microphone error: ${e?.message ?? String(e)}`,
          );
          return;
        }
        if (tokenResult.status === "rejected" || !tokenResult.value?.token) {
          fail(
            tokenResult.status === "rejected"
              ? ((tokenResult.reason as Error)?.message ?? "Could not get a voice token")
              : "Could not get a voice token",
          );
          return;
        }
        // Voice is driven by the UI-tunable config (set above); the token's
        // env-provided voice is only a fallback when the config left it unset.
        if (!optsRef.current.sessionConfig?.voice && tokenResult.value.voice) {
          voiceRef.current = tokenResult.value.voice;
        }
        openSocket(myGen, tokenResult.value);
      } finally {
        connectingRef.current = false;
      }
    },
    [fail, openSocket, setupAudio, teardown],
  );

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setIsMuted(mutedRef.current);
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !wsRef.current) return;
      // Typed input is a barge-in: cut any active response so the reply is
      // generated with this message in context instead of colliding.
      if (responseActiveRef.current || agentSpeakingRef.current) {
        droppedItemRef.current = currentItemRef.current?.id ?? null;
        pendingTruncateRef.current = null;
        flushPlayback();
        sendEvent({ type: "response.cancel" });
      }
      sendEvent({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: trimmed }] },
      });
      sendEvent({ type: "response.create" });
      upsert(crypto.randomUUID(), { role: "user", text: trimmed, status: "completed" });
    },
    [flushPlayback, sendEvent, upsert],
  );

  useEffect(() => () => disconnect(), [disconnect]);

  return useMemo<UseVoiceAgentReturn>(
    () => ({
      status,
      isConnected: status === "connected",
      isUserSpeaking,
      isAgentSpeaking,
      isAgentThinking,
      isToolRunning,
      isMuted,
      history,
      connect,
      disconnect,
      toggleMute,
      sendText,
    }),
    [
      status,
      isUserSpeaking,
      isAgentSpeaking,
      isAgentThinking,
      isToolRunning,
      isMuted,
      history,
      connect,
      disconnect,
      toggleMute,
      sendText,
    ],
  );
}
