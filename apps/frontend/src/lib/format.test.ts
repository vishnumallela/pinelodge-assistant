import { describe, expect, it } from "vitest";
import { formatDateTime, formatDuration, labelize } from "./format";

describe("formatDateTime", () => {
  it("renders in facility time with the zone label, regardless of viewer timezone", () => {
    // 14:10 UTC on Jul 3 is 9:10 AM CDT at the facility.
    expect(formatDateTime("2026-07-03T14:10:25.000Z")).toBe("Jul 3, 9:10 AM CDT");
  });

  it("passes malformed input through unchanged", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDuration", () => {
  it("renders an em dash when unknown", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
  });

  it("renders seconds under a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("renders minutes and seconds", () => {
    expect(formatDuration(60)).toBe("1m 0s");
    expect(formatDuration(272)).toBe("4m 32s");
  });
});

describe("labelize", () => {
  it("humanizes snake_case values", () => {
    expect(labelize("answered_directly")).toBe("Answered directly");
    expect(labelize("transferred")).toBe("Transferred");
  });

  it("maps empty and 'none' to an em dash", () => {
    expect(labelize(null)).toBe("—");
    expect(labelize("")).toBe("—");
    expect(labelize("none")).toBe("—");
  });
});
