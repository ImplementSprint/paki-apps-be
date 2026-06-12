/**
 * timeUtils.js — Shared timing utilities for reservation lifecycle management
 *
 * RESERVATION STATE MACHINE:
 *   upcoming (future start)        → "reserved"
 *   upcoming (start ≤ now ≤ start+GRACE)  → "in_grace_period"
 *   upcoming (now > start+GRACE)   → "no_show"        (slot freed in availability checks)
 *   active   (now ≤ end)           → "occupied"
 *   active   (now > end)           → "overstay"       (slot still blocked)
 *   completed / cancelled          → slot freed immediately
 */

const GRACE_PERIOD_MIN    = 15;  // minutes after start before no-show is declared
const CHECKOUT_BUFFER_MIN = 15;  // minutes after end before slot is re-bookable

/**
 * Parse "HH:MM - HH:MM" into { startMin, endMin } as minutes-since-midnight.
 * Accepts "HH:MM-HH:MM" and "HH:MM - HH:MM" formats.
 */
function parseTimeSlot(timeSlot) {
  const match = String(timeSlot).match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!match) return { startMin: 0, endMin: 0 };
  return {
    startMin: parseInt(match[1]) * 60 + parseInt(match[2]),
    endMin:   parseInt(match[3]) * 60 + parseInt(match[4]),
  };
}

/** Format minutes-since-midnight back to "HH:MM" */
function minToHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Current time as minutes-since-midnight (server local time) */
function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** Today's date string YYYY-MM-DD */
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Returns true if two time windows overlap.
 * A checkout buffer is added to the *existing* booking's end time
 * to prevent back-to-back double booking without turnaround time.
 */
function windowsOverlap(existingTimeSlot, requestedTimeSlot) {
  const ex  = parseTimeSlot(existingTimeSlot);
  const req = parseTimeSlot(requestedTimeSlot);
  const effectiveEnd = ex.endMin + CHECKOUT_BUFFER_MIN;
  // Overlap: requested starts before existing (with buffer) ends AND requested ends after existing starts
  return req.startMin < effectiveEnd && req.endMin > ex.startMin;
}

/**
 * Determine whether an 'upcoming' booking should be treated as a no-show.
 * Only applies for today's bookings; future bookings are never no-shows.
 */
function isNoShowBooking(booking) {
  const { date, timeSlot, status } = booking;
  if (status !== 'upcoming') return false;
  if (date !== todayStr()) return false;          // only today's bookings expire
  const { startMin } = parseTimeSlot(timeSlot);
  return nowMinutes() > startMin + GRACE_PERIOD_MIN;
}

/**
 * Compute rich timing metadata for a booking.
 * Returns null if booking is null.
 *
 * Fields returned:
 *   minutesUntilStart  – positive = future, negative = past
 *   minutesPastEnd     – positive = past end time, negative = not yet ended
 *   isToday            – whether booking date is today
 *   isArrivingSoon     – starts within 60 min (and hasn't started)
 *   isInGracePeriod    – start passed, still within grace window
 *   isNoShow           – past grace, still upcoming
 *   isOverstay         – active but past end time
 *   gracePeriodExpiresAt – "HH:MM" string when grace ends
 *   overstayMinutes    – how many minutes past end (if overstay)
 *   timingState        – canonical string state
 */
function computeTimingMeta(booking) {
  if (!booking) return null;

  const { date, timeSlot, status } = booking;
  const { startMin, endMin } = parseTimeSlot(timeSlot);
  const isToday = date === todayStr();
  const now = nowMinutes();

  const minutesUntilStart = startMin - now;
  const minutesPastEnd    = now - endMin;
  const graceExpiresMin   = startMin + GRACE_PERIOD_MIN;

  const isArrivingSoon  = isToday && status === 'upcoming' && minutesUntilStart > 0 && minutesUntilStart <= 60;
  const isInGracePeriod = isToday && status === 'upcoming' && minutesUntilStart <= 0 && now <= graceExpiresMin;
  const isNoShow        = isToday && status === 'upcoming' && now > graceExpiresMin;
  const isOverstay      = isToday && status === 'active'   && minutesPastEnd > 0;

  let timingState = 'reserved'; // default for future upcoming
  if (status === 'active') {
    timingState = isOverstay ? 'overstay' : 'occupied';
  } else if (status === 'upcoming') {
    if      (isNoShow)        timingState = 'no_show';
    else if (isInGracePeriod) timingState = 'in_grace_period';
    else if (isArrivingSoon)  timingState = 'arriving_soon';
    else                      timingState = 'reserved';
  }

  return {
    minutesUntilStart,
    minutesPastEnd,
    isToday,
    isArrivingSoon,
    isInGracePeriod,
    isNoShow,
    isOverstay,
    overstayMinutes:      isOverstay ? minutesPastEnd : 0,
    gracePeriodMinLeft:   isInGracePeriod ? graceExpiresMin - now : 0,
    gracePeriodExpiresAt: minToHHMM(graceExpiresMin),
    expectedEndAt:        minToHHMM(endMin),
    timingState,
  };
}

/**
 * Determine derived slot status incorporating timing logic.
 * No-show bookings free the slot visually but are still in DB.
 */
function deriveDashboardStatus(slotDbStatus, booking, timingMeta) {
  if (slotDbStatus === 'maintenance') return 'maintenance';
  if (!booking || !timingMeta) return 'available';
  if (timingMeta.isNoShow) return 'no_show';   // admin can see it, but slot is logically free
  return timingMeta.timingState;               // arriving_soon / in_grace_period / occupied / overstay
}

/**
 * Recommended poll interval in ms based on current timing states.
 * More critical = faster polling. Never polls below 5s.
 */
function recommendedPollIntervalMs(timingMetas) {
  const hasGrace    = timingMetas.some(t => t?.isInGracePeriod);
  const hasArriving = timingMetas.some(t => t?.isArrivingSoon);
  const hasOverstay = timingMetas.some(t => t?.isOverstay);
  if (hasGrace)    return 10_000;   //  10 s — critical window
  if (hasOverstay) return 15_000;   //  15 s — overstay monitoring
  if (hasArriving) return 20_000;   //  20 s — arrival window
  return 45_000;                    //  45 s — idle
}

// ── Refund policy constants ───────────────────────────────────────────────────
/**
 * How many minutes before the slot's start time the 50% refund cutoff kicks in.
 * Cancelling LESS than this many minutes before start = 50% refund.
 * Cancelling AT LEAST this many minutes before start  = 100% refund.
 * No-show (past grace period)                         = 0%  refund.
 */
const CANCEL_PARTIAL_CUTOFF_MIN = 30;

/**
 * Compute the cancellation refund policy at the moment of calling.
 *
 * Returns an object:
 *   refundPct          – 100 | 50 | 0
 *   refundType         – 'full_refund' | 'partial_refund' | 'no_refund' | 'no_show'
 *   label              – human-readable string
 *   minutesUntilStart  – minutes until the slot starts (negative if already started)
 *
 * Rules (applied in order):
 *   1. No-show (past grace period)          → 0% refund
 *   2. Start time has already passed        → 0% refund
 *   3. Today, < 30 min before start         → 50% refund
 *   4. Today, ≥ 30 min before start         → 100% refund
 *   5. Future date (not today)              → 100% refund (always ≥ 30 min away)
 */
function computeRefundPolicy(booking) {
  const { date, timeSlot, status } = booking;

  // Rule 1 – no-show: non-refundable
  if (isNoShowBooking(booking)) {
    return {
      refundPct:         0,
      refundType:        'no_show',
      label:             'No Refund (No-Show)',
      minutesUntilStart: -999,
    };
  }

  // Only upcoming bookings can be refunded
  if (status !== 'upcoming') {
    return {
      refundPct:         0,
      refundType:        'non_refundable',
      label:             'No Refund',
      minutesUntilStart: -999,
    };
  }

  const { startMin }        = parseTimeSlot(timeSlot);
  const isToday             = date === todayStr();

  // Rule 5 – future date: always full refund
  if (!isToday) {
    return {
      refundPct:         100,
      refundType:        'full_refund',
      label:             'Full Refund (100%)',
      minutesUntilStart: 9999,
    };
  }

  const now               = nowMinutes();
  const minutesUntilStart = startMin - now;

  // Rule 2 – start already passed
  if (minutesUntilStart <= 0) {
    return {
      refundPct:         0,
      refundType:        'no_refund',
      label:             'No Refund (Slot Started)',
      minutesUntilStart,
    };
  }

  // Rule 3 – within the 30-min cutoff window
  if (minutesUntilStart < CANCEL_PARTIAL_CUTOFF_MIN) {
    return {
      refundPct:         50,
      refundType:        'partial_refund',
      label:             '50% Refund',
      minutesUntilStart,
    };
  }

  // Rule 4 – well before start
  return {
    refundPct:         100,
    refundType:        'full_refund',
    label:             'Full Refund (100%)',
    minutesUntilStart,
  };
}

module.exports = {
  GRACE_PERIOD_MIN,
  CHECKOUT_BUFFER_MIN,
  CANCEL_PARTIAL_CUTOFF_MIN,
  parseTimeSlot,
  minToHHMM,
  nowMinutes,
  todayStr,
  windowsOverlap,
  isNoShowBooking,
  computeTimingMeta,
  deriveDashboardStatus,
  recommendedPollIntervalMs,
  computeRefundPolicy,
};