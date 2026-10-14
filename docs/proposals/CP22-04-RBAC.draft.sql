-- OWNER REVIEW ONLY. Not registered. Never run this file on production.
-- Execute only inside an explicit transaction on a disposable QA database.
CREATE TABLE employee_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 40),
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,code)
);
ALTER TABLE employees ADD COLUMN position_id uuid NULL;
ALTER TABLE employees ADD CONSTRAINT fk_employee_position_workspace
  FOREIGN KEY(workspace_id,position_id) REFERENCES employee_positions(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE workspace_memberships DROP CONSTRAINT workspace_memberships_role_check;
ALTER TABLE workspace_memberships ADD CONSTRAINT workspace_memberships_role_check
  CHECK(role IN ('owner','admin','staff'));
-- No role assignment/backfill here. Audit/API/session invalidation must ship first.
