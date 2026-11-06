-- Rollback script for 0037_rename_workspace_toan_gia_phat

BEGIN;

UPDATE workspaces
SET name = 'Hoài Phương Media'
WHERE status = 'active'
  AND btrim(name) = 'THIẾT KẾ IN ẤN TOÀN GIA PHÁT';

DELETE FROM schema_migrations
WHERE id = '0037_rename_workspace_toan_gia_phat';

COMMIT;
