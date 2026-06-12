'use strict';

const { Op, QueryTypes } = require('sequelize');
const { sequelize }      = require('../config/db');
const { TransactionLog, ActivityLog, User, Booking } = require('../models/index');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function paginate(query) {
  const page  = Math.max(1, parseInt(query.page  || 1));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || 20)));
  return { page, limit, offset: (page - 1) * limit };
}

function dateRange(query) {
  const where = {};
  if (query.from) where.createdAt = { ...where.createdAt, [Op.gte]: new Date(query.from) };
  if (query.to)   where.createdAt = { ...where.createdAt, [Op.lte]: new Date(query.to + 'T23:59:59Z') };
  return where;
}

// ─── Transaction Logs ─────────────────────────────────────────────────────────

// GET /api/logs/transactions
const getTransactionLogs = async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    const where = { ...dateRange(req.query) };

    if (req.query.status)          where.status          = req.query.status;
    if (req.query.paymentMethod)   where.paymentMethod   = req.query.paymentMethod;
    if (req.query.transactionType) where.transactionType = req.query.transactionType;
    if (req.query.reference)       where.reference       = { [Op.iLike]: `%${req.query.reference}%` };

    const { rows: logs, count: total } = await TransactionLog.findAndCountAll({
      where,
      include: [
        { model: User,    as: 'user',    attributes: ['id', 'name', 'email'], required: false },
        { model: Booking, as: 'booking', attributes: ['id', 'reference', 'spot', 'date', 'timeSlot'], required: false },
      ],
      order:    [['createdAt', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    res.json({
      success: true,
      data: {
        logs: logs.map(l => l.toJSON()),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/logs/transactions/stats
const getTransactionStats = async (req, res) => {
  try {
    const [totals, byMethod, byType, monthly] = await Promise.all([
      // Overall totals
      TransactionLog.findAll({
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM',   sequelize.col('amount')), 'totalAmount'],
        ],
        where: { status: 'success' },
        raw: true,
      }),

      // By payment method
      sequelize.query(
        `SELECT "paymentMethod" AS method,
                COUNT(*)::int   AS count,
                SUM(amount)::float AS total
         FROM transaction_logs
         WHERE status = 'success'
         GROUP BY "paymentMethod"
         ORDER BY count DESC`,
        { type: QueryTypes.SELECT }
      ),

      // By transaction type
      sequelize.query(
        `SELECT "transactionType" AS type,
                COUNT(*)::int    AS count,
                SUM(amount)::float AS total
         FROM transaction_logs
         GROUP BY "transactionType"
         ORDER BY count DESC`,
        { type: QueryTypes.SELECT }
      ),

      // Monthly revenue (last 6 months)
      sequelize.query(
        `SELECT TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS month,
                COUNT(*)::int      AS transactions,
                SUM(amount)::float AS revenue
         FROM transaction_logs
         WHERE status = 'success'
           AND "transactionType" = 'payment'
           AND "createdAt" >= NOW() - INTERVAL '6 months'
         GROUP BY DATE_TRUNC('month', "createdAt")
         ORDER BY DATE_TRUNC('month', "createdAt") ASC`,
        { type: QueryTypes.SELECT }
      ),
    ]);

    res.json({
      success: true,
      data: {
        totalTransactions: parseInt(totals[0]?.count  || 0),
        totalRevenue:      parseFloat(totals[0]?.totalAmount || 0),
        byPaymentMethod:   byMethod,
        byTransactionType: byType,
        monthlyRevenue:    monthly,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Activity Logs ────────────────────────────────────────────────────────────

// GET /api/logs/activity
const getActivityLogs = async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    const where = { ...dateRange(req.query) };

    if (req.query.severity)   where.severity   = req.query.severity;
    if (req.query.action)     where.action      = { [Op.iLike]: `%${req.query.action}%` };
    if (req.query.entityType) where.entityType  = req.query.entityType;
    if (req.query.userId)     where.userId      = parseInt(req.query.userId);

    const { rows: logs, count: total } = await ActivityLog.findAndCountAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email', 'role'], required: false },
      ],
      order:    [['createdAt', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    res.json({
      success: true,
      data: {
        logs: logs.map(l => l.toJSON()),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/logs/activity/stats
const getActivityStats = async (req, res) => {
  try {
    const [bySeverity, byAction, byEntity, recentCritical] = await Promise.all([
      sequelize.query(
        `SELECT severity, COUNT(*)::int AS count
         FROM activity_logs
         GROUP BY severity
         ORDER BY count DESC`,
        { type: QueryTypes.SELECT }
      ),

      sequelize.query(
        `SELECT action, COUNT(*)::int AS count
         FROM activity_logs
         GROUP BY action
         ORDER BY count DESC
         LIMIT 10`,
        { type: QueryTypes.SELECT }
      ),

      sequelize.query(
        `SELECT "entityType", COUNT(*)::int AS count
         FROM activity_logs
         WHERE "entityType" IS NOT NULL
         GROUP BY "entityType"
         ORDER BY count DESC`,
        { type: QueryTypes.SELECT }
      ),

      // Last 10 critical / warning events
      ActivityLog.findAll({
        where:   { severity: { [Op.in]: ['warning', 'critical'] } },
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'], required: false }],
        order:   [['createdAt', 'DESC']],
        limit:   10,
      }),
    ]);

    res.json({
      success: true,
      data: {
        bySeverity,
        topActions:     byAction,
        byEntityType:   byEntity,
        recentCritical: recentCritical.map(l => l.toJSON()),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getTransactionLogs,
  getTransactionStats,
  getActivityLogs,
  getActivityStats,
};
