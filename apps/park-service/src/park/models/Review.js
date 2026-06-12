'use strict';
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * Review — aligned with partner.reviews (NOT public).
 * userId is UUID (Supabase auth id / account.profiles.id).
 * locationId is UUID (routing.operator_hubs.id).
 * bookingId is INTEGER (reservation.bookings.id).
 */
const Review = sequelize.define(
  'Review',
  {
    id:         { type: DataTypes.UUID,    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    userId:     { type: DataTypes.UUID,    allowNull: false, field: 'user_id' },
    locationId: { type: DataTypes.UUID,    allowNull: true,  field: 'location_id' },
    bookingId:  { type: DataTypes.INTEGER, allowNull: true,  field: 'booking_id' },
    rating:     { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
    comment:    { type: DataTypes.TEXT },

    // ── Snapshots (captured at write time) ────────────────────────────────────
    userName:     { type: DataTypes.STRING(120), allowNull: true },
    userAvatar:   { type: DataTypes.TEXT,        allowNull: true },
    locationName: { type: DataTypes.STRING(200), allowNull: true },
  },
  {
    tableName:  'reviews',
    schema:     'partner',         // ← partner schema (NO public)
    timestamps: true,
    indexes: [
      { name: 'idx_partner_reviews_location', fields: ['locationId'] },
      { name: 'idx_partner_reviews_user',     fields: ['userId'] },
    ],
  }
);

Review.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  return v;
};

module.exports = Review;
