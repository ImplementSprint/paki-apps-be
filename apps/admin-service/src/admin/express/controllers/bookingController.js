'use strict';
/**
 * bookingController.js
 * ====================
 * All reads use single-table lookups (no JOIN / no Sequelize include).
 * formatBooking reconstructs nested userId / vehicleId / locationId from
 * the snapshot columns stored on the booking row.
 */

const bookingService = require('../services/bookingService');
const { Booking, Location } = require('../models/index');
const { formatBooking }     = require('../utils/formatters');
const { logBookingCheckOut } = require('../services/logService');

// POST /api/bookings
const createBooking = async (req, res) => {
  try {
    const booking = await bookingService.createBooking({
      userId: req.user.id,
      ...req.body,
    });
    res.status(201).json({ success: true, data: booking });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/bookings/my
const getMyBookings = async (req, res) => {
  try {
    const { status, search, page, limit } = req.query;
    const result = await bookingService.getUserBookings(req.user.id, { status, search, page, limit });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/bookings (admin / teller)
const getAllBookings = async (req, res) => {
  try {
    const { status, search, date, locationId, page, limit } = req.query;
    const result = await bookingService.getAllBookings({ status, search, date, locationId, page, limit });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/bookings/:id
const getBookingById = async (req, res) => {
  try {
    const isStaff = ['admin', 'teller', 'business_partner'].includes(req.user.role);

    // Single PK lookup — no JOIN
    const booking = await Booking.findOne({
      where: {
        id: parseInt(req.params.id),
        ...(!isStaff ? { userId: req.user.id } : {}),
      },
      raw: true,
    });

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, data: formatBooking(booking) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/bookings/:id/cancel
const cancelBooking = async (req, res) => {
  try {
    const booking = await bookingService.cancelBooking(
      req.params.id,
      req.user.id,
      req.body.reason
    );
    res.json({ success: true, data: booking });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// PATCH /api/bookings/:id/status
const updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['active', 'completed', 'cancelled', 'no_show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Use: active | completed | cancelled | no_show',
      });
    }
    const dbStatus   = status === 'no_show' ? 'cancelled' : status;
    const cancelNote = status === 'no_show' ? 'No-show'   : 'Admin action';
    const booking    = await bookingService.updateBookingStatus(req.params.id, dbStatus, cancelNote);
    res.json({ success: true, data: booking });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// PATCH /api/bookings/:id/checkout — teller check-out with billing
// Billing rules:
//   • First FREE_HOURS (2hrs) are included at no extra charge
//   • Every hour (or part thereof) BEYOND the free window is billed at RATE_PER_HOUR (₱15)
//   • Example: 2h 5min → 1 billable hour → ₱15
const checkOutBooking = async (req, res) => {
  try {
    const booking = await Booking.findByPk(parseInt(req.params.id));
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Cannot check out a booking with status '${booking.status}'`,
      });
    }

    const location = booking.locationId ? await Location.findByPk(booking.locationId) : null;
    const RATE_PER_HOUR = Number(location?.overtimeRatePerHour ?? 15);
    const FREE_HOURS    = Number(location?.freeHours ?? 2);

    const checkInAt    = booking.checkInAt ? new Date(booking.checkInAt) : new Date();
    const checkOutAt   = new Date();
    const elapsedMs    = Math.max(0, checkOutAt - checkInAt);
    const elapsedHrs   = elapsedMs / (1000 * 60 * 60);
    const overtimeHrs  = Math.max(0, elapsedHrs - FREE_HOURS);   // hours beyond the free window
    const billableHrs  = Math.ceil(overtimeHrs);                  // round up to next hour
    const finalAmount  = billableHrs * RATE_PER_HOUR;             // ₱0 if still within 2 hrs

    await booking.update({ status: 'completed', checkOutAt, finalAmount });

    // Release the parking spot back to availability
    if (booking.locationId) {
      await Location.increment('availableSpots', { by: 1, where: { id: booking.locationId } });
    }

    const updated   = await Booking.findByPk(booking.id);
    const formatted = formatBooking(updated.toJSON());
    logBookingCheckOut({ booking: formatted, adminId: req.user.id });

    const durationMins   = Math.round(elapsedMs / 60000);
    const overtimeMins   = Math.max(0, durationMins - FREE_HOURS * 60);
    res.json({
      success: true,
      data: {
        ...formatted,
        billing: {
          checkInAt:      checkInAt.toISOString(),
          checkOutAt:     checkOutAt.toISOString(),
          durationMins,
          durationLabel:  durationMins < 60
            ? `${durationMins} min`
            : `${Math.floor(durationMins / 60)}h ${durationMins % 60}m`,
          freeHours:      FREE_HOURS,
          overtimeMins,
          overtimeLabel:  overtimeMins <= 0 ? 'None'
            : overtimeMins < 60 ? `${overtimeMins} min`
            : `${Math.floor(overtimeMins / 60)}h ${overtimeMins % 60}m`,
          ratePerHour:    RATE_PER_HOUR,
          billableHours:  billableHrs,
          finalAmount,
        },
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/bookings/slots/:locationId?date=YYYY-MM-DD
const getAvailableSlots = async (req, res) => {
  try {
    const { date } = req.query;
    const slots = await bookingService.getAvailableSlots(req.params.locationId, date);
    res.json({ success: true, data: slots });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/bookings/:id/checkin — teller marks customer as checked in (SCRUM-1007)
// Rules:
//   • Booking must be 'upcoming'
//   • Check-in is allowed from 15 minutes BEFORE the slot start time up to the slot end
//   • Sets status → 'active', records checkInAt, flags checkedInByTeller = true
const notificationService = require('../services/notificationService');
const checkInBooking = async (req, res) => {
  try {
    const booking = await Booking.findByPk(parseInt(req.params.id));
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.status !== 'upcoming') {
      return res.status(400).json({
        success: false,
        message: `Cannot check in — booking status is '${booking.status}'. Only 'upcoming' bookings can be checked in.`,
      });
    }

    // Parse slot start time from "HH:MM - HH:MM" format, e.g. "10:00 - 11:00"
    const [startStr] = (booking.timeSlot || '').split(' - ');
    const bookingDate = booking.date; // YYYY-MM-DD
    const slotStart  = startStr ? new Date(`${bookingDate}T${startStr}:00`) : null;
    const slotEnd    = slotStart ? new Date(slotStart.getTime() + 60 * 60 * 1000) : null;
    const now        = new Date();
    const GRACE_MS   = 15 * 60 * 1000; // 15 minutes

    if (slotStart) {
      const earliest = new Date(slotStart.getTime() - GRACE_MS);
      if (now < earliest) {
        const minsUntil = Math.ceil((earliest - now) / 60000);
        return res.status(400).json({
          success: false,
          message: `Too early to check in — check-in opens ${minsUntil} minute(s) before the slot starts (${startStr}).`,
        });
      }
      if (slotEnd && now > slotEnd) {
        return res.status(400).json({
          success: false,
          message: `Check-in window has passed — this slot ended at ${(booking.timeSlot || '').split(' - ')[1]}.`,
        });
      }
    }

    await booking.update({
      status:            'active',
      checkInAt:         now,
      checkedInByTeller: true,
    });

    const formatted = formatBooking(booking.toJSON());

    // Notify the customer in-app
    notificationService.notifySystem(
      booking.userId,
      '✅ Checked In!',
      `You have been successfully checked in by the teller for slot ${booking.spot} at ${booking.locationName}. Reference: ${booking.reference}`
    );

    res.json({
      success: true,
      message: 'Customer checked in successfully',
      data:    formatted,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  createBooking,
  getMyBookings,
  getAllBookings,
  getBookingById,
  cancelBooking,
  updateBookingStatus,
  checkInBooking,
  checkOutBooking,
  getAvailableSlots,
};
