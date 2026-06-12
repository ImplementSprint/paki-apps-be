const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: "postgres://postgres:pakiapps_database_password@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => {
    console.log('CONNECTED SUCCESSFULLY');
    process.exit(0);
  })
  .catch(err => {
    console.error('CONNECTION FAILED:', err.message);
    process.exit(1);
  });
