-- Migration: 0024_accounts_enhancement
-- Scope: ACC-02 Managed Accounts extended metadata (recovery_email, account_group, assigned_employee_id)
-- and additional AEAD encrypted secret types (email_password, two_fa_secret).

ALTER TABLE managed_accounts
  ADD COLUMN IF NOT EXISTS recovery_email text NULL,
  ADD COLUMN IF NOT EXISTS account_group text NULL,
  ADD COLUMN IF NOT EXISTS assigned_employee_id uuid NULL;

ALTER TABLE managed_accounts
  DROP CONSTRAINT IF EXISTS fk_managed_accounts_assigned_employee;

ALTER TABLE managed_accounts
  ADD CONSTRAINT fk_managed_accounts_assigned_employee
  FOREIGN KEY (workspace_id, assigned_employee_id)
  REFERENCES employees (workspace_id, id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_group
  ON managed_accounts (workspace_id, account_group);

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_assignee
  ON managed_accounts (workspace_id, assigned_employee_id);

ALTER TABLE account_secrets
  DROP CONSTRAINT IF EXISTS account_secrets_secret_type_check;

ALTER TABLE account_secrets
  ADD CONSTRAINT account_secrets_secret_type_check
  CHECK (secret_type IN ('password', 'api_key', 'recovery_code', 'totp_secret', 'two_fa_secret', 'email_password'));
