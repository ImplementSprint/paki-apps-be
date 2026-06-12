'use strict';
/**
 * Notification model
 * ==================
 * Aligned with account.customer_notifications (NOT public.notifications).
 * userId is UUID (account.profiles.id / Supabase auth id).
 *
 * Column mapping:
 *   public.notifications.body  → account.customer_notifications.message
 *   public.notifications.isRead → account.customer_notifications.is_read
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Notification = sequelize.define(
  'Notification',
  {
    id:     { type: DataTypes.UUID,    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    userId: { type: DataTypes.UUID,    allowNull: false, field: 'user_id' },
    type:   { type: DataTypes.STRING(80), allowNull: false },
    title:  { type: DataTypes.STRING(200), allowNull: false },
    // 'message' is the actual DB column name; 'body' kept as alias for backward compat
    message: { type: DataTypes.TEXT,    allowNull: false },
    isRead:  { type: DataTypes.BOOLEAN, defaultValue: false, field: 'is_read' },
  },
  {
    tableName:  'customer_notifications',
    schema:     'account',         // ← account schema (NO public)
    timestamps: true,
    createdAt:  'created_at',
    updatedAt:  false,
    indexes: [
      { name: 'idx_acct_notif_user_read',      fields: ['user_id', 'is_read'] },
      { name: 'idx_acct_notif_user_createdat', fields: ['user_id', 'created_at'] },
    ],
  }
);

Notification.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  // Backward compat alias
  v.body = v.message;
  return v;
};

module.exports = Notification;
