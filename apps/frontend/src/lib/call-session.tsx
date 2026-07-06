import { createContext, use, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useSession } from "@/lib/auth-client";
import { fetchVoiceToken } from "@/lib/voice-token";
import { useVoiceAgent, type UseVoiceAgentReturn } from "@/hooks/useVoiceAgent";
import {
  AGENT_NAME,
  buildInstructions,
  buildReceptionistTools,
  CALLER_PROMPTS,
  GREETING,
  TRANSCRIPTION_HINT,
} from "@/lib/receptionist-agent";

/**
 * One call at a time: the browser plays the caller, Sarah answers over
 * WebRTC. Her only tool is end_call — she announces who she is redirecting
 * the caller to, then hangs up once her audio finishes.
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
  startCall: () => void;
  endCall: () => void;
  send: (text: string) => void;
}

const CallSessionContext = createContext<CallSession | null>(null);

export function CallSessionProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userName = session?.user.name ?? session?.user.email ?? "there";

  const [hangupRequested, setHangupRequested] = useState(false);

  const tools = useMemo(
    () => buildReceptionistTools({ onEndCall: () => setHangupRequested(true) }),
    [],
  );
  const instructions = useMemo(() => buildInstructions(), []);

  const agent = useVoiceAgent({
    getToken: fetchVoiceToken,
    instructions,
    tools,
    greeting: GREETING,
    transcriptionPrompt: TRANSCRIPTION_HINT,
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

  // Complete a requested hangup only after the assistant finishes speaking,
  // with a hard cap in case audio events go missing.
  useEffect(() => {
    if (!hangupRequested) return;
    if (agent.isAgentSpeaking || agent.isAgentThinking) return;
    const grace = window.setTimeout(() => {
      setHangupRequested(false);
      agent.disconnect();
    }, 600);
    return () => window.clearTimeout(grace);
  }, [hangupRequested, agent]);

  useEffect(() => {
    if (!hangupRequested) return;
    const cap = window.setTimeout(() => {
      setHangupRequested(false);
      agent.disconnect();
    }, 15000);
    return () => window.clearTimeout(cap);
  }, [hangupRequested, agent]);

  const value = useMemo<CallSession>(
    () => ({
      agent,
      agentName: AGENT_NAME,
      userName,
      callerPrompts: CALLER_PROMPTS,
      feed,
      startCall: () => {
        setHangupRequested(false);
        void agent.connect();
      },
      endCall: () => {
        setHangupRequested(false);
        agent.disconnect();
      },
      send: (text: string) => {
        if (agent.isConnected) agent.sendText(text);
      },
    }),
    [agent, userName, feed],
  );

  return <CallSessionContext.Provider value={value}>{children}</CallSessionContext.Provider>;
}

export function useCallSession(): CallSession {
  const ctx = use(CallSessionContext);
  if (!ctx) throw new Error("useCallSession must be used within CallSessionProvider");
  return ctx;
}
