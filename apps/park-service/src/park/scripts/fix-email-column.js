'use strict';
const { Sequelize } = require('sequelize');
require('dotenv').config({ path: './.env' });

const seq = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
});

async function run() {
  // 1. Clean any leftover synthetic emails or empty strings stored in phone-registered rows
  const [cleaned] = await seq.query(
    `UPDATE public.users SET email = NULL WHERE email = '' OR email LIKE '%@pakipark.ph'`
  );
  console.log('Cleaned synthetic/empty emails:', cleaned);

  // 2. Confirm email column is now nullable
  const [cols] = await seq.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name='users' AND column_name='email'`
  );
  console.log('email column state:', cols[0]);

  await seq.close();
  console.log('Done.');
}

run().catch(e => { console.error(e.message); process.exit(1); });
