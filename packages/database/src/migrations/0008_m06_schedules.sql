-- Migration: 0008_m06_schedules
-- Scope: SCOPE-EXT-01 V0.2 SCHEDULE-01 R09 Staff Work Schedules, Entries, and Immutable Revisions
-- Authoritative: docs/extensions/SCOPE-EXT-01-SCHEDULE-01.md

-- 1. Staff Schedules (Weekly schedule root record per employee)
CREATE TABLE IF NOT EXISTS staff_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'cancelled')),
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_schedules_employee_week UNIQUE (workspace_id, employee_id, week_start_date),
  CONSTRAINT uq_staff_schedules_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_staff_schedules_employee FOREIGN KEY (workspace_id, employee_id)
    REFERENCES employees(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_staff_schedules_workspace_week
  ON staff_schedules (workspace_id, week_start_date);
CREATE INDEX IF NOT EXISTS ix_staff_schedules_employee
  ON staff_schedules (workspace_id, employee_id, week_start_date);

-- 2. Staff Schedule Entries (Registered working days within the week)
CREATE TABLE IF NOT EXISTS staff_schedule_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  schedule_id uuid NOT NULL REFERENCES staff_schedules(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time text NOT NULL CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_schedule_entries_schedule_date UNIQUE (schedule_id, work_date),
  CONSTRAINT fk_staff_schedule_entries_schedule FOREIGN KEY (workspace_id, schedule_id)
    REFERENCES staff_schedules(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_staff_schedule_entries_schedule
  ON staff_schedule_entries (schedule_id, work_date);

-- 3. Staff Schedule Revisions (Immutable audit snapshots for schedule edits)
CREATE TABLE IF NOT EXISTS staff_schedule_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  schedule_id uuid NOT NULL REFERENCES staff_schedules(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  snapshot jsonb NOT NULL,
  reason text NULL,
  edited_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  edited_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_schedule_revisions_number UNIQUE (workspace_id, schedule_id, revision_number),
  CONSTRAINT uq_staff_schedule_revisions_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_staff_schedule_revisions_schedule FOREIGN KEY (workspace_id, schedule_id)
    REFERENCES staff_schedules(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_staff_schedule_revisions_schedule
  ON staff_schedule_revisions (workspace_id, schedule_id, revision_number DESC);

-- 4. Immutability guard trigger for staff_schedule_revisions
CREATE OR REPLACE FUNCTION prevent_staff_schedule_revisions_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'staff_schedule_revisions is append-only: % operation prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_schedule_revisions_immutable ON staff_schedule_revisions;
CREATE TRIGGER trg_staff_schedule_revisions_immutable
  BEFORE UPDATE OR DELETE ON staff_schedule_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_staff_schedule_revisions_mutation();
