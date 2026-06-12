const { Sequelize } = require('sequelize');
require('dotenv').config();

async function checkSchema() {
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    logging: false
  });

  try {
    const [txlogs] = await sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'reservation' AND table_name = 'transaction_logs'");
    console.log('--- reservation.transaction_logs ---');
    console.table(txlogs);

    const [actlogs] = await sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'partner' AND table_name = 'activity_logs'");
    console.log('--- partner.activity_logs ---');
    console.table(actlogs);

    const [reviews] = await sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'reviews'");
    console.log('--- reviews ---');
    console.table(reviews);

  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

checkSchema();
