const { sequelize } = require('./config/db');

async function cleanEnum() {
  await sequelize.query(`DROP TYPE IF EXISTS "parking_lot"."enum_parking_slots_type" CASCADE;`);
  console.log('✅ Dropped enum_parking_slots_type');
  process.exit(0);
}
cleanEnum().catch(e => { console.error(e); process.exit(1); });
