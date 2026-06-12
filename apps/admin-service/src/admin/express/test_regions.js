const { Client } = require('pg');
async function testGlobal() {
  const users = ['postgres', 'pakipark'];
  for (let user of users) {
    const pw = user === 'postgres' ? 'pakiapps_supabase_password' : 'pakipark_pass_123';
    const client = new Client({
      connectionString: `postgres://${user}.rregfrhtlmfktliijzpd:${pw}@pooler.supabase.com:6543/postgres`,
      connectionTimeoutMillis: 5000
    });
    try {
      await client.connect();
      console.log('SUCCESS with user: ' + user);
      await client.end();
      return;
    } catch(err) {
      console.log(`FAILED (${user}): ` + err.message);
    }
  }
}
testGlobal();
