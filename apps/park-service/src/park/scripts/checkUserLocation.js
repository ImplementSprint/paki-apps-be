'use strict';
const { sequelize } = require('../config/db');

const TELLER_SUPABASE_ID = 'b9fb2271-2546-4e71-a901-c4a437d206cc';
const MOA_LOCATION_ID    = 'f35dc2f7-3f5f-4ad9-aebf-4097de548dd4';

(async () => {
  try {
    // 1. Count slots at MOA
    const [[{ count }]] = await sequelize.query(
      `SELECT COUNT(*) AS count FROM parking_lot.parking_slots WHERE location_id = :locId`,
      { replacements: { locId: MOA_LOCATION_ID } }
    );
    console.log(`Total parking slots at SM MOA: ${count}`);

    // 2. Assign teller1 as the tellerUserId for ALL slots at MOA
    const [result] = await sequelize.query(
      `UPDATE parking_lot.parking_slots
       SET "tellerUserId" = :tellerId,
           "updatedAt"    = now()
       WHERE location_id = :locId`,
      { replacements: { tellerId: TELLER_SUPABASE_ID, locId: MOA_LOCATION_ID } }
    );
    console.log(`\n✅ Successfully assigned teller1@pakipark.com (supabaseId: ${TELLER_SUPABASE_ID})`);
    console.log(`   to SM Mall of Asia (MOA) — location_id: ${MOA_LOCATION_ID}`);
    console.log(`   ${count} parking slot(s) updated.`);

    // 3. Verify
    const [verify] = await sequelize.query(
      `SELECT DISTINCT location_id, "tellerUserId", COUNT(*) AS slots
       FROM parking_lot.parking_slots
       WHERE "tellerUserId" = :tellerId
       GROUP BY location_id, "tellerUserId"`,
      { replacements: { tellerId: TELLER_SUPABASE_ID } }
    );
    console.log('\nVerification — teller hub assignments:', JSON.stringify(verify, null, 2));

    // 4. Confirm getScopedHubIds result
    const [hubRows] = await sequelize.query(
      `SELECT DISTINCT location_id AS hub_id FROM parking_lot.parking_slots WHERE "tellerUserId" = :tellerId`,
      { replacements: { tellerId: TELLER_SUPABASE_ID } }
    );
    console.log('\ngetScopedHubIds will now return:', hubRows.map(r => r.hub_id));

  } catch (e) {
    console.error('Error assigning teller to location:', e.message);
  }

  process.exit(0);
})();
