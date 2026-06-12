const { Settings, ParkingRate, User, PaymentMethod } = require('../models/index');

// GET /api/settings/:category
const getSettings = async (req, res) => {
  try {
    const settings = await Settings.findAll({ where: { category: req.params.category } });
    const result = {};
    settings.forEach((s) => {
      result[s.key] = s.value;
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/settings/:category
const updateSettings = async (req, res) => {
  try {
    const { category } = req.params;
    const updates = req.body;

    for (const [key, value] of Object.entries(updates)) {
      await Settings.upsert({ key, value, category });
    }

    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/settings/parking-rates
const getParkingRates = async (req, res) => {
  try {
    const rates = await ParkingRate.findAll({ order: [['vehicleType', 'ASC']] });
    res.json({ success: true, data: rates.map((r) => r.toJSON()) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/settings/parking-rates/:id
const updateParkingRate = async (req, res) => {
  try {
    const rate = await ParkingRate.findByPk(req.params.id);
    if (!rate) return res.status(404).json({ success: false, message: 'Rate not found' });
    await rate.update(req.body);
    res.json({ success: true, data: rate.toJSON() });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/settings/payment-methods
const getPaymentMethods = async (req, res) => {
  try {
    const where = req.user.role === 'admin' ? {} : { userId: req.user.id };
    const methods = await PaymentMethod.findAll({ where, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: methods.map((m) => m.toJSON()) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/settings/admin-users
const getAdminUsers = async (req, res) => {
  try {
    const users = await User.findAll({ where: { role: 'admin' } });
    res.json({ success: true, data: users.map((u) => u.toJSON()) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getSettings, updateSettings, getParkingRates, updateParkingRate, getPaymentMethods, getAdminUsers };
