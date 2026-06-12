const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const {
  getProfile,
  updateProfile,
  changePassword,
  deleteAccount,
  submitDiscountRequest,
  reviewDiscountRequest,
  getPendingDiscounts,
  setup2FA,
  verify2FA,
  disable2FA,
  getAllUsers,
} = require('../controllers/userController');

// ── Customer profile ──────────────────────────────────────────────────────────
router.get('/profile',         protect, getProfile);
router.put('/profile',         protect, updateProfile);
router.put('/password',        protect, changePassword);
router.delete('/account',      protect, deleteAccount);  // soft-delete own account

// ── Special discount (PWD / Senior Citizen) ───────────────────────────────────
router.post('/discount-request',        protect, submitDiscountRequest);   // customer uploads ID
router.get('/pending-discounts',        protect, getPendingDiscounts);     // admin: list pending
router.patch('/:id/discount',           protect, reviewDiscountRequest);   // admin: approve/reject

// ── Two-Factor Authentication ─────────────────────────────────────────────────
router.post('/2fa/setup',    protect, setup2FA);    // generate TOTP secret + QR URI
router.post('/2fa/verify',   protect, verify2FA);   // confirm code → enables 2FA
router.post('/2fa/disable',  protect, disable2FA);  // password-gated disable

// ── Admin: all users ──────────────────────────────────────────────────────────
router.get('/', protect, getAllUsers);

module.exports = router;
