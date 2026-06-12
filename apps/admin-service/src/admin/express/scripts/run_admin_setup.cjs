// run_admin_setup.cjs
// Uses the same DATABASE_URL as the Express backend to run admin_accounts setup SQL

require('dotenv').config();
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL not found in .env');
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

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
    label: 'Grant schema + function permissions',
    sql: `
      GRANT USAGE ON SCHEMA account TO authenticated, anon;
      GRANT EXECUTE ON FUNCTION account.fn_admin_login(TEXT, TEXT) TO authenticated, anon;
      GRANT SELECT ON account.admin_accounts TO authenticated, anon;
    `,
  },
  {
    label: 'Seed admin account (admin@pakiadmin.ph / PakiAdmin@2026!)',
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
    label: 'Verify — list admin_accounts rows',
    sql: `SELECT id, email, full_name, role, is_active, "createdAt" FROM account.admin_accounts;`,
  },
];

async function main() {
  await client.connect();
  console.log('✅ Connected to Supabase\n');

  for (const step of steps) {
    try {
      const result = await client.query(step.sql);
      const rows = Array.isArray(result) ? result[result.length - 1].rows : (result.rows ?? []);
      if (rows.length > 0) {
        console.log(`✅ ${step.label}:`);
        console.table(rows);
      } else {
        console.log(`✅ ${step.label}: OK`);
      }
    } catch (err) {
      console.error(`❌ ${step.label}: ${err.message}`);
    }
  }

  await client.end();
  console.log('\n✅ All done.');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
