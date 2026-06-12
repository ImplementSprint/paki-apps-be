const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * OperatingHours — aligned with routing.operating_hours (NOT public).
 * locationId is UUID (routing.operator_hubs.id).
 * Newly created table per domain schema migration.
 */
const OperatingHours = sequelize.define('OperatingHours', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  locationId: {
    type:      DataTypes.UUID,
    allowNull: false,
    field:     'locationId',
  },
  day_of_week: {
    type:     DataTypes.SMALLINT,
    allowNull: false,
    validate:  { min: 0, max: 6 },
  },
  open_time:  { type: DataTypes.TIME,    allowNull: true },
  close_time: { type: DataTypes.TIME,    allowNull: true },
  is_closed:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  schema:     'routing',           // ← routing schema (NO public)
  tableName:  'operating_hours',
  timestamps: true,
  indexes: [
    { name: 'uq_routing_operating_hours_location_day', unique: true, fields: ['locationId', 'day_of_week'] },
    { name: 'idx_routing_op_hours_location',           fields: ['locationId'] },
  ],
});

module.exports = OperatingHours;
