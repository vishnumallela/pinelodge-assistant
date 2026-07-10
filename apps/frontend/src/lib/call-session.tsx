import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useSession } from "@/lib/auth-client";
import { fetchVoiceToken } from "@/lib/voice-token";
import { client, orpc, type TranscriptTurn } from "@/lib/orpc";
import { useVoiceAgent, type UseVoiceAgentReturn } from "@/hooks/useVoiceAgent";
import { useVoiceSettings } from "@/lib/voice-settings";
import {
  AGENT_NAME,
  buildReceptionistTools,
  CALLER_PROMPTS,
  CONSOLE_TRANSFER_APPENDIX,
  type TransferResult,
} from "@/lib/receptionist-agent";

/**
 * One live call at a time. Starting a call creates a server record, the
 * browser plays the caller while Sarah answers over Grok realtime voice, and
 * completed turns stream to the server as the transcript. Ending the call
 * (by Sarah's end_call, the End button, or leaving) locks the record and
 * enqueues its summary — an ended call can never be reopened.
 */

export interface FeedItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  responseId?: string;
}

interface CallSession {
  agent: UseVoiceAgentReturn;
  agentName: string;
  userName: string;
  callerPrompts: string[];
  feed: FeedItem[];
  /** The call currently being conducted, if any. */
  activeCallId: string | null;
  startCall: () => Promise<void>;
  endCall: () => void;
  send: (text: string) => void;
}

const CallSessionContext = createContext<CallSession | null>(null);

function toTranscript(feed: FeedItem[]): TranscriptTurn[] {
  return feed.map((f) => ({
    role: f.role === "assistant" ? ("assistant" as const) : ("caller" as const),
    text: f.text,
  }));
}

export function CallSessionProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userName = session?.user.name ?? session?.user.email ?? "there";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [hangupRequested, setHangupRequested] = useState(false);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const activeCallIdRef = useRef<string | null>(null);
  activeCallIdRef.current = activeCallId;
  const finalizingRef = useRef(false);

  const tools = useMemo(
    () =>
      buildReceptionistTools({
        onEndCall: () => setHangupRequested(true),
        // Sarah's transfer_call: the server resolves the person and emails
        // them a brief of the call so far; on success the call then ends
        // exactly like end_call.
        onTransfer: async (name): Promise<TransferResult> => {
          const id = activeCallIdRef.current;
          if (!id) return { ok: false, error: "No active call." };
          try {
            const result = await client.calls.transfer({
              id,
              name,
              transcript: toTranscript(feedRef.current),
            });
            if (result.ok) setHangupRequested(true);
            return result;
          } catch (e) {
            return {
              ok: false,
              error: e instanceof Error ? e.message : "The transfer could not be arranged.",
            };
          }
        },
      }),
    [],
  );

  const { settings: voiceSettings } = useVoiceSettings();
  const agent = useVoiceAgent({
    getToken: fetchVoiceToken,
    tools,
    sessionConfig: voiceSettings,
    onError: (m) => toast.error(m),
  });

  // Completed turns; assistant items from the same response merge into one
  // bubble (the model sometimes splits an utterance across output items).
  const feed = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    for (const h of agent.history) {
      if (h.status !== "completed" || h.text.trim() === "") continue;
      const text = h.text.trim();
      const last = out.at(-1);
      if (
        h.role === "assistant" &&
        last?.role === "assistant" &&
        last.responseId !== undefined &&
        last.responseId === h.responseId
      ) {
        if (!last.text.endsWith(text)) last.text = `${last.text} ${text}`;
        continue;
      }
      out.push({ id: h.id, role: h.role, text, responseId: h.responseId });
    }
    return out;
  }, [agent.history]);
  const feedRef = useRef<FeedItem[]>(feed);
  feedRef.current = feed;

  // Stream the transcript to the server as turns complete (active call only).
  useEffect(() => {
    const id = activeCallIdRef.current;
    if (!id || feed.length === 0) return;
    void client.calls.saveTranscript({ id, transcript: toTranscript(feed) }).catch(() => {
      /* a later turn will retry the full transcript */
    });
  }, [feed]);

  const finalize = useCallback(() => {
    const id = activeCallIdRef.current;
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setHangupRequested(false);
    agent.disconnect();
    setActiveCallId(null);
    if (id) {
      void (async () => {
        try {
          await client.calls.end({ id, transcript: toTranscript(feedRef.current) });
          void qc.invalidateQueries({ queryKey: orpc.calls.list.key() });
          void qc.invalidateQueries({ queryKey: orpc.calls.get.key({ input: { id } }) });
        } catch {
          /* the record still exists; the list refresh will show its state */
        } finally {
          finalizingRef.current = false;
        }
      })();
    } else {
      finalizingRef.current = false;
    }
  }, [agent, qc]);
  const finalizeRef = useRef(finalize);
  finalizeRef.current = finalize;

  // Sarah's end_call requests a hangup; finalize only once her audio has
  // finished (and the caller isn't mid-interruption), with a hard cap.
  useEffect(() => {
    if (!hangupRequested) return;
    if (agent.isAgentSpeaking || agent.isAgentThinking || agent.isUserSpeaking) return;
    const grace = window.setTimeout(() => finalizeRef.current(), 600);
    return () => window.clearTimeout(grace);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [hangupRequested, agent.isAgentSpeaking, agent.isAgentThinking, agent.isUserSpeaking]);

  useEffect(() => {
    if (!hangupRequested) return;
    const cap = window.setTimeout(() => finalizeRef.current(), 15000);
    return () => window.clearTimeout(cap);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [hangupRequested]);

  const startCall = useCallback(async () => {
    if (activeCallIdRef.current) return;
    try {
      // The prompt renders fresh at connect time so availability is current.
      const [call, agentPrompt] = await Promise.all([client.calls.create(), client.prompt.get()]);
      finalizingRef.current = false;
      setActiveCallId(call.id);
      setHangupRequested(false);
      void qc.invalidateQueries({ queryKey: orpc.calls.list.key() });
      await navigate({ to: "/calls/$callId", params: { callId: call.id } });
      await agent.connect({
        instructions: `${agentPrompt.prompt}\n\n${CONSOLE_TRANSFER_APPENDIX}`,
        greeting: agentPrompt.greeting,
      });
    } catch (e) {
      setActiveCallId(null);
      toast.error(e instanceof Error ? e.message : "Could not start the call.");
    }
  }, [agent, navigate, qc]);

  const value = useMemo<CallSession>(
    () => ({
      agent,
      agentName: AGENT_NAME,
      userName,
      callerPrompts: CALLER_PROMPTS,
      feed,
      activeCallId,
      startCall,
      endCall: finalize,
      send: (text: string) => {
        if (agent.isConnected) agent.sendText(text);
      },
    }),
    [agent, userName, feed, activeCallId, startCall, finalize],
  );

  return <CallSessionContext.Provider value={value}>{children}</CallSessionContext.Provider>;
}

export function useCallSession(): CallSession {
  const ctx = use(CallSessionContext);
  if (!ctx) throw new Error("useCallSession must be used within CallSessionProvider");
  return ctx;
}
