import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
