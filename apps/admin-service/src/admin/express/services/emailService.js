const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send booking confirmation email
 */
const sendBookingConfirmation = async (userEmail, bookingData) => {
  if (!process.env.SMTP_USER) {
    console.log('[Email Service] SMTP not configured, skipping email');
    return;
  }

  try {
    await transporter.sendMail({
      from: `"PakiPark" <${process.env.SMTP_USER}>`,
      to: userEmail,
      subject: `Booking Confirmed - ${bookingData.reference}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e3d5a; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">PakiPark</h1>
          </div>
          <div style="padding: 30px; background: #f9fafb;">
            <h2 style="color: #1e3d5a;">Booking Confirmed!</h2>
            <p>Reference: <strong>${bookingData.reference}</strong></p>
            <p>Location: ${bookingData.location}</p>
            <p>Spot: ${bookingData.spot}</p>
            <p>Date: ${bookingData.date}</p>
            <p>Time: ${bookingData.timeSlot}</p>
            <p>Amount: PHP ${bookingData.amount}</p>
            <hr />
            <p style="color: #666; font-size: 12px;">
              Please arrive within your reserved time slot. Thank you for using PakiPark!
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[Email] Booking confirmation sent to ${userEmail}`);
  } catch (error) {
    console.error('[Email] Failed to send:', error.message);
  }
};

/**
 * Send password reset email
 */
const sendPasswordReset = async (userEmail, resetToken) => {
  if (!process.env.SMTP_USER) {
    console.log('[Email Service] SMTP not configured, skipping email');
    return;
  }

  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

  try {
    await transporter.sendMail({
      from: `"PakiPark" <${process.env.SMTP_USER}>`,
      to: userEmail,
      subject: 'Password Reset - PakiPark',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e3d5a; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">PakiPark</h1>
          </div>
          <div style="padding: 30px;">
            <h2>Reset Your Password</h2>
            <p>Click the link below to reset your password:</p>
            <a href="${resetUrl}" style="display: inline-block; background: #ee6b20; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
              Reset Password
            </a>
            <p style="color: #666; margin-top: 20px; font-size: 12px;">
              This link expires in 1 hour. If you didn't request this, please ignore this email.
            </p>
          </div>
        </div>
      `,
    });
  } catch (error) {
    console.error('[Email] Failed to send reset:', error.message);
  }
};

module.exports = { sendBookingConfirmation, sendPasswordReset };
