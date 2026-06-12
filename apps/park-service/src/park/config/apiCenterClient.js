'use strict';
/**
 * apiCenterClient.js — API Center SDK (Express/CommonJS port)
 * ============================================================
 * Adapted from paki-apps-be (ImplementSprint/paki-apps-be) NestJS template.
 * Authenticates with the shared API Center gateway using tribe credentials,
 * caches the short-lived token, and provides get/post helpers used by
 * emailService, smsService, and paymentService.
 *
 * Env vars required:
 *   APICENTER_URL          — https://api-center-test.itsandbox.site
 *   APICENTER_TRIBE_ID     — pakiapps
 *   APICENTER_TRIBE_SECRET — (secret)
 *   APICENTER_TIMEOUT_MS   — optional, default 10000
 */

const https   = require('https');
const http    = require('http');
const { URL } = require('url');
const crypto  = require('crypto');

const BASE_URL  = (process.env.APICENTER_URL || 'https://api-center-test.ittsandbox.site').replace(/\/$/, '');
const TRIBE_ID  = process.env.APICENTER_TRIBE_ID     || 'pakiapps';
const SECRET    = process.env.APICENTER_TRIBE_SECRET  || '';
const TIMEOUT   = parseInt(process.env.APICENTER_TIMEOUT_MS || '10000', 10);

// ── Token cache ───────────────────────────────────────────────────────────────
let _token          = null;
let _tokenExpiresAt = 0;

/**
 * Obtain (or return cached) short-lived bearer token from API Center.
 * POST /auth/token  { tribeId, secret }
 */
async function getToken() {
  if (_token && Date.now() < _tokenExpiresAt - 30_000) return _token;

  const res = await _request('POST', '/auth/token', { tribeId: TRIBE_ID, secret: SECRET }, null);
  const dataObj   = res.data || res;
  _token          = dataObj.accessToken || dataObj.token || dataObj.access_token;
  // Default TTL = 55 min if server doesn't tell us
  const ttl       = (dataObj.expiresIn || dataObj.expires_in || 3600) * 1000;
  _tokenExpiresAt = Date.now() + ttl;
  console.log(`[ApiCenter] ✅ Token obtained (expires in ${Math.round(ttl / 60_000)} min)`);
  return _token;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

/**
 * Internal raw HTTP/HTTPS request.
 * @param {string} method  GET | POST | PUT | PATCH | DELETE
 * @param {string} path    e.g. /shared/email/send
 * @param {object|null} body JSON body (POST/PUT)
 * @param {string|null} token Bearer token (null for auth call)
 * @returns {Promise<object>} parsed JSON response
 */
function _rawRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const parsed    = new URL(BASE_URL + _normalisePath(path));
    const isHttps   = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const correlationId = crypto.randomUUID();

    const bodyStr = body ? JSON.stringify(body) : null;

    const headers = {
      'Content-Type':      'application/json',
      'X-Correlation-ID':  correlationId,
      'X-SDK-Version':     '1.1.2',
      'X-SDK-Tribe-Id':    TRIBE_ID,
    };
    if (bodyStr)  headers['Content-Length'] = Buffer.byteLength(bodyStr);
    if (token)    headers['Authorization']  = `Bearer ${token}`;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers,
      timeout: TIMEOUT,
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsedRes = JSON.parse(data);
          if (res.statusCode >= 400) {
            const errorObj = parsedRes.error || parsedRes.message || parsedRes;
            const msg = typeof errorObj === 'object' ? JSON.stringify(errorObj) : errorObj;
            const err = new Error(`[ApiCenter] ${method} ${path} → ${res.statusCode}: ${msg}`);
            err.statusCode = res.statusCode;
            return reject(err);
          }
          resolve(parsedRes);
        } catch {
          if (res.statusCode >= 400) {
            const err = new Error(`[ApiCenter] HTTP ${res.statusCode}`);
            err.statusCode = res.statusCode;
            return reject(err);
          }
          resolve({ raw: data });
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('[ApiCenter] Request timed out')); });
    req.on('error', reject);

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Retrying wrapper for the API Center requests.
 */
async function _request(method, path, body = null, token = null) {
  let attempt = 0;
  const maxAttempts = 5;
  let delay = 600; // ms

  while (attempt < maxAttempts) {
    try {
      return await _rawRequest(method, path, body, token);
    } catch (err) {
      attempt++;
      const isRateLimit = err.statusCode === 429 || 
                          (err.statusCode === 502 && err.message && (err.message.includes('Too many requests') || err.message.includes('rate limit')));
      if (isRateLimit && attempt < maxAttempts) {
        console.warn(`[ApiCenter] Rate limit hit (attempt ${attempt}/${maxAttempts}). Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2; // exponential backoff
      } else {
        throw err;
      }
    }
  }
}

/** Normalise API Center path prefixes per the SDK convention. */
function _normalisePath(path) {
  if (!path.startsWith('/')) path = '/' + path;
  // The SDK auto-prefixes /tribes, /shared, /external, /auth, /registry, /health → /api/v1/...
  const AUTO_PREFIXES = ['/tribes', '/shared', '/external', '/auth', '/registry', '/health'];
  if (AUTO_PREFIXES.some(p => path.startsWith(p))) {
    return '/api/v1' + path;
  }
  return path;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Authenticated GET request to the API Center.
 */
async function get(path) {
  const token = await getToken();
  return _request('GET', path, null, token);
}

/**
 * Authenticated POST request to the API Center.
 */
async function post(path, body) {
  const token = await getToken();
  return _request('POST', path, body, token);
}

/**
 * Health check — returns true if API Center is reachable.
 */
async function ping() {
  try {
    await _request('GET', '/health', null, null);
    return true;
  } catch {
    return false;
  }
}

module.exports = { get, post, ping, getToken };
