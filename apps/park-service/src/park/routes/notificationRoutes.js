const express    = require('express');
const router     = express.Router();
const { protect } = require('../middleware/auth');
const {
  getMyNotifications,
  getUnreadCount,
  markOneRead,
  markAllRead,
  deleteOne,
  clearAll,
} = require('../controllers/notificationController');

router.get('/',                  protect, getMyNotifications);  // paginated list
router.get('/unread-count',      protect, getUnreadCount);      // badge count
router.patch('/read-all',        protect, markAllRead);         // mark all read
router.delete('/',               protect, clearAll);            // clear all
router.patch('/:id/read',        protect, markOneRead);         // mark one read
router.delete('/:id',            protect, deleteOne);           // delete one

module.exports = router;
