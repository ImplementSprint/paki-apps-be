const { PaymentMethod } = require('../models/index');

const getPaymentMethods = async (req, res) => {
  try {
    const methods = await PaymentMethod.findAll({
      where: { userId: req.user.id },
      order: [['isDefault', 'DESC'], ['createdAt', 'DESC']],
    });
    res.json({ success: true, data: methods.map((method) => method.toJSON()) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createPaymentMethod = async (req, res) => {
  try {
    const payload = {
      userId: req.user.id,
      provider: req.body.provider || 'GCash',
      mobileNumber: req.body.mobileNumber,
      displayLabel: req.body.displayLabel,
      isDefault: Boolean(req.body.isDefault),
    };

    if (payload.isDefault) {
      await PaymentMethod.update({ isDefault: false }, { where: { userId: req.user.id } });
    }

    const method = await PaymentMethod.create(payload);
    res.status(201).json({ success: true, data: method.toJSON() });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updatePaymentMethod = async (req, res) => {
  try {
    const method = await PaymentMethod.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!method) return res.status(404).json({ success: false, message: 'Payment method not found' });

    if (req.body.isDefault) {
      await PaymentMethod.update({ isDefault: false }, { where: { userId: req.user.id } });
    }

    await method.update(req.body);
    res.json({ success: true, data: method.toJSON() });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
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

module.exports = {
  getPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
};
