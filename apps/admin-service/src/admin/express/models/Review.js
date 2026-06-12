'use strict';
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * Review — denormalized for zero-JOIN reads.
 * userName / userAvatar / locationName are captured at write time.
 */
const Review = sequelize.define(
  'Review',
  {
    id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // Soft FK references (no ORM associations — never JOIN)
    userId:     { type: DataTypes.INTEGER, allowNull: false },
    locationId: { type: DataTypes.INTEGER, allowNull: true },
    bookingId:  { type: DataTypes.INTEGER, allowNull: true },

    rating:  { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
    comment: { type: DataTypes.TEXT },

    // ── Snapshots ──────────────────────────────────────────────────────────────
    userName:     { type: DataTypes.STRING(120), allowNull: true },
    userAvatar:   { type: DataTypes.TEXT,        allowNull: true },
    locationName: { type: DataTypes.STRING(200), allowNull: true },
  },
  {
    tableName:  'reviews',
    schema: 'partner',
    timestamps: true,
    indexes: [
      { name: 'idx_reviews_location', fields: ['locationId'] },
      { name: 'idx_reviews_user',     fields: ['userId'] },
      { name: 'reviews_booking_unique', unique: true, fields: ['bookingId'] },
    ],
  }
);

Review.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  return v;
};

module.exports = Review;
