import { env } from "./env";
import type { CallSummary, TranscriptTurn } from "./schema";

/**
 * Post-call summarization against an xAI text model (never the realtime one).
 * Runs from the BullMQ worker once a call is locked.
 */

const CHAT_URL = "https://api.x.ai/v1/chat/completions";

const SYSTEM = [
  "You are a front-desk supervisor at an assisted living community writing up a phone call for the record.",
  "You are given the full transcript between the receptionist (Sarah) and a caller.",
  "Write a tight, factual summary a colleague can skim. Never invent details not in the transcript.",
  "Reply with ONLY a JSON object, no prose, with these string fields:",
  '- "headline": one sentence capturing who called and what happened.',
  '- "caller": who the caller is and what they wanted (or "Unknown" if unclear).',
  '- "keyPoints": array of 2-4 short bullet strings of the concrete facts.',
  '- "outcome": where the call was redirected or how it resolved.',
  '- "followUp": any action someone should take, or "None." if nothing is needed.',
].join("\n");

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Tolerant parser so a malformed reply still yields a usable summary. */
function parseSummary(raw: string): CallSummary {
  let obj: Record<string, unknown> = {};
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  }
  const points = Array.isArray(obj.keyPoints)
    ? obj.keyPoints.map(str).filter(Boolean).slice(0, 5)
    : [];
  return {
    headline: str(obj.headline) || "Call summary unavailable.",
    caller: str(obj.caller) || "Unknown.",
    keyPoints: points.length > 0 ? points : ["No details were captured."],
    outcome: str(obj.outcome) || "Not documented.",
    followUp: str(obj.followUp) || "None.",
  };
}

function renderTranscript(transcript: TranscriptTurn[]): string {
  if (transcript.length === 0) return "(The call had no transcribed speech.)";
  return transcript
    .map((t) => `${t.role === "assistant" ? "Sarah" : "Caller"}: ${t.text}`)
    .join("\n");
}

export async function summarizeTranscript(transcript: TranscriptTurn[]): Promise<CallSummary> {
  if (!env.XAI_API_KEY) throw new Error("XAI_API_KEY is not set");
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.XAI_SUMMARY_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Transcript:\n\n${renderTranscript(transcript)}` },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`xAI summary failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return parseSummary(data.choices?.[0]?.message?.content ?? "");
}
