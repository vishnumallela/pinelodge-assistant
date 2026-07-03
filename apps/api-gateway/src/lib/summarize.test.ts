import { describe, expect, test } from "bun:test";
import type { CallDetail } from "./calls";
import { buildSummaryInput, parseCallReport } from "./summarize";

describe("parseCallReport", () => {
  test("parses a clean JSON object", () => {
    const draft = parseCallReport(
      JSON.stringify({
        executiveSummary: "Daughter called about billing.",
        callerIntent: "Billing question",
        informationCollected: "June Alvarez, 817-555-0100.",
        routingDecision: "Transferred to Mira in Billing.",
        followUp: "None required.",
        finalDisposition: "Transferred to Billing",
      }),
    );
    expect(draft.executiveSummary).toBe("Daughter called about billing.");
    expect(draft.finalDisposition).toBe("Transferred to Billing");
  });

  test("extracts JSON wrapped in prose or fences", () => {
    const draft = parseCallReport(
      'Here is the report:\n```json\n{"executiveSummary":"Tour request.","callerIntent":"Admissions"}\n```',
    );
    expect(draft.executiveSummary).toBe("Tour request.");
    expect(draft.callerIntent).toBe("Admissions");
  });

  test("falls back to safe defaults on malformed output", () => {
    const draft = parseCallReport("not json at all");
    expect(draft.executiveSummary).toBe("Not documented.");
    expect(draft.followUp).toBe("None required.");
  });
});

describe("buildSummaryInput", () => {
  test("includes call state, tool audit and speaker-labelled transcript", () => {
    const detail: CallDetail = {
      call: {
        id: "c1",
        status: "completed",
        startedAt: new Date("2026-07-03T14:00:00Z"),
        endedAt: new Date("2026-07-03T14:04:30Z"),
        durationSeconds: 270,
        callerName: "June Alvarez",
        callerPhone: "817-555-0100",
        reason: "Billing question about June invoice",
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
        summaryStatus: "pending",
      },
      transcript: [
        {
          callId: "c1",
          entryId: "e1",
          seq: 0,
          role: "assistant",
          text: "Thank you for calling Pine Lodge.",
          at: new Date(),
        },
        {
          callId: "c1",
          entryId: "e2",
          seq: 1,
          role: "caller",
          text: "I have a question about my father's invoice.",
          at: new Date(),
        },
      ],
      toolEvents: [
        {
          id: "t1",
          callId: "c1",
          name: "route_call",
          detail: '{"target":"billing"}',
          at: new Date(),
        },
      ],
      report: null,
    };

    const input = buildSummaryInput(detail);
    expect(input).toContain("Caller: June Alvarez");
    expect(input).toContain("Destination: Mira");
    expect(input).toContain("route_call");
    expect(input).toContain("Sarah: Thank you for calling Pine Lodge.");
    expect(input).toContain("Caller: I have a question about my father's invoice.");
  });
});
