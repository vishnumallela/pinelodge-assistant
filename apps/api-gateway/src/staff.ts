import { and, asc, eq, ne, notExists, sql } from "drizzle-orm";
import { db } from "./db";
import { staff, staffAssignments, type CenterRow, type StaffRow } from "./schema";

/**
 * Staff = a person (name, phone, email — shared everywhere) plus one
 * assignment per center they work at (section, weekly window, time-off,
 * fallback flag — evaluated in that center's timezone). The dashboard edits
 * assignment rows; the person row follows along.
 */

/** One roster entry as the dashboard and the agent see it: the assignment
 *  merged with the person. `id` is the assignment (what gets edited);
 *  `staffId` is the person (shared across centers). */
export interface StaffMemberRecord {
  id: string;
  staffId: string;
  centerId: string;
  name: string;
  phone: string;
  email: string;
  section: string;
  handles: string;
  days: number[];
  startTime: string;
  endTime: string;
  timeOff: string[];
  isFallback: boolean;
  active: boolean;
  sort: number;
  createdAt: Date;
}

export type StaffWithAvailability = StaffMemberRecord & { availableNow: boolean };

const DEFAULT_STAFF = [
  {
    name: "Sheri",
    section: "Admissions",
    handles: "tours, moving in, pricing",
    days: [1, 2, 3, 4, 5],
    startTime: "09:00",
    endTime: "17:00",
    sort: 0,
  },
  {
    name: "Mira",
    section: "Billing",
    handles: "invoices, insurance, Medicaid",
    days: [1, 2, 3, 4, 5],
    startTime: "09:00",
    endTime: "17:00",
    sort: 1,
  },
  {
    name: "Richa",
    section: "Administration",
    handles: "complaints, the executive director",
    days: [1, 2, 3, 4, 5],
    startTime: "10:00",
    endTime: "18:00",
    sort: 2,
  },
  {
    name: "Dessa",
    section: "Front Office",
    handles: "everything else",
    days: [0, 1, 2, 3, 4, 5, 6],
    startTime: "08:00",
    endTime: "20:00",
    isFallback: true,
    sort: 3,
  },
];

/** Seed the demo roster into the default center — only on a fresh install. */
export async function seedDefaultStaff(centerId: string): Promise<void> {
  const existing = await db.select({ id: staff.id }).from(staff).limit(1);
  if (existing.length > 0) return;
  await Promise.all(
    DEFAULT_STAFF.map(async ({ name, ...assignment }) => {
      const [person] = await db.insert(staff).values({ name }).returning();
      await db.insert(staffAssignments).values({ ...assignment, staffId: person!.id, centerId });
    }),
  );
}

/** Current date parts in the given IANA timezone. */
export function zonedNow(
  timezone: string,
  now: Date,
): { day: number; minutes: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hour = Number(get("hour")) % 24;
  return {
    day: days.indexOf(get("weekday")),
    minutes: hour * 60 + Number(get("minute")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

export function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function isAvailable(row: StaffMemberRecord, timezone: string, now = new Date()): boolean {
  if (!row.active) return false;
  const t = zonedNow(timezone, now);
  if (!row.days.includes(t.day)) return false;
  if (row.timeOff.includes(t.date)) return false;
  const start = toMinutes(row.startTime);
  const end = toMinutes(row.endTime);
  // start === end means round-the-clock; start > end spans midnight.
  if (start === end) return true;
  if (start < end) return t.minutes >= start && t.minutes < end;
  return t.minutes >= start || t.minutes < end;
}

const memberColumns = {
  id: staffAssignments.id,
  staffId: staff.id,
  centerId: staffAssignments.centerId,
  name: staff.name,
  phone: staff.phone,
  email: staff.email,
  section: staffAssignments.section,
  handles: staffAssignments.handles,
  days: staffAssignments.days,
  startTime: staffAssignments.startTime,
  endTime: staffAssignments.endTime,
  timeOff: staffAssignments.timeOff,
  isFallback: staffAssignments.isFallback,
  active: staffAssignments.active,
  sort: staffAssignments.sort,
  createdAt: staffAssignments.createdAt,
};

/** The center's roster, each entry annotated with availability right now
 *  (evaluated in the center's timezone). */
export async function listStaff(
  center: CenterRow,
  now = new Date(),
): Promise<StaffWithAvailability[]> {
  const rows = await db
    .select(memberColumns)
    .from(staffAssignments)
    .innerJoin(staff, eq(staffAssignments.staffId, staff.id))
    .where(eq(staffAssignments.centerId, center.id))
    .orderBy(asc(staffAssignments.sort), asc(staffAssignments.createdAt));
  return rows.map((r) => ({ ...r, availableNow: isAvailable(r, center.timezone, now) }));
}

/** People with no assignment at this center — the "add existing person"
 *  picker, so one human never needs re-typing per center. */
export async function listAttachablePeople(
  centerId: string,
): Promise<{ id: string; name: string; phone: string; email: string; centers: string[] }[]> {
  const rows = await db
    .select({
      id: staff.id,
      name: staff.name,
      phone: staff.phone,
      email: staff.email,
      centerNames: sql<string[]>`
        COALESCE(
          (SELECT array_agg(c.name ORDER BY c.sort, c.created_at)
           FROM staff_assignments a JOIN centers c ON c.id = a.center_id
           WHERE a.staff_id = "staff"."id"),
          '{}'
        )`,
    })
    .from(staff)
    .where(
      notExists(
        db
          .select({ one: sql`1` })
          .from(staffAssignments)
          .where(
            and(eq(staffAssignments.staffId, staff.id), eq(staffAssignments.centerId, centerId)),
          ),
      ),
    )
    .orderBy(asc(staff.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    centers: r.centerNames,
  }));
}

export interface StaffInput {
  name: string;
  section: string;
  handles: string;
  phone: string;
  email: string;
  days: number[];
  startTime: string;
  endTime: string;
  timeOff: string[];
  isFallback: boolean;
  active: boolean;
  sort?: number;
}

export interface TransferTarget {
  name: string;
  section: string;
  phone: string;
  email: string;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Small edit distance for speech-recognition slips ("Caring" → "Karin"). */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]!;
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = dp[i]!;
      dp[i] = Math.min(dp[i]! + 1, dp[i - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return dp[a.length]!;
}

/** Edit-distance tolerance that scales with the shorter word: short names get
 *  no slack (so "Lisa" never becomes "Mira"), longer names allow ASR slips. */
function fuzzyThreshold(len: number): number {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  return 2;
}

interface NormedStaff {
  s: StaffWithAvailability;
  norm: string;
  section: string;
}

/** Within a tier of candidates, an available person always wins over an
 *  off-shift one with the same spoken name. */
function preferAvailable(cands: NormedStaff[]): StaffWithAvailability | undefined {
  return (cands.find((r) => r.s.availableNow) ?? cands[0])?.s;
}

/** The ASR rarely hands us the exact roster spelling, so resolve in tiers:
 *  exact name → first-name/prefix → length-scaled fuzzy → section. Within a
 *  tier, an available person always wins over an off-shift one, and the fuzzy
 *  tier picks the CLOSEST name, never merely the first. A blank spoken name,
 *  or a roster name that normalizes to blank, never matches anything. */
function matchSpokenName(rows: StaffWithAvailability[], spokenName: string) {
  const wanted = normalizeName(spokenName);
  if (!wanted) return undefined;
  // Precompute normalized names once; drop anyone whose name blanks out so a
  // non-Latin name can't become a universal prefix match.
  const active: NormedStaff[] = rows
    .filter((s) => s.active)
    .map((s) => ({ s, norm: normalizeName(s.name), section: normalizeName(s.section) }))
    .filter((r) => r.norm !== "");

  const exact = active.filter((r) => r.norm === wanted);
  if (exact.length) return preferAvailable(exact);

  const prefix = active.filter((r) => r.norm.startsWith(wanted) || wanted.startsWith(r.norm));
  if (prefix.length) return preferAvailable(prefix);

  // Fuzzy: keep only names within their length-scaled threshold, then take the
  // smallest distance (ties broken toward an available person).
  const scored = active
    .map((r) => ({ r, d: editDistance(r.norm, wanted) }))
    .filter((x) => x.d <= fuzzyThreshold(Math.min(x.r.norm.length, wanted.length)))
    .toSorted((a, b) => a.d - b.d || Number(b.r.s.availableNow) - Number(a.r.s.availableNow));
  if (scored.length) return scored[0]!.r.s;

  const bySection = active.filter((r) => r.section === wanted);
  if (bySection.length) return preferAvailable(bySection);

  return undefined;
}

/** Resolve a spoken staff name to a transferable number within the center.
 *  The person must be active, on shift right now, and have a phone; otherwise
 *  fall back to the center's starred fallback (if reachable). Returns null
 *  when nobody can take it. */
export async function findTransferTarget(
  spokenName: string,
  center: CenterRow,
): Promise<TransferTarget | null> {
  const rows = await listStaff(center);
  const match = matchSpokenName(rows, spokenName);
  if (match?.availableNow && match.phone) {
    return { name: match.name, section: match.section, phone: match.phone, email: match.email };
  }
  const fallback = rows.find((s) => s.isFallback && s.active && s.availableNow && s.phone);
  return fallback
    ? {
        name: fallback.name,
        section: fallback.section,
        phone: fallback.phone,
        email: fallback.email,
      }
    : null;
}

/** Console variant of findTransferTarget: the redirect is announce-only (no
 *  dial leg), so a phone is not required — only being active and on shift. */
export async function findRedirectTarget(
  spokenName: string,
  center: CenterRow,
): Promise<TransferTarget | null> {
  const rows = await listStaff(center);
  const match = matchSpokenName(rows, spokenName);
  if (match?.availableNow) {
    return { name: match.name, section: match.section, phone: match.phone, email: match.email };
  }
  const fallback = rows.find((s) => s.isFallback && s.active && s.availableNow);
  return fallback
    ? {
        name: fallback.name,
        section: fallback.section,
        phone: fallback.phone,
        email: fallback.email,
      }
    : null;
}

/** Setting a center's fallback unsets every other one there — exactly one
 *  per center at all times. */
async function clearOtherFallbacks(centerId: string, exceptAssignmentId: string): Promise<void> {
  await db
    .update(staffAssignments)
    .set({ isFallback: false })
    .where(
      and(eq(staffAssignments.centerId, centerId), ne(staffAssignments.id, exceptAssignmentId)),
    );
}

async function getMember(assignmentId: string): Promise<StaffMemberRecord | null> {
  const [row] = await db
    .select(memberColumns)
    .from(staffAssignments)
    .innerJoin(staff, eq(staffAssignments.staffId, staff.id))
    .where(eq(staffAssignments.id, assignmentId))
    .limit(1);
  return row ?? null;
}

function splitInput(input: StaffInput) {
  const { name, phone, email, ...assignment } = input;
  return { person: { name, phone, email }, assignment };
}

/** The same human typed in again at another center: matched by email, or by
 *  name + phone when there is no email. A bare phone match alone is NOT a
 *  person — different people legitimately share a front-office line. */
async function findMatchingPerson(person: {
  name: string;
  phone: string;
  email: string;
}): Promise<StaffRow | null> {
  if (person.email) {
    const [byEmail] = await db
      .select()
      .from(staff)
      .where(sql`lower(${staff.email}) = ${person.email.toLowerCase()}`)
      .limit(1);
    if (byEmail) return byEmail;
  }
  if (person.phone) {
    const [byNamePhone] = await db
      .select()
      .from(staff)
      .where(
        and(
          eq(staff.phone, person.phone),
          sql`lower(${staff.name}) = ${person.name.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (byNamePhone) return byNamePhone;
  }
  return null;
}

/** Add someone to a center's roster. With `staffId` an existing person is
 *  attached explicitly; without it, someone matching an existing person (same
 *  email, or same name + phone) is linked automatically instead of duplicated
 *  — the identity fields update to the submitted values either way. Fails
 *  when the person is already on this center's roster. */
export async function createStaff(
  centerId: string,
  input: StaffInput,
  staffId?: string,
): Promise<StaffMemberRecord | null> {
  const { person, assignment } = splitInput(input);
  let existing: StaffRow | null = null;
  if (staffId) {
    const [byId] = await db.select().from(staff).where(eq(staff.id, staffId)).limit(1);
    if (!byId) return null;
    existing = byId;
  } else {
    existing = await findMatchingPerson(person);
  }
  let personId: string;
  if (existing) {
    // Reject duplicates before touching the person, so a failed attach
    // never rewrites their shared name/phone/email.
    const [dup] = await db
      .select({ id: staffAssignments.id })
      .from(staffAssignments)
      .where(
        and(eq(staffAssignments.staffId, existing.id), eq(staffAssignments.centerId, centerId)),
      )
      .limit(1);
    if (dup) return null;
    await db.update(staff).set(person).where(eq(staff.id, existing.id));
    personId = existing.id;
  } else {
    const [created] = await db.insert(staff).values(person).returning();
    personId = created!.id;
  }
  const [row] = await db
    .insert(staffAssignments)
    .values({ ...assignment, staffId: personId, centerId, sort: assignment.sort ?? 99 })
    .returning();
  if (input.isFallback) await clearOtherFallbacks(centerId, row!.id);
  return getMember(row!.id);
}

/** Update one assignment. Identity fields (name/phone/email) update the
 *  person, so they change at every center — one human, one number. */
export async function updateStaff(
  assignmentId: string,
  input: StaffInput,
): Promise<StaffMemberRecord | null> {
  const { person, assignment } = splitInput(input);
  const [row] = await db
    .update(staffAssignments)
    .set(assignment)
    .where(eq(staffAssignments.id, assignmentId))
    .returning();
  if (!row) return null;
  await db.update(staff).set(person).where(eq(staff.id, row.staffId));
  if (input.isFallback) await clearOtherFallbacks(row.centerId, row.id);
  return getMember(row.id);
}

/** Remove someone from a center's roster. The person row is deleted too once
 *  no center has them. */
export async function deleteStaff(assignmentId: string): Promise<boolean> {
  const [removed] = await db
    .delete(staffAssignments)
    .where(eq(staffAssignments.id, assignmentId))
    .returning({ staffId: staffAssignments.staffId });
  if (!removed) return false;
  const [remaining] = await db
    .select({ id: staffAssignments.id })
    .from(staffAssignments)
    .where(eq(staffAssignments.staffId, removed.staffId))
    .limit(1);
  if (!remaining) await db.delete(staff).where(eq(staff.id, removed.staffId));
  return true;
}
