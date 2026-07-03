import { asc, desc, eq } from "drizzle-orm";
import type { db as appDb } from "../db";
import { call, callReport, callToolEvent, transcriptEntry } from "../db/schema";
import { resolveRoute, type RouteTarget } from "./routing";
import { listStaff, type ShiftClock } from "./staff";
import { transferProvider, type TransferProvider } from "./transfer";

type Db = typeof appDb;
export type CallRow = typeof call.$inferSelect;
export type TranscriptRow = typeof transcriptEntry.$inferSelect;
export type ToolEventRow = typeof callToolEvent.$inferSelect;
export type CallReportRow = typeof callReport.$inferSelect;

/* ── lifecycle ───────────────────────────────────────────────────────── */

export async function startCall(db: Db): Promise<CallRow> {
  const [row] = await db.insert(call).values({ id: crypto.randomUUID() }).returning();
  return row!;
}

export async function getCallRow(db: Db, id: string): Promise<CallRow | null> {
  const [row] = await db.select().from(call).where(eq(call.id, id)).limit(1);
  return row ?? null;
}

export interface CallDetail {
  call: CallRow;
  transcript: TranscriptRow[];
  toolEvents: ToolEventRow[];
  report: CallReportRow | null;
}

export async function getCallDetail(db: Db, id: string): Promise<CallDetail | null> {
  const row = await getCallRow(db, id);
  if (!row) return null;
  const transcript = await db
    .select()
    .from(transcriptEntry)
    .where(eq(transcriptEntry.callId, id))
    .orderBy(asc(transcriptEntry.seq));
  const toolEvents = await db
    .select()
    .from(callToolEvent)
    .where(eq(callToolEvent.callId, id))
    .orderBy(asc(callToolEvent.at));
  const [report] = await db.select().from(callReport).where(eq(callReport.callId, id)).limit(1);
  return { call: row, transcript, toolEvents, report: report ?? null };
}

export async function listCalls(db: Db, limit = 100): Promise<CallRow[]> {
  return db.select().from(call).orderBy(desc(call.startedAt)).limit(limit);
}

export async function completeCall(db: Db, id: string): Promise<CallRow | null> {
  const row = await getCallRow(db, id);
  if (!row) return null;
  if (row.status === "completed") return row; // idempotent
  const endedAt = new Date();
  const durationSeconds = Math.max(
    0,
    Math.round((endedAt.getTime() - row.startedAt.getTime()) / 1000),
  );
  const [updated] = await db
    .update(call)
    .set({ status: "completed", endedAt, durationSeconds })
    .where(eq(call.id, id))
    .returning();
  return updated ?? null;
}

/* ── screening ───────────────────────────────────────────────────────── */

export type Screening = "legitimate" | "spam" | "scam" | "emergency";

export interface ScreeningInstruction {
  classification: Screening;
  action: "continue" | "decline_and_end" | "emergency";
}

/** The application's response to each screening outcome — policy, not prompt. */
const SCREENING_ACTIONS: Record<Screening, ScreeningInstruction["action"]> = {
  legitimate: "continue",
  spam: "decline_and_end",
  scam: "decline_and_end",
  emergency: "emergency",
};

export async function recordScreening(
  db: Db,
  id: string,
  classification: Screening,
): Promise<ScreeningInstruction> {
  const patch: Partial<typeof call.$inferInsert> = { screening: classification };
  if (classification === "emergency") patch.urgency = "emergency";
  await db.update(call).set(patch).where(eq(call.id, id));
  return { classification, action: SCREENING_ACTIONS[classification] };
}

/* ── caller information ──────────────────────────────────────────────── */

export interface CallerInfoPatch {
  callerName?: string;
  callerPhone?: string;
  reason?: string;
  residentName?: string;
  relationship?: string;
  callbackTime?: string;
  urgency?: string;
  requestedStaff?: string;
}

const REQUIRED_FIELDS = [
  ["callerName", "caller name"],
  ["callerPhone", "callback number"],
  ["reason", "reason for calling"],
] as const;

export async function saveCallerInfo(
  db: Db,
  id: string,
  patch: CallerInfoPatch,
): Promise<{ ok: boolean; missing: string[] }> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string" && value.trim() !== "") values[key] = value.trim();
  }
  if (Object.keys(values).length > 0) {
    await db.update(call).set(values).where(eq(call.id, id));
  }
  const row = await getCallRow(db, id);
  if (!row) return { ok: false, missing: [] };
  const missing = REQUIRED_FIELDS.filter(([key]) => !row[key]).map(([, label]) => label);
  return { ok: true, missing };
}

/* ── routing ─────────────────────────────────────────────────────────── */

export interface RouteInstruction {
  action: "transfer" | "voicemail" | "answer" | "emergency";
  destination: { name: string; role: string; department: string; extension: string } | null;
  outcome: string;
  reason: string;
}

/**
 * Route the call: the engine decides against the live staff table, the
 * transfer provider executes, and the outcome is persisted. The instruction
 * returned tells the assistant what happened — it never chooses.
 */
export async function routeCall(
  db: Db,
  id: string,
  target: RouteTarget,
  at: ShiftClock,
  provider: TransferProvider = transferProvider,
): Promise<RouteInstruction> {
  const rows = await listStaff(db);
  const decision = resolveRoute(target, rows, at);

  let action = decision.action;
  let outcome: string;
  let detail = decision.reason;

  if (action === "transfer" && decision.destination) {
    const result = await provider.transfer({ callId: id, destination: decision.destination });
    if (result.outcome === "transferred") {
      outcome = "transferred";
      detail = result.detail;
    } else {
      action = "voicemail";
      outcome = "voicemail";
      detail = `Transfer failed (${result.detail}); offering voicemail.`;
    }
  } else if (action === "voicemail") {
    outcome = "voicemail";
  } else if (action === "emergency") {
    outcome = "emergency";
  } else {
    outcome = "answered_directly";
  }

  await db
    .update(call)
    .set({
      routeTarget: target,
      destinationName: decision.destination?.name ?? null,
      destinationAvailable: action === "transfer",
      transferOutcome: outcome,
    })
    .where(eq(call.id, id));

  return {
    action,
    destination: decision.destination
      ? {
          name: decision.destination.name,
          role: decision.destination.role,
          department: decision.destination.department,
          extension: decision.destination.extension,
        }
      : null,
    outcome,
    reason: detail,
  };
}

/* ── voicemail ───────────────────────────────────────────────────────── */

export async function saveVoicemail(db: Db, id: string, message: string): Promise<boolean> {
  const row = await getCallRow(db, id);
  if (!row) return false;
  // Append-only: a second message never overwrites the first.
  const voicemail = row.voicemail ? `${row.voicemail}\n---\n${message}` : message;
  await db.update(call).set({ voicemail, transferOutcome: "voicemail" }).where(eq(call.id, id));
  return true;
}

/* ── transcript + tool audit ─────────────────────────────────────────── */

export interface TranscriptEntryInput {
  entryId: string;
  seq: number;
  role: "caller" | "assistant";
  text: string;
}

export async function appendTranscript(
  db: Db,
  id: string,
  entries: TranscriptEntryInput[],
): Promise<{ ok: boolean }> {
  if (entries.length === 0) return { ok: true };
  await db
    .insert(transcriptEntry)
    .values(entries.map((e) => ({ callId: id, ...e })))
    .onConflictDoNothing(); // idempotent on client retry
  return { ok: true };
}

export async function recordToolEvent(
  db: Db,
  id: string,
  name: string,
  detail: unknown,
): Promise<void> {
  let text: string | null = null;
  try {
    text = (typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 500);
  } catch {
    text = null;
  }
  await db
    .insert(callToolEvent)
    .values({ id: crypto.randomUUID(), callId: id, name, detail: text });
}
