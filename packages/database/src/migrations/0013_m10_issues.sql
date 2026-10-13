-- Migration: 0013_m10_issues
-- Scope: ISSUES-01 Quản lý Báo lỗi & Góp ý (Issues Lite V0.1)
-- Authoritative: IMPLEMENTATION PACKET — ISSUES LITE V0.1; C06 Multi-tenancy

-- 1. Issues Table (Canonical entity: issues)
CREATE TABLE IF NOT EXISTS issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('bug', 'improvement')),
  title varchar(255) NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 255),
  description text NOT NULL CHECK (length(trim(description)) > 0 AND length(description) <= 4000),
  route_template varchar(128) NOT NULL CHECK (length(trim(route_template)) > 0 AND length(route_template) <= 128),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'analyzing', 'fixing', 'awaiting_owner', 'closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  CONSTRAINT uq_issues_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_issues_workspace_reporter
    FOREIGN KEY (workspace_id, reporter_user_id)
    REFERENCES workspace_memberships (workspace_id, user_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_issues_workspace_status
  ON issues (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_issues_workspace_type
  ON issues (workspace_id, type);

CREATE INDEX IF NOT EXISTS idx_issues_workspace_created
  ON issues (workspace_id, created_at DESC, id DESC);

-- 2. Issue Activity Table (Canonical entity: issue_activity - Append-only)
CREATE TABLE IF NOT EXISTS issue_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  issue_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('created', 'edited', 'status_changed', 'fix_confirmed', 'reopened')),
  metadata_sanitized jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_issue_activity_issue
    FOREIGN KEY (workspace_id, issue_id)
    REFERENCES issues (workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_issue_activity_workspace_actor
    FOREIGN KEY (workspace_id, actor_user_id)
    REFERENCES workspace_memberships (workspace_id, user_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_issue_activity_issue
  ON issue_activity (workspace_id, issue_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_issue_activity_actor
  ON issue_activity (workspace_id, actor_user_id);

-- 3. Append-only trigger for issue_activity: Prohibit UPDATE and DELETE
CREATE OR REPLACE FUNCTION prevent_issue_activity_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'issue_activity is append-only: % operation prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_issue_activity_immutable ON issue_activity;
CREATE TRIGGER trg_issue_activity_immutable
  BEFORE UPDATE OR DELETE ON issue_activity
  FOR EACH ROW EXECUTE FUNCTION prevent_issue_activity_mutation();
