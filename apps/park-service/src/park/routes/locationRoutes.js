const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly, adminOrTeller } = require('../middleware/adminAuth');
const {
  getLocations, getLocation, createLocation, updateLocation, deleteLocation,
  updatePrice, updateOperatingHours,
} = require('../controllers/locationController');

// Public/customer + staff routes
router.get('/',     protect, getLocations);
router.get('/:id',  protect, getLocation);

// Admin-only: create, delete
router.post('/',         protect, adminOnly, createLocation);
router.delete('/:id',    protect, adminOnly, deleteLocation);

// Admin + business_partner: update general info
router.put('/:id',       protect, adminOrTeller, updateLocation);

// Business partner: set hourly rate for their own location
router.patch('/:id/price', protect, updatePrice);

// Admin + Business Partner: operating hours
router.patch('/:id/hours', protect, updateOperatingHours);

module.exports = router;
