const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const Location = require('./Location');

/**
 * ParkingRate — aligned with parking_lot.parking_rates
 */
const ParkingRate = sequelize.define(
  'ParkingRate',
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    locationId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'location_id',
      references: {
        model: Location,
        key: 'id',
      },
    },
    type: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    rate: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      field: 'createdAt',
    },
    updatedAt: {
      type: DataTypes.DATE,
      field: 'updatedAt',
    },
  },
  {
    tableName: 'parking_rates',
    schema: 'parking_lot',
    timestamps: true,
  }
);

// Establish relationships
Location.hasMany(ParkingRate, { foreignKey: 'locationId', as: 'parkingRates' });
ParkingRate.belongsTo(Location, { foreignKey: 'locationId', as: 'location' });

ParkingRate.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  values._id = String(values.id);
  return values;
};

module.exports = ParkingRate;
