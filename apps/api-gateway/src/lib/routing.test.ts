import { describe, expect, test } from "bun:test";
import { resolveRoute, ROUTE_TARGETS } from "./routing";
import type { ShiftClock, StaffRow } from "./staff";

let seq = 0;
function mkStaff(patch: Partial<StaffRow>): StaffRow {
  seq += 1;
  return {
    id: `s${seq}`,
    name: `Person ${seq}`,
    role: "Staff",
    department: "Front Office",
    extension: "100",
    workingDays: "mon,tue,wed,thu,fri",
    shiftStart: "08:00",
    shiftEnd: "17:00",
    active: true,
    fallbackDestination: "voicemail",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...patch,
  };
}

const sheri = mkStaff({ id: "sheri", name: "Sheri", department: "Admissions" });
const mira = mkStaff({ id: "mira", name: "Mira", department: "Billing", shiftStart: "09:00" });
const richa = mkStaff({ id: "richa", name: "Richa", department: "Administration" });
const dessa = mkStaff({ id: "dessa", name: "Dessa", department: "Front Office" });
const nursing = mkStaff({
  id: "nursing",
  name: "Main Nursing Line",
  department: "Nursing",
  workingDays: "sun,mon,tue,wed,thu,fri,sat",
  shiftStart: "00:00",
  shiftEnd: "00:00",
});
const ALL = [sheri, mira, richa, dessa, nursing];

const businessHours: ShiftClock = { day: "tue", minutes: 10 * 60 }; // Tue 10:00
const midnight: ShiftClock = { day: "sun", minutes: 30 }; // Sun 00:30

describe("routing table", () => {
  test("admissions goes to Sheri", () => {
    const d = resolveRoute("admissions", ALL, businessHours);
    expect(d.action).toBe("transfer");
    expect(d.destination?.name).toBe("Sheri");
  });

  test("billing goes to Mira", () => {
    const d = resolveRoute("billing", ALL, businessHours);
    expect(d.action).toBe("transfer");
    expect(d.destination?.name).toBe("Mira");
  });

  test("escalation goes to Richa", () => {
    const d = resolveRoute("escalation", ALL, businessHours);
    expect(d.destination?.name).toBe("Richa");
  });

  test("routine admin goes to Dessa", () => {
    const d = resolveRoute("routine_admin", ALL, businessHours);
    expect(d.destination?.name).toBe("Dessa");
  });

  test("onsite care goes to the nursing line at any hour", () => {
    for (const at of [businessHours, midnight]) {
      const d = resolveRoute("onsite_care", ALL, at);
      expect(d.action).toBe("transfer");
      expect(d.destination?.name).toBe("Main Nursing Line");
    }
  });

  test("asking for a person by name routes to that person", () => {
    expect(resolveRoute("named_mira", ALL, businessHours).destination?.name).toBe("Mira");
    expect(resolveRoute("named_sheri", ALL, businessHours).destination?.name).toBe("Sheri");
    expect(resolveRoute("named_richa", ALL, businessHours).destination?.name).toBe("Richa");
    expect(resolveRoute("named_dessa", ALL, businessHours).destination?.name).toBe("Dessa");
  });

  test("general questions are answered directly, no transfer", () => {
    const d = resolveRoute("general_question", ALL, businessHours);
    expect(d.action).toBe("answer");
    expect(d.destination).toBeNull();
  });

  test("emergency never transfers", () => {
    const d = resolveRoute("emergency", ALL, businessHours);
    expect(d.action).toBe("emergency");
    expect(d.destination).toBeNull();
  });

  test("every route target resolves to exactly one decision", () => {
    for (const target of ROUTE_TARGETS) {
      const d = resolveRoute(target, ALL, businessHours);
      expect(["transfer", "voicemail", "answer", "emergency"]).toContain(d.action);
    }
  });
});

describe("availability + fallbacks", () => {
  test("off-shift staff falls back to voicemail with their box as destination", () => {
    const d = resolveRoute("billing", ALL, midnight); // Mira works 09:00-17:00 weekdays
    expect(d.action).toBe("voicemail");
    expect(d.destination?.name).toBe("Mira");
  });

  test("a staff fallback pointing at another person is followed when off shift", () => {
    const withFallback = ALL.map((s) =>
      s.id === "mira" ? { ...s, fallbackDestination: "dessa" } : s,
    );
    const at: ShiftClock = { day: "tue", minutes: 8 * 60 + 30 }; // Dessa on, Mira not yet
    const d = resolveRoute("billing", withFallback, at);
    expect(d.action).toBe("transfer");
    expect(d.destination?.name).toBe("Dessa");
  });

  test("a nursing fallback reaches the 24/7 line off hours", () => {
    const withFallback = ALL.map((s) =>
      s.id === "dessa" ? { ...s, fallbackDestination: "nursing" } : s,
    );
    const d = resolveRoute("routine_admin", withFallback, midnight);
    expect(d.action).toBe("transfer");
    expect(d.destination?.name).toBe("Main Nursing Line");
  });

  test("fallback cycles terminate in voicemail", () => {
    const a = mkStaff({
      id: "a",
      name: "A",
      department: "Billing",
      workingDays: "sat",
      fallbackDestination: "b",
    });
    const b = mkStaff({
      id: "b",
      name: "B",
      department: "Front Office",
      workingDays: "sat",
      fallbackDestination: "a",
    });
    const d = resolveRoute("billing", [a, b], businessHours);
    expect(d.action).toBe("voicemail");
    expect(d.destination?.name).toBe("A");
  });

  test("inactive staff are never destinations", () => {
    const inactive = ALL.map((s) => (s.id === "sheri" ? { ...s, active: false } : s));
    const d = resolveRoute("admissions", inactive, businessHours);
    expect(d.destination?.name).not.toBe("Sheri");
  });

  test("a department with no configured staff diverts to nursing", () => {
    const noAdmissions = ALL.filter((s) => s.id !== "sheri");
    const d = resolveRoute("admissions", noAdmissions, businessHours);
    expect(d.action).toBe("transfer");
    expect(d.destination?.name).toBe("Main Nursing Line");
  });

  test("with nobody configured at all, the call goes to voicemail", () => {
    const d = resolveRoute("admissions", [], businessHours);
    expect(d.action).toBe("voicemail");
    expect(d.destination).toBeNull();
  });
});
