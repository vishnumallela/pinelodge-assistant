export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

import { FACILITY_TIMEZONE } from "./config";

/** Timestamps render in facility time (with the zone shown), not viewer time,
 *  so the console reads consistently with schedules and routing decisions. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: FACILITY_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** "answered_directly" -> "Answered directly"; null/empty/"none" -> em dash. */
export function labelize(value: string | null | undefined): string {
  if (!value || value === "none") return "—";
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
