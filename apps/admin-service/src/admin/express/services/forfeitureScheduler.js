'use strict';
/**
 * forfeitureScheduler.js
 * ======================
 * Runs every minute to automatically forfeit reservation no-shows.
 *
 * Logic:
 *  - Finds all bookings with status = 'upcoming' for TODAY whose time slot
 *    started more than GRACE_PERIOD_MIN minutes ago and no check-in was recorded.
 *  - Marks each as status = 'cancelled', cancelReason = 'Auto-forfeited: No check-in'
 *  - Restores availableSpots on the Location counter (+1 per forfeited booking)
 *  - Logs each forfeiture via the activity/transaction log system
 *
 * Grace period: 15 minutes (mirrors GRACE_PERIOD_MIN in timeUtils.js)
 */

const { Op }      = require('sequelize');
const { sequelize } = require('../config/db');
const { Booking, Location } = require('../models/index');
const { logBookingNoShow }  = require('./logService');
const { formatBooking }     = require('../utils/formatters');
const notificationService   = require('./notificationService');

const GRACE_PERIOD_MIN = 15;  // must match timeUtils.js constant

/** Convert "HH:MM - HH:MM" → Date object for the START time on a given date string */
function slotStartDate(dateStr, timeSlot) {
  const match = String(timeSlot).match(/(\d{1,2}):(\d{2})\s*[-–]/);
  if (!match) return null;
  const [, hh, mm] = match;
  const d = new Date(`${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Run one forfeiture sweep.
 * Called on startup (to catch any overnight no-shows) and every 60 seconds.
 */
async function runForfeitureSweep() {
  try {
    const now        = new Date();
    const todayStr   = now.toISOString().split('T')[0];   // YYYY-MM-DD
    const graceCutoff = new Date(now.getTime() - GRACE_PERIOD_MIN * 60 * 1000);

    // ── Find all candidates: today's, still "upcoming", not yet checked-in ────
    //   We can't filter by timeSlot in SQL easily, so we pull today's upcoming
    //   bookings and filter in JS by comparing slot-start + grace vs now.
    const candidates = await Booking.findAll({
      where: {
        status: 'upcoming',
        date:   todayStr,
        checkInAt: null,
      },
      raw: true,
    });

    if (candidates.length === 0) return;

    const toForfeit = candidates.filter((b) => {
      const startDate = slotStartDate(b.date, b.timeSlot);
      if (!startDate) return false;
      // Forfeit if the grace period has fully elapsed (start + 30 min < now)
      return startDate.getTime() + GRACE_PERIOD_MIN * 60 * 1000 < now.getTime();
    });

    if (toForfeit.length === 0) return;

    const ids        = toForfeit.map((b) => b.id);
    const locationIds = [...new Set(toForfeit.map((b) => b.locationId).filter(Boolean))];

    // ── 1. Bulk-cancel all forfeited bookings ─────────────────────────────────
    await Booking.update(
      {
        status:      'cancelled',
        cancelledAt: now,
        cancelReason: 'Auto-forfeited: No check-in within grace period',
      },
      { where: { id: { [Op.in]: ids } } }
    );

    // ── 2. Restore availableSpots for each affected location ──────────────────
    //   Count how many bookings were forfeited per location
    const perLocation = {};
    toForfeit.forEach((b) => {
      if (b.locationId) perLocation[b.locationId] = (perLocation[b.locationId] || 0) + 1;
    });
    await Promise.all(
      Object.entries(perLocation).map(([locId, count]) =>
        Location.increment('availableSpots', { by: count, where: { id: parseInt(locId) } })
      )
    );

    // ── 3. Log + notify each forfeiture ──────────────────────────────────────
    toForfeit.forEach((b) => {
      try {
        const fmt = formatBooking(b);
        logBookingNoShow({ booking: fmt, adminId: null });
        // In-app notification so the customer knows their slot was forfeited
        notificationService.notifyNoShow(b.userId, { ...fmt, id: b.id });
      } catch (_) { /* log/notify failure must never crash the scheduler */ }
    });

    console.log(
      `[Forfeiture] ⏰ Auto-forfeited ${toForfeit.length} no-show reservation(s): ` +
      `[${toForfeit.map((b) => b.reference || b.id).join(', ')}]`
    );
  } catch (err) {
    // Never crash the process — log and continue
    console.error('[Forfeiture] ❌ Sweep error:', err.message);
  }
}

/**
 * Reminder sweep — fires once per booking when it is ≤ 30 min from start.
 * Uses Booking.reminderSentAt (nullable column) to ensure exactly-once delivery.
 */
async function runReminderSweep() {
  try {
    const now      = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const nowMs    = now.getTime();

    // Pull today's upcoming bookings that haven't had a reminder yet
    const candidates = await Booking.findAll({
      where: {
        status:          'upcoming',
        date:            todayStr,
        checkInAt:       null,
        reminderSentAt:  null,
      },
      raw: true,
    });

    for (const b of candidates) {
      const startDate = slotStartDate(b.date, b.timeSlot);
      if (!startDate) continue;
      const minsUntilStart = (startDate.getTime() - nowMs) / 60000;
      // Send reminder if within 30 min and not yet started
      if (minsUntilStart > 0 && minsUntilStart <= 30) {
        await Booking.update(
          { reminderSentAt: now },
          { where: { id: b.id } }
        );
        const fmt = formatBooking(b);
        notificationService.notifyBookingReminder(b.userId, { ...fmt, id: b.id });
        console.log(`[Reminder] 🔔 Sent 30-min reminder for booking ${b.reference} (user ${b.userId})`);
      }
    }
  } catch (err) {
    console.error('[Reminder] ❌ Sweep error:', err.message);
  }
}

/**
 * Start the forfeiture + reminder scheduler.
 * Call this AFTER the DB connection is established in server.js.
 */
function startForfeitureScheduler() {
  console.log(`[Forfeiture] 🕐 Scheduler started — grace period: ${GRACE_PERIOD_MIN} min, sweep: every 60s`);

  // Run immediately on startup to catch any overnight/missed no-shows
  runForfeitureSweep();
  runReminderSweep();

  // Then sweep every 60 seconds
  setInterval(() => {
    runForfeitureSweep();
    runReminderSweep();
  }, 60 * 1000);
}

module.exports = { startForfeitureScheduler, runForfeitureSweep, runReminderSweep };
