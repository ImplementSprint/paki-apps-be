const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly, adminOrTeller } = require('../middleware/adminAuth');
const {
  createBooking,
  getMyBookings,
  getAllBookings,
  getBookingById,
  cancelBooking,
  updateBookingStatus,
  checkInBooking,
  checkOutBooking,
  getAvailableSlots,
} = require('../controllers/bookingController');

// ── Customer routes ───────────────────────────────────────────────────────────
router.post('/', protect, createBooking);
router.get('/my', protect, getMyBookings);
router.get('/slots/:locationId', protect, getAvailableSlots);
router.patch('/:id/cancel', protect, cancelBooking);

// ── Shared routes (customer sees own, staff see all) ──────────────────────────
router.get('/:id', protect, getBookingById);

// ── Staff routes (admin, teller, business_partner) ────────────────────────────
router.get('/', protect, adminOrTeller, getAllBookings);
router.patch('/:id/status',   protect, adminOrTeller, updateBookingStatus);
// Teller check-in (SCRUM-1007) — validates 15-min grace period
router.patch('/:id/checkin',  protect, adminOrTeller, checkInBooking);
// Checkout with time-based billing (₱15/hr for overtime beyond reserved slot)
router.patch('/:id/checkout', protect, adminOrTeller, checkOutBooking);

module.exports = router;