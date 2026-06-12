const { Client } = require('pg');
const c = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rregfrhtlmfktliijzpd',
  password: 'pakiapps_supabase_password',
  ssl: { rejectUnauthorized: false },
});

c.connect()
  .then(() => c.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `))
  .then((r) => {
    console.log('\n✅  TABLES IN SUPABASE DB:');
    r.rows.forEach((t) => console.log('   ', t.table_name));
    return c.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'bookings' AND column_name IN ('reminderSentAt','checkedInByTeller')
    `);
  })
  .then((r) => {
    console.log('\n✅  Sprint columns on bookings:', r.rows.map(x => x.column_name).join(', ') || 'NONE YET');
    c.end();
  })
  .catch((e) => { console.log('ERROR:', e.message); c.end(); });
