const { Sequelize, QueryTypes } = require('sequelize');
require('dotenv').config();

async function checkSchema() {
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    logging: false
  });

  try {
    const schemas = await sequelize.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog')", { type: QueryTypes.SELECT });
    
    for (const { schema_name: schema } of schemas) {
      console.log(`\n=== Schema: ${schema} ===`);
      const tables = await sequelize.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}'`, { type: QueryTypes.SELECT });
      
      for (const { table_name: tableName } of tables) {
        console.log(`\nTable: ${tableName}`);
        const columns = await sequelize.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tableName}' ORDER BY ordinal_position`, { type: QueryTypes.SELECT });
        console.table(columns);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

checkSchema();
