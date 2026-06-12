'use strict';
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * Booking — fully denormalized for zero-JOIN reads.
 *
 * All user / vehicle / location data that the UI needs is stored as snapshot
 * columns at booking-creation time.  Reads never JOIN — they are single-table
 * index lookups.
 *
 * FK integer columns (userId, vehicleId, locationId, parkingSlotId) are kept
 * for referential integrity checks and admin tooling, but are NEVER used in
 * SELECT … JOIN queries from the application layer.
 */
const Booking = sequelize.define(
  'Booking',
  {
    id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // ── Soft FK references (integer IDs only — no ORM associations) ────────────
    userId:        { type: DataTypes.INTEGER, allowNull: false },
    vehicleId:     { type: DataTypes.INTEGER, allowNull: false },
    locationId:    { type: DataTypes.INTEGER, allowNull: false },
    parkingSlotId: { type: DataTypes.INTEGER, allowNull: true },

    // ── Booking identity ───────────────────────────────────────────────────────
    reference: { type: DataTypes.STRING(30), unique: true },
    barcode:   { type: DataTypes.STRING(50), allowNull: true, unique: true },
    spot:      { type: DataTypes.STRING(20), allowNull: false },

    // ── Schedule ───────────────────────────────────────────────────────────────
    date:     { type: DataTypes.DATEONLY,   allowNull: false },
    timeSlot: { type: DataTypes.STRING(20), allowNull: false },   // "10:00 - 11:00"
    type:     { type: DataTypes.STRING(50), defaultValue: '1-Hour Slot' },

    // ── Status / payment ───────────────────────────────────────────────────────
    status: {
      type: DataTypes.ENUM('upcoming', 'active', 'completed', 'cancelled'),
      defaultValue: 'upcoming',
    },
    amount:        { type: DataTypes.FLOAT, allowNull: false },
    paymentMethod: {
      type: DataTypes.ENUM('GCash', 'PayMaya', 'Credit/Debit Card', 'gcash_linked'),
      allowNull: false,
    },
    paymentStatus: {
      type: DataTypes.ENUM('paid', 'pending', 'partial', 'refunded'),
      defaultValue: 'pending',
    },

    // ── Teller / Operation flags ──────────────────────────────────────────────
    checkedInByTeller: { type: DataTypes.BOOLEAN, defaultValue: false },

    // ── Lifecycle timestamps ───────────────────────────────────────────────────
    checkInAt:       { type: DataTypes.DATE, allowNull: true },
    checkOutAt:      { type: DataTypes.DATE, allowNull: true },
    cancelledAt:     { type: DataTypes.DATE, allowNull: true },
    cancelReason:    { type: DataTypes.TEXT, allowNull: true },
    finalAmount:     { type: DataTypes.FLOAT, allowNull: true },   // computed at checkout (₱15/hr × elapsed hrs)
    reminderSentAt:  { type: DataTypes.DATE, allowNull: true },    // set when 30-min reminder notification is sent


    // ── User snapshot (captured at booking-creation, never JOIN-fetched) ───────
    userName:  { type: DataTypes.STRING(120), allowNull: true },
    userEmail: { type: DataTypes.STRING(200), allowNull: true },
    userPhone: { type: DataTypes.STRING(30),  allowNull: true },

    // ── Vehicle snapshot ───────────────────────────────────────────────────────
    vehicleBrand: { type: DataTypes.STRING(60), allowNull: true },
    vehicleModel: { type: DataTypes.STRING(60), allowNull: true },
    vehiclePlate: { type: DataTypes.STRING(20), allowNull: true },
    vehicleType:  { type: DataTypes.STRING(20), allowNull: true },  // also used by analytics
    vehicleColor: { type: DataTypes.STRING(30), allowNull: true },

    // ── Location snapshot ──────────────────────────────────────────────────────
    locationName:    { type: DataTypes.STRING(200), allowNull: true },
    locationAddress: { type: DataTypes.STRING(400), allowNull: true },
  },
  {
    tableName:  'bookings',
    schema: 'reservation',
    timestamps: true,
    indexes: [
      // ── Unique constraints ─────────────────────────────────────────────────
      { name: 'bookings_reference_unique', unique: true,  fields: ['reference'] },
      { name: 'bookings_barcode_unique',   unique: true,  fields: ['barcode'] },

      // ── Core read paths ────────────────────────────────────────────────────
      // Dashboard: all bookings for a location on a date (no JOIN needed)
      { name: 'idx_bookings_location_date_status', fields: ['locationId', 'date', 'status'] },

      // Conflict check: specific slot on a date
      { name: 'idx_bookings_slot_date_status', fields: ['parkingSlotId', 'date', 'status'] },

      // Customer booking list (newest first)
      { name: 'idx_bookings_user_createdat', fields: ['userId', 'createdAt'] },

      // Customer bookings filtered by status
      { name: 'idx_bookings_user_status', fields: ['userId', 'status'] },

      // Admin date/status/location filters
      { name: 'idx_bookings_date',            fields: ['date'] },
      { name: 'idx_bookings_status',          fields: ['status'] },
      { name: 'idx_bookings_location_status', fields: ['locationId', 'status'] },

      // Analytics: vehicle-type distribution without JOIN
      { name: 'idx_bookings_vehicle_type', fields: ['vehicleType'] },

      // Teller barcode scan
      { name: 'idx_bookings_barcode', fields: ['barcode'] },
    ],
  }
);

// ── Auto-generate reference + barcode on create ─────────────────────────────
Booking.addHook('beforeCreate', async (booking) => {
  const [[row]] = await sequelize.query("SELECT nextval('booking_reference_seq') AS n");
  const padded = String(row.n).padStart(8, '0');
  booking.reference = `PKP-${padded}`;
  booking.barcode   = `PKP${padded}`;
});

Booking.prototype.toJSON = function () {
  const v = Object.assign({}, this.get());
  v._id = String(v.id);
  return v;
};

module.exports = Booking;
