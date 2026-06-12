'use strict';
/**
 * auth.js — JWT middleware (Supabase + account schema edition)
 * ============================================================
 * Supabase-issued JWTs are verified via supabase.auth.getUser().
 * Profile lookup hits account.profiles.
 */

const { getSupabaseClient } = require('../config/supabaseClient');
const { sequelize } = require('../config/db');

/**
 * protect — verify Supabase JWT and attach profile to req.user.
 */
const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    const supabase = getSupabaseClient();
    const { data: { user: authUser }, error: verifyError } = await supabase.auth.getUser(token);

    if (verifyError || !authUser) {
      console.error('[Auth Middleware] Token invalid:', verifyError?.message);
      return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }

    const authId = authUser.id;

    // ── Lookup from account.profiles ──────────────────────────────────────────
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
       WHERE id = :authId 
       LIMIT 1`,
      { replacements: { authId } },
    );

    let user = rows[0];

    // Fallback: if not yet in account.profiles, create a minimal row on-the-fly
    if (!user) {
      const meta  = authUser.user_metadata || {};
      const role  = authUser.app_metadata?.role || 'customer';
      const email = authUser.email || null;
      try {
        const [alreadyExists] = await sequelize.query(
          `SELECT id FROM account.profiles WHERE id = :authId LIMIT 1`,
          { replacements: { authId } }
        );
        if (alreadyExists.length === 0) {
          await sequelize.query(
            `INSERT INTO account.profiles
               (id, full_name, email, role, is_verified, created_at)
             VALUES (:authId, :name, :email, :role, true, now())`,
            { replacements: {
              name: meta.name || email || '',
              email, role, authId
            }}
          );
        }
        const [r2] = await sequelize.query(
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
           WHERE id = :authId 
           LIMIT 1`,
          { replacements: { authId } }
        );
        user = r2[0];
      } catch (err) { 
        console.error('[Auth Middleware] Fallback insert failed:', err.message);
      }
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'User profile not found' });
    }

    req.user        = user;
    req.user._id    = user.id;
    req.user.authId = authId;
    // Role from JWT app_metadata is authoritative
    req.user.role   = authUser.app_metadata?.role || user.role || 'customer';

    next();
  } catch (error) {
    console.error('[Auth Middleware Error]:', error);
    return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
  }
};

/**
 * authenticate — alias for protect (used by new route files)
 */
const authenticate = protect;

/**
 * requireRole — middleware factory to restrict routes to specific roles.
 * @param {string[]} roles
 */
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Access denied. Required role: ${roles.join(' or ')}`,
    });
  }
  next();
};

module.exports = { protect, authenticate, requireRole };
