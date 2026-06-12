const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
} = require('../controllers/paymentMethodController');

router.get('/', protect, getPaymentMethods);
router.post('/', protect, createPaymentMethod);
router.put('/:id', protect, updatePaymentMethod);
router.delete('/:id', protect, deletePaymentMethod);

module.exports = router;
