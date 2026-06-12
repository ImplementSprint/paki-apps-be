'use strict';
const { Op }           = require('sequelize');
const { Notification } = require('../models/index');

// GET /api/notifications  — list current user's notifications (newest first, paginated)
const getMyNotifications = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);

    const { rows: notifications, count: total } = await Notification.findAndCountAll({
      where:  { userId: req.user.id },
      order:  [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw:    true,
    });

    const unreadCount = await Notification.count({
      where: { userId: req.user.id, isRead: false },
    });

    res.json({
      success: true,
      data: {
        notifications: notifications.map(n => ({ ...n, _id: String(n.id) })),
        total,
        page,
        totalPages: Math.ceil(total / limit),
        unreadCount,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/notifications/unread-count  — lightweight badge count poll
const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.count({
      where: { userId: req.user.id, isRead: false },
    });
    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/notifications/:id/read  — mark one notification as read
const markOneRead = async (req, res) => {
  try {
    const n = await Notification.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!n) return res.status(404).json({ success: false, message: 'Notification not found' });
    await n.update({ isRead: true });
    res.json({ success: true, data: { ...n.toJSON(), isRead: true } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/notifications/read-all  — mark every notification as read
const markAllRead = async (req, res) => {
  try {
    await Notification.update({ isRead: true }, { where: { userId: req.user.id, isRead: false } });
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/notifications/:id  — delete one notification
const deleteOne = async (req, res) => {
  try {
    const n = await Notification.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!n) return res.status(404).json({ success: false, message: 'Notification not found' });
    await n.destroy();
    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/notifications  — clear all notifications for the user
const clearAll = async (req, res) => {
  try {
    await Notification.destroy({ where: { userId: req.user.id } });
    res.json({ success: true, message: 'All notifications cleared' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getMyNotifications, getUnreadCount, markOneRead, markAllRead, deleteOne, clearAll };
