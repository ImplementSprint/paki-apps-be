const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getMyPaymentMethods, addPaymentMethod, deletePaymentMethod } = require('../controllers/paymentMethodController');

router.get('/', protect, getMyPaymentMethods);
router.post('/', protect, addPaymentMethod);
router.delete('/:id', protect, deletePaymentMethod);

module.exports = router;
