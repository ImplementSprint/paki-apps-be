const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly, adminOrTeller } = require('../middleware/adminAuth');
const { getLocations, getLocation, createLocation, updateLocation, deleteLocation, updateOperatingHours } = require('../controllers/locationController');

// Public/customer routes
router.get('/',     protect, getLocations);
router.get('/:id',  protect, getLocation);

// Admin routes
router.post('/',         protect, adminOnly, createLocation);
router.put('/:id',       protect, adminOrTeller, updateLocation);
router.delete('/:id',    protect, adminOnly, deleteLocation);

// Admin + Business Partner: operating hours
router.patch('/:id/hours', protect, updateOperatingHours);

module.exports = router;
