-- Migration: 0019_password_reset_tokens
-- Scope: AUTH Password Reset Flow (CSPRNG single-use token, 15m TTL, SHA-256 hash storage)

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  request_ip text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_password_reset_token_hash UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_lookup
  ON password_reset_tokens (user_id, consumed_at, expires_at);
