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
];
