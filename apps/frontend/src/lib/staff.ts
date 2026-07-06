import { useSyncExternalStore } from "react";

/** Editable staff directory, persisted in localStorage. Sarah's prompt is
 *  rebuilt from it on every new call. */

export interface StaffMember {
  id: string;
  name: string;
  section: string;
  handles: string;
}

export const DEFAULT_STAFF: StaffMember[] = [
  { id: "sheri", name: "Sheri", section: "Admissions", handles: "tours, moving in, pricing" },
  { id: "mira", name: "Mira", section: "Billing", handles: "invoices, insurance, Medicaid" },
  {
    id: "richa",
    name: "Richa",
    section: "Administration",
    handles: "complaints, the executive director",
  },
  { id: "dessa", name: "Dessa", section: "Front Office", handles: "everything else" },
];

const KEY = "pinelodge.staff";

function normalize(rows: unknown): StaffMember[] {
  if (!Array.isArray(rows)) return defaults();
  const seen = new Set<string>();
  const out: StaffMember[] = [];
  for (const r of rows) {
    if (!r || typeof r.name !== "string" || typeof r.section !== "string") continue;
    let id = typeof r.id === "string" && r.id ? r.id : crypto.randomUUID();
    while (seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    out.push({
      id,
      name: r.name,
      section: r.section,
      handles: typeof r.handles === "string" ? r.handles : "",
    });
  }
  return out.length > 0 ? out : defaults();
}

/** Fresh copy so the exported constant is never aliased into mutable state. */
function defaults(): StaffMember[] {
  return DEFAULT_STAFF.map((s) => ({ ...s }));
}

function load(): StaffMember[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    return normalize(JSON.parse(raw));
  } catch {
    return defaults();
  }
}

let cache = load();
const listeners = new Set<() => void>();

export function getStaff(): StaffMember[] {
  return cache;
}

export function setStaff(next: StaffMember[]): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode etc. — keep the in-memory copy */
  }
  for (const l of listeners) l();
}

export function resetStaff(): void {
  setStaff(defaults());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Cross-tab coherence: another tab writing the directory updates this one.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    cache = load();
    for (const l of listeners) l();
  });
}

export function useStaff(): StaffMember[] {
  return useSyncExternalStore(subscribe, getStaff);
}
