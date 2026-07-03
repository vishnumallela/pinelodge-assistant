/**
 * useVoiceAgent - OpenAI Realtime (WebRTC) React hook
 * ============================================================================
 *
 * A browser voice-agent hook for the OpenAI Realtime API (gpt-realtime-2),
 * over WebRTC — the transport OpenAI recommends for browsers:
 *
 *   - mic capture goes out as an RTP audio track (Opus); no manual PCM
 *     resampling, base64 framing, or input_audio_buffer.append plumbing
 *   - the agent's speech arrives as a remote audio track played by an
 *     <audio> element; barge-in truncation is handled server-side
 *   - JSON events (session.update, transcripts, tool calls) flow over the
 *     "oai-events" data channel, same event protocol as the WebSocket API
 *   - tool calls run client-side handlers, then we reply + response.create
 *
 * The provider API key never reaches the browser: `getToken()` returns a
 * short-lived ephemeral client secret (ek_...) minted by our backend, used
 * as the Bearer token for the SDP exchange only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const CALLS_ENDPOINT = "https://api.openai.com/v1/realtime/calls";
const DEFAULT_MODEL = "gpt-realtime-2";
const DEFAULT_VOICE = "shimmer";
const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-transcribe";

/* ── public types ─────────────────────────────────────────────────────── */

export interface VoiceFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  /** Runs in the browser when the model calls this tool. Return value is
   *  JSON-encoded and sent back as the function_call_output. */
  handler?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface TurnDetectionConfig {
  type: "semantic_vad" | "server_vad";
  /** semantic_vad: how eagerly the model ends the user's turn. */
  eagerness?: "low" | "medium" | "high" | "auto";
  /** server_vad tuning knobs. */
  threshold?: number;
  silence_duration_ms?: number;
  prefix_padding_ms?: number;
}

export interface VoiceTokenInfo {
  /** Ephemeral client secret (ek_...) minted by our backend. */
  token: string;
  model?: string;
  voice?: string;
  transcribeModel?: string;
}

export interface UseVoiceAgentOptions {
  getToken: () => Promise<VoiceTokenInfo>;
  model?: string;
  voice?: "marin" | "cedar" | "alloy" | "ash" | "coral" | "sage" | "verse" | (string & {});
  instructions?: string;
  tools?: VoiceFunctionTool[];
  turnDetection?: TurnDetectionConfig;
  /** If set, the agent speaks an opening line right after connect. */
  greeting?: string;
  onToolCall?: (info: { name: string; args: Record<string, unknown> }) => void;
  onToolResult?: (info: { name: string; result: unknown }) => void;
  onError?: (message: string) => void;
}

export type VoiceStatus = "idle" | "connecting" | "connected" | "error" | "closed";

export interface VoiceHistoryItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "in_progress" | "completed";
}

export interface UseVoiceAgentReturn {
  status: VoiceStatus;
  isConnected: boolean;
  isUserSpeaking: boolean;
  isAgentSpeaking: boolean;
  isAgentThinking: boolean;
  isToolRunning: boolean;
  isMuted: boolean;
  levels: { user: number; agent: number };
  history: VoiceHistoryItem[];
  liveUserText: string;
  liveAgentText: string;
  lastToolName: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  mute: () => void;
  unmute: () => void;
  toggleMute: () => void;
  sendText: (text: string) => void;
  interrupt: () => void;
}

/* ── audio level metering ─────────────────────────────────────────────── */

/** Peak meter over an AnalyserNode, shared by the mic and the agent track. */
class LevelMeter {
  analyser: AnalyserNode;
  private buf: Uint8Array<ArrayBuffer>;

  constructor(ctx: AudioContext, stream: MediaStream) {
    const source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
    this.buf = new Uint8Array(this.analyser.fftSize);
  }

  level(): number {
    this.analyser.getByteTimeDomainData(this.buf);
    let peak = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = Math.abs((this.buf[i]! - 128) / 128);
      if (v > peak) peak = v;
    }
    return peak;
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
  const [levels, setLevels] = useState({ user: 0, agent: 0 });
  const [history, setHistory] = useState<VoiceHistoryItem[]>([]);
  const [liveUserText, setLiveUserText] = useState("");
  const [liveAgentText, setLiveAgentText] = useState("");
  const [lastToolName, setLastToolName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const micMeterRef = useRef<LevelMeter | null>(null);
  const agentMeterRef = useRef<LevelMeter | null>(null);
  const mutedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const genRef = useRef(0);
  const greetedRef = useRef(false);
  const voiceConfigRef = useRef<{ voice: string; transcribeModel: string }>({
    voice: DEFAULT_VOICE,
    transcribeModel: DEFAULT_TRANSCRIBE_MODEL,
  });
  const userSpeakingRef = useRef(false); // is the user mid-utterance (VAD)
  const pendingToolResponseRef = useRef(false); // defer response.create until user stops
  const activeResponseRef = useRef(false); // a model response is in flight

  const fail = useCallback((message: string) => {
    setError(message);
    setStatus("error");
    try {
      optsRef.current.onError?.(message);
    } catch {
      /* ignore */
    }
  }, []);

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(event));
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
    const cfg = voiceConfigRef.current;
    return {
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: o.instructions ?? "You are a helpful voice assistant.",
        tools: (o.tools ?? []).map((t) => ({
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        tool_choice: "auto",
        audio: {
          input: {
            // Language pin: the API docs state supplying ISO-639-1 improves
            // transcription accuracy and latency.
            transcription: { model: cfg.transcribeModel, language: "en" },
            // Noise reduction is OFF by API default; without it, ambient
            // noise fires speech_started while the agent talks and the server
            // cancels her mid-word. far_field is the documented profile for
            // laptop and room microphones (near_field is for headsets).
            noise_reduction: { type: "far_field" },
            turn_detection: o.turnDetection ?? {
              // Tuned for noisy environments per the API docs: a 0.7
              // threshold requires clearly-voiced audio to activate (so
              // chatter and echo stop interrupting the agent), and an 800ms
              // silence window keeps mid-thought pauses inside the turn.
              // Real barge-in still works — it just takes actual speech.
              type: "server_vad",
              threshold: 0.7,
              prefix_padding_ms: 300,
              silence_duration_ms: 800,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice: o.voice ?? cfg.voice,
          },
        },
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
      setLastToolName(name);
      setIsToolRunning(true);
      try {
        optsRef.current.onToolCall?.({ name, args });
      } catch {
        /* ignore */
      }

      const tool = optsRef.current.tools?.find((t) => t.name === name);
      let output: unknown = { ok: true };
      if (tool?.handler) {
        try {
          output = await tool.handler(args);
          optsRef.current.onToolResult?.({ name, result: output });
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
      // Two races to avoid before asking for the follow-up response:
      // - the user started speaking while the tool ran (creating now clips
      //   the start of their utterance), or
      // - VAD auto-created a response in the meantime (creating now collides
      //   with the active response and the turn breaks).
      // In both cases defer; speech_stopped / response.done fire it later.
      if (userSpeakingRef.current || activeResponseRef.current) {
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
        case "session.updated":
          if (status !== "connected") setStatus("connected");
          if (optsRef.current.greeting && !greetedRef.current) {
            greetedRef.current = true;
            sendEvent({
              type: "response.create",
              response: { instructions: `Greet the caller now: ${optsRef.current.greeting}` },
            });
          }
          break;

        case "input_audio_buffer.speech_started":
          // Barge-in: with interrupt_response on, the server stops the active
          // response and clears buffered output audio on its own.
          userSpeakingRef.current = true;
          setIsUserSpeaking(true);
          break;

        case "input_audio_buffer.speech_stopped":
          userSpeakingRef.current = false;
          setIsUserSpeaking(false);
          // Fire a tool-result response that we deferred while the user spoke
          // (mitigates the "first word clipped" race).
          if (pendingToolResponseRef.current && !activeResponseRef.current) {
            pendingToolResponseRef.current = false;
            sendEvent({ type: "response.create" });
          }
          break;

        case "conversation.item.input_audio_transcription.delta":
          setLiveUserText((t) => t + ((ev.delta as string) ?? ""));
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
          setLiveUserText("");
          break;
        }

        case "response.created":
          activeResponseRef.current = true;
          setIsAgentThinking(true);
          break;

        // WebRTC-only lifecycle events for the agent's audio track — they track
        // actual speaker output, so no playhead bookkeeping is needed.
        case "output_audio_buffer.started":
          setIsAgentSpeaking(true);
          setIsAgentThinking(false);
          break;

        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          setIsAgentSpeaking(false);
          break;

        case "response.output_audio_transcript.delta":
          setLiveAgentText((t) => t + ((ev.delta as string) ?? ""));
          break;

        case "response.output_audio_transcript.done": {
          const text = ((ev.transcript as string) ?? "").trim();
          if (text) {
            upsert((ev.item_id as string) ?? crypto.randomUUID(), {
              role: "assistant",
              text,
              status: "completed",
            });
          }
          setLiveAgentText("");
          break;
        }

        case "response.function_call_arguments.done":
          void runToolCall(ev.name as string, ev.call_id as string, (ev.arguments as string) ?? "");
          break;

        case "response.done":
          activeResponseRef.current = false;
          setIsAgentThinking(false);
          // A tool finished while another response was active: request the
          // follow-up now that the line is free (unless the user is talking).
          if (pendingToolResponseRef.current && !userSpeakingRef.current) {
            pendingToolResponseRef.current = false;
            sendEvent({ type: "response.create" });
          }
          break;

        case "error": {
          const e = ev.error as { message?: string } | undefined;
          const msg = e?.message ?? "Realtime error";
          if (/not found|no active response|cancel|already has an active response/i.test(msg)) {
            break;
          }
          setError(msg);
          try {
            optsRef.current.onError?.(msg);
          } catch {
            /* ignore */
          }
          break;
        }

        default:
          break;
      }
    },
    [runToolCall, sendEvent, status, upsert],
  );

  const teardown = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micMeterRef.current = null;
    agentMeterRef.current = null;
    try {
      void meterCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    meterCtxRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
    const dc = dcRef.current;
    dcRef.current = null;
    if (dc) {
      dc.onmessage = null;
      dc.onopen = null;
      dc.onclose = null;
      try {
        dc.close();
      } catch {
        /* ignore */
      }
    }
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
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
    setLevels({ user: 0, agent: 0 });
    setLiveUserText("");
    setLiveAgentText("");
  }, [teardown]);

  const connect = useCallback(async () => {
    if (pcRef.current) return;
    const myGen = ++genRef.current;
    setError(null);
    setHistory([]);
    setStatus("connecting");
    greetedRef.current = false;
    pendingToolResponseRef.current = false;
    userSpeakingRef.current = false;
    activeResponseRef.current = false;

    let tokenInfo: VoiceTokenInfo;
    try {
      tokenInfo = await optsRef.current.getToken();
      if (!tokenInfo?.token) throw new Error("No token returned");
    } catch (e) {
      fail(e instanceof Error ? e.message : "Could not get a voice token");
      return;
    }
    if (myGen !== genRef.current) return;
    voiceConfigRef.current = {
      voice: tokenInfo.voice ?? DEFAULT_VOICE,
      transcribeModel: tokenInfo.transcribeModel ?? DEFAULT_TRANSCRIBE_MODEL,
    };

    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (e) {
      fail(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Microphone permission denied"
          : `Microphone error: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (myGen !== genRef.current) {
      mic.getTracks().forEach((t) => t.stop());
      return;
    }
    micStreamRef.current = mic;
    if (mutedRef.current) mic.getAudioTracks().forEach((t) => (t.enabled = false));

    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

    // The agent speaks through a plain <audio> element; the browser's WebRTC
    // stack owns jitter buffering and echo-cancellation reference wiring.
    const audioEl = new Audio();
    audioEl.autoplay = true;
    audioElRef.current = audioEl;

    type Ctor = typeof AudioContext;
    const AC = (window.AudioContext ||
      (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext) as Ctor;
    const meterCtx = new AC();
    meterCtxRef.current = meterCtx;
    micMeterRef.current = new LevelMeter(meterCtx, mic);

    pc.ontrack = (e) => {
      if (myGen !== genRef.current) return;
      const stream = e.streams[0];
      if (!stream) return;
      audioEl.srcObject = stream;
      void audioEl.play().catch(() => undefined);
      agentMeterRef.current = new LevelMeter(meterCtx, stream);
    };

    pc.onconnectionstatechange = () => {
      if (myGen !== genRef.current) return;
      if (pc.connectionState === "failed") {
        fail("Connection lost. Check your network and try again.");
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        setStatus((s) => (s === "error" ? s : "closed"));
      }
    };

    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onopen = () => {
      if (myGen !== genRef.current) return;
      sendEvent(buildSession());
    };
    // RTCDataChannel message handler (Realtime API events), not a cross-window postMessage listener.
    dc.onmessage = (msg) => {
      if (myGen !== genRef.current) return;
      try {
        handleServerEvent(JSON.parse(msg.data as string));
      } catch {
        /* ignore malformed frame */
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const model = optsRef.current.model ?? tokenInfo.model ?? DEFAULT_MODEL;
      const resp = await fetch(`${CALLS_ENDPOINT}?model=${encodeURIComponent(model)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenInfo.token}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`Realtime call setup failed (${resp.status}) ${detail.slice(0, 160)}`);
      }
      const answer = await resp.text();
      if (myGen !== genRef.current) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (e) {
      if (myGen !== genRef.current) return;
      fail(e instanceof Error ? e.message : "Could not start the call.");
      teardown();
      return;
    }

    // Visualizer loop. Runs at rAF rate but only commits level state ~25fps and
    // only when it actually changes, otherwise the whole console re-renders
    // 60x/s and keeps re-rendering through silence.
    let lastEmit = 0;
    let lastU = -1;
    let lastA = -1;
    const tick = () => {
      if (myGen !== genRef.current) return;
      const now = performance.now();
      if (now - lastEmit >= 40) {
        lastEmit = now;
        const a = Math.round((agentMeterRef.current?.level() ?? 0) * 100) / 100;
        const u = mutedRef.current
          ? 0
          : Math.round((micMeterRef.current?.level() ?? 0) * 100) / 100;
        if (u !== lastU || a !== lastA) {
          lastU = u;
          lastA = a;
          setLevels({ user: u, agent: a });
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildSession, fail, handleServerEvent, sendEvent, teardown]);

  const setMicEnabled = useCallback((enabled: boolean) => {
    micStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }, []);

  const mute = useCallback(() => {
    mutedRef.current = true;
    setMicEnabled(false);
    setIsMuted(true);
  }, [setMicEnabled]);
  const unmute = useCallback(() => {
    mutedRef.current = false;
    setMicEnabled(true);
    setIsMuted(false);
  }, [setMicEnabled]);
  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMicEnabled(!mutedRef.current);
    setIsMuted(mutedRef.current);
  }, [setMicEnabled]);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      sendEvent({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: trimmed }] },
      });
      // If a response is already in flight (e.g. a tool follow-up), creating
      // another collides and the reply can ignore this message. Cancel the
      // stale one so the reply is generated with this message in context.
      if (activeResponseRef.current) {
        sendEvent({ type: "response.cancel" });
        sendEvent({ type: "output_audio_buffer.clear" });
      }
      sendEvent({ type: "response.create" });
      // Typed input produces no transcription events, so record it directly.
      upsert(crypto.randomUUID(), { role: "user", text: trimmed, status: "completed" });
    },
    [sendEvent, upsert],
  );

  const interrupt = useCallback(() => {
    sendEvent({ type: "response.cancel" });
    sendEvent({ type: "output_audio_buffer.clear" });
    setIsAgentSpeaking(false);
    setIsAgentThinking(false);
  }, [sendEvent]);

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
      levels,
      history,
      liveUserText,
      liveAgentText,
      lastToolName,
      error,
      connect,
      disconnect,
      mute,
      unmute,
      toggleMute,
      sendText,
      interrupt,
    }),
    [
      status,
      isUserSpeaking,
      isAgentSpeaking,
      isAgentThinking,
      isToolRunning,
      isMuted,
      levels,
      history,
      liveUserText,
      liveAgentText,
      lastToolName,
      error,
      connect,
      disconnect,
      mute,
      unmute,
      toggleMute,
      sendText,
      interrupt,
    ],
  );
}
