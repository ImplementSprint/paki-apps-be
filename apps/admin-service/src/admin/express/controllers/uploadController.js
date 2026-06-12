'use strict';
/**
 * uploadController.js
 * ===================
 * Handles file uploads via Supabase Storage.
 *
 * Routes:
 *   POST   /api/uploads/avatar                — customer profile picture
 *   POST   /api/uploads/vehicle/:vehicleId/or — Official Receipt document
 *   POST   /api/uploads/vehicle/:vehicleId/cr — Certificate of Registration
 *   GET    /api/uploads/my                    — list user's upload records
 *   DELETE /api/uploads/:id                   — delete upload record + Storage file
 *
 * All files are stored in Supabase Storage:
 *   Bucket: process.env.SUPABASE_AVATAR_BUCKET  (default: 'avatars')
 *   Bucket: process.env.SUPABASE_VEHICLE_BUCKET (default: 'vehicle-docs')
 *
 * Storage path pattern:
 *   avatars:      user-{userId}/{timestamp}-{random}.{ext}
 *   vehicle-docs: user-{userId}/vehicle-{vehicleId}/{timestamp}-{random}.{ext}
 */

const path = require('path');
const { User, Vehicle, Upload } = require('../models/index');
const { uploadFile, deleteFile } = require('../config/supabaseStorage');

const AVATAR_BUCKET  = process.env.SUPABASE_AVATAR_BUCKET  || 'avatars';
const VEHICLE_BUCKET = process.env.SUPABASE_VEHICLE_BUCKET || 'vehicle-docs';

/** Build a unique storage path for the file */
function storagePath(prefix, originalname) {
  const ext  = path.extname(originalname).toLowerCase() || '.bin';
  const name = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
  return `${prefix}/${name}`;
}

// ── POST /api/uploads/avatar ─────────────────────────────────────────────────
const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const filePath = storagePath(`user-${req.user.id}`, req.file.originalname);

    // Upload buffer directly to Supabase Storage
    const url = await uploadFile(AVATAR_BUCKET, filePath, req.file.buffer, req.file.mimetype);

    // Persist upload record in DB
    const upload = await Upload.create({
      userId:       req.user.id,
      entityType:   'user_avatar',
      entityId:     req.user.id,
      filename:     filePath,            // storagePath for future deletion
      originalName: req.file.originalname,
      mimeType:     req.file.mimetype,
      size:         req.file.size,
      url,
    });

    // Update user profile picture URL
    const user = await User.findByPk(req.user.id);
    if (user) await user.update({ profilePicture: url });

    res.json({ success: true, data: { url, upload: upload.toJSON() } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/uploads/vehicle/:vehicleId/or ───────────────────────────────────
const uploadOrDoc = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const vehicleId = parseInt(req.params.vehicleId, 10);
    const vehicle = await Vehicle.findOne({ where: { id: vehicleId, userId: req.user.id } });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }

    const filePath = storagePath(`user-${req.user.id}/vehicle-${vehicleId}`, req.file.originalname);
    const url = await uploadFile(VEHICLE_BUCKET, filePath, req.file.buffer, req.file.mimetype);

    const upload = await Upload.create({
      userId:       req.user.id,
      entityType:   'vehicle_or',
      entityId:     vehicleId,
      filename:     filePath,
      originalName: req.file.originalname,
      mimeType:     req.file.mimetype,
      size:         req.file.size,
      url,
    });

    await vehicle.update({ orDoc: url });

    res.json({ success: true, data: { url, upload: upload.toJSON() } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/uploads/vehicle/:vehicleId/cr ───────────────────────────────────
const uploadCrDoc = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const vehicleId = parseInt(req.params.vehicleId, 10);
    const vehicle = await Vehicle.findOne({ where: { id: vehicleId, userId: req.user.id } });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }

    const filePath = storagePath(`user-${req.user.id}/vehicle-${vehicleId}`, req.file.originalname);
    const url = await uploadFile(VEHICLE_BUCKET, filePath, req.file.buffer, req.file.mimetype);

    const upload = await Upload.create({
      userId:       req.user.id,
      entityType:   'vehicle_cr',
      entityId:     vehicleId,
      filename:     filePath,
      originalName: req.file.originalname,
      mimeType:     req.file.mimetype,
      size:         req.file.size,
      url,
    });

    await vehicle.update({ crDoc: url });

    res.json({ success: true, data: { url, upload: upload.toJSON() } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/uploads/:id ───────────────────────────────────────────────────
const deleteUpload = async (req, res) => {
  try {
    const record = await Upload.findOne({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!record) {
      return res.status(404).json({ success: false, message: 'Upload not found' });
    }

    // Determine bucket from entityType and delete from Supabase Storage
    const bucket = record.entityType === 'user_avatar' ? AVATAR_BUCKET : VEHICLE_BUCKET;
    try {
      await deleteFile(bucket, record.filename);
    } catch (storageErr) {
      // Log but don't fail — the DB record should still be removed
      console.warn('[Upload] Storage delete skipped:', storageErr.message);
    }

    await record.destroy();
    res.json({ success: true, message: 'File deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/uploads/my ───────────────────────────────────────────────────────
const getMyUploads = async (req, res) => {
  try {
    const uploads = await Upload.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
    });
    res.json({ success: true, data: uploads.map(u => u.toJSON()) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { uploadAvatar, uploadOrDoc, uploadCrDoc, deleteUpload, getMyUploads };
