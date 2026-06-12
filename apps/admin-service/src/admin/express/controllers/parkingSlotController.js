'use strict';
/**
 * parkingSlotController.js
 * ========================
 * getDashboardSlots reads booking snapshot columns (userName, vehiclePlate, etc.)
 * directly — no JOIN on User or Vehicle.
 */

const { Op } = require('sequelize');
const { ParkingSlot, Booking, Location } = require('../models/index');
const {
  computeTimingMeta,
  deriveDashboardStatus,
  recommendedPollIntervalMs,
  windowsOverlap,
  isNoShowBooking,
} = require('../utils/timeUtils');

// ── Slot size from type ───────────────────────────────────────────────────────
function sizeForType(type) {
  if (type === 'motorcycle')               return 'compact';
  if (type === 'ev_charging' || type === 'vip') return 'large';
  return 'standard';
}

// ── Build slot rows for bulk-generate ────────────────────────────────────────
function buildSlots(locationId, sections, slotsPerSection, floors) {
  const slots = [];
  for (let floor = 1; floor <= floors; floor++) {
    for (const section of sections) {
      for (let i = 1; i <= slotsPerSection; i++) {
        const shortLabel = `${section}${i}`;
        const label = floors > 1 ? `F${floor}-${shortLabel}` : shortLabel;
        const isHandicapped = i === 1 && section === sections[0];
        const isEV          = i === slotsPerSection && section === sections[sections.length - 1];
        const type = isHandicapped ? 'handicapped' : isEV ? 'ev_charging' : 'regular';
        slots.push({
          locationId: parseInt(locationId),
          label, section, floor, type,
          size: sizeForType(type),
          status: 'available',
          vehicleTypeAllowed: 'any',
        });
      }
    }
  }
  return slots;
}

// ── Controllers ──────────────────────────────────────────────────────────────

// GET /api/parking-slots/location/:locationId
const getSlotsByLocation = async (req, res) => {
  try {
    const slots = await ParkingSlot.findAll({
      where: { locationId: req.params.locationId },
      order: [['floor', 'ASC'], ['section', 'ASC'], ['label', 'ASC']],
    });
    res.json({ success: true, data: slots.map((s) => s.toJSON()) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/parking-slots/available/:locationId?date=YYYY-MM-DD&timeSlot=HH:00+-+HH:00
const getAvailableSlots = async (req, res) => {
  try {
    const { locationId } = req.params;
    const { date, timeSlot } = req.query;
    if (!date || !timeSlot) {
      return res.status(400).json({ success: false, message: 'date and timeSlot query params are required' });
    }

    // Index scan on bookings — no JOIN
    const allBookings = await Booking.findAll({
      where: {
        locationId,
        date,
        status:        { [Op.in]: ['upcoming', 'active'] },
        parkingSlotId: { [Op.not]: null },
      },
      attributes: ['parkingSlotId', 'timeSlot', 'status', 'date'],
      raw: true,
    });

    const conflictingIds = allBookings
      .filter((b) => {
        if (!windowsOverlap(b.timeSlot, timeSlot)) return false;
        if (b.status === 'active')   return true;
        if (b.status === 'upcoming') return !isNoShowBooking(b);
        return false;
      })
      .map((b) => b.parkingSlotId);

    const where = {
      locationId,
      status: { [Op.notIn]: ['maintenance'] },
    };
    if (conflictingIds.length > 0) where.id = { [Op.notIn]: conflictingIds };

    const slots = await ParkingSlot.findAll({
      where,
      order: [['floor', 'ASC'], ['section', 'ASC'], ['label', 'ASC']],
    });

    res.json({ success: true, data: slots.map((s) => s.toJSON()) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/parking-slots/dashboard/:locationId?date=YYYY-MM-DD
 * Returns all slots with real-time booking status + timing metadata.
 * Reads booking snapshot columns — NO JOIN on User or Vehicle.
 */
const getDashboardSlots = async (req, res) => {
  try {
    const { locationId } = req.params;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    // Two index scans in parallel — no JOINs
    const [slots, bookings] = await Promise.all([
      ParkingSlot.findAll({
        where: { locationId },
        order: [['floor', 'ASC'], ['section', 'ASC'], ['label', 'ASC']],
        raw:   true,
      }),
      Booking.findAll({
        where: {
          locationId,
          date,
          status:        { [Op.in]: ['upcoming', 'active'] },
          parkingSlotId: { [Op.not]: null },
        },
        // Only select what the dashboard UI needs — snapshot fields included
        attributes: [
          'id', 'parkingSlotId', 'reference', 'timeSlot', 'status',
          'amount', 'paymentMethod',
          'userName', 'userPhone', 'userEmail',
          'vehiclePlate', 'vehicleType', 'vehicleBrand', 'vehicleModel', 'vehicleColor',
        ],
        raw: true,
      }),
    ]);

    // slotId → booking map
    const bookingMap = {};
    bookings.forEach((b) => { bookingMap[b.parkingSlotId] = b; });

    const timingMetas = [];

    const result = slots.map((sj) => {
      const booking     = bookingMap[sj.id] || null;
      const timingMeta  = computeTimingMeta(booking);
      const derivedStatus = deriveDashboardStatus(sj.status, booking, timingMeta);

      if (timingMeta) timingMetas.push(timingMeta);

      return {
        ...sj,
        derivedStatus,
        booking: booking
          ? {
              _id:           String(booking.id),
              reference:     booking.reference,
              timeSlot:      booking.timeSlot,
              status:        booking.status,
              amount:        booking.amount,
              paymentMethod: booking.paymentMethod,
              timing:        timingMeta,
              // User data from snapshot — no JOIN
              user: booking.userName
                ? { name: booking.userName, phone: booking.userPhone, email: booking.userEmail }
                : null,
              // Vehicle data from snapshot — no JOIN
              vehicle: booking.vehiclePlate
                ? {
                    plateNumber: booking.vehiclePlate,
                    type:        booking.vehicleType,
                    brand:       booking.vehicleBrand,
                    model:       booking.vehicleModel,
                    color:       booking.vehicleColor,
                  }
                : null,
            }
          : null,
      };
    });

    res.json({
      success:           true,
      data:              result,
      recommendedPollMs: recommendedPollIntervalMs(timingMetas),
      serverTime:        new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/parking-slots/:id
const getSlot = async (req, res) => {
  try {
    const slot = await ParkingSlot.findByPk(req.params.id);
    if (!slot) return res.status(404).json({ success: false, message: 'Slot not found' });
    res.json({ success: true, data: slot.toJSON() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/parking-slots (admin)
const createSlot = async (req, res) => {
  try {
    const slot = await ParkingSlot.create(req.body);
    res.status(201).json({ success: true, data: slot.toJSON() });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// PUT /api/parking-slots/:id (admin)
const updateSlot = async (req, res) => {
  try {
    const slot = await ParkingSlot.findByPk(req.params.id);
    if (!slot) return res.status(404).json({ success: false, message: 'Slot not found' });
    await slot.update(req.body);
    res.json({ success: true, data: slot.toJSON() });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// DELETE /api/parking-slots/:id (admin)
const deleteSlot = async (req, res) => {
  try {
    const slot = await ParkingSlot.findByPk(req.params.id);
    if (!slot) return res.status(404).json({ success: false, message: 'Slot not found' });
    await slot.destroy();
    res.json({ success: true, message: 'Slot deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/parking-slots/generate (admin)
 * Replaces all slots for the location with freshly generated ones.
 */
const generateSlots = async (req, res) => {
  try {
    const { locationId, sections, slotsPerSection, floors } = req.body;
    if (!locationId) {
      return res.status(400).json({
        success: false,
        message: 'locationId is required',
      });
    }

    if (Array.isArray(req.body.slots) && req.body.slots.length > 0) {
      const slotData = req.body.slots.map((slot) => ({
        locationId: parseInt(locationId),
        label: slot.label,
        section: slot.section || String(slot.label || 'A').charAt(0),
        floor: parseInt(slot.floor, 10) || 1,
        type: slot.type || 'regular',
        size: slot.size || sizeForType(slot.type || 'regular'),
        status: slot.status || 'available',
        vehicleTypeAllowed: slot.vehicleTypeAllowed || 'any',
      }));

      await ParkingSlot.destroy({ where: { locationId } });
      const created = await ParkingSlot.bulkCreate(slotData, { returning: true });
      const totalCount = created.length;
      try {
        const location = await Location.findByPk(locationId);
        if (location) {
          await location.update({ totalSpots: totalCount, availableSpots: totalCount });
        }
      } catch (syncErr) {
        console.warn(`[generateSlots] Could not sync location counts: ${syncErr.message}`);
      }

      return res.status(201).json({
        success: true,
        data: created.map((s) => s.toJSON()),
        message: `${created.length} slots generated for location ${locationId}`,
      });
    }

    if (!sections?.length || !slotsPerSection || !floors) {
      return res.status(400).json({
        success: false,
        message: 'sections, slotsPerSection, floors are required when slots is not provided',
      });
    }

    await ParkingSlot.destroy({ where: { locationId } });
    const slotData = buildSlots(locationId, sections, slotsPerSection, floors);
    const created  = await ParkingSlot.bulkCreate(slotData, { returning: true });

    const totalCount = created.length;
    try {
      const location = await Location.findByPk(locationId);
      if (location) {
        await location.update({ totalSpots: totalCount, availableSpots: totalCount });
      }
    } catch (syncErr) {
      console.warn(`[generateSlots] Could not sync location counts: ${syncErr.message}`);
    }

    res.status(201).json({
      success: true,
      data:    created.map((s) => s.toJSON()),
      message: `${created.length} slots generated for location ${locationId}`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getSlotsByLocation,
  getAvailableSlots,
  getDashboardSlots,
  getSlot,
  createSlot,
  updateSlot,
  deleteSlot,
  generateSlots,
};
