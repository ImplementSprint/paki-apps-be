const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * ActivityLog
 * -----------
 * Immutable audit trail for every user & admin action in the system.
 * One row per event — never updated, only appended.
 *
 * action naming convention:  ENTITY_VERB   e.g. BOOKING_CREATED, USER_LOGIN
 */
const ActivityLog = sequelize.define(
  'ActivityLog',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // Who performed the action (null = system / background job)
    userId: { type: DataTypes.INTEGER, allowNull: true },

    // Structured action identifier
    action: {
      type: DataTypes.STRING(80),
      allowNull: false,
      // e.g. BOOKING_CREATED | BOOKING_CANCELLED | BOOKING_CHECKIN |
      //      BOOKING_CHECKOUT | BOOKING_NO_SHOW |
      //      USER_REGISTERED  | USER_LOGIN      | USER_PROFILE_UPDATED |
      //      ADMIN_REGISTERED | ADMIN_LOGIN     |
      //      LOCATION_CREATED | LOCATION_UPDATED|
      //      SLOT_CREATED     | SLOT_UPDATED    | SLOTS_GENERATED |
      //      REVIEW_SUBMITTED | SETTINGS_UPDATED
    },

    // Which resource type was affected
    entityType: {
      type: DataTypes.STRING(50),
      allowNull: true,
      // e.g. Booking | User | Vehicle | Location | ParkingSlot | Review | Settings
    },

    // ID (as string) of the affected resource
    entityId: { type: DataTypes.STRING(30), allowNull: true },

    description: { type: DataTypes.TEXT, allowNull: true },

    // Request metadata
    ipAddress: { type: DataTypes.STRING(45), allowNull: true },
    userAgent: { type: DataTypes.TEXT,       allowNull: true },

    severity: {
      type: DataTypes.ENUM('info', 'warning', 'critical'),
      allowNull: false,
      defaultValue: 'info',
    },

    // Arbitrary extra data snapshot
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName:  'activity_logs',
    schema: 'partner',
    timestamps: true,
    updatedAt:  false,   // logs are append-only — no updates
    indexes: [
      { name: 'idx_actlog_user',       fields: ['userId'] },
      { name: 'idx_actlog_action',     fields: ['action'] },
      { name: 'idx_actlog_entity',     fields: ['entityType', 'entityId'] },
      { name: 'idx_actlog_severity',   fields: ['severity'] },
      { name: 'idx_actlog_createdat',  fields: ['createdAt'] },
    ],
  }
);

ActivityLog.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  return v;
};

module.exports = ActivityLog;
