const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const { avatarUpload, orDocUpload, crDocUpload } = require('../middleware/upload');
const {
  uploadAvatar,
  uploadOrDoc,
  uploadCrDoc,
  deleteUpload,
  getMyUploads,
} = require('../controllers/uploadController');

// ── Profile picture ─────────────────────────────────────────────────────────
// POST /api/uploads/avatar
// Body: multipart/form-data, field "avatar" (image/jpeg|png|webp|gif, max 5 MB)
router.post('/avatar', protect, avatarUpload, uploadAvatar);

// ── Vehicle documents ────────────────────────────────────────────────────────
// POST /api/uploads/vehicle/:vehicleId/or
// Body: multipart/form-data, field "orDoc" (image or PDF, max 5 MB)
router.post('/vehicle/:vehicleId/or', protect, orDocUpload, uploadOrDoc);

// POST /api/uploads/vehicle/:vehicleId/cr
// Body: multipart/form-data, field "crDoc" (image or PDF, max 5 MB)
router.post('/vehicle/:vehicleId/cr', protect, crDocUpload, uploadCrDoc);

// ── Management ───────────────────────────────────────────────────────────────
// GET  /api/uploads/my      — list all uploads belonging to the current user
router.get('/my', protect, getMyUploads);

// DELETE /api/uploads/:id   — delete a specific upload + its disk file
router.delete('/:id', protect, deleteUpload);

module.exports = router;
