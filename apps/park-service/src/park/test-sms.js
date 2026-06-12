/**
 * Run: node test-sms.js <your_phone_number>
 * Example: node test-sms.js 09663261949
 * 
 * This directly calls the Semaphore OTP endpoint and shows the full response.
 */
'use strict';
const https       = require('https');
const querystring = require('querystring');

const API_KEY    = 'd0c375d93cc808585b98e5069183d92e';
const SENDER     = 'Semaphore'; // Must be proper case — 'SEMAPHORE' returns HTTP 500
const rawPhone   = process.argv[2] || '09000000000';

// Normalize to 09XXXXXXXXX
let d = rawPhone.replace(/\D/g, '');
if (d.startsWith('63')) d = d.slice(2);
if (d.startsWith('0'))  d = d.slice(1);
const phone = `0${d}`;
const otp   = '123456'; // test OTP

console.log(`\n📱 Testing Semaphore OTP API`);
console.log(`   Phone  : ${phone}`);
console.log(`   OTP    : ${otp}`);
console.log(`   API Key: ${API_KEY.slice(0,8)}...`);
console.log(`   Host   : api.semaphore.co/api/v4/otp\n`);

const body = querystring.stringify({
  apikey:  API_KEY,
  number:  phone,
  message: 'Your PakiPark test code is: {otp}. Do not share this.',
  code:    otp,
  // sendername intentionally omitted — defaults to Semaphore's own default
});

const req = https.request({
  hostname: 'api.semaphore.co',
  path:     '/api/v4/otp',
  method:   'POST',
  headers: {
    'Content-Type':   'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log(`HTTP Status: ${res.statusCode}`);
    try {
      const json = JSON.parse(data);
      console.log('Response:', JSON.stringify(json, null, 2));
      if (Array.isArray(json) && json[0]?.status) {
        console.log(`\n✅ Status: ${json[0].status} | Network: ${json[0].network}`);
      }
    } catch {
      console.log('Raw response:', data);
    }
  });
});

req.on('error', e => console.error('❌ Network error:', e.message));
req.write(body);
req.end();
