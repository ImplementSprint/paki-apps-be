const { Sequelize } = require('sequelize');
require('dotenv').config();

async function checkSchema() {
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    logging: false
  });

  try {
    const [slots] = await sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'parking_lot' AND table_name = 'parking_slots'");
    console.log('--- parking_lot.parking_slots ---');
    console.table(slots);

    const [rates] = await sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'parking_lot' AND table_name = 'parking_rates'");
    console.log('--- parking_lot.parking_rates ---');
    console.table(rates);
  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

checkSchema();
