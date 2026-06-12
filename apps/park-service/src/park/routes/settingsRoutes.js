const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminAuth');
const { getSettings, updateSettings, getParkingRates, updateParkingRate, getAdminUsers } = require('../controllers/settingsController');

router.get('/parking-rates', protect, adminOnly, getParkingRates);
router.put('/parking-rates/:id', protect, adminOnly, updateParkingRate);
router.get('/admin-users', protect, adminOnly, getAdminUsers);
router.get('/:category', protect, adminOnly, getSettings);
router.put('/:category', protect, adminOnly, updateSettings);

module.exports = router;
