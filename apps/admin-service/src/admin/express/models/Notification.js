'use strict';
/**
 * Notification model
 * ==================
 * Stores every in-app notification for a user.
 * Types: booking_confirmed | booking_cancelled | booking_reminder |
 *        no_show | discount_approved | discount_rejected |
 *        registration_rejected | system
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Notification = sequelize.define(
  'Notification',
  {
    id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId:     { type: DataTypes.INTEGER, allowNull: false },
    type: {
      type: DataTypes.ENUM(
        'booking_confirmed',
        'booking_cancelled',
        'booking_reminder',
        'no_show',
        'discount_approved',
        'discount_rejected',
        'registration_rejected',
        'system'
      ),
      allowNull: false,
    },
    title:      { type: DataTypes.STRING(200), allowNull: false },
    body:       { type: DataTypes.TEXT,        allowNull: false },
    isRead:     { type: DataTypes.BOOLEAN,     defaultValue: false },
    entityType: { type: DataTypes.STRING(50),  defaultValue: null },  // 'Booking' | 'User' | ...
    entityId:   { type: DataTypes.INTEGER,     defaultValue: null },  // related row ID
  },
  {
    tableName:  'notifications',
    schema: 'notifications',
    timestamps: true,
    indexes: [
      // Primary read path: user's unread notifications (bell badge count)
      { name: 'idx_notifications_user_read', fields: ['userId', 'isRead'] },
      // List notifications for a user, newest first
      { name: 'idx_notifications_user_createdat', fields: ['userId', 'createdAt'] },
    ],
  }
);

Notification.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  return v;
};

module.exports = Notification;
