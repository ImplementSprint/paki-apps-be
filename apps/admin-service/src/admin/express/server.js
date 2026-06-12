'use strict';

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

const corsOptions = require('./config/cors');
const { connectDB } = require('./config/db');
const { startForfeitureScheduler } = require('./services/forfeitureScheduler');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'pakipark-backend' });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'pakipark-backend' });
});

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/vehicles', require('./routes/vehicleRoutes'));
app.use('/api/locations', require('./routes/locationRoutes'));
app.use('/api/parking-slots', require('./routes/parkingSlotRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/uploads', require('./routes/uploadRoutes'));
app.use('/api/logs', require('./routes/logsRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/payment-methods', require('./routes/paymentMethodRoutes'));
app.use('/api/operating-hours', require('./routes/operatingHoursRoutes'));

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, _req, res, _next) => {
  console.error('[Express]', err.stack || err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

async function start() {
  await connectDB();

  app.listen(port, () => {
    console.log(`PakiPark backend listening on http://localhost:${port}`);
  });

  startForfeitureScheduler();
}

start().catch((error) => {
  console.error('Backend startup failed:', error);
  process.exit(1);
});

