const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly, adminOrTeller } = require('../middleware/adminAuth');
const {
  getSlotsByLocation,
  getAvailableSlots,
  getDashboardSlots,
  getSlot,
  createSlot,
  updateSlot,
  deleteSlot,
  generateSlots,
} = require('../controllers/parkingSlotController');

// Public/customer routes (require auth)
router.get('/location/:locationId', protect, getSlotsByLocation);
router.get('/available/:locationId', protect, getAvailableSlots);

// Dashboard + slot management — business_partner and teller can view & manage their slots
router.get('/dashboard/:locationId', protect, adminOrTeller, getDashboardSlots);
router.get('/:id', protect, getSlot);

// Slot CRUD — allow business_partner to manage their own location's slots
router.post('/generate', protect, adminOrTeller, generateSlots);
router.post('/', protect, adminOrTeller, createSlot);
router.put('/:id', protect, adminOrTeller, updateSlot);
router.delete('/:id', protect, adminOnly, deleteSlot);   // delete stays admin-only for safety

module.exports = router;
