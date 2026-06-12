'use strict';
/**
 * migrate-name-split.js
 * ─────────────────────
 * One-time migration: split public.users.name → firstName + lastName.
 *
 * Run with:  node src/backend/scripts/migrate-name-split.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sequelize } = require('../config/db');

async function run() {
  console.log('🔄 Starting name split migration...');

  // 1. Add columns (safe: IF NOT EXISTS)
  await sequelize.query(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS "firstName" VARCHAR(255) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "lastName"  VARCHAR(255) NOT NULL DEFAULT '';
  `);
  console.log('✅ Columns added (firstName, lastName)');

  // 2. Migrate existing data: split "name" on the first space
  await sequelize.query(`
    UPDATE public.users
    SET
      "firstName" = TRIM(SPLIT_PART(name, ' ', 1)),
      "lastName"  = TRIM(SUBSTRING(name FROM POSITION(' ' IN name) + 1))
    WHERE name IS NOT NULL AND name <> '';
  `);
  console.log('✅ Existing rows migrated from name → firstName + lastName');

  // 3. (Optional) keep name column for now as a generated computed column
  //    Uncomment below to drop the old column once everything is confirmed working:
  // await sequelize.query(`ALTER TABLE public.users DROP COLUMN IF EXISTS name;`);

  const [rows] = await sequelize.query(`
    SELECT id, name, "firstName", "lastName" FROM public.users LIMIT 5
  `);
  console.log('\n📋 Sample rows after migration:');
  console.table(rows);

  console.log('\n✅ Migration complete!');
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
