require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../config/db');


async function main() {
  // Get all tables currently in the public schema
  const [rows] = await sequelize.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('spatial_ref_sys')
    ORDER BY table_name;
  `);
  console.log('Tables in public schema:');
  rows.forEach(r => console.log(' -', r.table_name));
  await sequelize.close();
}

main().catch(console.error);
