import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCenterService } from '../common/api-center.service';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(private cfg: ConfigService, private apiCenter: ApiCenterService) {
    this.transporter = nodemailer.createTransport({
      host: cfg.get('SMTP_HOST') || 'smtp.gmail.com',
      port: parseInt(cfg.get('SMTP_PORT') || '587'),
      secure: false,
      auth: { user: cfg.get('SMTP_USER'), pass: cfg.get('SMTP_PASS') },
    });
  }

  private wrap(content: string): string {
    return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)"><div style="background:linear-gradient(135deg,#1e3d5a,#2d6a4f);padding:24px;text-align:center"><h1 style="color:white;margin:0;font-size:28px;letter-spacing:2px">PakiPark</h1><p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:12px">Smart Parking Solutions</p></div><div style="padding:32px 28px;background:#f9fafb">${content}</div><div style="padding:16px;background:#f0f0f0;text-align:center;font-size:11px;color:#888">© ${new Date().getFullYear()} PakiPark. All rights reserved.</div></div>`;
  }

  async sendEmail(to: string, subject: string, html: string, text?: string): Promise<void> {
    try {
      await this.apiCenter.post('/shared/email/send', { to: [{ email: to }], subject, html, text: text || html.replace(/<[^>]*>/g, '') });
      return;
    } catch { /* fallback to SMTP */ }
    const user = this.cfg.get('SMTP_USER');
    if (!user) { console.log('[Email] SMTP not configured, skipping'); return; }
    try {
      await this.transporter.sendMail({ from: `"PakiPark" <${user}>`, to, subject, html, text });
    } catch (e) { console.error('[Email] SMTP failed:', e.message); }
  }

  async sendBookingConfirmation(email: string, data: any): Promise<void> {
    const html = this.wrap(`<h2 style="color:#1e3d5a;margin-top:0">✅ Booking Confirmed!</h2><p>Hi <strong>${data.userName || 'there'}</strong>, your parking spot is reserved.</p><table style="width:100%;border-collapse:collapse;margin:20px 0"><tr><td style="padding:8px;color:#666">Reference</td><td style="padding:8px;font-weight:bold;color:#1e3d5a">${data.reference}</td></tr><tr style="background:#fff"><td style="padding:8px;color:#666">Location</td><td style="padding:8px">${data.locationName || ''}</td></tr><tr><td style="padding:8px;color:#666">Spot</td><td style="padding:8px">${data.spot}</td></tr><tr style="background:#fff"><td style="padding:8px;color:#666">Date</td><td style="padding:8px">${data.date}</td></tr><tr><td style="padding:8px;color:#666">Time</td><td style="padding:8px">${data.timeSlot}</td></tr><tr style="background:#fff"><td style="padding:8px;color:#666">Amount</td><td style="padding:8px;font-weight:bold;color:#2d6a4f">₱${Number(data.amount || 0).toFixed(2)}</td></tr></table>`);
    await this.sendEmail(email, `Booking Confirmed — ${data.reference}`, html);
  }

  async sendBookingCancellation(email: string, data: any): Promise<void> {
    const html = this.wrap(`<h2 style="color:#c0392b;margin-top:0">❌ Booking Cancelled</h2><p>Your booking <strong>${data.reference}</strong> has been cancelled.</p>${data.cancelReason ? `<p>Reason: ${data.cancelReason}</p>` : ''}`);
    await this.sendEmail(email, `Booking Cancelled — ${data.reference}`, html);
  }

  async sendOTPEmail(email: string, otp: string): Promise<void> {
    const html = this.wrap(`<h2 style="color:#1e3d5a;margin-top:0">🔑 Verification Code</h2><p>Your code is valid for 10 minutes.</p><div style="text-align:center;margin:28px 0"><span style="background:#1e3d5a;color:white;font-size:36px;font-weight:bold;letter-spacing:12px;padding:18px 32px;border-radius:8px">${otp}</span></div>`);
    await this.sendEmail(email, 'Your PakiPark Verification Code', html);
  }
}
