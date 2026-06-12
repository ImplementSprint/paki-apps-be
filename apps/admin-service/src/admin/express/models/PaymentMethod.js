const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const PaymentMethod = sequelize.define(
  'PaymentMethod',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    provider: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'GCash' },
    mobileNumber: { type: DataTypes.STRING(20), field: 'mobile_number' },
    displayLabel: { type: DataTypes.STRING(60), field: 'display_label' },
    isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_default' },
  },
  {
    tableName: 'payment_methods',
    schema: 'payment',
    timestamps: true,
  }
);

PaymentMethod.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  values._id = String(values.id);
  return values;
};

module.exports = PaymentMethod;
