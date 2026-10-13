-- Migration: 0020_email_verification
-- Scope: Email verification status and verifiable ownership proofs

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_proof text NULL;

CREATE TABLE IF NOT EXISTS email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_normalized text NOT NULL,
  token_hash text NOT NULL,
  proof_type text NOT NULL DEFAULT 'token_confirmation',
  proof_metadata jsonb NULL,
  verified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_email_verifications_token UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS ix_email_verifications_user
  ON email_verifications (user_id, verified_at);
