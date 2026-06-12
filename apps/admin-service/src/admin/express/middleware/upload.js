'use strict';
/**
 * upload.js — Multer middleware for PakiPark file uploads
 *
 * Uses memoryStorage so files are buffered in RAM and then streamed
 * directly to Supabase Storage (no disk writes).
 *
 * Allowed mime types:
 *   • Images : image/jpeg, image/png, image/webp, image/gif
 *   • Docs   : application/pdf
 *
 * Max file size : 5 MB
 */

const multer = require('multer');

// ── Use memory storage (buffer → Supabase, no local disk) ────────────────────
const storage = multer.memoryStorage();

// ── File filter ──────────────────────────────────────────────────────────────
const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
];

function fileFilter(req, file, cb) {
  if (ALLOWED_MIME.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}. Allowed: jpg, png, webp, gif, pdf`), false);
  }
}

// ── Multer instance ──────────────────────────────────────────────────────────
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ── Convenience middleware factories ─────────────────────────────────────────

/** Single-file upload for profile avatars (field name: "avatar") */
function avatarUpload(req, res, next) {
  upload.single('avatar')(req, res, next);
}

/** Single-file upload for vehicle OR doc (field name: "orDoc") */
function orDocUpload(req, res, next) {
  upload.single('orDoc')(req, res, next);
}

/** Single-file upload for vehicle CR doc (field name: "crDoc") */
function crDocUpload(req, res, next) {
  upload.single('crDoc')(req, res, next);
}

/** Accept any one file in either orDoc or crDoc field */
function vehicleDocUpload(req, res, next) {
  upload.fields([
    { name: 'orDoc', maxCount: 1 },
    { name: 'crDoc', maxCount: 1 },
  ])(req, res, next);
}

module.exports = { avatarUpload, orDocUpload, crDocUpload, vehicleDocUpload };
