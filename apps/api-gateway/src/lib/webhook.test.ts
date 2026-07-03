import { describe, expect, test } from "bun:test";
import type { CallDetail } from "./calls";
import { buildWebhookPayload, deliverCallReport } from "./webhook";

const detail: CallDetail = {
  call: {
    id: "c1",
    status: "completed",
    startedAt: new Date("2026-07-03T14:00:00Z"),
    endedAt: new Date("2026-07-03T14:03:00Z"),
    durationSeconds: 180,
    callerName: "June Alvarez",
    callerPhone: "817-555-0100",
    reason: "Billing question",
    residentName: "Robert Alvarez",
    relationship: "Daughter",
    callbackTime: null,
    screening: "legitimate",
    urgency: null,
    requestedStaff: null,
    routeTarget: "billing",
    destinationName: "Mira",
    destinationAvailable: true,
    transferOutcome: "transferred",
    voicemail: null,
    summaryStatus: "complete",
  },
  transcript: [],
  toolEvents: [],
  report: {
    callId: "c1",
    executiveSummary: "Summary.",
    callerIntent: "Billing question",
    informationCollected: "Name and number.",
    routingDecision: "Transferred to Mira.",
    followUp: "None required.",
    finalDisposition: "Transferred to Billing",
    model: "gpt-5-mini",
    createdAt: new Date("2026-07-03T14:04:00Z"),
  },
};

describe("buildWebhookPayload", () => {
  test("flattens call state and report into the delivery payload", () => {
    const p = buildWebhookPayload(detail);
    expect(p.event).toBe("call.report.created");
    expect(p.callId).toBe("c1");
    expect(p.startedAt).toBe("2026-07-03T14:00:00.000Z");
    expect(p.caller.name).toBe("June Alvarez");
    expect(p.destination).toBe("Mira");
    expect(p.transferOutcome).toBe("transferred");
    expect(p.report?.finalDisposition).toBe("Transferred to Billing");
  });

  test("carries a null report when summarization has not produced one", () => {
    const p = buildWebhookPayload({ ...detail, report: null });
    expect(p.report).toBeNull();
  });
});

describe("deliverCallReport", () => {
  test("is a no-op when no webhook URL is configured", async () => {
    // env.CALL_REPORT_WEBHOOK_URL is unset in the test environment.
    expect(await deliverCallReport(detail)).toBe(false);
  });
});
