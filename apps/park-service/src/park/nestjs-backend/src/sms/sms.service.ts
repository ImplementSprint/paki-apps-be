import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCenterService } from '../common/api-center.service';
import * as https from 'https';

// In-memory OTP store (stateless, matches Express implementation)
const otpStore: Map<string, { code: string; expiresAt: number; verified?: boolean }> = new Map();

// ─── Email Template ────────────────────────────────────────────────────────────

interface OtpEmailOptions {
  title: string;
  subtitle: string;
  otp: string;
  purpose: 'password-reset' | 'verification';
}

function buildOtpEmailHtml({ title, subtitle, otp, purpose }: OtpEmailOptions): string {
  const accent = purpose === 'password-reset' ? '#3B82F6' : '#10B981';
  const accentDark = purpose === 'password-reset' ? '#1D4ED8' : '#059669';
  const headerBg = purpose === 'password-reset' ? '#0C1D3A' : '#052E1C';
  const icon = purpose === 'password-reset' ? '&#128273;' : '&#9989;';

  // Render each digit as its own table cell (fixes mobile wrapping completely)
  const digitCells = otp.split('').map(d => `
    <td style="padding:0 4px;">
      <div style="
        width:44px;height:56px;
        background:#1E2530;
        border:1.5px solid ${accent}55;
        border-radius:10px;
        text-align:center;line-height:56px;
        font-family:'Courier New',Courier,monospace;
        font-size:28px;font-weight:700;color:#F0F6FC;
        display:block;
      ">${d}</div>
    </td>`).join('');

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="supported-color-schemes" content="dark"/>
  <title>${title}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    /* Force dark mode in Apple Mail / iOS Mail */
    :root { color-scheme: dark; supported-color-schemes: dark; }

    @media (prefers-color-scheme: dark) {
      body, .outer-bg  { background-color: #0D1117 !important; }
      .card            { background-color: #161B22 !important; border-color: #30363D !important; }
      .card-header     { background-color: ${headerBg} !important; }
      .card-body       { background-color: #161B22 !important; }
      .card-footer     { background-color: #0D1117 !important; }
      .otp-cell div    { background-color: #1E2530 !important; border-color: ${accent}55 !important; color: #F0F6FC !important; }
      .expiry-pill     { background-color: #21262D !important; }
      .warn-box        { background-color: #1A0F0F !important; border-color: #DA363380 !important; }
      h1, .title-text  { color: #F0F6FC !important; }
      .sub-text        { color: #8B949E !important; }
      .label-text      { color: #6E7681 !important; }
      .expiry-text     { color: #8B949E !important; }
      .expiry-strong   { color: #F0F6FC !important; }
      .warn-text       { color: #FF7B72 !important; }
      .footer-text     { color: #484F58 !important; }
    }

    /* CSS animation for digit cells — supported in Apple Mail & some others */
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .digit-1 { animation: fadeUp 0.4s ease 0.05s both; }
    .digit-2 { animation: fadeUp 0.4s ease 0.12s both; }
    .digit-3 { animation: fadeUp 0.4s ease 0.19s both; }
    .digit-4 { animation: fadeUp 0.4s ease 0.26s both; }
    .digit-5 { animation: fadeUp 0.4s ease 0.33s both; }
    .digit-6 { animation: fadeUp 0.4s ease 0.40s both; }

    @keyframes pulseGlow {
      0%,100% { box-shadow: 0 0 0 0 ${accent}00; }
      50%      { box-shadow: 0 0 12px 2px ${accent}40; }
    }
    .otp-wrap { animation: pulseGlow 3s ease-in-out 1s infinite; }
  </style>
</head>
<body class="outer-bg" style="margin:0;padding:0;background:#0D1117;-webkit-text-size-adjust:100%;mso-line-height-rule:exactly;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="outer-bg" style="background:#0D1117;padding:40px 16px;">
  <tr><td align="center">

    <!-- Card -->
    <table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0"
      style="max-width:480px;background:#161B22;border-radius:18px;border:1px solid #30363D;overflow:hidden;">

      <!-- Header -->
      <tr>
        <td class="card-header" style="background:${headerBg};padding:28px 36px 24px;border-bottom:1px solid #30363D;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="middle">
                <h1 style="margin:0 0 3px;font-size:22px;font-weight:700;color:#F0F6FC;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;letter-spacing:-0.4px;" class="title-text">PakiPark</h1>
                <p style="margin:0;font-size:11px;font-weight:600;color:#8B949E;text-transform:uppercase;letter-spacing:2px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;" class="sub-text">Smart Parking Solutions</p>
              </td>
              <td align="right" valign="middle" style="padding-left:12px;">
                <div style="width:42px;height:42px;border-radius:50%;background:${accent}22;border:1.5px solid ${accent}55;text-align:center;line-height:42px;font-size:20px;display:inline-block;">
                  ${icon}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td class="card-body" style="background:#161B22;padding:32px 36px 28px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

          <p style="margin:0 0 6px;font-size:19px;font-weight:700;color:#F0F6FC;" class="title-text">${title}</p>
          <p style="margin:0 0 28px;font-size:14px;color:#8B949E;line-height:1.65;" class="sub-text">${subtitle}</p>

          <!-- OTP label -->
          <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#6E7681;text-transform:uppercase;letter-spacing:1.5px;text-align:center;" class="label-text">Your one-time code</p>

          <!-- OTP digit row — each digit is its own cell, no wrapping possible -->
          <table role="presentation" cellpadding="0" cellspacing="0" class="otp-wrap" style="margin:0 auto 24px;border-radius:14px;border:1px solid ${accent}30;padding:16px 12px;">
            <tr>
              ${otp.split('').map((d, i) => `
              <td class="otp-cell digit-${i + 1}" style="padding:0 5px;">
                <div style="width:44px;height:56px;background:#1E2530;border:1.5px solid ${accent}55;border-radius:10px;text-align:center;line-height:56px;font-family:'Courier New',Courier,monospace;font-size:28px;font-weight:700;color:#F0F6FC;">${d}</div>
              </td>`).join('')}
            </tr>
          </table>

          <!-- Expiry pill -->
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
            <tr>
              <td class="expiry-pill" style="background:#21262D;border-radius:100px;padding:7px 18px;">
                <p style="margin:0;font-size:12px;color:#8B949E;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;" class="expiry-text">
                  &#9200;&nbsp; Expires in <strong style="color:#F0F6FC;" class="expiry-strong">10 minutes</strong>
                </p>
              </td>
            </tr>
          </table>

          <!-- Warning box -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td class="warn-box" style="background:#1A0F0F;border:1px solid #DA363380;border-radius:10px;padding:13px 16px;">
                <p style="margin:0;font-size:12px;color:#FF7B72;line-height:1.6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;" class="warn-text">
                  &#128274;&nbsp; <strong>Never share this code.</strong> PakiPark staff will never ask for your OTP. If you did not request this, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>

        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td class="card-footer" style="background:#0D1117;border-top:1px solid #30363D;padding:18px 36px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#484F58;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;" class="footer-text">
            &copy; 2026 PakiPark &middot; All rights reserved
          </p>
        </td>
      </tr>

    </table>
    <!-- /Card -->

  </td></tr>
</table>

</body>
</html>`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SmsService {
  constructor(private cfg: ConfigService, private apiCenter: ApiCenterService) { }

  normPhone(phone: string): string {
    const digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('63') && digits.length === 12) return `+${digits}`;
    if (digits.startsWith('0') && digits.length === 11) return `+63${digits.slice(1)}`;
    if (digits.length === 10) return `+63${digits}`;
    return phone;
  }

  private generateOTP(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  private async _sendSms(to: string, message: string): Promise<void> {
    try {
      await this.apiCenter.post('/shared/sms/send', { to, message });
      console.log(`[SMS] ✅ Sent via API Center → ${to}`);
    } catch (apErr) {
      console.warn(`[SMS] API Center failed: ${apErr.message}, trying Semaphore fallback`);
      const apiKey = this.cfg.get<string>('SEMAPHORE_API_KEY') || '';
      const sender = this.cfg.get<string>('SEMAPHORE_SENDER') || 'Semaphore';
      if (!apiKey) {
        console.warn(`\n[SMS FAIL-OPEN LOG] 📱 To: ${to}\nMessage: ${message}\n`);
        return;
      }
      await this._semaphoreSend(apiKey, sender, to, message).catch((e) => {
        console.warn(`\n[SMS FAIL-OPEN LOG] Semaphore failed: ${e.message}. 📱 To: ${to}\nMessage: ${message}\n`);
      });
    }
  }

  private _semaphoreSend(apiKey: string, sender: string, to: string, message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const qs = [
        `apikey=${encodeURIComponent(apiKey)}`,
        `number=${encodeURIComponent(to)}`,
        `message=${encodeURIComponent(message)}`,
        `sendername=${encodeURIComponent(sender)}`,
      ].join('&');
      const req = https.request(
        {
          hostname: 'api.semaphore.co',
          path: `/api/v4/messages?${qs}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': 0 },
        },
        (res) => {
          let d = '';
          res.on('data', (c) => { d += c; });
          res.on('end', () => { console.log('[SMS] Semaphore:', d.slice(0, 200)); resolve(); });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  // ── General SMS ────────────────────────────────────────────────────────────

  async sendSms(phone: string, message: string): Promise<void> {
    const canonical = this.normPhone(phone);
    await this._sendSms(canonical, message);
  }

  // ── SMS OTP ────────────────────────────────────────────────────────────────

  async sendPasswordResetOTP(phone: string): Promise<string> {
    const canonical = this.normPhone(phone);
    const otp = this.generateOTP();
    otpStore.set(canonical, { code: otp, expiresAt: Date.now() + 10 * 60_000 });
    await this._sendSms(canonical, `Your PakiPark password reset code is: ${otp}. Valid for 10 minutes. Never share this code.`);
    return canonical;
  }

  async sendVerificationOTP(phone: string): Promise<string> {
    const canonical = this.normPhone(phone);
    const otp = this.generateOTP();
    otpStore.set(canonical, { code: otp, expiresAt: Date.now() + 10 * 60_000 });
    await this._sendSms(canonical, `Your PakiPark account verification code is: ${otp}. Valid for 10 minutes.`);
    return canonical;
  }

  // ── Email OTP ──────────────────────────────────────────────────────────────

  async sendPasswordResetOTPByEmail(email: string): Promise<void> {
    const key = email.trim().toLowerCase();
    const otp = this.generateOTP();
    otpStore.set(key, { code: otp, expiresAt: Date.now() + 10 * 60_000 });

    const html = buildOtpEmailHtml({
      title: 'Password Reset Code',
      subtitle: 'Use the code below to reset your PakiPark password.',
      otp,
      purpose: 'password-reset',
    });

    try {
      await this.apiCenter.post('/shared/email/send', {
        to: [{ email: key }],
        subject: 'Your PakiPark Password Reset Code',
        text: `Your PakiPark password reset code is: ${otp}. Valid for 10 minutes.`,
        html,
      });
      console.log(`[Email] ✅ Password-reset OTP sent to ${key}`);
    } catch (e) {
      console.warn(`\n[EMAIL FAIL-OPEN LOG] 📧 To: ${key}\nSubject: Password Reset\nOTP: ${otp}\nError: ${e.message}\n`);
    }
  }

  async sendVerificationOTPByEmail(email: string): Promise<void> {
    const key = email.trim().toLowerCase();
    const otp = this.generateOTP();
    otpStore.set(key, { code: otp, expiresAt: Date.now() + 10 * 60_000 });

    const html = buildOtpEmailHtml({
      title: 'Verification Code',
      subtitle: 'Use the code below to verify your PakiPark account.',
      otp,
      purpose: 'verification',
    });

    try {
      await this.apiCenter.post('/shared/email/send', {
        to: [{ email: key }],
        subject: 'Your PakiPark Verification Code',
        text: `Your PakiPark account verification code is: ${otp}. Valid for 10 minutes.`,
        html,
      });
      console.log(`[Email] ✅ Verification OTP sent to ${key}`);
    } catch (e) {
      console.warn(`\n[EMAIL FAIL-OPEN LOG] 📧 To: ${key}\nSubject: Verification\nOTP: ${otp}\nError: ${e.message}\n`);
    }
  }

  // ── OTP Lifecycle ──────────────────────────────────────────────────────────

  verifyOTP(identifier: string, code: string): boolean {
    const key = this._normalizeKey(identifier);
    const entry = otpStore.get(key);
    if (!entry) throw new Error('OTP not found or already used. Please request a new code.');
    if (Date.now() > entry.expiresAt) {
      otpStore.delete(key);
      throw new Error('OTP has expired. Please request a new code.');
    }
    if (entry.code !== code) throw new Error('Incorrect OTP. Please try again.');
    otpStore.set(key, { ...entry, verified: true });
    return true;
  }

  isVerified(identifier: string): boolean {
    const key = this._normalizeKey(identifier);
    const entry = otpStore.get(key);
    return !!(entry?.verified && Date.now() <= entry.expiresAt);
  }

  consumeOTP(identifier: string): void {
    otpStore.delete(this._normalizeKey(identifier));
  }

  private _normalizeKey(identifier: string): string {
    const trimmed = identifier.trim();
    return trimmed.toLowerCase().includes('@') ? trimmed.toLowerCase() : this.normPhone(trimmed);
  }
}