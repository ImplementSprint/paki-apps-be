const { Op } = require('sequelize');
const { Location, Booking } = require('../models/index');

// ── Helper: compute live availableSpots from the bookings table ───────────────
// This prevents the stored counter from permanently drifting when bookings
// are created / cancelled / completed outside normal flow (seed, migration, etc.)
const recomputeAvailableSpots = async (locationId, totalSpots) => {
  const activeCount = await Booking.count({
    where: {
      locationId,
      status: { [Op.in]: ['upcoming', 'active'] },
    },
  });
  return Math.max(0, totalSpots - activeCount);
};

// GET /api/locations
const getLocations = async (req, res) => {
  try {
    const { search, status } = req.query;
    const where = {};

    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { address: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const locations = await Location.findAll({ where, order: [['name', 'ASC']] });

    // Recompute availableSpots from live booking data for each location
    const enriched = await Promise.all(
      locations.map(async (loc) => {
        const json = loc.toJSON();
        json.availableSpots = await recomputeAvailableSpots(loc.id, loc.totalSpots);
        return json;
      })
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/locations/:id
const getLocation = async (req, res) => {
  try {
    const location = await Location.findByPk(req.params.id);
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
    const json = location.toJSON();
    json.availableSpots = await recomputeAvailableSpots(location.id, location.totalSpots);
    res.json({ success: true, data: json });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/locations (admin)
const createLocation = async (req, res) => {
  try {
    const { totalSpots, ...rest } = req.body;
    const ts = parseInt(totalSpots) || 100;
    const location = await Location.create({ ...rest, totalSpots: ts, availableSpots: ts });
    res.status(201).json({ success: true, data: location.toJSON() });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// PUT /api/locations/:id (admin)
const updateLocation = async (req, res) => {
  try {
    const location = await Location.findByPk(req.params.id);
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });

    const staffEditable = ['overtimeRatePerHour', 'freeHours', 'operatingHours'];
    const isAdmin = req.user.role === 'admin';
    const updates = isAdmin
      ? { ...req.body }
      : Object.fromEntries(
          Object.entries(req.body).filter(([key]) => staffEditable.includes(key))
        );

    if (!isAdmin && Object.keys(updates).length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Only pricing and operating hours can be updated by staff users',
      });
    }

    if (updates.overtimeRatePerHour !== undefined) {
      const rate = Number(updates.overtimeRatePerHour);
      if (!Number.isFinite(rate) || rate < 0) {
        return res.status(400).json({ success: false, message: 'overtimeRatePerHour must be a positive number' });
      }
      updates.overtimeRatePerHour = rate;
    }

    if (updates.freeHours !== undefined) {
      const freeHours = Number.parseInt(updates.freeHours, 10);
      if (!Number.isInteger(freeHours) || freeHours < 0 || freeHours > 24) {
        return res.status(400).json({ success: false, message: 'freeHours must be between 0 and 24' });
      }
      updates.freeHours = freeHours;
    }

    if (updates.totalSpots !== undefined) {
      const newTotal = parseInt(updates.totalSpots) || location.totalSpots;
      updates.availableSpots = await recomputeAvailableSpots(location.id, newTotal);
    }

    await location.update(updates);
    const json = location.toJSON();
    // Return the live availableSpots so the UI is immediately accurate
    json.availableSpots = await recomputeAvailableSpots(location.id, location.totalSpots);
    res.json({ success: true, data: json });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// DELETE /api/locations/:id (admin)
const deleteLocation = async (req, res) => {
  try {
    const location = await Location.findByPk(req.params.id);
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
    await location.destroy();
    res.json({ success: true, message: 'Location deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/locations/:id/hours — admin or business_partner
const { sequelize } = require('../config/db');
const DEFAULT_SCHEDULE = {
  mon: { open: '06:00', close: '23:00', closed: false },
  tue: { open: '06:00', close: '23:00', closed: false },
  wed: { open: '06:00', close: '23:00', closed: false },
  thu: { open: '06:00', close: '23:00', closed: false },
  fri: { open: '06:00', close: '23:00', closed: false },
  sat: { open: '06:00', close: '23:00', closed: false },
  sun: { open: '06:00', close: '23:00', closed: false },
};
const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];

const updateOperatingHours = async (req, res) => {
  try {
    if (!['admin','teller','business_partner'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorised' });
    }
    const location = await Location.findByPk(req.params.id);
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });

    const existing = location.getDataValue('operatingHours') ?? DEFAULT_SCHEDULE;
    const base = typeof existing === 'string' ? DEFAULT_SCHEDULE : existing;
    const merged = { ...base };
    for (const day of DAYS) {
      if (req.body[day]) {
        merged[day] = {
          open:   req.body[day].open   ?? base[day]?.open   ?? '06:00',
          close:  req.body[day].close  ?? base[day]?.close  ?? '23:00',
          closed: req.body[day].closed ?? base[day]?.closed ?? false,
        };
      }
    }

    await location.update({ operatingHours: merged });
    await sequelize.query(
      'UPDATE parking_lot.locations SET "operatingHoursJson" = :s::jsonb WHERE id = :id',
      { replacements: { s: JSON.stringify(merged), id: location.id } }
    );

    const json = location.toJSON();
    json.availableSpots = await recomputeAvailableSpots(location.id, location.totalSpots);
    res.json({ success: true, data: json, message: 'Operating hours updated' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getLocations, getLocation, createLocation, updateLocation, deleteLocation, updateOperatingHours };
