const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect }  = require('../middleware/auth');
const {
  registerCustomer,
  registerAdmin,
  registerStaff,
  login,
  refresh,
  logout,
  getMe,
} = require('../controllers/authController');

// POST /api/auth/register/customer
router.post('/register/customer', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate,
], registerCustomer);

// POST /api/auth/register/admin
router.post('/register/admin', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('accessCode').notEmpty().withMessage('Admin access code is required'),
  validate,
], registerAdmin);

// POST /api/auth/register/staff
router.post('/register/staff', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('role').notEmpty().withMessage('Role is required'),
  validate,
], registerStaff);

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
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

module.exports = router;
