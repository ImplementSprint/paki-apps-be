const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Vehicle = sequelize.define(
  'Vehicle',
  {
    id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId:      { type: DataTypes.INTEGER, allowNull: false },
    brand:       { type: DataTypes.STRING,  allowNull: false },
    model:       { type: DataTypes.STRING,  allowNull: false },
    color:       { type: DataTypes.STRING,  allowNull: false },
    plateNumber: { type: DataTypes.STRING,  allowNull: false },
    type: {
      type: DataTypes.ENUM('sedan', 'suv', 'van', 'truck', 'motorcycle', 'hatchback', 'pickup'),
      defaultValue: 'sedan',
    },
    orDoc:       { type: DataTypes.TEXT,    defaultValue: null },
    crDoc:       { type: DataTypes.TEXT,    defaultValue: null },
    isDefault:   { type: DataTypes.BOOLEAN, defaultValue: false }, // pre-selected for new bookings
  },
  {
    tableName:  'vehicles',
    schema: 'teller',
    timestamps: true,
    indexes: [
      // SELECT * FROM vehicles WHERE "userId"=$1
      { name: 'idx_vehicles_user', fields: ['userId'] },

      // Plate number lookup (admin search, conflict checks)
      { name: 'idx_vehicles_plate', fields: ['plateNumber'] },
    ],
  }
);

Vehicle.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  values._id = String(values.id);
  return values;
};

module.exports = Vehicle;
