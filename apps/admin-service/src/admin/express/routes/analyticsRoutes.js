const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly, adminOrTeller } = require('../middleware/adminAuth');
const {
  getDashboardStats,
  getRevenueData,
  getOccupancyData,
  getVehicleTypeDistribution,
  getPaymentMethodDistribution,
} = require('../controllers/analyticsController');

// Read-only analytics: accessible by admin, teller, and business_partner
router.get('/dashboard',        protect, adminOrTeller, getDashboardStats);
router.get('/revenue',          protect, adminOrTeller, getRevenueData);
router.get('/occupancy',        protect, adminOrTeller, getOccupancyData);
router.get('/vehicle-types',    protect, adminOrTeller, getVehicleTypeDistribution);
router.get('/payment-methods',  protect, adminOrTeller, getPaymentMethodDistribution);

module.exports = router;