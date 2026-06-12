'use strict';
const { sequelize } = require('../config/db');
const { getSupabaseClient } = require('../config/supabaseClient');

(async () => {
  const TELLER_EMAIL = 'teller1@pakipark.com';
  const SUPABASE_ID  = 'b9fb2271-2546-4e71-a901-c4a437d206cc';

  // 1. Check account.profiles for the teller
  try {
    const [profiles] = await sequelize.query(
      `SELECT * FROM account.profiles WHERE email = :email OR id::text = :sid LIMIT 5`,
      { replacements: { email: TELLER_EMAIL, sid: SUPABASE_ID } }
    );
    console.log('\n[account.profiles]:', JSON.stringify(profiles, null, 2));
  } catch(e) { console.error('profiles error:', e.message); }

  // 2. Check account.users
  try {
    const [users] = await sequelize.query(
      `SELECT id, email, role, "supabaseId" FROM account.users WHERE email = :email OR "supabaseId" = :sid LIMIT 5`,
      { replacements: { email: TELLER_EMAIL, sid: SUPABASE_ID } }
    );
    console.log('\n[account.users]:', JSON.stringify(users, null, 2));
  } catch(e) { console.error('users error:', e.message); }

  // 3. Check auth.users
  try {
    const [authUsers] = await sequelize.query(
      `SELECT id, email, raw_app_meta_data FROM auth.users WHERE email = :email OR id::text = :sid LIMIT 5`,
      { replacements: { email: TELLER_EMAIL, sid: SUPABASE_ID } }
    );
    console.log('\n[auth.users]:', JSON.stringify(authUsers, null, 2));
  } catch(e) { console.error('auth.users error:', e.message); }

  // 4. Try the exact getProfileByAuthId query to see what would be returned at login
  try {
    const [rows] = await sequelize.query(
      `SELECT
         ap.id            AS auth_id,
         ap.first_name,
         ap.last_name,
         ap.email         AS ap_email,
         ap.phone         AS ap_phone,
         ap.dob           AS ap_dob,
         u.id             AS public_id,
         u.role,
         u."isVerified",
         u."profilePicture"
       FROM account.profiles ap
       LEFT JOIN account.users u ON u."supabaseId" = ap.id
       WHERE ap.id = :sid
       LIMIT 1`,
      { replacements: { sid: SUPABASE_ID } }
    );
    console.log('\n[getProfileByAuthId result]:', JSON.stringify(rows[0] ?? 'NO RESULT', null, 2));
    if (!rows[0]) {
      console.log('\n⚠️  No account.profiles row for this supabaseId!');
      console.log('   The LEFT JOIN will fail and role will be missing from login response.');
      console.log('\n   FIX: Inserting into account.profiles...');
      
      // Get the teller name from account.users
      const [uRows] = await sequelize.query(
        `SELECT name, email FROM account.users WHERE "supabaseId" = :sid LIMIT 1`,
        { replacements: { sid: SUPABASE_ID } }
      );
      const dbUser = uRows[0];
      const firstName = (dbUser?.name || 'Teller1').split(' ')[0];
      const lastName  = (dbUser?.name || 'Teller1').split(' ').slice(1).join(' ') || '';

      await sequelize.query(
        `INSERT INTO account.profiles (id, first_name, last_name, email, phone, dob)
         VALUES (:id, :firstName, :lastName, :email, NULL, NULL)
         ON CONFLICT (id) DO UPDATE
           SET first_name = EXCLUDED.first_name,
               last_name  = EXCLUDED.last_name,
               email      = COALESCE(EXCLUDED.email, account.profiles.email)`,
        { replacements: {
          id:        SUPABASE_ID,
          firstName: firstName || 'Teller',
          lastName:  lastName  || '1',
          email:     TELLER_EMAIL,
        }}
      );
      console.log('   ✅ Inserted account.profiles row for teller1.');
    }
  } catch(e) { console.error('getProfileByAuthId query error:', e.message); }

  // 5. Verify final result
  try {
    const [rows] = await sequelize.query(
      `SELECT
         ap.id AS auth_id, ap.first_name, ap.last_name, ap.email AS ap_email,
         u.id AS public_id, u.role, u."isVerified"
       FROM account.profiles ap
       LEFT JOIN account.users u ON u."supabaseId" = ap.id
       WHERE ap.id = :sid LIMIT 1`,
      { replacements: { sid: SUPABASE_ID } }
    );
    console.log('\n[Final profile check]:', JSON.stringify(rows[0] ?? 'STILL MISSING', null, 2));
  } catch(e) { console.error('Final check error:', e.message); }

  process.exit(0);
})();
