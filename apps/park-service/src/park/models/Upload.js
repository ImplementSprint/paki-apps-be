/**
 * Upload model — tracks every file stored on the server.
 * Aligned with teller.uploads (NOT public.uploads).
 * userId is UUID (Supabase auth id / account.profiles.id).
 *
 * ┌─────────────┬────────────────────────────────────────────────────────────┐
 * │  Column     │  Purpose                                                   │
 * ├─────────────┼────────────────────────────────────────────────────────────┤
 * │  userId     │  Owner of the file (UUID → account.profiles.id)           │
 * │  entityType │  'user_avatar' | 'vehicle_or' | 'vehicle_cr'              │
 * │  entityId   │  ID of the related row (userId for avatars, vehicleId…)    │
 * │  filename   │  Stored filename on disk (unique per upload)               │
 * │  originalName│ Original filename before upload                           │
 * │  mimeType   │  MIME type of the file                                     │
 * │  size       │  File size in bytes                                        │
 * │  url        │  Public URL path served via /uploads/…                     │
 * └─────────────┴────────────────────────────────────────────────────────────┘
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Upload = sequelize.define(
  'Upload',
  {
    id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId:       { type: DataTypes.UUID,    allowNull: false },
    entityType:   {
      type: DataTypes.ENUM('user_avatar', 'vehicle_or', 'vehicle_cr', 'discount_id', 'partner_doc'),
      allowNull: false,
    },
    entityId:     { type: DataTypes.INTEGER, allowNull: false },
    filename:     { type: DataTypes.STRING(255), allowNull: false },
    originalName: { type: DataTypes.STRING(255) },
    mimeType:     { type: DataTypes.STRING(100) },
    size:         { type: DataTypes.INTEGER },
    url:          { type: DataTypes.TEXT, allowNull: false },
  },
  {
    tableName:  'uploads',
    schema:     'teller',          // ← teller schema (NO public)
    timestamps: true,
    indexes: [
      { name: 'idx_teller_uploads_user',   fields: ['userId'] },
      { name: 'idx_teller_uploads_entity', fields: ['entityType', 'entityId'] },
    ],
  }
);

Upload.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  return v;
};

module.exports = Upload;
