-- Migration: 0032_employee_sub_permissions
-- Scope: Sub-Admin role (sub_role) and granular delegated permissions (sub_permissions) on employees.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS sub_role text NULL,
  ADD COLUMN IF NOT EXISTS sub_permissions jsonb NOT NULL DEFAULT '[]'::jsonb;
