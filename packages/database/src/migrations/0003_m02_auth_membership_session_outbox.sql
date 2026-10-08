-- Migration: 0003_m02_auth_membership_session_outbox
-- Scope: AUTH-01A M02 Workspace Memberships, User Credentials, Auth Sessions, Activation Invites, Email Outbox
-- Authoritative: Canonical docs 03, 04, 18, 20, 21, 22, 36, 50, 58

-- 1. Workspace Memberships (Tenant membership & role)
CREATE TABLE IF NOT EXISTS workspace_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'staff')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_memberships_workspace_user UNIQUE (workspace_id, user_id),
  CONSTRAINT uq_workspace_memberships_workspace_id UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS ix_workspace_memberships_user ON workspace_memberships (user_id);

-- 2. User Credentials (Argon2id password hashes, global identity credential)
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Activation Invites (CSPRNG single-use 24h tokens)
CREATE TABLE IF NOT EXISTS activation_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  token_version integer NOT NULL DEFAULT 1 CHECK (token_version > 0),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'issued', 'used', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_activation_invites_token_hash UNIQUE (token_hash),
  CONSTRAINT uq_activation_invites_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_activation_invites_membership FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_activation_invites_lookup ON activation_invites (workspace_id, user_id, status, expires_at);

-- 4. Auth Sessions (Server-side opaque sessions, idle + absolute timeouts)
CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_token_hash text NOT NULL,
  credential_version_at_issue integer NOT NULL CHECK (credential_version_at_issue > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  CONSTRAINT uq_auth_sessions_token_hash UNIQUE (session_token_hash),
  CONSTRAINT uq_auth_sessions_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_auth_sessions_membership FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_auth_sessions_lookup ON auth_sessions (workspace_id, user_id, revoked_at, absolute_expires_at);

-- 5. Email Outbox (Durable queue for asynchronous email delivery)
CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  invite_id uuid NOT NULL,
  message_type text NOT NULL CHECK (message_type IN ('activation_invite')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NULL,
  provider_message_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_email_outbox_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_email_outbox_invite FOREIGN KEY (workspace_id, invite_id)
    REFERENCES activation_invites(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_email_queue ON email_outbox (status, next_attempt_at, lease_until, id);

-- 6. Email Delivery Attempts (Audit trail for delivery outcomes)
CREATE TABLE IF NOT EXISTS email_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  outbox_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  outcome text NOT NULL CHECK (outcome IN ('queued', 'accepted', 'delivered', 'failed', 'unknown')),
  provider_message_id text NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  sanitized_error_code text NULL,
  CONSTRAINT uq_email_delivery_attempts UNIQUE (workspace_id, outbox_id, attempt_no),
  CONSTRAINT uq_email_delivery_attempts_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_email_delivery_attempts_outbox FOREIGN KEY (workspace_id, outbox_id)
    REFERENCES email_outbox(workspace_id, id) ON DELETE RESTRICT
);
