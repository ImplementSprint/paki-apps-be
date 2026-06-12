-- =============================================================================
--  PakiAdmin — Admin Accounts Schema & Seed
--
--  PURPOSE
--  ───────
--  Creates the `account` schema and `admin_accounts` table used by the
--  PakiAdmin login to authenticate administrators via the frontend.
--
--  HOW TO APPLY
--  ────────────
--  Paste into Supabase → SQL Editor and run.
--  All objects use IF NOT EXISTS — safe to re-run.
--
--  PASSWORD HASHING
--  ────────────────
--  Passwords are stored as bcrypt hashes (using pgcrypto extension).
--  The login flow checks: crypt(input_password, stored_hash) = stored_hash
-- =============================================================================

-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create the account schema
CREATE SCHEMA IF NOT EXISTS account;

-- =============================================================================
-- TABLE: account.admin_accounts
-- =============================================================================

CREATE TABLE IF NOT EXISTS account.admin_accounts (
  id            SERIAL        PRIMARY KEY,
  email         VARCHAR(255)  NOT NULL UNIQUE,
  password_hash TEXT          NOT NULL,
  full_name     VARCHAR(255)  NOT NULL,
  role          VARCHAR(30)   NOT NULL DEFAULT 'admin',   -- 'admin' | 'super-admin'
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_accounts_email
  ON account.admin_accounts (email);

CREATE INDEX IF NOT EXISTS idx_admin_accounts_role
  ON account.admin_accounts (role);

-- =============================================================================
-- RPC: fn_admin_login
--   Called by the frontend login form.
--   Verifies password using bcrypt via pgcrypto.
--   Returns the account row (without password_hash) or NULL if invalid.
-- =============================================================================

CREATE OR REPLACE FUNCTION account.fn_admin_login(
  p_email    TEXT,
  p_password TEXT
)
RETURNS TABLE (
  id        INTEGER,
  email     VARCHAR(255),
  full_name VARCHAR(255),
  role      VARCHAR(30),
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.email,
    a.full_name,
    a.role,
    a.is_active
  FROM account.admin_accounts a
  WHERE
    a.email        = lower(trim(p_email))
    AND a.is_active = TRUE
    AND a.password_hash = crypt(p_password, a.password_hash);
END;
$$;

-- Grant access so the anon/authenticated Supabase roles can call it
GRANT USAGE ON SCHEMA account TO authenticated, anon;
GRANT EXECUTE ON FUNCTION account.fn_admin_login(TEXT, TEXT) TO authenticated, anon;

-- =============================================================================
-- SEED: 1 admin account
--
--   Email    : admin@pakiadmin.ph
--   Password : PakiAdmin@2026!
--   Role     : admin
-- =============================================================================

INSERT INTO account.admin_accounts (email, password_hash, full_name, role)
VALUES (
  'admin@pakiadmin.ph',
  crypt('PakiAdmin@2026!', gen_salt('bf', 12)),
  'PakiAdmin Operator',
  'admin'
)
ON CONFLICT (email) DO NOTHING;

-- =============================================================================
-- END OF SCRIPT
-- =============================================================================
