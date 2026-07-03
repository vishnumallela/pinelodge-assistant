import { env } from "../env";
import type { CallDetail } from "./calls";

/**
 * Call-report delivery. When CALL_REPORT_WEBHOOK_URL is set, the finished
 * report is POSTed there as JSON — point it at Zapier/n8n/your mailer to turn
 * reports into emails without coupling this service to a mail provider.
 * Unset URL = feature off.
 */

export interface CallReportWebhookPayload {
  event: "call.report.created";
  callId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  caller: {
    name: string | null;
    phone: string | null;
    resident: string | null;
    relationship: string | null;
  };
  screening: string;
  routeTarget: string | null;
  destination: string | null;
  transferOutcome: string;
  voicemail: string | null;
  report: {
    executiveSummary: string;
    callerIntent: string;
    informationCollected: string;
    routingDecision: string;
    followUp: string;
    finalDisposition: string;
  } | null;
}

export function buildWebhookPayload(detail: CallDetail): CallReportWebhookPayload {
  const c = detail.call;
  return {
    event: "call.report.created",
    callId: c.id,
    startedAt: c.startedAt.toISOString(),
    endedAt: c.endedAt?.toISOString() ?? null,
    durationSeconds: c.durationSeconds,
    caller: {
      name: c.callerName,
      phone: c.callerPhone,
      resident: c.residentName,
      relationship: c.relationship,
    },
    screening: c.screening,
    routeTarget: c.routeTarget,
    destination: c.destinationName,
    transferOutcome: c.transferOutcome,
    voicemail: c.voicemail,
    report: detail.report
      ? {
          executiveSummary: detail.report.executiveSummary,
          callerIntent: detail.report.callerIntent,
          informationCollected: detail.report.informationCollected,
          routingDecision: detail.report.routingDecision,
          followUp: detail.report.followUp,
          finalDisposition: detail.report.finalDisposition,
        }
      : null,
  };
}

export async function deliverCallReport(detail: CallDetail, attempts = 3): Promise<boolean> {
  const url = env.CALL_REPORT_WEBHOOK_URL;
  if (!url) return false;
  const body = JSON.stringify(buildWebhookPayload(detail));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) return true;
      console.error(`[webhook] call ${detail.call.id} delivery got ${r.status}`);
    } catch (e) {
      console.error(`[webhook] call ${detail.call.id} attempt ${attempt}/${attempts}:`, e);
    }
    if (attempt < attempts) await new Promise<void>((res) => setTimeout(res, 1500 * attempt));
  }
  return false;
}
