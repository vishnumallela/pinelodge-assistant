import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** One transcript turn as stored on the call row. */
export interface TranscriptTurn {
  role: "caller" | "assistant";
  text: string;
}

/** The receptionist's written-up call summary (the "message slip"). */
export interface CallSummary {
  headline: string;
  caller: string;
  keyPoints: string[];
  outcome: string;
  followUp: string;
}

export type CallStatus = "active" | "summarizing" | "done" | "failed";

/** One system event on a call's debug timeline (webhook, transfer, …). */
export interface CallEvent {
  at: string;
  event: string;
  detail?: string;
}

/** A center (facility/location). Each center runs its own receptionist:
 *  its own inbound number, staff roster, prompt template, and timezone. */
export const centers = pgTable("centers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** IANA timezone the center's schedules and availability evaluate in. */
  timezone: text("timezone").notNull().default("America/Chicago"),
  /** E.164 of the Twilio number that rings this center; empty = no line yet. */
  phoneNumber: text("phone_number").notNull().default(""),
  /** Twilio IncomingPhoneNumber SID when the number is managed from the app. */
  twilioNumberSid: text("twilio_number_sid").notNull().default(""),
  /** E.164 dialed as a last resort when NO staff (not even the starred
   *  fallback) is reachable — the guaranteed default so a caller is never
   *  dropped. Empty = no safety net (agent takes a message instead). */
  fallbackNumber: text("fallback_number").notNull().default(""),
  active: boolean("active").notNull().default(true),
  /** After the cutoff, callers hear the staff-has-left greeting and the call
   *  becomes message-only — no transfers, reviewed on the Messages page. */
  afterHoursEnabled: boolean("after_hours_enabled").notNull().default(false),
  /** "HH:MM" in the center's timezone; the window may span midnight. */
  afterHoursStart: text("after_hours_start").notNull().default("16:30"),
  afterHoursEnd: text("after_hours_end").notNull().default("08:00"),
  /** Spoken after-hours opener; empty = generated from the center name. */
  afterHoursGreeting: text("after_hours_greeting").notNull().default(""),
  /** Keep soft front-desk room tone on the line for the whole call — under
   *  the agent's voice and through the pauses — so she sounds like she's at a
   *  real desk on an open mic, not in a dead-silent studio. Audio-only —
   *  never affects the call or transfer flow. */
  ambienceEnabled: boolean("ambience_enabled").notNull().default(false),
  /** Ambience loudness as a percent of full scale (1–25); ~8 ≈ -22 dB. */
  ambienceLevel: integer("ambience_level").notNull().default(8),
  /** Which room the ambience emulates: "office" | "lobby" | "clinic". */
  ambienceProfile: text("ambience_profile").notNull().default("office"),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CenterRow = typeof centers.$inferSelect;

export type CallKind = "standard" | "message";
export type TriageStatus = "none" | "open" | "done";

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Call source: "console" or "phone:+1…" ("sip:+1…" on legacy rows). */
  userId: text("user_id").notNull(),
  /** Which center took the call. Nullable only for pre-centers legacy rows;
   *  boot migration backfills them to the default center. */
  centerId: uuid("center_id"),
  status: text("status").$type<CallStatus>().notNull().default("active"),
  /** "message" = taken on the after-hours message-only pathway. */
  kind: text("kind").$type<CallKind>().notNull().default("standard"),
  /** Triage state for message calls ("none" on standard calls). */
  triage: text("triage").$type<TriageStatus>().notNull().default("none"),
  transcript: jsonb("transcript").$type<TranscriptTurn[]>().notNull().default([]),
  summary: jsonb("summary").$type<CallSummary | null>(),
  events: jsonb("events").$type<CallEvent[]>().notNull().default([]),
  /** Transfer target agreed mid-call, awaiting the resume-webhook dial —
   *  persisted so it survives a redeploy / lands on any replica. */
  pendingTransfer: jsonb("pending_transfer").$type<{ name: string; phone: string } | null>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CallRow = typeof calls.$inferSelect;

/** A person. Identity only — name and how to reach them. The same person can
 *  work at any number of centers; the per-center details (section, schedule,
 *  fallback flag) live on their assignment rows. */
export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** E.164 number calls transfer to; empty means announce-only. */
  phone: text("phone").notNull().default(""),
  /** Where the transfer brief email goes; empty means no email on transfer. */
  email: text("email").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StaffRow = typeof staff.$inferSelect;

/** One person's membership at one center: their role there plus the weekly
 *  working window and time-off dates, evaluated in the center's timezone. */
export const staffAssignments = pgTable(
  "staff_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    centerId: uuid("center_id")
      .notNull()
      .references(() => centers.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    handles: text("handles").notNull().default(""),
    /** Working days, 0 (Sun) – 6 (Sat). */
    days: jsonb("days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
    /** "HH:MM" 24h, center timezone. */
    startTime: text("start_time").notNull().default("09:00"),
    endTime: text("end_time").notNull().default("17:00"),
    /** "YYYY-MM-DD" dates the person is off regardless of the weekly window. */
    timeOff: jsonb("time_off").$type<string[]>().notNull().default([]),
    /** Where this center's calls land when the intended person is
     *  unavailable. Exactly one per center. */
    isFallback: boolean("is_fallback").notNull().default(false),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("staff_assignments_staff_center_unique").on(t.staffId, t.centerId)],
);

/** Global application settings (xAI, Twilio, SMTP…), editable in the
 *  dashboard. A row overrides the matching env var; no row = env fallback. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-admin dashboard preferences. The selected center lives here so the
 *  choice follows the admin across browsers and devices. */
export const userPrefs = pgTable("user_prefs", {
  /** Better Auth user id (text — the auth service owns the identity). */
  userId: text("user_id").primaryKey(),
  selectedCenterId: uuid("selected_center_id").references(() => centers.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-center key/value settings (prompt template, greeting). */
export const centerSettings = pgTable(
  "center_settings",
  {
    centerId: uuid("center_id")
      .notNull()
      .references(() => centers.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.centerId, t.key] })],
);
