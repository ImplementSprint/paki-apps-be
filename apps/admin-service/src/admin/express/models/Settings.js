const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Settings = sequelize.define(
  'Settings',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    key: { type: DataTypes.STRING, allowNull: false, unique: true },
    /** Any JSON value — string, number, boolean, object, array */
    value: { type: DataTypes.JSONB, allowNull: false },
    category: {
      type: DataTypes.ENUM('system', 'security', 'notifications', 'payment'),
      allowNull: false,
    },
  },
  {
    tableName:  'settings',
    schema: 'teller',
    timestamps: true,
    indexes: [
      // ── Unique key lookup ──────────────────────────────────────────────
      { name: 'settings_key_unique', unique: true, fields: ['key'] },

      // ── Load all settings by category ─────────────────────────────────
      { name: 'idx_settings_category', fields: ['category'] },
    ],
  }
);

Settings.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  values._id = String(values.id);
  return values;
};

module.exports = Settings;