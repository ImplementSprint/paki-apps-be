const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * ParkingSlot — aligned with parking_lot.parking_slots
 *
 * Each slot has exactly ONE assigned teller (tellerUserId → UUID of the teller
 * in account.profiles / auth.users). This allows slot-level teller assignment
 * so a teller manages their own designated bay(s).
 *
 * locationId is UUID (parking_lot.locations.id).
 * tellerUserId is UUID (auth.users.id of the assigned teller — nullable).
 */
const ParkingSlot = sequelize.define(
  'ParkingSlot',
  {
    id: { 
      type: DataTypes.UUID, 
      primaryKey: true, 
      defaultValue: DataTypes.UUIDV4 
    },

    locationId: { 
      type: DataTypes.UUID, 
      allowNull: false,
      field: 'location_id'
    },

    label: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },

    section: { 
      type: DataTypes.STRING(10), 
      allowNull: true,
    },

    floor: { 
      type: DataTypes.STRING,    
      defaultValue: '1' 
    },

    type: {
      type:         DataTypes.STRING(30),
      defaultValue: 'regular',
    },

    status: {
      type:         DataTypes.STRING(20),
      defaultValue: 'available',
    },

    // Virtual fields for backward compatibility with frontend
    tellerUserId: { 
      type: DataTypes.VIRTUAL
    },

    colNumber: {
      type: DataTypes.VIRTUAL,
      get() {
        const lbl = this.getDataValue('label') || '';
        const match = String(lbl).match(/^([A-Za-z]+)(\d+)$/);
        return match ? match[2] : '';
      }
    },

    size: {
      type: DataTypes.VIRTUAL,
      get() { return 'standard'; },
    },

    vehicleTypeAllowed: {
      type: DataTypes.VIRTUAL,
      get() { return 'any'; },
    },
  },
  {
    tableName:  'parking_slots',
    schema:     'parking_lot',
    timestamps: false, // The schema command didn't show created_at/updated_at
    indexes: [
      { name: 'idx_parking_lot_slots_location',       fields: ['location_id'] },
    ],
  }
);

ParkingSlot.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  values._id = String(values.id);
  return values;
};

module.exports = ParkingSlot;