'use strict';
const authService = require('../services/authService');
const smsService  = require('../services/smsService');
const { sequelize } = require('../config/db');
const { getSupabaseClient } = require('../config/supabaseClient');

// POST /api/auth/register/customer
const registerCustomer = async (req, res) => {
  try {
    const user = await authService.registerCustomer(req.body);
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// POST /api/auth/register/admin
const registerAdmin = async (req, res) => {
  try {
    const user = await authService.registerAdmin(req.body);
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const user = await authService.loginUser(req.body);
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(401).json({ success: false, message: error.message });
  }
};

// POST /api/auth/refresh
const refresh = async (req, res) => {
  try {
    const tokens = await authService.refreshToken(req.body);
    res.json({ success: true, data: tokens });
  } catch (error) {
    res.status(401).json({ success: false, message: error.message });
  }
};

// POST /api/auth/logout
const logout = async (req, res) => {
  try {
    await authService.logoutUser(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  res.json({ success: true, data: req.user });
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function isEmailIdentifier(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Look up a user in account.profiles by phone or email.
 * Returns { id, supabaseId } or null.
 */
async function findUserByIdentifier(identifier) {
  if (isEmailIdentifier(identifier)) {
    const [rows] = await sequelize.query(
      `SELECT id, id AS "supabaseId" FROM account.profiles WHERE email = :val LIMIT 1`,
      { replacements: { val: identifier.trim().toLowerCase() } }
    );
    return rows[0] || null;
  }
  const canonical = smsService.normPhone(identifier);
  const [rows] = await sequelize.query(
    `SELECT id, id AS "supabaseId" FROM account.profiles WHERE phone = :val LIMIT 1`,
    { replacements: { val: canonical } }
  );
  return rows[0] || null;
}

// ── POST /api/auth/forgot-password/request ────────────────────────────────────
// Body: { identifier }  — email OR phone number
const requestPasswordReset = async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Email or phone number is required.' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) {
      // Generic message to prevent user enumeration
      return res.json({ success: true, message: 'If that account exists, a code has been sent.' });
    }

    if (isEmailIdentifier(identifier)) {
      await smsService.sendPasswordResetOTPByEmail(identifier);
      res.json({ success: true, message: `OTP sent to ${identifier.trim().toLowerCase()}`, channel: 'email' });
    } else {
      const canonical = await smsService.sendPasswordResetOTP(identifier);
      res.json({ success: true, message: `OTP sent to ${canonical}`, channel: 'sms' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/auth/forgot-password/verify ─────────────────────────────────────
// Body: { identifier, otp }
const verifyResetOTP = async (req, res) => {
  try {
    const { identifier, otp } = req.body;
    if (!identifier || !otp) {
      return res.status(400).json({ success: false, message: 'identifier and otp are required.' });
    }
    smsService.verifyOTP(identifier, otp);
    res.json({ success: true, message: 'OTP verified. You may now reset your password.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ── POST /api/auth/forgot-password/reset ──────────────────────────────────────
// Body: { identifier, otp, newPassword }
const resetPassword = async (req, res) => {
  try {
    const { identifier, otp, newPassword } = req.body;
    if (!identifier || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'identifier, otp, and newPassword are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }

    if (!smsService.isVerified(identifier)) {
      return res.status(400).json({ success: false, message: 'OTP not verified. Please verify your code first.' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!user.supabaseId) {
      return res.status(400).json({ success: false, message: 'Account not linked to auth system. Contact support.' });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.admin.updateUserById(user.supabaseId, { password: newPassword });
    if (error) throw new Error(error.message);

    smsService.consumeOTP(identifier);
    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  registerCustomer, registerAdmin, login, refresh, logout, getMe,
  requestPasswordReset, verifyResetOTP, resetPassword,
};
