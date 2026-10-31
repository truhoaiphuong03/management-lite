-- =============================================================================
-- Management Lite — Phase 18 Hot-Path Composite & Expression Indexes
-- Safe to run online (idempotent CREATE INDEX IF NOT EXISTS).
-- Kept outside packages/database/src/migrations/ so SCOPED_WINDOW API/Web
-- releases remain deployable without altering migrationCount=30.
-- =============================================================================

-- 1. TikTok V4 Bridge deduplication lookup by [TIKTOK_V4_REF:...] header line
CREATE INDEX IF NOT EXISTS idx_work_items_ws_v4_ref
  ON work_items (workspace_id, (split_part(description, chr(10), 1)))
  WHERE description LIKE '[TIKTOK_V4_REF:%';

-- 2. Keyset cursor pagination on attendance_shifts (Owner listShifts & Staff getAttendanceMe)
CREATE INDEX IF NOT EXISTS idx_attendance_shifts_ws_clock_in_id
  ON attendance_shifts (workspace_id, clock_in_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_shifts_ws_emp_clock_in_id
  ON attendance_shifts (workspace_id, employee_id, clock_in_at DESC, id DESC);

-- 3. Daily reports keyset pagination
CREATE INDEX IF NOT EXISTS idx_daily_reports_ws_date_id
  ON daily_reports (workspace_id, report_date DESC, id DESC);

-- 4. Finance ledger date-ordered filtering
CREATE INDEX IF NOT EXISTS idx_finance_entries_ws_date_created
  ON finance_entries (workspace_id, entry_date DESC, created_at DESC);

-- 5. Storage folder file listings
CREATE INDEX IF NOT EXISTS idx_storage_files_ws_folder_created
  ON storage_files (workspace_id, folder_id, created_at DESC);
