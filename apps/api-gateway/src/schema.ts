import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  status: text("status").$type<CallStatus>().notNull().default("active"),
  transcript: jsonb("transcript").$type<TranscriptTurn[]>().notNull().default([]),
  summary: jsonb("summary").$type<CallSummary | null>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CallRow = typeof calls.$inferSelect;

/** Weekly working window + explicit time-off dates, evaluated in facility time. */
export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  section: text("section").notNull(),
  handles: text("handles").notNull().default(""),
  /** Working days, 0 (Sun) – 6 (Sat). */
  days: jsonb("days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  /** "HH:MM" 24h, facility timezone. */
  startTime: text("start_time").notNull().default("09:00"),
  endTime: text("end_time").notNull().default("17:00"),
  /** "YYYY-MM-DD" dates the person is off regardless of the weekly window. */
  timeOff: jsonb("time_off").$type<string[]>().notNull().default([]),
  /** Where calls land when the intended person is unavailable. Exactly one. */
  isFallback: boolean("is_fallback").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StaffRow = typeof staff.$inferSelect;

/** Single-row key/value settings (prompt template, greeting). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
});
