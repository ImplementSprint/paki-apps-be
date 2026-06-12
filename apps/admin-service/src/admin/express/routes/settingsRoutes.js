const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly, adminOrTeller } = require('../middleware/adminAuth');
const {
  getSettings,
  updateSettings,
  getParkingRates,
  updateParkingRate,
  getPaymentMethods,
  getAdminUsers,
} = require('../controllers/settingsController');

router.get('/parking-rates', protect, adminOrTeller, getParkingRates);
router.put('/parking-rates/:id', protect, adminOnly, updateParkingRate);
router.get('/payment-methods', protect, adminOrTeller, getPaymentMethods);
router.get('/admin-users', protect, adminOrTeller, getAdminUsers);
router.get('/:category', protect, adminOrTeller, getSettings);
router.put('/:category', protect, adminOnly, updateSettings);

module.exports = router;
