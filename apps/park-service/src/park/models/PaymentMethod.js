const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * PaymentMethod — aligned with payment.payment_methods (NOT public).
 * userId is UUID (Supabase auth id / account.profiles.id).
 */
const PaymentMethod = sequelize.define('PaymentMethod', {
  id:     { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.UUID,    allowNull: false, field: 'userId' },
  provider: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'GCash',
  },
  mobileNumber:  { type: DataTypes.STRING(20), allowNull: true,  field: 'mobile_number' },
  displayLabel:  { type: DataTypes.STRING(60), allowNull: true,  field: 'display_label' },
  isDefault:     { type: DataTypes.BOOLEAN,    defaultValue: false, field: 'is_default' },
}, {
  schema:    'payment',            // ← payment schema (NO public)
  tableName: 'payment_methods',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  indexes: [
    { name: 'idx_payment_methods_user', fields: ['userId'] },
  ],
});

PaymentMethod.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  return v;
};

module.exports = PaymentMethod;
