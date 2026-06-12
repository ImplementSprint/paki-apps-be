const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * Settings — aligned with teller.settings (NOT public.settings).
 * Key/value store for teller configuration.
 */
const Settings = sequelize.define(
  'Settings',
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    key:   { type: DataTypes.STRING, allowNull: false, unique: true },
    /** Any JSON value — string, number, boolean, object, array */
    value: { type: DataTypes.JSONB, allowNull: false },
  },
  {
    tableName:  'settings',
    schema:     'teller',          // ← teller schema (NO public)
    timestamps: true,
    updatedAt:  'updated_at',
    createdAt:  false,
    indexes: [
      { name: 'teller_settings_key_unique', unique: true, fields: ['key'] },
    ],
  }
);

Settings.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  values._id = String(values.id);
  return values;
};

module.exports = Settings;