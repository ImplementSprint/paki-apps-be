// run_admin_setup_api.mjs
// Uses Supabase Management API (pg REST via service role) to run DDL + seed

const PROJECT_REF = 'rregfrhtlmfktliijzpd';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyZWdmcmh0bG1ma3RsaWlqenBkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTM5MDM1MSwiZXhwIjoyMDg2OTY2MzUxfQ.9rYx4nZkF_K278AZ2W6tAuBkN17RNALgZqdDXqpcQnA';

// Supabase Management API endpoint for running arbitrary SQL
const MGMT_SQL_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function runSQL(sql, label) {
  try {
    const res = await fetch(MGMT_SQL_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    if (!res.ok) {
      console.error(`❌ [${label}] HTTP ${res.status}: ${JSON.stringify(parsed).slice(0, 300)}`);
      return null;
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log(`✅ [${label}]:`);
      console.table(parsed);
    } else {
      console.log(`✅ [${label}]: OK`);
    }
    return parsed;
  } catch (err) {
    console.error(`❌ [${label}] Error: ${err.message}`);
    return null;
  }
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
    label: 'Create indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_admin_accounts_email ON account.admin_accounts (email);
      CREATE INDEX IF NOT EXISTS idx_admin_accounts_role  ON account.admin_accounts (role);
    `,
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
    label: 'Grant permissions',
    sql: `
      GRANT USAGE ON SCHEMA account TO authenticated, anon;
      GRANT EXECUTE ON FUNCTION account.fn_admin_login(TEXT, TEXT) TO authenticated, anon;
      GRANT SELECT ON account.admin_accounts TO authenticated, anon;
    `,
  },
  {
    label: 'Seed admin@pakiadmin.ph',
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
    label: 'Verify rows in admin_accounts',
    sql: `SELECT id, email, full_name, role, is_active, "createdAt" FROM account.admin_accounts;`,
  },
];

for (const step of steps) {
  await runSQL(step.sql, step.label);
}
