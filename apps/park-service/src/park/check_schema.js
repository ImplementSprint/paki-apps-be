const { sequelize } = require('./config/db');
async function run() {
  // Find bookings for MOA
  const [r] = await sequelize.query(
    `SELECT DISTINCT location_id, "locationName" FROM reservation.bookings LIMIT 10`
  );
  console.log('Distinct location_ids in reservation.bookings:');
  console.table(r);

  // What is location_id for 'SM Mall of Asia'?
  const [moa] = await sequelize.query(
    `SELECT location_id, "locationName" FROM reservation.bookings WHERE "locationName" ILIKE '%mall of asia%' LIMIT 3`
  );
  console.log('\nMOA bookings location_id:', moa);

  // Check Booking model field mapping for locationId
  const { Booking } = require('./models/index');
  const attrs = Booking.rawAttributes;
  console.log('\nBooking.locationId field:', attrs.locationId?.field, 'type:', attrs.locationId?.type?.constructor?.name);

  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
