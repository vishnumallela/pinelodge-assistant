/**
 * xAI Grok realtime voice hook — raw WebSocket to wss://api.x.ai/v1/realtime.
 *
 * Grok's realtime API is OpenAI-Realtime compatible at the event level, but
 * the browser transport is a WebSocket carrying base64 PCM16 audio, so this
 * hook does the audio plumbing itself:
 *
 *   - mic capture → resample to 24 kHz → PCM16 → base64 → input_audio_buffer.append
 *   - server audio → response.output_audio.delta (base64 PCM16) → scheduled playback
 *   - server VAD handles turn-taking; local playback clears on barge-in
 *
 * The xAI API key never reaches the browser: the backend mints a short-lived
 * ephemeral client secret, passed as the WS subprotocol.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TARGET_RATE = 24000;
const WS_ENDPOINT = "wss://api.x.ai/v1/realtime";
const DEFAULT_MODEL = "grok-voice-latest";
const DEFAULT_VOICE = "eve";

export interface VoiceFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  handler?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
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
  onError?: (message: string) => void;
}

export type VoiceStatus = "idle" | "connecting" | "connected" | "error" | "closed";

export interface VoiceHistoryItem {
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
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  sendText: (text: string) => void;
}

/* ── audio helpers ────────────────────────────────────────────────────── */

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

function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
}

function resampleTo24k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_RATE) return input;
  const ratio = inputRate / TARGET_RATE;
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

/** Schedules base64 PCM16 chunks into gap-free playback. */
class PcmPlayer {
  ctx: AudioContext;
  gain: GainNode;
  playhead = 0;
  sources = new Set<AudioBufferSourceNode>();

  constructor() {
    type Ctor = typeof AudioContext;
    const AC = (window.AudioContext ||
      (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext) as Ctor;
    try {
      this.ctx = new AC({ sampleRate: TARGET_RATE });
    } catch {
      this.ctx = new AC();
    }
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
  }

  resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  enqueue(int16: Int16Array): void {
    if (int16.length === 0) return;
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i]! / 32768;
    const audioBuf = this.ctx.createBuffer(1, f32.length, TARGET_RATE);
    audioBuf.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this.gain);
    const startAt = Math.max(this.ctx.currentTime + 0.02, this.playhead);
    src.start(startAt);
    this.playhead = startAt + audioBuf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** Barge-in: stop everything currently scheduled. */
  clear(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.playhead = this.ctx.currentTime;
  }

  get isPlaying(): boolean {
    return this.playhead > this.ctx.currentTime + 0.05;
  }

  close(): void {
    this.clear();
    try {
      void this.ctx.close();
    } catch {
      /* ignore */
    }
  }
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
  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const mutedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const genRef = useRef(0);
  const greetedRef = useRef(false);
  const canStreamRef = useRef(false); // AEC warm-up gate
  const agentSpeakingRef = useRef(false);
  const userSpeakingRef = useRef(false);
  const pendingToolResponseRef = useRef(false);
  const voiceRef = useRef(DEFAULT_VOICE);

  const fail = useCallback((message: string) => {
    setStatus("error");
    try {
      optsRef.current.onError?.(message);
    } catch {
      /* ignore */
    }
  }, []);

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

  const buildSession = useCallback((): Record<string, unknown> => {
    const o = optsRef.current;
    return {
      type: "session.update",
      session: {
        type: "realtime",
        voice: voiceRef.current,
        instructions: o.instructions ?? "You are a helpful voice assistant.",
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          silence_duration_ms: 600,
          prefix_padding_ms: 300,
        },
        audio: {
          input: {
            format: { type: "audio/pcm", rate: TARGET_RATE },
            transcription: {},
          },
          output: {
            format: { type: "audio/pcm", rate: TARGET_RATE },
            speed: 1.0,
          },
        },
        tools: (o.tools ?? []).map((t) => ({
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    };
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
      // If the user started talking while the tool ran, defer response.create
      // until they stop (avoids clipping their first word).
      if (userSpeakingRef.current) {
        pendingToolResponseRef.current = true;
      } else {
        sendEvent({ type: "response.create" });
      }
      setIsToolRunning(false);
    },
    [sendEvent],
  );

  const handleServerEvent = useCallback(
    (ev: { type: string; [k: string]: unknown }) => {
      switch (ev.type) {
        case "session.created":
          sendEvent(buildSession());
          // AEC warm-up: let the echo canceller learn the room before mic
          // audio streams, so the agent doesn't answer itself on speakers.
          window.setTimeout(() => {
            canStreamRef.current = true;
          }, 1200);
          break;

        case "session.updated":
          setStatus("connected");
          if (!greetedRef.current) {
            greetedRef.current = true;
            // The greeting line lives in the instructions; this kicks it off.
            sendEvent({ type: "response.create" });
          }
          break;

        case "input_audio_buffer.speech_started":
          userSpeakingRef.current = true;
          setIsUserSpeaking(true);
          // Barge-in: cut the agent off and stop generation so the server's
          // context matches what the user actually heard.
          if (agentSpeakingRef.current) {
            playerRef.current?.clear();
            agentSpeakingRef.current = false;
            setIsAgentSpeaking(false);
            sendEvent({ type: "response.cancel" });
          }
          break;

        case "input_audio_buffer.speech_stopped":
          userSpeakingRef.current = false;
          setIsUserSpeaking(false);
          if (pendingToolResponseRef.current) {
            pendingToolResponseRef.current = false;
            sendEvent({ type: "response.create" });
          }
          break;

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
          setIsAgentThinking(true);
          break;

        case "response.output_audio.delta": {
          const delta = ev.delta as string | undefined;
          if (delta) {
            agentSpeakingRef.current = true;
            setIsAgentSpeaking(true);
            setIsAgentThinking(false);
            playerRef.current?.resume();
            playerRef.current?.enqueue(base64ToInt16(delta));
          }
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
          setIsAgentThinking(false);
          break;

        case "error": {
          const e = ev.error as { message?: string } | undefined;
          const msg = e?.message ?? "Realtime error";
          // Benign races (cancelling a finished response, etc.) are ignored.
          if (!/not found|no active response|cancel|already has an active response/i.test(msg)) {
            fail(msg);
          }
          break;
        }

        default:
          break;
      }
    },
    [buildSession, fail, runToolCall, sendEvent, upsert],
  );

  const startMic = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    micStreamRef.current = stream;
    type Ctor = typeof AudioContext;
    const AC = (window.AudioContext ||
      (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext) as Ctor;
    const ctx = new AC();
    micCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (mutedRef.current || !canStreamRef.current) return;
      const input = e.inputBuffer.getChannelData(0);
      const resampled = resampleTo24k(input, ctx.sampleRate);
      sendEvent({
        type: "input_audio_buffer.append",
        audio: floatToBase64PCM16(resampled),
      });
    };

    source.connect(processor);
    // ScriptProcessor needs a sink to fire; route to a muted gain.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    processor.connect(sink);
    sink.connect(ctx.destination);
  }, [sendEvent]);

  const teardown = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      processorRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    processorRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    try {
      void micCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    micCtxRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
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
  }, []);

  const disconnect = useCallback(() => {
    genRef.current++;
    greetedRef.current = false;
    teardown();
    setStatus("closed");
    setIsUserSpeaking(false);
    setIsAgentSpeaking(false);
    setIsAgentThinking(false);
    setIsToolRunning(false);
  }, [teardown]);

  const connect = useCallback(async () => {
    if (wsRef.current) return;
    const myGen = ++genRef.current;
    setHistory([]);
    setStatus("connecting");
    greetedRef.current = false;
    canStreamRef.current = false;
    agentSpeakingRef.current = false;
    userSpeakingRef.current = false;
    pendingToolResponseRef.current = false;

    let tokenInfo: VoiceTokenInfo;
    try {
      tokenInfo = await optsRef.current.getToken();
      if (!tokenInfo?.token) throw new Error("No token returned");
    } catch (e) {
      fail(e instanceof Error ? e.message : "Could not get a voice token");
      return;
    }
    if (myGen !== genRef.current) return;
    voiceRef.current = tokenInfo.voice ?? DEFAULT_VOICE;

    try {
      await startMic();
    } catch (e) {
      teardown();
      fail(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Microphone permission denied"
          : `Microphone error: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (myGen !== genRef.current) {
      teardown();
      return;
    }

    playerRef.current = new PcmPlayer();

    const key = tokenInfo.token;
    const proto = key.startsWith("xai-client-secret.") ? key : `xai-client-secret.${key}`;
    const model = tokenInfo.model ?? DEFAULT_MODEL;
    const ws = new WebSocket(`${WS_ENDPOINT}?model=${encodeURIComponent(model)}`, [proto]);
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
      if (myGen !== genRef.current) return;
      fail("Connection lost. Check your network and try again.");
    };
    ws.onclose = () => {
      if (myGen !== genRef.current) return;
      setStatus((s) => (s === "error" ? s : "closed"));
    };

    // Drive the agent-speaking flag off actual playback state.
    const tick = () => {
      if (myGen !== genRef.current) return;
      const playing = playerRef.current?.isPlaying ?? false;
      if (playing !== agentSpeakingRef.current) {
        agentSpeakingRef.current = playing;
        setIsAgentSpeaking(playing);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [fail, handleServerEvent, startMic, teardown]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setIsMuted(mutedRef.current);
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !wsRef.current) return;
      sendEvent({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: trimmed }] },
      });
      sendEvent({ type: "response.create" });
      upsert(crypto.randomUUID(), { role: "user", text: trimmed, status: "completed" });
    },
    [sendEvent, upsert],
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
