import { asc, eq, ne } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import { staff, type StaffRow } from "./schema";

/** A staff row plus whether they're reachable at this moment (facility time). */
export type StaffWithAvailability = StaffRow & { availableNow: boolean };

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

export async function seedDefaultStaff(): Promise<void> {
  const existing = await db.select({ id: staff.id }).from(staff).limit(1);
  if (existing.length > 0) return;
  await db.insert(staff).values(DEFAULT_STAFF);
}

/** Current date parts in the facility timezone. */
function facilityNow(now: Date): { day: number; minutes: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: env.FACILITY_TIMEZONE,
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

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isAvailable(row: StaffRow, now = new Date()): boolean {
  if (!row.active) return false;
  const t = facilityNow(now);
  if (!row.days.includes(t.day)) return false;
  if (row.timeOff.includes(t.date)) return false;
  const start = toMinutes(row.startTime);
  const end = toMinutes(row.endTime);
  // start === end means round-the-clock; start > end spans midnight.
  if (start === end) return true;
  if (start < end) return t.minutes >= start && t.minutes < end;
  return t.minutes >= start || t.minutes < end;
}

export async function listStaff(now = new Date()): Promise<StaffWithAvailability[]> {
  const rows = await db.select().from(staff).orderBy(asc(staff.sort), asc(staff.createdAt));
  return rows.map((r) => ({ ...r, availableNow: isAvailable(r, now) }));
}

export interface StaffInput {
  name: string;
  section: string;
  handles: string;
  days: number[];
  startTime: string;
  endTime: string;
  timeOff: string[];
  isFallback: boolean;
  active: boolean;
  sort?: number;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Validate + coerce an arbitrary body; returns null when unusable. */
export function readStaffInput(body: unknown): StaffInput | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.name !== "string" || typeof b.section !== "string") return null;
  const name = b.name.trim();
  const section = b.section.trim();
  if (!name || !section) return null;
  const days = Array.isArray(b.days)
    ? [...new Set(b.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
    : [1, 2, 3, 4, 5];
  const startTime =
    typeof b.startTime === "string" && HHMM.test(b.startTime) ? b.startTime : "09:00";
  const endTime = typeof b.endTime === "string" && HHMM.test(b.endTime) ? b.endTime : "17:00";
  const timeOff = Array.isArray(b.timeOff)
    ? b.timeOff.filter((d): d is string => typeof d === "string" && YMD.test(d))
    : [];
  return {
    name,
    section,
    handles: typeof b.handles === "string" ? b.handles.trim() : "",
    days,
    startTime,
    endTime,
    timeOff,
    isFallback: b.isFallback === true,
    active: b.active !== false,
    sort: typeof b.sort === "number" ? b.sort : undefined,
  };
}

/** Setting a fallback unsets every other one — exactly one at all times. */
async function clearOtherFallbacks(exceptId?: string): Promise<void> {
  if (exceptId) {
    await db.update(staff).set({ isFallback: false }).where(ne(staff.id, exceptId));
  } else {
    await db.update(staff).set({ isFallback: false });
  }
}

export async function createStaff(input: StaffInput): Promise<StaffRow> {
  const [row] = await db
    .insert(staff)
    .values({ ...input, sort: input.sort ?? 99 })
    .returning();
  if (input.isFallback) await clearOtherFallbacks(row!.id);
  return row!;
}

export async function updateStaff(id: string, input: StaffInput): Promise<StaffRow | null> {
  const [row] = await db.update(staff).set(input).where(eq(staff.id, id)).returning();
  if (row && input.isFallback) await clearOtherFallbacks(row.id);
  return row ?? null;
}

export async function deleteStaff(id: string): Promise<boolean> {
  const res = await db.delete(staff).where(eq(staff.id, id)).returning({ id: staff.id });
  return res.length > 0;
}
