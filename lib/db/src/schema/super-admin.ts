import { pgTable, serial, bigserial, integer, varchar, text, boolean, timestamp, char, unique, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const superAdminAccounts = pgTable("super_admin_accounts", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 254 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
}, (table) => [
  unique("super_admin_accounts_email_unique").on(table.email),
  check("super_admin_accounts_email_normalized", sql`${table.email} = lower(${table.email})`),
  check("super_admin_accounts_argon2id_only", sql`${table.passwordHash} LIKE '$argon2id$%'`),
]);

export const superAdminSessions = pgTable("super_admin_sessions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  superAdminId: integer("super_admin_id").notNull().references(() => superAdminAccounts.id, { onDelete: "cascade" }),
  tokenHash: char("token_hash", { length: 64 }).notNull(),
  csrfToken: varchar("csrf_token", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  unique("super_admin_sessions_token_hash_unique").on(table.tokenHash),
  index("super_admin_sessions_active_lookup_idx").on(table.tokenHash, table.expiresAt).where(sql`${table.revokedAt} IS NULL`),
  index("super_admin_sessions_account_idx").on(table.superAdminId, table.expiresAt),
  check("super_admin_sessions_expiry_after_creation", sql`${table.expiresAt} > ${table.createdAt}`),
]);

export const superAdminLoginAttempts = pgTable("super_admin_login_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  scope: varchar("scope", { length: 8 }).notNull(),
  keyHash: char("key_hash", { length: 64 }).notNull(),
  failureCount: integer("failure_count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("super_admin_login_attempts_scope_key").on(table.scope, table.keyHash),
  check("super_admin_login_attempts_scope_check", sql`${table.scope} IN ('email', 'ip')`),
  check("super_admin_login_attempts_failure_count_check", sql`${table.failureCount} >= 0`),
  index("super_admin_login_attempts_locked_idx").on(table.lockedUntil).where(sql`${table.lockedUntil} IS NOT NULL`),
]);
