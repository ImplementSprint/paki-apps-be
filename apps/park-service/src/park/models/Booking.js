'use strict';
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * Booking — fully denormalized for zero-JOIN reads.
 * Aligned with reservation.bookings schema (NOT public).
 *
 * All FK columns are UUID to match the canonical reservation schema.
 */
const Booking = sequelize.define(
  'Booking',
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },

    // ── Soft FK references ────────────────────────────────────────────────────
    userId:        { type: DataTypes.UUID,    allowNull: false, field: 'user_id' },
    vehicleId:     { type: DataTypes.UUID,    allowNull: true,  field: 'vehicle_id' },
    locationId:    { type: DataTypes.UUID,    allowNull: false, field: 'location_id' },
    parkingSlotId: { type: DataTypes.UUID,    allowNull: true,  field: 'parking_slot_id' },

    // ── Booking identity ──────────────────────────────────────────────────────
    reference: { type: DataTypes.STRING(30), unique: true },
    barcode:   { type: DataTypes.STRING(50), allowNull: true, unique: true },
    spot:      { type: DataTypes.STRING(20), allowNull: true },

    // ── Schedule ──────────────────────────────────────────────────────────────
    date:     { type: DataTypes.DATEONLY,   allowNull: false },
    timeSlot: { type: DataTypes.STRING(20), allowNull: false },
    type:     { type: DataTypes.STRING(50), defaultValue: '1-Hour Slot' },

    // ── Status / payment ──────────────────────────────────────────────────────
    status:        { type: DataTypes.STRING, defaultValue: 'upcoming' },
    amount:        { type: DataTypes.FLOAT,  allowNull: false },
    finalAmount:   { type: DataTypes.VIRTUAL },
    paymentMethod: { type: DataTypes.STRING, allowNull: false },
    paymentStatus: { type: DataTypes.STRING, defaultValue: 'pending' },
    paymentSessionId: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'payment_session_id',
    },

    // ── Teller flags ──────────────────────────────────────────────────────────
    checkedInByTeller: { type: DataTypes.BOOLEAN, defaultValue: false },

    // ── Lifecycle timestamps ──────────────────────────────────────────────────
    checkInAt:   { type: DataTypes.DATE, allowNull: true },
    checkOutAt:  { type: DataTypes.DATE, allowNull: true },
    cancelledAt: { type: DataTypes.VIRTUAL },
    cancelReason: { type: DataTypes.VIRTUAL },
    reminderSentAt: { type: DataTypes.VIRTUAL },

    // ── User snapshot (VIRTUAL — not in reservation.bookings) ─────────────────
    userName:  { type: DataTypes.VIRTUAL },
    userEmail: { type: DataTypes.VIRTUAL },
    userPhone: { type: DataTypes.VIRTUAL },

    // ── Vehicle snapshot ──────────────────────────────────────────────────────
    vehicleBrand: { type: DataTypes.VIRTUAL },
    vehicleModel: { type: DataTypes.VIRTUAL },
    vehiclePlate: { type: DataTypes.STRING(20), allowNull: true },
    vehicleType:  { type: DataTypes.STRING(20), allowNull: true },
    vehicleColor: { type: DataTypes.STRING(30), allowNull: true },

    // ── Location snapshot ─────────────────────────────────────────────────────
    locationName:    { type: DataTypes.STRING(200), allowNull: true },
    locationAddress: { type: DataTypes.STRING(400), allowNull: true },
  },
  {
    tableName:  'bookings',
    schema:     'reservation',
    timestamps: true,
    indexes: [
      { name: 'res_bookings_reference_unique', unique: true, fields: ['reference'] },
      { name: 'res_bookings_barcode_unique',   unique: true, fields: ['barcode'] },
    ],
  }
);

// ── Auto-generate reference + barcode on create ──────────────────────────────
Booking.addHook('beforeCreate', async (booking) => {
  // Try to use the sequence if available, fallback to timestamp+random
  let padded;
  try {
    const [[row]] = await sequelize.query("SELECT nextval('public.booking_reference_seq') AS n");
    padded = String(row.n).padStart(8, '0');
  } catch (_) {
    // Sequence not available — generate a unique ref from timestamp + random
    const ts   = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    padded = `${ts}${rand}`;
  }
  booking.reference = `PKP-${padded}`;
  booking.barcode   = `PKP${padded}`;
});

Booking.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  return v;
};

module.exports = Booking;
