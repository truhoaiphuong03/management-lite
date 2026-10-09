-- Migration: 0006_m04_attendance
-- Scope: ATT M04 Attendance shifts, breaks, versions, approvals, adjustments, correction requests
-- Authoritative: Canonical docs 05, 14, 19, 20, 22, 25, 36

-- 1. Attendance Shifts (Run state separate from review state)
CREATE TABLE IF NOT EXISTS attendance_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  clock_in_at timestamptz NOT NULL,
  clock_out_at timestamptz NULL,
  run_state text NOT NULL CHECK (run_state IN ('working', 'paused', 'completed')),
  review_state text NOT NULL DEFAULT 'unreviewed' CHECK (review_state IN ('unreviewed', 'approved', 'rejected', 'needs_review')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_attendance_shifts_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT ck_attendance_shifts_closed CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at)
);

-- At most one open shift per employee (working or paused)
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_shifts_open
  ON attendance_shifts (workspace_id, employee_id)
  WHERE run_state IN ('working', 'paused');

CREATE INDEX IF NOT EXISTS ix_attendance_shifts_employee_lookup
  ON attendance_shifts (workspace_id, employee_id, clock_in_at DESC);

CREATE INDEX IF NOT EXISTS ix_attendance_shifts_workspace_lookup
  ON attendance_shifts (workspace_id, clock_in_at DESC);

-- 2. Attendance Breaks (Unpaid breaks during shift)
CREATE TABLE IF NOT EXISTS attendance_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES attendance_shifts(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  unpaid boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_attendance_breaks_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT ck_attendance_breaks_ended CHECK (ended_at IS NULL OR ended_at > started_at)
);

-- At most one open break per shift
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_breaks_open
  ON attendance_breaks (workspace_id, shift_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_attendance_breaks_shift
  ON attendance_breaks (workspace_id, shift_id, started_at ASC);

-- 3. Attendance Shift Versions (Immutable units for review and payroll)
CREATE TABLE IF NOT EXISTS attendance_shift_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES attendance_shifts(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  clock_in_at timestamptz NOT NULL,
  clock_out_at timestamptz NOT NULL,
  breaks_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  worked_seconds bigint NOT NULL CHECK (worked_seconds >= 0),
  snapshot_hash text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NULL,
  CONSTRAINT uq_attendance_shift_versions UNIQUE (workspace_id, shift_id, version_number),
  CONSTRAINT uq_attendance_shift_versions_workspace_id UNIQUE (workspace_id, id)
);

-- Circular FK to link current immutable version to shift
ALTER TABLE attendance_shifts
  ADD COLUMN IF NOT EXISTS current_version_id uuid NULL
  REFERENCES attendance_shift_versions(id) ON DELETE SET NULL;

-- 4. Attendance Approvals (Owner reviews completed shift version, no self-approval)
CREATE TABLE IF NOT EXISTS attendance_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES attendance_shifts(id) ON DELETE RESTRICT,
  shift_version_id uuid NOT NULL REFERENCES attendance_shift_versions(id) ON DELETE RESTRICT,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_attendance_approvals_version UNIQUE (workspace_id, shift_version_id),
  CONSTRAINT uq_attendance_approvals_workspace_id UNIQUE (workspace_id, id)
);

-- 5. Attendance Correction Requests (C01 Forgotten clock-out & time corrections)
CREATE TABLE IF NOT EXISTS attendance_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES attendance_shifts(id) ON DELETE RESTRICT,
  requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reason text NOT NULL,
  claimed_clock_out_at timestamptz NULL,
  evidence_note text NULL,
  decision_reason text NULL,
  decided_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_attendance_corrections_workspace_id UNIQUE (workspace_id, id)
);

-- At most one pending correction request per shift
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_corrections_pending
  ON attendance_correction_requests (workspace_id, shift_id)
  WHERE status = 'pending';

-- 6. Attendance Adjustments (Immutable provenance of correction decisions)
CREATE TABLE IF NOT EXISTS attendance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES attendance_shifts(id) ON DELETE RESTRICT,
  from_version_id uuid NULL REFERENCES attendance_shift_versions(id) ON DELETE RESTRICT,
  to_version_id uuid NOT NULL REFERENCES attendance_shift_versions(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_attendance_adjustments_workspace_id UNIQUE (workspace_id, id)
);
