const { Sequelize } = require('sequelize');
require('dotenv').config();

async function checkSchema() {
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    logging: false
  });

  try {
    const [bookings] = await sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'reservation' AND table_name = 'bookings'");
    console.log('--- reservation.bookings ---');
    bookings.forEach(c => console.log(`${c.column_name} (${c.data_type})`));

    const [slots] = await sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'parking_lot' AND table_name = 'parking_slots'");
    console.log('\n--- parking_lot.parking_slots ---');
    slots.forEach(c => console.log(`${c.column_name} (${c.data_type})`));
  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

checkSchema();
