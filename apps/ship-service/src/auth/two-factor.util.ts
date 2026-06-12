import { createHmac, randomBytes } from "node:crypto";
import type { SessionPayload } from "../common/session/session.types";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TWO_FACTOR_SECRET = process.env.AUTH_SECRET || "pakiship-dev-secret";
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type TwoFactorChallengePayload = SessionPayload & {
  exp: number;
};

function base32Encode(buffer: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(value: string) {
  const normalized = value.replace(/=+$/g, "").toUpperCase();
  let bits = 0;
  let current = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;

    current = (current << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function sign(value: string) {
  return createHmac("sha256", TWO_FACTOR_SECRET).update(value).digest("hex");
}

function hotp(secret: string, counter: number) {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter % 0x100000000, 4);

  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function generateTwoFactorSecret() {
  return base32Encode(randomBytes(20));
}

export function buildOtpAuthUri(secret: string, email: string, issuer = "PakiSHIP") {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export function verifyTotpToken(secret: string, token: string, window = 1) {
  const normalizedToken = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalizedToken)) {
    return false;
  }

  const counter = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);

  for (let offset = -window; offset <= window; offset += 1) {
    if (hotp(secret, counter + offset) === normalizedToken) {
      return true;
    }
  }

  return false;
}

export function createTwoFactorChallengeToken(payload: SessionPayload) {
  const challengePayload: TwoFactorChallengePayload = {
    ...payload,
    exp: Date.now() + CHALLENGE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(challengePayload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function readTwoFactorChallengeToken(token?: string | null) {
  if (!token) return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  if (sign(encoded) !== signature) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as TwoFactorChallengePayload;

    if (!payload.exp || payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
