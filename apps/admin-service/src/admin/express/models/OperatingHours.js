const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const OperatingHours = sequelize.define(
  'OperatingHours',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    locationId: { type: DataTypes.INTEGER, allowNull: false },
    dayOfWeek: { type: DataTypes.SMALLINT, allowNull: false, field: 'day_of_week' },
    openTime: { type: DataTypes.TIME, field: 'open_time' },
    closeTime: { type: DataTypes.TIME, field: 'close_time' },
    isClosed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_closed' },
  },
  {
    tableName: 'operating_hours',
    schema: 'parking_lot',
    timestamps: true,
    indexes: [{ name: 'idx_operating_hours_location', fields: ['locationId'] }],
  }
);

OperatingHours.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  values._id = String(values.id);
  return values;
};

module.exports = OperatingHours;
