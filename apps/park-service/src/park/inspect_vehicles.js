const { Sequelize } = require('sequelize');
require('dotenv').config();

async function checkSchema() {
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    logging: false
  });

  try {
    const [vehicles] = await sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'teller' AND table_name = 'vehicles'");
    console.log('--- teller.vehicles ---');
    console.table(vehicles);
  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

checkSchema();
