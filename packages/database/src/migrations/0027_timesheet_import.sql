-- Migration: 0027_timesheet_import
-- Scope: Mark shifts created by timesheet (xlsx) import and make re-import idempotent.

ALTER TABLE attendance_shifts
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'clock',
  ADD COLUMN IF NOT EXISTS import_ref text NULL;

ALTER TABLE attendance_shifts
  DROP CONSTRAINT IF EXISTS ck_attendance_shifts_source;

ALTER TABLE attendance_shifts
  ADD CONSTRAINT ck_attendance_shifts_source CHECK (source IN ('clock', 'import'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_shifts_import_ref
  ON attendance_shifts (workspace_id, import_ref)
  WHERE import_ref IS NOT NULL;
