import { env } from "./env";
import { bearerHeaders } from "./bearer";

/** Mirrors the api-gateway staff row. */
export interface StaffMember {
  id: string;
  name: string;
  section: string;
  handles: string;
  /** E.164 number calls transfer to; empty means announce-only. */
  phone: string;
  /** Working days, 0 (Sun) – 6 (Sat). */
  days: number[];
  /** "HH:MM" 24h, facility timezone. */
  startTime: string;
  endTime: string;
  /** "YYYY-MM-DD" time-off dates. */
  timeOff: string[];
  isFallback: boolean;
  active: boolean;
  sort: number;
  availableNow: boolean;
}

export type StaffInput = Omit<StaffMember, "id" | "availableNow" | "sort"> & { sort?: number };

export interface AgentPrompt {
  prompt: string;
  template: string;
  greeting: string;
  staff: StaffMember[];
  defaults: { template: string; greeting: string };
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

export function listStaff(): Promise<StaffMember[]> {
  return api<{ staff: StaffMember[] }>("/api/staff").then((d) => d.staff);
}

export function createStaff(input: StaffInput): Promise<StaffMember> {
  return api<{ staff: StaffMember }>("/api/staff", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((d) => d.staff);
}

export function updateStaff(id: string, input: StaffInput): Promise<StaffMember> {
  return api<{ staff: StaffMember }>(`/api/staff/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }).then((d) => d.staff);
}

export function deleteStaff(id: string): Promise<void> {
  return api(`/api/staff/${id}`, { method: "DELETE" }).then(() => undefined);
}

export function getAgentPrompt(): Promise<AgentPrompt> {
  return api<AgentPrompt>("/api/agent/prompt");
}

export function saveAgentPrompt(template: string, greeting: string): Promise<AgentPrompt> {
  return api<AgentPrompt>("/api/agent/prompt", {
    method: "PUT",
    body: JSON.stringify({ template, greeting }),
  });
}
