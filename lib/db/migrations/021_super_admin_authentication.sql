BEGIN;

CREATE TABLE super_admin_accounts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT super_admin_accounts_email_unique UNIQUE (email),
  CONSTRAINT super_admin_accounts_email_normalized CHECK (email = lower(email)),
  CONSTRAINT super_admin_accounts_argon2id_only CHECK (password_hash LIKE '$argon2id$%')
);

CREATE TABLE super_admin_sessions (
  id BIGSERIAL PRIMARY KEY,
  super_admin_id INTEGER NOT NULL REFERENCES super_admin_accounts(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  csrf_token VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT super_admin_sessions_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT super_admin_sessions_token_hash_unique UNIQUE (token_hash)
);
CREATE INDEX super_admin_sessions_active_lookup_idx
  ON super_admin_sessions (token_hash, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX super_admin_sessions_account_idx
  ON super_admin_sessions (super_admin_id, expires_at);

CREATE TABLE super_admin_login_attempts (
  id BIGSERIAL PRIMARY KEY,
  scope VARCHAR(8) NOT NULL CHECK (scope IN ('email', 'ip')),
  key_hash CHAR(64) NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT super_admin_login_attempts_scope_key UNIQUE (scope, key_hash)
);
CREATE INDEX super_admin_login_attempts_locked_idx
  ON super_admin_login_attempts (locked_until) WHERE locked_until IS NOT NULL;

COMMIT;
