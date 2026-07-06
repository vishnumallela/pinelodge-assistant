/**
 * OpenAI Realtime (WebRTC) voice-agent hook for gpt-realtime-2.
 * The mic goes out as an RTP audio track, the agent's speech arrives as a
 * remote track, and JSON events flow over the "oai-events" data channel.
 * The browser only ever sees a short-lived ephemeral token (ek_...) minted
 * by our backend — never the provider API key.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const CALLS_ENDPOINT = "https://api.openai.com/v1/realtime/calls";
const DEFAULT_MODEL = "gpt-realtime-2";
const DEFAULT_VOICE = "marin";
const DEFAULT_TRANSCRIBE_MODEL = "whisper-1";

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
  transcribeModel?: string;
}

export interface UseVoiceAgentOptions {
  getToken: () => Promise<VoiceTokenInfo>;
  instructions?: string;
  tools?: VoiceFunctionTool[];
  /** Domain vocabulary hint for the transcription model. */
  transcriptionPrompt?: string;
  /** If set, the agent speaks this exact opening line right after connect. */
  greeting?: string;
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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(false);
  const genRef = useRef(0);
  const greetedRef = useRef(false);
  const voiceConfigRef = useRef({
    voice: DEFAULT_VOICE,
    transcribeModel: DEFAULT_TRANSCRIBE_MODEL,
  });
  const userSpeakingRef = useRef(false);
  const pendingToolResponseRef = useRef(false);
  const activeResponseRef = useRef(false);

  const fail = useCallback((message: string) => {
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
            transcription: {
              model: cfg.transcribeModel,
              language: "en",
              ...(o.transcriptionPrompt ? { prompt: o.transcriptionPrompt } : {}),
            },
            noise_reduction: { type: "far_field" },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "auto",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice: cfg.voice,
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
      // Defer the follow-up response if the user is mid-utterance or another
      // response is active; speech_stopped / response.done fire it later.
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
              response: {
                instructions: `Say exactly this, as one utterance, and nothing else: "${optsRef.current.greeting}"`,
              },
            });
          }
          break;

        case "input_audio_buffer.speech_started":
          userSpeakingRef.current = true;
          setIsUserSpeaking(true);
          break;

        case "input_audio_buffer.speech_stopped":
          userSpeakingRef.current = false;
          setIsUserSpeaking(false);
          if (pendingToolResponseRef.current && !activeResponseRef.current) {
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
          activeResponseRef.current = true;
          setIsAgentThinking(true);
          break;

        case "output_audio_buffer.started":
          setIsAgentSpeaking(true);
          setIsAgentThinking(false);
          break;

        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          setIsAgentSpeaking(false);
          break;

        case "response.output_audio_transcript.done": {
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
          activeResponseRef.current = false;
          setIsAgentThinking(false);
          if (pendingToolResponseRef.current && !userSpeakingRef.current) {
            pendingToolResponseRef.current = false;
            sendEvent({ type: "response.create" });
          }
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
    [fail, runToolCall, sendEvent, status, upsert],
  );

  const teardown = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
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
  }, [teardown]);

  const connect = useCallback(async () => {
    if (pcRef.current) return;
    const myGen = ++genRef.current;
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

    const audioEl = new Audio();
    audioEl.autoplay = true;
    audioElRef.current = audioEl;

    pc.ontrack = (e) => {
      if (myGen !== genRef.current) return;
      const stream = e.streams[0];
      if (!stream) return;
      audioEl.srcObject = stream;
      void audioEl.play().catch(() => undefined);
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
      const model = tokenInfo.model ?? DEFAULT_MODEL;
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
    }
  }, [buildSession, fail, handleServerEvent, sendEvent, teardown]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    micStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !mutedRef.current));
    setIsMuted(mutedRef.current);
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      sendEvent({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: trimmed }] },
      });
      // Cancel an in-flight response so the reply sees this message.
      if (activeResponseRef.current) {
        sendEvent({ type: "response.cancel" });
        sendEvent({ type: "output_audio_buffer.clear" });
      }
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
