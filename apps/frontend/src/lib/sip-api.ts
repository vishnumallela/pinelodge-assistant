import { env } from "./env";
import { bearerHeaders } from "./bearer";

export interface RegisteredNumber {
  phoneNumberId: string;
  phoneNumber: string;
  name: string;
  sipHost: string;
  createdAt: string;
}

export interface SipConfig {
  enabled: boolean;
  hasApiKey: boolean;
  hasSecret: boolean;
  secretSource: "env" | "registered" | null;
  webhookUrl: string;
  sipHost: string;
  numbers: RegisteredNumber[];
}

export interface RegisterNumberBody {
  phoneNumber: string;
  name: string;
  authUsername?: string;
  authPassword?: string;
  allowedAddresses?: string[];
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

export function getSipConfig(): Promise<SipConfig> {
  return api<SipConfig>("/api/sip/config");
}

export function registerSipNumber(
  body: RegisterNumberBody,
): Promise<{ number: RegisteredNumber; secret: string }> {
  return api("/api/sip/register", { method: "POST", body: JSON.stringify(body) });
}
