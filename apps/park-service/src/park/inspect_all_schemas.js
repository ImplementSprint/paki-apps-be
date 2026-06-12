const { sequelize } = require('./config/db');

async function cols(schema, table) {
  const [rows] = await sequelize.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = '${schema}' AND table_name = '${table}'
     ORDER BY ordinal_position`
  );
  return rows;
}

async function inspect() {
  const targets = [
    ['teller', 'vehicles'],
    ['parking_lot', 'locations'],
    ['parking_lot', 'parking_slots'],
    ['partner', 'reviews'],
    ['partner', 'activity_logs'],
    ['reservation', 'transaction_logs'],
    ['teller', 'uploads'],
    ['teller', 'settings'],
  ];
  for (const [schema, table] of targets) {
    try {
      const rows = await cols(schema, table);
      if (rows.length === 0) {
        console.log(`\n⚠️  ${schema}.${table}: TABLE NOT FOUND`);
      } else {
        console.log(`\n✅  ${schema}.${table}:`);
        rows.forEach(r => console.log(`   ${r.column_name.padEnd(30)} ${r.data_type}`));
      }
    } catch (e) {
      console.log(`\n❌  ${schema}.${table}: ${e.message}`);
    }
  }
  await sequelize.close();
}

inspect();
