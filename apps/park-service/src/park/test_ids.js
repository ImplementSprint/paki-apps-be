const { sequelize } = require('./config/db');

async function checkIds() {
  const [users] = await sequelize.query(`
    SELECT * FROM account.users WHERE email = 'partner1@pakipark.com' LIMIT 1;
  `);
  console.log('account.users:', users);

  const [profiles] = await sequelize.query(`
    SELECT * FROM account.profiles WHERE email = 'partner1@pakipark.com' LIMIT 1;
  `);
  console.log('account.profiles:', profiles);

  const [locations] = await sequelize.query(`
    SELECT id, name, partner_user_id FROM parking_lot.locations WHERE name ILIKE '%Mall of Asia%' LIMIT 1;
  `);
  console.log('parking_lot.locations:', locations);

  process.exit(0);
}
checkIds().catch(e => { console.error(e); process.exit(1); });
