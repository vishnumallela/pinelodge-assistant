import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";

const client = postgres(env.DATABASE_URL, { max: 8, onnotice: () => {} });
export const db = drizzle(client);

/** Idempotent bootstrap — no migration tooling in the image; the POC owns one
 *  table and creates it on boot. */
export async function ensureSchema(): Promise<void> {
  await client`
    CREATE TABLE IF NOT EXISTS calls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
      summary jsonb,
      started_at timestamptz NOT NULL DEFAULT now(),
      ended_at timestamptz,
      duration_seconds integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await client`CREATE INDEX IF NOT EXISTS calls_user_created_idx ON calls (user_id, created_at DESC)`;
}
