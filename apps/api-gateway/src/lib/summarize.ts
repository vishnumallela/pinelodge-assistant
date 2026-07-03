import { eq } from "drizzle-orm";
import type { db as appDb } from "../db";
import { call, callReport } from "../db/schema";
import { env } from "../env";
import { getCallDetail, type CallDetail } from "./calls";
import { deliverCallReport } from "./webhook";

type Db = typeof appDb;

/**
 * Asynchronous call summarization. After a call completes, a job runs against
 * a lower-cost chat model (never the realtime model) and stores the permanent
 * Call Report. The queue is in-process for the proof of concept; replace
 * queueSummarization's body with a durable queue producer to scale out —
 * callers won't change.
 */

const API = "https://api.openai.com/v1";

export interface CallReportDraft {
  executiveSummary: string;
  callerIntent: string;
  informationCollected: string;
  routingDecision: string;
  followUp: string;
  finalDisposition: string;
}

function field(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Pure parser for the model's JSON reply so fallback behaviour is testable. */
export function parseCallReport(raw: string): CallReportDraft {
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
  return {
    executiveSummary: field(obj.executiveSummary) || "Not documented.",
    callerIntent: field(obj.callerIntent) || "Not documented.",
    informationCollected: field(obj.informationCollected) || "Not documented.",
    routingDecision: field(obj.routingDecision) || "Not documented.",
    followUp: field(obj.followUp) || "None required.",
    finalDisposition: field(obj.finalDisposition) || "Not documented.",
  };
}

/** Flatten call state + tool audit + transcript into the model's input. */
export function buildSummaryInput(detail: CallDetail): string {
  const c = detail.call;
  const meta = [
    `Call ID: ${c.id}`,
    `Started: ${c.startedAt.toISOString()}`,
    c.endedAt ? `Ended: ${c.endedAt.toISOString()}` : null,
    c.durationSeconds != null ? `Duration: ${c.durationSeconds}s` : null,
    `Screening: ${c.screening}`,
    c.callerName ? `Caller: ${c.callerName}` : null,
    c.callerPhone ? `Callback number: ${c.callerPhone}` : null,
    c.reason ? `Stated reason: ${c.reason}` : null,
    c.residentName ? `Resident: ${c.residentName}` : null,
    c.relationship ? `Relationship: ${c.relationship}` : null,
    c.callbackTime ? `Preferred callback time: ${c.callbackTime}` : null,
    c.urgency ? `Urgency: ${c.urgency}` : null,
    c.requestedStaff ? `Requested staff: ${c.requestedStaff}` : null,
    c.routeTarget ? `Route target: ${c.routeTarget}` : null,
    c.destinationName ? `Destination: ${c.destinationName}` : null,
    `Transfer outcome: ${c.transferOutcome}`,
    c.voicemail ? `Voicemail left:\n${c.voicemail}` : null,
  ].filter(Boolean);

  const tools = detail.toolEvents.map((t) => `- ${t.name}: ${t.detail ?? ""}`);
  const transcript = detail.transcript.map(
    (t) => `${t.role === "assistant" ? "Sarah" : "Caller"}: ${t.text}`,
  );

  return [
    "# Call state",
    ...meta,
    "",
    "# Tools executed",
    tools.length > 0 ? tools.join("\n") : "(none)",
    "",
    "# Transcript",
    transcript.length > 0 ? transcript.join("\n") : "(no transcript captured)",
  ].join("\n");
}

async function respond(input: string): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured on the server.");
  const r = await fetch(`${API}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: env.OPENAI_SUMMARY_MODEL,
      instructions:
        "You write post-call reports for the front desk of an assisted living community. " +
        "From the call state and transcript, respond with ONLY a JSON object — no prose, no code " +
        "fences — with exactly these string keys: executiveSummary (2-3 sentences), callerIntent, " +
        "informationCollected (the caller details gathered, as compact prose), routingDecision " +
        "(where the call was sent and why), followUp (what staff should do next, or 'None " +
        "required.'), finalDisposition (one short phrase, e.g. 'Transferred to Admissions' or " +
        "'Voicemail for Billing'). Base everything strictly on the input; if something was not " +
        "captured, write 'Not documented.'",
      input: [{ role: "user", content: [{ type: "input_text", text: input }] }],
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Summarization failed (${r.status}): ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as {
    output_text?: string;
    output?: { content?: { type?: string; text?: string }[] }[];
  };
  if (typeof data.output_text === "string" && data.output_text.trim() !== "") {
    return data.output_text.trim();
  }
  const parts: string[] = [];
  for (const o of data.output ?? [])
    for (const c of o.content ?? []) if (c.type === "output_text" && c.text) parts.push(c.text);
  return parts.join(" ").trim();
}

export async function generateCallReport(detail: CallDetail): Promise<CallReportDraft> {
  return parseCallReport(await respond(buildSummaryInput(detail)));
}

export async function runSummarization(db: Db, callId: string, attempts = 3): Promise<boolean> {
  const detail = await getCallDetail(db, callId);
  if (!detail || detail.report) return Boolean(detail?.report);
  await db.update(call).set({ summaryStatus: "pending" }).where(eq(call.id, callId));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const draft = await generateCallReport(detail);
      await db
        .insert(callReport)
        .values({ callId, ...draft, model: env.OPENAI_SUMMARY_MODEL })
        .onConflictDoNothing(); // reports are permanent; never overwrite
      await db.update(call).set({ summaryStatus: "complete" }).where(eq(call.id, callId));
      // Ship the finished report to the configured webhook (no-op when unset).
      const fresh = await getCallDetail(db, callId);
      if (fresh) void deliverCallReport(fresh);
      return true;
    } catch (e) {
      console.error(`[summarize] call ${callId} attempt ${attempt}/${attempts}:`, e);
      if (attempt < attempts) {
        await new Promise<void>((res) => setTimeout(res, 2000 * attempt));
      }
    }
  }
  await db.update(call).set({ summaryStatus: "failed" }).where(eq(call.id, callId));
  return false;
}

/** Fire-and-forget enqueue; the call flow never waits on the report. */
export function queueSummarization(db: Db, callId: string): void {
  setTimeout(() => {
    void runSummarization(db, callId);
  }, 0);
}
