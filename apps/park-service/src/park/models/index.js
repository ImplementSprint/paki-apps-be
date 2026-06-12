'use strict';
/**
 * models/index.js
 * ===============
 * Exports all Sequelize models.
 *
 * DESIGN DECISION — Loosely Coupled (No ORM Associations):
 * ---------------------------------------------------------
 * PakiPark uses a *denormalized / snapshot* approach for Booking and Review.
 * User, vehicle, and location data is copied into each booking row at creation
 * time (see userName, vehiclePlate, locationName, etc. columns).
 *
 * As a result:
 *   • NO Sequelize associations are defined here.
 *   • NO `include: [...]` (JOIN) is used anywhere in the application.
 *   • All booking reads are single-table index lookups — O(log n), no JOIN cost.
 *   • Historical records are self-contained even if a user/vehicle/location
 *     is later updated or deleted.
 *
 * Integer FK columns (userId, vehicleId, locationId, parkingSlotId) are kept
 * in the Booking model purely for referential integrity auditing and admin
 * tooling; they are never used for SELECT … JOIN in the app layer.
 */

const User           = require('./User');
const Location       = require('./Location');
const Vehicle        = require('./Vehicle');
const ParkingSlot    = require('./ParkingSlot');
const Booking        = require('./Booking');
const Review         = require('./Review');
const Settings       = require('./Settings');
const ParkingRate    = require('./ParkingRate');
const TransactionLog = require('./TransactionLog');
const ActivityLog    = require('./ActivityLog');
const Upload         = require('./Upload');
const Notification   = require('./Notification');
const PaymentMethod  = require('./PaymentMethod');   // SCRUM-1014 GCash Link
const OperatingHours = require('./OperatingHours');  // Partner Operating Hours

// No associations — loosely coupled by design.

module.exports = {
  User,
  Location,
  Vehicle,
  ParkingSlot,
  Booking,
  Review,
  Settings,
  ParkingRate,
  TransactionLog,
  ActivityLog,
  Upload,
  Notification,
  PaymentMethod,
  OperatingHours,
};
