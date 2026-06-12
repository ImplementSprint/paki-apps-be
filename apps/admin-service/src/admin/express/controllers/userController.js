'use strict';
/**
 * userController.js
 * =================
 * Handles profile management, verification, discount requests, 2FA.
 *
 * After the Supabase Auth migration:
 *   - req.user is a plain object from raw SQL (account.users row)
 *   - req.user.authId is the uuid linking to auth.users
 *   - passwords live in auth.users — use supabase.auth.admin.updateUserById()
 *   - profile columns (name, phone, address, etc.) live in account.users
 */

const crypto  = require('crypto');
const { sequelize }       = require('../config/db');
const { getSupabaseClient } = require('../config/supabaseClient');
const notificationService = require('../services/notificationService');

// ── Helpers ───────────────────────────────────────────────────────────────────

const PH_PHONE_RE = /^(\+639|09)\d{9}$/;
const filled      = (v) => typeof v === 'string' && v.trim().length > 0;
const addressFilled = (addr) => {
  if (!addr) return false;
  if (typeof addr === 'string') return addr.trim().length > 0;
  return filled(addr.street) || filled(addr.city);
};

function shouldBeVerified(user) {
  const phoneOk = PH_PHONE_RE.test((user.phone || '').trim());
  const dobOk   = filled(user.dateOfBirth);
  const addrOk  = addressFilled(user.address);
  return phoneOk && dobOk && addrOk;
}

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

/** Fetch a fresh account.users row by id (integer PK) */
async function findUserById(id) {
  const [rows] = await sequelize.query(
    `SELECT * FROM account.users WHERE id = :id LIMIT 1`,
    { replacements: { id } },
  );
  return rows[0] || null;
}

/** Update account.users columns by id */
async function updateUserById(id, updates) {
  const setClauses = Object.keys(updates)
    .map((k) => `"${k}" = :${k}`)
    .join(', ');
  const replacements = { id, ...updates };
  await sequelize.query(
    `UPDATE account.users SET ${setClauses}, "updatedAt" = now() WHERE id = :id`,
    { replacements },
  );
  return findUserById(id);
}

/** Strip internal columns before sending to client */
function toPublic(row) {
  if (!row) return null;
  const { twoFactorSecret, password, ...rest } = row;
  rest._id = String(rest.id);
  return rest;
}

// ── GET /api/users/profile ────────────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: toPublic(user) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── PUT /api/users/profile ────────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const allowed = ['name', 'phone', 'address', 'dateOfBirth', 'profilePicture', 'preferences'];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const merged = { ...user, ...updates };
    updates.isVerified = shouldBeVerified(merged);

    const updated = await updateUserById(req.user.id, updates);

    // Also update name in Supabase auth.users metadata so it stays in sync
    if (updates.name && req.user.authId) {
      await getSupabaseClient()
        .auth.admin.updateUserById(req.user.authId, {
          user_metadata: { name: updates.name },
        })
        .catch(() => null); // non-fatal
    }

    res.json({ success: true, data: toPublic(updated), isVerified: updated.isVerified });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ── PUT /api/users/password ───────────────────────────────────────────────────
// Password lives in Supabase auth.users — we re-authenticate then update.
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }

    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Verify current password by attempting a sign-in
    const supabase = getSupabaseClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (signInErr) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    // Update password in auth.users
    const { error: updateErr } = await supabase.auth.admin.updateUserById(req.user.authId, {
      password: newPassword,
    });
    if (updateErr) throw new Error(updateErr.message);

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /api/users/discount-request ─────────────────────────────────────────
const submitDiscountRequest = async (req, res) => {
  try {
    const { discountIdUrl, discountType } = req.body;
    if (!discountIdUrl) {
      return res.status(400).json({ success: false, message: 'discountIdUrl is required' });
    }
    const validTypes = ['PWD', 'senior_citizen'];
    if (discountType && !validTypes.includes(discountType)) {
      return res.status(400).json({ success: false, message: 'discountType must be PWD or senior_citizen' });
    }

    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.discountStatus === 'approved') {
      return res.status(400).json({ success: false, message: 'Your discount is already approved' });
    }

    const updated = await updateUserById(req.user.id, {
      discountStatus: 'pending',
      discountIdUrl,
      discountType: discountType || 'PWD',
    });

    res.json({ success: true, message: 'Discount ID submitted for admin review', data: toPublic(updated) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ── PATCH /api/users/:id/discount ─────────────────────────────────────────────
const reviewDiscountRequest = async (req, res) => {
  try {
    if (!['admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const { action } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: "action must be 'approve' or 'reject'" });
    }

    const user = await findUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.discountStatus !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending discount request for this user' });
    }

    const updates = action === 'approve'
      ? { discountStatus: 'approved', discountPct: 20 }
      : { discountStatus: 'rejected', discountPct: 0 };

    const updated = await updateUserById(req.params.id, updates);

    if (action === 'approve') {
      notificationService.notifyDiscountApproved(user.id);
    } else {
      notificationService.notifyDiscountRejected(user.id, 'Please upload a clearer, valid PWD or Senior Citizen ID.');
    }

    res.json({
      success: true,
      message: action === 'approve' ? 'Discount approved — user now receives 20% off' : 'Discount request rejected',
      data: toPublic(updated),
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ── GET /api/users/pending-discounts ─────────────────────────────────────────
const getPendingDiscounts = async (req, res) => {
  try {
    if (!['admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const [rows] = await sequelize.query(
      `SELECT * FROM account.users WHERE "discountStatus" = 'pending' ORDER BY "createdAt" DESC`,
    );
    res.json({ success: true, data: rows.map(toPublic) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /api/users/2fa/setup ─────────────────────────────────────────────────
const setup2FA = async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.twoFactorEnabled) {
      return res.status(400).json({ success: false, message: '2FA is already enabled' });
    }

    const secret = base32Encode(crypto.randomBytes(20));
    await updateUserById(req.user.id, { twoFactorSecret: secret, twoFactorEnabled: false });

    const issuer  = 'PakiPark';
    const account = encodeURIComponent(user.email);
    const otpUri  = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

    res.json({
      success: true,
      data: { secret, otpUri, message: 'Scan the QR code with your authenticator app, then verify with POST /api/users/2fa/verify' },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /api/users/2fa/verify ────────────────────────────────────────────────
const verify2FA = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'TOTP code is required' });

    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const secret = user.twoFactorSecret;
    if (!secret) {
      return res.status(400).json({ success: false, message: 'Run 2FA setup first' });
    }

    if (!verifyTOTP(secret, code.trim())) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code. Try again.' });
    }

    await updateUserById(req.user.id, { twoFactorEnabled: true });
    res.json({ success: true, message: '2FA enabled successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /api/users/2fa/disable ───────────────────────────────────────────────
const disable2FA = async (req, res) => {
  try {
    const { password } = req.body;
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Verify via Supabase (password lives in auth.users now)
    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email: user.email,
      password: password || '',
    });
    if (error) return res.status(400).json({ success: false, message: 'Incorrect password' });

    await updateUserById(req.user.id, { twoFactorEnabled: false, twoFactorSecret: null });
    res.json({ success: true, message: '2FA disabled' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/users ────────────────────────────────────────────────────────────
const getAllUsers = async (req, res) => {
  try {
    if (!['admin', 'teller', 'business_partner'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Staff access required' });
    }
    const [rows] = await sequelize.query(
      `SELECT * FROM account.users ORDER BY "createdAt" DESC`,
    );
    res.json({ success: true, data: rows.map(toPublic) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── DELETE /api/users/account ─────────────────────────────────────────────────
const deleteAccount = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: 'Password is required to delete account' });

    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email: user.email, password,
    });
    if (error) return res.status(400).json({ success: false, message: 'Incorrect password' });

    await updateUserById(req.user.id, { deletedAt: new Date().toISOString() });
    res.json({ success: true, message: 'Account scheduled for deletion. You have been logged out.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── TOTP helpers ──────────────────────────────────────────────────────────────
function verifyTOTP(secret, token) {
  const window  = 1;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (generateTOTP(secret, counter + i) === token) return true;
  }
  return false;
}
function generateTOTP(secret, counter) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c >>= 8; }
  const hmac  = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code  = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
}
function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.toUpperCase().replace(/=+$/, '');
  let bits = 0, val = 0;
  const out = [];
  for (const ch of s) {
    val = (val << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((val >> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

module.exports = {
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
};
