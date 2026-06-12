const { sequelize } = require('./config/db');
async function run() {
  // Check what the role enum allows
  const [enumVals] = await sequelize.query(
    `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'account' AND t.typname LIKE '%role%'`
  );
  console.log('\nRole enum values:');
  console.table(enumVals);

  // Try inserting directly
  try {
    await sequelize.query(
      `INSERT INTO account.users (name, email, role, "isVerified", "supabaseId", password, "createdAt", "updatedAt")
       VALUES ('Business Partner1', 'partner1@pakipark.com', 'business_partner', true, '3e658c3c-2812-4700-9dec-efb7bb440e26', '[SUPABASE_MANAGED]', now(), now())
       ON CONFLICT ("supabaseId") DO UPDATE SET name = EXCLUDED.name, "updatedAt" = now()`
    );
    console.log('\n✅ Insert succeeded!');
  } catch (err) {
    console.error('\n❌ Insert failed:', err.message);
  }

  const [rows] = await sequelize.query(
    `SELECT id, name, role, "supabaseId", email FROM account.users WHERE "supabaseId" = '3e658c3c-2812-4700-9dec-efb7bb440e26'`
  );
  console.log('\naccount.users rows after insert:', rows.length);
  console.table(rows);
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
