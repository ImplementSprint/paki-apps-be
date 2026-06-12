require('dotenv').config({ path: '../.env' });
const { sequelize } = require('../config/db');

sequelize.authenticate().then(async () => {
  const [cols] = await sequelize.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'account' AND table_name = 'users' ORDER BY ordinal_position`
  );
  console.log('Columns:', JSON.stringify(cols, null, 2));

  const [constraints] = await sequelize.query(
    `SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_schema = 'account' AND table_name = 'users'`
  );
  console.log('Constraints:', JSON.stringify(constraints, null, 2));

  await sequelize.close();
}).catch(e => { console.error(e.message); process.exit(1); });
