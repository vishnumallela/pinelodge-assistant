import { env } from "./env";
import { bearerHeaders } from "./bearer";
import type { VoiceTokenInfo } from "@/hooks/useVoiceAgent";

export async function fetchVoiceToken(): Promise<VoiceTokenInfo> {
  const r = await fetch(`${env.API_URL}/api/realtime/token`, {
    method: "POST",
    credentials: "include",
    headers: { ...bearerHeaders() },
  });
  const data = (await r.json().catch(() => ({}))) as {
    token?: string;
    model?: string;
    voice?: string;
    transcribeModel?: string;
    error?: string;
  };
  if (!r.ok || !data.token) throw new Error(data.error ?? "Could not start the call.");
  return {
    token: data.token,
    model: data.model,
    voice: data.voice,
    transcribeModel: data.transcribeModel,
  };
}
