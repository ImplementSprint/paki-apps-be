'use strict';
/**
 * smsService.js — API Center + Semaphore fallback
 * =================================================
 * OTP store is an in-memory Map keyed by canonical identifier
 * (either +63XXXXXXXXXX for phone or lowercased email address).
 * Each entry expires after OTP_TTL_MS.
 */

const https       = require('https');
const querystring = require('querystring');
const apiCenter   = require('../config/apiCenterClient');

const SEMAPHORE_API_KEY = process.env.SEMAPHORE_API_KEY || 'd0c375d93cc808585b98e5069183d92e';
const SEMAPHORE_SENDER  = process.env.SEMAPHORE_SENDER  || 'Semaphore';
const OTP_TTL_MS        = 10 * 60 * 1000; // 10 minutes

// ── In-memory OTP store ───────────────────────────────────────────────────────
const otpStore = new Map();

// ── Phone helpers ─────────────────────────────────────────────────────────────

/** Internal canonical key: +63XXXXXXXXXX */
function normPhone(raw = '') {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('63')) d = d.slice(2);
  if (d.startsWith('0'))  d = d.slice(1);
  return `+63${d}`;
}

/** Format for Semaphore API: 09XXXXXXXXX */
function semaphorePhone(raw = '') {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('63')) d = d.slice(2);
  if (d.startsWith('0'))  d = d.slice(1);
  return `0${d}`;
}

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── Semaphore HTTP helpers ────────────────────────────────────────────────────

function _semaphoreRequest(path, params) {
  return new Promise((resolve, reject) => {
    const body    = querystring.stringify(params);
    const options = {
      hostname: 'api.semaphore.co',
      path,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try   { resolve({ statusCode: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ statusCode: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function _semaphoreOTP(number, otp) {
  return _semaphoreRequest('/api/v4/otp', {
    apikey:     SEMAPHORE_API_KEY,
    number,
    message:    'Your PakiPark verification code is: {otp}. Valid for 10 minutes. Do not share this code.',
    code:       otp,
    sendername: SEMAPHORE_SENDER,
  });
}

async function _semaphoreMessage(number, message) {
  return _semaphoreRequest('/api/v4/messages', {
    apikey:     SEMAPHORE_API_KEY,
    number,
    message,
    sendername: SEMAPHORE_SENDER,
  });
}

// ── Primary: API Center SMS ───────────────────────────────────────────────────

const sendSMS = async (rawPhone, message, type = 'notification') => {
  const canonical = normPhone(rawPhone);
  try {
    await apiCenter.post('/shared/sms/send', { 
      to: canonical, 
      message, 
      metadata: { purpose: type, sender: 'PakiPark' } 
    });
    console.log(`[SMS] ✅ Sent via API Center → ${canonical}`);
    return;
  } catch (apErr) {
    console.warn(`[SMS] API Center failed (${apErr.message}), falling back to Semaphore`);
  }
  const smsNum = semaphorePhone(rawPhone);
  try {
    const result = await _semaphoreMessage(smsNum, message);
    if (result.statusCode < 200 || result.statusCode >= 300) throw new Error(`Semaphore HTTP ${result.statusCode}`);
    console.log(`[SMS] ✅ Sent via Semaphore → ${smsNum}`);
  } catch (semErr) {
    console.error('[SMS] Semaphore send failed:', semErr.message);
    throw new Error('SMS delivery failed. Please try again.');
  }
};

// ── OTP Flow (SMS — phone) ────────────────────────────────────────────────────

async function sendPasswordResetOTP(rawPhone) {
  const phone  = normPhone(rawPhone);
  const smsNum = semaphorePhone(rawPhone);
  const otp    = generateOTP();

  otpStore.set(phone, { otp, expiresAt: Date.now() + OTP_TTL_MS });

  let sent = false;
  try {
    await apiCenter.post('/shared/sms/send', {
      to: phone,
      message: `Your PakiPark password reset code is: ${otp}. Valid for 10 minutes. Do not share this code.`,
      metadata: { purpose: 'otp', sender: 'PakiPark' }
    });
    console.log(`[SMS] ✅ OTP sent via API Center → ${phone}`);
    sent = true;
  } catch (apErr) {
    console.warn(`[SMS] API Center OTP failed (${apErr.message}), trying Semaphore`);
  }

  if (!sent) {
    let result;
    try { result = await _semaphoreOTP(smsNum, otp); }
    catch (err) { otpStore.delete(phone); throw new Error('Failed to send OTP. Please try again.'); }

    if (result.statusCode < 200 || result.statusCode >= 300) {
      otpStore.delete(phone);
      throw new Error(`SMS gateway error: ${result.body?.message || `HTTP ${result.statusCode}`}`);
    }
    if (result.body && !Array.isArray(result.body) && result.body.status === 'error') {
      otpStore.delete(phone);
      throw new Error(`SMS gateway error: ${result.body.message || 'Unknown error'}`);
    }
    console.log(`[SMS] ✅ OTP sent via Semaphore → ${smsNum}`);
  }
  return phone;
}

// ── OTP Flow (Email) ──────────────────────────────────────────────────────────

/**
 * Generate and send a 6-digit OTP to the given email address.
 * Returns the lowercased email (used as the OTP store key).
 */
async function sendPasswordResetOTPByEmail(rawEmail) {
  const emailService = require('./emailService');
  const email = rawEmail.trim().toLowerCase();
  const otp   = generateOTP();

  otpStore.set(email, { otp, expiresAt: Date.now() + OTP_TTL_MS });
  
  console.log(`\n================================`);
  console.log(`🔑 DEV OTP FOR ${email}: ${otp}`);
  console.log(`================================\n`);

  try {
    await emailService.sendOTPEmail(email, otp);
    console.log(`[Email] ✅ OTP sent → ${email}`);
  } catch (err) {
    otpStore.delete(email);
    throw new Error('Failed to send OTP email. Please try again.');
  }
  return email;
}

// ── Booking SMS helpers ───────────────────────────────────────────────────────

const sendBookingConfirmationSMS = async (rawPhone, bookingData) => {
  const message = `PakiPark: Booking confirmed! Ref: ${bookingData.reference}. ${bookingData.locationName} - Spot ${bookingData.spot} on ${bookingData.date} at ${bookingData.timeSlot}. Amount: PHP ${Number(bookingData.amount).toFixed(2)}.`;
  await sendSMS(rawPhone, message, 'notification');
};

const sendBookingReminderSMS = async (rawPhone, bookingData) => {
  const message = `PakiPark Reminder: Your parking at ${bookingData.locationName} (Spot ${bookingData.spot}) starts ${bookingData.timeSlot} on ${bookingData.date}. Ref: ${bookingData.reference}.`;
  await sendSMS(rawPhone, message, 'notification');
};

const sendOvertimeWarningSMS = async (rawPhone, bookingData) => {
  const message = `PakiPark Warning: Your free parking at ${bookingData.locationName} (Spot ${bookingData.spot}) expires in 15 mins. Pls check out to avoid PHP 15/hr charge. Ref: ${bookingData.reference}.`;
  await sendSMS(rawPhone, message, 'notification');
};

const sendOvertimeConsumedSMS = async (rawPhone, bookingData) => {
  const message = `PakiPark Notice: Free parking at ${bookingData.locationName} (Spot ${bookingData.spot}) consumed. Overtime charge of PHP 15/hr applies. Ref: ${bookingData.reference}.`;
  await sendSMS(rawPhone, message, 'notification');
};

// ── OTP Verification (works for both phone and email) ─────────────────────────

function _key(identifier) {
  return identifier.includes('@') ? identifier.trim().toLowerCase() : normPhone(identifier);
}

function verifyOTP(identifier, inputOtp) {
  const key    = _key(identifier);
  const record = otpStore.get(key);
  if (!record) throw new Error('No OTP was sent to this contact, or it has already expired.');
  if (Date.now() > record.expiresAt) { otpStore.delete(key); throw new Error('OTP has expired. Please request a new one.'); }
  if (record.otp !== String(inputOtp).trim()) throw new Error('Incorrect code. Please try again.');
  otpStore.set(key, { ...record, verified: true });
  return true;
}

function consumeOTP(identifier) { otpStore.delete(_key(identifier)); }

function isVerified(identifier) {
  const record = otpStore.get(_key(identifier));
  return !!(record && record.verified);
}

module.exports = {
  sendSMS,
  sendPasswordResetOTP,
  sendPasswordResetOTPByEmail,
  sendBookingConfirmationSMS,
  sendBookingReminderSMS,
  sendOvertimeWarningSMS,
  sendOvertimeConsumedSMS,
  verifyOTP,
  consumeOTP,
  isVerified,
  normPhone,
};
