import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { centers, staff, staffAssignments, userPrefs, type CenterRow } from "./schema";

/**
 * Centers — the tenant unit. Every center runs the same receptionist with its
 * own inbound number, staff roster, prompt, and timezone. Boot guarantees at
 * least one center exists (the env-named default), so "which center?" always
 * has an answer.
 */

export async function listCenters(): Promise<CenterRow[]> {
  const rows = await db.select().from(centers).orderBy(asc(centers.sort), asc(centers.createdAt));
  return rows;
}

export async function getCenter(id: string): Promise<CenterRow | null> {
  const [row] = await db.select().from(centers).where(eq(centers.id, id)).limit(1);
  return row ?? null;
}

/** The first center by sort order — where legacy and unmatched traffic lands. */
export async function getDefaultCenter(): Promise<CenterRow | null> {
  const [row] = await db
    .select()
    .from(centers)
    .orderBy(asc(centers.sort), asc(centers.createdAt))
    .limit(1);
  return row ?? null;
}

/** Resolve an inbound call's dialed number ("To") to its center. */
export async function findCenterByNumber(phoneNumber: string): Promise<CenterRow | null> {
  const wanted = phoneNumber.trim();
  if (!wanted) return null;
  const [row] = await db.select().from(centers).where(eq(centers.phoneNumber, wanted)).limit(1);
  return row ?? null;
}

export interface CenterInput {
  name: string;
  timezone: string;
  active?: boolean;
  sort?: number;
}

/** IANA zone check — Intl throws on unknown zones. */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function createCenter(input: CenterInput): Promise<CenterRow> {
  const [row] = await db
    .insert(centers)
    .values({ ...input, sort: input.sort ?? 99 })
    .returning();
  return row!;
}

export async function updateCenter(
  id: string,
  input: Partial<CenterInput>,
): Promise<CenterRow | null> {
  const [row] = await db.update(centers).set(input).where(eq(centers.id, id)).returning();
  return row ?? null;
}

/** Store which Twilio number rings this center (empty strings to detach). */
export async function setCenterNumber(
  id: string,
  phoneNumber: string,
  twilioNumberSid: string,
): Promise<CenterRow | null> {
  const [row] = await db
    .update(centers)
    .set({ phoneNumber, twilioNumberSid })
    .where(eq(centers.id, id))
    .returning();
  return row ?? null;
}

/** Delete a center. Assignments and settings cascade; calls keep their
 *  center_id as history. People left with no assignment anywhere are removed
 *  too. The last center can never be deleted. */
export async function deleteCenter(id: string): Promise<{ ok: boolean; error?: string }> {
  const all = await listCenters();
  if (all.length <= 1) return { ok: false, error: "The last center cannot be deleted." };
  if (!all.some((c) => c.id === id)) return { ok: false, error: "Center not found." };
  await db.delete(centers).where(eq(centers.id, id));
  await db
    .delete(staff)
    .where(
      sql`NOT EXISTS (SELECT 1 FROM ${staffAssignments} WHERE ${staffAssignments.staffId} = ${staff.id})`,
    );
  return { ok: true };
}

/** The center this admin last selected in the dashboard, following them
 *  across browsers and devices. Falls back to the default center when they
 *  never picked one or their pick was deleted (the FK nulls it). */
export async function getSelectedCenter(userId: string): Promise<CenterRow | null> {
  if (userId) {
    const [pref] = await db.select().from(userPrefs).where(eq(userPrefs.userId, userId)).limit(1);
    if (pref?.selectedCenterId) {
      const center = await getCenter(pref.selectedCenterId);
      if (center) return center;
    }
  }
  return getDefaultCenter();
}

export async function setSelectedCenter(userId: string, centerId: string): Promise<void> {
  await db
    .insert(userPrefs)
    .values({ userId, selectedCenterId: centerId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPrefs.userId,
      set: { selectedCenterId: centerId, updatedAt: new Date() },
    });
}

/** Boot: make sure at least one center exists and return the default one.
 *  (ensureSchema has already run the legacy migration, which creates the
 *  default center from FACILITY_* env on first boot.) */
export async function requireDefaultCenter(): Promise<CenterRow> {
  const center = await getDefaultCenter();
  if (!center) throw new Error("No center exists after schema bootstrap.");
  return center;
}

/** True when another center (not `exceptId`) already claims this number. */
export async function numberClaimedElsewhere(
  phoneNumber: string,
  exceptId: string,
): Promise<boolean> {
  if (!phoneNumber.trim()) return false;
  const [row] = await db
    .select({ id: centers.id })
    .from(centers)
    .where(and(eq(centers.phoneNumber, phoneNumber.trim()), ne(centers.id, exceptId)))
    .limit(1);
  return Boolean(row);
}
