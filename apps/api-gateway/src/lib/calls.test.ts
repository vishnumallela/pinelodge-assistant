import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { TEST_DDL } from "../db";
import {
  appendTranscript,
  completeCall,
  getCallDetail,
  listCalls,
  recordScreening,
  recordToolEvent,
  routeCall,
  saveCallerInfo,
  saveVoicemail,
  startCall,
} from "./calls";
import { seedDefaultStaff, type ShiftClock } from "./staff";
import type { TransferProvider } from "./transfer";

type AppDb = typeof import("../db").db;

let client: PGlite;
let db: AppDb;

const businessHours: ShiftClock = { day: "tue", minutes: 10 * 60 };
const midnight: ShiftClock = { day: "sun", minutes: 30 };

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client) as unknown as AppDb;
  await client.exec(TEST_DDL);
});

beforeEach(async () => {
  await client.exec(
    `DELETE FROM "call"; DELETE FROM "transcript_entry"; DELETE FROM "call_tool_event";
     DELETE FROM "call_report"; DELETE FROM "staff";`,
  );
  await seedDefaultStaff(db);
});

afterAll(async () => {
  await client.close();
});

describe("call lifecycle", () => {
  test("every call gets its own id and starts active", async () => {
    const a = await startCall(db);
    const b = await startCall(db);
    expect(a.id).not.toBe(b.id);
    expect(a.status).toBe("active");
    expect(a.screening).toBe("pending");
  });

  test("complete stamps end time and duration, and is idempotent", async () => {
    const c = await startCall(db);
    const done = await completeCall(db, c.id);
    expect(done?.status).toBe("completed");
    expect(done?.endedAt).not.toBeNull();
    expect(done?.durationSeconds).toBeGreaterThanOrEqual(0);

    const again = await completeCall(db, c.id);
    expect(again?.endedAt?.getTime()).toBe(done?.endedAt?.getTime());
  });
});

describe("screening", () => {
  test("spam and scam are declined and ended by policy", async () => {
    for (const cls of ["spam", "scam"] as const) {
      const c = await startCall(db);
      const r = await recordScreening(db, c.id, cls);
      expect(r.action).toBe("decline_and_end");
      expect(r.instruction).toContain("end_call");
      expect((await getCallDetail(db, c.id))!.call.transferOutcome).toBe("declined");
    }
  });

  test("emergency switches to the emergency workflow and marks urgency", async () => {
    const c = await startCall(db);
    const r = await recordScreening(db, c.id, "emergency");
    expect(r.action).toBe("emergency");
    const detail = await getCallDetail(db, c.id);
    expect(detail?.call.urgency).toBe("emergency");
  });

  test("legitimate calls continue", async () => {
    const c = await startCall(db);
    expect((await recordScreening(db, c.id, "legitimate")).action).toBe("continue");
  });
});

describe("caller information", () => {
  test("tracks which required fields are still missing", async () => {
    const c = await startCall(db);
    let r = await saveCallerInfo(db, c.id, { callerName: "June Alvarez" });
    expect(r.missing).toEqual(["callback number", "reason for calling"]);

    r = await saveCallerInfo(db, c.id, { callerPhone: "817-555-0100", reason: "billing question" });
    expect(r.missing).toEqual([]);
  });

  test("empty strings never clobber saved values", async () => {
    const c = await startCall(db);
    await saveCallerInfo(db, c.id, { callerName: "June" });
    await saveCallerInfo(db, c.id, { callerName: "  " });
    const detail = await getCallDetail(db, c.id);
    expect(detail?.call.callerName).toBe("June");
  });
});

describe("routing + transfer outcome", () => {
  test("business-hours billing call is transferred to Mira and persisted", async () => {
    const c = await startCall(db);
    const r = await routeCall(db, c.id, "billing", businessHours);
    expect(r.action).toBe("transfer");
    expect(r.destination?.name).toBe("Mira");

    const row = (await getCallDetail(db, c.id))!.call;
    expect(row.routeTarget).toBe("billing");
    expect(row.destinationName).toBe("Mira");
    expect(row.destinationAvailable).toBe(true);
    expect(row.transferOutcome).toBe("transferred");
  });

  test("off-hours billing call is offered voicemail", async () => {
    const c = await startCall(db);
    const r = await routeCall(db, c.id, "billing", midnight);
    expect(r.action).toBe("voicemail");
    const row = (await getCallDetail(db, c.id))!.call;
    expect(row.transferOutcome).toBe("voicemail");
    expect(row.destinationAvailable).toBe(false);
  });

  test("a failed transfer degrades to voicemail", async () => {
    const failing: TransferProvider = {
      kind: "test-failing",
      transfer: () => Promise.resolve({ outcome: "failed", detail: "line busy" }),
    };
    const c = await startCall(db);
    const r = await routeCall(db, c.id, "admissions", businessHours, failing);
    expect(r.action).toBe("voicemail");
    expect((await getCallDetail(db, c.id))!.call.transferOutcome).toBe("voicemail");
  });

  test("general questions are answered without a destination", async () => {
    const c = await startCall(db);
    const r = await routeCall(db, c.id, "general_question", businessHours);
    expect(r.action).toBe("answer");
    expect((await getCallDetail(db, c.id))!.call.transferOutcome).toBe("answered_directly");
  });
});

describe("voicemail", () => {
  test("messages append and never overwrite", async () => {
    const c = await startCall(db);
    await saveVoicemail(db, c.id, "First message.");
    await saveVoicemail(db, c.id, "Second message.");
    const row = (await getCallDetail(db, c.id))!.call;
    expect(row.voicemail).toContain("First message.");
    expect(row.voicemail).toContain("Second message.");
  });
});

describe("transcript", () => {
  test("entries persist in order and retries are idempotent", async () => {
    const c = await startCall(db);
    const entries = [
      {
        entryId: "e1",
        seq: 0,
        role: "assistant" as const,
        text: "Thank you for calling Pine Lodge.",
      },
      { entryId: "e2", seq: 1, role: "caller" as const, text: "Hi, I'd like to book a tour." },
    ];
    await appendTranscript(db, c.id, entries);
    await appendTranscript(db, c.id, entries); // client retry
    await appendTranscript(db, c.id, [
      { entryId: "e3", seq: 2, role: "assistant", text: "Happy to help with that." },
    ]);

    const detail = await getCallDetail(db, c.id);
    expect(detail?.transcript).toHaveLength(3);
    expect(detail?.transcript.map((t) => t.entryId)).toEqual(["e1", "e2", "e3"]);
  });
});

describe("tool audit + listing", () => {
  test("tool events are recorded against the call", async () => {
    const c = await startCall(db);
    await recordToolEvent(db, c.id, "check_availability", { officeOpen: true });
    const detail = await getCallDetail(db, c.id);
    expect(detail?.toolEvents).toHaveLength(1);
    expect(detail?.toolEvents[0]!.name).toBe("check_availability");
  });

  test("listCalls returns newest first", async () => {
    const first = await startCall(db);
    await new Promise<void>((r) => setTimeout(r, 5));
    const second = await startCall(db);
    const list = await listCalls(db);
    expect(list[0]!.id).toBe(second.id);
    expect(list[1]!.id).toBe(first.id);
  });
});
