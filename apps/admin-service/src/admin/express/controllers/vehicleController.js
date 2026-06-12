const { Op }     = require('sequelize');
const { Vehicle } = require('../models/index');

// GET /api/vehicles
const getMyVehicles = async (req, res) => {
  try {
    const vehicles = await Vehicle.findAll({
      where: { userId: req.user.id },
      order: [['isDefault', 'DESC'], ['createdAt', 'DESC']],
    });
    res.json({ success: true, data: vehicles.map((v) => v.toJSON()) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/vehicles
const addVehicle = async (req, res) => {
  try {
    // First vehicle for this user? Make it default automatically.
    const count = await Vehicle.count({ where: { userId: req.user.id } });
    const vehicle = await Vehicle.create({
      userId: req.user.id,
      ...req.body,
      isDefault: count === 0,
    });
    res.status(201).json({ success: true, data: vehicle.toJSON() });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// PUT /api/vehicles/:id
const updateVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found' });
    // Prevent overwriting isDefault via bulk req.body
    const { isDefault: _skip, ...safeBody } = req.body;
    await vehicle.update(safeBody);
    res.json({ success: true, data: vehicle.toJSON() });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// DELETE /api/vehicles/:id
const deleteVehicle = async (req, res) => {
  try {
    const count = await Vehicle.count({ where: { userId: req.user.id } });
    if (count <= 1) {
      return res.status(400).json({ success: false, message: 'You must have at least one vehicle' });
    }
    const vehicle = await Vehicle.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found' });

    const wasDefault = vehicle.isDefault;
    await vehicle.destroy();

    // If deleted vehicle was default, promote the oldest remaining vehicle
    if (wasDefault) {
      const next = await Vehicle.findOne({
        where: { userId: req.user.id },
        order: [['createdAt', 'ASC']],
      });
      if (next) await next.update({ isDefault: true });
    }

    res.json({ success: true, message: 'Vehicle deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/vehicles/:id/default — mark one vehicle as default, unset all others
const setDefaultVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found' });

    // Unset all defaults for this user first
    await Vehicle.update({ isDefault: false }, { where: { userId: req.user.id } });
    await vehicle.update({ isDefault: true });

    res.json({ success: true, data: vehicle.toJSON(), message: 'Default vehicle updated' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getMyVehicles, addVehicle, updateVehicle, deleteVehicle, setDefaultVehicle };
