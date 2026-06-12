'use strict';
/**
 * analyticsController.js
 * ======================
 * getVehicleTypeDistribution uses bookings.vehicleType directly — no JOIN.
 * All other queries are already single-table or aggregate-only.
 */

const { QueryTypes } = require('sequelize');
const { sequelize }  = require('../config/db');
const { Booking, User, Location } = require('../models/index');

// GET /api/analytics/dashboard
const getDashboardStats = async (req, res) => {
  try {
    const [totalBookings, activeUsers, totalLocations, parkingSpots, revenue] = await Promise.all([
      Booking.count(),
      User.count({ where: { role: 'customer' } }),
      Location.count({ where: { status: 'active' } }),
      Location.sum('totalSpots').then((v) => v || 0),
      Booking.sum('amount', { where: { paymentStatus: 'paid' } }).then((v) => v || 0),
    ]);
    res.json({ success: true, data: { totalBookings, activeUsers, parkingSpots, totalLocations, revenue } });
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
       FROM bookings
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
       FROM bookings
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
       FROM bookings
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
       FROM bookings
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
