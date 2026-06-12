'use strict';
/**
 * syncSchema.js
 * =============
 * Connects to PostgreSQL and brings the database fully in sync with the
 * Sequelize models (denormalized / no-JOIN schema).
 *
 * Usage:
 * node src/backend/scripts/syncSchema.js              # safe alter (default)
 * node src/backend/scripts/syncSchema.js --force      # DROP + recreate (dev only!)
 * node src/backend/scripts/syncSchema.js --indexes-only
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { sequelize } = require('../config/db');
require('../models/index');

const args         = process.argv.slice(2);
const FORCE        = args.includes('--force');
const INDEXES_ONLY = args.includes('--indexes-only');

// ─── Extra performance indexes (Sequelize cannot define these in model options) ─
const EXTRA_INDEXES = [
  // Booking reference sequence (atomic PKP-XXXXXXXX numbers)
  {
    name: 'booking_reference_seq',
    sql:  `CREATE SEQUENCE IF NOT EXISTS booking_reference_seq START 1;`,
    desc: 'reservation.bookings — atomic sequence for PKP-XXXXXXXX reference numbers',
  },

  // Partial: active/upcoming reservation.bookings for a location on a specific date
  {
    name: 'idx_reservation.bookings_location_date_active',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reservation.bookings_location_date_active
        ON reservation.bookings ("locationId", date)
        WHERE status IN ('upcoming', 'active');
    `,
    desc: 'reservation.bookings — partial: location+date for active/upcoming (conflict check)',
  },

  // Partial: slot conflict check (non-null parkingSlotId only)
  {
    name: 'idx_reservation.bookings_slot_date_active',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reservation.bookings_slot_date_active
        ON reservation.bookings ("parkingSlotId", date)
        WHERE "parkingSlotId" IS NOT NULL AND status IN ('upcoming', 'active');
    `,
    desc: 'reservation.bookings — partial: slot+date for time-window conflict check',
  },

  // Customer booking list sorted newest-first
  {
    name: 'idx_reservation.bookings_user_createdat_desc',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reservation.bookings_user_createdat_desc
        ON reservation.bookings ("userId", "createdAt" DESC);
    `,
    desc: 'reservation.bookings — customer list, newest first',
  },

  // Partial unique barcode index (scanner lookup)
  {
    name: 'idx_reservation.bookings_barcode_partial',
    sql: `
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_reservation.bookings_barcode_partial
        ON reservation.bookings (barcode)
        WHERE barcode IS NOT NULL;
    `,
    desc: 'reservation.bookings — partial unique barcode (scanner lookup)',
  },

  // Full-text style: search by snapshot fields (no JOIN needed)
  {
    name: 'idx_reservation.bookings_vehicle_plate',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reservation.bookings_vehicle_plate
        ON reservation.bookings ("vehiclePlate")
        WHERE "vehiclePlate" IS NOT NULL;
    `,
    desc: 'reservation.bookings — plate number search (snapshot column)',
  },
  {
    name: 'idx_reservation.bookings_user_name',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reservation.bookings_user_name
        ON reservation.bookings ("userName")
        WHERE "userName" IS NOT NULL;
    `,
    desc: 'reservation.bookings — user name search (snapshot column)',
  },

  // Analytics: vehicle type distribution without JOIN
  {
    name: 'idx_reservation.bookings_vehicle_type_paid',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reservation.bookings_vehicle_type_paid
        ON reservation.bookings ("vehicleType")
        WHERE "vehicleType" IS NOT NULL;
    `,
    desc: 'reservation.bookings — vehicle type analytics (no JOIN)',
  },

  // TransactionLog
  {
    name: 'idx_txlogs_booking_createdat',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txlogs_booking_createdat
        ON reservation.transaction_logs ("bookingId", "createdAt" DESC);
    `,
    desc: 'reservation.transaction_logs — all transactions for a booking, newest first',
  },
  {
    name: 'idx_txlogs_user_createdat',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txlogs_user_createdat
        ON reservation.transaction_logs ("userId", "createdAt" DESC);
    `,
    desc: 'reservation.transaction_logs — all transactions for a user, newest first',
  },
  {
    name: 'idx_txlogs_method_status',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txlogs_method_status
        ON reservation.transaction_logs ("paymentMethod", status);
    `,
    desc: 'reservation.transaction_logs — payment method distribution',
  },
  {
    name: 'idx_txlogs_type_createdat',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txlogs_type_createdat
        ON reservation.transaction_logs ("transactionType", "createdAt" DESC)
        WHERE status = 'success';
    `,
    desc: 'reservation.transaction_logs — partial: successful transactions by type',
  },

  // ActivityLog
  {
    name: 'idx_actlog_user_createdat',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_actlog_user_createdat
        ON partner.activity_logs ("userId", "createdAt" DESC);
    `,
    desc: 'partner.activity_logs — all actions by a user, newest first',
  },
  {
    name: 'idx_actlog_severity_createdat',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_actlog_severity_createdat
        ON partner.activity_logs (severity, "createdAt" DESC)
        WHERE severity IN ('warning', 'critical');
    `,
    desc: 'partner.activity_logs — partial: critical/warning events for security dashboard',
  },
  {
    name: 'idx_actlog_entity_createdat',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_actlog_entity_createdat
        ON partner.activity_logs ("entityType", "entityId", "createdAt" DESC);
    `,
    desc: 'partner.activity_logs — timeline for a specific entity',
  },
];

// ─── Views ─────────────────────────────────────────────────────────────────────
// NOTE: These use aggregate queries for analytics dashboards only.
// The core booking read path (list / detail) never uses views.
const VIEWS = [
  {
    name: 'v_location_occupancy_today',
    sql: `
      CREATE OR REPLACE VIEW v_location_occupancy_today AS
      SELECT
        l.id                                              AS "locationId",
        l.name                                            AS "locationName",
        l."totalSpots",
        l."availableSpots",
        COUNT(b.id) FILTER (WHERE b.status = 'active')   AS "occupiedNow",
        COUNT(b.id) FILTER (WHERE b.status = 'upcoming') AS "reservedToday",
        COUNT(b.id) FILTER (WHERE b.status = 'completed'
                             AND b.date = CURRENT_DATE)  AS "completedToday",
        ROUND(
          100.0 * COUNT(b.id) FILTER (WHERE b.status IN ('active','upcoming'))
          / NULLIF(l."totalSpots", 0), 1
        )                                                 AS "occupancyPct"
      FROM parking_lot.locations l
      LEFT JOIN reservation.bookings b
        ON b."locationId" = l.id
       AND b.date = CURRENT_DATE
       AND b.status IN ('upcoming', 'active', 'completed')
      GROUP BY l.id, l.name, l."totalSpots", l."availableSpots";
    `,
  },
  {
    // Slot-status view for the admin parking grid —
    // uses booking snapshot columns so no further JOIN is needed downstream
    name: 'v_slot_status_today',
    sql: `
      CREATE OR REPLACE VIEW v_slot_status_today AS
      SELECT
        ps.id                                       AS "slotId",
        ps."locationId",
        ps.label,
        ps.section,
        ps.floor,
        ps.type                                     AS "slotType",
        CASE
          WHEN ps.status = 'maintenance' THEN 'maintenance'
          WHEN b.id IS NULL              THEN 'available'
          WHEN b.status = 'active'       THEN 'occupied'
          ELSE 'reserved'
        END                                         AS "derivedStatus",
        b.id                                        AS "bookingId",
        b.reference                                 AS "bookingRef",
        b."timeSlot",
        b.status                                    AS "bookingStatus",
        b.amount,
        -- Snapshot columns (no further JOIN needed)
        b."userName",
        b."userPhone",
        b."vehiclePlate",
        b."vehicleType",
        b."vehicleBrand",
        b."vehicleModel"
      FROM parking_lot.parking_slots ps
      LEFT JOIN reservation.bookings b
        ON b."parkingSlotId" = ps.id
       AND b.date = CURRENT_DATE
       AND b.status IN ('upcoming', 'active');
    `,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ok   = (msg) => console.log(`  ✅  ${msg}`);
const info = (msg) => console.log(`  ℹ️   ${msg}`);
const warn = (msg) => console.log(`  ⚠️   ${msg}`);
const err  = (msg) => console.error(`  ❌  ${msg}`);
const sep  = ()    => console.log('─'.repeat(70));

async function runSQL(q, label) {
  try {
    await sequelize.query(q.trim());
    ok(label);
  } catch (e) {
    if (e.message.includes('CONCURRENTLY') && e.message.includes('transaction')) {
      const fallback = q.replace('CONCURRENTLY ', '');
      await sequelize.query(fallback.trim());
      ok(`${label} (non-concurrent fallback)`);
    } else {
      warn(`${label} — ${e.message}`);
    }
  }
}

// ─── Index report ─────────────────────────────────────────────────────────────
async function printIndexReport() {
  sep();
  console.log('📊  INDEX REPORT\n');
  const [rows] = await sequelize.query(`
    SELECT
      t.relname          AS table_name,
      i.relname          AS index_name,
      ix.indisunique     AS is_unique,
      ix.indisprimary    AS is_pk,
      pg_size_pretty(pg_relation_size(i.oid)) AS size,
      array_to_string(
        array(
          SELECT a.attname
          FROM pg_attribute a
          WHERE a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
          ORDER BY a.attnum
        ), ', '
      ) AS columns
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class  i ON i.oid = ix.indexrelid
    WHERE t.relkind = 'r'
      AND t.relname IN (
        'account.users','parking_lot.locations','vehicles','parking_lot.parking_slots',
        'reservation.bookings','reviews','settings','parking_rates',
        'reservation.transaction_logs','partner.activity_logs'
      )
    ORDER BY t.relname, i.relname;
  `);

  const byTable = {};
  for (const r of rows) {
    if (!byTable[r.table_name]) byTable[r.table_name] = [];
    byTable[r.table_name].push(r);
  }
  for (const [table, idxs] of Object.entries(byTable)) {
    console.log(`\n  📋  ${table}`);
    for (const idx of idxs) {
      const tag = idx.is_pk ? '[PK]' : idx.is_unique ? '[UQ]' : '    ';
      console.log(`       ${tag}  ${idx.index_name.padEnd(55)} (${idx.columns})  ${idx.size}`);
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🚗  PakiPark — Database Schema Sync (Loosely Coupled / No-JOIN)\n');
  sep();

  try {
    await sequelize.authenticate();
    ok('PostgreSQL connected');

    // 👇 ADDED: Temporarily drop views so Sequelize can freely alter tables
    try {
      await sequelize.query('DROP VIEW IF EXISTS v_location_occupancy_today CASCADE;');
      await sequelize.query('DROP VIEW IF EXISTS v_slot_status_today CASCADE;');
      info('Cleared old views for sync compatibility');
    } catch (viewError) {
      warn(`Could not drop views prior to sync: ${viewError.message}`);
    }

    if (!INDEXES_ONLY) {
      if (FORCE) {
        warn('--force flag detected: ALL TABLES WILL BE DROPPED AND RECREATED');
        warn('This is destructive! Use only in development.');
        await new Promise((r) => setTimeout(r, 3000));
        await sequelize.sync({ force: true });
        ok('All tables recreated (force)');
      } else {
        try {
          await sequelize.sync({ alter: true });
          ok('All tables synced (alter — no data lost)');
        } catch (e) {
          warn('Sync alter failed, but schema might already be updated: ' + e.message.split('\n')[0]);
        }
      }
    } else {
      info('--indexes-only: skipping Sequelize sync');
    }

    sep();
    console.log('\n📌  Applying extra performance indexes…\n');
    await sequelize.query('COMMIT');
    for (const idx of EXTRA_INDEXES) {
      await runSQL(idx.sql, `${idx.name}  —  ${idx.desc}`);
    }

    sep();
    console.log('\n📐  Creating / refreshing views…\n');
    for (const view of VIEWS) {
      await runSQL(view.sql, `VIEW ${view.name}`);
    }

    await printIndexReport();
    sep();
    console.log('\n🎉  Schema sync complete!\n');
    console.log('   Architecture: Denormalized snapshots — zero JOINs on booking reads.\n');
  } catch (e) {
    err(`Sync failed: ${e.message}`);
    console.error(e);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();