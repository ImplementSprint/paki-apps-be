'use strict';
/**
 * analyticsController.js
 * ======================
 * getVehicleTypeDistribution uses bookings.vehicleType directly — no JOIN.
 * All other queries are already single-table or aggregate-only.
 */

const { QueryTypes, Op } = require('sequelize');
const { sequelize }  = require('../config/db');
const { Booking, User, Location } = require('../models/index');

// GET /api/analytics/dashboard
const { getScopedHubIds } = require('./locationController');

const getDashboardStats = async (req, res) => {
  try {
    const scoped = await getScopedHubIds(req.user);
    const where = {};
    if (scoped !== null) {
      if (scoped.hubIds.length === 0) {
        return res.json({
          success: true,
          data: { total: 0, active: 0, upcoming: 0, completed: 0, cancelled: 0 }
        });
      }
      where.locationId = scoped.hubIds;
    }

    const [total, active, upcoming, completed, cancelled] = await Promise.all([
      Booking.count({ where }),
      Booking.count({ where: { ...where, status: 'active' } }),
      Booking.count({ where: { ...where, status: 'upcoming' } }),
      Booking.count({ where: { ...where, status: 'completed' } }),
      Booking.count({ where: { ...where, status: { [Op.or]: ['cancelled', 'no_show'] } } }),
    ]);

    res.json({
      success: true,
      data: { total, active, upcoming, completed, cancelled }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/analytics/revenue
const getRevenueData = async (req, res) => {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const data = await sequelize.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS "_id",
         SUM(amount)::float                                    AS revenue,
         COUNT(*)::int                                         AS bookings
       FROM reservation.bookings
       WHERE "paymentStatus" = 'paid'
         AND "createdAt" >= :sixMonthsAgo
       GROUP BY DATE_TRUNC('month', "createdAt")
       ORDER BY DATE_TRUNC('month', "createdAt") ASC`,
      { replacements: { sixMonthsAgo }, type: QueryTypes.SELECT }
    );

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/analytics/occupancy
const getOccupancyData = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const data = await sequelize.query(
      `SELECT
         "timeSlot" AS "_id",
         COUNT(*)::int AS count
       FROM reservation.bookings
       WHERE "date" = :today
         AND status IN ('upcoming', 'active')
       GROUP BY "timeSlot"
       ORDER BY "timeSlot" ASC`,
      { replacements: { today }, type: QueryTypes.SELECT }
    );

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/analytics/vehicle-types
 * Reads vehicleType snapshot column directly — no JOIN on vehicles table.
 */
const getVehicleTypeDistribution = async (req, res) => {
  try {
    const data = await sequelize.query(
      `SELECT
         "vehicleType" AS "_id",
         COUNT(*)::int AS count
       FROM reservation.bookings
       WHERE "vehicleType" IS NOT NULL
       GROUP BY "vehicleType"
       ORDER BY count DESC`,
      { type: QueryTypes.SELECT }
    );

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/analytics/payment-methods
const getPaymentMethodDistribution = async (req, res) => {
  try {
    const data = await sequelize.query(
      `SELECT
         "paymentMethod" AS "_id",
         COUNT(*)::int   AS count
       FROM reservation.bookings
       GROUP BY "paymentMethod"
       ORDER BY count DESC`,
      { type: QueryTypes.SELECT }
    );

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDashboardStats,
  getRevenueData,
  getOccupancyData,
  getVehicleTypeDistribution,
  getPaymentMethodDistribution,
};
