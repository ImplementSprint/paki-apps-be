'use strict';
/**
 * migrate_to_schemas.js
 * =====================
 * Moves all application tables out of the `public` schema and into their
 * correct domain schemas. Also drops leftover tables that are now
 * duplicated because Sequelize was previously writing to public.
 *
 * This script is IDEMPOTENT — safe to run multiple times.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../config/db');

// ── Mapping: table → target schema ───────────────────────────────────────────
// Tables already in the correct schema are referenced for any dependent DDL.
const MIGRATIONS = [
  // account schema
  { table: 'users',            targetSchema: 'account' },

  // reservation schema
  { table: 'bookings',         targetSchema: 'reservation' },
  { table: 'transaction_logs', targetSchema: 'reservation' },

  // parking_lot schema
  { table: 'locations',        targetSchema: 'parking_lot' },
  { table: 'parking_slots',    targetSchema: 'parking_lot' },
  { table: 'parking_rates',    targetSchema: 'parking_lot' },
  { table: 'operating_hours',  targetSchema: 'parking_lot' },

  // teller schema
  { table: 'vehicles',         targetSchema: 'teller' },
  { table: 'uploads',          targetSchema: 'teller' },
  { table: 'settings',         targetSchema: 'teller' },

  // partner schema
  { table: 'reviews',          targetSchema: 'partner' },
  { table: 'activity_logs',    targetSchema: 'partner' },

  // notifications schema
  { table: 'notifications',    targetSchema: 'notifications' },

  // payment schema
  { table: 'payment_methods',  targetSchema: 'payment' },
];

// Tables to DROP from public with no migration (legacy / orphaned)
const DROP_FROM_PUBLIC = [
  'USER_FACT_TABLE',
  '_prisma_migrations',
];

async function tableExistsIn(table, schema) {
  const [rows] = await sequelize.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = '${schema}' AND table_name = '${table}'
    LIMIT 1;
  `);
  return rows.length > 0;
}

async function tableExistsInPublic(table) {
  return tableExistsIn(table, 'public');
}

async function run() {
  console.log('\n🚀  PakiPark — Migrate tables from public → domain schemas\n');
  console.log('─'.repeat(65));

  await sequelize.authenticate();
  console.log('  ✅  Connected to database\n');

  // Step 1: Move tables from public → target schema
  for (const { table, targetSchema } of MIGRATIONS) {
    const inPublic = await tableExistsInPublic(table);
    const inTarget = await tableExistsIn(table, targetSchema);

    if (!inPublic) {
      if (inTarget) {
        console.log(`  ✔   ${table} already in ${targetSchema} (nothing to do)`);
      } else {
        console.log(`  ⚠   ${table} not found in public OR ${targetSchema} — skipping`);
      }
      continue;
    }

    if (inTarget) {
      // Both exist — drop the public copy (target schema is authoritative)
      console.log(`  🗑   Dropping public.${table} (already exists in ${targetSchema})`);
      try {
        await sequelize.query(`DROP TABLE IF EXISTS public."${table}" CASCADE;`);
        console.log(`  ✅  Dropped public.${table}`);
      } catch (e) {
        console.log(`  ⚠   Could not drop public.${table}: ${e.message.split('\n')[0]}`);
      }
    } else {
      // Move: ALTER TABLE … SET SCHEMA
      console.log(`  ➡   Moving public.${table} → ${targetSchema}.${table}`);
      try {
        await sequelize.query(`ALTER TABLE public."${table}" SET SCHEMA ${targetSchema};`);
        console.log(`  ✅  Moved public.${table} → ${targetSchema}.${table}`);
      } catch (e) {
        console.log(`  ⚠   Could not move public.${table}: ${e.message.split('\n')[0]}`);
      }
    }
  }

  // Step 2: Drop orphaned / legacy tables from public
  console.log('\n  🗑   Cleaning up orphaned tables in public…');
  for (const table of DROP_FROM_PUBLIC) {
    const inPublic = await tableExistsInPublic(table);
    if (!inPublic) {
      console.log(`  ✔   public."${table}" does not exist — skipping`);
      continue;
    }
    try {
      await sequelize.query(`DROP TABLE IF EXISTS public."${table}" CASCADE;`);
      console.log(`  ✅  Dropped public."${table}"`);
    } catch (e) {
      console.log(`  ⚠   Could not drop public."${table}": ${e.message.split('\n')[0]}`);
    }
  }

  // Step 3: Verify — list remaining tables in public
  const [remaining] = await sequelize.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('spatial_ref_sys','geometry_columns','geography_columns')
    ORDER BY table_name;
  `);

  console.log('\n─'.repeat(65));
  if (remaining.length === 0) {
    console.log('\n  🎉  public schema is clean — all application tables live in their domain schemas!\n');
  } else {
    console.log(`\n  ⚠   ${remaining.length} table(s) still in public:`);
    remaining.forEach(r => console.log(`       - ${r.table_name}`));
  }

  await sequelize.close();
}

run().catch(err => {
  console.error('❌  Migration failed:', err.message);
  process.exit(1);
});
