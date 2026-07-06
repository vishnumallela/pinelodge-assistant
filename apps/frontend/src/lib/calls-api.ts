import { env } from "./env";
import { bearerHeaders } from "./bearer";

/** Mirrors the api-gateway call row. */
export type CallStatus = "active" | "summarizing" | "done" | "failed";

export interface TranscriptTurn {
  role: "caller" | "assistant";
  text: string;
}

export interface CallSummary {
  headline: string;
  caller: string;
  keyPoints: string[];
  outcome: string;
  followUp: string;
}

export interface Call {
  id: string;
  userId: string;
  status: CallStatus;
  transcript: TranscriptTurn[];
  summary: CallSummary | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  createdAt: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...bearerHeaders(),
      ...init?.headers,
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? `Request failed (${res.status})`);
  return data as T;
}

export function listCalls(): Promise<Call[]> {
  return api<{ calls: Call[] }>("/api/calls").then((d) => d.calls);
}

export function getCall(id: string): Promise<Call> {
  return api<{ call: Call }>(`/api/calls/${id}`).then((d) => d.call);
}

export function createCall(): Promise<Call> {
  return api<{ call: Call }>("/api/calls", { method: "POST" }).then((d) => d.call);
}

export function putTranscript(id: string, transcript: TranscriptTurn[]): Promise<void> {
  return api(`/api/calls/${id}/transcript`, {
    method: "PUT",
    body: JSON.stringify({ transcript }),
  }).then(() => undefined);
}

export function endCall(id: string, transcript: TranscriptTurn[]): Promise<Call> {
  return api<{ call: Call }>(`/api/calls/${id}/end`, {
    method: "POST",
    body: JSON.stringify({ transcript }),
  }).then((d) => d.call);
}
