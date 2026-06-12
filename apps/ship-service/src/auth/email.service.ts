import { Injectable, InternalServerErrorException } from "@nestjs/common";

type GmailTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type ApiCenterTokenResponse = {
  accessToken?: string;
  token?: string;
  data?: {
    accessToken?: string;
    token?: string;
    expiresIn?: number;
  };
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function encodeBase64Url(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildOtpEmailHtml(input: {
  title: string;
  eyebrow: string;
  message: string;
  otp: string;
  footer: string;
}) {
  const safeTitle = escapeHtml(input.title);
  const safeEyebrow = escapeHtml(input.eyebrow);
  const safeMessage = escapeHtml(input.message);
  const safeOtp = escapeHtml(input.otp);
  const safeFooter = escapeHtml(input.footer);

  return `
    <div style="margin:0;padding:0;background:#f0f9f8;font-family:Arial,Helvetica,sans-serif;color:#041614;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0f9f8;padding:32px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #d7f1ee;box-shadow:0 18px 45px rgba(4,22,20,0.08);">
              <tr>
                <td style="padding:34px 34px 18px;">
                  <div style="display:inline-block;background:#e8f8f6;color:#2d8f85;border-radius:999px;padding:8px 12px;font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">${safeEyebrow}</div>
                  <h1 style="margin:20px 0 10px;font-size:28px;line-height:1.15;color:#041614;">${safeTitle}</h1>
                  <p style="margin:0;color:#607086;font-size:15px;line-height:1.65;">${safeMessage}</p>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:10px 34px 24px;">
                  <div style="display:inline-block;background:#041614;color:#ffffff;border-radius:20px;padding:18px 28px;font-size:34px;font-weight:900;letter-spacing:0.22em;">${safeOtp}</div>
                  <p style="margin:16px 0 0;color:#7c8ca3;font-size:13px;font-weight:700;">This code expires in 15 minutes.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:22px 34px;background:#f8fbfb;border-top:1px solid #edf4f3;">
                  <p style="margin:0;color:#8a98aa;font-size:12px;line-height:1.55;">${safeFooter}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

@Injectable()
export class EmailService {
  private apiCenterToken: { value: string; expiresAt: number } | null = null;

  private hasApiCenterConfig() {
    return Boolean(
      process.env.APICENTER_URL &&
        process.env.APICENTER_TRIBE_ID &&
        process.env.APICENTER_TRIBE_SECRET,
    );
  }

  private async getApiCenterAccessToken() {
    if (this.apiCenterToken && this.apiCenterToken.expiresAt > Date.now() + 30_000) {
      return this.apiCenterToken.value;
    }

    const baseUrl = process.env.APICENTER_URL?.replace(/\/$/, "");
    const tribeId = process.env.APICENTER_TRIBE_ID;
    const secret = process.env.APICENTER_TRIBE_SECRET;

    if (!baseUrl || !tribeId || !secret) {
      throw new InternalServerErrorException("APICenter credentials are not configured.");
    }

    const tokenPath = process.env.APICENTER_TOKEN_PATH || "/api/v1/auth/token";
    const response = await fetch(`${baseUrl}${tokenPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tribeId, secret }),
    });
    const text = await response.text();
    const result = text ? (JSON.parse(text) as ApiCenterTokenResponse) : {};
    const token = result.data?.accessToken || result.data?.token || result.accessToken || result.token;

    if (!response.ok || !token) {
      throw new InternalServerErrorException(
        `ApiCenter token request failed (${response.status} ${tokenPath}): ${text || response.statusText}`,
      );
    }

    this.apiCenterToken = {
      value: token,
      expiresAt: Date.now() + Math.max(60, result.data?.expiresIn ?? 600) * 1000,
    };

    return token;
  }

  private async sendViaApiCenter(input: {
    to: string;
    subject: string;
    html: string;
  }) {
    const baseUrl = process.env.APICENTER_URL?.replace(/\/$/, "");
    const tribeId = process.env.APICENTER_TRIBE_ID;
    const token = await this.getApiCenterAccessToken();

    const response = await fetch(`${baseUrl}/api/v1/shared/email/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-SDK-Version": process.env.APICENTER_SDK_VERSION || "1.1.2",
        "X-SDK-Tribe-Id": tribeId || "pakiapps",
      },
      body: JSON.stringify({
        to: [{ email: input.to }],
        subject: input.subject,
        text: stripHtml(input.html),
        html: input.html,
        metadata: {
          purpose: "pakiship_notification",
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new InternalServerErrorException(
        `ApiCenter email request failed (${response.status} /api/v1/shared/email/send): ${text || response.statusText}`,
      );
    }
  }

  private async getAccessToken() {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new InternalServerErrorException("Gmail email credentials are not configured.");
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const result = (await response.json()) as GmailTokenResponse;

    if (!response.ok || !result.access_token) {
      console.error("[email] Gmail OAuth token exchange failed", {
        status: response.status,
        error: result.error,
        errorDescription: result.error_description,
      });

      if (result.error === "invalid_grant") {
        throw new InternalServerErrorException(
          "Gmail refresh token is invalid or expired. Generate a new Gmail OAuth refresh token.",
        );
      }

      if (result.error === "unauthorized_client") {
        throw new InternalServerErrorException(
          "Gmail OAuth client is unauthorized. Make sure the client ID, client secret, and refresh token were generated from the same OAuth client with the Gmail send scope.",
        );
      }

      throw new InternalServerErrorException(
        result.error_description || result.error || "Unable to authenticate Gmail sender.",
      );
    }

    return result.access_token;
  }

  private async sendMail(input: {
    to: string;
    subject: string;
    html: string;
  }) {
    if (this.hasApiCenterConfig()) {
      return this.sendViaApiCenter(input);
    }

    const from = process.env.GMAIL_USER_EMAIL;
    if (!from) {
      throw new InternalServerErrorException("Gmail sender email is not configured.");
    }

    const accessToken = await this.getAccessToken();
    const raw = [
      `From: PakiSHIP <${from}>`,
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
      input.html,
    ].join("\r\n");

    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodeBase64Url(raw) }),
    });

    if (!response.ok) {
      const result = await response.text();
      console.error("[email] Gmail send failed", {
        status: response.status,
        response: result,
      });
      throw new InternalServerErrorException(result || "Unable to send email.");
    }
  }

  sendAccountVerificationOtp(to: string, otp: string) {
    return this.sendMail({
      to,
      subject: "Verify your PakiSHIP account",
      html: buildOtpEmailHtml({
        eyebrow: "Account verification",
        title: "Finish creating your account",
        message: "Enter this verification code in PakiSHIP to activate your account.",
        otp,
        footer: "If you did not create a PakiSHIP account, you can safely ignore this email.",
      }),
    });
  }

  sendPasswordResetOtp(to: string, otp: string) {
    return this.sendMail({
      to,
      subject: "Reset your PakiSHIP password",
      html: buildOtpEmailHtml({
        eyebrow: "Password reset",
        title: "Reset your password",
        message: "Use this one-time code to set a new password for your PakiSHIP account.",
        otp,
        footer: "If you did not request a password reset, your password remains unchanged.",
      }),
    });
  }

  sendTwoFactorOtp(to: string, otp: string) {
    return this.sendMail({
      to,
      subject: "Your PakiSHIP two-factor code",
      html: buildOtpEmailHtml({
        eyebrow: "Two-factor authentication",
        title: "Confirm your account access",
        message: "Use this one-time code to finish your PakiSHIP security check.",
        otp,
        footer: "If you did not request this code, keep your account secure by changing your password.",
      }),
    });
  }
}
