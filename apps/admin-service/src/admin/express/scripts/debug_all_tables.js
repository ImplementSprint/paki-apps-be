const { sequelize } = require('../config/db'); 
sequelize.query(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT LIKE 'pg_%' AND table_schema != 'information_schema'`).then(res => console.log(JSON.stringify(res[0].map(r => r.table_schema + '.' + r.table_name), null, 2)));
