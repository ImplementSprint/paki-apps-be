const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const ParkingRate = sequelize.define(
  'ParkingRate',
  {
    id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    vehicleType: { type: DataTypes.STRING,  allowNull: false, unique: true },
    hourlyRate:  { type: DataTypes.FLOAT,   allowNull: false },
    dailyRate:   { type: DataTypes.FLOAT,   allowNull: false },
  },
  {
    tableName:  'parking_rates',
    schema: 'parking_lot',
    timestamps: true,
    indexes: [
      // ── Rate lookup by vehicle type ────────────────────────────────────
      { name: 'parking_rates_vehicle_type_unique', unique: true, fields: ['vehicleType'] },
    ],
  }
);

ParkingRate.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  values._id = String(values.id);
  return values;
};

module.exports = ParkingRate;
