'use strict';
const { OperatingHours } = require('../models/index');

const getLocationHours = async (req, res) => {
  try {
    const hours = await OperatingHours.findAll({ where: { locationId: req.params.locationId } });
    res.json({ success: true, data: hours });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateLocationHours = async (req, res) => {
  try {
    const { hours } = req.body; // Array of { day_of_week, open_time, close_time, is_closed }
    for (const h of hours) {
      await OperatingHours.upsert({
        locationId: req.params.locationId,
        ...h
      });
    }
    res.json({ success: true, message: 'Operating hours updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getLocationHours, updateLocationHours };
