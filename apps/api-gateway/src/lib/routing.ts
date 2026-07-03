import { isOnShift, type ShiftClock, type StaffRow } from "./staff";

/**
 * Deterministic routing engine.
 *
 * The model's only job is to emit exactly one RouteTarget; everything after
 * that — who answers, whether they are reachable, what happens when they are
 * not — is decided here, in code, against the live staff table. No routing
 * rule may ever live in a prompt.
 */

export const ROUTE_TARGETS = [
  "admissions",
  "billing",
  "escalation",
  "onsite_care",
  "routine_admin",
  "general_question",
  "emergency",
  "named_mira",
  "named_richa",
  "named_sheri",
  "named_dessa",
] as const;
export type RouteTarget = (typeof ROUTE_TARGETS)[number];

type RouteRule =
  | { kind: "department"; department: string }
  | { kind: "staff"; name: string }
  | { kind: "answer" }
  | { kind: "emergency" };

/**
 * The routing table. Departments (not people) are the primary key so the
 * staff admin page can re-assign coverage without touching this file:
 *   Admissions / tours / pricing → Admissions (Sheri)
 *   Billing / insurance / Medicaid → Billing (Mira)
 *   Complaints / executive director / escalation → Administration (Richa)
 *   Routine admin / visits / office help → Front Office (Dessa)
 *   Urgent non-emergency or unknown-urgent care → Nursing (Main Nursing Line)
 *   General questions → answered directly, no transfer
 *   Medical emergency → emergency workflow
 */
export const ROUTING_TABLE: Record<RouteTarget, RouteRule> = {
  admissions: { kind: "department", department: "Admissions" },
  billing: { kind: "department", department: "Billing" },
  escalation: { kind: "department", department: "Administration" },
  onsite_care: { kind: "department", department: "Nursing" },
  routine_admin: { kind: "department", department: "Front Office" },
  general_question: { kind: "answer" },
  emergency: { kind: "emergency" },
  named_mira: { kind: "staff", name: "Mira" },
  named_richa: { kind: "staff", name: "Richa" },
  named_sheri: { kind: "staff", name: "Sheri" },
  named_dessa: { kind: "staff", name: "Dessa" },
};

export interface RouteDestination {
  id: string;
  name: string;
  role: string;
  department: string;
  extension: string;
}

export interface RouteDecision {
  target: RouteTarget;
  action: "transfer" | "voicemail" | "answer" | "emergency";
  /** Transfer: who picks up. Voicemail: whose box takes the message. */
  destination: RouteDestination | null;
  reason: string;
}

function toDestination(s: StaffRow): RouteDestination {
  return { id: s.id, name: s.name, role: s.role, department: s.department, extension: s.extension };
}

function findPrimary(rule: RouteRule, rows: StaffRow[]): StaffRow | null {
  const active = rows.filter((s) => s.active);
  if (rule.kind === "staff") {
    return active.find((s) => s.name.toLowerCase().includes(rule.name.toLowerCase())) ?? null;
  }
  if (rule.kind === "department") {
    return active.find((s) => s.department.toLowerCase() === rule.department.toLowerCase()) ?? null;
  }
  return null;
}

function findNursing(rows: StaffRow[], at: ShiftClock): StaffRow | null {
  return (
    rows.find((s) => s.active && s.department.toLowerCase() === "nursing" && isOnShift(s, at)) ??
    null
  );
}

export function resolveRoute(target: RouteTarget, rows: StaffRow[], at: ShiftClock): RouteDecision {
  const rule = ROUTING_TABLE[target];

  if (rule.kind === "emergency") {
    return {
      target,
      action: "emergency",
      destination: null,
      reason: "Medical emergency — emergency workflow, no transfer.",
    };
  }
  if (rule.kind === "answer") {
    return {
      target,
      action: "answer",
      destination: null,
      reason: "General question — answered directly, no transfer.",
    };
  }

  const primary = findPrimary(rule, rows);
  if (!primary) {
    const nursing = findNursing(rows, at);
    if (nursing) {
      return {
        target,
        action: "transfer",
        destination: toDestination(nursing),
        reason: `No active staff configured for ${describe(rule)}; sent to the nursing line.`,
      };
    }
    return {
      target,
      action: "voicemail",
      destination: null,
      reason: `No active staff configured for ${describe(rule)} and no nursing coverage.`,
    };
  }

  // Walk the fallback chain (bounded, cycle-safe) until someone is on shift.
  const visited = new Set<string>();
  let current: StaffRow = primary;
  for (let hop = 0; hop < 4; hop++) {
    if (isOnShift(current, at)) {
      return {
        target,
        action: "transfer",
        destination: toDestination(current),
        reason:
          hop === 0
            ? `${current.name} (${current.department}) is on shift.`
            : `${primary.name} is off shift; fallback reached ${current.name}.`,
      };
    }
    visited.add(current.id);
    const next = resolveFallback(current, rows, at);
    if (!next || visited.has(next.id)) break;
    current = next;
  }

  return {
    target,
    action: "voicemail",
    destination: toDestination(primary),
    reason: `${primary.name} (${primary.department}) is off shift and no fallback is available.`,
  };
}

function resolveFallback(s: StaffRow, rows: StaffRow[], at: ShiftClock): StaffRow | null {
  const fb = s.fallbackDestination.trim().toLowerCase();
  if (fb === "voicemail" || fb === "") return null;
  if (fb === "nursing") return findNursing(rows, at);
  return rows.find((r) => r.active && r.id === s.fallbackDestination) ?? null;
}

function describe(rule: RouteRule): string {
  if (rule.kind === "department") return `the ${rule.department} department`;
  if (rule.kind === "staff") return rule.name;
  return "this request";
}
