import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { calls, type CallRow, type CallSummary, type TranscriptTurn } from "./schema";

export async function createCall(userId: string): Promise<CallRow> {
  const [row] = await db.insert(calls).values({ userId }).returning();
  return row!;
}

export function listCalls(userId: string): Promise<CallRow[]> {
  return db.select().from(calls).where(eq(calls.userId, userId)).orderBy(desc(calls.createdAt));
}

export async function getCall(userId: string, id: string): Promise<CallRow | null> {
  const [row] = await db
    .select()
    .from(calls)
    .where(and(eq(calls.id, id), eq(calls.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Persist the running transcript. Only an active call accepts writes — an
 *  ended call is locked. Returns false when the call is missing or locked. */
export async function saveTranscript(
  userId: string,
  id: string,
  transcript: TranscriptTurn[],
): Promise<boolean> {
  const res = await db
    .update(calls)
    .set({ transcript })
    .where(and(eq(calls.id, id), eq(calls.userId, userId), eq(calls.status, "active")))
    .returning({ id: calls.id });
  return res.length > 0;
}

/** Lock the call and move it into summarizing. Idempotent-safe: only an active
 *  call transitions, so a double end is a no-op. Returns the locked row (with
 *  the final transcript applied) or null if it was missing / already ended. */
export async function endCall(
  userId: string,
  id: string,
  transcript: TranscriptTurn[] | undefined,
): Promise<CallRow | null> {
  const existing = await getCall(userId, id);
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
    .where(and(eq(calls.id, id), eq(calls.userId, userId), eq(calls.status, "active")))
    .returning();
  return row ?? null;
}

export async function saveSummary(id: string, summary: CallSummary): Promise<void> {
  await db.update(calls).set({ status: "done", summary }).where(eq(calls.id, id));
}

export async function markFailed(id: string): Promise<void> {
  await db.update(calls).set({ status: "failed" }).where(eq(calls.id, id));
}
