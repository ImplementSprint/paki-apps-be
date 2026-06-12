const { OperatingHours } = require('../models/index');

const getOperatingHours = async (req, res) => {
  try {
    const rows = await OperatingHours.findAll({
      where: { locationId: req.params.locationId },
      order: [['dayOfWeek', 'ASC']],
    });
    res.json({ success: true, data: rows.map((row) => row.toJSON()) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateOperatingHours = async (req, res) => {
  try {
    if (!['admin', 'teller', 'business_partner'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Staff access required' });
    }

    const rows = Array.isArray(req.body) ? req.body : req.body.hours;
    if (!Array.isArray(rows)) {
      return res.status(400).json({ success: false, message: 'hours must be an array' });
    }

    const saved = [];
    for (const row of rows) {
      const dayOfWeek = Number(row.dayOfWeek ?? row.day_of_week);
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) continue;

      const [record] = await OperatingHours.upsert({
        locationId: Number(req.params.locationId),
        dayOfWeek,
        openTime: row.openTime ?? row.open_time ?? null,
        closeTime: row.closeTime ?? row.close_time ?? null,
        isClosed: Boolean(row.isClosed ?? row.is_closed),
      }, { returning: true });
      saved.push(record.toJSON());
    }

    res.json({ success: true, data: saved });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { getOperatingHours, updateOperatingHours };
