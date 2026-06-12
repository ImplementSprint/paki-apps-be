'use strict';
/**
 * notificationService.js
 * ======================
 * Central helper for writing Notification rows.
 * All writes are fire-and-forget — errors are swallowed so a notification
 * failure NEVER crashes the business-logic path.
 *
 * Usage:
 *   const { notify } = require('./notificationService');
 *   notify(userId, 'booking_confirmed', 'Booking Confirmed!', 'Your slot PKP-00000001 is ready.', 'Booking', bookingId);
 */

const { Notification } = require('../models/index');

/**
 * Create a notification row.
 * @param {number}      userId      - recipient user ID
 * @param {string}      type        - one of the ENUM values in Notification model
 * @param {string}      title       - short heading shown in the bell dropdown
 * @param {string}      body        - longer description
 * @param {string|null} entityType  - 'Booking' | 'User' | null
 * @param {number|null} entityId    - ID of the related row
 * @returns {Promise<Notification|null>}
 */
async function notify(userId, type, title, body, entityType = null, entityId = null) {
  try {
    return await Notification.create({ userId, type, title, body, entityType, entityId });
  } catch (err) {
    console.warn('[Notification] Write failed:', err.message);
    return null;
  }
}

// ── Pre-built notification factories ─────────────────────────────────────────

function notifyBookingConfirmed(userId, booking) {
  return notify(
    userId,
    'booking_confirmed',
    '🎉 Booking Confirmed!',
    `Your parking slot ${booking.spot} at ${booking.locationName} is reserved for ${booking.date}, ${booking.timeSlot}. Reference: ${booking.reference}`,
    'Booking',
    booking.id || booking._id
  );
}

function notifyBookingCancelled(userId, booking, reason) {
  return notify(
    userId,
    'booking_cancelled',
    '❌ Booking Cancelled',
    `Your booking ${booking.reference} for ${booking.date}, ${booking.timeSlot} has been cancelled. ${reason ? `Reason: ${reason}` : ''}`.trim(),
    'Booking',
    booking.id || booking._id
  );
}

function notifyBookingReminder(userId, booking) {
  const { timeSlot, locationName, spot, reference, id, _id } = booking;
  return notify(
    userId,
    'booking_reminder',
    '⏰ Parking Reminder',
    `Your slot ${spot} at ${locationName} starts in 30 minutes (${timeSlot}). Reference: ${reference}`,
    'Booking',
    id || _id
  );
}

function notifyNoShow(userId, booking) {
  return notify(
    userId,
    'no_show',
    '⚠️ Reservation Forfeited',
    `Your booking ${booking.reference} for ${booking.date}, ${booking.timeSlot} was forfeited — no check-in was detected within the 15-minute grace period.`,
    'Booking',
    booking.id || booking._id
  );
}

function notifyDiscountApproved(userId) {
  return notify(
    userId,
    'discount_approved',
    '🎁 Discount Approved!',
    'Your PWD/Senior Citizen discount has been approved. You will now receive 20% off every parking reservation automatically.',
    'User',
    userId
  );
}

function notifyDiscountRejected(userId, reason) {
  return notify(
    userId,
    'discount_rejected',
    '❌ Discount Request Rejected',
    `Your discount ID was not approved. ${reason || 'Please upload a clearer, valid PWD or Senior Citizen ID.'}`,
    'User',
    userId
  );
}

function notifyRegistrationRejected(userId, reason) {
  return notify(
    userId,
    'registration_rejected',
    '❌ Registration Rejected',
    `Your business partner registration was rejected. ${reason || 'Please contact support for more information.'}`,
    'User',
    userId
  );
}

function notifySystem(userId, title, body) {
  return notify(userId, 'system', title, body, null, null);
}

module.exports = {
  notify,
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyBookingReminder,
  notifyNoShow,
  notifyDiscountApproved,
  notifyDiscountRejected,
  notifyRegistrationRejected,
  notifySystem,
};
