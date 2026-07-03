export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

import { FACILITY_TIMEZONE } from "./config";

/** Timestamps render in facility time (with the zone shown), not viewer time,
 *  so the console reads consistently with schedules and routing decisions.
 *  Assembled from parts because ICU versions disagree on the joiner
 *  ("Jul 3, 9:10 AM" vs "Jul 3 at 9:10 AM"). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`.trim();
}

/** "answered_directly" -> "Answered directly"; null/empty/"none" -> em dash. */
export function labelize(value: string | null | undefined): string {
  if (!value || value === "none") return "—";
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
