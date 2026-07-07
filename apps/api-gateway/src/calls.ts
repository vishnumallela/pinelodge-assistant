import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { ship } from "./observability";
import { calls, type CallRow, type CallSummary, type TranscriptTurn } from "./schema";

/**
 * Single-admin data layer: every call (console, Twilio, SIP) belongs to the
 * one dashboard, so queries are id-scoped only. The userId column records the
 * call's source ("console" or the caller's line) for display.
 */

export async function createCall(source: string): Promise<CallRow> {
  const [row] = await db.insert(calls).values({ userId: source }).returning();
  return row!;
}

/** Newest-first page of the log plus the total, for server-side pagination. */
export async function listCallsPage(
  page: number,
  pageSize: number,
): Promise<{ calls: CallRow[]; total: number }> {
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(calls)
      .orderBy(desc(calls.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(calls),
  ]);
  return { calls: rows, total: count?.total ?? 0 };
}

export async function getCall(id: string): Promise<CallRow | null> {
  const [row] = await db.select().from(calls).where(eq(calls.id, id)).limit(1);
  return row ?? null;
}

/** Append a system event to the call's debug timeline (works on locked calls
 *  too — events are telemetry, not conversation data) and mirror it to the
 *  service log. */
export async function logCallEvent(id: string, event: string, detail?: string): Promise<void> {
  console.log(`[call ${id.slice(0, 8)}] ${event}${detail ? `: ${detail}` : ""}`);
  ship("call_events", { call_id: id, event, detail: detail ?? "" });
  const entry = { at: new Date().toISOString(), event, ...(detail ? { detail } : {}) };
  try {
    await db
      .update(calls)
      .set({ events: sql`${calls.events} || ${JSON.stringify([entry])}::jsonb` })
      .where(eq(calls.id, id));
  } catch (e) {
    console.error(`[call ${id.slice(0, 8)}] event write failed:`, e);
  }
}

/** Persist the running transcript. Only an active call accepts writes — an
 *  ended call is locked. Returns false when the call is missing or locked. */
export async function saveTranscript(id: string, transcript: TranscriptTurn[]): Promise<boolean> {
  const res = await db
    .update(calls)
    .set({ transcript })
    .where(and(eq(calls.id, id), eq(calls.status, "active")))
    .returning({ id: calls.id });
  return res.length > 0;
}

/** Lock the call and move it into summarizing. Idempotent-safe: only an active
 *  call transitions, so a double end is a no-op. Returns the locked row (with
 *  the final transcript applied) or null if it was missing / already ended. */
export async function endCall(
  id: string,
  transcript: TranscriptTurn[] | undefined,
): Promise<CallRow | null> {
  const existing = await getCall(id);
  if (!existing || existing.status !== "active") return null;
  const endedAt = new Date();
  const durationSeconds = Math.max(
    0,
    Math.round((endedAt.getTime() - existing.startedAt.getTime()) / 1000),
  );
  const [row] = await db
    .update(calls)
    .set({
      status: "summarizing",
      endedAt,
      durationSeconds,
      // Only overwrite when a final transcript is supplied; otherwise keep the
      // one streamed during the call (an empty array must not wipe it).
      ...(transcript && transcript.length > 0 ? { transcript } : {}),
    })
    .where(and(eq(calls.id, id), eq(calls.status, "active")))
    .returning();
  return row ?? null;
}

export async function saveSummary(id: string, summary: CallSummary): Promise<void> {
  await db.update(calls).set({ status: "done", summary }).where(eq(calls.id, id));
}

export async function markFailed(id: string): Promise<void> {
  await db.update(calls).set({ status: "failed" }).where(eq(calls.id, id));
}
