const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * ParkingSlot — individual physical parking space within a Location.
 * e.g. Slot A1 on Floor 1 of Ayala Center.
 */
const ParkingSlot = sequelize.define(
  'ParkingSlot',
  {
    id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    locationId: { type: DataTypes.INTEGER, allowNull: false },
    label:      { type: DataTypes.STRING(20),  allowNull: false },   // "A1", "F2-B3"
    section:    { type: DataTypes.STRING(10),  allowNull: false },   // "A", "B"
    floor:      { type: DataTypes.INTEGER, defaultValue: 1 },
    type: {
      type: DataTypes.ENUM('regular', 'handicapped', 'ev_charging', 'vip', 'motorcycle'),
      defaultValue: 'regular',
    },
    // ── Physical size of this parking bay ────────────────────────────────────
    // compact  → motorcycles / micro-cars  (narrower bay)
    // standard → sedans, standard vehicles (default)
    // large    → SUVs, vans, trucks, EV chargers (extra-wide bay)
    size: {
      type: DataTypes.ENUM('compact', 'standard', 'large'),
      defaultValue: 'standard',
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('available', 'occupied', 'reserved', 'maintenance'),
      defaultValue: 'available',
    },
    vehicleTypeAllowed: {
      type: DataTypes.ENUM('sedan', 'suv', 'van', 'truck', 'motorcycle', 'any'),
      defaultValue: 'any',
    },
  },
  {
    tableName:  'parking_slots',
    schema: 'parking_lot',
    timestamps: true,
    indexes: [
      // ── Unique label per location ──────────────────────────────────────
      { name: 'parking_slots_location_label_unique', unique: true, fields: ['locationId', 'label'] },

      // ── Dashboard grid query: all slots for a location sorted by layout ─
      // SELECT * FROM parking_slots WHERE "locationId"=$1 ORDER BY floor, section, label
      { name: 'idx_parking_slots_location_layout', fields: ['locationId', 'floor', 'section'] },

      // ── Available-slot query: filter by status for auto-assign ─────────
      { name: 'idx_parking_slots_location_status', fields: ['locationId', 'status'] },

      // ── Type filter (e.g. find all EV slots for a location) ────────────
      { name: 'idx_parking_slots_location_type', fields: ['locationId', 'type'] },
    ],
  }
);

ParkingSlot.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  values._id = String(values.id);
  return values;
};

module.exports = ParkingSlot;