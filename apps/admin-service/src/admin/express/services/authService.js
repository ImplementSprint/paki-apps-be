'use strict';
/**
 * authService.js — Supabase Auth edition
 * =======================================
 * All user identity now lives in Supabase's built-in `auth.users` table.
 * The `account.users` table still holds the PakiPark-specific profile columns
 * (role, phone, address, discounts, 2FA, etc.) and is joined on auth_id (uuid).
 *
 * Flow:
 *   signUp  → supabase.auth.admin.createUser()  → inserts into auth.users
 *           → then upserts a matching row in account.users (role, phone, …)
 *
 *   login   → supabase.auth.signInWithPassword() → validates via auth.users
 *           → fetches profile from account.users WHERE auth_id = auth.user.id
 *           → returns Supabase access_token (JWT signed by Supabase)
 *
 * The JWT returned is a Supabase-issued token. The protect middleware verifies it
 * using the Supabase JWT secret (SUPABASE_JWT_SECRET in .env).
 */

const { getSupabaseClient } = require('../config/supabaseClient');
const { sequelize }         = require('../config/db');
const { logUserLogin, logUserRegistered } = require('./logService');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch or create the account.users profile row that shadows an auth.users record.
 * @param {string} authId  - auth.users.id (uuid)
 * @param {object} defaults - columns to insert if the row doesn't exist yet
 */
async function upsertProfile(authId, defaults = {}) {
  const [rows] = await sequelize.query(
    `INSERT INTO account.profiles (id, full_name, email, phone, role, is_verified, created_at, location_id)
     VALUES (:authId, :name, :email, :phone, :role, :isVerified, now(), :locationId)
     ON CONFLICT (id) DO UPDATE
       SET full_name   = EXCLUDED.full_name,
           email       = EXCLUDED.email,
           phone       = COALESCE(EXCLUDED.phone, account.profiles.phone),
           location_id = EXCLUDED.location_id
     RETURNING *`,
    {
      replacements: {
        authId,
        name:       defaults.name       || '',
        email:      defaults.email      || '',
        phone:      defaults.phone      || '',
        role:       defaults.role       || 'customer',
        isVerified: defaults.isVerified ?? false,
        locationId: defaults.location_id || null,
      },
    },
  );
  return rows[0];
}

/**
 * Fetch a profile row by authId.
 */
async function getProfileByAuthId(authId) {
  const [rows] = await sequelize.query(
    `SELECT * FROM account.profiles WHERE id = :authId LIMIT 1`,
    { replacements: { authId } },
  );
  return rows[0] || null;
}

// ── Register Customer ─────────────────────────────────────────────────────────

const registerCustomer = async ({ name, email, phone, password }) => {
  const supabase = getSupabaseClient();

  // 1. Create user in Supabase auth.users (service_role bypasses email confirmation)
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,          // mark as confirmed immediately
    user_metadata: { name, phone, role: 'customer' },
  });

  if (authError) throw new Error(authError.message);

  const authUser = authData.user;

  // 2. Upsert matching profile in account.users
  const profile = await upsertProfile(authUser.id, {
    name,
    email: authUser.email,
    phone,
    role: 'customer',
    isVerified: false,
  });

  logUserRegistered({ userId: profile.id, role: 'customer' });

  // 3. Sign in to get a valid session token for the new user
  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw new Error(signInError.message);

  return {
    _id:    String(profile.id),
    authId: authUser.id,
    name:   profile.full_name,
    email:  profile.email,
    role:   profile.role,
    token:  session.session.access_token,
    refreshToken: session.session.refresh_token,
  };
};

// ── Register Admin / Partner / Teller ────────────────────────────────────────

const registerAdmin = async ({ name, email, phone, password, accessCode, address, dateOfBirth, role: requestedRole }) => {
  if (accessCode !== process.env.ADMIN_ACCESS_CODE) {
    throw new Error('Invalid admin access code');
  }

  const finalRole = ['admin', 'teller', 'business_partner'].includes(requestedRole)
    ? requestedRole
    : 'admin';

  const supabase = getSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone, role: finalRole },
  });

  if (authError) throw new Error(authError.message);

  const authUser = authData.user;

  const profile = await upsertProfile(authUser.id, {
    name,
    email: authUser.email,
    phone,
    role: finalRole,
    isVerified: true,
  });

  logUserRegistered({ userId: profile.id, role: finalRole });

  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw new Error(signInError.message);

  return {
    _id:    String(profile.id),
    authId: authUser.id,
    name:   profile.full_name,
    email:  profile.email,
    role:   profile.role,
    token:  session.session.access_token,
    refreshToken: session.session.refresh_token,
  };
};

// ── Register Staff ────────────────────────────────────────────────────────────

const registerStaff = async ({ name, email, phone, password, role, location_id }) => {
  const supabase = getSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone, role },
  });

  if (authError) throw new Error(authError.message);

  const authUser = authData.user;

  // Use the existing RPC to ensure all profile and location logic is handled perfectly
  const { error: rpcError } = await supabase.schema('account').rpc('upsert_staff_profile', {
    p_id: authUser.id,
    p_full_name: name,
    p_email: authUser.email,
    p_phone: phone || null,
    p_role: role,
    p_is_verified: true,
    p_location_id: location_id || null,
  });

  if (rpcError) {
    throw new Error(rpcError.message);
  }

  logUserRegistered({ userId: authUser.id, role });

  return {
    _id:    authUser.id,
    authId: authUser.id,
    name:   name,
    email:  authUser.email,
    role:   role,
  };
};

// ── Login ─────────────────────────────────────────────────────────────────────

const loginUser = async ({ email, password }) => {
  const supabase = getSupabaseClient();

  // Supabase validates credentials against auth.users
  const { data: session, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw new Error('Invalid credentials');

  const authUser = session.user;

  // Fetch the PakiPark profile from account.users
  const profile = await getProfileByAuthId(authUser.id);

  if (!profile) {
    // Edge case: auth.users exists but no account.users row yet — create one
    const newProfile = await upsertProfile(authUser.id, {
      name:  authUser.user_metadata?.name  || authUser.email.split('@')[0],
      email: authUser.email,
      phone: authUser.user_metadata?.phone || '',
      role:  authUser.user_metadata?.role  || 'customer',
      isVerified: true,
    });
    logUserLogin({ userId: newProfile.id, role: newProfile.role });
    return buildResponse(newProfile, authUser.id, session.session);
  }

  if (profile.deletedAt) {
    throw new Error('This account has been deleted');
  }

  logUserLogin({ userId: profile.id, role: profile.role });

  return buildResponse(profile, authUser.id, session.session);
};

function buildResponse(profile, authId, session) {
  return {
    _id:          String(profile.id),
    authId,
    name:         profile.full_name || profile.name,
    email:        profile.email,
    role:         profile.role,
    profilePicture: profile.profile_picture || profile.profilePicture || null,
    token:        session.access_token,
    refreshToken: session.refresh_token,
    expiresAt:    session.expires_at,
  };
}

// ── Token Refresh ─────────────────────────────────────────────────────────────

const refreshToken = async ({ refreshToken: rt }) => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: rt });
  if (error) throw new Error('Invalid or expired refresh token');
  return {
    token:        data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt:    data.session.expires_at,
  };
};

// ── Logout ────────────────────────────────────────────────────────────────────

const logoutUser = async ({ refreshToken: rt }) => {
  // Supabase server-side sign-out invalidates the refresh token
  const supabase = getSupabaseClient();
  await supabase.auth.admin.signOut(rt).catch(() => null); // best-effort
  return { success: true };
};

module.exports = { registerCustomer, registerAdmin, registerStaff, loginUser, refreshToken, logoutUser };