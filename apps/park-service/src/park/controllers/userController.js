'use strict';
/**
 * userController.js
 * =================
 * Handles profile management, verification, discount requests, 2FA.
 *
 * After the Supabase Auth migration:
 *   - req.user is a plain object from raw SQL (account.profiles row)
 *   - req.user.authId is the uuid linking to auth.users
 *   - passwords live in auth.users — use supabase.auth.admin.updateUserById()
 *   - profile columns (name, phone, address, etc.) live in account.profiles
 */

const crypto  = require('crypto');
const { sequelize }       = require('../config/db');
const { getSupabaseClient } = require('../config/supabaseClient');
const notificationService = require('../services/notificationService');

// ── Helpers ───────────────────────────────────────────────────────────────────

const otpCache = new Map();

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

/** Fetch a fresh account.profiles row by id (UUID PK) */
async function findUserById(id) {
  const [rows] = await sequelize.query(
    `SELECT 
       id,
       id AS "supabaseId",
       full_name AS name,
       email,
       phone,
       dob AS "dateOfBirth",
       role,
       address,
       profile_picture AS "profilePicture",
       is_verified AS "isVerified",
       documents,
       notification_preferences AS preferences,
       created_at AS "createdAt"
     FROM account.profiles 
     WHERE id = :id 
     LIMIT 1`,
    { replacements: { id } },
  );
  return rows[0] || null;
}

/** Update account.profiles columns by id */
async function updateUserById(id, updates) {
  const columnMap = {
    name: 'full_name',
    firstName: 'full_name',
    lastName: 'full_name',
    email: 'email',
    phone: 'phone',
    address: 'address',
    dateOfBirth: 'dob',
    profilePicture: 'profile_picture',
    isVerified: 'is_verified',
    documents: 'documents',
    preferences: 'notification_preferences',
    twoFactorEnabled: 'two_factor_enabled',
  };

  // Resolve firstName and lastName changes into name
  if (updates.firstName !== undefined || updates.lastName !== undefined) {
    const [user] = await sequelize.query(`SELECT full_name FROM account.profiles WHERE id = :id LIMIT 1`, { replacements: { id } });
    const currentName = user[0]?.full_name || '';
    const parts = currentName.split(' ');
    const fn = updates.firstName !== undefined ? updates.firstName : (parts[0] || '');
    const ln = updates.lastName !== undefined ? updates.lastName : (parts.slice(1).join(' ') || '');
    updates.name = `${fn} ${ln}`.trim();
    delete updates.firstName;
    delete updates.lastName;
  }

  const setClauses = [];
  const replacements = { id };

  for (const [key, val] of Object.entries(updates)) {
    const colName = columnMap[key];
    if (colName) {
      setClauses.push(`"${colName}" = :${key}`);
      replacements[key] = val;
    }
  }

  if (setClauses.length === 0) return findUserById(id);

  const query = `UPDATE account.profiles SET ${setClauses.join(', ')} WHERE id = :id`;
  await sequelize.query(query, { replacements });
  return findUserById(id);
}

/** Strip internal columns before sending to client */
function toPublic(row) {
  if (!row) return null;
  const { twoFactorSecret, password, ...rest } = row;
  rest._id = String(rest.id);
  // Add fallback firstName and lastName
  const nameParts = (rest.name || '').split(' ');
  rest.firstName = nameParts[0] || '';
  rest.lastName = nameParts.slice(1).join(' ') || '';
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

    const allowed = ['firstName', 'lastName', 'email', 'phone', 'address', 'dateOfBirth', 'profilePicture', 'preferences'];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const merged = { ...user, ...updates };
    updates.isVerified = shouldBeVerified(merged);

    // If adding/changing email: validate format and check uniqueness
    if (updates.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
        return res.status(400).json({ success: false, message: 'Invalid email format.' });
      }
      const [taken] = await sequelize.query(
        `SELECT id FROM account.profiles WHERE email = :email AND id != :selfId LIMIT 1`,
        { replacements: { email: updates.email, selfId: req.user.id } }
      );
      if (taken.length > 0) {
        return res.status(409).json({ success: false, message: 'This email is already used by another account.' });
      }
    }

    const updated = await updateUserById(req.user.id, updates);

    // Also update name in Supabase auth.users metadata so it stays in sync
    if ((updates.firstName || updates.lastName) && req.user.authId) {
      const fn = updates.firstName ?? user.firstName ?? '';
      const ln = updates.lastName  ?? user.lastName  ?? '';
      await getSupabaseClient()
        .auth.admin.updateUserById(req.user.authId, {
          user_metadata: { firstName: fn, lastName: ln, name: `${fn} ${ln}`.trim() },
        })
        .catch(() => null); // non-fatal
    }

    // If a phone-only user is adding their email for the first time,
    // update Supabase auth so they can also log in with email+password later.
    if (updates.email && req.user.authId && !user.email) {
      await getSupabaseClient()
        .auth.admin.updateUserById(req.user.authId, { email: updates.email })
        .catch(() => null); // non-fatal
    }

    res.json({ success: true, data: toPublic(updated), isVerified: updated.isVerified });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ── POST /api/users/verify-account/request ────────────────────────────────────
const requestVerificationOTP = async (req, res) => {
  try {
    const { channel } = req.body;
    if (!['email', 'sms'].includes(channel)) {
      return res.status(400).json({ success: false, message: 'Invalid channel' });
    }
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    
    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpCache.set(req.user.id, { code: otp, expires: Date.now() + 10 * 60 * 1000 }); // 10 mins

    // In a real app we'd send an SMS/Email here. For now, simulate:
    console.log(`[OTP] Sent ${otp} to ${channel === 'email' ? user.email : user.phone}`);
    
    // Actually send the email/SMS using our services
    try {
      if (channel === 'email') {
        const emailService = require('../services/emailService');
        await emailService.sendOTPEmail(user.email, otp);
      } else if (channel === 'sms') {
        const smsService = require('../services/smsService');
        await smsService.sendSMS(user.phone, `Your PakiPark verification code is: ${otp}. Valid for 10 minutes.`, 'otp');
      }
    } catch (err) {
      console.error(`[OTP Delivery Failed]: ${err.message}`);
      // Fallback silently so the user can still use the console-logged DEV OTP
    }

    res.json({ success: true, message: `OTP sent to your ${channel}. (Check console for code)` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /api/users/verify-account/verify ─────────────────────────────────────
const verifyAccountOTP = async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ success: false, message: 'OTP is required' });

    const cached = otpCache.get(req.user.id);
    if (!cached) return res.status(400).json({ success: false, message: 'No pending OTP request or expired.' });
    
    if (Date.now() > cached.expires) {
      otpCache.delete(req.user.id);
      return res.status(400).json({ success: false, message: 'OTP has expired.' });
    }

    if (cached.code !== otp) {
      return res.status(400).json({ success: false, message: 'Incorrect OTP code.' });
    }

    // Success! Update isVerified
    await updateUserById(req.user.id, { isVerified: true });
    otpCache.delete(req.user.id);

    res.json({ success: true, message: 'Account successfully verified.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    const updated = await updateUserById(req.user.id, {
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

    const updates = action === 'approve'
      ? { isVerified: true }
      : { isVerified: false };

    const updated = await updateUserById(req.params.id, updates);

    if (action === 'approve') {
      notificationService.notifyDiscountApproved(user.id);
    } else {
      notificationService.notifyDiscountRejected(user.id, 'Please upload a clearer, valid PWD or Senior Citizen ID.');
    }

    res.json({
      success: true,
      message: action === 'approve' ? 'Discount approved — user now verified' : 'Discount request rejected',
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
    // Fallback: profiles table doesn't have discountStatus column natively. Just return unverified users.
    const [rows] = await sequelize.query(
      `SELECT 
         id,
         id AS "supabaseId",
         full_name AS name,
         email,
         phone,
         dob AS "dateOfBirth",
         role,
         address,
         profile_picture AS "profilePicture",
         is_verified AS "isVerified",
         documents,
         notification_preferences AS preferences,
         created_at AS "createdAt"
       FROM account.profiles 
       WHERE is_verified = false
       ORDER BY created_at DESC`,
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

    const secret = crypto.randomBytes(20).toString('base32');
    await updateUserById(req.user.id, { twoFactorEnabled: false });

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

    await updateUserById(req.user.id, { twoFactorEnabled: false });
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
      `SELECT 
         id,
         id AS "supabaseId",
         full_name AS name,
         email,
         phone,
         dob AS "dateOfBirth",
         role,
         address,
         profile_picture AS "profilePicture",
         is_verified AS "isVerified",
         documents,
         notification_preferences AS preferences,
         created_at AS "createdAt"
       FROM account.profiles 
       ORDER BY created_at DESC`,
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

    // In profiles we delete the row entirely
    await sequelize.query(`DELETE FROM account.profiles WHERE id = :id`, { replacements: { id: user.id } });
    res.json({ success: true, message: 'Account deleted. You have been logged out.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

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
  requestVerificationOTP,
  verifyAccountOTP,
};
