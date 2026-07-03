import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { TEST_DDL } from "../db";
import {
  availabilitySnapshot,
  createStaff,
  deleteStaff,
  isOfficeOpen,
  isOnShift,
  listStaff,
  seedDefaultStaff,
  timeToMinutes,
  updateStaff,
} from "./staff";

type AppDb = typeof import("../db").db;

const base = {
  active: true,
  workingDays: "mon,tue,wed,thu,fri",
  shiftStart: "08:00",
  shiftEnd: "17:00",
};

describe("isOnShift", () => {
  test("inside the shift window on a working day", () => {
    expect(isOnShift(base, { day: "mon", minutes: 9 * 60 })).toBe(true);
  });

  test("outside the window and on off days", () => {
    expect(isOnShift(base, { day: "mon", minutes: 7 * 60 })).toBe(false);
    expect(isOnShift(base, { day: "mon", minutes: 17 * 60 })).toBe(false); // end is exclusive
    expect(isOnShift(base, { day: "sat", minutes: 9 * 60 })).toBe(false);
  });

  test("inactive staff are never on shift", () => {
    expect(isOnShift({ ...base, active: false }, { day: "mon", minutes: 9 * 60 })).toBe(false);
  });

  test("equal start/end means 24-hour coverage", () => {
    const nursing = { ...base, shiftStart: "00:00", shiftEnd: "00:00", workingDays: "sun,sat" };
    expect(isOnShift(nursing, { day: "sun", minutes: 3 * 60 })).toBe(true);
  });

  test("overnight shifts wrap past midnight", () => {
    const night = { ...base, shiftStart: "22:00", shiftEnd: "06:00" };
    expect(isOnShift(night, { day: "mon", minutes: 23 * 60 })).toBe(true);
    expect(isOnShift(night, { day: "mon", minutes: 5 * 60 })).toBe(true);
    expect(isOnShift(night, { day: "mon", minutes: 12 * 60 })).toBe(false);
  });
});

describe("office hours", () => {
  test("open weekday mid-morning, closed weekend and late evening", () => {
    expect(isOfficeOpen({ day: "wed", minutes: 10 * 60 })).toBe(true);
    expect(isOfficeOpen({ day: "sun", minutes: 10 * 60 })).toBe(false);
    expect(isOfficeOpen({ day: "wed", minutes: 20 * 60 })).toBe(false);
  });
});

describe("timeToMinutes", () => {
  test("parses HH:MM", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("08:30")).toBe(510);
    expect(timeToMinutes("23:59")).toBe(1439);
  });
});

describe("staff persistence", () => {
  let client: PGlite;
  let db: AppDb;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client) as unknown as AppDb;
    await client.exec(TEST_DDL);
  });

  beforeEach(async () => {
    await client.exec(`DELETE FROM "staff";`);
  });

  afterAll(async () => {
    await client.close();
  });

  test("seed creates the default directory once, idempotently", async () => {
    await seedDefaultStaff(db);
    await seedDefaultStaff(db);
    const rows = await listStaff(db);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.name)).toContain("Main Nursing Line");
  });

  test("create, update, delete round-trip", async () => {
    const created = await createStaff(db, {
      name: "Alex",
      role: "Weekend Coordinator",
      department: "Front Office",
      extension: "105",
      workingDays: ["sat", "sun"],
      shiftStart: "09:00",
      shiftEnd: "13:00",
      active: true,
      fallbackDestination: "voicemail",
    });
    expect(created.workingDays).toBe("sat,sun");

    const updated = await updateStaff(db, created.id, { shiftEnd: "15:00", active: false });
    expect(updated?.shiftEnd).toBe("15:00");
    expect(updated?.active).toBe(false);

    expect(await deleteStaff(db, created.id)).toBe(true);
    expect(await listStaff(db)).toHaveLength(0);
  });

  test("availability snapshot reflects shift state at the given clock", async () => {
    await seedDefaultStaff(db);
    const night = await availabilitySnapshot(db, { day: "sun", minutes: 2 * 60 });
    expect(night.officeOpen).toBe(false);
    const byName = new Map(night.staff.map((s) => [s.name, s.onShift]));
    expect(byName.get("Main Nursing Line")).toBe(true);
    expect(byName.get("Sheri")).toBe(false);

    const morning = await availabilitySnapshot(db, { day: "tue", minutes: 10 * 60 });
    expect(morning.officeOpen).toBe(true);
    expect(morning.staff.every((s) => s.onShift)).toBe(true);
  });
});
