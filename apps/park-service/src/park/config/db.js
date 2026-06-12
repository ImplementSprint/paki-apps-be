const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');

dotenv.config();

/**
 * Sequelize instance — shared across all models.
 * Connects to Supabase PostgreSQL when DATABASE_URL is set.
 */

const dbUrl  = (process.env.DATABASE_URL || '').trim();
const useSSL = dbUrl.length > 0;
const connStr = useSSL
  ? dbUrl
  : `postgres://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASS || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'pakipark'}`;

const sequelize = new Sequelize(
  connStr,
  {
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development'
      ? (sql) => {
          if (sql.includes('Executing')) return;
          console.log('[SQL]', sql);
        }
      : false,
    dialectOptions: useSSL
      ? { ssl: { require: true, rejectUnauthorized: false } }
      : {},
    pool: {
      max:     10,
      min:     2,
      acquire: 30000,
      idle:    10000,
    },
  }
);

// ─── Performance indexes — domain schemas (NO public) ────────────────────────
const PERFORMANCE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_res_bookings_location_date_active
     ON reservation.bookings (location_id, date)
     WHERE status IN ('Pending', 'Confirmed', 'CheckedIn')`,

  `CREATE INDEX IF NOT EXISTS idx_res_bookings_slot_date_active
     ON reservation.bookings (parking_slot_id, date)
     WHERE parking_slot_id IS NOT NULL AND status IN ('Pending', 'Confirmed', 'CheckedIn')`,

  `CREATE INDEX IF NOT EXISTS idx_res_bookings_user_createdat
     ON reservation.bookings (user_id, "createdAt" DESC)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_res_bookings_barcode
     ON reservation.bookings (barcode)
     WHERE barcode IS NOT NULL`,

  `CREATE INDEX IF NOT EXISTS idx_routing_slots_teller
     ON routing.parking_slots ("tellerUserId")`,
];


// ── Startup migrations — domain schemas only (NO public) ────────────────────
const STARTUP_MIGRATIONS = [
  // Ensure reservation.bookings has reminderSentAt column
  `ALTER TABLE reservation.bookings ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMPTZ`,

  // Ensure account.users has supabaseId column
  `ALTER TABLE account.users ADD COLUMN IF NOT EXISTS "supabaseId" UUID`,

  // Ensure payment.payment_methods has isDefault column
  `ALTER TABLE payment.payment_methods ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN DEFAULT false`,
];

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log(`✅  PostgreSQL connected ${useSSL ? '(Supabase/SSL)' : '(local)'}`);

    require('../models/index');

    try {
      // We skip alter:true for major schema conflicts, but it helps with minor column adds
      await sequelize.sync({ alter: false }); 
      console.log('✅  Models loaded');
    } catch (syncErr) {
      console.warn(`⚠️  Schema sync warning: ${syncErr.message.split('\n')[0]}`);
    }

    for (const sql of PERFORMANCE_INDEXES) {
      try { await sequelize.query(sql); } catch (e) { console.warn(`⚠️  Index skipped: ${e.message.split('\n')[0]}`); }
    }
    console.log('✅  Performance indexes verified');

    for (const sql of STARTUP_MIGRATIONS) {
      try { await sequelize.query(sql); } catch (e) { console.warn(`⚠️  Migration skipped: ${e.message.split('\n')[0]}`); }
    }
    console.log('✅  Schema migrations applied');

  } catch (error) {
    console.error(`❌  PostgreSQL Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };