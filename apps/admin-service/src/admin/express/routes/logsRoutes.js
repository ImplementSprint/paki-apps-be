const express = require('express');
const router  = express.Router();
const { protect }              = require('../middleware/auth');
const { adminOrTeller } = require('../middleware/adminAuth');
const {
  getTransactionLogs,
  getTransactionStats,
  getActivityLogs,
  getActivityStats,
} = require('../controllers/logsController');

// Logs are readable by admin, teller, and business_partner
router.get('/transactions',        protect, adminOrTeller, getTransactionLogs);
router.get('/transactions/stats',  protect, adminOrTeller, getTransactionStats);
router.get('/activity',            protect, adminOrTeller, getActivityLogs);
router.get('/activity/stats',      protect, adminOrTeller, getActivityStats);

module.exports = router;
