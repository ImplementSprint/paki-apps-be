/**
 * audit-db.js  — queries the live Supabase database and prints every table's
 *                columns so we can compare against schema.sql and models.ts
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') });

const { Sequelize } = require('sequelize');

const dbUrl = (process.env.DATABASE_URL || '').trim();
const seq   = new Sequelize(dbUrl, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
});

async function run() {
  await seq.authenticate();
  console.log('✅ Connected\n');

  const [rows] = await seq.query(`
    SELECT
      t.table_name,
      c.column_name,
      c.data_type,
      c.character_maximum_length,
      c.column_default,
      c.is_nullable,
      c.udt_name
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_name  = t.table_name
      AND c.table_schema = t.table_schema
    WHERE t.table_schema = 'public'
      AND t.table_type   = 'BASE TABLE'
    ORDER BY t.table_name, c.ordinal_position;
  `);

  let currentTable = '';
  for (const r of rows) {
    if (r.table_name !== currentTable) {
      currentTable = r.table_name;
      console.log(`\n── TABLE: ${currentTable} ─────────────────────────`);
    }
    const len = r.character_maximum_length ? `(${r.character_maximum_length})` : '';
    const type = r.udt_name === 'text' ? 'TEXT' :
                 r.udt_name === 'bool' ? 'BOOLEAN' :
                 r.udt_name === 'int4' ? 'INTEGER' :
                 r.udt_name === 'float8' ? 'FLOAT' :
                 r.udt_name === 'jsonb' ? 'JSONB' :
                 r.udt_name.startsWith('_') ? r.udt_name.slice(1).toUpperCase()+'[]' :
                 (r.data_type + len).toUpperCase();
    console.log(`  ${r.column_name.padEnd(26)} ${type.padEnd(20)} nullable=${r.is_nullable}`);
  }

  await seq.close();
}

run().catch(e => { console.error(e.message); process.exit(1); });
