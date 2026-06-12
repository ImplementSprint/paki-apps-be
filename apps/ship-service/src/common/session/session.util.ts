import { createHmac } from "node:crypto";
import type { SessionPayload } from "./session.types";

export const SESSION_COOKIE = "pakiship_session";
const SESSION_SECRET = process.env.AUTH_SECRET || "pakiship-dev-secret";
const ONE_WEEK_IN_SECONDS = 60 * 60 * 24 * 7;

function sign(value: string) {
  return createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

export function createSessionToken(payload: SessionPayload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function readSessionToken(token?: string | null) {
  if (!token) return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  if (sign(encoded) !== signature) return null;

  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_WEEK_IN_SECONDS * 1000,
    path: "/",
  };
}

export function parseCookieHeader(cookieHeader?: string | null) {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}
