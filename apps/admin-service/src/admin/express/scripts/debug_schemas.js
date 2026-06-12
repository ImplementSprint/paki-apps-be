const { sequelize } = require('../config/db'); 
sequelize.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema'`).then(res => console.log(res[0]));
