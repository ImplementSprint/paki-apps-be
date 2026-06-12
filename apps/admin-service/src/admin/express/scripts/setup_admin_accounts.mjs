// setup_admin_accounts.mjs
// Runs directly against Supabase via the service-role key + postgres REST endpoint

const SUPABASE_URL = 'https://rregfrhtlmfktliijzpd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyZWdmcmh0bG1ma3RsaWlqenBkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTM5MDM1MSwiZXhwIjoyMDg2OTY2MzUxfQ.9rYx4nZkF_K278AZ2W6tAuBkN17RNALgZqdDXqpcQnA';

async function sql(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ query }),
  });
  return res;
}

// Use the Supabase pg endpoint for raw SQL
async function runSQL(statement, label) {
  const res = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: statement }),
  });
  const text = await res.text();
  console.log(`[${label}] HTTP ${res.status}: ${text.slice(0, 200)}`);
  return { status: res.status, body: text };
}

const steps = [
  {
    label: 'Enable pgcrypto',
    sql: `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,
  },
  {
    label: 'Create account schema',
    sql: `CREATE SCHEMA IF NOT EXISTS account;`,
  },
  {
    label: 'Create admin_accounts table',
    sql: `
      CREATE TABLE IF NOT EXISTS account.admin_accounts (
        id            SERIAL        PRIMARY KEY,
        email         VARCHAR(255)  NOT NULL UNIQUE,
        password_hash TEXT          NOT NULL,
        full_name     VARCHAR(255)  NOT NULL,
        role          VARCHAR(30)   NOT NULL DEFAULT 'admin',
        is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
        "createdAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        "updatedAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    label: 'Create index on email',
    sql: `CREATE INDEX IF NOT EXISTS idx_admin_accounts_email ON account.admin_accounts (email);`,
  },
  {
    label: 'Create fn_admin_login RPC',
    sql: `
      CREATE OR REPLACE FUNCTION account.fn_admin_login(p_email TEXT, p_password TEXT)
      RETURNS TABLE (
        id        INTEGER,
        email     VARCHAR(255),
        full_name VARCHAR(255),
        role      VARCHAR(30),
        is_active BOOLEAN
      )
      LANGUAGE plpgsql SECURITY DEFINER AS $$
      BEGIN
        RETURN QUERY
        SELECT a.id, a.email, a.full_name, a.role, a.is_active
        FROM account.admin_accounts a
        WHERE a.email = lower(trim(p_email))
          AND a.is_active = TRUE
          AND a.password_hash = crypt(p_password, a.password_hash);
      END;
      $$;
    `,
  },
  {
    label: 'Grant schema usage',
    sql: `GRANT USAGE ON SCHEMA account TO authenticated, anon;`,
  },
  {
    label: 'Grant execute on RPC',
    sql: `GRANT EXECUTE ON FUNCTION account.fn_admin_login(TEXT, TEXT) TO authenticated, anon;`,
  },
  {
    label: 'Seed admin account',
    sql: `
      INSERT INTO account.admin_accounts (email, password_hash, full_name, role)
      VALUES (
        'admin@pakiadmin.ph',
        crypt('PakiAdmin@2026!', gen_salt('bf', 12)),
        'PakiAdmin Operator',
        'admin'
      )
      ON CONFLICT (email) DO NOTHING;
    `,
  },
  {
    label: 'Verify insert',
    sql: `SELECT id, email, full_name, role, is_active, "createdAt" FROM account.admin_accounts;`,
  },
];

for (const step of steps) {
  await runSQL(step.sql, step.label);
}
