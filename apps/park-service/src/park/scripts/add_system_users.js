'use strict';
/**
 * add_system_users.js
 * ===================
 * Adds or updates specific system credentials to the database.
 * Use this to quickly set up the standard Admin, Partner, and Teller accounts.
 */
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { sequelize } = require('../config/db');
const { User } = require('../models/index');

const USERS = [
  {
    name: 'Super Admin',
    email: 'admin@pakipark.com',
    password: 'Admin2026!',
    role: 'admin',
    isVerified: true
  },
  {
    name: 'Business Partner 1 (SM Megamall)',
    email: 'partner1@pakipark.com',
    password: 'Partner2026!',
    role: 'business_partner',
    isVerified: true
  },
  {
    name: 'Business Partner 2 (Glorietta)',
    email: 'partner2@pakipark.com',
    password: 'Partner2026!',
    role: 'business_partner',
    isVerified: true
  },
  {
    name: 'Teller 1',
    email: 'teller1@pakipark.com',
    password: 'Teller2026!',
    role: 'teller',
    isVerified: true
  }
];

async function seedSystemUsers() {
  try {
    await sequelize.authenticate();
    console.log('Connected to database…');

    for (const u of USERS) {
      const hashedPassword = await bcrypt.hash(u.password, 10);
      
      // Upsert pattern: update if email exists, else create
      const [user, created] = await User.findOrCreate({
        where: { email: u.email },
        defaults: {
          ...u,
          password: hashedPassword
        }
      });

      if (!created) {
        // Update password and name if user already existed
        await user.update({
          name: u.name,
          password: hashedPassword,
          role: u.role,
          isVerified: true
        });
        console.log(`Updated existing user: ${u.email}`);
      } else {
        console.log(`Created new user: ${u.email}`);
      }
    }

    console.log('\n✅ System credentials seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
}

seedSystemUsers();
