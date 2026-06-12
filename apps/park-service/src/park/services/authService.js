'use strict';
/**
 * authService.js — Account Schema Edition (v2)
 * ==============================================
 * Auth credentials live in Supabase auth.users.
 * Identity/profile data lives in account.profiles (PRIMARY).
 *
 * ❌ NO public schema usage — public.users is NOT touched anywhere here.
 */

const { getSupabaseClient } = require('../config/supabaseClient');
const { sequelize }         = require('../config/db');
const { logUserLogin, logUserRegistered } = require('./logService');

// ── Phone Helpers ─────────────────────────────────────────────────────────────

function phoneToSyntheticEmail(phone) {
  const digits = String(phone).replace(/\D/g, '');
  return `${digits}@phone.pakipark.local`;
}

function isPhoneIdentifier(val) {
  return /^\+63\d{10}$/.test(val);
}

// ── account.profiles (PRIMARY) ────────────────────────────────────────────────

/**
 * Upsert into account.profiles using full_name column.
 * id = Supabase auth UUID.
 */
async function upsertAccountProfile(authId, data = {}) {
  const firstName = (data.firstName || '').trim();
  const lastName  = (data.lastName  || '').trim();
  const fullName  = `${firstName} ${lastName}`.trim() || data.name || data.email || '';

  await sequelize.query(
    `INSERT INTO account.profiles (id, full_name, email, phone, dob, role, is_verified)
     VALUES (:id, :fullName, :email, :phone, :dob, :role, :isVerified)
     ON CONFLICT (id) DO UPDATE
       SET full_name   = COALESCE(EXCLUDED.full_name, account.profiles.full_name),
           email       = COALESCE(EXCLUDED.email,     account.profiles.email),
           phone       = COALESCE(EXCLUDED.phone,     account.profiles.phone),
           dob         = COALESCE(EXCLUDED.dob,       account.profiles.dob),
           role        = COALESCE(EXCLUDED.role,      account.profiles.role),
           is_verified = COALESCE(EXCLUDED.is_verified, account.profiles.is_verified)`,
    {
      replacements: {
        id:         authId,
        fullName:   fullName || null,
        email:      data.email ?? null,
        phone:      data.phone ?? null,
        dob:        data.dob   ?? null,
        role:       data.role  || 'customer',
        isVerified: data.isVerified ?? false,
      },
    },
  );
  console.log(`[Auth] ✅ account.profiles → ${authId} (${fullName})`);
}

/**
 * Keep for compatibility, delegates directly to upsertAccountProfile.
 */
async function upsertAccountUser(authId, data = {}) {
  await upsertAccountProfile(authId, data);
}

/**
 * Read profile from account.profiles by Supabase auth UUID.
 */
async function getProfileByAuthId(authId) {
  const [rows] = await sequelize.query(
    `SELECT
       id               AS auth_id,
       full_name        AS name,
       full_name        AS first_name,
       ''               AS last_name,
       email            AS ap_email,
       phone            AS ap_phone,
       dob              AS ap_dob,
       id               AS public_id,
       role,
       is_verified      AS "isVerified",
       profile_picture  AS "profilePicture"
     FROM account.profiles
     WHERE id = :authId
     LIMIT 1`,
    { replacements: { authId } },
  );
  return rows[0] || null;
}

/**
 * Fallback: find by email in account.profiles.
 */
async function getProfileByEmail(email) {
  const [rows] = await sequelize.query(
    `SELECT
       id               AS auth_id,
       full_name        AS name,
       full_name        AS first_name,
       ''               AS last_name,
       email            AS ap_email,
       phone            AS ap_phone,
       dob              AS ap_dob,
       id               AS public_id,
       role,
       is_verified      AS "isVerified",
       profile_picture  AS "profilePicture"
     FROM account.profiles
     WHERE email = :email
     LIMIT 1`,
    { replacements: { email } },
  );
  return rows[0] || null;
}

// ── Register Customer ─────────────────────────────────────────────────────────

const registerCustomer = async ({ firstName, lastName, email, phone, password }) => {
  const supabase    = getSupabaseClient();
  const name        = `${firstName} ${lastName}`.trim();
  const isPhoneReg  = !!phone && !email;
  const actualPhone = phone  || null;
  const authEmail   = isPhoneReg ? phoneToSyntheticEmail(phone) : email;

  if (!authEmail) throw new Error('Email or phone number is required.');

  // ── Step 1: Check account.profiles for duplicates (PRIMARY) ──────────────
  if (actualPhone) {
    const [rows] = await sequelize.query(
      `SELECT id FROM account.profiles WHERE phone = :phone LIMIT 1`,
      { replacements: { phone: actualPhone } }
    );
    if (rows.length > 0) throw new Error('This phone number is already registered. Please log in.');
  }
  if (!isPhoneReg && email) {
    const [rows] = await sequelize.query(
      `SELECT id FROM account.profiles WHERE email = :email LIMIT 1`,
      { replacements: { email } }
    );
    if (rows.length > 0) throw new Error('This email is already registered. Please log in.');
  }

  // ── Step 2: Check for orphaned Supabase auth entry ───────────────────────
  let orphanedSupabaseId = null;
  try {
    const [authRows] = await sequelize.query(
      `SELECT id FROM auth.users WHERE email = :email LIMIT 1`,
      { replacements: { email: authEmail } }
    );
    if (authRows.length > 0) orphanedSupabaseId = authRows[0].id;
  } catch (_) { /* auth schema may not be directly accessible */ }

  if (orphanedSupabaseId) {
    const existingProfile = await getProfileByAuthId(orphanedSupabaseId);
    if (existingProfile) {
      throw new Error(isPhoneReg
        ? 'This phone number is already registered. Please log in.'
        : 'This email is already registered. Please log in.');
    }
    await supabase.auth.admin.deleteUser(orphanedSupabaseId);
  }

  // ── Step 3: Create user in Supabase auth.users ───────────────────────────
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    app_metadata:  { role: 'customer' },
    user_metadata: { firstName, lastName, name, phone: actualPhone },
  });
  if (authError) throw new Error(authError.message);

  const authUser = authData.user;

  // ── Step 4: Write to account.profiles (PRIMARY) ──────────────────────────
  await upsertAccountProfile(authUser.id, {
    firstName,
    lastName,
    email: isPhoneReg ? null : email,
    phone: actualPhone,
  });

  // ── Step 5: Sign in to get session token ─────────────────────────────────
  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password,
  });
  if (signInError) throw new Error(signInError.message);

  const profile = await getProfileByAuthId(authUser.id);
  logUserRegistered({ userId: authUser.id, role: 'customer' });

  return buildResponse(profile, authUser.id, session.session);
};

// ── Register Admin / Partner / Teller ────────────────────────────────────────

const registerAdmin = async ({ firstName, lastName, email, phone, password, accessCode, role: requestedRole }) => {
  if (accessCode !== process.env.ADMIN_ACCESS_CODE) {
    throw new Error('Invalid admin access code');
  }
  const name      = `${firstName} ${lastName}`.trim();
  const finalRole = ['admin', 'teller', 'business_partner'].includes(requestedRole)
    ? requestedRole : 'admin';

  const supabase = getSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata:  { role: finalRole },
    user_metadata: { firstName, lastName, name, phone },
  });
  if (authError) throw new Error(authError.message);

  const authUser = authData.user;

  await upsertAccountProfile(authUser.id, { firstName, lastName, email: authUser.email, phone, role: finalRole, isVerified: true });

  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(signInError.message);

  const profile = await getProfileByAuthId(authUser.id);
  logUserRegistered({ userId: authUser.id, role: finalRole });

  return buildResponse(profile, authUser.id, session.session);
};

// ── Login ─────────────────────────────────────────────────────────────────────

const loginUser = async ({ email, password }) => {
  const supabase = getSupabaseClient();

  let authEmail = email;
  if (isPhoneIdentifier(email)) {
    const [rows] = await sequelize.query(
      `SELECT id, email FROM account.profiles WHERE phone = :phone LIMIT 1`,
      { replacements: { phone: email } }
    );
    if (rows.length === 0) throw new Error('No account found with this phone number.');
    authEmail = rows[0].email || phoneToSyntheticEmail(email);
  }

  const { data: session, error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
  if (error) throw new Error('Invalid credentials. Please check your email and password.');

  const authUser = session.user;

  // ── Read from account.profiles (PRIMARY) ─────────────────────────────────
  let profile = await getProfileByAuthId(authUser.id);

  if (!profile) {
    const realEmail = authUser.email && !authUser.email.endsWith('@phone.pakipark.local')
      ? authUser.email : null;
    if (realEmail) profile = await getProfileByEmail(realEmail);

    if (!profile) {
      const meta   = authUser.user_metadata || {};
      const fName  = meta.firstName || (meta.name || '').split(' ')[0] || '';
      const lName  = meta.lastName  || (meta.name || '').split(' ').slice(1).join(' ') || '';
      // Derive role from app_metadata (safe — not user-editable)
      const role   = authUser.app_metadata?.role || 'customer';

      await upsertAccountProfile(authUser.id, { firstName: fName, lastName: lName, email: realEmail, phone: meta.phone || null, role, isVerified: true });
      profile = await getProfileByAuthId(authUser.id);
    }
  }

  // Keep account.profiles fresh on every login
  await upsertAccountProfile(authUser.id, {
    firstName: profile.first_name || '',
    lastName:  profile.last_name  || '',
    email:     profile.ap_email   || null,
    phone:     profile.ap_phone   || null,
  });

  // Authoritative role from app_metadata (JWT, never user-editable)
  const role = authUser.app_metadata?.role || profile.role || 'customer';

  logUserLogin({ userId: profile.auth_id || authUser.id, role });

  return buildResponse({ ...profile, role }, authUser.id, session.session);
};

// ── Build Response ────────────────────────────────────────────────────────────

function buildResponse(profile, authId, session) {
  const name = profile.name || profile.full_name || '';
  const firstName = name.split(' ')[0] || '';
  const lastName  = name.split(' ').slice(1).join(' ') || '';

  const isSynthetic  = profile.ap_email &&
    (profile.ap_email.endsWith('@phone.pakipark.local') || profile.ap_email.endsWith('@pakipark.ph'));
  const displayEmail = isSynthetic ? null : (profile.ap_email || null);
  const displayPhone = profile.ap_phone || null;
  const identifier   = displayPhone || displayEmail;

  return {
    _id:            String(profile.public_id || authId),
    authId,
    firstName,
    lastName,
    name:           name,
    email:          displayEmail,
    phone:          displayPhone,
    dob:            profile.ap_dob || null,
    identifier,
    role:           profile.role || 'customer',
    profilePicture: profile.profilePicture || null,
    token:          session.access_token,
    refreshToken:   session.refresh_token,
    expiresAt:      session.expires_at,
  };
}

// ── Token Refresh ─────────────────────────────────────────────────────────────

const refreshToken = async ({ refreshToken: rt }) => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: rt });
  if (error) throw new Error('Invalid or expired refresh token');
  return { token: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: data.session.expires_at };
};

// ── Logout ────────────────────────────────────────────────────────────────────

const logoutUser = async ({ refreshToken: rt }) => {
  const supabase = getSupabaseClient();
  await supabase.auth.admin.signOut(rt).catch(() => null);
  return { success: true };
};

module.exports = { registerCustomer, registerAdmin, loginUser, refreshToken, logoutUser };