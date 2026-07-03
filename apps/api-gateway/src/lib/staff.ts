import { asc, eq } from "drizzle-orm";
import type { db as appDb } from "../db";
import { staff } from "../db/schema";
import { env } from "../env";
import { OFFICE_HOURS } from "./facility";

type Db = typeof appDb;
export type StaffRow = typeof staff.$inferSelect;

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/** A point in facility-local time, minimal enough to be trivially testable. */
export interface ShiftClock {
  day: DayKey;
  minutes: number;
}

export function timeToMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Current facility-local weekday + minutes, resolved via the configured timezone. */
export function facilityNow(date = new Date()): ShiftClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: env.FACILITY_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("weekday").slice(0, 3).toLowerCase() as DayKey;
  // "24" can appear for midnight with hour12: false; normalize it.
  const hour = Number(get("hour")) % 24;
  return { day, minutes: hour * 60 + Number(get("minute")) };
}

/**
 * Is this person reachable right now? Pure schedule math: active flag, working
 * days, and shift window (windows may wrap past midnight, e.g. 22:00–06:00).
 */
export function isOnShift(
  s: Pick<StaffRow, "active" | "workingDays" | "shiftStart" | "shiftEnd">,
  at: ShiftClock,
): boolean {
  if (!s.active) return false;
  if (
    !s.workingDays
      .split(",")
      .map((d) => d.trim())
      .includes(at.day)
  )
    return false;
  const start = timeToMinutes(s.shiftStart);
  const end = timeToMinutes(s.shiftEnd);
  if (start === end) return true; // 24-hour coverage
  if (start < end) return at.minutes >= start && at.minutes < end;
  return at.minutes >= start || at.minutes < end; // overnight shift
}

export function isOfficeOpen(at: ShiftClock): boolean {
  return (
    OFFICE_HOURS.days.includes(at.day) &&
    at.minutes >= timeToMinutes(OFFICE_HOURS.open) &&
    at.minutes < timeToMinutes(OFFICE_HOURS.close)
  );
}

/* ── persistence ─────────────────────────────────────────────────────── */

export interface StaffInput {
  name: string;
  role: string;
  department: string;
  extension: string;
  workingDays: string[];
  shiftStart: string;
  shiftEnd: string;
  active: boolean;
  fallbackDestination: string;
}

function toRowValues(input: StaffInput) {
  return {
    name: input.name,
    role: input.role,
    department: input.department,
    extension: input.extension,
    workingDays: input.workingDays.join(","),
    shiftStart: input.shiftStart,
    shiftEnd: input.shiftEnd,
    active: input.active,
    fallbackDestination: input.fallbackDestination,
  };
}

export async function listStaff(db: Db): Promise<StaffRow[]> {
  return db.select().from(staff).orderBy(asc(staff.name));
}

export async function createStaff(db: Db, input: StaffInput): Promise<StaffRow> {
  const [row] = await db
    .insert(staff)
    .values({ id: crypto.randomUUID(), ...toRowValues(input) })
    .returning();
  return row!;
}

export async function updateStaff(
  db: Db,
  id: string,
  input: Partial<StaffInput>,
): Promise<StaffRow | null> {
  const patch: Record<string, unknown> = {};
  for (const key of [
    "name",
    "role",
    "department",
    "extension",
    "shiftStart",
    "shiftEnd",
    "active",
    "fallbackDestination",
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (input.workingDays !== undefined) patch.workingDays = input.workingDays.join(",");
  patch.updatedAt = new Date();
  const [row] = await db.update(staff).set(patch).where(eq(staff.id, id)).returning();
  return row ?? null;
}

export async function deleteStaff(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(staff).where(eq(staff.id, id)).returning({ id: staff.id });
  return rows.length > 0;
}

/** Seed the Pine Lodge directory on first boot; never touches existing rows. */
export async function seedDefaultStaff(db: Db): Promise<void> {
  const existing = await db.select({ id: staff.id }).from(staff).limit(1);
  if (existing.length > 0) return;
  const weekdays = ["mon", "tue", "wed", "thu", "fri"];
  const everyday = [...DAY_KEYS];
  const defaults: StaffInput[] = [
    {
      name: "Sheri",
      role: "Admissions Director",
      department: "Admissions",
      extension: "102",
      workingDays: weekdays,
      shiftStart: "08:00",
      shiftEnd: "17:00",
      active: true,
      fallbackDestination: "voicemail",
    },
    {
      name: "Mira",
      role: "Business Office Manager",
      department: "Billing",
      extension: "103",
      workingDays: weekdays,
      shiftStart: "09:00",
      shiftEnd: "17:00",
      active: true,
      fallbackDestination: "voicemail",
    },
    {
      name: "Richa",
      role: "Executive Director",
      department: "Administration",
      extension: "101",
      workingDays: weekdays,
      shiftStart: "08:00",
      shiftEnd: "18:00",
      active: true,
      fallbackDestination: "voicemail",
    },
    {
      name: "Dessa",
      role: "Office Coordinator",
      department: "Front Office",
      extension: "104",
      workingDays: weekdays,
      shiftStart: "08:00",
      shiftEnd: "17:00",
      active: true,
      fallbackDestination: "voicemail",
    },
    {
      name: "Main Nursing Line",
      role: "Nursing Station",
      department: "Nursing",
      extension: "200",
      workingDays: everyday,
      shiftStart: "00:00",
      shiftEnd: "00:00",
      active: true,
      fallbackDestination: "voicemail",
    },
  ];
  for (const input of defaults) await createStaff(db, input);
}

/* ── availability snapshot (the check_availability tool's payload) ────── */

export interface AvailabilitySnapshot {
  officeHours: string;
  officeOpen: boolean;
  localTime: string;
  staff: {
    id: string;
    name: string;
    role: string;
    department: string;
    extension: string;
    onShift: boolean;
    shift: string;
    workingDays: string[];
  }[];
}

export async function availabilitySnapshot(db: Db, at: ShiftClock): Promise<AvailabilitySnapshot> {
  const rows = await listStaff(db);
  const hh = String(Math.floor(at.minutes / 60)).padStart(2, "0");
  const mm = String(at.minutes % 60).padStart(2, "0");
  return {
    officeHours: OFFICE_HOURS.label,
    officeOpen: isOfficeOpen(at),
    localTime: `${at.day} ${hh}:${mm}`,
    staff: rows
      .filter((s) => s.active)
      .map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        department: s.department,
        extension: s.extension,
        onShift: isOnShift(s, at),
        shift: `${s.shiftStart}–${s.shiftEnd}`,
        workingDays: s.workingDays.split(","),
      })),
  };
}
