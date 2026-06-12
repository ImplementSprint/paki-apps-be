'use strict';
/**
 * emailService.js — API Center + Nodemailer fallback
 * ====================================================
 * Primary channel: API Center shared email endpoint
 *   POST /shared/email/send  { to, subject, body, html }
 *
 * Fallback: Nodemailer via SMTP (when API Center is unreachable or not configured)
 *
 * Source pattern: paki-apps-be (ImplementSprint) → tribeClient.emailSend()
 */

const nodemailer = require('nodemailer');
const apiCenter  = require('../config/apiCenterClient');

// ── Nodemailer fallback ───────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── API Center send ───────────────────────────────────────────────────────────

/**
 * Send an email through the API Center shared email service.
 * Falls back to Nodemailer if API Center is unreachable.
 *
 * @param {string} to       Recipient email
 * @param {string} subject  Email subject
 * @param {string} html     HTML body
 * @param {string} [text]   Plain text fallback body
 */
const sendEmail = async (to, subject, html, text) => {
  // ── Try API Center first ─────────────────────────────────────────────────
  try {
    await apiCenter.post('/shared/email/send', {
      to: [{ email: to }],
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''), // strip tags for plain-text
    });
    console.log(`[Email] ✅ Sent via API Center → ${to}`);
    return;
  } catch (apErr) {
    console.warn(`[Email] API Center failed (${apErr.message}), falling back to SMTP`);
  }

  // ── SMTP fallback ────────────────────────────────────────────────────────
  if (!process.env.SMTP_USER) {
    console.log('[Email] SMTP not configured, skipping email');
    return;
  }
  try {
    await transporter.sendMail({
      from: `"PakiPark" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      text: text || undefined,
    });
    console.log(`[Email] ✅ Sent via SMTP → ${to}`);
  } catch (smtpErr) {
    console.error('[Email] SMTP send failed:', smtpErr.message);
  }
};

// ── Template helpers ──────────────────────────────────────────────────────────

const _wrap = (content) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
  <div style="background: linear-gradient(135deg, #1e3d5a, #2d6a4f); padding: 24px; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px; letter-spacing: 2px;">PakiPark</h1>
    <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 12px;">Smart Parking Solutions</p>
  </div>
  <div style="padding: 32px 28px; background: #f9fafb;">${content}</div>
  <div style="padding: 16px; background: #f0f0f0; text-align: center; font-size: 11px; color: #888;">
    © ${new Date().getFullYear()} PakiPark. All rights reserved.
  </div>
</div>`;

// ── Public email functions ────────────────────────────────────────────────────

/**
 * Booking confirmation email.
 */
const sendBookingConfirmation = async (userEmail, bookingData) => {
  const html = _wrap(`
    <h2 style="color: #1e3d5a; margin-top: 0;">✅ Booking Confirmed!</h2>
    <p style="color: #444;">Hi <strong>${bookingData.userName || 'there'}</strong>, your parking spot is reserved.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px; color: #666;">Reference</td><td style="padding: 8px; font-weight: bold; color: #1e3d5a;">${bookingData.reference}</td></tr>
      <tr style="background:#fff;"><td style="padding: 8px; color: #666;">Location</td><td style="padding: 8px;">${bookingData.location || bookingData.locationName}</td></tr>
      <tr><td style="padding: 8px; color: #666;">Spot</td><td style="padding: 8px;">${bookingData.spot}</td></tr>
      <tr style="background:#fff;"><td style="padding: 8px; color: #666;">Date</td><td style="padding: 8px;">${bookingData.date}</td></tr>
      <tr><td style="padding: 8px; color: #666;">Time</td><td style="padding: 8px;">${bookingData.timeSlot}</td></tr>
      <tr style="background:#fff;"><td style="padding: 8px; color: #666;">Amount</td><td style="padding: 8px; font-weight: bold; color: #2d6a4f;">₱${Number(bookingData.amount).toFixed(2)}</td></tr>
    </table>
    <p style="color: #666; font-size: 13px;">Please arrive within your reserved time slot. Thank you for using PakiPark!</p>
  `);
  await sendEmail(userEmail, `Booking Confirmed — ${bookingData.reference}`, html);
};

/**
 * Booking cancellation email.
 */
const sendBookingCancellation = async (userEmail, bookingData) => {
  const html = _wrap(`
    <h2 style="color: #c0392b; margin-top: 0;">❌ Booking Cancelled</h2>
    <p style="color: #444;">Your booking <strong>${bookingData.reference}</strong> has been cancelled.</p>
    ${bookingData.cancelReason ? `<p style="color: #666;">Reason: ${bookingData.cancelReason}</p>` : ''}
    <p style="color: #666; font-size: 13px;">If you have questions, please contact our support team.</p>
  `);
  await sendEmail(userEmail, `Booking Cancelled — ${bookingData.reference}`, html);
};

/**
 * Password reset email.
 */
const sendPasswordReset = async (userEmail, resetToken) => {
  const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
  const html = _wrap(`
    <h2 style="color: #1e3d5a; margin-top: 0;">🔐 Reset Your Password</h2>
    <p style="color: #444;">Click the button below to reset your PakiPark password. This link expires in <strong>1 hour</strong>.</p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #ee6b20, #d4541a); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px;">
        Reset Password
      </a>
    </div>
    <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email. Your account is safe.</p>
  `);
  await sendEmail(userEmail, 'Reset Your PakiPark Password', html);
};

/**
 * Booking reminder email (sent before check-in time).
 */
const sendBookingReminder = async (userEmail, bookingData) => {
  const html = _wrap(`
    <h2 style="color: #1e3d5a; margin-top: 0;">Parking Reminder</h2>
    <p style="color: #444;">Just a reminder that your parking at <strong>${bookingData.location || bookingData.locationName}</strong> starts soon.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px; color: #666;">Reference</td><td style="padding: 8px; font-weight: bold;">${bookingData.reference}</td></tr>
      <tr style="background:#fff;"><td style="padding: 8px; color: #666;">Date & Time</td><td style="padding: 8px;">${bookingData.date} at ${bookingData.timeSlot}</td></tr>
      <tr><td style="padding: 8px; color: #666;">Spot</td><td style="padding: 8px;">${bookingData.spot}</td></tr>
    </table>
    <p style="color: #666; font-size: 13px;">Please have your booking reference ready for the teller. Drive safe!</p>
  `);
  await sendEmail(userEmail, `Parking Reminder — ${bookingData.date}`, html);
};

/**
 * OTP / verification email.
 */
const sendOTPEmail = async (userEmail, otp) => {
  const html = _wrap(`
    <h2 style="color: #1e3d5a; margin-top: 0;">🔑 Verification Code</h2>
    <p style="color: #444;">Use the code below to verify your PakiPark account. Valid for <strong>10 minutes</strong>.</p>
    <div style="text-align: center; margin: 28px 0;">
      <span style="display: inline-block; background: #1e3d5a; color: white; font-size: 36px; font-weight: bold; letter-spacing: 12px; padding: 18px 32px; border-radius: 8px;">
        ${otp}
      </span>
    </div>
    <p style="color: #999; font-size: 12px;">Never share this code with anyone. PakiPark staff will never ask for your OTP.</p>
  `);
  await sendEmail(userEmail, 'Your PakiPark Verification Code', html);
};

/**
 * Overtime warning email (sent 15 mins before free hours end).
 */
const sendOvertimeWarningEmail = async (userEmail, bookingData) => {
  const html = _wrap(`
    <h2 style="color: #f39c12; margin-top: 0;">⚠️ Parking Time Almost Up</h2>
    <p style="color: #444;">Hi <strong>${bookingData.userName || 'there'}</strong>, your free 2-hour parking window for slot <strong>${bookingData.spot}</strong> at <strong>${bookingData.location || bookingData.locationName}</strong> will expire in 15 minutes.</p>
    <p style="color: #666; font-size: 13px;">Please check out soon to avoid overtime charges of ₱15/hour.</p>
  `);
  await sendEmail(userEmail, `Parking Time Almost Up — ${bookingData.reference}`, html);
};

/**
 * Overtime consumed email (sent when free hours are fully consumed).
 */
const sendOvertimeConsumedEmail = async (userEmail, bookingData) => {
  const html = _wrap(`
    <h2 style="color: #c0392b; margin-top: 0;">⏳ Overtime Started</h2>
    <p style="color: #444;">Hi <strong>${bookingData.userName || 'there'}</strong>, your free 2-hour parking window for slot <strong>${bookingData.spot}</strong> at <strong>${bookingData.location || bookingData.locationName}</strong> has been consumed.</p>
    <p style="color: #666; font-size: 13px;">You are now being billed at the overtime rate of ₱15/hour.</p>
  `);
  await sendEmail(userEmail, `Overtime Started — ${bookingData.reference}`, html);
};

module.exports = {
  sendEmail,
  sendBookingConfirmation,
  sendBookingCancellation,
  sendPasswordReset,
  sendBookingReminder,
  sendOTPEmail,
  sendOvertimeWarningEmail,
  sendOvertimeConsumedEmail,
};
