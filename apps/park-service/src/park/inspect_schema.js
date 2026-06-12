const { sequelize } = require('./config/db');

async function inspect() {
  try {
    const [profiles] = await sequelize.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'account' AND table_name = 'profiles' ORDER BY ordinal_position");
    console.log('account.profiles:', profiles.map(c => c.column_name));

    const [bookings] = await sequelize.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'reservation' AND table_name = 'bookings' ORDER BY ordinal_position");
    console.log('reservation.bookings:', bookings.map(c => c.column_name));
    
    const [users] = await sequelize.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_name = 'users'");
    console.log('users tables in database:', users);

    const [profilesTables] = await sequelize.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_name = 'profiles'");
    console.log('profiles tables in database:', profilesTables);
  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}
inspect();
