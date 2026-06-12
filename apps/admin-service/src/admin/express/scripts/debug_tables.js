const { sequelize } = require('../config/db'); 
sequelize.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`).then(res => console.log(res[0]));
