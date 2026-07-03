import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export const sql = postgres(env.DATABASE_URL, { max: 10, onnotice: () => undefined });
export const db = drizzle(sql, { schema });

/** Idempotent schema init so the gateway runs one-command after db:up. */
export async function initDb(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS "staff" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      extension TEXT NOT NULL,
      working_days TEXT NOT NULL DEFAULT 'mon,tue,wed,thu,fri',
      shift_start TEXT NOT NULL DEFAULT '08:00',
      shift_end TEXT NOT NULL DEFAULT '17:00',
      active BOOLEAN NOT NULL DEFAULT true,
      fallback_destination TEXT NOT NULL DEFAULT 'voicemail',
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS "call" (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMP NOT NULL DEFAULT now(),
      ended_at TIMESTAMP,
      duration_seconds INTEGER,
      caller_name TEXT,
      caller_phone TEXT,
      reason TEXT,
      resident_name TEXT,
      relationship TEXT,
      callback_time TEXT,
      screening TEXT NOT NULL DEFAULT 'pending',
      urgency TEXT,
      requested_staff TEXT,
      route_target TEXT,
      destination_name TEXT,
      destination_available BOOLEAN,
      transfer_outcome TEXT NOT NULL DEFAULT 'none',
      voicemail TEXT,
      summary_status TEXT NOT NULL DEFAULT 'none'
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS call_started_at_idx ON "call"(started_at)`;
  await sql`
    CREATE TABLE IF NOT EXISTS "transcript_entry" (
      call_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      at TIMESTAMP NOT NULL DEFAULT now(),
      PRIMARY KEY (call_id, entry_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS transcript_call_id_idx ON "transcript_entry"(call_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS "call_tool_event" (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      name TEXT NOT NULL,
      detail TEXT,
      at TIMESTAMP NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS call_tool_event_call_id_idx ON "call_tool_event"(call_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS "call_report" (
      call_id TEXT PRIMARY KEY,
      executive_summary TEXT NOT NULL,
      caller_intent TEXT NOT NULL,
      information_collected TEXT NOT NULL,
      routing_decision TEXT NOT NULL,
      follow_up TEXT NOT NULL,
      final_disposition TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `;
}

/** Test/CI DDL, mirrored from initDb for PGlite-backed unit tests. */
export const TEST_DDL = `
  CREATE TABLE "staff" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    department TEXT NOT NULL,
    extension TEXT NOT NULL,
    working_days TEXT NOT NULL DEFAULT 'mon,tue,wed,thu,fri',
    shift_start TEXT NOT NULL DEFAULT '08:00',
    shift_end TEXT NOT NULL DEFAULT '17:00',
    active BOOLEAN NOT NULL DEFAULT true,
    fallback_destination TEXT NOT NULL DEFAULT 'voicemail',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE "call" (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active',
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    ended_at TIMESTAMP,
    duration_seconds INTEGER,
    caller_name TEXT,
    caller_phone TEXT,
    reason TEXT,
    resident_name TEXT,
    relationship TEXT,
    callback_time TEXT,
    screening TEXT NOT NULL DEFAULT 'pending',
    urgency TEXT,
    requested_staff TEXT,
    route_target TEXT,
    destination_name TEXT,
    destination_available BOOLEAN,
    transfer_outcome TEXT NOT NULL DEFAULT 'none',
    voicemail TEXT,
    summary_status TEXT NOT NULL DEFAULT 'none'
  );
  CREATE TABLE "transcript_entry" (
    call_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    at TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (call_id, entry_id)
  );
  CREATE TABLE "call_tool_event" (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    name TEXT NOT NULL,
    detail TEXT,
    at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE "call_report" (
    call_id TEXT PRIMARY KEY,
    executive_summary TEXT NOT NULL,
    caller_intent TEXT NOT NULL,
    information_collected TEXT NOT NULL,
    routing_decision TEXT NOT NULL,
    follow_up TEXT NOT NULL,
    final_disposition TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
`;
