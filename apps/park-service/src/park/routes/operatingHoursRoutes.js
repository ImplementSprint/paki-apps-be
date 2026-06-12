const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getLocationHours, updateLocationHours } = require('../controllers/operatingHoursController');

router.get('/:locationId', protect, getLocationHours);
router.put('/:locationId', protect, updateLocationHours);

module.exports = router;
