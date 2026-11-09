import type { MigrationFile } from '../migrator.js';
import { calculateChecksum } from '../migrator.js';

export const M00_SQL = `-- Migration: 0001_m00_prerequisites
-- Scope: PK-01 M00 PostgreSQL prerequisites
-- Authoritative: Canonical docs 20, 22, 51, 58

CREATE EXTENSION IF NOT EXISTS pgcrypto;
`;

export const M01_SQL = `-- Migration: 0002_m01_workspace_user_audit_idempotency
-- Scope: PK-01 M01 Workspace, Global User, Audit Events, Idempotency Records
-- Authoritative: Canonical docs 20, 21, 22, 50, 58

-- 1. Workspaces (Tenant container)
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspaces_id UNIQUE (id)
);

-- 2. Users (Global identity, no tenant data)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username_normalized text NOT NULL,
  email_normalized text NOT NULL,
  status text NOT NULL DEFAULT 'pending_activation' CHECK (status IN ('pending_activation', 'active', 'suspended')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_username UNIQUE (username_normalized),
  CONSTRAINT uq_users_email UNIQUE (email_normalized)
);

-- 3. Idempotency Records (T1/T2: scoped to workspace, actor, operation_key)
CREATE TABLE IF NOT EXISTS idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_key text NOT NULL,
  request_fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('claimed', 'completed', 'failed')),
  response_code integer NULL,
  sanitized_response jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT uq_idempotency_records UNIQUE (workspace_id, actor_user_id, operation_key)
);

CREATE INDEX IF NOT EXISTS ix_idempotency_expiry ON idempotency_records (expires_at);

-- 4. Audit Events (T3: append-only, tenant-isolated)
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  request_id text NOT NULL,
  metadata_sanitized jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_audit_cursor ON audit_events (workspace_id, created_at DESC, id DESC);

-- DB Guard: Audit Events is append-only. Prohibit UPDATE and DELETE
CREATE OR REPLACE FUNCTION prevent_audit_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % operation prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
CREATE TRIGGER trg_audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_events_mutation();
`;

export const M02_SQL = `-- Migration: 0003_m02_auth_membership_session_outbox
-- Scope: AUTH-01A M02 Workspace Memberships, User Credentials, Auth Sessions, Activation Invites, Email Outbox
-- Authoritative: Canonical docs 03, 04, 18, 20, 21, 22, 36, 50, 58

-- 1. Workspace Memberships (Tenant membership & role)
CREATE TABLE IF NOT EXISTS workspace_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'staff')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_memberships_workspace_user UNIQUE (workspace_id, user_id),
  CONSTRAINT uq_workspace_memberships_workspace_id UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS ix_workspace_memberships_user ON workspace_memberships (user_id);

-- 2. User Credentials (Argon2id password hashes, global identity credential)
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Activation Invites (CSPRNG single-use 24h tokens)
CREATE TABLE IF NOT EXISTS activation_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  token_version integer NOT NULL DEFAULT 1 CHECK (token_version > 0),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'issued', 'used', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_activation_invites_token_hash UNIQUE (token_hash),
  CONSTRAINT uq_activation_invites_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_activation_invites_membership FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_activation_invites_lookup ON activation_invites (workspace_id, user_id, status, expires_at);

-- 4. Auth Sessions (Server-side opaque sessions, idle + absolute timeouts)
CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_token_hash text NOT NULL,
  credential_version_at_issue integer NOT NULL CHECK (credential_version_at_issue > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  CONSTRAINT uq_auth_sessions_token_hash UNIQUE (session_token_hash),
  CONSTRAINT uq_auth_sessions_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_auth_sessions_membership FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_auth_sessions_lookup ON auth_sessions (workspace_id, user_id, revoked_at, absolute_expires_at);

-- 5. Email Outbox (Durable queue for asynchronous email delivery)
CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  invite_id uuid NOT NULL,
  message_type text NOT NULL CHECK (message_type IN ('activation_invite')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NULL,
  provider_message_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_email_outbox_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_email_outbox_invite FOREIGN KEY (workspace_id, invite_id)
    REFERENCES activation_invites(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_email_queue ON email_outbox (status, next_attempt_at, lease_until, id);

-- 6. Email Delivery Attempts (Audit trail for delivery outcomes)
CREATE TABLE IF NOT EXISTS email_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  outbox_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  outcome text NOT NULL CHECK (outcome IN ('queued', 'accepted', 'delivered', 'failed', 'unknown')),
  provider_message_id text NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  sanitized_error_code text NULL,
  CONSTRAINT uq_email_delivery_attempts UNIQUE (workspace_id, outbox_id, attempt_no),
  CONSTRAINT uq_email_delivery_attempts_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_email_delivery_attempts_outbox FOREIGN KEY (workspace_id, outbox_id)
    REFERENCES email_outbox(workspace_id, id) ON DELETE RESTRICT
);
`;

export const M02B_SQL = `-- Migration: 0004_m02b_user_workspace_bindings
-- Scope: C06 Preauthorized Workspace Context Binding, System Admin Authority, Append-Lifecycle History
-- Authoritative: Canonical docs 03, 04, 18, 20, 21, 36, 37, 50, OWNER DECISION

-- 1. System Administrators (Platform Scope Authority - independent of workspace memberships)
CREATE TABLE IF NOT EXISTS system_administrators (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  granted_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  revoked_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_system_administrators_revocation CHECK (
    (status = 'active' AND revoked_at IS NULL AND revoked_by_user_id IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_system_administrators_active
  ON system_administrators (user_id)
  WHERE status = 'active';

-- 2. User Workspace Bindings (Preauthorized Active Context per C06)
CREATE TABLE IF NOT EXISTS user_workspace_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  provisioned_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_workspace_bindings_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT ck_user_workspace_bindings_revocation_state CHECK (
    (status = 'active' AND revoked_at IS NULL AND revoked_by_user_id IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  ),
  CONSTRAINT fk_user_workspace_bindings_membership FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE RESTRICT
);

-- Global invariant: at most 1 active binding per user across all workspaces
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_workspace_bindings_single_active
  ON user_workspace_bindings (user_id)
  WHERE status = 'active';

-- Fast lookup index for session resolution and authentication
CREATE INDEX IF NOT EXISTS ix_user_workspace_bindings_lookup
  ON user_workspace_bindings (user_id, workspace_id)
  WHERE status = 'active';
`;

export const M03_SQL = `-- Migration: 0005_m03_employees
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
`;

export const M04_SQL = `-- Migration: 0006_m04_attendance
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
`;

export const M05_SQL = `-- Migration: 0007_m05_reports
-- Scope: REP M05 Daily Reports, Entries, Revisions (C02 Normative)
-- Authoritative: Canonical docs 03, 05, 19, 20, 21, 22, 25, 36, 50

-- 1. Daily Reports
CREATE TABLE IF NOT EXISTS daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  report_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz NULL,
  CONSTRAINT uq_daily_reports_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT uq_daily_reports_employee_day UNIQUE (workspace_id, employee_id, report_date)
);

CREATE INDEX IF NOT EXISTS ix_daily_reports_employee
  ON daily_reports (workspace_id, employee_id, report_date DESC);

CREATE INDEX IF NOT EXISTS ix_daily_reports_date
  ON daily_reports (workspace_id, report_date DESC);

-- 2. Daily Report Entries (Line items of work performed)
CREATE TABLE IF NOT EXISTS daily_report_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  work_type text NOT NULL,
  reported_count integer NOT NULL CHECK (reported_count >= 0),
  notes text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_report_entries_workspace_id UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS ix_daily_report_entries_report
  ON daily_report_entries (workspace_id, report_id, sort_order ASC);

-- 3. Daily Report Revisions (Immutable history of submitted/revised reports)
CREATE TABLE IF NOT EXISTS daily_report_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  status text NOT NULL CHECK (status IN ('draft', 'submitted')),
  snapshot jsonb NOT NULL,
  reason text NULL,
  edited_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  edited_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_report_revisions_number UNIQUE (workspace_id, report_id, revision_number),
  CONSTRAINT uq_daily_report_revisions_workspace_id UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS ix_daily_report_revisions_report
  ON daily_report_revisions (workspace_id, report_id, revision_number DESC);

-- 4. Immutability guard trigger for daily_report_revisions
CREATE OR REPLACE FUNCTION prevent_daily_report_revisions_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'daily_report_revisions is append-only: % operation prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_daily_report_revisions_immutable ON daily_report_revisions;
CREATE TRIGGER trg_daily_report_revisions_immutable
  BEFORE UPDATE OR DELETE ON daily_report_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_daily_report_revisions_mutation();
`;
export const M06_SQL = `-- Migration: 0008_m06_schedules
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
`;

export const M07_SQL = `-- Migration: 0009_m07_payroll
-- Scope: PAY M07 Employee hourly rates, payroll periods, items, daily breakdowns, paid leaves, disbursements
-- Authoritative: SCOPE-EXT-02 PAY-01 POLICY-01 (V0.2 Extension) & GOVERNANCE-EXCEPTION PAY-024/V0.2

-- 1. Employee Hourly Rates (Immutable audit log of rate assignments with effective interval)
CREATE TABLE employee_hourly_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  hourly_rate_vnd bigint NOT NULL CHECK (hourly_rate_vnd >= 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NULL CHECK (effective_to IS NULL OR effective_to > effective_from),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_employee_hourly_rates_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_employee_hourly_rates_employee FOREIGN KEY (workspace_id, employee_id)
    REFERENCES employees(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX ix_employee_hourly_rates_lookup
  ON employee_hourly_rates (workspace_id, employee_id, effective_from DESC);

CREATE UNIQUE INDEX uq_pay_current_rate ON employee_hourly_rates(workspace_id,employee_id) WHERE effective_to IS NULL;

-- 2. Payroll Periods (Monthly accounting periods: draft / finalized)
CREATE TABLE payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  period_month text NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  calculation_revision integer NOT NULL DEFAULT 1 CHECK (calculation_revision > 0),
  finalized_at timestamptz NULL,
  finalized_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  finalized_snapshot_hash text NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_periods_month UNIQUE (workspace_id, period_month),
  CONSTRAINT uq_payroll_periods_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT ck_payroll_periods_dates CHECK (ends_on >= starts_on),
  CONSTRAINT ck_pay_finalized_metadata CHECK ((status = 'draft' AND finalized_at IS NULL AND finalized_by IS NULL AND finalized_snapshot_hash IS NULL) OR (status = 'finalized' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL AND finalized_snapshot_hash IS NOT NULL AND finalized_snapshot_hash ~ '^[a-f0-9]{64}$'))
);

CREATE INDEX ix_payroll_periods_month
  ON payroll_periods (workspace_id, period_month DESC);

-- 3. Payroll Employee Items (Aggregated net earnings per employee per period)
CREATE TABLE payroll_employee_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  approved_worked_seconds bigint NOT NULL DEFAULT 0 CHECK (approved_worked_seconds >= 0),
  approved_worked_minutes integer NOT NULL DEFAULT 0 CHECK (approved_worked_minutes >= 0),
  base_pay_vnd bigint NOT NULL DEFAULT 0 CHECK (base_pay_vnd >= 0),
  paid_leave_pay_vnd bigint NOT NULL DEFAULT 0 CHECK (paid_leave_pay_vnd >= 0),
  net_pay_vnd bigint NOT NULL CHECK (net_pay_vnd >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_employee_items_period UNIQUE (workspace_id, period_id, employee_id),
  CONSTRAINT uq_payroll_employee_items_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_payroll_employee_items_period FOREIGN KEY (workspace_id, period_id)
    REFERENCES payroll_periods(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_employee_items_employee FOREIGN KEY (workspace_id, employee_id)
    REFERENCES employees(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX ix_payroll_employee_items_lookup
  ON payroll_employee_items (workspace_id, period_id, employee_id);

-- 4. Payroll Daily Breakdowns (Daily exact wage calculation and 1 VND rounding)
CREATE TABLE payroll_daily_breakdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payroll_item_id uuid NOT NULL,
  work_date date NOT NULL,
  shift_count integer NOT NULL DEFAULT 0 CHECK (shift_count >= 0),
  worked_seconds bigint NOT NULL DEFAULT 0 CHECK (worked_seconds >= 0),
  worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  hourly_rate_vnd_snapshot bigint NOT NULL CHECK (hourly_rate_vnd_snapshot >= 0),
  raw_wage_vnd numeric(18, 4) NOT NULL CHECK (raw_wage_vnd >= 0),
  rounded_wage_vnd bigint NOT NULL CHECK (rounded_wage_vnd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_daily_breakdowns UNIQUE (workspace_id, payroll_item_id, work_date),
  CONSTRAINT uq_payroll_daily_breakdowns_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_payroll_daily_breakdowns_item FOREIGN KEY (workspace_id, payroll_item_id)
    REFERENCES payroll_employee_items(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_payroll_daily_breakdowns_date
  ON payroll_daily_breakdowns (workspace_id, payroll_item_id, work_date ASC);

-- 5. Payroll Paid Leaves (Separate paid leave entries with mandatory date, amount and reason)
CREATE TABLE payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payroll_item_id uuid NOT NULL,
  adjustment_type text NOT NULL CHECK (adjustment_type = 'paid_leave'),
  attributable_date date NOT NULL,
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_adjustments_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_payroll_adjustments_item FOREIGN KEY (workspace_id, payroll_item_id)
    REFERENCES payroll_employee_items(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX ix_payroll_adjustments_item
  ON payroll_adjustments (workspace_id, payroll_item_id, attributable_date ASC);

-- 6. Payroll Disbursements (Append-only record of actual manual wage disbursements)
CREATE TABLE payroll_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payroll_item_id uuid NOT NULL,
  disbursement_order integer NOT NULL CHECK (disbursement_order > 0),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  payment_method text NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('bank_transfer', 'cash', 'other')),
  payment_date date NOT NULL,
  reference_note text NULL,
  paid_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_disbursements_order UNIQUE (workspace_id, payroll_item_id, disbursement_order),
  CONSTRAINT uq_payroll_disbursements_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_payroll_disbursements_item FOREIGN KEY (workspace_id, payroll_item_id)
    REFERENCES payroll_employee_items(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX ix_payroll_disbursements_item
  ON payroll_disbursements (workspace_id, payroll_item_id, disbursement_order ASC);


-- Rates cannot overlap; serialize even the first assignment (no prior row).
CREATE FUNCTION pay_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pay:' || NEW.workspace_id::text, 0));
  IF TG_OP = 'UPDATE' AND (OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL) THEN RAISE EXCEPTION 'Rate closure is one-way'; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'effective_to') IS DISTINCT FROM (to_jsonb(NEW) - 'effective_to') THEN
    RAISE EXCEPTION 'Rate history is immutable except interval closure';
  END IF;
  IF EXISTS (SELECT 1 FROM employee_hourly_rates r WHERE r.workspace_id = NEW.workspace_id
    AND r.employee_id = NEW.employee_id AND r.id <> NEW.id
    AND tstzrange(r.effective_from, r.effective_to, '[)') && tstzrange(NEW.effective_from, NEW.effective_to, '[)')) THEN
    RAISE EXCEPTION 'Overlapping hourly rates';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pay_rate_guard BEFORE INSERT OR UPDATE ON employee_hourly_rates FOR EACH ROW EXECUTE FUNCTION pay_rate_guard();
CREATE FUNCTION pay_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PAY history is append-only'; END $$;
CREATE TRIGGER pay_rate_no_delete BEFORE DELETE ON employee_hourly_rates FOR EACH ROW EXECUTE FUNCTION pay_no_delete();

-- Freeze the period and all children, including INSERT, reparenting and DELETE.
CREATE FUNCTION pay_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalized' THEN RAISE EXCEPTION 'Finalized PAY snapshot is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.period_month <> OLD.period_month THEN
    RAISE EXCEPTION 'PAY period identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pay_period_guard BEFORE UPDATE OR DELETE ON payroll_periods FOR EACH ROW EXECUTE FUNCTION pay_period_guard();

CREATE FUNCTION pay_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; p uuid; w uuid; state text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'UPDATE' AND (NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id) THEN
      RAISE EXCEPTION 'PAY child identity is immutable';
    END IF;
    r := OLD;
  ELSE r := NEW; END IF;
  w := r.workspace_id;
  IF TG_TABLE_NAME = 'payroll_employee_items' THEN
    IF EXISTS (SELECT 1 FROM employees e JOIN workspace_memberships m ON m.workspace_id=e.workspace_id AND m.user_id=e.user_id WHERE e.workspace_id=w AND e.id=r.employee_id AND m.role='owner') THEN RAISE EXCEPTION 'Owner excluded from PAY'; END IF;
    p := r.period_id;
  ELSE SELECT period_id INTO p FROM payroll_employee_items WHERE workspace_id = w AND id = r.payroll_item_id; END IF;
  SELECT status INTO state FROM payroll_periods WHERE workspace_id = w AND id = p FOR UPDATE;
  IF state = 'finalized' THEN RAISE EXCEPTION 'Finalized PAY snapshot is immutable'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'payroll_employee_items' THEN
      IF NEW.period_id <> OLD.period_id OR NEW.employee_id <> OLD.employee_id THEN RAISE EXCEPTION 'PAY parent is immutable'; END IF;
    ELSIF NEW.payroll_item_id <> OLD.payroll_item_id THEN RAISE EXCEPTION 'PAY parent is immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pay_item_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_employee_items FOR EACH ROW EXECUTE FUNCTION pay_child_guard();
CREATE TRIGGER pay_daily_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_daily_breakdowns FOR EACH ROW EXECUTE FUNCTION pay_child_guard();
CREATE TRIGGER pay_adjustment_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_adjustments FOR EACH ROW EXECUTE FUNCTION pay_child_guard();

-- Manual ledger only. Check balance while holding the same parent row lock.
CREATE FUNCTION pay_disbursement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item payroll_employee_items%ROWTYPE; state text; paid numeric;
BEGIN
  SELECT * INTO STRICT item FROM payroll_employee_items WHERE workspace_id = NEW.workspace_id AND id = NEW.payroll_item_id FOR UPDATE;
  SELECT status INTO state FROM payroll_periods WHERE workspace_id = NEW.workspace_id AND id = item.period_id;
  IF state <> 'finalized' THEN RAISE EXCEPTION 'PAY period must be finalized'; END IF;
  SELECT COALESCE(sum(amount_vnd),0) INTO paid FROM payroll_disbursements WHERE workspace_id = NEW.workspace_id AND payroll_item_id = NEW.payroll_item_id;
  IF paid + NEW.amount_vnd > item.net_pay_vnd THEN RAISE EXCEPTION 'OVERPAYMENT_BLOCKED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pay_disbursement_guard BEFORE INSERT ON payroll_disbursements FOR EACH ROW EXECUTE FUNCTION pay_disbursement_guard();
CREATE TRIGGER pay_disbursement_immutable BEFORE UPDATE OR DELETE ON payroll_disbursements FOR EACH ROW EXECUTE FUNCTION pay_no_delete();
`;

const M08_SQL =
  "-- WORK-01 rev03. Additive workspace-scoped assignment/submission lifecycle.\nCREATE TABLE work_items (\n id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n title text NOT NULL CHECK(length(trim(title))>0 AND length(title)<=200), description text,\n work_type text NOT NULL DEFAULT 'general' CHECK(work_type IN ('general','content','video','design','other')),\n status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','in_review','completed','cancelled')),\n priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')), due_at timestamptz,\n created_by uuid NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1 CHECK(version>0),\n created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)\n);\nCREATE TABLE work_assignments (\n id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n work_item_id uuid NOT NULL, employee_id uuid NOT NULL, stage text NOT NULL DEFAULT 'primary',\n status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','in_review','completed')),\n assigned_by uuid NOT NULL REFERENCES users(id), assigned_at timestamptz NOT NULL DEFAULT now(),\n FOREIGN KEY(workspace_id,work_item_id) REFERENCES work_items(workspace_id,id) ON DELETE CASCADE,\n FOREIGN KEY(workspace_id,employee_id) REFERENCES employees(workspace_id,id) ON DELETE RESTRICT,\n UNIQUE(workspace_id,work_item_id,employee_id), UNIQUE(workspace_id,id), UNIQUE(workspace_id,work_item_id,id)\n);\nCREATE TABLE work_submissions (\n id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n work_item_id uuid NOT NULL, assignment_id uuid NOT NULL, revision_number integer NOT NULL CHECK(revision_number>0),\n submission_note text NOT NULL CHECK(length(trim(submission_note))>0), attachments jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(attachments)='array'),\n submitted_by uuid NOT NULL REFERENCES users(id), submitted_at timestamptz NOT NULL DEFAULT now(),\n FOREIGN KEY(workspace_id,work_item_id) REFERENCES work_items(workspace_id,id) ON DELETE CASCADE,\n FOREIGN KEY(workspace_id,work_item_id,assignment_id) REFERENCES work_assignments(workspace_id,work_item_id,id) ON DELETE RESTRICT,\n UNIQUE(workspace_id,assignment_id,revision_number), UNIQUE(workspace_id,work_item_id,assignment_id,id)\n);\nCREATE TABLE work_reviews (\n id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n work_item_id uuid NOT NULL, assignment_id uuid NOT NULL, submission_id uuid NOT NULL,\n reviewer_user_id uuid NOT NULL REFERENCES users(id), decision text NOT NULL CHECK(decision IN ('approved','request_changes')),\n feedback text CHECK(decision<>'request_changes' OR length(trim(feedback))>0 AND feedback IS NOT NULL), reviewed_at timestamptz NOT NULL DEFAULT now(),\n FOREIGN KEY(workspace_id,work_item_id) REFERENCES work_items(workspace_id,id) ON DELETE CASCADE,\n FOREIGN KEY(workspace_id,work_item_id,assignment_id) REFERENCES work_assignments(workspace_id,work_item_id,id) ON DELETE CASCADE,\n FOREIGN KEY(workspace_id,work_item_id,assignment_id,submission_id) REFERENCES work_submissions(workspace_id,work_item_id,assignment_id,id) ON DELETE RESTRICT,\n UNIQUE(workspace_id,submission_id)\n);\nCREATE INDEX work_items_filter ON work_items(workspace_id,status,priority,created_at);\nCREATE INDEX work_assignments_employee ON work_assignments(workspace_id,employee_id,work_item_id);\nCREATE INDEX work_reviews_history ON work_reviews(workspace_id,assignment_id,reviewed_at);\nCREATE FUNCTION work_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN RAISE EXCEPTION 'WORK history is append-only' USING ERRCODE='23514'; END $$;\nCREATE TRIGGER work_submission_immutable BEFORE UPDATE OR DELETE ON work_submissions FOR EACH ROW EXECUTE FUNCTION work_history_immutable();\nCREATE TRIGGER work_review_immutable BEFORE UPDATE OR DELETE ON work_reviews FOR EACH ROW EXECUTE FUNCTION work_history_immutable();\nCREATE FUNCTION work_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$\nDECLARE parent_status text;\nBEGIN\n IF TG_OP='DELETE' THEN RAISE EXCEPTION 'WORK assignment history cannot be deleted' USING ERRCODE='23514'; END IF;\n SELECT status INTO parent_status FROM work_items WHERE workspace_id=NEW.workspace_id AND id=NEW.work_item_id FOR UPDATE;\n IF parent_status='cancelled' THEN RAISE EXCEPTION 'WORK parent is closed' USING ERRCODE='23514'; END IF;\n IF TG_OP='INSERT' AND NEW.status<>'todo' THEN RAISE EXCEPTION 'Assignment must start todo' USING ERRCODE='23514'; END IF;\n IF TG_OP='UPDATE' THEN\n  IF ROW(NEW.id,NEW.workspace_id,NEW.work_item_id,NEW.employee_id,NEW.stage,NEW.assigned_by,NEW.assigned_at) IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.work_item_id,OLD.employee_id,OLD.stage,OLD.assigned_by,OLD.assigned_at) THEN RAISE EXCEPTION 'Assignment identity immutable' USING ERRCODE='23514'; END IF;\n  IF NOT ((OLD.status='todo' AND NEW.status='in_progress') OR (OLD.status='in_progress' AND NEW.status='in_review' AND EXISTS(SELECT 1 FROM work_submissions s WHERE s.workspace_id=NEW.workspace_id AND s.assignment_id=NEW.id AND NOT EXISTS(SELECT 1 FROM work_reviews r WHERE r.workspace_id=s.workspace_id AND r.submission_id=s.id))) OR (OLD.status='in_review' AND NEW.status IN ('completed','in_progress') AND EXISTS(SELECT 1 FROM work_reviews r JOIN work_submissions s ON s.workspace_id=r.workspace_id AND s.id=r.submission_id WHERE r.workspace_id=NEW.workspace_id AND r.assignment_id=NEW.id AND r.decision=CASE WHEN NEW.status='completed' THEN 'approved' ELSE 'request_changes' END AND s.revision_number=(SELECT max(revision_number) FROM work_submissions WHERE workspace_id=NEW.workspace_id AND assignment_id=NEW.id)))) THEN RAISE EXCEPTION 'Invalid WORK assignment transition' USING ERRCODE='23514'; END IF;\n END IF;\n RETURN NEW;\nEND $$;\nCREATE TRIGGER work_assignment_transition BEFORE INSERT OR UPDATE OR DELETE ON work_assignments FOR EACH ROW EXECUTE FUNCTION work_assignment_guard();\nCREATE FUNCTION work_submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$\nDECLARE a work_assignments; p text; next_revision integer;\nBEGIN\n SELECT status INTO p FROM work_items WHERE workspace_id=NEW.workspace_id AND id=NEW.work_item_id FOR UPDATE;\n SELECT * INTO a FROM work_assignments WHERE workspace_id=NEW.workspace_id AND work_item_id=NEW.work_item_id AND id=NEW.assignment_id FOR UPDATE;\n SELECT coalesce(max(revision_number),0)+1 INTO next_revision FROM work_submissions WHERE workspace_id=NEW.workspace_id AND assignment_id=NEW.assignment_id;\n IF p IN ('cancelled','completed') OR a.status<>'in_progress' OR NEW.revision_number<>next_revision OR NOT EXISTS(SELECT 1 FROM employees WHERE workspace_id=NEW.workspace_id AND id=a.employee_id AND user_id=NEW.submitted_by) THEN RAISE EXCEPTION 'Invalid WORK submission' USING ERRCODE='23514'; END IF;\n RETURN NEW;\nEND $$;\nCREATE TRIGGER work_submission_valid BEFORE INSERT ON work_submissions FOR EACH ROW EXECUTE FUNCTION work_submission_guard();\nCREATE FUNCTION work_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$\nDECLARE a work_assignments; p text;\nBEGIN\n SELECT status INTO p FROM work_items WHERE workspace_id=NEW.workspace_id AND id=NEW.work_item_id FOR UPDATE;\n SELECT * INTO a FROM work_assignments WHERE workspace_id=NEW.workspace_id AND work_item_id=NEW.work_item_id AND id=NEW.assignment_id FOR UPDATE;\n IF p IN ('cancelled','completed') OR a.status<>'in_review' OR NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=NEW.workspace_id AND user_id=NEW.reviewer_user_id AND status='active' AND role='owner') OR NOT EXISTS(SELECT 1 FROM work_submissions WHERE workspace_id=NEW.workspace_id AND work_item_id=NEW.work_item_id AND assignment_id=NEW.assignment_id AND id=NEW.submission_id AND revision_number=(SELECT max(revision_number) FROM work_submissions WHERE workspace_id=NEW.workspace_id AND assignment_id=NEW.assignment_id)) THEN RAISE EXCEPTION 'Invalid WORK review' USING ERRCODE='23514'; END IF;\n RETURN NEW;\nEND $$;\nCREATE TRIGGER work_review_valid BEFORE INSERT ON work_reviews FOR EACH ROW EXECUTE FUNCTION work_review_guard();\nCREATE FUNCTION work_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$\nDECLARE expected text;\nBEGIN\n IF TG_OP='DELETE' THEN RAISE EXCEPTION 'WORK item history cannot be deleted' USING ERRCODE='23514'; END IF;\n IF TG_OP='INSERT' THEN IF NEW.status<>'todo' OR NEW.version<>1 THEN RAISE EXCEPTION 'WORK must start todo version 1' USING ERRCODE='23514'; END IF; RETURN NEW; END IF;\n IF OLD.status='cancelled' OR ROW(OLD.id,OLD.workspace_id,OLD.created_by,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.workspace_id,NEW.created_by,NEW.created_at) THEN RAISE EXCEPTION 'WORK item closed or identity changed' USING ERRCODE='23514'; END IF;\n IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'WORK version must increment once' USING ERRCODE='23514'; END IF;\n SELECT CASE WHEN count(*)=0 OR bool_and(status='todo') THEN 'todo' WHEN bool_and(status='completed') THEN 'completed' WHEN bool_and(status='in_review') THEN 'in_review' ELSE 'in_progress' END INTO expected FROM work_assignments WHERE workspace_id=NEW.workspace_id AND work_item_id=NEW.id;\n IF NEW.status<>'cancelled' AND NEW.status<>expected THEN RAISE EXCEPTION 'WORK aggregate status invalid' USING ERRCODE='23514'; END IF;\n RETURN NEW;\nEND $$;\nCREATE TRIGGER work_item_valid BEFORE INSERT OR UPDATE OR DELETE ON work_items FOR EACH ROW EXECUTE FUNCTION work_item_guard();\n\n-- Commit-time aggregate validation covers inserts as well as status updates.\nCREATE FUNCTION work_aggregate_consistent() RETURNS trigger LANGUAGE plpgsql AS $$\nDECLARE w uuid; parent uuid; actual text; expected text;\nBEGIN\n w:=NEW.workspace_id;\n IF TG_TABLE_NAME='work_items' THEN parent:=NEW.id; ELSE parent:=NEW.work_item_id; END IF;\n SELECT status INTO actual FROM work_items WHERE workspace_id=w AND id=parent;\n SELECT CASE WHEN count(*)=0 OR bool_and(status='todo') THEN 'todo' WHEN bool_and(status='completed') THEN 'completed' WHEN bool_and(status='in_review') THEN 'in_review' ELSE 'in_progress' END INTO expected FROM work_assignments WHERE workspace_id=w AND work_item_id=parent;\n IF actual IS DISTINCT FROM 'cancelled' AND actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'WORK aggregate status inconsistent at commit' USING ERRCODE='23514'; END IF;\n RETURN NULL;\nEND $$;\nCREATE CONSTRAINT TRIGGER work_item_aggregate AFTER INSERT OR UPDATE ON work_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION work_aggregate_consistent();\nCREATE CONSTRAINT TRIGGER work_assignment_aggregate AFTER INSERT OR UPDATE ON work_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION work_aggregate_consistent();\n";
export const M06_ACCOUNTS_SQL = `-- Migration: 0011_m06_accounts
-- Scope: ACC-01 Managed Accounts, Secrets Vault (C05), Reauthentication Proofs, and Immutable Audit Events
-- Authoritative: Canonical docs 02, 18, 20, 22, 25, 36; SCOPE-EXT-04-ACC-01

-- 1. Managed Accounts (Metadata container, Owner-only)
CREATE TABLE IF NOT EXISTS managed_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  platform text NOT NULL CHECK (platform IN ('tiktok', 'gmail', 'ai', 'pm', 'other')),
  platform_account_id text,
  username text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_managed_accounts_id_workspace UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_status
  ON managed_accounts (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_platform
  ON managed_accounts (workspace_id, platform);

-- 2. Account Secrets (AEAD Encrypted Vault, AES-256-GCM, AAD-bound, Owner-only)
CREATE TABLE IF NOT EXISTS account_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  secret_type text NOT NULL CHECK (secret_type IN ('password', 'api_key', 'recovery_code', 'totp_secret')),
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version text NOT NULL DEFAULT 'v1',
  encryption_schema_version integer NOT NULL DEFAULT 1 CHECK (encryption_schema_version >= 1),
  secret_version integer NOT NULL DEFAULT 1 CHECK (secret_version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_account_secrets_account
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_account_secrets_workspace_account_type
    UNIQUE (workspace_id, account_id, secret_type)
);

CREATE INDEX IF NOT EXISTS idx_account_secrets_account
  ON account_secrets (account_id);

-- 3. Account Reauthentication Proofs (Single-use, 5-minute maximum TTL, Action-bound)
CREATE TABLE IF NOT EXISTS account_reauth_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('secret_write', 'secret_reveal')),
  proof_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_account_reauth_proofs_account
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_account_reauth_proofs_lookup
  ON account_reauth_proofs (proof_hash, workspace_id, user_id, action, account_id);

-- 4. Secret Access Events (Immutable Audit Trail for Secret Access/Mutation, Owner-only)
CREATE TABLE IF NOT EXISTS secret_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('reveal', 'write', 'archive', 'restore')),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_secret_access_events_account
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_secret_access_events_account
  ON secret_access_events (workspace_id, account_id, created_at DESC);

-- Immutable Guard for secret_access_events: no UPDATE or DELETE allowed
CREATE OR REPLACE FUNCTION secret_access_events_immutable_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'secret_access_events is an immutable audit trail and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_secret_access_events_immutable ON secret_access_events;
CREATE TRIGGER trg_secret_access_events_immutable
  BEFORE UPDATE OR DELETE ON secret_access_events
  FOR EACH ROW
  EXECUTE FUNCTION secret_access_events_immutable_guard();

-- 5. Canonical Optional Entities: Contact Points & Links (Doc 20 / Doc 22)
CREATE TABLE IF NOT EXISTS contact_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('email', 'phone', 'url', 'other')),
  normalized_value text NOT NULL,
  display_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_contact_points UNIQUE (workspace_id, type, normalized_value)
);

CREATE TABLE IF NOT EXISTS account_contact_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  contact_point_id uuid NOT NULL REFERENCES contact_points(id) ON DELETE RESTRICT,
  relationship_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_account_contact_links_account
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_account_contact_links
    UNIQUE (workspace_id, account_id, contact_point_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS account_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_account_id uuid NOT NULL,
  target_account_id uuid NOT NULL,
  relationship_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (source_account_id <> target_account_id),
  CONSTRAINT fk_account_relationships_source
    FOREIGN KEY (source_account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_account_relationships_target
    FOREIGN KEY (target_account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_account_relationships
    UNIQUE (workspace_id, source_account_id, target_account_id, relationship_type)
);
`;

export const M09_STORAGE_SQL =
  "-- Migration: 0012_m09_storage\n-- Scope: FILE-01 Quản lý Tệp & Thư mục Google Drive (Canonical STORAGE)\n-- Authoritative: Canonical docs 02, 03, 05, 14, 20, 22, 26; SCOPE-EXT-05-FILE-01\n\n-- 1. Storage Folders (Canonical entity: storage_folders)\nCREATE TABLE IF NOT EXISTS storage_folders (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  name text NOT NULL,\n  provider text NOT NULL DEFAULT 'google_drive',\n  provider_folder_id text,\n  drive_url text NOT NULL,\n  folder_type text NOT NULL CHECK (folder_type IN ('source', 'deliverable')),\n  status text NOT NULL DEFAULT 'ready_for_download' CHECK (status IN ('ready_for_download', 'downloaded', 'deliverable_submitted', 'approved', 'trashed')),\n  parent_folder_id uuid,\n  assigned_employee_id uuid,\n  created_by_employee_id uuid,\n  assignment_id uuid,\n  current_revision_id uuid,\n  current_revision_number integer NOT NULL DEFAULT 1 CHECK (current_revision_number >= 1),\n  owner_receipt_confirmed boolean NOT NULL DEFAULT false,\n  owner_receipt_revision integer,\n  owner_reviewed_at timestamptz,\n  notes text,\n  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),\n  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),\n  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),\n  CONSTRAINT uq_storage_folders_workspace_id UNIQUE (workspace_id, id),\n  CONSTRAINT fk_storage_folders_parent\n    FOREIGN KEY (workspace_id, parent_folder_id)\n    REFERENCES storage_folders (workspace_id, id)\n    ON DELETE RESTRICT,\n  CONSTRAINT fk_storage_folders_assigned_employee\n    FOREIGN KEY (workspace_id, assigned_employee_id)\n    REFERENCES employees (workspace_id, id)\n    ON DELETE RESTRICT,\n  CONSTRAINT fk_storage_folders_creator_employee\n    FOREIGN KEY (workspace_id, created_by_employee_id)\n    REFERENCES employees (workspace_id, id)\n    ON DELETE RESTRICT\n);\n\nCREATE INDEX IF NOT EXISTS idx_storage_folders_workspace_status\n  ON storage_folders (workspace_id, status);\n\nCREATE INDEX IF NOT EXISTS idx_storage_folders_workspace_parent\n  ON storage_folders (workspace_id, parent_folder_id);\n\nCREATE INDEX IF NOT EXISTS idx_storage_folders_workspace_type\n  ON storage_folders (workspace_id, folder_type);\n\n-- 2. Folder Assignments (Per-employee tracking for source folder download and deliverables)\nCREATE TABLE IF NOT EXISTS folder_assignments (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  folder_id uuid NOT NULL,\n  employee_id uuid NOT NULL,\n  source_download_confirmed boolean NOT NULL DEFAULT false,\n  source_downloaded_at timestamptz,\n  output_delivered boolean NOT NULL DEFAULT false,\n  output_folder_id uuid,\n  output_delivered_at timestamptz,\n  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'downloaded', 'delivered')),\n  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),\n  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),\n  CONSTRAINT uq_folder_assignments_workspace_id UNIQUE (workspace_id, id),\n  CONSTRAINT uq_folder_assignments_folder_employee UNIQUE (workspace_id, folder_id, employee_id),\n  CONSTRAINT fk_folder_assignments_folder\n    FOREIGN KEY (workspace_id, folder_id)\n    REFERENCES storage_folders (workspace_id, id)\n    ON DELETE RESTRICT,\n  CONSTRAINT fk_folder_assignments_employee\n    FOREIGN KEY (workspace_id, employee_id)\n    REFERENCES employees (workspace_id, id)\n    ON DELETE RESTRICT\n);\n\nCREATE INDEX IF NOT EXISTS idx_folder_assignments_folder\n  ON folder_assignments (workspace_id, folder_id);\n\nCREATE INDEX IF NOT EXISTS idx_folder_assignments_employee\n  ON folder_assignments (workspace_id, employee_id);\n\n-- 3. Folder Revisions (Canonical entity: folder_revisions)\nCREATE TABLE IF NOT EXISTS folder_revisions (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  folder_id uuid NOT NULL,\n  revision_number integer NOT NULL CHECK (revision_number >= 1),\n  snapshot_hash text NOT NULL,\n  notes text,\n  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),\n  CONSTRAINT uq_folder_revisions_workspace_id UNIQUE (workspace_id, id),\n  CONSTRAINT uq_folder_revisions_folder_rev UNIQUE (workspace_id, folder_id, revision_number),\n  CONSTRAINT fk_folder_revisions_folder\n    FOREIGN KEY (workspace_id, folder_id)\n    REFERENCES storage_folders (workspace_id, id)\n    ON DELETE RESTRICT\n);\n\nCREATE INDEX IF NOT EXISTS idx_folder_revisions_folder\n  ON folder_revisions (workspace_id, folder_id);\n\n-- 4. Folder Receipts (Canonical entity: folder_receipts)\nCREATE TABLE IF NOT EXISTS folder_receipts (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  folder_id uuid NOT NULL,\n  folder_revision_id uuid,\n  receipt_type text NOT NULL CHECK (receipt_type IN ('download', 'deliverable_approval')),\n  revision_number integer NOT NULL DEFAULT 1 CHECK (revision_number >= 1),\n  confirmed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  assignment_id uuid,\n  notes text,\n  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),\n  CONSTRAINT uq_folder_receipts_workspace_id UNIQUE (workspace_id, id),\n  CONSTRAINT fk_folder_receipts_folder\n    FOREIGN KEY (workspace_id, folder_id)\n    REFERENCES storage_folders (workspace_id, id)\n    ON DELETE RESTRICT,\n  CONSTRAINT fk_folder_receipts_assignment\n    FOREIGN KEY (workspace_id, assignment_id)\n    REFERENCES folder_assignments (workspace_id, id)\n    ON DELETE RESTRICT\n);\n\nCREATE INDEX IF NOT EXISTS idx_folder_receipts_folder\n  ON folder_receipts (workspace_id, folder_id, receipt_type);\n\n-- 5. Storage Files (Canonical entity: storage_files)\nCREATE TABLE IF NOT EXISTS storage_files (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  folder_id uuid NOT NULL,\n  provider_file_id text,\n  provider_revision_id text,\n  name text NOT NULL,\n  size_bytes bigint,\n  mime_type text,\n  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'deleted', 'trashed')),\n  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),\n  CONSTRAINT uq_storage_files_workspace_id UNIQUE (workspace_id, id),\n  CONSTRAINT fk_storage_files_folder\n    FOREIGN KEY (workspace_id, folder_id)\n    REFERENCES storage_folders (workspace_id, id)\n    ON DELETE RESTRICT\n);\n\nCREATE INDEX IF NOT EXISTS idx_storage_files_folder\n  ON storage_files (workspace_id, folder_id);\n\n-- 6. Storage Trash Requests (Two-step group trash intent)\nCREATE TABLE IF NOT EXISTS storage_trash_requests (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  folder_id uuid NOT NULL,\n  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired', 'cancelled')),\n  group_snapshot_hash text NOT NULL,\n  deliverables_affected_count integer NOT NULL DEFAULT 0,\n  warning text NOT NULL,\n  expires_at timestamptz NOT NULL,\n  confirmed_at timestamptz,\n  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),\n  CONSTRAINT uq_storage_trash_requests_workspace_id UNIQUE (workspace_id, id),\n  CONSTRAINT fk_storage_trash_requests_folder\n    FOREIGN KEY (workspace_id, folder_id)\n    REFERENCES storage_folders (workspace_id, id)\n    ON DELETE RESTRICT\n);\n\nCREATE INDEX IF NOT EXISTS idx_storage_trash_requests_folder\n  ON storage_trash_requests (workspace_id, folder_id, status);\n\n-- 7. Storage Operations (Canonical entity: storage_operations - durable reconciliation)\nCREATE TABLE IF NOT EXISTS storage_operations (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  folder_id uuid NOT NULL,\n  operation_type text NOT NULL CHECK (operation_type IN ('trash_group', 'restore_group')),\n  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'unknown')),\n  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  provider text NOT NULL DEFAULT 'google_drive',\n  error_message text,\n  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),\n  completed_at timestamptz,\n  CONSTRAINT uq_storage_operations_workspace_id UNIQUE (workspace_id, id),\n  CONSTRAINT fk_storage_operations_folder\n    FOREIGN KEY (workspace_id, folder_id)\n    REFERENCES storage_folders (workspace_id, id)\n    ON DELETE RESTRICT\n);\n\nCREATE INDEX IF NOT EXISTS idx_storage_operations_folder\n  ON storage_operations (workspace_id, folder_id);\n\n-- 8. Resource Access Grants (Canonical entity: resource_access_grants)\nCREATE TABLE IF NOT EXISTS resource_access_grants (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  resource_type text NOT NULL CHECK (resource_type IN ('storage_folder')),\n  resource_id uuid NOT NULL,\n  employee_id uuid NOT NULL,\n  access_level text NOT NULL DEFAULT 'read' CHECK (access_level IN ('read', 'write', 'admin')),\n  expires_at timestamptz,\n  revoked_at timestamptz,\n  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),\n  CONSTRAINT uq_resource_access_grants_workspace_id UNIQUE (workspace_id, id),\n  CONSTRAINT uq_resource_access_grants_unique UNIQUE (workspace_id, resource_type, resource_id, employee_id),\n  CONSTRAINT fk_resource_access_grants_folder\n    FOREIGN KEY (workspace_id, resource_id)\n    REFERENCES storage_folders (workspace_id, id)\n    ON DELETE RESTRICT,\n  CONSTRAINT fk_resource_access_grants_employee\n    FOREIGN KEY (workspace_id, employee_id)\n    REFERENCES employees (workspace_id, id)\n    ON DELETE RESTRICT\n);\n\nCREATE INDEX IF NOT EXISTS idx_resource_access_grants_resource\n  ON resource_access_grants (workspace_id, resource_type, resource_id);\n\nCREATE INDEX IF NOT EXISTS idx_resource_access_grants_employee\n  ON resource_access_grants (workspace_id, employee_id);\n";

export const M10_ISSUES_SQL = `-- Migration: 0013_m10_issues
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
`;

export const FIN01A_SQL = `-- FIN-01A/design.2. Additive private Owner ledger; no existing table changes.
CREATE TABLE fin_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('income', 'expense')),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  normalized_name text GENERATED ALWAYS AS (lower(normalize(name, NFC))) STORED,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, owner_user_id, direction, id),
  FOREIGN KEY (workspace_id, owner_user_id)
    REFERENCES workspace_memberships (workspace_id, user_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX fin_category_active_name
  ON fin_categories (workspace_id, owner_user_id, direction, normalized_name) WHERE is_active;

CREATE TABLE fin_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  root_entry_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  direction text NOT NULL CHECK (direction IN ('income', 'expense')),
  category_id uuid NOT NULL,
  category_name_snapshot text NOT NULL CHECK (char_length(category_name_snapshot) BETWEEN 1 AND 100),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  occurred_on date NOT NULL CHECK (occurred_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  note text NULL CHECK (char_length(note) <= 2000),
  operation_key text NOT NULL CHECK (char_length(operation_key) > 0),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, owner_user_id, id),
  UNIQUE (workspace_id, owner_user_id, root_entry_id, id),
  UNIQUE (workspace_id, owner_user_id, root_entry_id, revision_number),
  UNIQUE (workspace_id, owner_user_id, operation_key),
  CHECK ((revision_number = 1 AND id = root_entry_id) OR (revision_number > 1 AND id <> root_entry_id)),
  FOREIGN KEY (workspace_id, owner_user_id, direction, category_id)
    REFERENCES fin_categories (workspace_id, owner_user_id, direction, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, owner_user_id, root_entry_id)
    REFERENCES fin_entries (workspace_id, owner_user_id, id) ON DELETE RESTRICT
);
CREATE INDEX fin_entries_date ON fin_entries (workspace_id, owner_user_id, occurred_on DESC, id DESC);
CREATE INDEX fin_entries_category_date ON fin_entries (workspace_id, owner_user_id, category_id, occurred_on DESC, id DESC);
CREATE INDEX fin_entries_direction_date ON fin_entries (workspace_id, owner_user_id, direction, occurred_on DESC, id DESC);

CREATE TABLE fin_entry_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  root_entry_id uuid NOT NULL,
  original_revision_id uuid NOT NULL,
  replacement_revision_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 1 AND 1000),
  actor_user_id uuid NOT NULL CHECK (actor_user_id = owner_user_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (original_revision_id <> replacement_revision_id),
  UNIQUE (workspace_id, owner_user_id, original_revision_id),
  UNIQUE (workspace_id, owner_user_id, replacement_revision_id),
  FOREIGN KEY (workspace_id, owner_user_id, root_entry_id, original_revision_id)
    REFERENCES fin_entries (workspace_id, owner_user_id, root_entry_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, owner_user_id, root_entry_id, replacement_revision_id)
    REFERENCES fin_entries (workspace_id, owner_user_id, root_entry_id, id) ON DELETE RESTRICT
);
CREATE INDEX fin_corrections_history ON fin_entry_corrections (workspace_id, owner_user_id, root_entry_id, created_at, id);

CREATE FUNCTION fin_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FIN history is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER fin_entries_immutable BEFORE UPDATE OR DELETE ON fin_entries
  FOR EACH ROW EXECUTE FUNCTION fin_immutable();
CREATE TRIGGER fin_corrections_immutable BEFORE UPDATE OR DELETE ON fin_entry_corrections
  FOR EACH ROW EXECUTE FUNCTION fin_immutable();
CREATE TRIGGER fin_entries_no_truncate BEFORE TRUNCATE ON fin_entries
  FOR EACH STATEMENT EXECUTE FUNCTION fin_immutable();
CREATE TRIGGER fin_corrections_no_truncate BEFORE TRUNCATE ON fin_entry_corrections
  FOR EACH STATEMENT EXECUTE FUNCTION fin_immutable();

CREATE FUNCTION fin_category_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.owner_user_id <> OLD.owner_user_id
    OR NEW.direction <> OLD.direction OR NEW.created_at <> OLD.created_at
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Invalid FIN category update' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER fin_category_update BEFORE UPDATE ON fin_categories
  FOR EACH ROW EXECUTE FUNCTION fin_category_guard();
CREATE TRIGGER fin_category_no_delete BEFORE DELETE ON fin_categories
  FOR EACH ROW EXECUTE FUNCTION fin_immutable();
CREATE TRIGGER fin_category_no_truncate BEFORE TRUNCATE ON fin_categories
  FOR EACH STATEMENT EXECUTE FUNCTION fin_immutable();

CREATE FUNCTION fin_category_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workspace_memberships
    WHERE workspace_id = NEW.workspace_id AND user_id = NEW.owner_user_id
      AND role = 'owner' AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIN Owner membership required' USING ERRCODE = '23514'; END IF;
  IF NEW.version <> 1 THEN RAISE EXCEPTION 'Invalid initial FIN category version' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fin_category_insert BEFORE INSERT ON fin_categories
  FOR EACH ROW EXECUTE FUNCTION fin_category_insert_guard();

-- Shared lock order is membership then category then logical root, before audit.
-- This guard supplements (does not replace) authenticated service authorization.
CREATE FUNCTION fin_entry_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category fin_categories%ROWTYPE;
BEGIN
  PERFORM 1 FROM workspace_memberships
    WHERE workspace_id = NEW.workspace_id AND user_id = NEW.owner_user_id
      AND role = 'owner' AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIN Owner membership required' USING ERRCODE = '23514'; END IF;
  SELECT * INTO category FROM fin_categories WHERE workspace_id = NEW.workspace_id
    AND owner_user_id = NEW.owner_user_id AND id = NEW.category_id FOR SHARE;
  IF NOT FOUND OR NOT category.is_active OR category.direction <> NEW.direction
    OR category.name <> NEW.category_name_snapshot THEN
    RAISE EXCEPTION 'Invalid FIN category' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision_number > 1 THEN
    PERFORM 1 FROM fin_entries WHERE workspace_id = NEW.workspace_id AND owner_user_id = NEW.owner_user_id
      AND id = NEW.root_entry_id AND revision_number = 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid FIN root' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fin_entry_insert BEFORE INSERT ON fin_entries
  FOR EACH ROW EXECUTE FUNCTION fin_entry_insert_guard();

-- Both sides must exist at commit. No standalone replacement or detached correction.
CREATE FUNCTION fin_revision_pair_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original fin_entries%ROWTYPE; replacement fin_entries%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'fin_entries' THEN
    IF NEW.revision_number = 1 THEN RETURN NULL; END IF;
    PERFORM 1 FROM fin_entry_corrections WHERE workspace_id = NEW.workspace_id AND owner_user_id = NEW.owner_user_id
      AND root_entry_id = NEW.root_entry_id AND replacement_revision_id = NEW.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'FIN replacement needs correction' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT * INTO STRICT original FROM fin_entries WHERE id = NEW.original_revision_id;
    SELECT * INTO STRICT replacement FROM fin_entries WHERE id = NEW.replacement_revision_id;
    IF replacement.revision_number <> original.revision_number + 1
      OR replacement.root_entry_id <> original.root_entry_id THEN
      RAISE EXCEPTION 'Invalid FIN revision sequence' USING ERRCODE = '23514';
    END IF;
    IF ROW(original.direction, original.category_id, original.amount_vnd, original.occurred_on, original.note)
      IS NOT DISTINCT FROM ROW(replacement.direction, replacement.category_id, replacement.amount_vnd, replacement.occurred_on, replacement.note) THEN
      RAISE EXCEPTION 'FIN correction has no change' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER fin_revision_pair AFTER INSERT ON fin_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fin_revision_pair_guard();
CREATE CONSTRAINT TRIGGER fin_correction_pair AFTER INSERT ON fin_entry_corrections
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fin_revision_pair_guard();

REVOKE ALL ON fin_categories, fin_entries, fin_entry_corrections FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fin_immutable(), fin_category_guard(), fin_category_insert_guard(), fin_entry_insert_guard(), fin_revision_pair_guard() FROM PUBLIC;
`;

export const FIN_RECEIPT_TIME_SQL = `-- FIN-01A/impl.6. Additive: full occurred_at (time modes) and private receipt metadata.
-- 0014 is applied history and is not modified. Legacy rows stay occurred_at NULL / legacy_date_only;
-- a time is never inferred from occurred_on or created_at.

CREATE TABLE fin_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  storage_key text NOT NULL CHECK (storage_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}[.](jpg|png)$'),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 4194304),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'staged' CHECK (state IN ('staged', 'attached', 'discarded')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  attached_at timestamptz NULL,
  CHECK (expires_at > created_at),
  CHECK ((state = 'attached') = (attached_at IS NOT NULL)),
  UNIQUE (workspace_id, owner_user_id, id),
  FOREIGN KEY (workspace_id, owner_user_id)
    REFERENCES workspace_memberships (workspace_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX fin_receipts_lifecycle ON fin_receipts (workspace_id, owner_user_id, state, expires_at);
CREATE INDEX fin_receipts_digest ON fin_receipts (workspace_id, owner_user_id, sha256);

CREATE FUNCTION fin_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state = 'attached' THEN
      RAISE EXCEPTION 'Attached FIN receipt is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.owner_user_id <> OLD.owner_user_id
    OR NEW.storage_key <> OLD.storage_key OR NEW.mime_type <> OLD.mime_type
    OR NEW.size_bytes <> OLD.size_bytes OR NEW.sha256 <> OLD.sha256
    OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at
    OR OLD.state <> 'staged' OR NEW.state NOT IN ('attached', 'discarded') THEN
    RAISE EXCEPTION 'Invalid FIN receipt update' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fin_receipt_update BEFORE UPDATE OR DELETE ON fin_receipts
  FOR EACH ROW EXECUTE FUNCTION fin_receipt_guard();
CREATE TRIGGER fin_receipt_no_truncate BEFORE TRUNCATE ON fin_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION fin_immutable();

CREATE FUNCTION fin_receipt_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workspace_memberships
    WHERE workspace_id = NEW.workspace_id AND user_id = NEW.owner_user_id
      AND role = 'owner' AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIN Owner membership required' USING ERRCODE = '23514'; END IF;
  IF NEW.state <> 'staged' OR NEW.attached_at IS NOT NULL THEN
    RAISE EXCEPTION 'FIN receipt must start staged' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fin_receipt_insert BEFORE INSERT ON fin_receipts
  FOR EACH ROW EXECUTE FUNCTION fin_receipt_insert_guard();

ALTER TABLE fin_entries
  ADD COLUMN occurred_at timestamptz NULL,
  ADD COLUMN occurred_at_source text NOT NULL DEFAULT 'legacy_date_only'
    CHECK (occurred_at_source IN ('legacy_date_only', 'auto', 'manual', 'receipt_confirmed')),
  ADD COLUMN receipt_id uuid NULL,
  ADD CONSTRAINT fin_entries_time_pair CHECK (
    (occurred_at_source = 'legacy_date_only' AND occurred_at IS NULL)
    OR (occurred_at_source <> 'legacy_date_only' AND occurred_at IS NOT NULL
      AND (occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = occurred_on)
  ),
  ADD CONSTRAINT fin_entries_receipt_fk FOREIGN KEY (workspace_id, owner_user_id, receipt_id)
    REFERENCES fin_receipts (workspace_id, owner_user_id, id) ON DELETE RESTRICT;
CREATE INDEX fin_entries_receipt ON fin_entries (workspace_id, owner_user_id, receipt_id) WHERE receipt_id IS NOT NULL;

-- Replaces the 0014 function body; adds non-future time and receipt checks.
CREATE OR REPLACE FUNCTION fin_entry_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category fin_categories%ROWTYPE; receipt fin_receipts%ROWTYPE;
BEGIN
  PERFORM 1 FROM workspace_memberships
    WHERE workspace_id = NEW.workspace_id AND user_id = NEW.owner_user_id
      AND role = 'owner' AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIN Owner membership required' USING ERRCODE = '23514'; END IF;
  SELECT * INTO category FROM fin_categories WHERE workspace_id = NEW.workspace_id
    AND owner_user_id = NEW.owner_user_id AND id = NEW.category_id FOR SHARE;
  IF NOT FOUND OR NOT category.is_active OR category.direction <> NEW.direction
    OR category.name <> NEW.category_name_snapshot THEN
    RAISE EXCEPTION 'Invalid FIN category' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision_number > 1 THEN
    PERFORM 1 FROM fin_entries WHERE workspace_id = NEW.workspace_id AND owner_user_id = NEW.owner_user_id
      AND id = NEW.root_entry_id AND revision_number = 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid FIN root' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.occurred_at IS NOT NULL AND NEW.occurred_at > clock_timestamp() + interval '1 minute' THEN
    RAISE EXCEPTION 'FIN time cannot be in the future' USING ERRCODE = '23514';
  END IF;
  IF NEW.receipt_id IS NOT NULL THEN
    SELECT * INTO receipt FROM fin_receipts WHERE workspace_id = NEW.workspace_id
      AND owner_user_id = NEW.owner_user_id AND id = NEW.receipt_id FOR SHARE;
    IF NOT FOUND OR receipt.state <> 'attached' THEN
      RAISE EXCEPTION 'Invalid FIN receipt' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM fin_entries WHERE workspace_id = NEW.workspace_id AND owner_user_id = NEW.owner_user_id
      AND receipt_id = NEW.receipt_id AND root_entry_id <> NEW.root_entry_id;
    IF FOUND THEN RAISE EXCEPTION 'FIN receipt already used' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Replaces the 0014 function body: a time-only or receipt-only change is a valid correction.
CREATE OR REPLACE FUNCTION fin_revision_pair_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original fin_entries%ROWTYPE; replacement fin_entries%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'fin_entries' THEN
    IF NEW.revision_number = 1 THEN RETURN NULL; END IF;
    PERFORM 1 FROM fin_entry_corrections WHERE workspace_id = NEW.workspace_id AND owner_user_id = NEW.owner_user_id
      AND root_entry_id = NEW.root_entry_id AND replacement_revision_id = NEW.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'FIN replacement needs correction' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT * INTO STRICT original FROM fin_entries WHERE id = NEW.original_revision_id;
    SELECT * INTO STRICT replacement FROM fin_entries WHERE id = NEW.replacement_revision_id;
    IF replacement.revision_number <> original.revision_number + 1
      OR replacement.root_entry_id <> original.root_entry_id THEN
      RAISE EXCEPTION 'Invalid FIN revision sequence' USING ERRCODE = '23514';
    END IF;
    IF ROW(original.direction, original.category_id, original.amount_vnd, original.occurred_on, original.note,
        original.occurred_at, original.occurred_at_source, original.receipt_id)
      IS NOT DISTINCT FROM ROW(replacement.direction, replacement.category_id, replacement.amount_vnd, replacement.occurred_on, replacement.note,
        replacement.occurred_at, replacement.occurred_at_source, replacement.receipt_id) THEN
      RAISE EXCEPTION 'FIN correction has no change' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON fin_receipts FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fin_receipt_guard(), fin_receipt_insert_guard() FROM PUBLIC;
`;

export const FIN_PLAN_SQL = `-- FIN-PLAN-MVP. Additive private Owner plan ("Ke hoach thu chi co dinh").
-- Independent from fin_entries: a plan item is a monthly estimate, never a ledger transaction.
-- 0014/0015 are applied history and are not modified. Amounts are exact bigint VND (no floats).
-- Upper bound 9,999,999,999,999 per item keeps every sum and the weekly conversion far below bigint limits.
CREATE TABLE fin_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('income', 'expense')),
  category_id uuid NOT NULL,
  amount_vnd bigint NOT NULL CHECK (amount_vnd BETWEEN 1 AND 9999999999999),
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, owner_user_id)
    REFERENCES workspace_memberships (workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, owner_user_id, direction, category_id)
    REFERENCES fin_categories (workspace_id, owner_user_id, direction, id) ON DELETE RESTRICT
);
CREATE INDEX fin_plan_items_owner
  ON fin_plan_items (workspace_id, owner_user_id, direction, is_active, created_at, id);
`;

export const ATTENDANCE_VERSION_IMMUTABLE_SQL = `-- Migration: 0017_attendance_version_immutable
-- Enforce the existing ATT contract: corrections append versions, never rewrite history.
-- No data rewrite. Apply only through the normal migration gate.
CREATE OR REPLACE FUNCTION prevent_attendance_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'attendance_shift_versions is immutable: % prohibited', TG_OP;
END;
$$;

CREATE TRIGGER attendance_version_immutable
  BEFORE UPDATE OR DELETE ON attendance_shift_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_version_mutation();
`;

export const AUDIT_EVENTS_IMMUTABLE_SQL = `-- Migration: 0018_audit_events_immutable
-- AUDIT-005: refresh the append-only guard without rewriting historical rows.
-- The migrator applies this DDL atomically. Existing migration checksums stay unchanged.
CREATE OR REPLACE FUNCTION prevent_audit_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % operation prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
CREATE TRIGGER trg_audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_events_mutation();
`;

export const PASSWORD_RESET_TOKENS_SQL = `-- Migration: 0019_password_reset_tokens
-- Scope: AUTH Password Reset Flow (CSPRNG single-use token, 15m TTL, SHA-256 hash storage)

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  request_ip text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_password_reset_token_hash UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_lookup
  ON password_reset_tokens (user_id, consumed_at, expires_at);
`;

export const EMAIL_VERIFICATION_SQL = `-- Migration: 0020_email_verification
-- Scope: Email verification status and verifiable ownership proofs

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_proof text NULL;

CREATE TABLE IF NOT EXISTS email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_normalized text NOT NULL,
  token_hash text NOT NULL,
  proof_type text NOT NULL DEFAULT 'token_confirmation',
  proof_metadata jsonb NULL,
  verified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_email_verifications_token UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS ix_email_verifications_user
  ON email_verifications (user_id, verified_at);
`;

export const M11_BUG_AI_MANAGEMENT_SQL = `-- Migration: 0021_m11_bug_ai_management
-- Scope: Tích hợp Gemini AI và quản lý vòng đời Bug tự động
-- Authoritative: Owner yêu cầu hệ thống tự động Báo lỗi -> Gemini phân tích -> Fix -> Test -> Deploy -> Tự đánh dấu Fixed/Reopened

-- 1. Create sequence for bug codes (BUG-0001, BUG-0002, etc.)
CREATE SEQUENCE IF NOT EXISTS issue_bug_code_seq START WITH 1 INCREMENT BY 1;

-- 2. Add columns to issues
ALTER TABLE issues ADD COLUMN IF NOT EXISTS bug_code varchar(32) NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'P2';
ALTER TABLE issues ADD COLUMN IF NOT EXISTS gemini_analysis jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS github_issue_number integer NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS github_issue_url text NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS pr_number integer NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS deploy_sha varchar(64) NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS test_result text NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS metadata_context jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS screenshot_url text NULL;

-- 3. Backfill bug_code for existing issues
UPDATE issues
SET bug_code = format('BUG-%s', lpad(nextval('issue_bug_code_seq')::text, 4, '0'))
WHERE bug_code IS NULL;

-- 4. Set default and unique constraint on bug_code
ALTER TABLE issues ALTER COLUMN bug_code SET DEFAULT format('BUG-%s', lpad(nextval('issue_bug_code_seq')::text, 4, '0'));
ALTER TABLE issues ALTER COLUMN bug_code SET NOT NULL;
ALTER TABLE issues DROP CONSTRAINT IF EXISTS uq_issues_bug_code;
ALTER TABLE issues ADD CONSTRAINT uq_issues_bug_code UNIQUE (bug_code);

-- 5. Update status check constraint to support the full automated lifecycle:
-- OPEN -> ANALYZING -> FIXING -> TESTING -> DEPLOYING -> VERIFYING -> FIXED, REOPENED, WAITING_FOR_OWNER (and legacy awaiting_owner, closed)
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_status_check;
ALTER TABLE issues ADD CONSTRAINT issues_status_check
  CHECK (status IN (
    'open',
    'analyzing',
    'fixing',
    'testing',
    'deploying',
    'verifying',
    'fixed',
    'reopened',
    'waiting_for_owner',
    'awaiting_owner',
    'closed'
  ));

-- 6. Add check constraints for severity, test_result, and reopen_count
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_severity_check;
ALTER TABLE issues ADD CONSTRAINT issues_severity_check
  CHECK (severity IN ('P0', 'P1', 'P2', 'P3'));

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_test_result_check;
ALTER TABLE issues ADD CONSTRAINT issues_test_result_check
  CHECK (test_result IS NULL OR test_result IN ('pending', 'passed', 'failed', 'manual'));

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_reopen_count_check;
ALTER TABLE issues ADD CONSTRAINT issues_reopen_count_check
  CHECK (reopen_count >= 0);

-- 7. Update issue_activity actions check constraint
ALTER TABLE issue_activity DROP CONSTRAINT IF EXISTS issue_activity_action_check;
ALTER TABLE issue_activity ADD CONSTRAINT issue_activity_action_check
  CHECK (action IN (
    'created',
    'edited',
    'status_changed',
    'fix_confirmed',
    'reopened',
    'gemini_analyzed',
    'pr_linked',
    'deploy_linked',
    'test_verified',
    'marked_fixed',
    'waiting_owner'
  ));

-- 8. Useful indexes
CREATE INDEX IF NOT EXISTS idx_issues_severity ON issues (workspace_id, severity);
CREATE INDEX IF NOT EXISTS idx_issues_deploy_sha ON issues (deploy_sha);

-- 9. Grant sequence permissions safely to hp_app_test if role exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_test') THEN
    GRANT USAGE, SELECT ON SEQUENCE issue_bug_code_seq TO hp_app_test;
  END IF;
END $$;
`;

export const WORK_SCHEDULE_LINKS_SQL =
  "-- Stable links to the employee's registered date, not replaceable entry IDs.\n-- Deferred date FK permits existing schedule revision delete/reinsert in one transaction.\nALTER TABLE work_assignments ADD CONSTRAINT uq_work_assignment_employee UNIQUE(workspace_id,id,employee_id);\nALTER TABLE staff_schedules ADD CONSTRAINT uq_schedule_employee_identity UNIQUE(workspace_id,id,employee_id);\nALTER TABLE staff_schedule_entries ADD CONSTRAINT uq_schedule_entry_workspace_date UNIQUE(workspace_id,schedule_id,work_date);\nCREATE TABLE work_schedule_links (\n  workspace_id uuid NOT NULL,\n  assignment_id uuid NOT NULL,\n  employee_id uuid NOT NULL,\n  schedule_id uuid NOT NULL,\n  work_date date NOT NULL,\n  linked_by uuid NOT NULL REFERENCES users(id),\n  linked_at timestamptz NOT NULL DEFAULT now(),\n  PRIMARY KEY(workspace_id,assignment_id,work_date),\n  FOREIGN KEY(workspace_id,assignment_id,employee_id) REFERENCES work_assignments(workspace_id,id,employee_id) ON DELETE RESTRICT,\n  FOREIGN KEY(workspace_id,schedule_id,employee_id) REFERENCES staff_schedules(workspace_id,id,employee_id) ON DELETE RESTRICT,\n  CONSTRAINT fk_work_schedule_registered_date FOREIGN KEY(workspace_id,schedule_id,work_date) REFERENCES staff_schedule_entries(workspace_id,schedule_id,work_date) DEFERRABLE INITIALLY DEFERRED\n);\nCREATE INDEX ix_work_schedule_date ON work_schedule_links(workspace_id,schedule_id,work_date);\n";

export const AUTH_SESSION_REMEMBER_ME_SQL = `-- Persist session intent; duration is not evidence of Remember Me consent.
-- NULL deliberately marks legacy/unknown sessions. Auth fails closed for these
-- rows until a fresh login issues an explicit true/false value. No guessed backfill.
ALTER TABLE auth_sessions ADD COLUMN remember_me boolean;
`;

export const ACCOUNTS_ENHANCEMENT_SQL = `-- Migration: 0024_accounts_enhancement
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
`;

export const STORAGE_GOOGLE_DRIVE_V2_SQL = `-- Migration: 0025_storage_google_drive_v2
-- Scope: FILE-01 / FILE-02 Direct Google Drive API v3 Integration (OAuth 2.0 encrypted connection,
-- direct Drive folder creation metadata, resumable video upload sessions, email-based
-- reader/writer permission grants with inheritance tracking, and non-destructive record detach).

CREATE TABLE IF NOT EXISTS storage_drive_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'connected', 'disconnected', 'revoked', 'error')),
  google_email text NOT NULL,
  display_name text NULL,
  scope text NOT NULL DEFAULT 'https://www.googleapis.com/auth/drive.file',
  scopes text[] NOT NULL DEFAULT ARRAY['https://www.googleapis.com/auth/drive.file'],
  root_folder_id text NULL,
  root_folder_url text NULL,
  root_drive_folder_id text NULL,
  root_drive_folder_url text NULL,
  refresh_token_ciphertext bytea NULL,
  refresh_token_nonce bytea NULL,
  refresh_token_auth_tag bytea NULL,
  refresh_token_tag bytea NULL,
  ciphertext bytea NULL,
  nonce bytea NULL,
  auth_tag bytea NULL,
  key_version text NOT NULL DEFAULT 'v1',
  encryption_schema_version integer NOT NULL DEFAULT 1,
  connected_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  connected_by_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  connected_at timestamptz NULL DEFAULT clock_timestamp(),
  disconnected_at timestamptz NULL,
  last_synced_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_storage_drive_connections_workspace UNIQUE (workspace_id)
);

ALTER TABLE storage_drive_connections
  ADD COLUMN IF NOT EXISTS display_name text NULL,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'https://www.googleapis.com/auth/drive.file',
  ADD COLUMN IF NOT EXISTS root_folder_id text NULL,
  ADD COLUMN IF NOT EXISTS root_folder_url text NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_ciphertext bytea NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_nonce bytea NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_auth_tag bytea NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_tag bytea NULL,
  ADD COLUMN IF NOT EXISTS connected_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disconnected_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE storage_drive_connections
  ALTER COLUMN connected_by_user_id DROP NOT NULL,
  ALTER COLUMN ciphertext DROP NOT NULL,
  ALTER COLUMN nonce DROP NOT NULL,
  ALTER COLUMN auth_tag DROP NOT NULL;

ALTER TABLE storage_drive_connections
  DROP CONSTRAINT IF EXISTS storage_drive_connections_status_check;

ALTER TABLE storage_drive_connections
  ADD CONSTRAINT storage_drive_connections_status_check
  CHECK (status IN ('active', 'connected', 'disconnected', 'revoked', 'error'));

CREATE INDEX IF NOT EXISTS idx_storage_drive_connections_workspace
  ON storage_drive_connections (workspace_id, status);

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS google_email text NULL;

ALTER TABLE storage_folders
  ADD COLUMN IF NOT EXISTS provider_parent_id text NULL,
  ADD COLUMN IF NOT EXISTS drive_owner_email text NULL,
  ADD COLUMN IF NOT EXISTS drive_created_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'active';

ALTER TABLE storage_folders
  DROP CONSTRAINT IF EXISTS storage_folders_record_status_check;

ALTER TABLE storage_folders
  ADD CONSTRAINT storage_folders_record_status_check
  CHECK (record_status IN ('active', 'detached'));

ALTER TABLE storage_files
  ADD COLUMN IF NOT EXISTS drive_url text NULL,
  ADD COLUMN IF NOT EXISTS web_view_link text NULL,
  ADD COLUMN IF NOT EXISTS parent_provider_folder_id text NULL,
  ADD COLUMN IF NOT EXISTS drive_owner_email text NULL,
  ADD COLUMN IF NOT EXISTS drive_created_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS upload_session_id text NULL,
  ADD COLUMN IF NOT EXISTS resumable_session_uri text NULL,
  ADD COLUMN IF NOT EXISTS uploaded_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_progress_pct integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS upload_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_error_message text NULL,
  ADD COLUMN IF NOT EXISTS last_error text NULL,
  ADD COLUMN IF NOT EXISTS assigned_employee_id uuid NULL,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS review_notes text NULL,
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS storage_files_status_check;

ALTER TABLE storage_files
  ADD CONSTRAINT storage_files_status_check
  CHECK (status IN ('available', 'active', 'uploading', 'paused', 'failed', 'deleted', 'trashed', 'detached'));

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS storage_files_upload_status_check;

ALTER TABLE storage_files
  ADD CONSTRAINT storage_files_upload_status_check
  CHECK (upload_status IN ('pending', 'resumable_session_created', 'initiated', 'uploading', 'paused', 'interrupted', 'completed', 'failed'));

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS storage_files_uploaded_bytes_check;

ALTER TABLE storage_files
  ADD CONSTRAINT storage_files_uploaded_bytes_check
  CHECK (uploaded_bytes >= 0);

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS storage_files_retry_count_check;

ALTER TABLE storage_files
  ADD CONSTRAINT storage_files_retry_count_check
  CHECK (retry_count >= 0 AND upload_retry_count >= 0);

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS storage_files_review_status_check;

ALTER TABLE storage_files
  ADD CONSTRAINT storage_files_review_status_check
  CHECK (review_status IN ('pending_review', 'unreviewed', 'approved', 'rejected'));

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS fk_storage_files_assigned_employee;

ALTER TABLE storage_files
  ADD CONSTRAINT fk_storage_files_assigned_employee
  FOREIGN KEY (workspace_id, assigned_employee_id)
  REFERENCES employees (workspace_id, id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_storage_files_workspace_assignee
  ON storage_files (workspace_id, assigned_employee_id);

ALTER TABLE resource_access_grants
  DROP CONSTRAINT IF EXISTS fk_resource_access_grants_folder;

ALTER TABLE resource_access_grants
  DROP CONSTRAINT IF EXISTS resource_access_grants_resource_type_check;

ALTER TABLE resource_access_grants
  ADD CONSTRAINT resource_access_grants_resource_type_check
  CHECK (resource_type IN ('storage_folder', 'storage_file'));

ALTER TABLE resource_access_grants
  ADD COLUMN IF NOT EXISTS google_email text NULL,
  ADD COLUMN IF NOT EXISTS drive_role text NOT NULL DEFAULT 'reader',
  ADD COLUMN IF NOT EXISTS drive_permission_id text NULL,
  ADD COLUMN IF NOT EXISTS inherited_from_resource_id uuid NULL,
  ADD COLUMN IF NOT EXISTS granted_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS granted_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS revoked_by uuid NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE resource_access_grants
  DROP CONSTRAINT IF EXISTS resource_access_grants_drive_role_check;

ALTER TABLE resource_access_grants
  ADD CONSTRAINT resource_access_grants_drive_role_check
  CHECK (drive_role IN ('reader', 'writer', 'commenter'));

ALTER TABLE storage_operations
  DROP CONSTRAINT IF EXISTS storage_operations_operation_type_check;

ALTER TABLE storage_operations
  ADD CONSTRAINT storage_operations_operation_type_check
  CHECK (operation_type IN ('trash_group', 'restore_group', 'sync_metadata', 'create_folder', 'upload_video', 'grant_permission', 'revoke_permission'));
`;

export const TIMESHEET_IMPORT_SQL = `-- Migration: 0027_timesheet_import
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
`;

export const SYSTEM_LOGS_SQL = `-- Migration: 0028_system_logs
-- Scope: Operational system log (API errors, slow requests, browser errors) for the Owner log console.
-- Not append-only: rows older than the retention window are purged by the application.

CREATE TABLE IF NOT EXISTS system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  source text NOT NULL CHECK (source IN ('api', 'web')),
  workspace_id uuid NULL,
  user_id uuid NULL,
  request_id text NULL,
  method text NULL,
  route text NULL,
  status integer NULL,
  duration_ms integer NULL,
  error_code text NULL,
  message text NOT NULL,
  stack text NULL,
  fingerprint text NOT NULL,
  release text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_system_logs_time ON system_logs (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_system_logs_level_time ON system_logs (level, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_system_logs_request ON system_logs (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_system_logs_fingerprint ON system_logs (fingerprint, occurred_at DESC);
`;

export const REPORT_ENTRY_WORK_ITEM_SQL = `-- Migration: 0029_report_entry_work_item
-- Scope: optional link from a daily report entry to the work item it reports on.

ALTER TABLE daily_report_entries
  ADD COLUMN IF NOT EXISTS work_item_id uuid NULL;

ALTER TABLE daily_report_entries
  DROP CONSTRAINT IF EXISTS fk_daily_report_entries_work_item;

ALTER TABLE daily_report_entries
  ADD CONSTRAINT fk_daily_report_entries_work_item
  FOREIGN KEY (workspace_id, work_item_id)
  REFERENCES work_items (workspace_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_daily_report_entries_work_item
  ON daily_report_entries (workspace_id, work_item_id)
  WHERE work_item_id IS NOT NULL;
`;

export const USER_PROFILE_PHONE_SQL = `-- Migration: 0026_user_profile_phone
-- Scope: Self-service profile editing (phone number on employee profile).

ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone text NULL;
`;

export const EMPLOYEE_PROFILE_AND_BANK_INFO_SQL = `-- Migration: 0030_employee_profile_and_bank_info
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
`;

export const ACCOUNTS_ECOSYSTEM_HIERARCHY_SQL = `-- Migration: 0031_accounts_ecosystem_hierarchy
-- Scope: ACC-ECOSYSTEM v0.6.0 — 4-Tier Account Hierarchy (Phone/SIM -> Root Gmail -> TikTok/FB/YTB + Google Authenticator + Recovery Account), Health Status, and Encrypted Secret History.

ALTER TABLE managed_accounts
  DROP CONSTRAINT IF EXISTS managed_accounts_platform_check;

ALTER TABLE managed_accounts
  ADD CONSTRAINT managed_accounts_platform_check
  CHECK (platform IN ('tiktok', 'gmail', 'facebook', 'youtube', 'authenticator', 'recovery', 'ai', 'pm', 'other'));

ALTER TABLE managed_accounts
  ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'healthy',
  ADD COLUMN IF NOT EXISTS phone_number text NULL,
  ADD COLUMN IF NOT EXISTS phone_note text NULL,
  ADD COLUMN IF NOT EXISTS parent_account_id uuid NULL,
  ADD COLUMN IF NOT EXISTS recovery_account_id uuid NULL,
  ADD COLUMN IF NOT EXISTS authenticator_account_id uuid NULL;

ALTER TABLE managed_accounts
  DROP CONSTRAINT IF EXISTS managed_accounts_health_status_check;

ALTER TABLE managed_accounts
  ADD CONSTRAINT managed_accounts_health_status_check
  CHECK (health_status IN ('healthy', 'verify_required', 'locked'));

ALTER TABLE managed_accounts
  DROP CONSTRAINT IF EXISTS ck_managed_accounts_no_self_parent,
  DROP CONSTRAINT IF EXISTS ck_managed_accounts_no_self_recovery,
  DROP CONSTRAINT IF EXISTS ck_managed_accounts_no_self_authenticator;

ALTER TABLE managed_accounts
  ADD CONSTRAINT ck_managed_accounts_no_self_parent CHECK (parent_account_id IS DISTINCT FROM id),
  ADD CONSTRAINT ck_managed_accounts_no_self_recovery CHECK (recovery_account_id IS DISTINCT FROM id),
  ADD CONSTRAINT ck_managed_accounts_no_self_authenticator CHECK (authenticator_account_id IS DISTINCT FROM id);

ALTER TABLE managed_accounts
  DROP CONSTRAINT IF EXISTS fk_managed_accounts_parent_account,
  DROP CONSTRAINT IF EXISTS fk_managed_accounts_recovery_account,
  DROP CONSTRAINT IF EXISTS fk_managed_accounts_authenticator_account;

ALTER TABLE managed_accounts
  ADD CONSTRAINT fk_managed_accounts_parent_account
    FOREIGN KEY (parent_account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT fk_managed_accounts_recovery_account
    FOREIGN KEY (recovery_account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT fk_managed_accounts_authenticator_account
    FOREIGN KEY (authenticator_account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_phone
  ON managed_accounts (workspace_id, phone_number)
  WHERE phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_parent
  ON managed_accounts (workspace_id, parent_account_id)
  WHERE parent_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_recovery
  ON managed_accounts (workspace_id, recovery_account_id)
  WHERE recovery_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_authenticator
  ON managed_accounts (workspace_id, authenticator_account_id)
  WHERE authenticator_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_secret_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  secret_type text NOT NULL CHECK (secret_type IN ('password', 'api_key', 'recovery_code', 'totp_secret', 'two_fa_secret', 'email_password')),
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version text NOT NULL DEFAULT 'v1',
  encryption_schema_version integer NOT NULL DEFAULT 1 CHECK (encryption_schema_version >= 1),
  secret_version integer NOT NULL DEFAULT 1 CHECK (secret_version >= 1),
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_account_secret_history_account
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_account_secret_history_lookup
  ON account_secret_history (workspace_id, account_id, archived_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON account_secret_history TO hp_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_test') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON account_secret_history TO hp_app_test;
  END IF;
END $$;
`;

export const EMPLOYEE_SUB_PERMISSIONS_SQL = `-- Migration: 0032_employee_sub_permissions
-- Scope: Sub-Admin role (sub_role) and granular delegated permissions (sub_permissions) on employees.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS sub_role text NULL,
  ADD COLUMN IF NOT EXISTS sub_permissions jsonb NOT NULL DEFAULT '[]'::jsonb;
`;

export const PRINTQUOTE_V1_SQL = `-- Migration: 0033_printquote_v1
-- Scope: Additive tables for MGL-PRINTQUOTE V1 (vendors, price catalog, customers, quotes, quote versions, orders, order payments).

CREATE TABLE IF NOT EXISTS print_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  phone text NULL,
  address text NULL,
  bank_name text NULL,
  bank_account_number text NULL,
  bank_account_holder text NULL,
  note text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_vendors_workspace_code UNIQUE (workspace_id, code)
);

CREATE INDEX IF NOT EXISTS idx_print_vendors_workspace
  ON print_vendors (workspace_id, is_active, name);

CREATE TABLE IF NOT EXISTS print_vendor_price_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES print_vendors(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  category text NULL,
  specification text NULL,
  unit text NOT NULL DEFAULT 'tờ',
  pricing_mode text NOT NULL DEFAULT 'PER_UNIT' CHECK (pricing_mode IN ('PER_UNIT', 'TOTAL_BATCH')),
  unit_cost bigint NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  batch_quantity integer NOT NULL DEFAULT 1 CHECK (batch_quantity > 0),
  batch_total_cost bigint NOT NULL DEFAULT 0 CHECK (batch_total_cost >= 0),
  default_profit_mode text NOT NULL DEFAULT 'FIXED_AMOUNT' CHECK (default_profit_mode IN ('FIXED_AMOUNT', 'PERCENTAGE')),
  default_profit_scope text NOT NULL DEFAULT 'PER_UNIT' CHECK (default_profit_scope IN ('PER_UNIT', 'TOTAL_BATCH')),
  default_profit_value numeric(12,2) NOT NULL DEFAULT 0 CHECK (default_profit_value >= 0),
  note text NULL,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_vendor_price_items_workspace_code UNIQUE (workspace_id, vendor_id, code)
);

CREATE INDEX IF NOT EXISTS idx_print_vendor_price_items_lookup
  ON print_vendor_price_items (workspace_id, vendor_id, is_active);

CREATE TABLE IF NOT EXISTS print_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  company_name text NULL,
  phone text NULL,
  email text NULL,
  address text NULL,
  tax_code text NULL,
  note text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_customers_workspace_code UNIQUE (workspace_id, code)
);

CREATE INDEX IF NOT EXISTS idx_print_customers_workspace
  ON print_customers (workspace_id, is_active, name);

CREATE TABLE IF NOT EXISTS print_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_code text NOT NULL,
  title text NOT NULL,
  customer_id uuid NULL REFERENCES print_customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text NULL,
  customer_address text NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'APPROVED', 'FINALIZED', 'CONVERTED', 'CANCELLED')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  include_shipping_in_unit_price boolean NOT NULL DEFAULT true,
  shipping_allocation_strategy text NOT NULL DEFAULT 'PROPORTIONAL_BY_BASE_AMOUNT' CHECK (shipping_allocation_strategy IN ('PROPORTIONAL_BY_BASE_AMOUNT', 'PROPORTIONAL_BY_QUANTITY', 'EQUAL_SPLIT')),
  rounding_mode text NOT NULL DEFAULT 'NEAREST' CHECK (rounding_mode IN ('NEAREST', 'FLOOR', 'CEIL')),
  rounding_step integer NOT NULL DEFAULT 1 CHECK (rounding_step > 0),
  total_quantity integer NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  total_vendor_cost bigint NOT NULL DEFAULT 0 CHECK (total_vendor_cost >= 0),
  total_profit bigint NOT NULL DEFAULT 0 CHECK (total_profit >= 0),
  shipping_fee bigint NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  total_extra_cost bigint NOT NULL DEFAULT 0 CHECK (total_extra_cost >= 0),
  total_quote_amount bigint NOT NULL DEFAULT 0 CHECK (total_quote_amount >= 0),
  total_rounding_adjustment bigint NOT NULL DEFAULT 0,
  single_product_final_unit_price bigint NULL,
  lines_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot_json jsonb NOT NULL,
  customer_pdf_json jsonb NOT NULL,
  integrity_hash text NOT NULL,
  valid_until date NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  finalized_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_quotes_workspace_code UNIQUE (workspace_id, quote_code)
);

CREATE INDEX IF NOT EXISTS idx_print_quotes_workspace_created
  ON print_quotes (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS print_quote_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES print_quotes(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number >= 1),
  status text NOT NULL,
  total_quantity integer NOT NULL DEFAULT 0,
  total_vendor_cost bigint NOT NULL DEFAULT 0,
  total_profit bigint NOT NULL DEFAULT 0,
  shipping_fee bigint NOT NULL DEFAULT 0,
  total_extra_cost bigint NOT NULL DEFAULT 0,
  total_quote_amount bigint NOT NULL DEFAULT 0,
  total_rounding_adjustment bigint NOT NULL DEFAULT 0,
  snapshot_json jsonb NOT NULL,
  customer_pdf_json jsonb NOT NULL,
  integrity_hash text NOT NULL,
  change_note text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_quote_versions_number UNIQUE (quote_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_print_quote_versions_lookup
  ON print_quote_versions (workspace_id, quote_id, version_number DESC);

CREATE TABLE IF NOT EXISTS print_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  order_code text NOT NULL,
  quote_id uuid NOT NULL REFERENCES print_quotes(id) ON DELETE RESTRICT,
  quote_code text NOT NULL,
  quote_version integer NOT NULL DEFAULT 1,
  customer_id uuid NULL REFERENCES print_customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text NULL,
  customer_address text NULL,
  vendor_id uuid NULL REFERENCES print_vendors(id) ON DELETE SET NULL,
  vendor_name text NULL,
  title text NOT NULL,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  print_ordered_at date NULL,
  due_date date NULL,
  completed_at timestamptz NULL,
  delivered_at timestamptz NULL,
  production_status text NOT NULL DEFAULT 'PENDING' CHECK (production_status IN ('PENDING', 'PREPRESS', 'PRINTING', 'FINISHING', 'COMPLETED', 'CANCELLED')),
  delivery_status text NOT NULL DEFAULT 'NOT_SHIPPED' CHECK (delivery_status IN ('NOT_SHIPPED', 'PACKING', 'SHIPPING', 'DELIVERED', 'RETURNED')),
  payment_status text NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'PAID')),
  total_quote_amount bigint NOT NULL DEFAULT 0 CHECK (total_quote_amount >= 0),
  expected_vendor_cost bigint NOT NULL DEFAULT 0 CHECK (expected_vendor_cost >= 0),
  expected_shipping_fee bigint NOT NULL DEFAULT 0 CHECK (expected_shipping_fee >= 0),
  expected_extra_cost bigint NOT NULL DEFAULT 0 CHECK (expected_extra_cost >= 0),
  expected_profit bigint NOT NULL DEFAULT 0,
  actual_vendor_cost bigint NOT NULL DEFAULT 0 CHECK (actual_vendor_cost >= 0),
  actual_shipping_fee bigint NOT NULL DEFAULT 0 CHECK (actual_shipping_fee >= 0),
  actual_extra_cost bigint NOT NULL DEFAULT 0 CHECK (actual_extra_cost >= 0),
  actual_profit bigint NOT NULL DEFAULT 0,
  deposit_required bigint NOT NULL DEFAULT 0 CHECK (deposit_required >= 0),
  deposit_paid bigint NOT NULL DEFAULT 0 CHECK (deposit_paid >= 0),
  total_paid_amount bigint NOT NULL DEFAULT 0 CHECK (total_paid_amount >= 0),
  remaining_debt_amount bigint NOT NULL DEFAULT 0 CHECK (remaining_debt_amount >= 0),
  snapshot_json jsonb NOT NULL,
  integrity_hash text NOT NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_orders_workspace_code UNIQUE (workspace_id, order_code),
  CONSTRAINT uq_print_orders_workspace_quote UNIQUE (workspace_id, quote_id)
);

CREATE INDEX IF NOT EXISTS idx_print_orders_workspace_created
  ON print_orders (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS print_code_counters (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  counter_key text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, counter_key)
);

CREATE TABLE IF NOT EXISTS print_order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES print_orders(id) ON DELETE CASCADE,
  payment_type text NOT NULL DEFAULT 'INSTALLMENT' CHECK (payment_type IN ('DEPOSIT', 'INSTALLMENT', 'FINAL', 'REFUND')),
  amount bigint NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'BANK_TRANSFER' CHECK (payment_method IN ('BANK_TRANSFER', 'CASH', 'QR_VIETQR', 'OTHER')),
  paid_at timestamptz NOT NULL DEFAULT now(),
  reference_code text NULL,
  note text NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_order_payments_order
  ON print_order_payments (workspace_id, order_id, paid_at ASC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      print_vendors,
      print_vendor_price_items,
      print_customers,
      print_quotes,
      print_quote_versions,
      print_orders,
      print_code_counters,
      print_order_payments
    TO hp_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_test') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      print_vendors,
      print_vendor_price_items,
      print_customers,
      print_quotes,
      print_quote_versions,
      print_orders,
      print_code_counters,
      print_order_payments
    TO hp_app_test;
  END IF;
END $$;
`;

export const PRINTQUOTE_WORKSHOP_STAGES_V2_SQL = `-- Migration: 0034_printquote_workshop_stages_v2
-- Scope: Additive PrintQuote V2 Workshop Pricing (BASE_PRINT vs FINISHING, optional vendor, PER_SQM area pricing,
--        included_stages anti-double-charge metadata, price item change history, and PENDING_COST draft state).
-- Zero sample/fake data is inserted. Existing quotes and price items remain 100% intact.

-- 1. Allow optional vendor_id (ON DELETE SET NULL) and expand print_vendor_price_items
ALTER TABLE print_vendor_price_items
  DROP CONSTRAINT IF EXISTS print_vendor_price_items_vendor_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_print_vendor_price_items_vendor;

ALTER TABLE print_vendor_price_items
  ALTER COLUMN vendor_id DROP NOT NULL;

ALTER TABLE print_vendor_price_items
  ADD CONSTRAINT fk_print_vendor_price_items_vendor
    FOREIGN KEY (vendor_id) REFERENCES print_vendors(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_print_vendor_price_items_workspace_general_code
  ON print_vendor_price_items (workspace_id, code)
  WHERE vendor_id IS NULL;

ALTER TABLE print_vendor_price_items
  DROP CONSTRAINT IF EXISTS print_vendor_price_items_pricing_mode_check,
  DROP CONSTRAINT IF EXISTS chk_print_vendor_price_items_pricing_mode,
  DROP CONSTRAINT IF EXISTS print_vendor_price_items_default_profit_scope_check,
  DROP CONSTRAINT IF EXISTS chk_print_vendor_price_items_default_profit_scope;

ALTER TABLE print_vendor_price_items
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'BASE_PRINT',
  ADD COLUMN IF NOT EXISTS included_stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS structured_spec jsonb NULL,
  ADD COLUMN IF NOT EXISTS conditions_note text NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE print_vendor_price_items
  DROP CONSTRAINT IF EXISTS chk_print_vendor_price_items_item_type;

ALTER TABLE print_vendor_price_items
  ADD CONSTRAINT chk_print_vendor_price_items_item_type
    CHECK (item_type IN ('BASE_PRINT', 'FINISHING')),
  ADD CONSTRAINT chk_print_vendor_price_items_pricing_mode
    CHECK (pricing_mode IN ('PER_UNIT', 'PER_SQM', 'TOTAL_BATCH')),
  ADD CONSTRAINT chk_print_vendor_price_items_default_profit_scope
    CHECK (default_profit_scope IN ('PER_UNIT', 'PER_SQM', 'TOTAL_BATCH'));

CREATE INDEX IF NOT EXISTS idx_print_vendor_price_items_type_active
  ON print_vendor_price_items (workspace_id, item_type, is_active);

-- 2. Immutable Workshop Price Change History (audit trail of who changed what and when)
CREATE TABLE IF NOT EXISTS print_vendor_price_item_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  price_item_id uuid NOT NULL REFERENCES print_vendor_price_items(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  action text NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'DEACTIVATED', 'RESTORED')),
  before_json jsonb NULL,
  after_json jsonb NOT NULL,
  change_note text NULL,
  changed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_vendor_price_item_history_lookup
  ON print_vendor_price_item_history (workspace_id, price_item_id, version DESC, changed_at DESC);

-- 3. Support "Chờ giá xưởng" (PENDING_COST) drafts on print_quotes and print_quote_versions
ALTER TABLE print_quotes
  ADD COLUMN IF NOT EXISTS pricing_status text NOT NULL DEFAULT 'COMPLETE',
  ADD COLUMN IF NOT EXISTS pending_cost_summary jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE print_quotes
  ALTER COLUMN customer_pdf_json DROP NOT NULL;

ALTER TABLE print_quotes
  DROP CONSTRAINT IF EXISTS chk_print_quotes_pricing_status;

ALTER TABLE print_quotes
  ADD CONSTRAINT chk_print_quotes_pricing_status
    CHECK (
      (pricing_status = 'COMPLETE' AND customer_pdf_json IS NOT NULL)
      OR (pricing_status = 'PENDING_COST' AND status = 'DRAFT')
    );

CREATE INDEX IF NOT EXISTS idx_print_quotes_pricing_status
  ON print_quotes (workspace_id, pricing_status, status);

ALTER TABLE print_quote_versions
  ADD COLUMN IF NOT EXISTS pricing_status text NOT NULL DEFAULT 'COMPLETE',
  ADD COLUMN IF NOT EXISTS pending_cost_summary jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE print_quote_versions
  ALTER COLUMN customer_pdf_json DROP NOT NULL;

ALTER TABLE print_quote_versions
  DROP CONSTRAINT IF EXISTS chk_print_quote_versions_pricing_status;

ALTER TABLE print_quote_versions
  ADD CONSTRAINT chk_print_quote_versions_pricing_status
    CHECK (
      (pricing_status = 'COMPLETE' AND customer_pdf_json IS NOT NULL)
      OR (pricing_status = 'PENDING_COST' AND status = 'DRAFT')
    );

-- 4. Grant table permissions across runtime/test DB roles
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['hp_app_runtime', 'hp_app_test', 'ml_app_runtime', 'ml_app_test', 'app_runtime', 'app_test']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON print_vendor_price_item_history, print_vendor_price_items, print_quotes, print_quote_versions TO %I',
        r
      );
    END IF;
  END LOOP;
END $$;
`;

const PRINTQUOTE_FINANCIAL_CONTROL_GATE_SQL = `-- Migration: 0035_printquote_financial_control_gate
-- Scope: Financial Control Gate for PrintQuote Orders — strictly separates
--        (1) expected quote costs (\`expected_*\`),
--        (2) operator-entered unconfirmed/confirmed actual costs (\`entered_*\`),
--        (3) reconciliation confirmation state (\`actual_cost_confirmed\`, \`cost_reconciliation_status\`),
--        (4) order-level paid-to-workshop note (\`vendor_paid_amount\`), and
--        (5) immutable audit history (\`print_order_cost_history\`).

ALTER TABLE print_orders
  ADD COLUMN IF NOT EXISTS actual_cost_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actual_cost_confirmed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS actual_cost_confirmed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entered_vendor_cost bigint NULL,
  ADD COLUMN IF NOT EXISTS entered_shipping_fee bigint NULL,
  ADD COLUMN IF NOT EXISTS entered_extra_cost bigint NULL,
  ADD COLUMN IF NOT EXISTS vendor_paid_amount bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'print_orders'
      AND column_name = 'cost_reconciliation_status'
  ) THEN
    ALTER TABLE print_orders
      ADD COLUMN cost_reconciliation_status text NOT NULL DEFAULT 'UNVERIFIED';

    -- Zero guesswork: preserve 100% of original legacy numbers untouched, keep
    -- actual_cost_confirmed = false, and place pre-0035 orders lacking confirmation
    -- evidence into NEEDS_REVIEW for explicit reconciliation.
    UPDATE print_orders
    SET cost_reconciliation_status = 'NEEDS_REVIEW'
    WHERE actual_cost_confirmed = false;
  END IF;
END $$;

ALTER TABLE print_orders
  DROP CONSTRAINT IF EXISTS chk_print_orders_vendor_paid_nonneg,
  DROP CONSTRAINT IF EXISTS chk_print_orders_entered_costs_nonneg,
  DROP CONSTRAINT IF EXISTS chk_print_orders_cost_reconciliation_status,
  DROP CONSTRAINT IF EXISTS chk_print_orders_confirmed_requires_all_entered;

ALTER TABLE print_orders
  ADD CONSTRAINT chk_print_orders_vendor_paid_nonneg
    CHECK (vendor_paid_amount >= 0),
  ADD CONSTRAINT chk_print_orders_entered_costs_nonneg
    CHECK (
      (entered_vendor_cost IS NULL OR entered_vendor_cost >= 0)
      AND (entered_shipping_fee IS NULL OR entered_shipping_fee >= 0)
      AND (entered_extra_cost IS NULL OR entered_extra_cost >= 0)
    ),
  ADD CONSTRAINT chk_print_orders_cost_reconciliation_status
    CHECK (
      cost_reconciliation_status IN (
        'UNVERIFIED',
        'NEEDS_REVIEW',
        'PARTIAL_ENTERED',
        'ENTERED_UNCONFIRMED',
        'CONFIRMED'
      )
    ),
  ADD CONSTRAINT chk_print_orders_confirmed_requires_all_entered
    CHECK (
      actual_cost_confirmed = false
      OR (
        cost_reconciliation_status = 'CONFIRMED'
        AND entered_vendor_cost IS NOT NULL
        AND entered_shipping_fee IS NOT NULL
        AND entered_extra_cost IS NOT NULL
      )
    );

CREATE TABLE IF NOT EXISTS print_order_cost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  order_id uuid NOT NULL,
  action text NOT NULL CHECK (
    action IN (
      'ENTERED',
      'CONFIRMED',
      'ADJUSTED',
      'UNCONFIRMED',
      'VENDOR_PAYMENT_NOTE'
    )
  ),
  before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text NULL,
  changed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_print_order_cost_history_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  CONSTRAINT fk_print_order_cost_history_order
    FOREIGN KEY (order_id) REFERENCES print_orders(id) ON DELETE RESTRICT
);

DO $$
DECLARE
  fk_rec record;
BEGIN
  FOR fk_rec IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'print_order_cost_history'::regclass
      AND c.contype = 'f'
      AND c.confdeltype = 'c'
  LOOP
    EXECUTE format(
      'ALTER TABLE print_order_cost_history DROP CONSTRAINT %I',
      fk_rec.conname
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'print_order_cost_history'::regclass
      AND conname = 'fk_print_order_cost_history_workspace'
  ) THEN
    ALTER TABLE print_order_cost_history
      ADD CONSTRAINT fk_print_order_cost_history_workspace
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'print_order_cost_history'::regclass
      AND conname = 'fk_print_order_cost_history_order'
  ) THEN
    ALTER TABLE print_order_cost_history
      ADD CONSTRAINT fk_print_order_cost_history_order
      FOREIGN KEY (order_id) REFERENCES print_orders(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- DB Guard: print_order_cost_history is strictly append-only (prohibit UPDATE, DELETE, TRUNCATE)
CREATE OR REPLACE FUNCTION prevent_print_order_cost_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'print_order_cost_history is append-only: % operation prohibited', TG_OP
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_print_order_cost_history_immutable ON print_order_cost_history;
CREATE TRIGGER trg_print_order_cost_history_immutable
  BEFORE UPDATE OR DELETE ON print_order_cost_history
  FOR EACH ROW EXECUTE FUNCTION prevent_print_order_cost_history_mutation();

DROP TRIGGER IF EXISTS trg_print_order_cost_history_no_truncate ON print_order_cost_history;
CREATE TRIGGER trg_print_order_cost_history_no_truncate
  BEFORE TRUNCATE ON print_order_cost_history
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_print_order_cost_history_mutation();

DROP INDEX IF EXISTS idx_print_orders_actual_confirmed;

CREATE INDEX IF NOT EXISTS idx_print_orders_actual_confirmed
  ON print_orders (workspace_id, actual_cost_confirmed, cost_reconciliation_status);

CREATE INDEX IF NOT EXISTS idx_print_order_cost_history_order
  ON print_order_cost_history (workspace_id, order_id, created_at DESC);

REVOKE ALL ON print_order_cost_history FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['hp_app_runtime', 'hp_app_test', 'ml_app_runtime', 'ml_app_test', 'app_runtime', 'app_test']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE ON print_orders TO %I',
        r
      );
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON print_order_cost_history FROM %I',
        r
      );
      EXECUTE format(
        'GRANT SELECT, INSERT ON print_order_cost_history TO %I',
        r
      );
    END IF;
  END LOOP;
END $$;
`;

const PRINTQUOTE_AR_AP_LEDGER_SQL = `-- Migration: 0036_printquote_ar_ap_ledger
-- Scope: Print-only AR (Customer Receivables), AP (Workshop Payables), Multi-Workshop Jobs,
--        Cancelled Order Settlement, Opening Balances & Historical Google Sheet Reconciliation.
-- Boundary: Strictly isolated inside print_* tables. Zero link or sync with /finance (fin_*).

-- ============================================================================
-- 1. ADDITIVE COLUMNS ON print_orders
-- ============================================================================

ALTER TABLE print_orders
  ADD COLUMN IF NOT EXISTS ledger_scope text NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS net_ar_adjustment_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valid_receivable_amount bigint NULL,
  ADD COLUMN IF NOT EXISTS cancellation_settlement_status text NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN IF NOT EXISTS agreed_customer_refund_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_after_cancel_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retained_cancellation_fee bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_vendor_paid_reconciled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS legacy_vendor_paid_reconciled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS legacy_vendor_paid_reconciled_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pre0036_total_paid_snapshot bigint NULL,
  ADD COLUMN IF NOT EXISTS pre0036_remaining_debt_snapshot bigint NULL,
  ADD COLUMN IF NOT EXISTS pre0036_deposit_paid_snapshot bigint NULL,
  ADD COLUMN IF NOT EXISTS legacy_balance_discrepancy_resolved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legacy_ar_reconciliation_status text NOT NULL DEFAULT 'NOT_REQUIRED';

-- Capture immutable pre-0036 balance snapshots once without altering legacy order payment columns:
UPDATE print_orders
SET
  pre0036_total_paid_snapshot = total_paid_amount,
  pre0036_remaining_debt_snapshot = remaining_debt_amount,
  pre0036_deposit_paid_snapshot = deposit_paid
WHERE pre0036_total_paid_snapshot IS NULL;

-- Populate deterministic defaults on pre-0036 orders without guessing refunds, customer IDs, or AP payouts:
UPDATE print_orders
SET
  valid_receivable_amount = CASE
    WHEN production_status = 'CANCELLED' THEN 0
    ELSE total_quote_amount
  END,
  cancellation_settlement_status = CASE
    WHEN production_status <> 'CANCELLED' THEN 'NOT_APPLICABLE'
    WHEN total_paid_amount > 0
      OR vendor_paid_amount > 0
      OR COALESCE(entered_vendor_cost, 0) > 0
      OR COALESCE(actual_vendor_cost, 0) > 0
    THEN 'PENDING_SETTLEMENT'
    ELSE 'SETTLED'
  END,
  legacy_vendor_paid_reconciled = CASE
    WHEN vendor_paid_amount > 0 THEN false
    ELSE true
  END
WHERE valid_receivable_amount IS NULL;

ALTER TABLE print_orders
  ALTER COLUMN valid_receivable_amount SET NOT NULL,
  ALTER COLUMN valid_receivable_amount SET DEFAULT 0;

ALTER TABLE print_orders
  DROP CONSTRAINT IF EXISTS chk_print_orders_ledger_scope,
  DROP CONSTRAINT IF EXISTS chk_print_orders_valid_receivable_nonneg,
  DROP CONSTRAINT IF EXISTS chk_print_orders_cancel_settlement_status,
  DROP CONSTRAINT IF EXISTS chk_print_orders_cancel_amounts_nonneg,
  DROP CONSTRAINT IF EXISTS chk_print_orders_legacy_ar_recon_status;

ALTER TABLE print_orders
  ADD CONSTRAINT chk_print_orders_ledger_scope
    CHECK (ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')),
  ADD CONSTRAINT chk_print_orders_valid_receivable_nonneg
    CHECK (valid_receivable_amount >= 0),
  ADD CONSTRAINT chk_print_orders_cancel_settlement_status
    CHECK (cancellation_settlement_status IN ('NOT_APPLICABLE', 'PENDING_SETTLEMENT', 'SETTLED')),
  ADD CONSTRAINT chk_print_orders_cancel_amounts_nonneg
    CHECK (
      agreed_customer_refund_amount >= 0
      AND refunded_after_cancel_amount >= 0
      AND retained_cancellation_fee >= 0
      AND refunded_after_cancel_amount <= agreed_customer_refund_amount
    ),
  ADD CONSTRAINT chk_print_orders_legacy_ar_recon_status
    CHECK (legacy_ar_reconciliation_status IN ('NOT_REQUIRED', 'PENDING', 'RECONCILED'));

-- ============================================================================
-- 2. MULTI-WORKSHOP JOBS (print_workshop_jobs & print_workshop_job_history)
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_workshop_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  job_code text NOT NULL,
  order_id uuid NOT NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  vendor_id uuid NULL REFERENCES print_vendors(id) ON DELETE RESTRICT,
  vendor_name text NULL,
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')),
  title text NOT NULL,
  source_line_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  job_status text NOT NULL DEFAULT 'ORDERED' CHECK (
    job_status IN ('DRAFT', 'ORDERED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
  ),
  cost_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (
    cost_status IN ('UNVERIFIED', 'ENTERED_UNCONFIRMED', 'CONFIRMED')
  ),
  expected_cost bigint NOT NULL DEFAULT 0 CHECK (expected_cost >= 0),
  entered_cost bigint NULL CHECK (entered_cost IS NULL OR entered_cost >= 0),
  confirmed_cost bigint NULL CHECK (confirmed_cost IS NULL OR confirmed_cost >= 0),
  confirmed_at timestamptz NULL,
  confirmed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  net_ap_adjustment_amount bigint NOT NULL DEFAULT 0,
  valid_payable_amount bigint NOT NULL DEFAULT 0 CHECK (valid_payable_amount >= 0),
  allocated_paid_amount bigint NOT NULL DEFAULT 0 CHECK (allocated_paid_amount >= 0),
  remaining_payable_amount bigint NOT NULL DEFAULT 0 CHECK (remaining_payable_amount >= 0),
  vendor_overpaid_credit_amount bigint NOT NULL DEFAULT 0 CHECK (vendor_overpaid_credit_amount >= 0),
  ordered_at timestamptz NULL,
  due_date date NULL,
  note text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, job_code),
  CONSTRAINT chk_print_workshop_jobs_confirmed_consistency CHECK (
    (cost_status <> 'CONFIRMED' AND confirmed_cost IS NULL)
    OR (cost_status = 'CONFIRMED' AND confirmed_cost IS NOT NULL AND entered_cost IS NOT NULL AND vendor_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_workshop_jobs_order
  ON print_workshop_jobs (workspace_id, order_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_print_workshop_jobs_vendor
  ON print_workshop_jobs (workspace_id, vendor_id, cost_status, remaining_payable_amount);

CREATE TABLE IF NOT EXISTS print_workshop_job_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  workshop_job_id uuid NOT NULL REFERENCES print_workshop_jobs(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (
    action IN (
      'CREATED',
      'UPDATED',
      'VENDOR_ASSIGNED',
      'COST_ENTERED',
      'COST_CONFIRMED',
      'COST_ADJUSTED',
      'COST_UNCONFIRMED',
      'CANCELLED'
    )
  ),
  before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NULL,
  changed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_workshop_job_history_job
  ON print_workshop_job_history (workspace_id, workshop_job_id, created_at DESC);

-- ============================================================================
-- 3. HISTORICAL SHEET IMPORT BATCHES & OPENING BALANCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_historical_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  batch_code text NOT NULL,
  source_sheet_name text NOT NULL,
  source_tab_name text NOT NULL,
  default_ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    default_ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  raw_payload text NOT NULL,
  status text NOT NULL DEFAULT 'PREVIEW' CHECK (
    status IN ('PREVIEW', 'CONFIRMED', 'CANCELLED')
  ),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  ready_rows_count integer NOT NULL DEFAULT 0 CHECK (ready_rows_count >= 0),
  needs_confirmation_rows_count integer NOT NULL DEFAULT 0 CHECK (needs_confirmation_rows_count >= 0),
  duplicate_rows_count integer NOT NULL DEFAULT 0 CHECK (duplicate_rows_count >= 0),
  imported_rows_count integer NOT NULL DEFAULT 0 CHECK (imported_rows_count >= 0),
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, batch_code)
);

CREATE TABLE IF NOT EXISTS print_historical_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES print_historical_import_batches(id) ON DELETE RESTRICT,
  source_row_number integer NOT NULL CHECK (source_row_number >= 1),
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  counterparty_role text NOT NULL DEFAULT 'UNKNOWN' CHECK (
    counterparty_role IN ('CUSTOMER', 'VENDOR', 'UNKNOWN')
  ),
  counterparty_name text NULL,
  matched_customer_id uuid NULL REFERENCES print_customers(id) ON DELETE SET NULL,
  matched_vendor_id uuid NULL REFERENCES print_vendors(id) ON DELETE SET NULL,
  raw_amount_text text NULL,
  parsed_amount bigint NULL CHECK (parsed_amount IS NULL OR parsed_amount >= 0),
  raw_goods_total_text text NULL,
  parsed_goods_total bigint NULL CHECK (parsed_goods_total IS NULL OR parsed_goods_total >= 0),
  voucher_code text NULL,
  occurred_date text NULL,
  note text NULL,
  raw_cells_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_status text NOT NULL DEFAULT 'NEEDS_CONFIRMATION' CHECK (
    row_status IN ('READY', 'NEEDS_CONFIRMATION', 'DUPLICATE', 'IMPORTED', 'SKIPPED')
  ),
  suggested_resolution text NOT NULL DEFAULT 'UNDECIDED' CHECK (
    suggested_resolution IN (
      'UNDECIDED',
      'IMPORT_OPENING_RECEIVABLE',
      'IMPORT_OPENING_PAYABLE',
      'IMPORT_CUSTOMER_ADVANCE',
      'IMPORT_VENDOR_ADVANCE',
      'HOLD_FOR_REVIEW',
      'SKIP'
    )
  ),
  owner_resolution text NOT NULL DEFAULT 'UNDECIDED' CHECK (
    owner_resolution IN (
      'UNDECIDED',
      'IMPORT_OPENING_RECEIVABLE',
      'IMPORT_OPENING_PAYABLE',
      'IMPORT_CUSTOMER_ADVANCE',
      'IMPORT_VENDOR_ADVANCE',
      'HOLD_FOR_REVIEW',
      'SKIP'
    )
  ),
  row_fingerprint text NOT NULL,
  imported_entity_type text NULL,
  imported_entity_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_print_hist_import_rows_imported_fp
  ON print_historical_import_rows (workspace_id, row_fingerprint)
  WHERE row_status = 'IMPORTED';

CREATE INDEX IF NOT EXISTS idx_print_hist_import_rows_batch
  ON print_historical_import_rows (batch_id, source_row_number ASC);

CREATE TABLE IF NOT EXISTS print_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  doc_code text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('CUSTOMER_RECEIVABLE', 'VENDOR_PAYABLE')),
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  customer_id uuid NULL REFERENCES print_customers(id) ON DELETE RESTRICT,
  customer_name text NULL,
  vendor_id uuid NULL REFERENCES print_vendors(id) ON DELETE RESTRICT,
  vendor_name text NULL,
  original_amount bigint NOT NULL CHECK (original_amount > 0),
  net_adjustment_amount bigint NOT NULL DEFAULT 0,
  valid_amount bigint NOT NULL CHECK (valid_amount >= 0),
  allocated_settled_amount bigint NOT NULL DEFAULT 0 CHECK (allocated_settled_amount >= 0),
  remaining_amount bigint NOT NULL CHECK (remaining_amount >= 0),
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,
  reference_code text NULL,
  source_sheet_name text NULL,
  source_tab_name text NULL,
  source_row_number integer NULL,
  import_row_id uuid NULL REFERENCES print_historical_import_rows(id) ON DELETE RESTRICT,
  note text NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, doc_code),
  CONSTRAINT chk_print_opening_balances_counterparty CHECK (
    (direction = 'CUSTOMER_RECEIVABLE' AND customer_name IS NOT NULL AND vendor_id IS NULL)
    OR (direction = 'VENDOR_PAYABLE' AND vendor_id IS NOT NULL AND vendor_name IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_opening_balances_scope
  ON print_opening_balances (workspace_id, direction, ledger_scope, remaining_amount);

-- ============================================================================
-- 4. CUSTOMER RECEIVABLES LEDGER (print_ar_*)
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_ar_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  tx_code text NOT NULL,
  customer_id uuid NULL REFERENCES print_customers(id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  tx_kind text NOT NULL CHECK (tx_kind IN ('RECEIPT', 'REFUND', 'REVERSAL')),
  receipt_subtype text NULL CHECK (
    receipt_subtype IS NULL
    OR receipt_subtype IN ('DEPOSIT', 'INSTALLMENT', 'FINAL', 'ADVANCE', 'OPENING_ADVANCE')
  ),
  amount bigint NOT NULL CHECK (amount > 0),
  allocated_amount bigint NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  refunded_unallocated_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_unallocated_amount >= 0),
  unallocated_amount bigint NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
  payment_method text NOT NULL DEFAULT 'BANK_TRANSFER' CHECK (
    payment_method IN ('BANK_TRANSFER', 'CASH', 'QR_VIETQR', 'OTHER')
  ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reference_code text NULL,
  attachment_url text NULL,
  note text NULL,
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOIDED')),
  reversal_of_tx_id uuid NULL REFERENCES print_ar_transactions(id) ON DELETE RESTRICT,
  void_reason text NULL,
  voided_at timestamptz NULL,
  voided_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  related_order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  legacy_order_payment_id uuid NULL UNIQUE,
  source_sheet_name text NULL,
  source_tab_name text NULL,
  source_row_number integer NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, tx_code),
  CONSTRAINT chk_print_ar_tx_conservation
    CHECK (allocated_amount + refunded_unallocated_amount + unallocated_amount = amount),
  CONSTRAINT chk_print_ar_tx_void_reason
    CHECK (status = 'POSTED' OR (status = 'VOIDED' AND void_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_print_ar_tx_customer
  ON print_ar_transactions (workspace_id, customer_id, ledger_scope, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_print_ar_tx_ref
  ON print_ar_transactions (workspace_id, reference_code)
  WHERE reference_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS print_ar_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  ar_transaction_id uuid NOT NULL REFERENCES print_ar_transactions(id) ON DELETE RESTRICT,
  order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  opening_balance_id uuid NULL REFERENCES print_opening_balances(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (
    direction IN ('APPLY', 'UNAPPLY_REVERSAL', 'REFUND_RELEASE')
  ),
  amount bigint NOT NULL CHECK (amount > 0),
  note text NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_print_ar_alloc_target CHECK (
    (order_id IS NOT NULL AND opening_balance_id IS NULL)
    OR (order_id IS NULL AND opening_balance_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_ar_alloc_order
  ON print_ar_allocations (workspace_id, order_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_print_ar_alloc_tx
  ON print_ar_allocations (workspace_id, ar_transaction_id, created_at ASC);

CREATE TABLE IF NOT EXISTS print_ar_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  adj_code text NOT NULL,
  order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  opening_balance_id uuid NULL REFERENCES print_opening_balances(id) ON DELETE RESTRICT,
  customer_id uuid NULL REFERENCES print_customers(id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  adjustment_type text NOT NULL CHECK (
    adjustment_type IN (
      'DISCOUNT',
      'RETURN_CREDIT',
      'SURCHARGE',
      'CANCELLATION_SETTLEMENT',
      'REVERSAL'
    )
  ),
  delta_amount bigint NOT NULL CHECK (delta_amount <> 0),
  reference_code text NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, adj_code),
  CONSTRAINT chk_print_ar_adj_target CHECK (
    (order_id IS NOT NULL AND opening_balance_id IS NULL)
    OR (order_id IS NULL AND opening_balance_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_ar_adj_order
  ON print_ar_adjustments (workspace_id, order_id, created_at DESC);

-- ============================================================================
-- 5. WORKSHOP PAYABLES LEDGER (print_ap_*) & CANCELLATION SETTLEMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_ap_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  tx_code text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES print_vendors(id) ON DELETE RESTRICT,
  vendor_name text NOT NULL,
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  tx_kind text NOT NULL CHECK (tx_kind IN ('PAYOUT', 'VENDOR_REFUND', 'REVERSAL')),
  payout_subtype text NULL CHECK (
    payout_subtype IS NULL
    OR payout_subtype IN ('ADVANCE', 'JOB_PAYMENT', 'SETTLEMENT', 'OPENING_ADVANCE')
  ),
  amount bigint NOT NULL CHECK (amount > 0),
  allocated_amount bigint NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  refunded_unallocated_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_unallocated_amount >= 0),
  unallocated_amount bigint NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
  payment_method text NOT NULL DEFAULT 'BANK_TRANSFER' CHECK (
    payment_method IN ('BANK_TRANSFER', 'CASH', 'QR_VIETQR', 'OTHER')
  ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reference_code text NULL,
  attachment_url text NULL,
  note text NULL,
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOIDED')),
  reversal_of_tx_id uuid NULL REFERENCES print_ap_transactions(id) ON DELETE RESTRICT,
  void_reason text NULL,
  voided_at timestamptz NULL,
  voided_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  reconciled_from_order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  source_sheet_name text NULL,
  source_tab_name text NULL,
  source_row_number integer NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, tx_code),
  CONSTRAINT chk_print_ap_tx_conservation
    CHECK (allocated_amount + refunded_unallocated_amount + unallocated_amount = amount),
  CONSTRAINT chk_print_ap_tx_void_reason
    CHECK (status = 'POSTED' OR (status = 'VOIDED' AND void_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_print_ap_tx_vendor
  ON print_ap_transactions (workspace_id, vendor_id, ledger_scope, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_print_ap_tx_ref
  ON print_ap_transactions (workspace_id, reference_code)
  WHERE reference_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS print_ap_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  ap_transaction_id uuid NOT NULL REFERENCES print_ap_transactions(id) ON DELETE RESTRICT,
  workshop_job_id uuid NULL REFERENCES print_workshop_jobs(id) ON DELETE RESTRICT,
  order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  opening_balance_id uuid NULL REFERENCES print_opening_balances(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (
    direction IN ('APPLY', 'UNAPPLY_REVERSAL', 'VENDOR_REFUND_RELEASE')
  ),
  amount bigint NOT NULL CHECK (amount > 0),
  note text NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_print_ap_alloc_target CHECK (
    (workshop_job_id IS NOT NULL AND opening_balance_id IS NULL)
    OR (workshop_job_id IS NULL AND opening_balance_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_ap_alloc_job
  ON print_ap_allocations (workspace_id, workshop_job_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_print_ap_alloc_tx
  ON print_ap_allocations (workspace_id, ap_transaction_id, created_at ASC);

CREATE TABLE IF NOT EXISTS print_ap_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  adj_code text NOT NULL,
  workshop_job_id uuid NULL REFERENCES print_workshop_jobs(id) ON DELETE RESTRICT,
  order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  opening_balance_id uuid NULL REFERENCES print_opening_balances(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES print_vendors(id) ON DELETE RESTRICT,
  vendor_name text NOT NULL,
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  adjustment_type text NOT NULL CHECK (
    adjustment_type IN ('DISCOUNT', 'DEFECT_DEDUCTION', 'SURCHARGE', 'REVERSAL')
  ),
  delta_amount bigint NOT NULL CHECK (delta_amount <> 0),
  reference_code text NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, adj_code),
  CONSTRAINT chk_print_ap_adj_target CHECK (
    (workshop_job_id IS NOT NULL AND opening_balance_id IS NULL)
    OR (workshop_job_id IS NULL AND opening_balance_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_ap_adj_job
  ON print_ap_adjustments (workspace_id, workshop_job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS print_order_cancellation_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  customer_paid_holding_snapshot bigint NOT NULL CHECK (customer_paid_holding_snapshot >= 0),
  agreed_customer_refund_amount bigint NOT NULL CHECK (agreed_customer_refund_amount >= 0),
  retained_cancellation_fee bigint NOT NULL CHECK (retained_cancellation_fee >= 0),
  incurred_vendor_cost_snapshot bigint NOT NULL DEFAULT 0 CHECK (incurred_vendor_cost_snapshot >= 0),
  vendor_paid_snapshot bigint NOT NULL DEFAULT 0 CHECK (vendor_paid_snapshot >= 0),
  reference_code text NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  settled_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_print_cancel_settlement_sum CHECK (
    agreed_customer_refund_amount + retained_cancellation_fee = customer_paid_holding_snapshot
  )
);

CREATE INDEX IF NOT EXISTS idx_print_cancel_settlements_order
  ON print_order_cancellation_settlements (workspace_id, order_id, created_at DESC);

-- ============================================================================
-- 6. LEGACY print_order_payments RECONCILIATION QUEUE & IMMUTABLE HISTORY
--    (Owner Approved Policy: NEVER auto-post legacy payments to Official AR;
--     preserve 100% legacy data, inspect anomalies, and post ONLY on confirmation!)
-- ============================================================================

-- Harden print_order_payments foreign keys from CASCADE to RESTRICT first
DO $$
DECLARE
  fk_rec record;
BEGIN
  FOR fk_rec IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'print_order_payments'::regclass
      AND c.contype = 'f'
      AND c.confdeltype = 'c'
  LOOP
    EXECUTE format(
      'ALTER TABLE print_order_payments DROP CONSTRAINT %I',
      fk_rec.conname
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'print_order_payments'::regclass
      AND conname = 'fk_print_order_payments_workspace_restrict'
  ) THEN
    ALTER TABLE print_order_payments
      ADD CONSTRAINT fk_print_order_payments_workspace_restrict
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'print_order_payments'::regclass
      AND conname = 'fk_print_order_payments_order_restrict'
  ) THEN
    ALTER TABLE print_order_payments
      ADD CONSTRAINT fk_print_order_payments_order_restrict
      FOREIGN KEY (order_id) REFERENCES print_orders(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS print_legacy_ar_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  legacy_payment_id uuid NOT NULL UNIQUE REFERENCES print_order_payments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'CONFIRMED', 'ON_HOLD', 'POSTED_DIRECT')
  ),
  anomaly_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  pre_reconciliation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  post_reconciliation_json jsonb NULL,
  posted_ar_transaction_id uuid NULL UNIQUE REFERENCES print_ar_transactions(id) ON DELETE RESTRICT,
  hold_reason text NULL,
  resolution_note text NULL,
  confirmed_at timestamptz NULL,
  confirmed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_print_legacy_ar_recon_tx_link CHECK (
    (status IN ('CONFIRMED', 'POSTED_DIRECT') AND posted_ar_transaction_id IS NOT NULL)
    OR (status IN ('PENDING', 'ON_HOLD') AND posted_ar_transaction_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_legacy_ar_recon_workspace_status
  ON print_legacy_ar_reconciliations (workspace_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_print_legacy_ar_recon_order
  ON print_legacy_ar_reconciliations (workspace_id, order_id, status);

CREATE TABLE IF NOT EXISTS print_legacy_ar_reconciliation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  reconciliation_id uuid NULL REFERENCES print_legacy_ar_reconciliations(id) ON DELETE RESTRICT,
  legacy_payment_id uuid NULL REFERENCES print_order_payments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (
    action IN (
      'QUEUED_BY_MIGRATION',
      'CUSTOMER_LINKED',
      'BALANCE_DISCREPANCY_RESOLVED',
      'HELD',
      'UNHELD',
      'CONFIRMED_TO_AR'
    )
  ),
  before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NULL,
  actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_legacy_ar_recon_hist_order
  ON print_legacy_ar_reconciliation_history (workspace_id, order_id, created_at DESC);

-- Idempotent seeding of pre-0036 print_order_payments into PENDING reconciliation queue (ZERO auto-posting!)
WITH order_pay_totals AS (
  SELECT
    p.order_id,
    COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type <> 'REFUND'), 0)::bigint AS gross_receipts,
    COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'REFUND'), 0)::bigint AS gross_refunds
  FROM print_order_payments p
  GROUP BY p.order_id
)
INSERT INTO print_legacy_ar_reconciliations (
  workspace_id,
  legacy_payment_id,
  order_id,
  status,
  anomaly_codes,
  pre_reconciliation_json,
  created_at,
  updated_at
)
SELECT
  p.workspace_id,
  p.id,
  p.order_id,
  'PENDING',
  to_jsonb(
    ARRAY_REMOVE(
      ARRAY[
        CASE WHEN o.customer_id IS NULL OR c.id IS NULL THEN 'MISSING_CUSTOMER_ID' END,
        CASE WHEN p.amount <= 0 THEN 'INVALID_AMOUNT' END,
        CASE WHEN COALESCE(o.pre0036_total_paid_snapshot, o.total_paid_amount) <> (opt.gross_receipts - opt.gross_refunds)
          OR (
            o.production_status <> 'CANCELLED'
            AND COALESCE(o.pre0036_remaining_debt_snapshot, o.remaining_debt_amount)
                <> GREATEST(0::bigint, o.total_quote_amount - COALESCE(o.pre0036_total_paid_snapshot, o.total_paid_amount))
          )
          THEN 'ORDER_BALANCE_MISMATCH'
        END,
        CASE WHEN opt.gross_refunds > opt.gross_receipts
          OR (p.payment_type = 'REFUND' AND p.amount > opt.gross_receipts)
          THEN 'REFUND_EXCEEDS_RECEIPTS'
        END,
        CASE WHEN p.payment_type = 'REFUND' THEN 'REFUND_AWAITING_CONFIRMED_RECEIPT' END,
        CASE WHEN p.payment_type <> 'REFUND'
          AND p.amount > (CASE WHEN o.production_status = 'CANCELLED' THEN o.total_quote_amount ELSE o.valid_receivable_amount END)
          THEN 'EXCEEDS_VALID_RECEIVABLE'
        END
      ]::text[],
      NULL
    )
  ),
  jsonb_build_object(
    'legacy_payment_id', p.id,
    'order_id', o.id,
    'order_code', o.order_code,
    'quote_code', o.quote_code,
    'payment_type', p.payment_type,
    'amount', p.amount,
    'payment_method', p.payment_method,
    'paid_at', p.paid_at,
    'reference_code', p.reference_code,
    'customer_id', o.customer_id,
    'customer_name', o.customer_name,
    'order_total_quote_amount', o.total_quote_amount,
    'order_valid_receivable_amount', o.valid_receivable_amount,
    'pre0036_total_paid_snapshot', COALESCE(o.pre0036_total_paid_snapshot, o.total_paid_amount),
    'pre0036_remaining_debt_snapshot', COALESCE(o.pre0036_remaining_debt_snapshot, o.remaining_debt_amount),
    'order_legacy_gross_receipts', opt.gross_receipts,
    'order_legacy_gross_refunds', opt.gross_refunds
  ),
  now(),
  now()
FROM print_order_payments p
JOIN print_orders o ON o.id = p.order_id
JOIN order_pay_totals opt ON opt.order_id = p.order_id
LEFT JOIN print_customers c ON c.id = o.customer_id AND c.workspace_id = o.workspace_id
WHERE NOT EXISTS (
  SELECT 1
  FROM print_ar_transactions existing_tx
  WHERE existing_tx.legacy_order_payment_id = p.id
)
ON CONFLICT (legacy_payment_id) DO NOTHING;

INSERT INTO print_legacy_ar_reconciliation_history (
  workspace_id,
  reconciliation_id,
  legacy_payment_id,
  order_id,
  action,
  before_json,
  after_json,
  reason,
  actor_id
)
SELECT
  r.workspace_id,
  r.id,
  r.legacy_payment_id,
  r.order_id,
  'QUEUED_BY_MIGRATION',
  r.pre_reconciliation_json,
  jsonb_build_object(
    'status', r.status,
    'anomaly_codes', r.anomaly_codes
  ),
  'Đưa phiếu thu/hoàn cũ vào danh sách chờ đối chiếu theo chính sách migration 0036',
  NULL
FROM print_legacy_ar_reconciliations r
WHERE r.status = 'PENDING'
  AND NOT EXISTS (
    SELECT 1
    FROM print_legacy_ar_reconciliation_history h
    WHERE h.reconciliation_id = r.id
      AND h.action = 'QUEUED_BY_MIGRATION'
  );

-- Flag pre-0036 orders that require reconciliation attention (pending payments, missing customer_id, or balance mismatch)
UPDATE print_orders o
SET legacy_ar_reconciliation_status = 'PENDING'
WHERE o.legacy_ar_reconciliation_status = 'NOT_REQUIRED'
  AND o.pre0036_total_paid_snapshot IS NOT NULL
  AND (
    o.customer_id IS NULL
    OR EXISTS (
      SELECT 1 FROM print_legacy_ar_reconciliations r
      WHERE r.order_id = o.id AND r.status IN ('PENDING', 'ON_HOLD')
    )
    OR (
      o.pre0036_total_paid_snapshot > 0
      AND NOT EXISTS (SELECT 1 FROM print_order_payments p WHERE p.order_id = o.id)
    )
    OR (
      o.production_status <> 'CANCELLED'
      AND o.pre0036_remaining_debt_snapshot <> GREATEST(0::bigint, o.total_quote_amount - o.pre0036_total_paid_snapshot)
    )
  );

-- ============================================================================
-- 7. IMMUTABLE / APPEND-ONLY TRIGGERS & ROLE PRIVILEGES
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_print_ledger_append_only_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % operation prohibited', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_print_ar_ap_tx_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% cannot be deleted; use VOID/REVERSAL instead', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id
      OR NEW.workspace_id <> OLD.workspace_id
      OR NEW.tx_code <> OLD.tx_code
      OR NEW.ledger_scope <> OLD.ledger_scope
      OR NEW.tx_kind <> OLD.tx_kind
      OR NEW.amount <> OLD.amount
      OR NEW.payment_method <> OLD.payment_method
      OR NEW.occurred_at <> OLD.occurred_at
      OR (OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED')
    THEN
      RAISE EXCEPTION '% core financial fields are immutable after posting', TG_TABLE_NAME
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_print_opening_balance_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'print_opening_balances cannot be deleted; use AR/AP adjustment instead'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id
      OR NEW.workspace_id <> OLD.workspace_id
      OR NEW.doc_code <> OLD.doc_code
      OR NEW.direction <> OLD.direction
      OR NEW.ledger_scope <> OLD.ledger_scope
      OR NEW.original_amount <> OLD.original_amount
    THEN
      RAISE EXCEPTION 'print_opening_balances core fields are immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_print_legacy_ar_reconciliation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'print_legacy_ar_reconciliations cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id
      OR NEW.workspace_id <> OLD.workspace_id
      OR NEW.legacy_payment_id <> OLD.legacy_payment_id
      OR NEW.order_id <> OLD.order_id
    THEN
      RAISE EXCEPTION 'print_legacy_ar_reconciliations identity fields are immutable'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.status IN ('CONFIRMED', 'POSTED_DIRECT') AND (
      NEW.status <> OLD.status
      OR NEW.posted_ar_transaction_id IS DISTINCT FROM OLD.posted_ar_transaction_id
    ) THEN
      RAISE EXCEPTION 'Confirmed legacy AR reconciliation cannot be reverted; use Official AR VOID/Adjustment instead'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'print_workshop_job_history',
    'print_ar_allocations',
    'print_ar_adjustments',
    'print_ap_allocations',
    'print_ap_adjustments',
    'print_order_cancellation_settlements',
    'print_order_payments',
    'print_legacy_ar_reconciliation_history'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_append_only ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_print_ledger_append_only_mutation()',
      tbl,
      tbl
    );
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_no_truncate ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION prevent_print_ledger_append_only_mutation()',
      tbl,
      tbl
    );
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tbl);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_print_ar_transactions_guard ON print_ar_transactions;
CREATE TRIGGER trg_print_ar_transactions_guard
  BEFORE UPDATE OR DELETE ON print_ar_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_print_ar_ap_tx_mutation();

DROP TRIGGER IF EXISTS trg_print_ar_transactions_no_truncate ON print_ar_transactions;
CREATE TRIGGER trg_print_ar_transactions_no_truncate
  BEFORE TRUNCATE ON print_ar_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_print_ledger_append_only_mutation();

DROP TRIGGER IF EXISTS trg_print_ap_transactions_guard ON print_ap_transactions;
CREATE TRIGGER trg_print_ap_transactions_guard
  BEFORE UPDATE OR DELETE ON print_ap_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_print_ar_ap_tx_mutation();

DROP TRIGGER IF EXISTS trg_print_ap_transactions_no_truncate ON print_ap_transactions;
CREATE TRIGGER trg_print_ap_transactions_no_truncate
  BEFORE TRUNCATE ON print_ap_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_print_ledger_append_only_mutation();

DROP TRIGGER IF EXISTS trg_print_opening_balances_guard ON print_opening_balances;
CREATE TRIGGER trg_print_opening_balances_guard
  BEFORE UPDATE OR DELETE ON print_opening_balances
  FOR EACH ROW EXECUTE FUNCTION guard_print_opening_balance_mutation();

DROP TRIGGER IF EXISTS trg_print_opening_balances_no_truncate ON print_opening_balances;
CREATE TRIGGER trg_print_opening_balances_no_truncate
  BEFORE TRUNCATE ON print_opening_balances
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_print_ledger_append_only_mutation();

DROP TRIGGER IF EXISTS trg_print_legacy_ar_recon_guard ON print_legacy_ar_reconciliations;
CREATE TRIGGER trg_print_legacy_ar_recon_guard
  BEFORE UPDATE OR DELETE ON print_legacy_ar_reconciliations
  FOR EACH ROW EXECUTE FUNCTION guard_print_legacy_ar_reconciliation_mutation();

DROP TRIGGER IF EXISTS trg_print_legacy_ar_recon_no_truncate ON print_legacy_ar_reconciliations;
CREATE TRIGGER trg_print_legacy_ar_recon_no_truncate
  BEFORE TRUNCATE ON print_legacy_ar_reconciliations
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_print_ledger_append_only_mutation();

REVOKE ALL ON
  print_workshop_jobs,
  print_historical_import_batches,
  print_historical_import_rows,
  print_opening_balances,
  print_ar_transactions,
  print_ap_transactions,
  print_legacy_ar_reconciliations
FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['hp_app_runtime', 'hp_app_test', 'ml_app_runtime', 'ml_app_test', 'app_runtime', 'app_test']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- State tables allowing controlled INSERT + UPDATE (no DELETE/TRUNCATE on financial headers)
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE ON print_workshop_jobs, print_historical_import_batches, print_historical_import_rows, print_opening_balances, print_ar_transactions, print_ap_transactions, print_legacy_ar_reconciliations TO %I',
        r
      );
      EXECUTE format(
        'REVOKE DELETE, TRUNCATE ON print_workshop_jobs, print_historical_import_batches, print_historical_import_rows, print_opening_balances, print_ar_transactions, print_ap_transactions, print_legacy_ar_reconciliations FROM %I',
        r
      );

      -- Strictly append-only tables: SELECT + INSERT only!
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON print_workshop_job_history, print_ar_allocations, print_ar_adjustments, print_ap_allocations, print_ap_adjustments, print_order_cancellation_settlements, print_order_payments, print_legacy_ar_reconciliation_history FROM %I',
        r
      );
      EXECUTE format(
        'GRANT SELECT, INSERT ON print_workshop_job_history, print_ar_allocations, print_ar_adjustments, print_ap_allocations, print_ap_adjustments, print_order_cancellation_settlements, print_order_payments, print_legacy_ar_reconciliation_history TO %I',
        r
      );
    END IF;
  END LOOP;
END $$;
`;

const RENAME_WORKSPACE_TOAN_GIA_PHAT_SQL = `-- Migration: 0037_rename_workspace_toan_gia_phat
-- Rename canonical active workspace from "Hoài Phương Media" to "THIẾT KẾ IN ẤN TOÀN GIA PHÁT"
-- while preserving synthetic/test/drill workspaces untouched.

UPDATE workspaces
SET name = 'THIẾT KẾ IN ẤN TOÀN GIA PHÁT'
WHERE status = 'active'
  AND btrim(name) IN ('Hoài Phương Media', 'HOÀI PHƯƠNG MEDIA');
`;

const SYNC_NV001_TIMESHEET_AND_REMOVE_NV002_PAYROLL_SQL = `-- Migration: 0038_sync_nv001_timesheet_and_remove_nv002_payroll
-- Scope:
--   1. Allow controlled transaction-local rate & payroll reconciliation (app.allow_rate_sync / app.allow_payroll_reconcile)
--      when synchronizing timesheets from the authoritative Google Sheet while keeping append-only/immutability guards
--      strictly enforced for all normal operations.
--   2. Remove NV002 from payroll (is_payroll_eligible = false, clean up duplicate/test shifts & un-disbursed payroll items).
--   3. Synchronize NV001 (Nguyễn Huỳnh Thế Vinh) hourly rates (T6: 20.000 đ/h, T7+: 25.000 đ/h) and all 61 work days
--      across T6..T11 (including fixing T10 = 9 days / 21,42h / 535.417 đ) from Google Sheet 11n-8Q2hjTZL9eC2RfHZoPTi6a5XHgQSVzFFl2qE-ktw.

CREATE OR REPLACE FUNCTION pay_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pay:' || NEW.workspace_id::text, 0));
  IF current_setting('app.allow_rate_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL) THEN RAISE EXCEPTION 'Rate closure is one-way'; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'effective_to') IS DISTINCT FROM (to_jsonb(NEW) - 'effective_to') THEN
    RAISE EXCEPTION 'Rate history is immutable except interval closure';
  END IF;
  IF EXISTS (SELECT 1 FROM employee_hourly_rates r WHERE r.workspace_id = NEW.workspace_id
    AND r.employee_id = NEW.employee_id AND r.id <> NEW.id
    AND tstzrange(r.effective_from, r.effective_to, '[)') && tstzrange(NEW.effective_from, NEW.effective_to, '[)')) THEN
    RAISE EXCEPTION 'Overlapping hourly rates';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION pay_rate_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_rate_sync', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'PAY history is append-only';
END $$;

DROP TRIGGER IF EXISTS pay_rate_no_delete ON employee_hourly_rates;
CREATE TRIGGER pay_rate_no_delete
  BEFORE DELETE ON employee_hourly_rates
  FOR EACH ROW EXECUTE FUNCTION pay_rate_delete_guard();

CREATE OR REPLACE FUNCTION pay_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_payroll_reconcile', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'finalized' THEN RAISE EXCEPTION 'Finalized PAY snapshot is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.period_month <> OLD.period_month THEN
    RAISE EXCEPTION 'PAY period identity is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION pay_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; p uuid; w uuid; state text;
BEGIN
  IF current_setting('app.allow_payroll_reconcile', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'UPDATE' AND (NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id) THEN
      RAISE EXCEPTION 'PAY child identity is immutable';
    END IF;
    r := OLD;
  ELSE r := NEW; END IF;
  w := r.workspace_id;
  IF TG_TABLE_NAME = 'payroll_employee_items' THEN
    IF EXISTS (SELECT 1 FROM employees e JOIN workspace_memberships m ON m.workspace_id=e.workspace_id AND m.user_id=e.user_id WHERE e.workspace_id=w AND e.id=r.employee_id AND m.role='owner') THEN RAISE EXCEPTION 'Owner excluded from PAY'; END IF;
    p := r.period_id;
  ELSE SELECT period_id INTO p FROM payroll_employee_items WHERE workspace_id = w AND id = r.payroll_item_id; END IF;
  SELECT status INTO state FROM payroll_periods WHERE workspace_id = w AND id = p FOR UPDATE;
  IF state = 'finalized' THEN RAISE EXCEPTION 'Finalized PAY snapshot is immutable'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'payroll_employee_items' THEN
      IF NEW.period_id <> OLD.period_id OR NEW.employee_id <> OLD.employee_id THEN RAISE EXCEPTION 'PAY parent is immutable'; END IF;
    ELSIF NEW.payroll_item_id <> OLD.payroll_item_id THEN RAISE EXCEPTION 'PAY parent is immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prevent_attendance_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_payroll_reconcile', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'attendance_shift_versions is immutable: % prohibited', TG_OP;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_daily_report_revisions_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.allow_payroll_reconcile', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'daily_report_revisions is append-only: % operation prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['hp_app_runtime', 'hp_app_test', 'ml_app_runtime', 'ml_app_test', 'app_runtime', 'app_test']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON employees, employee_hourly_rates, attendance_shifts, attendance_shift_versions, attendance_approvals, attendance_breaks, attendance_adjustments, attendance_correction_requests, daily_reports, daily_report_entries, daily_report_revisions, payroll_periods, payroll_employee_items, payroll_daily_breakdowns, payroll_adjustments TO %I',
        r
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  v_ws record;
  v_actor_id uuid;
  v_nv001_id uuid;
  v_nv002 record;
  v_row record;
  v_shift_id uuid;
  v_ver_id uuid;
  v_rep_id uuid;
  v_clock_in timestamptz;
  v_clock_out timestamptz;
  v_worked_sec bigint;
  v_ref text;
  v_hash text;
BEGIN
  PERFORM set_config('app.allow_rate_sync', 'on', true);
  PERFORM set_config('app.allow_payroll_reconcile', 'on', true);

  FOR v_ws IN
    SELECT w.id, w.name
    FROM workspaces w
    WHERE w.status = 'active'
      AND btrim(w.name) IN (
        'THIẾT KẾ IN ẤN TOÀN GIA PHÁT',
        'Hoài Phương Media',
        'HOÀI PHƯƠNG MEDIA',
        'Hoài Phương Studio'
      )
  LOOP
    SELECT m.user_id INTO v_actor_id
    FROM workspace_memberships m
    WHERE m.workspace_id = v_ws.id AND m.role = 'owner' AND m.status = 'active'
    ORDER BY m.created_at ASC
    LIMIT 1;

    IF v_actor_id IS NULL THEN
      SELECT m.user_id INTO v_actor_id
      FROM workspace_memberships m
      WHERE m.workspace_id = v_ws.id
      ORDER BY m.created_at ASC
      LIMIT 1;
    END IF;

    -- 1. Remove NV002 from payroll and clean up NV002 shifts/rates/un-disbursed payroll items
    FOR v_nv002 IN
      SELECT e.id, e.user_id
      FROM employees e
      WHERE e.workspace_id = v_ws.id AND e.employee_code = 'NV002'
    LOOP
      UPDATE employees
      SET is_payroll_eligible = FALSE,
          employment_status = CASE WHEN user_id IS NULL THEN 'inactive' ELSE employment_status END,
          updated_at = now()
      WHERE workspace_id = v_ws.id AND id = v_nv002.id;

      DELETE FROM payroll_adjustments pa
      USING payroll_employee_items pei
      WHERE pa.workspace_id = v_ws.id
        AND pa.payroll_item_id = pei.id
        AND pei.workspace_id = v_ws.id
        AND pei.employee_id = v_nv002.id
        AND NOT EXISTS (
          SELECT 1 FROM payroll_disbursements pd
          WHERE pd.workspace_id = v_ws.id AND pd.payroll_item_id = pei.id
        );

      DELETE FROM payroll_daily_breakdowns pdb
      USING payroll_employee_items pei
      WHERE pdb.workspace_id = v_ws.id
        AND pdb.payroll_item_id = pei.id
        AND pei.workspace_id = v_ws.id
        AND pei.employee_id = v_nv002.id
        AND NOT EXISTS (
          SELECT 1 FROM payroll_disbursements pd
          WHERE pd.workspace_id = v_ws.id AND pd.payroll_item_id = pei.id
        );

      DELETE FROM payroll_employee_items pei
      WHERE pei.workspace_id = v_ws.id
        AND pei.employee_id = v_nv002.id
        AND NOT EXISTS (
          SELECT 1 FROM payroll_disbursements pd
          WHERE pd.workspace_id = v_ws.id AND pd.payroll_item_id = pei.id
        );

      UPDATE attendance_shifts
      SET current_version_id = NULL
      WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id;

      DELETE FROM attendance_approvals
      WHERE workspace_id = v_ws.id
        AND shift_id IN (SELECT id FROM attendance_shifts WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM attendance_adjustments
      WHERE workspace_id = v_ws.id
        AND shift_id IN (SELECT id FROM attendance_shifts WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM attendance_correction_requests
      WHERE workspace_id = v_ws.id
        AND shift_id IN (SELECT id FROM attendance_shifts WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM attendance_breaks
      WHERE workspace_id = v_ws.id
        AND shift_id IN (SELECT id FROM attendance_shifts WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM attendance_shift_versions
      WHERE workspace_id = v_ws.id
        AND shift_id IN (SELECT id FROM attendance_shifts WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM attendance_shifts
      WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id;

      DELETE FROM daily_report_entries
      WHERE workspace_id = v_ws.id
        AND report_id IN (SELECT id FROM daily_reports WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM daily_report_revisions
      WHERE workspace_id = v_ws.id
        AND report_id IN (SELECT id FROM daily_reports WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM daily_reports
      WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id;

      DELETE FROM employee_hourly_rates
      WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id;
    END LOOP;

    -- 2. Synchronize NV001 (Nguyễn Huỳnh Thế Vinh)
    SELECT e.id INTO v_nv001_id
    FROM employees e
    WHERE e.workspace_id = v_ws.id AND e.employee_code = 'NV001'
    LIMIT 1;

    IF v_nv001_id IS NOT NULL AND v_actor_id IS NOT NULL THEN
      UPDATE employees
      SET full_name = 'Nguyễn Huỳnh Thế Vinh',
          is_payroll_eligible = TRUE,
          employment_status = 'active',
          bank_name = COALESCE(NULLIF(btrim(bank_name), ''), 'Vietcombank'),
          bank_account_number = COALESCE(NULLIF(btrim(bank_account_number), ''), '1031739417'),
          bank_account_holder = COALESCE(NULLIF(btrim(bank_account_holder), ''), 'NGUYEN HUYNH THE VINH'),
          updated_at = now()
      WHERE workspace_id = v_ws.id AND id = v_nv001_id;

      -- Replace NV001 hourly rates with exact segments from Google Sheet:
      -- T6 (2026-06-01 .. 2026-07-01): 20.000 đ/h
      -- T7+ (2026-07-01 .. NULL): 25.000 đ/h
      DELETE FROM employee_hourly_rates
      WHERE workspace_id = v_ws.id AND employee_id = v_nv001_id;

      INSERT INTO employee_hourly_rates (
        workspace_id, employee_id, hourly_rate_vnd, effective_from, effective_to, created_by
      ) VALUES
        (v_ws.id, v_nv001_id, 20000, '2026-06-01T00:00:00+07:00'::timestamptz, '2026-07-01T00:00:00+07:00'::timestamptz, v_actor_id),
        (v_ws.id, v_nv001_id, 25000, '2026-07-01T00:00:00+07:00'::timestamptz, NULL, v_actor_id);

      -- Clear NV001 shifts up through 2026-11-06 (preserving any newer live web clock-ins after 2026-11-06)
      UPDATE attendance_shifts
      SET current_version_id = NULL
      WHERE workspace_id = v_ws.id
        AND employee_id = v_nv001_id
        AND (source = 'import' OR clock_in_at < '2026-11-07T00:00:00+07:00'::timestamptz);

      DELETE FROM attendance_approvals
      WHERE workspace_id = v_ws.id
        AND shift_id IN (
          SELECT id FROM attendance_shifts
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND current_version_id IS NULL
        );

      DELETE FROM attendance_adjustments
      WHERE workspace_id = v_ws.id
        AND shift_id IN (
          SELECT id FROM attendance_shifts
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND current_version_id IS NULL
        );

      DELETE FROM attendance_correction_requests
      WHERE workspace_id = v_ws.id
        AND shift_id IN (
          SELECT id FROM attendance_shifts
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND current_version_id IS NULL
        );

      DELETE FROM attendance_breaks
      WHERE workspace_id = v_ws.id
        AND shift_id IN (
          SELECT id FROM attendance_shifts
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND current_version_id IS NULL
        );

      DELETE FROM attendance_shift_versions
      WHERE workspace_id = v_ws.id
        AND shift_id IN (
          SELECT id FROM attendance_shifts
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND current_version_id IS NULL
        );

      DELETE FROM attendance_shifts
      WHERE workspace_id = v_ws.id
        AND employee_id = v_nv001_id
        AND current_version_id IS NULL;

      -- Insert the exact 61 shifts & daily reports from Google Sheet 11n-8Q2hjTZL9eC2RfHZoPTi6a5XHgQSVzFFl2qE-ktw
      FOR v_row IN
        SELECT * FROM (VALUES
          -- T6 (14 days, 57.17h, rate 20.000 -> 1.143.333 đ)
          ('2026-06-01'::date, 540, 720, ''::text, 0),
          ('2026-06-02'::date, 540, 780, ''::text, 0),
          ('2026-06-03'::date, 570, 810, ''::text, 0),
          ('2026-06-04'::date, 570, 690, 'Edit 8 clip kênh LSK'::text, 8),
          ('2026-06-08'::date, 570, 930, 'Edit 8 clip LSK: 4 Tonic, 2 men rắc, 2 tiêu phân-khử mùi; 4 clip LSKMM: 2 men rắc thảo dược, 2 men rắc tiêu phân - khử mùi'::text, 12),
          ('2026-06-09'::date, 570, 810, '6 clip LSK: 2 Linco, 2 bổ gan thận, 2 Canxi B12. Phụ live TikTok'::text, 6),
          ('2026-06-10'::date, 630, 900, '8 clip LSK: 4 Flodoxy, 4 Fensit. Live kênh LSKMM'::text, 8),
          ('2026-06-15'::date, 630, 840, '4 Clip LSK: 2 Flodoxy, 2 Fensit. Phụ Live Tiktok'::text, 4),
          ('2026-06-17'::date, 540, 900, '10 clip LSK: giải độc gan, Tonic, Flodoxy, Linco, Fensit'::text, 10),
          ('2026-06-18'::date, 810, 1020, '2 clip thực tế Linco, 1 clip thực tế Flodoxy'::text, 3),
          ('2026-06-19'::date, 630, 900, '6 clip thực tế: 3 Flodoxy,  3 Fensit'::text, 6),
          ('2026-06-22'::date, 630, 810, '8 clip LSKMM: Flodoxy, Fensit, Linco, Flucasol. LIVE'::text, 8),
          ('2026-06-23'::date, 630, 900, '6 clip LSK: linco, 4 fensit, flucasol. LIVE. 4 clip thực tế: 2 fensit, 2 flodoxy'::text, 10),
          ('2026-06-24'::date, 640, 920, '5 clip thực tế: 2 flodoxy, 2 tonic, 1 canxi B12'::text, 5),
          -- T7 (10 days, 34.33h, rate 25.000 -> 858.334 đ)
          ('2026-07-03'::date, 675, 900, '8 clip thực tế cho: flodoxy, linco, men rắc tiêu phân, fensit'::text, 8),
          ('2026-07-07'::date, 680, 910, '7 clip LSK: 2Tonic, 3 linco, 2men rắc tiêu phân-khử mùi | 7 clip LSKMM'::text, 14),
          ('2026-07-09'::date, 795, 915, '8 clip LSK: linco, tonic, canxiB12, giải độc gan'::text, 8),
          ('2026-07-14'::date, 585, 885, 'LSK: 10 clip: 2 canxi B12, 2 Gan, 2 Tonic, 4 Men sống| Thực tế: 3 men sống, 3 fensit'::text, 16),
          ('2026-07-20'::date, 635, 840, '9 clip thực tế: Fensit, Linco, Men sống'::text, 9),
          ('2026-07-21'::date, 635, 840, '17 clip kênh LSK: flucasol, flodoxy, men sống, men nửa ký, kích lông, canxi, fensit'::text, 17),
          ('2026-07-22'::date, 705, 870, '17 clip kênh LSKMM: flucasol, flodoxy, men sống, men nửa ký, kích lông, canxi, fensit'::text, 17),
          ('2026-07-23'::date, 715, 950, '8 clip LSK: men sống, flucasol, fensit, linco. 2 clip thực tế linco, men thảo dược.'::text, 10),
          ('2026-07-29'::date, 820, 1000, 'LSKMM:5 clip Nuôi gà theo mệnh. | Kenh2:15 clip MMG. | COCO: 15 clip MMG.'::text, 35),
          ('2026-07-30'::date, 800, 995, '3 clip thực tế: linco, 3 clip thực tế men sống, 1 clip thực tế fensit.'::text, 7),
          -- T8 (11 days, 30.87h, rate 25.000 -> 771.668 đ)
          ('2026-08-04'::date, 635, 840, '17 clip LSK: fensit, linco, canxi, men sống, men rắc, flodoxy, flucasol'::text, 17),
          ('2026-08-05'::date, 860, 1020, 'LSKMM: 15 clip màu mệnh, 5 clip mệnh gà. COCO: 15 clip màu mệnh'::text, 35),
          ('2026-08-06'::date, 840, 1000, '8 clip thực tế: men sống, linco, fensit.'::text, 8),
          ('2026-08-13'::date, 805, 940, 'LSKMM: 16 clip MMG, COCO: 16 clip MMG. Chèn nhạc vào clip LSK 0408 30 phút( tại nhà)'::text, 32),
          ('2026-08-14'::date, 840, 970, 'LSKMM: 15 clip MMG, COCO: 15 clip MM'::text, 30),
          ('2026-08-16'::date, 860, 960, 'LSKMM: 15 clip MMG, COCO: 15 clip MM'::text, 30),
          ('2026-08-18'::date, 700, 975, 'LSK: 2 men song, 2 linco, 2flucasol, 2 canxi. 2 fensit, 1 gđ gan, 1 tonic, 1 flodoxy, 1 men rắc'::text, 14),
          ('2026-08-19'::date, 770, 960, 'LSK: 2flodoxy, 2 GDGan, 2Tonic, 2Men song, 2 Men rắc, 1 linco,1 đẹn, 1fensit, 1 canxi'::text, 14),
          ('2026-08-20'::date, 840, 1020, 'LSK 17 clip: linco, flucasol, fensit, canxi, flodoxy, Gan, Tonic, Men rắc, Men sống'::text, 17),
          ('2026-08-28'::date, 870, 1020, '22 clip nhà máy cho kênh tạp hóa'::text, 22),
          ('2026-08-29'::date, 860, 1027, '76 clip kênh tạp hóa cho các Dot4,5,6,7,8,9'::text, 76),
          -- T9 (13 days, 33.25h, rate 25.000 -> 831.250 đ)
          ('2026-09-03'::date, 840, 990, '16 CLIP TRẠI GÀ, 29 CLIP BaPhat'::text, 45),
          ('2026-09-04'::date, 860, 1040, '25 clip tạp hóa, 25 clip BaPhat.'::text, 50),
          ('2026-09-05'::date, 795, 1065, 'taphoanhabinh:40 clip. Baphat: 48 clip'::text, 88),
          ('2026-09-06'::date, 795, 915, '18 clip nhamaythuocga. 24 clip baphatreview'::text, 42),
          ('2026-09-08'::date, 865, 1035, 'taphoa.24sp.0509; baphat.24sp.0509.dot2; batphat.24sp.0609.dot1'::text, 0),
          ('2026-09-09'::date, 1080, 1200, '48 clip baphat dot1, dot2'::text, 48),
          ('2026-09-10'::date, 800, 1095, 'Tạp Hóa: 80 clip. Bá Phát: 56 clip'::text, 136),
          ('2026-09-16'::date, 1290, 1350, 'Tạp hóa: 22 clip (không có lỗi)'::text, 22),
          ('2026-09-17'::date, 840, 990, 'taphoa: 27 clip. baphat: 54 clip'::text, 81),
          ('2026-09-22'::date, 870, 1050, 'tạp hóa: 39 clip. baphat: 38 clip'::text, 77),
          ('2026-09-23'::date, 920, 1040, 'tạp hóa: 55 clip'::text, 55),
          ('2026-09-24'::date, 960, 1080, 'taphoa: 58 clip'::text, 58),
          ('2026-09-25'::date, 840, 900, 'taphoa: 32 clip'::text, 32),
          -- T10 (9 days, 21.42h, rate 25.000 -> 535.417 đ)
          ('2026-10-05'::date, 825, 885, '26 clip tạp hóa'::text, 26),
          ('2026-10-13'::date, 840, 960, '59 clip tạp hóa'::text, 59),
          ('2026-10-14'::date, 800, 980, '70 clip tạp hóa'::text, 70),
          ('2026-10-15'::date, 860, 1040, '44 clip tạp hóa'::text, 44),
          ('2026-10-21'::date, 840, 1000, '38 clip tạp hóa'::text, 38),
          ('2026-10-27'::date, 890, 1000, '33 clip taphoa'::text, 33),
          ('2026-10-28'::date, 870, 1020, 'tìm source, edit cho 2 clip chia sẻ thực tế'::text, 2),
          ('2026-10-29'::date, 875, 995, 'VUKY: 2 CLIP. Clip thực tế: 1'::text, 3),
          ('2026-10-30'::date, 825, 1030, '3 clip VUKY, 2 clip NUOIKENH'::text, 5),
          -- T11 (4 days up to 06/11, 11.50h, rate 25.000 -> 287.500 đ)
          ('2026-11-03'::date, 870, 1005, '3 vuky, 2 nuoikenh'::text, 5),
          ('2026-11-04'::date, 885, 1050, '3 vuky, 2 nuoi kenh'::text, 5),
          ('2026-11-05'::date, 1005, 1155, '2 VUKY, 2 NUOIKENH'::text, 4),
          ('2026-11-06'::date, 855, 1095, '4 VUKY. 4 NUOIKENH'::text, 8)
        ) AS t(work_date, start_min, end_min, task_text, clip_count)
      LOOP
        v_clock_in := (v_row.work_date::text || 'T00:00:00+07:00')::timestamptz + make_interval(mins => v_row.start_min);
        v_clock_out := (v_row.work_date::text || 'T00:00:00+07:00')::timestamptz + make_interval(mins => v_row.end_min);
        v_worked_sec := (v_row.end_min - v_row.start_min) * 60;
        v_ref := 'timesheet:' || v_nv001_id::text || ':' || v_row.work_date::text;
        v_shift_id := gen_random_uuid();
        v_ver_id := gen_random_uuid();
        v_hash := encode(sha256(convert_to(v_shift_id::text || ':' || v_clock_in::text || ':' || v_clock_out::text || ':' || v_worked_sec::text, 'UTF8')), 'hex');

        INSERT INTO attendance_shifts (
          id, workspace_id, employee_id, clock_in_at, clock_out_at,
          run_state, review_state, current_version_id, version, source, import_ref
        ) VALUES (
          v_shift_id, v_ws.id, v_nv001_id, v_clock_in, v_clock_out,
          'completed', 'approved', NULL, 1, 'import', v_ref
        );

        INSERT INTO attendance_shift_versions (
          id, workspace_id, shift_id, version_number, clock_in_at, clock_out_at,
          breaks_snapshot, worked_seconds, snapshot_hash, created_by, reason
        ) VALUES (
          v_ver_id, v_ws.id, v_shift_id, 1, v_clock_in, v_clock_out,
          '[]'::jsonb, v_worked_sec, v_hash, v_actor_id, '[TIMESHEET-IMPORT]'
        );

        UPDATE attendance_shifts
        SET current_version_id = v_ver_id
        WHERE id = v_shift_id;

        INSERT INTO attendance_approvals (
          workspace_id, shift_id, shift_version_id, reviewer_user_id, decision, reason
        ) VALUES (
          v_ws.id, v_shift_id, v_ver_id, v_actor_id, 'approved', '[TIMESHEET-IMPORT]'
        );

        IF length(btrim(v_row.task_text)) > 0 THEN
          SELECT id INTO v_rep_id
          FROM daily_reports
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND report_date = v_row.work_date
          LIMIT 1;

          IF v_rep_id IS NULL THEN
            v_rep_id := gen_random_uuid();
            INSERT INTO daily_reports (
              id, workspace_id, employee_id, report_date, status, notes, submitted_at, current_revision, version
            ) VALUES (
              v_rep_id, v_ws.id, v_nv001_id, v_row.work_date, 'submitted',
              left(v_row.task_text, 2000), v_clock_out, 1, 1
            );

            INSERT INTO daily_report_entries (
              workspace_id, report_id, work_type, reported_count, notes, sort_order
            ) VALUES (
              v_ws.id, v_rep_id,
              CASE WHEN v_row.clip_count > 0 THEN 'Dựng clip' ELSE 'Công việc ngày' END,
              GREATEST(0, v_row.clip_count),
              left(v_row.task_text, 500),
              0
            );

            INSERT INTO daily_report_revisions (
              workspace_id, report_id, revision_number, status, snapshot, reason, edited_by
            ) VALUES (
              v_ws.id, v_rep_id, 1, 'submitted',
              jsonb_build_object(
                'entries', jsonb_build_array(
                  jsonb_build_object(
                    'work_type', CASE WHEN v_row.clip_count > 0 THEN 'Dựng clip' ELSE 'Công việc ngày' END,
                    'reported_count', GREATEST(0, v_row.clip_count),
                    'notes', left(v_row.task_text, 500),
                    'sort_order', 0
                  )
                ),
                'notes', left(v_row.task_text, 2000)
              ),
              '[TIMESHEET-IMPORT]', v_actor_id
            );
          END IF;
        END IF;
      END LOOP;

      -- Re-open any un-disbursed 2026 payroll periods so /payroll computes fresh from the synced shifts
      DELETE FROM payroll_daily_breakdowns pdb
      USING payroll_employee_items pei, payroll_periods pp
      WHERE pdb.workspace_id = v_ws.id
        AND pdb.payroll_item_id = pei.id
        AND pei.workspace_id = v_ws.id
        AND pei.period_id = pp.id
        AND pp.workspace_id = v_ws.id
        AND pp.period_month LIKE '2026-%'
        AND NOT EXISTS (
          SELECT 1 FROM payroll_disbursements pd
          WHERE pd.workspace_id = v_ws.id AND pd.payroll_item_id = pei.id
        );

      DELETE FROM payroll_employee_items pei
      USING payroll_periods pp
      WHERE pei.workspace_id = v_ws.id
        AND pei.period_id = pp.id
        AND pp.workspace_id = v_ws.id
        AND pp.period_month LIKE '2026-%'
        AND NOT EXISTS (
          SELECT 1 FROM payroll_disbursements pd
          WHERE pd.workspace_id = v_ws.id AND pd.payroll_item_id = pei.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM payroll_adjustments pa
          WHERE pa.workspace_id = v_ws.id AND pa.payroll_item_id = pei.id
        );

      UPDATE payroll_periods pp
      SET status = 'draft',
          finalized_at = NULL,
          finalized_by = NULL,
          finalized_snapshot_hash = NULL,
          updated_at = now()
      WHERE pp.workspace_id = v_ws.id
        AND pp.period_month LIKE '2026-%'
        AND pp.status = 'finalized'
        AND NOT EXISTS (
          SELECT 1
          FROM payroll_employee_items pei
          JOIN payroll_disbursements pd ON pd.workspace_id = pei.workspace_id AND pd.payroll_item_id = pei.id
          WHERE pei.workspace_id = v_ws.id AND pei.period_id = pp.id
        );
    END IF;
  END LOOP;

  PERFORM set_config('app.allow_rate_sync', 'off', true);
  PERFORM set_config('app.allow_payroll_reconcile', 'off', true);
END $$;
`;

export const EMBEDDED_MIGRATIONS: MigrationFile[] = [
  {
    id: '0001_m00_prerequisites',
    sql: M00_SQL,
    checksum: calculateChecksum(M00_SQL),
  },
  {
    id: '0002_m01_workspace_user_audit_idempotency',
    sql: M01_SQL,
    checksum: calculateChecksum(M01_SQL),
  },
  {
    id: '0003_m02_auth_membership_session_outbox',
    sql: M02_SQL,
    checksum: calculateChecksum(M02_SQL),
  },
  {
    id: '0004_m02b_user_workspace_bindings',
    sql: M02B_SQL,
    checksum: calculateChecksum(M02B_SQL),
  },
  {
    id: '0005_m03_employees',
    sql: M03_SQL,
    checksum: calculateChecksum(M03_SQL),
  },
  {
    id: '0006_m04_attendance',
    sql: M04_SQL,
    checksum: calculateChecksum(M04_SQL),
  },
  {
    id: '0007_m05_reports',
    sql: M05_SQL,
    checksum: calculateChecksum(M05_SQL),
  },
  {
    id: '0008_m06_schedules',
    sql: M06_SQL,
    checksum: calculateChecksum(M06_SQL),
  },
  {
    id: '0009_m07_payroll',
    sql: M07_SQL,
    checksum: calculateChecksum(M07_SQL),
  },
  { id: '0010_m08_work', sql: M08_SQL, checksum: calculateChecksum(M08_SQL) },
  {
    id: '0011_m06_accounts',
    sql: M06_ACCOUNTS_SQL,
    checksum: calculateChecksum(M06_ACCOUNTS_SQL),
  },
  {
    id: '0012_m09_storage',
    sql: M09_STORAGE_SQL,
    checksum: calculateChecksum(M09_STORAGE_SQL),
  },
  {
    id: '0013_m10_issues',
    sql: M10_ISSUES_SQL,
    checksum: calculateChecksum(M10_ISSUES_SQL),
  },
  {
    id: '0014_fin01a',
    sql: FIN01A_SQL,
    checksum: calculateChecksum(FIN01A_SQL),
  },
  {
    id: '0015_fin_receipt_time',
    sql: FIN_RECEIPT_TIME_SQL,
    checksum: calculateChecksum(FIN_RECEIPT_TIME_SQL),
  },
  {
    id: '0016_fin_plan',
    sql: FIN_PLAN_SQL,
    checksum: calculateChecksum(FIN_PLAN_SQL),
  },
  {
    id: '0017_attendance_version_immutable',
    sql: ATTENDANCE_VERSION_IMMUTABLE_SQL,
    checksum: calculateChecksum(ATTENDANCE_VERSION_IMMUTABLE_SQL),
  },
  {
    id: '0018_audit_events_immutable',
    sql: AUDIT_EVENTS_IMMUTABLE_SQL,
    checksum: calculateChecksum(AUDIT_EVENTS_IMMUTABLE_SQL),
  },
  {
    id: '0019_password_reset_tokens',
    sql: PASSWORD_RESET_TOKENS_SQL,
    checksum: calculateChecksum(PASSWORD_RESET_TOKENS_SQL),
  },
  {
    id: '0020_email_verification',
    sql: EMAIL_VERIFICATION_SQL,
    checksum: calculateChecksum(EMAIL_VERIFICATION_SQL),
  },
  {
    id: '0021_m11_bug_ai_management',
    sql: M11_BUG_AI_MANAGEMENT_SQL,
    checksum: calculateChecksum(M11_BUG_AI_MANAGEMENT_SQL),
  },
  {
    id: '0022_work_schedule_links',
    sql: WORK_SCHEDULE_LINKS_SQL,
    checksum: calculateChecksum(WORK_SCHEDULE_LINKS_SQL),
  },
  {
    id: '0023_auth_session_remember_me',
    sql: AUTH_SESSION_REMEMBER_ME_SQL,
    checksum: calculateChecksum(AUTH_SESSION_REMEMBER_ME_SQL),
  },
  {
    id: '0024_accounts_enhancement',
    sql: ACCOUNTS_ENHANCEMENT_SQL,
    checksum: calculateChecksum(ACCOUNTS_ENHANCEMENT_SQL),
  },
  {
    id: '0025_storage_google_drive_v2',
    sql: STORAGE_GOOGLE_DRIVE_V2_SQL,
    checksum: calculateChecksum(STORAGE_GOOGLE_DRIVE_V2_SQL),
  },
  {
    id: '0026_user_profile_phone',
    sql: USER_PROFILE_PHONE_SQL,
    checksum: calculateChecksum(USER_PROFILE_PHONE_SQL),
  },
  {
    id: '0027_timesheet_import',
    sql: TIMESHEET_IMPORT_SQL,
    checksum: calculateChecksum(TIMESHEET_IMPORT_SQL),
  },
  {
    id: '0028_system_logs',
    sql: SYSTEM_LOGS_SQL,
    checksum: calculateChecksum(SYSTEM_LOGS_SQL),
  },
  {
    id: '0029_report_entry_work_item',
    sql: REPORT_ENTRY_WORK_ITEM_SQL,
    checksum: calculateChecksum(REPORT_ENTRY_WORK_ITEM_SQL),
  },
  {
    id: '0030_employee_profile_and_bank_info',
    sql: EMPLOYEE_PROFILE_AND_BANK_INFO_SQL,
    checksum: calculateChecksum(EMPLOYEE_PROFILE_AND_BANK_INFO_SQL),
  },
  {
    id: '0031_accounts_ecosystem_hierarchy',
    sql: ACCOUNTS_ECOSYSTEM_HIERARCHY_SQL,
    checksum: calculateChecksum(ACCOUNTS_ECOSYSTEM_HIERARCHY_SQL),
  },
  {
    id: '0032_employee_sub_permissions',
    sql: EMPLOYEE_SUB_PERMISSIONS_SQL,
    checksum: calculateChecksum(EMPLOYEE_SUB_PERMISSIONS_SQL),
  },
  {
    id: '0033_printquote_v1',
    sql: PRINTQUOTE_V1_SQL,
    checksum: calculateChecksum(PRINTQUOTE_V1_SQL),
  },
  {
    id: '0034_printquote_workshop_stages_v2',
    sql: PRINTQUOTE_WORKSHOP_STAGES_V2_SQL,
    checksum: calculateChecksum(PRINTQUOTE_WORKSHOP_STAGES_V2_SQL),
  },
  {
    id: '0035_printquote_financial_control_gate',
    sql: PRINTQUOTE_FINANCIAL_CONTROL_GATE_SQL,
    checksum: calculateChecksum(PRINTQUOTE_FINANCIAL_CONTROL_GATE_SQL),
  },
  {
    id: '0036_printquote_ar_ap_ledger',
    sql: PRINTQUOTE_AR_AP_LEDGER_SQL,
    checksum: calculateChecksum(PRINTQUOTE_AR_AP_LEDGER_SQL),
  },
  {
    id: '0037_rename_workspace_toan_gia_phat',
    sql: RENAME_WORKSPACE_TOAN_GIA_PHAT_SQL,
    checksum: calculateChecksum(RENAME_WORKSPACE_TOAN_GIA_PHAT_SQL),
  },
  {
    id: '0038_sync_nv001_timesheet_and_remove_nv002_payroll',
    sql: SYNC_NV001_TIMESHEET_AND_REMOVE_NV002_PAYROLL_SQL,
    checksum: calculateChecksum(
      SYNC_NV001_TIMESHEET_AND_REMOVE_NV002_PAYROLL_SQL,
    ),
  },
];
