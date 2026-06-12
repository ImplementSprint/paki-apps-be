const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * TransactionLog
 * --------------
 * Immutable financial record for every payment, refund, and reversal.
 * One row per monetary event — never updated, only appended.
 */
const TransactionLog = sequelize.define(
  'TransactionLog',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // FK references (soft — no DB-level cascade so logs survive entity deletes)
    bookingId: { type: DataTypes.INTEGER, allowNull: true },
    userId:    { type: DataTypes.INTEGER, allowNull: true },

    // Human-readable reference (copy of booking.reference, e.g. PKP-00000001)
    reference: { type: DataTypes.STRING(30), allowNull: true },

    // Financial details
    transactionType: {
      type: DataTypes.ENUM('payment', 'refund', 'partial_refund', 'reversal', 'adjustment'),
      allowNull: false,
      defaultValue: 'payment',
    },
    paymentMethod: {
      type: DataTypes.ENUM('GCash', 'PayMaya', 'Credit/Debit Card', 'Cash', 'System'),
      allowNull: false,
    },
    amount:   { type: DataTypes.FLOAT,       allowNull: false },
    currency: { type: DataTypes.STRING(5),   allowNull: false, defaultValue: 'PHP' },

    status: {
      type: DataTypes.ENUM('success', 'failed', 'pending', 'refunded'),
      allowNull: false,
      defaultValue: 'success',
    },

    description: { type: DataTypes.TEXT,  allowNull: true },

    // Arbitrary extra data (card last 4, GCash number, error code, etc.)
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName:  'transaction_logs',
    schema: 'reservation',
    timestamps: true,
    updatedAt:  false,   // logs are append-only — no updates
    indexes: [
      { name: 'idx_txlogs_booking',   fields: ['bookingId'] },
      { name: 'idx_txlogs_user',      fields: ['userId'] },
      { name: 'idx_txlogs_reference', fields: ['reference'] },
      { name: 'idx_txlogs_type',      fields: ['transactionType'] },
      { name: 'idx_txlogs_status',    fields: ['status'] },
      { name: 'idx_txlogs_createdat', fields: ['createdAt'] },
    ],
  }
);

TransactionLog.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  return v;
};

module.exports = TransactionLog;
