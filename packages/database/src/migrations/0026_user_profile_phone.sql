-- Migration: 0026_user_profile_phone
-- Scope: Self-service profile editing (phone number on employee profile).

ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone text NULL;
