-- Migration: 0044_web_customers
-- Scope: Isolated web customer authentication domain (GCN-CUST-02A).
-- Invariant: Web customers are completely isolated from internal staff tables
-- (users, user_credentials, workspace_memberships, auth_sessions).

CREATE TABLE IF NOT EXISTS web_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  google_sub text NOT NULL,
  email_normalized text NOT NULL,
  display_name text NOT NULL,
  avatar_url text NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  consent_version text NOT NULL,
  consent_at timestamptz NOT NULL,
  signup_ref text NULL,
  signup_utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  signup_landing text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_web_customers_workspace_google_sub UNIQUE (workspace_id, google_sub)
);

CREATE INDEX IF NOT EXISTS ix_web_customers_workspace_email
  ON web_customers (workspace_id, email_normalized);

CREATE INDEX IF NOT EXISTS ix_web_customers_workspace_status
  ON web_customers (workspace_id, status);

CREATE TABLE IF NOT EXISTS web_customer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES web_customers(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  created_ip text NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_web_customer_sessions_token_hash UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS ix_web_customer_sessions_customer
  ON web_customer_sessions (customer_id);

CREATE INDEX IF NOT EXISTS ix_web_customer_sessions_expires
  ON web_customer_sessions (expires_at);

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['mglite_app', 'hp_app_runtime', 'hp_app_test', 'mglite_owner', 'postgres'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      BEGIN
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE web_customers, web_customer_sessions TO %I',
          r
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;
END $$;
