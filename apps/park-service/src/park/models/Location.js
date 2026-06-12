const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * Location — maps to parking_lot.locations (the canonical establishment table).
 *
 * Schema: parking_lot
 * Primary key: UUID (id)
 * Owner link: partner_user_id UUID → account.users.supabaseId
 *
 * This replaces the old public.locations and routing.operator_hubs mappings.
 */
const Location = sequelize.define(
  'Location',
  {
    id: {
      type:       DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    // FK to account.users.supabaseId — identifies the Business Partner owner
    partnerUserId: { type: DataTypes.UUID, allowNull: true, field: 'owner_id' },
    name:          { type: DataTypes.STRING, allowNull: false },
    address:       { type: DataTypes.STRING, allowNull: false },
    lat:           { type: DataTypes.FLOAT,  allowNull: true },
    lng:           { type: DataTypes.FLOAT,  allowNull: true },
    amenities:     { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: true },
    totalSpots:    { type: DataTypes.INTEGER, defaultValue: 0, field: 'total_spots' },
    availableSpots:{ type: DataTypes.INTEGER, defaultValue: 0, field: 'available_spots' },
    hourlyRate:    { type: DataTypes.FLOAT, defaultValue: 0, field: 'pricePerHour' },
    status:        { type: DataTypes.STRING, defaultValue: 'active' },
    operatingHoursJson: { type: DataTypes.JSONB, allowNull: true, field: 'operatingHours' },
    createdAt:     { type: DataTypes.DATE, allowNull: true, field: 'created_at' },
    updatedAt:     { type: DataTypes.DATE, allowNull: true }, // exact match
    coordinates:   { type: DataTypes.JSONB, allowNull: true },
    imageUrl:      { type: DataTypes.TEXT, allowNull: true, field: 'image_url' },
    isActive:      { type: DataTypes.BOOLEAN, defaultValue: true, field: 'is_active' }
  },
  {
    tableName:  'locations',
    schema:     'parking_lot',
    timestamps: true,
  }
);

Location.prototype.toJSON = function () {
  const v = { ...this.get() };
  v._id      = String(v.id);
  v.hourlyRate    = v.hourlyRate    ?? 0;
  v.availableSpots = v.availableSpots ?? v.totalSpots;
  return v;
};

module.exports = Location;
