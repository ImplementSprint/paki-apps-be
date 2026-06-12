const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * Vehicle — aligned with teller.vehicles (NOT public).
 * Managed by tellers; userId is an integer FK to account.users.id.
 */
const Vehicle = sequelize.define(
  'Vehicle',
  {
    id:          { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    userId:      { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
    brand:       { type: DataTypes.STRING,  allowNull: false },
    model:       { type: DataTypes.STRING,  allowNull: false },
    color:       { type: DataTypes.STRING,  allowNull: false },
    plateNumber: { type: DataTypes.STRING,  allowNull: false, field: 'plate_number' },
    type: {
      type: DataTypes.ENUM('sedan', 'suv', 'van', 'truck', 'motorcycle', 'hatchback', 'pickup'),
      defaultValue: 'sedan',
    },
    orDoc:     { type: DataTypes.TEXT,    defaultValue: null, field: 'or_doc' },
    crDoc:     { type: DataTypes.TEXT,    defaultValue: null, field: 'cr_doc' },
    isDefault: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'is_default' },
  },
  {
    tableName:  'vehicles',
    schema:     'teller',          // ← teller schema (NO public)
    timestamps: true,
    createdAt:  'created_at',
    updatedAt:  'updated_at',
    indexes: [
      { name: 'idx_teller_vehicles_user',  fields: ['user_id'] },
      { name: 'idx_teller_vehicles_plate', fields: ['plate_number'] },
    ],
  }
);

Vehicle.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  values._id = String(values.id);
  return values;
};

module.exports = Vehicle;
