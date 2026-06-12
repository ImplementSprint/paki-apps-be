const { Sequelize } = require('sequelize');
require('dotenv').config();

async function checkSchema() {
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    logging: false
  });

  try {
    const [bookings] = await sequelize.query("SELECT table_schema, column_name FROM information_schema.columns WHERE table_name = 'bookings' ORDER BY table_schema, ordinal_position");
    console.log('Columns in bookings:');
    console.log(bookings);
  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

checkSchema();
