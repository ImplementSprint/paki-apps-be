const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * ActivityLog — aligned with partner.activity_logs (NOT public).
 * Immutable — append-only, no updates.
 * userId stored as TEXT (Supabase UUID string) for cross-schema compatibility.
 */
const ActivityLog = sequelize.define(
  'ActivityLog',
  {
    id:       { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    adminId:  { type: DataTypes.UUID, allowNull: true, field: 'admin_id' },
    
    // Using virtual setter/getter for backward compatibility with logService
    userId: {
      type: DataTypes.VIRTUAL,
      get() { return this.getDataValue('adminId'); },
      set(val) { this.setDataValue('adminId', val); }
    },

    action:   { type: DataTypes.STRING(80), allowNull: false },

    targetType: { type: DataTypes.STRING(50), allowNull: true, field: 'target_type' },
    entityType: {
      type: DataTypes.VIRTUAL,
      get() { return this.getDataValue('targetType'); },
      set(val) { this.setDataValue('targetType', val); }
    },

    targetId: { type: DataTypes.UUID, allowNull: true, field: 'target_id' },
    entityId: {
      type: DataTypes.VIRTUAL,
      get() { return this.getDataValue('targetId'); },
      set(val) { this.setDataValue('targetId', val); }
    },

    details: { type: DataTypes.JSONB, defaultValue: {} },
    
    // Virtual fields packed into details on save
    description: { type: DataTypes.VIRTUAL },
    ipAddress:   { type: DataTypes.VIRTUAL },
    userAgent:   { type: DataTypes.VIRTUAL },
    severity:    { type: DataTypes.VIRTUAL },
    metadata:    { type: DataTypes.VIRTUAL },
  },
  {
    hooks: {
      beforeValidate: (log) => {
        const details = log.details || {};
        if (log.description) details.description = log.description;
        if (log.ipAddress)   details.ipAddress = log.ipAddress;
        if (log.userAgent)   details.userAgent = log.userAgent;
        if (log.severity)    details.severity = log.severity;
        if (log.metadata)    Object.assign(details, log.metadata);
        log.details = details;
      }
    },
    tableName:  'activity_logs',
    schema:     'partner',         // ← partner schema (NO public)
    timestamps: true,
    createdAt:  'created_at',
    updatedAt:  false,
    indexes: [
      { name: 'idx_partner_actlog_user',     fields: ['admin_id'] },
      { name: 'idx_partner_actlog_action',   fields: ['action'] },
      { name: 'idx_partner_actlog_entity',   fields: ['target_type', 'target_id'] },
    ],
  }
);

ActivityLog.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  return v;
};

module.exports = ActivityLog;
