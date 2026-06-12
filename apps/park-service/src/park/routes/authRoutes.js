const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect }  = require('../middleware/auth');
const {
  registerCustomer,
  registerAdmin,
  login,
  refresh,
  logout,
  getMe,
  requestPasswordReset,
  verifyResetOTP,
  resetPassword,
} = require('../controllers/authController');

// POST /api/auth/register/customer
router.post('/register/customer', [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  // email is optional — user may register with phone only
  body('email').optional({ nullable: true, checkFalsy: true })
    .isEmail().withMessage('Valid email address is required'),
  // phone is optional — user may register with email only
  body('phone').optional({ nullable: true, checkFalsy: true })
    .matches(/^\+63\d{10}$/).withMessage('Phone must be a valid PH number (+639XXXXXXXXX)'),
  // at least one of email or phone must be provided
  body().custom((_, { req }) => {
    if (!req.body.email && !req.body.phone) {
      throw new Error('Email or phone number is required');
    }
    return true;
  }),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate,
], registerCustomer);


// POST /api/auth/register/admin
router.post('/register/admin', [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('accessCode').notEmpty().withMessage('Admin access code is required'),
  validate,
], registerAdmin);

// GET /api/auth/check-identifier?value=<email_or_phone>
// Public — no auth needed. Returns { available: bool }
// Checks account.profiles ONLY (account schema is the source of truth)
router.get('/check-identifier', async (req, res) => {
  try {
    const { sequelize } = require('../config/db');
    const raw = (req.query.value || '').trim();
    if (!raw) return res.json({ available: true });

    const isPhone = /^\d/.test(raw) && !raw.includes('@');

    let rows;
    if (isPhone) {
      // Normalize: strip leading zeros / country code, re-add +63
      const digits   = raw.replace(/\D/g, '');
      const canonical = digits.startsWith('63')
        ? `+${digits}`
        : digits.startsWith('0')
          ? `+63${digits.slice(1)}`
          : `+63${digits}`;

      [rows] = await sequelize.query(
        `SELECT id FROM account.profiles WHERE phone = :val LIMIT 1`,
        { replacements: { val: canonical } }
      );
    } else {
      [rows] = await sequelize.query(
        `SELECT id FROM account.profiles WHERE email = :val LIMIT 1`,
        { replacements: { val: raw } }
      );
    }

    res.json({ available: rows.length === 0 });
  } catch (err) {
    console.error('[check-identifier]', err.message);
    res.status(500).json({ available: true }); // fail open
  }
});

// POST /api/auth/login
router.post('/login', [
  body('email').custom((value) => {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    const isPhone = /^\+63\d{10}$/.test(value);
    if (!isEmail && !isPhone) throw new Error('Valid email or Philippine mobile number is required');
    return true;
  }),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
], login);

// POST /api/auth/refresh  — exchange refresh token for a new access token
router.post('/refresh', [
  body('refreshToken').notEmpty().withMessage('refreshToken is required'),
  validate,
], refresh);

// POST /api/auth/logout   — invalidate refresh token server-side
router.post('/logout', [
  body('refreshToken').notEmpty().withMessage('refreshToken is required'),
  validate,
], logout);

// GET /api/auth/me
router.get('/me', protect, getMe);

// POST /api/auth/forgot-password/request
router.post('/forgot-password/request', [
  body('identifier').notEmpty().withMessage('Email or phone number is required'),
  validate,
], requestPasswordReset);

// POST /api/auth/forgot-password/verify
router.post('/forgot-password/verify', [
  body('identifier').notEmpty().withMessage('identifier is required'),
  body('otp').notEmpty().withMessage('OTP is required'),
  validate,
], verifyResetOTP);

// POST /api/auth/forgot-password/reset
router.post('/forgot-password/reset', [
  body('identifier').notEmpty().withMessage('identifier is required'),
  body('otp').notEmpty().withMessage('OTP is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate,
], resetPassword);

module.exports = router;
