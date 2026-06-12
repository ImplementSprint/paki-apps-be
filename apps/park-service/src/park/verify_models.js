const { Booking, Location, Review, TransactionLog, ActivityLog } = require('./models/index');
const { sequelize } = require('./config/db');

async function verifyModels() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected');

    const b = await Booking.findOne({ raw: true });
    console.log('Booking:', b ? 'Found' : 'Empty');

    const l = await Location.findOne({ raw: true });
    console.log('Location:', l ? 'Found' : 'Empty');

    const r = await Review.findOne({ raw: true });
    console.log('Review:', r ? 'Found' : 'Empty');

    const t = await TransactionLog.findOne({ raw: true });
    console.log('TransactionLog:', t ? 'Found' : 'Empty');

    const a = await ActivityLog.findOne({ raw: true });
    console.log('ActivityLog:', a ? 'Found' : 'Empty');

    console.log('✅ Model validation complete!');
  } catch (err) {
    console.error('❌ Model validation failed:', err.message);
  } finally {
    await sequelize.close();
  }
}

verifyModels();
