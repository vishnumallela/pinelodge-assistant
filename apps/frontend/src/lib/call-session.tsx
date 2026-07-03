import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useSession } from "@/lib/auth-client";
import { orpc, orpcClient } from "@/lib/orpc";
import { fetchVoiceToken } from "@/lib/voice-token";
import { useVoiceAgent, type UseVoiceAgentReturn } from "@/hooks/useVoiceAgent";
import {
  AGENT_NAME,
  buildInstructions,
  buildReceptionistTools,
  CALLER_PROMPTS,
  GREETING,
} from "@/lib/receptionist-agent";

/**
 * One simulated incoming call at a time. The browser plays the caller; Sarah
 * answers over WebRTC. Every completed turn is appended to the server-side
 * transcript, every tool invocation persists structured call state, and
 * hanging up finalizes the call and queues its report.
 */

export type LiveCall = NonNullable<Awaited<ReturnType<typeof orpcClient.calls.get>>>;

interface CallSession {
  agent: UseVoiceAgentReturn;
  agentName: string;
  userName: string;
  callerPrompts: string[];
  callId: string | null;
  liveCall: LiveCall | null;
  /** Set after a call ends, until the next one starts. */
  lastCallId: string | null;
  startCall: () => void;
  endCall: () => void;
  send: (text: string) => void;
}

const CallSessionContext = createContext<CallSession | null>(null);

export function CallSessionProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const userName = session?.user.name ?? session?.user.email ?? "there";

  const [callId, setCallId] = useState<string | null>(null);
  const [lastCallId, setLastCallId] = useState<string | null>(null);
  const callIdRef = useRef<string | null>(null);
  callIdRef.current = callId;

  // Transcript bookkeeping: which turn ids reached the server, and the next seq.
  const sentRef = useRef<Set<string>>(new Set());
  const seqRef = useRef(0);

  const refreshLiveCall = useCallback(() => {
    const id = callIdRef.current;
    if (id) void qc.invalidateQueries({ queryKey: orpc.calls.get.key({ input: { callId: id } }) });
  }, [qc]);

  const endCallRef = useRef<() => void>(() => undefined);

  const tools = useMemo(
    () =>
      buildReceptionistTools({
        getCallId: () => callIdRef.current,
        onStateChange: refreshLiveCall,
        onEndCall: () => endCallRef.current(),
      }),
    [refreshLiveCall],
  );
  const instructions = useMemo(() => buildInstructions(), []);

  const agent = useVoiceAgent({
    getToken: fetchVoiceToken,
    instructions,
    tools,
    greeting: GREETING,
    onError: (m) => toast.error(m),
  });

  // Persist completed turns as they land; the (callId, entryId) key makes
  // retries idempotent server-side.
  const flushTranscript = useCallback((history: UseVoiceAgentReturn["history"]) => {
    const id = callIdRef.current;
    if (!id) return;
    const pending = history.filter(
      (h) => h.status === "completed" && h.text.trim() !== "" && !sentRef.current.has(h.id),
    );
    if (pending.length === 0) return;
    for (const h of pending) sentRef.current.add(h.id);
    const entries = pending.map((h) => ({
      entryId: h.id,
      seq: seqRef.current++,
      role: h.role === "user" ? ("caller" as const) : ("assistant" as const),
      text: h.text,
    }));
    void orpcClient.calls.appendTranscript({ callId: id, entries }).catch(() => {
      // Retry on the next history change.
      for (const e of entries) sentRef.current.delete(e.entryId);
    });
  }, []);

  useEffect(() => {
    flushTranscript(agent.history);
  }, [agent.history, flushTranscript]);

  const { data: liveCall } = useQuery(
    orpc.calls.get.queryOptions({
      input: { callId: callId ?? "" },
      enabled: callId !== null,
    }),
  );

  const startCall = useCallback(() => {
    if (agent.isConnected) return;
    void (async () => {
      try {
        const { callId: id } = await orpcClient.calls.start();
        sentRef.current = new Set();
        seqRef.current = 0;
        setLastCallId(null);
        setCallId(id);
        await agent.connect();
        void navigate({ to: "/" });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not start the call.");
      }
    })();
  }, [agent, navigate]);

  const endCall = useCallback(() => {
    const id = callIdRef.current;
    // Capture any turns that completed after the last effect ran.
    flushTranscript(agent.history);
    agent.disconnect();
    setCallId(null);
    if (id) {
      setLastCallId(id);
      void (async () => {
        try {
          await orpcClient.calls.complete({ callId: id });
          void qc.invalidateQueries({ queryKey: orpc.calls.list.key() });
          void qc.invalidateQueries({ queryKey: orpc.calls.get.key({ input: { callId: id } }) });
        } catch {
          /* the call row still exists; the report can be retried server-side */
        }
      })();
    }
  }, [agent, flushTranscript, qc]);
  endCallRef.current = endCall;

  const send = useCallback(
    (text: string) => {
      if (!agent.isConnected) return;
      agent.sendText(text);
    },
    [agent],
  );

  const value = useMemo<CallSession>(
    () => ({
      agent,
      agentName: AGENT_NAME,
      userName,
      callerPrompts: CALLER_PROMPTS,
      callId,
      liveCall: liveCall ?? null,
      lastCallId,
      startCall,
      endCall,
      send,
    }),
    [agent, userName, callId, liveCall, lastCallId, startCall, endCall, send],
  );

  return <CallSessionContext.Provider value={value}>{children}</CallSessionContext.Provider>;
}

export function useCallSession(): CallSession {
  const ctx = use(CallSessionContext);
  if (!ctx) throw new Error("useCallSession must be used within CallSessionProvider");
  return ctx;
}
