import { createHash, timingSafeEqual } from "node:crypto";

export const SUPER_ADMIN_SESSION_COOKIE = "__Host-benius_super_admin";
export const SUPER_ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const SUPER_ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const SUPER_ADMIN_LOGIN_LIMIT = 5;
export const SUPER_ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function normalizeSuperAdminEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function hashRateLimitKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function secureTokenEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requestHasSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
