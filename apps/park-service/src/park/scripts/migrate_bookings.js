const { sequelize } = require('../config/db');

async function migrate() {
  try {
    console.log('Running DDL migrations on reservation.bookings...');
    await sequelize.query('ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "finalAmount" DOUBLE PRECISION');
    await sequelize.query('ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ');
    await sequelize.query('ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "cancelReason" TEXT');
    await sequelize.query('ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMPTZ');
    
    // Also let's check and add other snapshot columns if missing
    await sequelize.query('ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "userName" VARCHAR(120)');
    await sequelize.query('ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "userEmail" VARCHAR(200)');
    await sequelize.query('ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "userPhone" VARCHAR(30)');
    await sequelize.query('ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "vehicleBrand" VARCHAR(60)');
    await sequelize.query('ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "vehicleModel" VARCHAR(60)');
    
    console.log('✅   reservation.bookings DDL alignment completed successfully!');
  } catch (err) {
    console.error('❌  DDL migration failed:', err.message);
  } finally {
    await sequelize.close();
  }
}

migrate();
