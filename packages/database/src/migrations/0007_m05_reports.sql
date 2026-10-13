-- Migration: 0007_m05_reports
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
