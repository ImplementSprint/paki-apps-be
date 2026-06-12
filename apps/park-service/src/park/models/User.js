const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * User — master profile model.
 * Maps to account.profiles (domain schema — NOT public).
 */
const User = sequelize.define(
  'User',
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'full_name',
    },
    firstName: {
      type: DataTypes.VIRTUAL,
      get() {
        const name = this.getDataValue('name') || '';
        return name.split(' ')[0] || '';
      },
      set(val) {
        const parts = (this.getDataValue('name') || '').split(' ');
        parts[0] = val;
        this.setDataValue('name', parts.join(' '));
      }
    },
    lastName: {
      type: DataTypes.VIRTUAL,
      get() {
        const name = this.getDataValue('name') || '';
        return name.split(' ').slice(1).join(' ') || '';
      },
      set(val) {
        const parts = (this.getDataValue('name') || '').split(' ');
        this.setDataValue('name', [parts[0] || '', val].join(' ').trim());
      }
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.VIRTUAL,
      defaultValue: '[SUPABASE_MANAGED]',
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    role: {
      type: DataTypes.STRING,
      defaultValue: 'customer',
    },
    profilePicture: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'profile_picture',
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    province: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    dateOfBirth: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: 'dob',
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_verified',
    },

    // Verification / Partner statuses (Virtual for compatibility)
    discountStatus: {
      type: DataTypes.VIRTUAL,
      defaultValue: 'none',
    },
    discountPct: {
      type: DataTypes.VIRTUAL,
      defaultValue: 0,
    },
    discountIdUrl: {
      type: DataTypes.VIRTUAL,
    },
    discountType: {
      type: DataTypes.VIRTUAL,
    },

    // Security
    twoFactorSecret: {
      type: DataTypes.VIRTUAL,
    },
    twoFactorEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'two_factor_enabled',
    },

    // Metadata
    documents: {
      type: DataTypes.JSONB,
      defaultValue: {},
    },
    preferences: {
      type: DataTypes.JSONB,
      field: 'notification_preferences',
      defaultValue: { autoExtend: false, smsUpdates: true, emailNotifications: true },
    },
    gcashNumber: {
      type: DataTypes.VIRTUAL,
    },
    paymentMethods: {
      type: DataTypes.VIRTUAL,
      defaultValue: [],
    },

    // PWD / Senior verification
    isVerifiedPWD: {
      type: DataTypes.VIRTUAL,
      defaultValue: false,
    },

    // Soft-delete
    deletedAt: {
      type: DataTypes.VIRTUAL,
    },

    // Auth linking (profiles table id IS the supabase auth id)
    supabaseId: {
      type: DataTypes.VIRTUAL,
      get() {
        return this.getDataValue('id');
      }
    },
  },
  {
    tableName: 'profiles',
    schema:    'account',          // ← account schema (NO public)
    timestamps: false,
  }
);

User.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  delete values.password;
  values._id = String(values.id);
  values.name = values.name || `${values.firstName || ''} ${values.lastName || ''}`.trim();
  return values;
};

module.exports = User;