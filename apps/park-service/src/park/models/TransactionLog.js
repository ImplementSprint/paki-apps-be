const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * TransactionLog — aligned with reservation.transaction_logs (NOT public).
 * Immutable — append-only, no updates.
 * bookingId/userId are UUID (reservation.bookings uses integer id, but
 * reservation.transaction_logs uses UUID for booking_id and user_id per schema).
 */
const TransactionLog = sequelize.define(
  'TransactionLog',
  {
    id:        { type: DataTypes.UUID,    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    bookingId: { type: DataTypes.UUID,    allowNull: true,  field: 'booking_id' },
    userId:    { type: DataTypes.UUID,    allowNull: true,  field: 'user_id' },
    type:      { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'payment' },
    amount:    { type: DataTypes.FLOAT,   allowNull: false },
    details:   { type: DataTypes.JSONB,   defaultValue: {} },
  },
  {
    tableName:  'transaction_logs',
    schema:     'reservation',     // ← reservation schema (NO public)
    timestamps: true,
    createdAt:  'created_at',
    updatedAt:  'updated_at',
    indexes: [
      { name: 'idx_res_txlogs_booking', fields: ['booking_id'] },
      { name: 'idx_res_txlogs_user',    fields: ['user_id'] },
      { name: 'idx_res_txlogs_type',    fields: ['type'] },
    ],
  }
);

TransactionLog.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  return v;
};

module.exports = TransactionLog;
