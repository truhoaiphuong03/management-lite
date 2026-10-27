-- Migration: 0029_report_entry_work_item
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
