'use strict';
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });

const apiCenter = require('./config/apiCenterClient');
const emailService = require('./services/emailService');
const smsService = require('./services/smsService');
const paymentService = require('./services/paymentService');

async function run() {
  console.log('--- TESTING API CENTER GATEWAYS ---');
  
  // 1. Health check ping
  console.log('\n[1] Testing Ping...');
  const isHealthy = await apiCenter.ping();
  console.log('Ping Result:', isHealthy ? 'HEALTHY' : 'DEGRADED');

  // Let's do a raw GET request to /health or /api/v1/health to see the actual response/status code
  try {
    const rawRes = await apiCenter.getToken().then(token => {
      // Let's perform a raw request
      return require('./config/apiCenterClient').ping();
    });
  } catch (e) {
    console.log('Ping raw error:', e.message);
  }

  // 2. Test Email
  console.log('\n[2] Testing Email Service...');
  try {
    // Attempt sending email
    await emailService.sendOTPEmail('simonronjoshua@gmail.com', '987654');
    console.log('Email Service test completed.');
  } catch (err) {
    console.error('Email Service failed:', err);
  }

  // 3. Test SMS
  console.log('\n[3] Testing SMS Service...');
  try {
    await smsService.sendSMS('09663261949', 'Test message from PakiPark API Center');
    console.log('SMS Service test completed.');
  } catch (err) {
    console.error('SMS Service failed:', err);
  }

  // 4. Test Payment
  console.log('\n[4] Testing Payment Service...');
  try {
    const session = await paymentService.createCheckoutSession({
      amount: 15.00,
      referenceId: 'TEST-' + Date.now(),
      description: 'Test Parking Spot Reservation'
    });
    console.log('Payment Service Checkout Session Created:', session);
  } catch (err) {
    console.error('Payment Service failed:', err);
  }
}

run();
