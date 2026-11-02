# STAGING ISOLATION RUNBOOK (`W2B.7` / `F1` / `OA-24`)

## 1. Mục tiêu Cô lập Tuyệt đối (Zero Production Impact)

Môi trường Staging cục bộ được thiết kế để nghiệm thu bản build (`dist/` và `apps/web/dist/`) trước khi trình Owner ký phát hành qua `Owner-Locked Release Gate`, đảm bảo **không chạm vào bất kỳ tài nguyên Production nào**:

| Thành phần             | Production (`C:\HoaiPhuong-Server`)            | Staging Cô lập (`C:\ML-Test`)                      | Cơ chế Chặn (`Fail-Closed`)                                            |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| **Web Frontend**       | `127.0.0.1:3001` (`HPManagementLiteWeb`)       | `127.0.0.1:4001` (`scripts/runtime/serve-web.cjs`) | Từ chối khởi chạy nếu cổng thuộc danh sách cấm (`3000..3028`, `55432`) |
| **Backend API**        | `127.0.0.1:3002` (`HPManagementLiteApi`)       | `127.0.0.1:4002` (`dist/apps/api/src/main.js`)     | Chỉ lắng nghe `127.0.0.1:4002`, khóa CORS vào `http://127.0.0.1:4001`  |
| **PostgreSQL Cluster** | `127.0.0.1:55432` (`HPManagementLiteDatabase`) | `127.0.0.1:55433` (`C:\ML-Test\pgdata`)            | Kiểm tra `pg_control_system().system_identifier` khác hẳn Production   |
| **Tên Database**       | `management_lite_test` (trên `55432`)          | `management_lite_staging_test` (trên `55433`)      | `isSafeTestDatabase` chặn cứng cổng `55432` và user `hp_test_admin`    |
| **Session Cookie**     | `mglite_session`                               | `ml_staging_session` (`SESSION_COOKIE_NAME`)       | Ngăn trình duyệt ghi đè cookie phiên đăng nhập của Owner trên cùng máy |
| **Secret / Vault Key** | Secret thật tại `C:\HoaiPhuong-Server\config`  | Khoá ngẫu nhiên tạm thời sinh mới mỗi phiên        | Không đọc `.env` hoặc `pgpass.conf` của Production                     |

## 2. Lệnh Kiểm tra Cấu hình Staging (Read-Only / Không mở cổng)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\staging\Manage-StagingEnv.ps1 -Action VerifyConfig
```

## 3. Kiểm thử Toàn bộ Endpoint & Phiên Staging Cô lập (`QA_API_BASE` / `QA_WEB_BASE`)

Để chạy 4 bộ kiểm thử tích hợp HTTP/Session (`audit-endpoint`, `issues-endpoint`, `reports-endpoint`, `unified-staging-session`) trên cặp máy chủ API + Web proxy cô lập gắn với cụm PostgreSQL `C:\ML-Test` (`55433`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-env\Manage-TestEnv.ps1 `
  -Action RunAll `
  -OnlyFiles audit-endpoint.test.mjs,issues-endpoint.test.mjs,reports-endpoint.test.mjs,unified-staging-session.test.mjs
```
