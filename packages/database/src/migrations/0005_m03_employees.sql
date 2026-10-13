-- Migration: 0005_m03_employees
-- Scope: HR EMP-01 Employee profile, tenant scoping, composite membership FK
-- Authoritative: Canonical docs 20, 21, 22, 25, 36, 50, 58

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  employee_code text NOT NULL,
  full_name text NOT NULL,
  employment_status text NOT NULL DEFAULT 'invited' CHECK (employment_status IN ('invited', 'active', 'suspended', 'archived')),
  is_payroll_eligible boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_employees_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT uq_employees_workspace_code UNIQUE (workspace_id, employee_code),
  CONSTRAINT fk_employees_membership FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_employees_user
  ON employees (workspace_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_employees_lookup
  ON employees (workspace_id, employment_status, created_at DESC);
