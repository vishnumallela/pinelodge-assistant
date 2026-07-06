import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";

const client = postgres(env.DATABASE_URL, { max: 8, onnotice: () => {} });
export const db = drizzle(client);

/** Idempotent bootstrap — no migration tooling in the image; the POC owns a
 *  handful of tables and creates them on boot. */
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
  await client`
    CREATE TABLE IF NOT EXISTS staff (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      section text NOT NULL,
      handles text NOT NULL DEFAULT '',
      days jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
      start_time text NOT NULL DEFAULT '09:00',
      end_time text NOT NULL DEFAULT '17:00',
      time_off jsonb NOT NULL DEFAULT '[]'::jsonb,
      is_fallback boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      sort integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await client`
    CREATE TABLE IF NOT EXISTS settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    )
  `;
  await client`ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT ''`;
  await client`ALTER TABLE calls ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '[]'::jsonb`;
}
