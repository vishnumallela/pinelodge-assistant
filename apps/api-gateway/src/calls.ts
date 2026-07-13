import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import { db } from "./db";
import {
  calls,
  centers,
  type CallKind,
  type CallRow,
  type CallSummary,
  type TranscriptTurn,
} from "./schema";

/**
 * Admin data layer: every call belongs to a center. The userId column records
 * the call's source ("console" or the caller's line) for display; the log is
 * read center-scoped, matching the dashboard's center dropdown.
 */

export async function createCall(
  source: string,
  centerId: string,
  kind: CallKind = "standard",
): Promise<CallRow> {
  const [row] = await db
    .insert(calls)
    .values({ userId: source, centerId, kind, triage: kind === "message" ? "open" : "none" })
    .returning();
  return row!;
}

/** Newest-first page of after-hours messages across ALL centers — the
 *  morning triage inbox is deliberately not center-scoped. */
export async function listMessagesPage(
  page: number,
  pageSize: number,
  onlyOpen: boolean,
): Promise<{ calls: (CallRow & { centerName: string })[]; total: number; openCount: number }> {
  const where = onlyOpen
    ? and(eq(calls.kind, "message"), eq(calls.triage, "open"))
    : eq(calls.kind, "message");
  const [rows, [count], [open]] = await Promise.all([
    db
      .select({ call: calls, centerName: centers.name })
      .from(calls)
      .leftJoin(centers, eq(calls.centerId, centers.id))
      .where(where)
      .orderBy(desc(calls.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(calls)
      .where(where),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(calls)
      .where(and(eq(calls.kind, "message"), eq(calls.triage, "open"))),
  ]);
  return {
    calls: rows.map((r) => ({ ...r.call, centerName: r.centerName ?? "Unknown center" })),
    total: count?.total ?? 0,
    openCount: open?.total ?? 0,
  };
}

/** Align a call's kind with the mode the agent actually ran (decided at
 *  stream open, ~1-2s after the webhook stamped kind from the cutoff). Keeps
 *  a straddling-the-cutoff message visible in the triage inbox — and stops a
 *  standard call from being stuck there. Never demotes a message already
 *  triaged done. */
export async function reconcileCallKind(id: string, mode: "standard" | "message"): Promise<void> {
  const kind: CallKind = mode === "message" ? "message" : "standard";
  await db
    .update(calls)
    .set({ kind, triage: kind === "message" ? "open" : "none" })
    .where(and(eq(calls.id, id), ne(calls.kind, kind), ne(calls.triage, "done")));
}

/** Boot sweep: a phone row whose media stream never delivered a start event
 *  (dropped upgrade, caller hung up before connect) stays 'active' forever.
 *  Fail anything active well past the bridge's own 10-minute cap so the log
 *  never shows a phantom in-progress call. */
export async function sweepStaleActiveCalls(): Promise<void> {
  await db
    .update(calls)
    .set({ status: "failed" })
    .where(
      and(eq(calls.status, "active"), lt(calls.createdAt, new Date(Date.now() - 15 * 60_000))),
    );
}

/** Re-drivable summary state: a row stuck in 'summarizing' (enqueue lost, or
 *  a crash between lock and enqueue) is returned so the worker can be
 *  re-primed on boot instead of the call hanging without a summary forever. */
export async function findStuckSummarizing(): Promise<CallRow[]> {
  return db
    .select()
    .from(calls)
    .where(
      and(eq(calls.status, "summarizing"), lt(calls.createdAt, new Date(Date.now() - 5 * 60_000))),
    );
}

/** Stash the agreed transfer target on the row so the resume webhook can
 *  dial it even after a redeploy or on another replica (the in-memory map
 *  doesn't survive either). */
export async function savePendingTransfer(
  id: string,
  target: { name: string; phone: string },
): Promise<void> {
  await db.update(calls).set({ pendingTransfer: target }).where(eq(calls.id, id));
}

/** Read and clear the persisted transfer target for the resume webhook. */
export async function takePendingTransferRow(
  id: string,
): Promise<{ name: string; phone: string } | null> {
  const [row] = await db
    .update(calls)
    .set({ pendingTransfer: null })
    .where(eq(calls.id, id))
    .returning({ pending: calls.pendingTransfer });
  return row?.pending ?? null;
}

/** Dessa's triage flip: open ↔ done. Only message calls carry a state. */
export async function setTriage(id: string, triage: "open" | "done"): Promise<boolean> {
  const res = await db
    .update(calls)
    .set({ triage })
    .where(and(eq(calls.id, id), eq(calls.kind, "message")))
    .returning({ id: calls.id });
  return res.length > 0;
}

/** Newest-first page of one center's log plus the total, for server-side
 *  pagination. */
export async function listCallsPage(
  centerId: string,
  page: number,
  pageSize: number,
): Promise<{ calls: CallRow[]; total: number }> {
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(calls)
      .where(eq(calls.centerId, centerId))
      .orderBy(desc(calls.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(calls)
      .where(eq(calls.centerId, centerId)),
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
