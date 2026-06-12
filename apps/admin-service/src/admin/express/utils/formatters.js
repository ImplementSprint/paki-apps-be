'use strict';
/**
 * formatters.js
 * =============
 * Converts Sequelize model instances to the JSON shape the frontend expects.
 *
 * With the denormalized schema the frontend's nested `userId / vehicleId /
 * locationId` objects are reconstructed from the booking's snapshot columns —
 * no JOIN or Sequelize association needed.
 */

const toPlain = (v) => (v ? (v.toJSON ? v.toJSON() : v) : null);
const withId  = (obj) => (obj ? { ...obj, _id: String(obj.id) } : null);

/**
 * Build the nested userId / vehicleId / locationId objects expected by the
 * frontend from the flat snapshot columns stored on every booking row.
 *
 * Falls back to the old association-populated fields (`b.user`, `b.vehicle`,
 * `b.location`) so that rows created before the schema migration still render
 * correctly without a re-seed.
 */
const formatBooking = (booking) => {
  if (!booking) return null;
  const b = toPlain(booking);
  const result = { ...b, _id: String(b.id) };

  // ── userId (user snapshot) ──────────────────────────────────────────────────
  if (b.userName || b.userEmail) {
    result.userId = {
      _id:   String(b.userId),
      name:  b.userName  || '',
      email: b.userEmail || '',
      phone: b.userPhone || '',
    };
  } else if (b.user) {
    // legacy fallback (JOIN-populated — only during migration window)
    result.userId = withId(b.user);
  }

  // ── vehicleId (vehicle snapshot) ───────────────────────────────────────────
  if (b.vehicleBrand || b.vehiclePlate) {
    result.vehicleId = {
      _id:         String(b.vehicleId),
      brand:       b.vehicleBrand || '',
      model:       b.vehicleModel || '',
      plateNumber: b.vehiclePlate || '',
      type:        b.vehicleType  || '',
      color:       b.vehicleColor || '',
    };
  } else if (b.vehicle) {
    result.vehicleId = withId(b.vehicle);
  }

  // ── locationId (location snapshot) ─────────────────────────────────────────
  if (b.locationName) {
    result.locationId = {
      _id:     String(b.locationId),
      name:    b.locationName    || '',
      address: b.locationAddress || '',
    };
  } else if (b.location) {
    result.locationId = withId(b.location);
  }

  // Clean up any residual association keys (defensive)
  delete result.user;
  delete result.vehicle;
  delete result.location;
  delete result.parkingSlot;

  return result;
};

/**
 * Format a Review — reconstruct userId / locationId from snapshot columns.
 */
const formatReview = (review) => {
  if (!review) return null;
  const r = toPlain(review);
  const result = { ...r, _id: String(r.id) };

  // User snapshot
  if (r.userName) {
    result.userId = {
      _id:            String(r.userId),
      name:           r.userName   || '',
      profilePicture: r.userAvatar || null,
    };
  } else if (r.user) {
    result.userId = withId(r.user);
  }

  // Location snapshot
  if (r.locationName) {
    result.locationId = {
      _id:  String(r.locationId),
      name: r.locationName || '',
    };
  } else if (r.location) {
    result.locationId = withId(r.location);
  }

  delete result.user;
  delete result.location;

  return result;
};

module.exports = { withId, toPlain, formatBooking, formatReview };
