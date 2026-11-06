-- Migration: 0037_rename_workspace_toan_gia_phat
-- Rename canonical active workspace from "Hoài Phương Media" to "THIẾT KẾ IN ẤN TOÀN GIA PHÁT"
-- while preserving synthetic/test/drill workspaces untouched.

UPDATE workspaces
SET name = 'THIẾT KẾ IN ẤN TOÀN GIA PHÁT'
WHERE status = 'active'
  AND btrim(name) IN ('Hoài Phương Media', 'HOÀI PHƯƠNG MEDIA');
