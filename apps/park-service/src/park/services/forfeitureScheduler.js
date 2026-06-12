'use strict';
/**
 * forfeitureScheduler.js
 * ======================
 * Runs every minute to automatically forfeit reservation no-shows.
 */

const { Op }      = require('sequelize');
const { sequelize } = require('../config/db');
const { Booking, Location, ParkingSlot, User } = require('../models/index');
const { logBookingNoShow }  = require('./logService');
const { formatBooking }     = require('../utils/formatters');
const notificationService   = require('./notificationService');
const emailService          = require('./emailService');
const smsService            = require('./smsService');

const GRACE_PERIOD_MIN = 15;  // must match timeUtils.js constant

// In-memory registry to track reminder notification deliveries safely without DB columns
const sentReminders = new Set();
const sentOvertimeWarnings = new Set();
const sentOvertimeConsumed = new Set();

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
 */
async function runForfeitureSweep() {
  try {
    const now        = new Date();
    const todayStr   = now.toISOString().split('T')[0];
    const graceCutoff = new Date(now.getTime() - GRACE_PERIOD_MIN * 60 * 1000);

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
      return startDate.getTime() + GRACE_PERIOD_MIN * 60 * 1000 < now.getTime();
    });

    if (toForfeit.length === 0) return;

    const ids        = toForfeit.map((b) => b.id);

    // ── 1. Bulk-cancel all forfeited bookings (only status column is in PG bookings) ──
    await Booking.update(
      { status: 'cancelled' },
      { where: { id: { [Op.in]: ids } } }
    );

    // ── 2. Release physical parking slots back to 'available' ────────────────
    const slotIdsToRelease = toForfeit
      .filter((b) => b.parkingSlotId)
      .map((b) => b.parkingSlotId);
    if (slotIdsToRelease.length > 0) {
      await ParkingSlot.update(
        { status: 'available' },
        { where: { id: { [Op.in]: slotIdsToRelease } } }
      );
    }

    // ── 3. Restore availableSpots for each affected location ──────────────────
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
        notificationService.notifyNoShow(b.userId, { ...fmt, id: b.id });
      } catch (_) { /* non-fatal */ }
    });

    console.log(
      `[Forfeiture] ⏰ Auto-forfeited ${toForfeit.length} no-show reservation(s): ` +
      `[${toForfeit.map((b) => b.reference || b.id).join(', ')}]`
    );
  } catch (err) {
    console.error('[Forfeiture] ❌ Sweep error:', err.message);
  }
}

/**
 * Reminder sweep — fires once per booking when it is ≤ 30 min from start.
 */
async function runReminderSweep() {
  try {
    const now      = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const nowMs    = now.getTime();

    // Pull today's upcoming bookings that haven't had a reminder yet
    const candidates = await Booking.findAll({
      where: {
        status:    'upcoming',
        date:      todayStr,
        checkInAt: null,
      },
      raw: true,
    });

    for (const b of candidates) {
      if (sentReminders.has(b.id)) continue;

      const startDate = slotStartDate(b.date, b.timeSlot);
      if (!startDate) continue;
      const minsUntilStart = (startDate.getTime() - nowMs) / 60000;
      
      // Send reminder if within 30 min and not yet started
      if (minsUntilStart > 0 && minsUntilStart <= 30) {
        sentReminders.add(b.id);
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
 * Overtime sweep — fires once per active booking when it is 15 min from 2 hrs, and again at 2 hrs.
 */
async function runOvertimeSweep() {
  try {
    const activeBookings = await Booking.findAll({
      where: {
        status: 'active',
        checkInAt: { [Op.ne]: null },
      },
      raw: true,
    });

    if (activeBookings.length === 0) return;

    const nowMs = Date.now();
    const FREE_HOURS_MS = 2 * 60 * 60 * 1000;
    const WARNING_MS = 15 * 60 * 1000;

    for (const b of activeBookings) {
      const checkInMs = new Date(b.checkInAt).getTime();
      const elapsedMs = nowMs - checkInMs;
      
      let needsWarning = false;
      let needsConsumed = false;

      if (elapsedMs >= FREE_HOURS_MS && !sentOvertimeConsumed.has(b.id)) {
        needsConsumed = true;
      } else if (elapsedMs >= (FREE_HOURS_MS - WARNING_MS) && elapsedMs < FREE_HOURS_MS && !sentOvertimeWarnings.has(b.id)) {
        needsWarning = true;
      }

      if (needsWarning || needsConsumed) {
        const fmt = formatBooking(b);
        const user = await User.findByPk(b.userId, { raw: true });
        if (user) {
          fmt.userName = user.name;
          fmt.userEmail = user.email;
          fmt.userPhone = user.phone;
        }

        if (needsConsumed) {
          sentOvertimeConsumed.add(b.id);
          notificationService.notifyOvertimeConsumed(b.userId, { ...fmt, id: b.id });
          if (fmt.userEmail) emailService.sendOvertimeConsumedEmail(fmt.userEmail, fmt).catch(()=>{});
          if (fmt.userPhone) smsService.sendOvertimeConsumedSMS(fmt.userPhone, fmt).catch(()=>{});
          console.log(`[Overtime] ⏳ Sent overtime consumed notice for booking ${b.reference} (user ${b.userId})`);
        } else if (needsWarning) {
          sentOvertimeWarnings.add(b.id);
          notificationService.notifyOvertimeWarning(b.userId, { ...fmt, id: b.id });
          if (fmt.userEmail) emailService.sendOvertimeWarningEmail(fmt.userEmail, fmt).catch(()=>{});
          if (fmt.userPhone) smsService.sendOvertimeWarningSMS(fmt.userPhone, fmt).catch(()=>{});
          console.log(`[Overtime] ⚠️ Sent 15-min overtime warning for booking ${b.reference} (user ${b.userId})`);
        }
      }
    }
  } catch (err) {
    console.error('[Overtime] ❌ Sweep error:', err.message);
  }
}

/**
 * Start the forfeiture + reminder scheduler.
 */
function startForfeitureScheduler() {
  console.log(`[Forfeiture] 🕐 Scheduler started — grace period: ${GRACE_PERIOD_MIN} min, sweep: every 60s`);

  // Disable background schedulers during dev so they don't spam emails on every restart
  /*
  cron.schedule('* * * * *', sweepForfeiture);
  cron.schedule('* * * * *', sweepReminders);
  cron.schedule('* * * * *', sweepOvertime);
  */
  console.log('✅  [Scheduler] Forfeiture + Reminder sweeps temporarily PAUSED during dev');

  runForfeitureSweep();
  runReminderSweep();
  runOvertimeSweep();

  setInterval(() => {
    runForfeitureSweep();
    runReminderSweep();
    runOvertimeSweep();
  }, 60 * 1000);
}

module.exports = { startForfeitureScheduler, runForfeitureSweep, runReminderSweep, runOvertimeSweep };
