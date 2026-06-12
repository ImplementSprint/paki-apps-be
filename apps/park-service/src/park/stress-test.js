#!/usr/bin/env node
/**
 * stress-test.js — Account creation + Email & SMS stress test
 * ============================================================
 * Run from: src/Backend/
 *   node stress-test.js
 *
 * Tests:
 *  1. Health check (server alive + API Center status)
 *  2. Register customer account (srjeroaring2@gmail.com)
 *  3. Login with email
 *  4. Login with phone number
 *  5. Email stress test — 4 email types via API Center → SMTP fallback
 *  6. SMS stress test   — OTP + booking confirmation + reminder via API Center → Semaphore
 *  7. API Center ping
 */

'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const http = require('http');

// ── Services (loaded directly — no HTTP hop needed) ───────────────────────────
const emailService  = require('./services/emailService');
const smsService    = require('./services/smsService');
const apiCenter     = require('./config/apiCenterClient');

// ── Target account ────────────────────────────────────────────────────────────
const TARGET = {
  firstName: 'Jero',
  lastName:  'Roaring',
  email:     'srjeroaring2@gmail.com',
  phone:     '+639561531475',    // canonical +63 format
  password:  'Joshua19$',
};

// ── Pretty logger ─────────────────────────────────────────────────────────────
const PASS = (label)      => console.log(`  ✅  ${label}`);
const FAIL = (label, msg) => console.error(`  ❌  ${label}: ${msg}`);
const INFO = (label)      => console.log(`  ℹ️   ${label}`);
const HEAD = (title)      => console.log(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`);

// ── HTTP helper ───────────────────────────────────────────────────────────────
function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    if (token)   headers['Authorization']  = `Bearer ${token}`;

    const req = http.request({
      hostname: 'localhost',
      port:     parseInt(process.env.PORT || '5000'),
      path:     '/api' + urlPath,
      method,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Mock booking data ─────────────────────────────────────────────────────────
const MOCK_BOOKING = {
  reference:    'PKP-TEST-001',
  userName:     `${TARGET.firstName} ${TARGET.lastName}`,
  location:     'PakiPark BGC',
  locationName: 'PakiPark BGC Hub',
  spot:         'A-12',
  date:         '2026-05-20',
  timeSlot:     '09:00 AM – 10:00 AM',
  amount:       150,
};

// ── Test Functions ────────────────────────────────────────────────────────────

async function testHealth() {
  HEAD('1. Health Check');
  const r = await request('GET', '/health');
  if (r.status === 200) {
    PASS(`Server OK | DB: ${r.body.db} | API Center: ${r.body.apiCenter || 'unknown'}`);
    return true;
  }
  FAIL('Health', `HTTP ${r.status}`);
  return false;
}

async function testRegister() {
  HEAD('2. Register Customer Account');
  const r = await request('POST', '/auth/register/customer', {
    firstName: TARGET.firstName,
    lastName:  TARGET.lastName,
    email:     TARGET.email,
    phone:     TARGET.phone,
    password:  TARGET.password,
  });
  if ([200, 201].includes(r.status) && r.body.data) {
    PASS(`Registered | role: ${r.body.data.role} | authId: ${r.body.data.authId}`);
    return r.body.data.token;
  }
  if (r.body?.message?.toLowerCase().includes('already') || r.status === 409) {
    INFO('Already registered — continuing to login tests');
    return null;
  }
  FAIL('Register', `HTTP ${r.status} — ${r.body?.message || JSON.stringify(r.body)}`);
  return null;
}

async function testLoginEmail() {
  HEAD('3. Login with Email');
  const r = await request('POST', '/auth/login', { email: TARGET.email, password: TARGET.password });
  if (r.status === 200 && r.body.data && r.body.data.token) {
    PASS(`Email login OK | role: ${r.body.data.role} | name: ${r.body.data.name || r.body.data.firstName}`);
    return r.body.data.token;
  }
  FAIL('Email login', `HTTP ${r.status} — ${r.body?.message || r.body?.data?.message}`);
  return null;
}

async function testLoginPhone() {
  HEAD('4. Login with Phone Number');
  const r = await request('POST', '/auth/login', { email: TARGET.phone, password: TARGET.password });
  if (r.status === 200 && r.body.data && r.body.data.token) {
    PASS(`Phone login OK | phone: ${r.body.data.phone || TARGET.phone}`);
    return r.body.data.token;
  }
  FAIL('Phone login', `HTTP ${r.status} — ${r.body?.message || r.body?.data?.message}`);
  return null;
}

async function testEmail() {
  HEAD('5. Email Stress Test (4 types)');

  // 5a — Booking confirmation
  try {
    await emailService.sendBookingConfirmation(TARGET.email, MOCK_BOOKING);
    PASS(`Booking confirmation → ${TARGET.email}`);
  } catch (e) { FAIL('Booking confirmation email', e.message); }

  // 5b — Password reset
  try {
    await emailService.sendPasswordReset(TARGET.email, 'test-reset-token-xk9f2');
    PASS(`Password reset email → ${TARGET.email}`);
  } catch (e) { FAIL('Password reset email', e.message); }

  // 5c — Booking reminder
  try {
    await emailService.sendBookingReminder(TARGET.email, MOCK_BOOKING);
    PASS(`Booking reminder → ${TARGET.email}`);
  } catch (e) { FAIL('Booking reminder email', e.message); }

  // 5d — OTP email
  try {
    await emailService.sendOTPEmail(TARGET.email, '729481');
    PASS(`OTP email (729481) → ${TARGET.email}`);
  } catch (e) { FAIL('OTP email', e.message); }
}

async function testSMS() {
  HEAD('6. SMS Stress Test (OTP + booking + reminder)');

  // 6a — OTP (real SMS dispatched!)
  try {
    const phone = await smsService.sendPasswordResetOTP(TARGET.phone);
    PASS(`OTP SMS dispatched → ${phone}  ← check your phone!`);
  } catch (e) { FAIL('OTP SMS', e.message); }

  // 6b — Booking confirmation SMS
  try {
    await smsService.sendBookingConfirmationSMS(TARGET.phone, MOCK_BOOKING);
    PASS(`Booking confirmation SMS → ${TARGET.phone}`);
  } catch (e) { FAIL('Booking confirmation SMS', e.message); }

  // 6c — Reminder SMS
  try {
    await smsService.sendBookingReminderSMS(TARGET.phone, MOCK_BOOKING);
    PASS(`Reminder SMS → ${TARGET.phone}`);
  } catch (e) { FAIL('Reminder SMS', e.message); }
}

async function testApiCenter() {
  HEAD('7. API Center Connectivity');
  try {
    const alive = await apiCenter.ping();
    if (alive) PASS(`API Center reachable: ${process.env.APICENTER_URL}`);
    else       INFO('API Center offline (services using fallbacks)');
  } catch (e) {
    INFO(`API Center ping failed: ${e.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀  PakiPark Stress Test');
  console.log(`    Account: ${TARGET.email}  |  ${TARGET.phone}`);
  console.log(`    Server:  http://localhost:${process.env.PORT || 5000}`);

  const ok = await testHealth();
  if (!ok) {
    console.error('\n❌  Server not running. Start with:  npm run dev\n');
    process.exit(1);
  }

  let token = await testRegister();
  if (!token) token = await testLoginEmail();
  await testLoginPhone();

  await testEmail();
  await testSMS();
  await testApiCenter();

  console.log('\n' + '═'.repeat(60));
  console.log('  ✅  Stress test complete!');
  console.log(`  📧  Check inbox: ${TARGET.email}`);
  console.log(`  📱  Check SMS:   ${TARGET.phone}`);
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  process.exit(1);
});
