import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'pakiapps_session';

export function createSessionToken(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function readSessionToken(token: string | undefined): unknown {
  if (!token) return null;
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

export function getSessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function parseCookieHeader(
  cookieString: string | undefined | null,
): Record<string, string> {
  if (!cookieString) return {};
  return cookieString.split(';').reduce<Record<string, string>>((cookies, item) => {
    const [key, ...valueParts] = item.trim().split('=');
    if (key) {
      cookies[key] = valueParts.join('=');
    }
    return cookies;
  }, {});
}
