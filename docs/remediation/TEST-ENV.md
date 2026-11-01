# Môi trường TEST cô lập (`C:\ML-Test`, PostgreSQL 127.0.0.1:55433)

Tạo/vận hành bằng `scripts/test-env/Manage-TestEnv.ps1`. **Không** thuộc Production; không dùng tài khoản, khóa, dump hay cụm của Production.

## Lệnh

| Việc                                              | Lệnh                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Tạo (một lần)                                     | `powershell -File scripts\test-env\Manage-TestEnv.ps1 -Action Create`                                  |
| Trạng thái + kiểm tra cô lập                      | `… -Action Status`                                                                                     |
| Bật / tắt cụm                                     | `… -Action Start` / `… -Action Stop`                                                                   |
| Chạy test theo từng tệp, mỗi tệp một DB mới       | `… -Action RunTestsPerFile -TestPaths tests/database,tests/backend [-OnlyFiles a.test.mjs,b.test.mjs]` |
| Chạy một lượt dùng chung 1 DB (không khuyến nghị) | `… -Action RunTests -TestPaths tests/backend`                                                          |
| Xóa toàn bộ                                       | `… -Action Remove` (dừng cụm, từ chối nếu có junction, xóa `C:\ML-Test`)                               |

## Bảo đảm cô lập (script tự kiểm tra, fail-closed)

- Mọi thứ nằm trong `C:\ML-Test`; cổng `55433` ≠ `55432`; chỉ lắng nghe `127.0.0.1`.
- Cụm mới (`initdb`) ⇒ `system_identifier` khác Production (đọc `pg_controldata` của Production **chỉ để so sánh**, không kết nối); script **hủy** nếu trùng.
- Binary (Node 22.14.0, PostgreSQL 18.6) được **sao chép** từ thư mục runtime của Production (nguồn chỉ đọc); không chạy từ đường dẫn Production.
- Vai trò và mật khẩu ngẫu nhiên, lưu ở `C:\ML-Test\secrets` (ACL: chỉ người dùng hiện tại, SYSTEM, Administrators). Biến môi trường kết nối chỉ tồn tại trong tiến trình test.
- Khi chạy test: xóa mọi biến bí mật Production khỏi môi trường; `ACCOUNT_SECRET_KEY` là khóa **giả sinh ngẫu nhiên** cho mỗi tệp; `DATABASE_URL` trỏ DB "sentinel" rỗng và được kiểm tra không có bảng nào sau khi chạy (như CI).

## Cách chạy test (và lý do)

- **Mỗi tệp test một cặp DB mới** (`management_lite_test_NNN`, `fin_qa_NNN`) — nhiều test yêu cầu "DB phải rỗng khi bắt đầu"; chạy chung một DB làm 4 test database thất bại giả.
- Tệp cần DB đã migrate (`att-mvp`, `rep-mvp`, `work`, `schedule` như CI, cộng `acc-e2e`, `comprehensive-business-e2e`, `privileged-script-safety`, `recover-owner-access`) được migrate trước bằng migrator của repo.
- **BLOCKED (không chạy):**
  - `auth-remember-01-cutover-fallback.test.mjs` — xem cảnh báo dưới.
  - `audit-endpoint`, `issues-endpoint`, `reports-endpoint`, `unified-staging-session` — cần API+web QA đang chạy (`QA_API_BASE`, `QA_WEB_BASE`) = STAGING (Đợt 2B).

## ⚠️ Cảnh báo an toàn: bộ test điều khiển bộ phát hành

`tests/backend/auth-remember-01-cutover-fallback.test.mjs` chạy `scripts/deployment/Deploy-SemiAutoWindows.ps1 -SandboxMode`. Dù ở chế độ sandbox, bộ điều khiển này **mã hóa cứng cổng `55432`, người dùng `hp_test_admin` và tệp `pgpass.conf` thật của Production** (`$realServerRoot\config\test-secrets\pgpass.conf`, `Deploy-SemiAutoWindows.ps1:65-66, 280-302, 1580-1581`) để kiểm tra `schema_migrations` của DB tên `management_lite_cutover_qa_*_test`. Khi chạy test này trên máy có Production, bộ điều khiển sẽ **cố kết nối chỉ-đọc tới cụm Production** (DB không tồn tại ⇒ thất bại) và, nếu bước `-RunMigrations` chạy với tên DB trùng một DB thật, **có thể chạy migration vào Production**. Xem báo cáo Đợt 2A (sự cố S1). Hướng sửa (Đợt 2B, cần duyệt vì chạm release gate): tham số hóa `-DbPort`/`-PgPassFile`/`-PgBin` và buộc `-SandboxMode` dùng cấu hình sandbox, không đọc `$realServerRoot`.

## Rollback

`-Action Remove`. Môi trường không chứa dữ liệu thật; việc xóa không ảnh hưởng Production.
