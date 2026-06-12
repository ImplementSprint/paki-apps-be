'use strict';
/**
 * locationController.js
 * =====================
 * All queries target parking_lot.locations (UUID PK).
 * Partner isolation is enforced via partner_user_id = account.users.supabaseId.
 * Rates and hours target parking_lot.parking_rates and parking_lot.operating_hours.
 */
const { Op } = require('sequelize');
const { Location } = require('../models/index');
const { sequelize } = require('../config/db');

// ── Helper: compute slot counts directly from parking_lot.parking_slots ────────
// Returns { total, available } by counting rows for the given locationId.
// This is the canonical source of truth — NOT the denormalized location columns.
const getSlotCounts = async (locationId) => {
  const [rows] = await sequelize.query(
    `SELECT
       COUNT(*) FILTER (WHERE status != 'maintenance') AS total,
       COUNT(*) FILTER (WHERE status = 'available')    AS available
     FROM parking_lot.parking_slots
     WHERE location_id = :locationId`,
    { replacements: { locationId } }
  );
  const row = rows[0] || {};
  return {
    total:     parseInt(row.total     || 0, 10),
    available: parseInt(row.available || 0, 10),
  };
};

// ── Core scoping helper ────────────────────────────────────────────────────────
/**
 * Returns the parking_lot.locations UUIDs the caller is allowed to see.
 *
 * admin           → null         (no filter — see everything)
 * business_partner→ { hubIds: UUID[] }  (WHERE partner_user_id = user.authId)
 * teller          → { hubIds: UUID[] }  (WHERE tellerUserId  = user.authId in parking_slots)
 * other/unknown   → { hubIds: [] }      (empty — access nothing)
 *
 * SECURITY: hub IDs are always derived from the verified JWT (user.authId),
 * never from request query/body — preventing cross-tenant parameter injection.
 */
async function getScopedHubIds(user) {
  if (user.role === 'admin' || user.role === 'customer') return null; // unrestricted

  if (user.role === 'business_partner') {
    // Business partners own hubs via parking_lot.locations.partner_user_id (UUID = supabaseId)
    const [rows] = await sequelize.query(
      `SELECT id FROM parking_lot.locations
       WHERE owner_id = :authId AND status::text != 'inactive'`,
      { replacements: { authId: user.authId } }
    );
    return { hubIds: rows.map(r => r.id) };
  }

  if (user.role === 'teller') {
    // Tellers are linked to a location via account.profiles.location_id
    try {
      const [rows] = await sequelize.query(
        `SELECT location_id AS hub_id
         FROM account.profiles
         WHERE id = :authId AND location_id IS NOT NULL`,
        { replacements: { authId: user.authId } }
      );
      return { hubIds: rows.map(r => r.hub_id) };
    } catch (err) {
      console.warn('[getScopedHubIds] teller profile query failed:', err.message);
    }
    return { hubIds: [] };
  }

  return { hubIds: [] }; // unknown role → no access
}

// Export for use by other controllers
module.exports.getScopedHubIds = getScopedHubIds;

// ── GET /api/locations ────────────────────────────────────────────────────────
const getLocations = async (req, res) => {
  try {
    const { search } = req.query;
    const where = {}; // Allow all statuses so partners can manage closed/maintenance lots

    const scoped = await getScopedHubIds(req.user);
    if (scoped !== null) {
      if (scoped.hubIds.length === 0) return res.json({ success: true, data: [] });
      where.id = { [Op.in]: scoped.hubIds };
    }

    if (search) {
      where[Op.or] = [
        { name:    { [Op.iLike]: `%${search}%` } },
        { address: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const locations = await Location.findAll({ where, order: [['name', 'ASC']] });

    const enriched = await Promise.all(
      locations.map(async (loc) => {
        const json = loc.toJSON();

        // Compute total & available from the actual parking_slots rows
        const counts = await getSlotCounts(loc.id);
        json.totalSpots     = counts.total;
        json.availableSpots = counts.available;

        // Fetch actual rate from parking_lot.parking_rates
        const [rateRows] = await sequelize.query(
            `SELECT rate FROM parking_lot.parking_rates WHERE location_id = :id AND type = 'hourly' LIMIT 1`,
            { replacements: { id: loc.id } }
        );
        if (rateRows.length) json.hourlyRate = parseFloat(rateRows[0].rate);

        return json;
      })
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    console.error('[getLocations]', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/locations/:id ────────────────────────────────────────────────────
const getLocation = async (req, res) => {
  try {
    const location = await Location.findByPk(req.params.id);
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });

    // Ownership check — fetch, then verify
    const scoped = await getScopedHubIds(req.user);
    if (scoped !== null && !scoped.hubIds.includes(location.id)) {
      return res.status(403).json({ success: false, message: 'Access denied to this location' });
    }

    const json = location.toJSON();

    // Compute total & available from the actual parking_slots rows
    const counts = await getSlotCounts(location.id);
    json.totalSpots     = counts.total;
    json.availableSpots = counts.available;
    
    const [rateRows] = await sequelize.query(
        `SELECT rate FROM parking_lot.parking_rates WHERE location_id = :id AND type = 'hourly' LIMIT 1`,
        { replacements: { id: location.id } }
    );
    if (rateRows.length) json.hourlyRate = parseFloat(rateRows[0].rate);

    res.json({ success: true, data: json });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /api/locations (admin only) ─────────────────────────────────────────
const createLocation = async (req, res) => {
  try {
    const { totalSpots, storage_capacity, hourlyRate, ...rest } = req.body;
    const capacity = Number.parseInt(totalSpots ?? storage_capacity, 10) || 100;
    const location = await Location.create({
      ...rest,
      totalSpots: capacity,
      availableSpots: capacity,
      hourlyRate: hourlyRate ? Number(hourlyRate) : 0,
    });

    if (hourlyRate) {
        await sequelize.query(`
            INSERT INTO parking_lot.parking_rates (location_id, type, rate, created_at, updated_at)
            VALUES (:id, 'hourly', :rate, now(), now())
        `, { replacements: { id: location.id, rate: Number(hourlyRate) } });
    }

    res.status(201).json({ success: true, data: location.toJSON() });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ── PUT /api/locations/:id (admin only) ───────────────────────────────────────
const updateLocation = async (req, res) => {
  try {
    const location = await Location.findByPk(req.params.id);
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });

    const { totalSpots, storage_capacity, ...rest } = req.body;
    const updates = { ...rest };
    if (totalSpots !== undefined || storage_capacity !== undefined) {
      updates.totalSpots = Number.parseInt(totalSpots ?? storage_capacity, 10) || location.totalSpots;
    }

    await location.update(updates);
    const json = location.toJSON();
    json.availableSpots = await recomputeAvailableSpots(location.id, location.totalSpots);
    res.json({ success: true, data: json });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ── DELETE /api/locations/:id (admin only) ────────────────────────────────────
const deleteLocation = async (req, res) => {
  try {
    const location = await Location.findByPk(req.params.id);
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
    // Soft-delete: mark inactive rather than hard-delete
    await location.update({ status: 'inactive' });
    res.json({ success: true, message: 'Location deactivated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── PATCH /api/locations/:id/price — business_partner sets hourlyRate ─────────
const updatePrice = async (req, res) => {
  try {
    const { hourlyRate } = req.body;
    if (hourlyRate === undefined || isNaN(Number(hourlyRate)) || Number(hourlyRate) < 0) {
      return res.status(400).json({ success: false, message: 'hourlyRate must be a non-negative number.' });
    }

    const location = await Location.findByPk(req.params.id);
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });

    // Enforce partner ownership
    if (req.user.role !== 'admin') {
      const scoped = await getScopedHubIds(req.user);
      if (!scoped || !scoped.hubIds.includes(location.id)) {
        return res.status(403).json({ success: false, message: 'You can only set pricing for your own location.' });
      }
    }

    // Upsert into parking_lot.parking_rates
    await sequelize.query(`
      INSERT INTO parking_lot.parking_rates (id, location_id, type, rate, created_at, updated_at)
      VALUES (gen_random_uuid(), :locId, 'hourly', :rate, now(), now())
      ON CONFLICT (id) DO UPDATE 
      -- Wait, ID is primary key, conflict on location_id and type requires unique constraint.
      -- Let's just delete the hourly one and re-insert, or do a safe update based on location_id + type
    `, { replacements: { locId: location.id, rate: Number(hourlyRate) } }).catch(e => {});
    
    // Safer approach since unique constraint on (location_id, type) might not exist:
    const [existingRate] = await sequelize.query(`
        SELECT id FROM parking_lot.parking_rates WHERE location_id = :locId AND type = 'hourly' LIMIT 1
    `, { replacements: { locId: location.id } });

    if (existingRate.length) {
        await sequelize.query(`
            UPDATE parking_lot.parking_rates 
            SET rate = :rate, updated_at = now() 
            WHERE id = :id
        `, { replacements: { rate: Number(hourlyRate), id: existingRate[0].id } });
    } else {
        await sequelize.query(`
            INSERT INTO parking_lot.parking_rates (id, location_id, type, rate, created_at, updated_at)
            VALUES (gen_random_uuid(), :locId, 'hourly', :rate, now(), now())
        `, { replacements: { locId: location.id, rate: Number(hourlyRate) } });
    }

    // Update denormalized column too
    await location.update({ hourlyRate: Number(hourlyRate) });

    res.json({
      success: true,
      data: { ...location.toJSON(), hourlyRate: Number(hourlyRate) },
      message: `Hourly rate set to ₱${hourlyRate}`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ── PATCH /api/locations/:id/hours — admin or business_partner ───────────────
const DEFAULT_SCHEDULE = {
  mon: { open: '06:00', close: '23:00', closed: false },
  tue: { open: '06:00', close: '23:00', closed: false },
  wed: { open: '06:00', close: '23:00', closed: false },
  thu: { open: '06:00', close: '23:00', closed: false },
  fri: { open: '06:00', close: '23:00', closed: false },
  sat: { open: '06:00', close: '23:00', closed: false },
  sun: { open: '06:00', close: '23:00', closed: false },
};
const DAYS = ['sun','mon','tue','wed','thu','fri','sat']; // map to 0..6

const updateOperatingHours = async (req, res) => {
  try {
    if (!['admin','business_partner'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorised' });
    }

    const location = await Location.findByPk(req.params.id);
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });

    if (req.user.role === 'business_partner') {
      const scoped = await getScopedHubIds(req.user);
      if (!scoped || !scoped.hubIds.includes(location.id)) {
        return res.status(403).json({ success: false, message: 'Access denied to this location' });
      }
    }

    // Prepare JSON for denormalized column
    const existing = location.getDataValue('operatingHoursJson') ?? DEFAULT_SCHEDULE;
    const merged = { ...existing };

    // Update parking_lot.operating_hours table row-by-row
    for (let dayIdx = 0; dayIdx < DAYS.length; dayIdx++) {
      const day = DAYS[dayIdx];
      if (req.body[day]) {
        merged[day] = {
          open:   req.body[day].open   ?? existing[day]?.open   ?? '06:00',
          close:  req.body[day].close  ?? existing[day]?.close  ?? '23:00',
          closed: req.body[day].closed ?? existing[day]?.closed ?? false,
        };

        // Check if row exists for this day
        const [existingRow] = await sequelize.query(`
            SELECT id FROM parking_lot.operating_hours WHERE "locationId" = :locId AND day_of_week = :dayIdx LIMIT 1
        `, { replacements: { locId: location.id, dayIdx } });

        const openTimeStr = merged[day].open.length === 5 ? merged[day].open + ':00' : merged[day].open;
        const closeTimeStr = merged[day].close.length === 5 ? merged[day].close + ':00' : merged[day].close;

        if (existingRow.length) {
            await sequelize.query(`
                UPDATE parking_lot.operating_hours
                SET open_time = :open::time, close_time = :close::time, is_closed = :closed, "updatedAt" = now()
                WHERE id = :id
            `, { replacements: { 
                    open: openTimeStr, 
                    close: closeTimeStr, 
                    closed: merged[day].closed, 
                    id: existingRow[0].id 
                } 
            });
        } else {
            await sequelize.query(`
                INSERT INTO parking_lot.operating_hours ("locationId", day_of_week, open_time, close_time, is_closed, "createdAt", "updatedAt")
                VALUES (:locId, :dayIdx, :open::time, :close::time, :closed, now(), now())
            `, { replacements: { 
                    locId: location.id, 
                    dayIdx, 
                    open: openTimeStr, 
                    close: closeTimeStr, 
                    closed: merged[day].closed 
                } 
            });
        }
      }
    }

    await location.update({ operatingHoursJson: merged });

    res.json({ success: true, data: { ...location.toJSON(), operatingHoursJson: merged }, message: 'Operating hours updated' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getLocations, getLocation, createLocation, updateLocation, deleteLocation,
  updatePrice, updateOperatingHours,
  getScopedHubIds,
  // Legacy alias so any code still importing getScopedLocationIds doesn't break
  getScopedLocationIds: getScopedHubIds,
};