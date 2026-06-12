const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const { getMyVehicles, addVehicle, updateVehicle, deleteVehicle, setDefaultVehicle } = require('../controllers/vehicleController');

router.get('/',              protect, getMyVehicles);
router.post('/',             protect, addVehicle);
router.put('/:id',           protect, updateVehicle);
router.delete('/:id',        protect, deleteVehicle);
router.patch('/:id/default', protect, setDefaultVehicle);

module.exports = router;
