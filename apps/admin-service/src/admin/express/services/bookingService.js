'use strict';
/**
 * bookingService.js
 * =================
 * All reads are single-table queries — NO JOIN / NO Sequelize include.
 * Snapshot columns (userName, vehiclePlate, locationName, …) are populated
 * once at booking-creation time and re-used on every subsequent read.
 */

const { Op } = require('sequelize');
const { Booking, Location, Vehicle, ParkingSlot, User } = require('../models/index');
const { formatBooking } = require('../utils/formatters');
const emailService = require('./emailService');
const notificationService = require('./notificationService');
const {
  windowsOverlap,
  isNoShowBooking,
  computeRefundPolicy,
} = require('../utils/timeUtils');
const {
  logBookingCreated,
  logBookingCancelled,
  logBookingCheckIn,
  logBookingCheckOut,
  logBookingNoShow,
} = require('./logService');

// ─────────────────────────────────────────────────────────────────────────────
// Availability helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IDs of slots that are NOT available for a given location + date + timeSlot.
 * Pure index scan on bookings — no JOIN.
 */
const getConflictingSlotIds = async (locationId, date, timeSlot) => {
  const bookings = await Booking.findAll({
    where: {
      locationId,
      date,
      status:        { [Op.in]: ['upcoming', 'active'] },
      parkingSlotId: { [Op.not]: null },
    },
    attributes: ['parkingSlotId', 'timeSlot', 'status', 'date'],
    raw: true,
  });

  return bookings
    .filter((b) => {
      if (!windowsOverlap(b.timeSlot, timeSlot)) return false;
      if (b.status === 'active')   return true;
      if (b.status === 'upcoming') return !isNoShowBooking(b);
      return false;
    })
    .map((b) => b.parkingSlotId);
};

/**
 * Auto-assign the best available slot (floor → section → label).
 * Index scan on parking_slots — no JOIN.
 */
const autoAssignSlot = async (locationId, date, timeSlot, preferredFloor = null) => {
  const conflictingIds = await getConflictingSlotIds(locationId, date, timeSlot);

  const where = {
    locationId: parseInt(locationId),
    status:     { [Op.notIn]: ['maintenance'] },
  };
  if (preferredFloor) where.floor = parseInt(preferredFloor);
  if (conflictingIds.length > 0) where.id = { [Op.notIn]: conflictingIds };

  return ParkingSlot.findOne({
    where,
    order: [['floor', 'ASC'], ['section', 'ASC'], ['label', 'ASC']],
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// createBooking
// ─────────────────────────────────────────────────────────────────────────────
const createBooking = async ({
  userId, vehicleId, locationId, parkingSlotId, spot,
  date, timeSlot, amount, paymentMethod, preferredFloor,
  savedPaymentMethodId, // SCRUM-1018
}) => {
  // ── 0. Handle Saved Payment Method (Auto-Charge) ─────────────────────────
  let finalPaymentMethod = paymentMethod;
  if (paymentMethod === 'gcash_linked' && savedPaymentMethodId) {
    const { PaymentMethod } = require('../models/index');
    const method = await PaymentMethod.findOne({
      where: { id: savedPaymentMethodId, userId: parseInt(userId) }
    });
    if (!method) throw new Error('Invalid or missing saved payment method');
    // We snapshot the mobile number into the payment status or just keep it as gcash_linked
    finalPaymentMethod = `GCash (${method.mobileNumber})`;
  }
  // ── 1. Resolve slot (auto-assign or validate provided slot) ───────────────
  let resolvedSlotId = parkingSlotId ? parseInt(parkingSlotId) : null;
  let resolvedSpot   = spot;

  if (!resolvedSlotId) {
    const assigned = await autoAssignSlot(locationId, date, timeSlot, preferredFloor);
    if (assigned) {
      resolvedSlotId = assigned.id;
      resolvedSpot   = assigned.label;
    } else {
      resolvedSpot = spot || 'TBD';
    }
  } else {
    const slot = await ParkingSlot.findByPk(resolvedSlotId, { attributes: ['id', 'label'] });
    if (slot) resolvedSpot = slot.label;
  }
  if (!resolvedSpot) resolvedSpot = 'TBD';

  // ── 2. Time-window conflict check ─────────────────────────────────────────
  if (resolvedSlotId) {
    const conflictIds = await getConflictingSlotIds(locationId, date, timeSlot);
    if (conflictIds.includes(resolvedSlotId)) {
      throw new Error(
        'This parking slot is already taken for the requested time window. ' +
        'Please choose a different slot or time.'
      );
    }
  }

  // ── 3. Fetch snapshots in parallel (3 lightweight PK lookups) ─────────────
  const [user, vehicle, location] = await Promise.all([
    User.findByPk(parseInt(userId),     { attributes: ['id', 'name', 'email', 'phone', 'discountPct'] }),
    Vehicle.findByPk(parseInt(vehicleId), { attributes: ['id', 'brand', 'model', 'plateNumber', 'type', 'color'] }),
    Location.findByPk(parseInt(locationId), { attributes: ['id', 'name', 'address'] }),
  ]);

  // ── 3b. Apply special discount (PWD / Senior Citizen — 20% off) ───────────
  const discountPct = user?.discountPct || 0;
  const finalAmount = discountPct > 0
    ? Math.round(amount * (1 - discountPct / 100))
    : amount;

  // ── 4. Create booking with all snapshot data inline ───────────────────────
  const booking = await Booking.create({
    userId:        parseInt(userId),
    vehicleId:     parseInt(vehicleId),
    locationId:    parseInt(locationId),
    parkingSlotId: resolvedSlotId,
    spot:          resolvedSpot,
    date,
    timeSlot,
    amount:        finalAmount,
    paymentMethod: finalPaymentMethod,
    paymentStatus: 'paid',
    status:        'upcoming',

    // User snapshot
    userName:  user?.name  || null,
    userEmail: user?.email || null,
    userPhone: user?.phone || null,

    // Vehicle snapshot
    vehicleBrand: vehicle?.brand       || null,
    vehicleModel: vehicle?.model       || null,
    vehiclePlate: vehicle?.plateNumber || null,
    vehicleType:  vehicle?.type        || null,
    vehicleColor: vehicle?.color       || null,

    // Location snapshot
    locationName:    location?.name    || null,
    locationAddress: location?.address || null,
  });

  // ── 5. Decrement available-spots counter ───────────────────────────────────
  await Location.decrement('availableSpots', { by: 1, where: { id: locationId } });

  const plain    = booking.toJSON();
  const formatted = formatBooking(plain);

  // ── 6. Fire-and-forget: transaction log + activity ─────────────────────────
  logBookingCreated({ booking: { ...formatted, id: booking.id }, userId });

  // ── 7. Fire-and-forget: in-app notification ───────────────────────────────
  notificationService.notifyBookingConfirmed(parseInt(userId), {
    ...formatted,
    id:           booking.id,
    spot:         resolvedSpot,
    locationName: location?.name || 'Parking Location',
  });

  // ── 8. Fire-and-forget: confirmation email ────────────────────────────────
  if (user?.email) {
    (async () => {
      try {
        await emailService.sendBookingConfirmation(user.email, {
          reference: formatted.reference,
          location:  location?.name || 'Parking Location',
          spot:      resolvedSpot,
          date,
          timeSlot,
          amount: finalAmount,
        });
      } catch (_) { /* email failure must never bubble up */ }
    })();
  }

  return formatted;
};

// ─────────────────────────────────────────────────────────────────────────────
// updateBookingStatus  (admin / teller check-in, check-out, no-show)
// ─────────────────────────────────────────────────────────────────────────────
const updateBookingStatus = async (bookingId, status, cancelNote = 'Admin action') => {
  // Single PK lookup — no JOIN
  const booking = await Booking.findByPk(parseInt(bookingId));
  if (!booking) throw new Error('Booking not found');

  const allowed = {
    upcoming:  ['active', 'cancelled'],
    active:    ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };
  if (!allowed[booking.status]?.includes(status)) {
    throw new Error(`Cannot move booking from '${booking.status}' → '${status}'`);
  }

  if (status === 'completed') {
    await Location.increment('availableSpots', { by: 1, where: { id: booking.locationId } });
  }
  if (status === 'cancelled' && !isNoShowBooking(booking.toJSON())) {
    await Location.increment('availableSpots', { by: 1, where: { id: booking.locationId } });
  }

  await booking.update({
    status,
    ...(status === 'cancelled' ? { cancelledAt: new Date(), cancelReason: cancelNote } : {}),
    ...(status === 'active'    ? { checkInAt:   new Date() } : {}),
    ...(status === 'completed' ? { checkOutAt:  new Date() } : {}),
  });

  const updated  = await Booking.findByPk(booking.id);
  const formatted = formatBooking(updated.toJSON());

  if (status === 'active')    logBookingCheckIn ({ booking: formatted, adminId: null });
  if (status === 'completed') logBookingCheckOut({ booking: formatted, adminId: null });
  if (status === 'cancelled' && cancelNote === 'No-show')
    logBookingNoShow({ booking: formatted, adminId: null });
  else if (status === 'cancelled')
    logBookingCancelled({ booking: formatted, userId: null, reason: cancelNote, isRefund: false });

  return formatted;
};

// ─────────────────────────────────────────────────────────────────────────────
// getUserBookings  (customer)
// ─────────────────────────────────────────────────────────────────────────────
const getUserBookings = async (userId, { status, page = 1, limit = 20 }) => {
  const where = { userId: parseInt(userId) };
  if (status && status !== 'all') where.status = status;

  const { rows: bookings, count: total } = await Booking.findAndCountAll({
    where,
    order:    [['createdAt', 'DESC']],
    limit:    parseInt(limit),
    offset:   (parseInt(page) - 1) * parseInt(limit),
    raw:      true,
  });

  return {
    bookings:   bookings.map(formatBooking),
    total,
    page:       parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit)),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// getAllBookings  (admin / teller — date, locationId, status filters)
// ─────────────────────────────────────────────────────────────────────────────
const getAllBookings = async ({ status, search, date, locationId, page = 1, limit = 20 }) => {
  const where = {};
  if (status     && status !== 'all') where.status     = status;
  if (date)       where.date       = date;
  if (locationId) where.locationId = parseInt(locationId);

  // Search across reference, userName, vehiclePlate (all on the booking row — no JOIN)
  if (search) {
    const term = `%${search}%`;
    where[Op.or] = [
      { reference:    { [Op.iLike]: term } },
      { barcode:      { [Op.iLike]: term } },
      { userName:     { [Op.iLike]: term } },
      { vehiclePlate: { [Op.iLike]: term } },
      { locationName: { [Op.iLike]: term } },
      { spot:         { [Op.iLike]: term } },
    ];
  }

  const { rows: bookings, count: total } = await Booking.findAndCountAll({
    where,
    order:  [['createdAt', 'DESC']],
    limit:  parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit),
    raw:    true,
  });

  return {
    bookings:   bookings.map(formatBooking),
    total,
    page:       parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit)),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// cancelBooking  (customer self-cancel)
// ─────────────────────────────────────────────────────────────────────────────
const cancelBooking = async (bookingId, userId, reason) => {
  const booking = await Booking.findOne({ where: { id: parseInt(bookingId), userId: parseInt(userId) } });
  if (!booking)                       throw new Error('Booking not found');
  if (booking.status === 'cancelled') throw new Error('Booking already cancelled');
  if (booking.status === 'completed') throw new Error('Cannot cancel a completed booking');

  const wasNoShow    = isNoShowBooking(booking.toJSON());
  const policy       = computeRefundPolicy(booking.toJSON());
  const refundAmount = Math.floor(booking.amount * policy.refundPct / 100);

  const newPaymentStatus =
    policy.refundPct === 100 ? 'refunded' :
    policy.refundPct === 50  ? 'partial'  : 'paid';

  const cancelReason = reason
    ? `${reason} — ${policy.label}`
    : `User cancelled — ${policy.label}`;

  await booking.update({
    status:        'cancelled',
    cancelledAt:   new Date(),
    cancelReason,
    paymentStatus: newPaymentStatus,
  });

  if (!wasNoShow) {
    await Location.increment('availableSpots', { by: 1, where: { id: booking.locationId } });
  }

  const formatted = formatBooking(booking.toJSON());

  logBookingCancelled({
    booking:      { ...formatted, id: booking.id },
    userId,
    reason:       cancelReason,
    refundAmount,
    refundType:   policy.refundType,
    isRefund:     policy.refundPct > 0 && booking.paymentStatus === 'paid',
  });

  return {
    ...formatted,
    refundAmount,
    refundPolicy: {
      refundPct:  policy.refundPct,
      refundType: policy.refundType,
      label:      policy.label,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// getAvailableSlots  (time-picker — index scan only)
// ─────────────────────────────────────────────────────────────────────────────
const getAvailableSlots = async (locationId, date) => {
  const allSlots = [];
  for (let h = 6; h <= 22; h++) {
    const s = `${String(h).padStart(2, '0')}:00`;
    const e = `${String(h + 1).padStart(2, '0')}:00`;
    allSlots.push(`${s} - ${e}`);
  }

  const bookedRecords = await Booking.findAll({
    where: {
      locationId,
      date,
      status: { [Op.in]: ['upcoming', 'active'] },
    },
    attributes: ['timeSlot', 'spot', 'status', 'date'],
    raw: true,
  });

  const slotOccupancy = {};
  bookedRecords
    .filter((b) => !isNoShowBooking(b))
    .forEach((b) => {
      slotOccupancy[b.timeSlot] = (slotOccupancy[b.timeSlot] || 0) + 1;
    });

  const location   = await Location.findByPk(locationId, { attributes: ['totalSpots'] });
  const totalSpots = location?.totalSpots || 100;

  return allSlots.map((slot) => ({
    slot,
    booked:    slotOccupancy[slot] || 0,
    available: totalSpots - (slotOccupancy[slot] || 0),
    isFull:    (slotOccupancy[slot] || 0) >= totalSpots,
  }));
};

module.exports = {
  createBooking,
  updateBookingStatus,
  getUserBookings,
  getAllBookings,
  cancelBooking,
  getAvailableSlots,
  getConflictingSlotIds,
};
