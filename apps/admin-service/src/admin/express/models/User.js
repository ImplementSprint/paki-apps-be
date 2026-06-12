const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const User = sequelize.define(
  'User',
  {
    id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    authId:         { type: DataTypes.UUID,    allowNull: true,  unique: true },  // Supabase auth.users UUID
    name:           { type: DataTypes.STRING,  allowNull: false },
    email:          { type: DataTypes.STRING,  allowNull: false, unique: true },
    password:       { type: DataTypes.STRING,  allowNull: true },  // nullable — Supabase Auth owns credentials
    phone:          { type: DataTypes.STRING },
    role:           { type: DataTypes.ENUM('customer', 'admin', 'teller', 'business_partner'), defaultValue: 'customer' },
    profilePicture: { type: DataTypes.TEXT,    defaultValue: null },
    // { street, city, province }
    address:        { type: DataTypes.JSONB,   defaultValue: {} },
    dateOfBirth:    { type: DataTypes.DATEONLY },

    // ── Verification ──────────────────────────────────────────────────────────
    // Auto-set to true when phone + dateOfBirth + address are all non-empty.
    isVerified:     { type: DataTypes.BOOLEAN, defaultValue: false },

    // ── Special Discount (PWD / Senior Citizen) ───────────────────────────────
    // 'none'     → no discount request
    // 'pending'  → ID uploaded, awaiting admin approval
    // 'approved' → 20% discount active
    // 'rejected' → admin rejected the request
    discountStatus: {
      type: DataTypes.ENUM('none', 'pending', 'approved', 'rejected'),
      defaultValue: 'none',
    },
    discountPct:    { type: DataTypes.INTEGER,  defaultValue: 0 },        // 0 or 20
    discountIdUrl:  { type: DataTypes.TEXT,     defaultValue: null },      // uploaded ID image (base64 or URL)
    discountType:   { type: DataTypes.STRING(30), defaultValue: null },    // 'PWD' | 'senior_citizen'

    // ── Two-Factor Authentication (TOTP) ─────────────────────────────────────
    twoFactorSecret:  { type: DataTypes.STRING, defaultValue: null },      // TOTP base32 secret
    twoFactorEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },

    // { businessPermit, dtiSec, proofOfOwnership }
    documents:      { type: DataTypes.JSONB,   defaultValue: {} },

    // Notification preferences (stored as JSONB)
    preferences:    { type: DataTypes.JSONB,   defaultValue: { emailNotifications: true, smsUpdates: true, autoExtend: false } },
  },
  {
    tableName:  'users',
    schema: 'account',
    timestamps: true,
    indexes: [
      { name: 'users_email_unique', unique: true, fields: ['email'] },
      { name: 'users_auth_id_unique', unique: true, fields: ['authId'] },
      { name: 'idx_users_role', fields: ['role'] },
      { name: 'idx_users_name', fields: ['name'] },
      { name: 'idx_users_discount_status', fields: ['discountStatus'] },
    ],
  }
);

User.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  values._id = String(values.id);
  delete values.password;
  delete values.twoFactorSecret;  // never expose secret in API responses
  return values;
};

module.exports = User;