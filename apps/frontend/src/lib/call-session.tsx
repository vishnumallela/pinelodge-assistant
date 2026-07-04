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
  TRANSCRIPTION_HINT,
} from "@/lib/receptionist-agent";

/**
 * One simulated incoming call at a time. The browser plays the caller; Sarah
 * answers over WebRTC. Every completed turn is appended to the server-side
 * transcript, every tool invocation persists structured call state, and
 * hanging up finalizes the call and queues its report.
 */

export type LiveCall = NonNullable<Awaited<ReturnType<typeof orpcClient.calls.get>>>;

/** One entry in the live conversation feed: a completed turn, or tool activity. */
export type FeedItem =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant";
      text: string;
      responseId?: string;
    }
  | { kind: "tool"; id: string; name: string; status: "running" | "done" };

interface CallSession {
  agent: UseVoiceAgentReturn;
  agentName: string;
  userName: string;
  callerPrompts: string[];
  callId: string | null;
  liveCall: LiveCall | null;
  /** Completed turns interleaved with tool activity, in arrival order. */
  feed: FeedItem[];
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

  // Conversation feed: completed turns + tool activity, in arrival order.
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedSeenRef = useRef<Set<string>>(new Set());

  const refreshLiveCall = useCallback(() => {
    const id = callIdRef.current;
    if (id) void qc.invalidateQueries({ queryKey: orpc.calls.get.key({ input: { callId: id } }) });
  }, [qc]);

  const endCallRef = useRef<() => void>(() => undefined);

  // The assistant's end_call / complete_transfer request a hangup; we only
  // disconnect once her audio has finished so goodbyes are never cut off.
  const [hangupRequested, setHangupRequested] = useState(false);

  const tools = useMemo(
    () =>
      buildReceptionistTools({
        getCallId: () => callIdRef.current,
        onStateChange: refreshLiveCall,
        onEndCall: () => setHangupRequested(true),
      }),
    [refreshLiveCall],
  );
  const instructions = useMemo(() => buildInstructions(), []);

  const agent = useVoiceAgent({
    getToken: fetchVoiceToken,
    instructions,
    tools,
    greeting: GREETING,
    transcriptionPrompt: TRANSCRIPTION_HINT,
    onToolCall: ({ name }) =>
      setFeed((f) => [...f, { kind: "tool", id: crypto.randomUUID(), name, status: "running" }]),
    onToolResult: ({ name }) =>
      setFeed((f) => {
        const idx = f.findLastIndex(
          (i) => i.kind === "tool" && i.name === name && i.status === "running",
        );
        if (idx === -1) return f;
        const next = f.slice();
        next[idx] = { ...(next[idx] as FeedItem & { kind: "tool" }), status: "done" };
        return next;
      }),
    onError: (m) => toast.error(m),
  });

  // Fold newly completed turns into the feed, preserving arrival order
  // relative to tool activity. The model sometimes splits one utterance
  // across several output items in the same response — merge those into a
  // single bubble, and drop a fragment that merely repeats the previous one.
  useEffect(() => {
    const fresh = agent.history.filter(
      (h) => h.status === "completed" && h.text.trim() !== "" && !feedSeenRef.current.has(h.id),
    );
    if (fresh.length === 0) return;
    for (const h of fresh) feedSeenRef.current.add(h.id);
    setFeed((f) => {
      const next = f.slice();
      for (const h of fresh) {
        const text = h.text.trim();
        const last = next[next.length - 1];
        if (
          h.role === "assistant" &&
          last?.kind === "message" &&
          last.role === "assistant" &&
          last.responseId !== undefined &&
          last.responseId === h.responseId
        ) {
          if (!last.text.endsWith(text)) {
            next[next.length - 1] = { ...last, text: `${last.text} ${text}` };
          }
          continue;
        }
        next.push({
          kind: "message",
          id: h.id,
          role: h.role,
          text,
          responseId: h.responseId,
        });
      }
      return next;
    });
  }, [agent.history]);

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

  // Complete a requested hangup only after the assistant is done speaking,
  // with a hard cap in case audio events go missing.
  useEffect(() => {
    if (!hangupRequested) return;
    if (agent.isAgentSpeaking || agent.isAgentThinking) return;
    const grace = window.setTimeout(() => {
      setHangupRequested(false);
      endCallRef.current();
    }, 600);
    return () => window.clearTimeout(grace);
  }, [hangupRequested, agent.isAgentSpeaking, agent.isAgentThinking]);

  useEffect(() => {
    if (!hangupRequested) return;
    const cap = window.setTimeout(() => {
      setHangupRequested(false);
      endCallRef.current();
    }, 15000);
    return () => window.clearTimeout(cap);
  }, [hangupRequested]);

  const startCall = useCallback(() => {
    if (agent.isConnected) return;
    void (async () => {
      try {
        const { callId: id } = await orpcClient.calls.start();
        sentRef.current = new Set();
        seqRef.current = 0;
        feedSeenRef.current = new Set();
        setFeed([]);
        setHangupRequested(false);
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
    setHangupRequested(false);
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
      feed,
      lastCallId,
      startCall,
      endCall,
      send,
    }),
    [agent, userName, callId, liveCall, feed, lastCallId, startCall, endCall, send],
  );

  return <CallSessionContext.Provider value={value}>{children}</CallSessionContext.Provider>;
}

export function useCallSession(): CallSession {
  const ctx = use(CallSessionContext);
  if (!ctx) throw new Error("useCallSession must be used within CallSessionProvider");
  return ctx;
}
