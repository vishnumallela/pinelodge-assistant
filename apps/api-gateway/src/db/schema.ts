import { boolean, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// Domain tables live in the APP database. Identity lives in the AUTH service's
// own database, so there are no cross-database FKs here.

// Staff directory: every routable destination is a configurable row. The admin
// page edits these; the routing engine reads them live, so schedule changes
// take effect on the next call with no code change.
export const staff = pgTable("staff", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  department: text("department").notNull(),
  extension: text("extension").notNull(),
  // Comma-separated lowercase day keys, e.g. "mon,tue,wed,thu,fri".
  workingDays: text("working_days").notNull().default("mon,tue,wed,thu,fri"),
  shiftStart: text("shift_start").notNull().default("08:00"),
  shiftEnd: text("shift_end").notNull().default("17:00"),
  active: boolean("active").notNull().default(true),
  // Where a call goes when this person is off shift: "voicemail", "nursing",
  // or another staff row's id.
  fallbackDestination: text("fallback_destination").notNull().default("voicemail"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// One row per incoming call; the structured state Sarah gathers during the
// conversation is persisted here as it arrives.
export const call = pgTable(
  "call",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull().default("active"), // active | completed
    startedAt: timestamp("started_at", { mode: "date" }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { mode: "date" }),
    durationSeconds: integer("duration_seconds"),

    // Caller
    callerName: text("caller_name"),
    callerPhone: text("caller_phone"),
    reason: text("reason"),
    residentName: text("resident_name"),
    relationship: text("relationship"),
    callbackTime: text("callback_time"),

    // Conversation
    screening: text("screening").notNull().default("pending"), // pending | legitimate | spam | scam | emergency
    urgency: text("urgency"),
    requestedStaff: text("requested_staff"),

    // Routing (written by the deterministic engine, never by the model)
    routeTarget: text("route_target"),
    destinationName: text("destination_name"),
    destinationAvailable: boolean("destination_available"),
    transferOutcome: text("transfer_outcome").notNull().default("none"),
    // none | transferred | voicemail | answered_directly | declined | emergency
    voicemail: text("voicemail"),

    summaryStatus: text("summary_status").notNull().default("none"), // none | pending | complete | failed
  },
  (t) => [index("call_started_at_idx").on(t.startedAt)],
);

// Append-only transcript. entryId is the client-side turn id so retried
// appends are idempotent; rows are never updated or deleted.
export const transcriptEntry = pgTable(
  "transcript_entry",
  {
    callId: text("call_id").notNull(),
    entryId: text("entry_id").notNull(),
    seq: integer("seq").notNull(),
    role: text("role").notNull(), // caller | assistant
    text: text("text").notNull(),
    at: timestamp("at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.callId, t.entryId] }),
    index("transcript_call_id_idx").on(t.callId),
  ],
);

// Every tool the model invoked during a call, for the report and for audit.
export const callToolEvent = pgTable(
  "call_tool_event",
  {
    id: text("id").primaryKey(),
    callId: text("call_id").notNull(),
    name: text("name").notNull(),
    detail: text("detail"),
    at: timestamp("at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("call_tool_event_call_id_idx").on(t.callId)],
);

// The permanent Call Report, written asynchronously by a lower-cost model
// after the call ends.
export const callReport = pgTable("call_report", {
  callId: text("call_id").primaryKey(),
  executiveSummary: text("executive_summary").notNull(),
  callerIntent: text("caller_intent").notNull(),
  informationCollected: text("information_collected").notNull(),
  routingDecision: text("routing_decision").notNull(),
  followUp: text("follow_up").notNull(),
  finalDisposition: text("final_disposition").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
