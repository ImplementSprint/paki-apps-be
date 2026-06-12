/**
 * logService.js
 * =============
 * Centralized helpers for writing TransactionLog and ActivityLog rows.
 *
 * ALL writes are fire-and-forget — errors are swallowed with a console.warn
 * so that a logging failure never crashes the business-logic path.
 *
 * Usage:
 *   const { logTransaction, logActivity } = require('./logService');
 *
 *   await logTransaction({ bookingId, userId, reference, paymentMethod, amount, status });
 *   logActivity({ userId, action: 'BOOKING_CREATED', entityType: 'Booking', entityId: booking.id });
 */

'use strict';

const { TransactionLog, ActivityLog } = require('../models/index');

// ─── TransactionLog ──────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {number|null} opts.bookingId
 * @param {number|null} opts.userId
 * @param {string|null} opts.reference      - PKP-XXXXXXXX
 * @param {'payment'|'refund'|'partial_refund'|'reversal'|'adjustment'} opts.transactionType
 * @param {'GCash'|'PayMaya'|'Credit/Debit Card'|'Cash'|'System'} opts.paymentMethod
 * @param {number}      opts.amount
 * @param {'success'|'failed'|'pending'|'refunded'} opts.status
 * @param {string}      [opts.description]
 * @param {object}      [opts.metadata]
 * @returns {Promise<TransactionLog|null>}
 */
async function logTransaction({
  bookingId     = null,
  userId        = null,
  reference     = null,
  transactionType = 'payment',
  paymentMethod,
  amount,
  status        = 'success',
  description   = null,
  metadata      = {},
}) {
  try {
    return await TransactionLog.create({
      bookingId,
      userId,
      reference,
      transactionType,
      paymentMethod,
      amount,
      status,
      description,
      metadata,
    });
  } catch (err) {
    console.warn('[logService] TransactionLog write failed:', err.message);
    return null;
  }
}

// ─── ActivityLog ─────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {number|null} opts.userId
 * @param {string}      opts.action         - e.g. 'BOOKING_CREATED'
 * @param {string|null} opts.entityType     - e.g. 'Booking'
 * @param {string|null} opts.entityId       - stringified ID
 * @param {string|null} opts.description
 * @param {'info'|'warning'|'critical'} opts.severity
 * @param {string|null} opts.ipAddress
 * @param {string|null} opts.userAgent
 * @param {object}      opts.metadata
 * @returns {Promise<ActivityLog|null>}
 */
async function logActivity({
  userId      = null,
  action,
  entityType  = null,
  entityId    = null,
  description = null,
  severity    = 'info',
  ipAddress   = null,
  userAgent   = null,
  metadata    = {},
}) {
  try {
    return await ActivityLog.create({
      userId,
      action,
      entityType,
      entityId:  entityId != null ? String(entityId) : null,
      description,
      severity,
      ipAddress,
      userAgent,
      metadata,
    });
  } catch (err) {
    console.warn('[logService] ActivityLog write failed:', err.message);
    return null;
  }
}

// ─── Convenience wrappers used by bookingService ─────────────────────────────

/** Log payment + booking-created activity in parallel (fire-and-forget). */
function logBookingCreated({ booking, userId }) {
  const ref = booking.reference || booking.ref;
  Promise.all([
    logTransaction({
      bookingId:       booking.id || parseInt(booking._id),
      userId,
      reference:       ref,
      transactionType: 'payment',
      paymentMethod:   booking.paymentMethod,
      amount:          booking.amount,
      status:          booking.paymentStatus === 'paid' ? 'success' : 'pending',
      description:     `Booking created — ${ref}`,
      metadata: {
        spot:     booking.spot,
        date:     booking.date,
        timeSlot: booking.timeSlot,
      },
    }),
    logActivity({
      userId,
      action:      'BOOKING_CREATED',
      entityType:  'Booking',
      entityId:    booking.id || booking._id,
      description: `Booking ${ref} created for ${booking.date} ${booking.timeSlot}`,
      severity:    'info',
      metadata: {
        reference:     ref,
        paymentMethod: booking.paymentMethod,
        amount:        booking.amount,
        spot:          booking.spot,
      },
    }),
  ]).catch(() => {});
}

/** Log cancellation activity + optional refund transaction (full or partial). */
function logBookingCancelled({ booking, userId, reason, refundAmount = 0, refundType = 'none', isRefund = false }) {
  const ref = booking.reference || booking.ref;
  Promise.all([
    // Only write a transaction log if money is actually returned
    isRefund && refundAmount > 0
      ? logTransaction({
          bookingId:       booking.id || parseInt(booking._id),
          userId,
          reference:       ref,
          // 'partial_refund' for 50%, 'refund' for 100%
          transactionType: refundType === 'partial_refund' ? 'partial_refund' : 'refund',
          paymentMethod:   booking.paymentMethod,
          amount:          refundAmount,
          status:          'refunded',
          description:     refundType === 'partial_refund'
            ? `50% partial refund for cancelled booking ${ref} (cancelled < 30 min before slot)`
            : `Full refund for cancelled booking ${ref}`,
          metadata: {
            reason,
            refundPct:  refundType === 'partial_refund' ? 50 : 100,
            refundType,
            originalAmount: booking.amount,
          },
        })
      : Promise.resolve(),
    logActivity({
      userId,
      action:      'BOOKING_CANCELLED',
      entityType:  'Booking',
      entityId:    booking.id || booking._id,
      description: `Booking ${ref} cancelled — ${reason || 'User cancelled'}`,
      severity:    'warning',
      metadata:    {
        reference:    ref,
        reason,
        refundAmount,
        refundType:   refundType || 'none',
      },
    }),
  ]).catch(() => {});
}

/** Log check-in activity. */
function logBookingCheckIn({ booking, adminId }) {
  logActivity({
    userId:      adminId,
    action:      'BOOKING_CHECKIN',
    entityType:  'Booking',
    entityId:    booking.id || booking._id,
    description: `Check-in recorded for ${booking.reference}`,
    severity:    'info',
    metadata:    { reference: booking.reference, spot: booking.spot },
  }).catch(() => {});
}

/** Log check-out activity. */
function logBookingCheckOut({ booking, adminId }) {
  logActivity({
    userId:      adminId,
    action:      'BOOKING_CHECKOUT',
    entityType:  'Booking',
    entityId:    booking.id || booking._id,
    description: `Check-out recorded for ${booking.reference}`,
    severity:    'info',
    metadata:    { reference: booking.reference, spot: booking.spot },
  }).catch(() => {});
}

/** Log no-show. */
function logBookingNoShow({ booking, adminId }) {
  logActivity({
    userId:      adminId,
    action:      'BOOKING_NO_SHOW',
    entityType:  'Booking',
    entityId:    booking.id || booking._id,
    description: `No-show flagged for ${booking.reference}`,
    severity:    'warning',
    metadata:    { reference: booking.reference },
  }).catch(() => {});
}

/** Log user login. */
function logUserLogin({ userId, ipAddress, userAgent, role }) {
  logActivity({
    userId,
    action:      role === 'admin' ? 'ADMIN_LOGIN' : 'USER_LOGIN',
    entityType:  'User',
    entityId:    userId,
    description: `${role} login`,
    severity:    'info',
    ipAddress,
    userAgent,
    metadata:    { role },
  }).catch(() => {});
}

/** Log user registration. */
function logUserRegistered({ userId, role, ipAddress }) {
  logActivity({
    userId,
    action:      role === 'admin' ? 'ADMIN_REGISTERED' : 'USER_REGISTERED',
    entityType:  'User',
    entityId:    userId,
    description: `New ${role} account created`,
    severity:    'info',
    ipAddress,
    metadata:    { role },
  }).catch(() => {});
}

module.exports = {
  logTransaction,
  logActivity,
  logBookingCreated,
  logBookingCancelled,
  logBookingCheckIn,
  logBookingCheckOut,
  logBookingNoShow,
  logUserLogin,
  logUserRegistered,
};