'use strict';
/**
 * paymentRoutes.js — Payment Gateway API routes
 * ===============================================
 * Connects to the API Center shared payment gateway.
 * All routes require authentication (authMiddleware).
 *
 * POST /api/payment/checkout       — create a checkout session
 * GET  /api/payment/:sessionId     — get payment status
 * POST /api/payment/:sessionId/refund — issue a refund (admin/teller only)
 */

const express        = require('express');
const router         = express.Router();
const paymentService = require('../services/paymentService');
const { authenticate, requireRole } = require('../middleware/auth');

// ── POST /api/payment/checkout ────────────────────────────────────────────────
router.post('/checkout', authenticate, async (req, res) => {
  try {
    const {
      amount,
      referenceId,
      description,
      currency,
      successUrl,
      cancelUrl,
      method,
    } = req.body;

    if (!amount || !referenceId) {
      return res.status(400).json({ success: false, message: 'amount and referenceId are required' });
    }

    const session = await paymentService.createCheckoutSession({
      amount:      Number(amount),
      referenceId: String(referenceId),
      description: description || `PakiPark booking ${referenceId}`,
      currency,
      successUrl,
      cancelUrl,
      method,
    });

    res.json({ success: true, data: session });
  } catch (err) {
    console.error('[Route] POST /payment/checkout:', err.message);
    res.status(502).json({ success: false, message: err.message });
  }
});

// ── GET /api/payment/:sessionId ───────────────────────────────────────────────
router.get('/:sessionId', authenticate, async (req, res) => {
  try {
    const status = await paymentService.getPaymentStatus(req.params.sessionId);
    res.json({ success: true, data: status });
  } catch (err) {
    console.error('[Route] GET /payment/:sessionId:', err.message);
    res.status(502).json({ success: false, message: err.message });
  }
});

// ── POST /api/payment/:sessionId/refund ──────────────────────────────────────
router.post('/:sessionId/refund', authenticate, requireRole(['admin', 'teller']), async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const result = await paymentService.refundPayment(req.params.sessionId, amount ? Number(amount) : undefined, reason);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Route] POST /payment/:sessionId/refund:', err.message);
    res.status(502).json({ success: false, message: err.message });
  }
});

module.exports = router;
