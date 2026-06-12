const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getOperatingHours, updateOperatingHours } = require('../controllers/operatingHoursController');

router.get('/:locationId', protect, getOperatingHours);
router.put('/:locationId', protect, updateOperatingHours);

module.exports = router;
