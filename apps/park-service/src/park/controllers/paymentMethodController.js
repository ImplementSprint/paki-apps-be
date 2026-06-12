'use strict';
const { PaymentMethod } = require('../models/index');

const getMyPaymentMethods = async (req, res) => {
  try {
    const methods = await PaymentMethod.findAll({ where: { userId: req.user.id } });
    res.json({ success: true, data: methods });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const addPaymentMethod = async (req, res) => {
  try {
    const { provider, mobile_number, display_label, is_default } = req.body;
    const method = await PaymentMethod.create({
      userId: req.user.id,
      provider,
      mobile_number,
      display_label,
      is_default
    });
    res.json({ success: true, data: method });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deletePaymentMethod = async (req, res) => {
  try {
    const method = await PaymentMethod.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!method) return res.status(404).json({ success: false, message: 'Payment method not found' });
    await method.destroy();
    res.json({ success: true, message: 'Payment method deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getMyPaymentMethods, addPaymentMethod, deletePaymentMethod };
