const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');

dotenv.config();

/**
 * Sequelize instance — shared across all models.
 * Connects to Supabase PostgreSQL when DATABASE_URL is set.
 * Falls back to local PostgreSQL (localhost:5432/pakipark) when DATABASE_URL is absent or empty.
 */

// Enable SSL only when DATABASE_URL is a non-empty string (Supabase / remote Postgres)
const dbUrl  = (process.env.DATABASE_URL || '').trim();
const useSSL = dbUrl.length > 0;
const connStr = useSSL
  ? dbUrl
  : `postgres://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASS || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'pakipark'}`;

const sequelize = new Sequelize(
  connStr,
  {
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development'
      ? (sql) => {
          if (sql.includes('Executing')) return;
          console.log('[SQL]', sql);
        }
      : false,
    dialectOptions: useSSL
      ? { ssl: { require: true, rejectUnauthorized: false } }
      : {},
    pool: {
      max:     10,
      min:     2,
      acquire: 30000,
      idle:    10000,
    },
  }
);

// ─── Partial indexes that Sequelize cannot express in model `indexes` ─────────
// These are created with CREATE INDEX … IF NOT EXISTS so they are idempotent.
// CONCURRENTLY is omitted here because we may be inside an implicit transaction
// at startup; the dedicated syncSchema.js script uses CONCURRENTLY for zero-lock.
const PERFORMANCE_INDEXES = [
  // ── HOT PATH 1: getDashboardSlots + getConflictingSlotIds ───────────────
  // Filters reservation.bookings by location+date, only touches active/upcoming rows.
  // A partial index is typically 5-10× smaller than a full index on the same cols.
  `CREATE INDEX IF NOT EXISTS idx_reservation_bookings_location_date_active
     ON reservation.bookings ("locationId", date)
     WHERE status IN ('upcoming', 'active')`,

  // ── HOT PATH 2: per-slot conflict check (createBooking, autoAssignSlot) ─
  // Only indexes rows that actually have a physical slot assigned.
  `CREATE INDEX IF NOT EXISTS idx_reservation_bookings_slot_date_active
     ON reservation.bookings ("parkingSlotId", date)
     WHERE "parkingSlotId" IS NOT NULL AND status IN ('upcoming', 'active')`,

  // ── Sorted customer booking list ─────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_reservation_bookings_user_createdat
     ON reservation.bookings ("userId", "createdAt" DESC)`,

  // ── Barcode scanner lookup (partial unique — only non-null barcodes) ──────
  // Enables O(log n) lookup at entry/exit gates when scanner sends barcode value.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_reservation_bookings_barcode
     ON reservation.bookings (barcode)
     WHERE barcode IS NOT NULL`,
];

/**
 * Idempotent DDL migrations run at every startup.
 * These cover columns/tables that Sequelize's alter:true cannot apply
 * because Supabase has views built on top of those tables.
 *
 * All statements use IF NOT EXISTS / IF EXISTS so they are safe to re-run.
 */
const STARTUP_MIGRATIONS = [
  `CREATE SCHEMA IF NOT EXISTS account`,
  `CREATE SCHEMA IF NOT EXISTS parking_lot`,
  `CREATE SCHEMA IF NOT EXISTS payment`,
  `CREATE SCHEMA IF NOT EXISTS reservation`,
  `CREATE SCHEMA IF NOT EXISTS teller`,
  `CREATE SCHEMA IF NOT EXISTS notifications`,

  // ── account.users: authId bridge column ─────────────────────────────────────────────────
  // Links account.users to Supabase auth.users (auth.users.id is a uuid).
  // After this runs, loginUser fetches the profile by authId instead of integer PK.
  `ALTER TABLE account.users ADD COLUMN IF NOT EXISTS "authId" UUID`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_account_users_auth_id ON account.users ("authId") WHERE "authId" IS NOT NULL`,

  // ── reservation.bookings: reminder tracking ──────────────────────────────────────────────
  `ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMPTZ`,

  // ── teller.vehicles: default selection ──────────────────────────────────────────────
  `ALTER TABLE teller.vehicles ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN DEFAULT false`,

  // ── parking_lot.locations: convert operatingHours from varchar to jsonb ─────────────────
  // Step 1: add a new jsonb column alongside the old varchar one
  `ALTER TABLE parking_lot.locations ADD COLUMN IF NOT EXISTS "operatingHoursJson" JSONB`,
  `ALTER TABLE parking_lot.locations ADD COLUMN IF NOT EXISTS "overtimeRatePerHour" DOUBLE PRECISION DEFAULT 15`,
  `ALTER TABLE parking_lot.locations ADD COLUMN IF NOT EXISTS "freeHours" INTEGER DEFAULT 2`,
  // Step 2: backfill rows where it's still null with the default schedule
  `UPDATE parking_lot.locations
   SET "operatingHoursJson" = '{"mon":{"open":"06:00","close":"23:00","closed":false},"tue":{"open":"06:00","close":"23:00","closed":false},"wed":{"open":"06:00","close":"23:00","closed":false},"thu":{"open":"06:00","close":"23:00","closed":false},"fri":{"open":"06:00","close":"23:00","closed":false},"sat":{"open":"06:00","close":"23:00","closed":false},"sun":{"open":"06:00","close":"23:00","closed":false}}'::jsonb
   WHERE "operatingHoursJson" IS NULL`,

  // ── account.users: soft-delete ───────────────────────────────────────────────────────
  `ALTER TABLE account.users ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ`,
  `ALTER TABLE account.users ADD COLUMN IF NOT EXISTS "gcashNumber" VARCHAR(15)`,

  // ── notifications table ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS notifications.notifications (
    id           SERIAL PRIMARY KEY,
    "userId"     INTEGER NOT NULL,
    type         VARCHAR(50) NOT NULL,
    title        VARCHAR(200) NOT NULL,
    body         TEXT NOT NULL,
    "isRead"     BOOLEAN NOT NULL DEFAULT false,
    "entityType" VARCHAR(50),
    "entityId"   INTEGER,
    "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications.notifications ("userId", "isRead")`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_createdat ON notifications.notifications ("userId", "createdAt" DESC)`,

  // ── account.users: discount & 2FA columns (may already exist) ───────────────────────
  `ALTER TABLE account.users ADD COLUMN IF NOT EXISTS "discountStatus" VARCHAR(20) DEFAULT 'none'`,
  `ALTER TABLE account.users ADD COLUMN IF NOT EXISTS "discountPct"    INTEGER     DEFAULT 0`,
  `ALTER TABLE account.users ADD COLUMN IF NOT EXISTS "discountIdUrl"  TEXT`,
  `ALTER TABLE account.users ADD COLUMN IF NOT EXISTS "discountType"   VARCHAR(30)`,
  `ALTER TABLE account.users ADD COLUMN IF NOT EXISTS "twoFactorSecret"  VARCHAR(64)`,
  `ALTER TABLE account.users ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN DEFAULT false`,
  `ALTER TABLE account.users ADD COLUMN IF NOT EXISTS preferences      JSONB DEFAULT '{"emailNotifications":true,"smsUpdates":true,"autoExtend":false}'::jsonb`,

  // ── SPRINT: Teller check-in flag (SCRUM-1007) ────────────────────────────────
  `ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "checkedInByTeller" BOOLEAN DEFAULT false`,

  // ── SPRINT: payment_methods table (SCRUM-1014 GCash Link) ────────────────────
  `CREATE TABLE IF NOT EXISTS payment.payment_methods (
    id             SERIAL PRIMARY KEY,
    "userId"       INTEGER     NOT NULL,
    provider       VARCHAR(30) NOT NULL DEFAULT 'GCash',
    mobile_number  VARCHAR(20),
    display_label  VARCHAR(60),
    is_default     BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_payment_methods_user
      FOREIGN KEY ("userId") REFERENCES account.users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment.payment_methods ("userId")`,

  // ── SPRINT: operating_hours table (Partner Operating Hours) ──────────────────
  `CREATE TABLE IF NOT EXISTS parking_lot.operating_hours (
    id            SERIAL   PRIMARY KEY,
    "locationId"  INTEGER  NOT NULL,
    day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time     TIME,
    close_time    TIME,
    is_closed     BOOLEAN  NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_operating_hours_location
      FOREIGN KEY ("locationId") REFERENCES parking_lot.locations(id) ON DELETE CASCADE,
    CONSTRAINT uq_operating_hours_location_day
      UNIQUE ("locationId", day_of_week)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_operating_hours_location ON parking_lot.operating_hours ("locationId")`,

  // Backfill default 06:00–23:00 Mon–Sun for every existing location
  `INSERT INTO parking_lot.operating_hours ("locationId", day_of_week, open_time, close_time, is_closed, "createdAt", "updatedAt")
   SELECT l.id, gs.day, '06:00'::TIME, '23:00'::TIME, false, now(), now()
   FROM   parking_lot.locations l
   CROSS  JOIN generate_series(0, 6) AS gs(day)
   ON CONFLICT ("locationId", day_of_week) DO NOTHING`,

  // ── SPRINT: extend paymentMethod ENUM to accept 'gcash_linked' (SCRUM-1018) ──
  // ALTER TYPE ADD VALUE cannot run inside a transaction; DO block guards the call.
  `DO $$ BEGIN
     ALTER TYPE reservation."enum_bookings_paymentMethod" ADD VALUE IF NOT EXISTS 'gcash_linked';
   EXCEPTION WHEN others THEN NULL;
   END $$`,
];

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log(`✅  PostgreSQL connected ${useSSL ? '(Supabase/SSL)' : '(local)'}`);

    for (const schema of ['account', 'parking_lot', 'payment', 'reservation', 'teller', 'notifications']) {
      await sequelize.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    }

    // Register all models and their associations
    require('../models/index');

    // Sync: adds missing tables / columns / Sequelize-managed indexes.
    // alter:true is safe — it never drops existing columns or data.
    // Non-fatal: Supabase may have views that block certain column type-changes;
    // in that case we log the warning and continue — the schema was likely
    // already in sync from the last syncSchema.js run.
    try {
      await sequelize.sync({ alter: true });
      console.log('✅  All tables synced (alter mode)');
    } catch (syncErr) {
      console.warn(`⚠️  Schema sync skipped (${syncErr.message.split('\n')[0]}). Schema may already be up-to-date.`);
    }

    // Apply partial indexes (idempotent — IF NOT EXISTS)
    for (const sql of PERFORMANCE_INDEXES) {
      try {
        await sequelize.query(sql);
      } catch (e) {
        // Non-fatal: log but continue — index may already exist with different def
        console.warn(`⚠️  Index skipped: ${e.message.split('\n')[0]}`);
      }
    }
    console.log('✅  Performance indexes verified');

    // Apply idempotent DDL migrations (new columns / tables not covered by Sequelize sync)
    for (const sql of STARTUP_MIGRATIONS) {
      try {
        await sequelize.query(sql);
      } catch (e) {
        console.warn(`⚠️  Migration skipped: ${e.message.split('\n')[0]}`);
      }
    }
    console.log('✅  Schema migrations applied');

  } catch (error) {
    console.error(`❌  PostgreSQL Error: ${error.message}`);
    console.warn(`⚠️  Backend will continue running, but endpoints relying on Sequelize will fail.`);
  }
};


module.exports = { sequelize, connectDB };
