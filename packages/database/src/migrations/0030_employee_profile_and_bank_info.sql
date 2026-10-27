-- Migration: 0030_employee_profile_and_bank_info
-- Scope: Extended employee basic HR info & bank account details for payroll/management.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS phone text NULL,
  ADD COLUMN IF NOT EXISTS date_of_birth text NULL,
  ADD COLUMN IF NOT EXISTS gender text NULL,
  ADD COLUMN IF NOT EXISTS national_id text NULL,
  ADD COLUMN IF NOT EXISTS address text NULL,
  ADD COLUMN IF NOT EXISTS position_title text NULL,
  ADD COLUMN IF NOT EXISTS emergency_contact text NULL,
  ADD COLUMN IF NOT EXISTS bank_name text NULL,
  ADD COLUMN IF NOT EXISTS bank_account_number text NULL,
  ADD COLUMN IF NOT EXISTS bank_account_holder text NULL;
