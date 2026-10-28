import test from "node:test";
import assert from "node:assert/strict";
import {
  hashRateLimitKey,
  normalizeSuperAdminEmail,
  readCookie,
  requestHasSameOrigin,
  secureTokenEqual,
  SUPER_ADMIN_LOGIN_LIMIT,
  SUPER_ADMIN_LOGIN_WINDOW_MS,
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_IDLE_TIMEOUT_MS,
  SUPER_ADMIN_SESSION_TTL_MS,
} from "./super-admin-security.js";

test("Super Admin email normalization rejects malformed/oversized values", () => {
  assert.equal(normalizeSuperAdminEmail("  ROOT@Example.COM "), "root@example.com");
  assert.equal(normalizeSuperAdminEmail("not-an-email"), null);
  assert.equal(normalizeSuperAdminEmail("x".repeat(250) + "@a.com"), null);
});

test("rate-limit identities are one-way hashed and policy is bounded", () => {
  assert.notEqual(hashRateLimitKey("root@example.com"), "root@example.com");
  assert.equal(hashRateLimitKey("same"), hashRateLimitKey("same"));
  assert.equal(SUPER_ADMIN_LOGIN_LIMIT, 5);
  assert.equal(SUPER_ADMIN_LOGIN_WINDOW_MS, 15 * 60 * 1000);
});

test("session tokens compare in constant time and cookie parsing is exact", () => {
  assert.equal(secureTokenEqual("token", "token"), true);
  assert.equal(secureTokenEqual("token", "other"), false);
  assert.equal(readCookie(`other=x; ${SUPER_ADMIN_SESSION_COOKIE}=a%2Fb`, SUPER_ADMIN_SESSION_COOKIE), "a/b");
  assert.equal(readCookie(`bad=${SUPER_ADMIN_SESSION_COOKIE}`, SUPER_ADMIN_SESSION_COOKIE), null);
  assert.equal(SUPER_ADMIN_SESSION_TTL_MS, 8 * 60 * 60 * 1000);
  assert.equal(SUPER_ADMIN_IDLE_TIMEOUT_MS, 15 * 60 * 1000);
});

test("browser mutations require a matching same-origin host", () => {
  assert.equal(requestHasSameOrigin("https://school.example", "school.example"), true);
  assert.equal(requestHasSameOrigin("https://attacker.example", "school.example"), false);
  assert.equal(requestHasSameOrigin(undefined, "school.example"), false);
});
