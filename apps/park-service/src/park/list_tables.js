const { Sequelize } = require('sequelize');
require('dotenv').config();

async function checkSchema() {
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    logging: false
  });

  try {
    const [tables] = await sequelize.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN ('reviews', 'bookings', 'locations', 'users', 'transaction_logs', 'activity_logs')");
    console.table(tables);
  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

checkSchema();
