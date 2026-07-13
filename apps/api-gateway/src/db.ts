import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";

const client = postgres(env.DATABASE_URL, { max: 8, onnotice: () => {} });
export const db = drizzle(client);

/** Idempotent bootstrap — no migration tooling in the image; the POC owns a
 *  handful of tables and creates them on boot. Also migrates pre-centers
 *  databases in place: the single facility becomes the default center, and
 *  the staff schedule columns move onto per-center assignment rows. */
export async function ensureSchema(): Promise<void> {
  await client`
    CREATE TABLE IF NOT EXISTS centers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      timezone text NOT NULL DEFAULT 'America/Chicago',
      phone_number text NOT NULL DEFAULT '',
      twilio_number_sid text NOT NULL DEFAULT '',
      active boolean NOT NULL DEFAULT true,
      sort integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
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
  // Pre-uuid dev iterations left text-id staff tables the current app never
  // ran against (role/department columns). Park them instead of crashing on
  // the uuid foreign key below; the default roster reseeds fresh.
  const [staffIdType] = await client`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'id'
  `;
  if (staffIdType && staffIdType.data_type !== "uuid") {
    await client`ALTER TABLE staff RENAME TO staff_pre_uuid_backup`;
  }
  // Fresh installs create the person-identity shape; pre-centers databases
  // already have this table with the schedule columns, migrated below.
  await client`
    CREATE TABLE IF NOT EXISTS staff (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      phone text NOT NULL DEFAULT '',
      email text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await client`
    CREATE TABLE IF NOT EXISTS staff_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
      section text NOT NULL,
      handles text NOT NULL DEFAULT '',
      days jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
      start_time text NOT NULL DEFAULT '09:00',
      end_time text NOT NULL DEFAULT '17:00',
      time_off jsonb NOT NULL DEFAULT '[]'::jsonb,
      is_fallback boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      sort integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT staff_assignments_staff_center_unique UNIQUE (staff_id, center_id)
    )
  `;
  await client`
    CREATE TABLE IF NOT EXISTS center_settings (
      center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
      key text NOT NULL,
      value jsonb NOT NULL,
      PRIMARY KEY (center_id, key)
    )
  `;
  await client`
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id text PRIMARY KEY,
      selected_center_id uuid REFERENCES centers(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await client`
    CREATE TABLE IF NOT EXISTS app_settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await client`ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT ''`;
  await client`ALTER TABLE staff ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT ''`;
  await client`ALTER TABLE calls ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '[]'::jsonb`;
  await client`ALTER TABLE calls ADD COLUMN IF NOT EXISTS center_id uuid`;
  await client`ALTER TABLE calls ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'standard'`;
  await client`ALTER TABLE calls ADD COLUMN IF NOT EXISTS triage text NOT NULL DEFAULT 'none'`;
  await client`ALTER TABLE centers ADD COLUMN IF NOT EXISTS after_hours_enabled boolean NOT NULL DEFAULT false`;
  await client`ALTER TABLE centers ADD COLUMN IF NOT EXISTS after_hours_start text NOT NULL DEFAULT '16:30'`;
  await client`ALTER TABLE centers ADD COLUMN IF NOT EXISTS after_hours_end text NOT NULL DEFAULT '08:00'`;
  await client`ALTER TABLE centers ADD COLUMN IF NOT EXISTS after_hours_greeting text NOT NULL DEFAULT ''`;
  await client`ALTER TABLE calls ADD COLUMN IF NOT EXISTS pending_transfer jsonb`;
  await client`CREATE INDEX IF NOT EXISTS calls_center_created_idx ON calls (center_id, created_at DESC)`;

  await migrateToCenters();
}

/** One-time (but idempotent) pre-centers → centers data migration. Creates
 *  the default center from the FACILITY_* env, then moves the global rows
 *  under it: legacy settings keys, legacy staff schedule columns, and calls
 *  without a center. Re-running is a no-op — every step guards on the legacy
 *  shape still being present. */
async function migrateToCenters(): Promise<void> {
  const [existing] = await client`SELECT id FROM centers ORDER BY sort, created_at LIMIT 1`;
  const defaultCenterId: string = existing
    ? (existing.id as string)
    : ((
        await client`
          INSERT INTO centers (name, timezone)
          VALUES (${env.FACILITY_NAME}, ${env.FACILITY_TIMEZONE})
          RETURNING id
        `
      )[0]!.id as string);

  await client`UPDATE calls SET center_id = ${defaultCenterId} WHERE center_id IS NULL`;

  // Legacy single-row settings table → this center's settings.
  const [legacySettings] = await client`SELECT to_regclass('public.settings') AS t`;
  if (legacySettings?.t) {
    await client`
      INSERT INTO center_settings (center_id, key, value)
      SELECT ${defaultCenterId}, key, value FROM settings
      ON CONFLICT (center_id, key) DO NOTHING
    `;
    await client`DROP TABLE settings`;
  }

  // Legacy staff schedule columns → assignment rows at the default center.
  const [legacyStaff] = await client`
    SELECT 1 AS present FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'section'
  `;
  if (legacyStaff?.present) {
    await client`
      INSERT INTO staff_assignments
        (staff_id, center_id, section, handles, days, start_time, end_time,
         time_off, is_fallback, active, sort, created_at)
      SELECT id, ${defaultCenterId}, section, COALESCE(handles, ''), days, start_time,
             end_time, time_off, is_fallback, active, sort, created_at
      FROM staff
      ON CONFLICT (staff_id, center_id) DO NOTHING
    `;
    await client`
      ALTER TABLE staff
        DROP COLUMN IF EXISTS section,
        DROP COLUMN IF EXISTS handles,
        DROP COLUMN IF EXISTS days,
        DROP COLUMN IF EXISTS start_time,
        DROP COLUMN IF EXISTS end_time,
        DROP COLUMN IF EXISTS time_off,
        DROP COLUMN IF EXISTS is_fallback,
        DROP COLUMN IF EXISTS active,
        DROP COLUMN IF EXISTS sort
    `;
  }
}
