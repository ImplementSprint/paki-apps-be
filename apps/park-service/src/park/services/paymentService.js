'use strict';
/**
 * paymentService.js — Payment Gateway via API Center
 * ====================================================
 * Calls the shared API Center payment endpoints:
 *   POST /shared/payment/checkout  → create checkout session
 *   GET  /shared/payment/:id       → get session status
 *   POST /shared/payment/:id/refund → refund
 *
 * Source: paki-apps-be (ImplementSprint) — tribeClient.paymentCreateCheckoutSession()
 *
 * Falls back gracefully when API Center is unreachable (development mode).
 */

const apiCenter = require('../config/apiCenterClient');

// ── Create Checkout Session ───────────────────────────────────────────────────

/**
 * Create a GCash / PayMaya checkout session via the API Center payment gateway.
 *
 * @param {object} opts
 * @param {number}  opts.amount        Amount in PHP (e.g. 150.00)
 * @param {string}  opts.referenceId   PakiPark booking reference (e.g. "PKP-00000001")
 * @param {string}  opts.description   Human-readable description
 * @param {string}  [opts.currency]    Default "PHP"
 * @param {string}  [opts.successUrl]  Redirect after successful payment
 * @param {string}  [opts.cancelUrl]   Redirect after cancelled payment
 * @param {string}  [opts.method]      "GCash" | "PayMaya" | "card" | etc.
 * @returns {Promise<{ sessionId, checkoutUrl, status, expiresAt }>}
 */
const createCheckoutSession = async ({
  amount,
  referenceId,
  description,
  currency    = 'PHP',
  successUrl  = process.env.CLIENT_URL + '/booking/success',
  cancelUrl   = process.env.CLIENT_URL + '/booking/cancel',
  method      = 'GCash',
}) => {
  console.log(`[Payment] Creating checkout session | ref: ${referenceId} | ₱${amount}`);

  try {
    const idempotencyKey = `checkout-${referenceId}-${Date.now()}`;
    const requestBody = {
      referenceId,
      idempotencyKey,
      successUrl,
      cancelUrl,
      paymentMethods: [method.toLowerCase()],
      lineItems: [
        {
          name: description || 'PakiPark Parking Reservation',
          quantity: 1,
          amount: { value: Math.round(amount * 100), currency }
        }
      ]
    };

    if (process.env.PAYMONGO_SECRET_KEY && process.env.PAYMONGO_PUBLIC_KEY) {
      requestBody.paymongoSecretKey = process.env.PAYMONGO_SECRET_KEY;
      requestBody.paymongoPublicKey = process.env.PAYMONGO_PUBLIC_KEY;
      requestBody.credentials = {
        secretKey: process.env.PAYMONGO_SECRET_KEY,
        publicKey: process.env.PAYMONGO_PUBLIC_KEY
      };
    }

    const response = await apiCenter.post('/shared/payment/checkout/sessions', requestBody);
    const payload = response.data || response;

    console.log(`[Payment] ✅ Session created: ${payload.checkoutId || payload.id}`);
    return {
      sessionId:   payload.checkoutId  || payload.id,
      checkoutUrl: payload.redirectUrl || payload.url || payload.checkout_url,
      status:      payload.status      || 'pending',
      expiresAt:   payload.expiresAt   || payload.expires_at || null,
    };
  } catch (err) {
    console.error('[Payment] API Center checkout failed:', err.message);
    // Dev fallback — return mock session so booking flow isn't blocked
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Payment] ⚠️  Using mock payment session (dev mode)');
      return {
        sessionId:   `mock-${referenceId}-${Date.now()}`,
        checkoutUrl: `${process.env.CLIENT_URL || 'http://localhost:3000'}/mock-payment?ref=${referenceId}&amount=${amount}`,
        status:      'pending',
        expiresAt:   new Date(Date.now() + 30 * 60_000).toISOString(),
        isMock:      true,
      };
    }
    throw new Error('Payment gateway unavailable. Please try again shortly.');
  }
};

// ── Get Payment Status ────────────────────────────────────────────────────────

/**
 * Retrieve the status of a checkout session.
 * @param {string} sessionId  The session ID returned by createCheckoutSession()
 * @returns {Promise<{ sessionId, status, amount, paidAt }>}
 */
const getPaymentStatus = async (sessionId) => {
  console.log(`[Payment] Getting status for session: ${sessionId}`);

  if (sessionId.startsWith('mock-')) {
    return { sessionId, status: 'paid', amount: 0, paidAt: new Date().toISOString(), isMock: true };
  }

  try {
    const response = await apiCenter.get(`/shared/payment/checkout/sessions/${sessionId}`);
    const payload = response.data || response;
    const rawAmount = payload.amount && typeof payload.amount === 'object' ? payload.amount.value : payload.amount;
    return {
      sessionId,
      status:  payload.status,
      amount:  (rawAmount || 0) / 100, // convert centavos → PHP
      paidAt:  payload.paidAt || payload.paid_at || null,
    };
  } catch (err) {
    console.error('[Payment] Status fetch failed:', err.message);
    throw new Error('Unable to retrieve payment status.');
  }
};

// ── Refund ────────────────────────────────────────────────────────────────────

/**
 * Issue a full or partial refund.
 * @param {string} sessionId  The original checkout session ID
 * @param {number} [amount]   PHP amount to refund. Omit for full refund.
 * @param {string} [reason]   Reason string for the refund log
 * @returns {Promise<{ refundId, status, amount }>}
 */
const refundPayment = async (sessionId, amount, reason = 'Customer request') => {
  console.log(`[Payment] Refund | session: ${sessionId} | amount: ${amount ?? 'full'}`);

  if (sessionId.startsWith('mock-')) {
    return { refundId: `mock-refund-${Date.now()}`, status: 'refunded', amount: amount || 0, isMock: true };
  }

  try {
    const body = { reason };
    if (amount !== undefined) body.amount = Math.round(amount * 100); // centavos

    const response = await apiCenter.post(`/shared/payment/checkout/sessions/${sessionId}/refund`, body);
    const payload = response.data || response;
    const rawAmount = payload.amount && typeof payload.amount === 'object' ? payload.amount.value : payload.amount;
    return {
      refundId: payload.refundId || payload.id,
      status:   payload.status || 'refunded',
      amount:   (rawAmount || 0) / 100,
    };
  } catch (err) {
    console.warn('[Payment] API Center refund failed:', err.message);
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Payment] ⚠️  Falling back to mock refund in development');
      return {
        refundId: `mock-refund-${Date.now()}`,
        status:   'refunded',
        amount:   amount || 0,
        isMock:   true
      };
    }
    throw new Error('Refund request failed. Please contact support.');
  }
};

module.exports = { createCheckoutSession, getPaymentStatus, refundPayment };
