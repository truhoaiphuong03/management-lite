-- Migration: 0021_m11_bug_ai_management
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
