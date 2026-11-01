# P0-B — Thiết kế tách môi trường DEV / TEST / STAGING / PRODUCTION

**Trạng thái:** DỰ THẢO thiết kế (chưa tạo gì, chưa đổi cấu hình). Mọi mục "sẽ" cần Owner duyệt theo từng đợt.

## 1. Hiện trạng đã xác minh (bằng chứng)

| Phát hiện                                                                                                                                                      | Bằng chứng                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Cụm PostgreSQL **Production** nằm ở thư mục tên `C:\HoaiPhuong-Server\database\postgres-test`, cổng `55432` (`postmaster.pid` khớp tiến trình lắng nghe)       | báo cáo PREDEPLOY §8          |
| DB `management_lite_test` là DB ứng dụng Production; DB `management_lite_integration_test` (dành cho test) được `Initialize-TestDatabase.ps1` tạo **cùng cụm** | `Initialize-TestDatabase.ps1` |
| Bảo vệ test dựa vào tên DB; chỉ chặn đúng `management_lite_test` ở cổng `55432` (`packages/database/src/config.ts:293-304`)                                    | đọc mã                        |
| Thư mục Production là working copy Git (detached HEAD) và là nơi phục vụ web                                                                                   | `Test-ProdProvenance.ps1`     |
| Không có staging chạy thật; có sẵn công cụ staging (`package-windows-staging.mjs`, `staging-runtime.mjs`, `Verify-StagingBundle.ps1`)                          | `scripts/deployment/`         |
| Runtime Production: Node 22.14.0 (`C:\HoaiPhuong-Server\config\runtime\node-v22.14.0-win-x64`)                                                                 | cấu hình dịch vụ WinSW        |

## 2. Bản đồ môi trường đề xuất

|                    | DEV                                        | TEST                                      | STAGING                                                        | PRODUCTION                                  |
| ------------------ | ------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| Mục đích           | viết mã, thử giao diện                     | test tự động, test phá hủy, restore drill | diễn tập phát hành, UAT, hiệu năng                             | phục vụ người dùng thật                     |
| Thư mục            | worktree `C:\Projects\<repo>[-<việc>]`     | `C:\ML-Test\`                             | `C:\ML-Staging\`                                               | `C:\HoaiPhuong-Server\`                     |
| Web / API          | Vite `5173`/`5199` (+ API tùy chọn `4100`) | tiến trình test, cổng ngẫu nhiên loopback | `4001` / `4002` (`serve-web.cjs`)                              | `3001` / `3002`                             |
| PostgreSQL         | không dùng hoặc DB tạm trong cụm TEST      | cụm riêng `55433`                         | cụm riêng `55434`                                              | cụm `55432`                                 |
| Dữ liệu            | giả (fixture)                              | **giả**, sinh theo lần chạy               | bản **ẩn danh** (che email/SĐT/STK/tên) hoặc giả               | thật                                        |
| Bí mật             | không có bí mật thật; giá trị giả          | sinh ngẫu nhiên mỗi lần, lưu ngoài repo   | **bộ khóa riêng của staging** (không dùng lại khóa Production) | `config\test-secrets\api.env` (ACL hạn chế) |
| Tên cookie phiên   | mặc định                                   | `mglite_test_session`                     | `mglite_stg_session`                                           | cấu hình Production                         |
| Ai/cái gì được ghi | AI + dev trong worktree                    | script test (xóa được)                    | script staging có chủ đích                                     | **chỉ cổng Owner**                          |
| Truy cập mạng      | loopback                                   | loopback                                  | loopback hoặc hostname riêng sau Cloudflare Access             | Cloudflare tunnel công khai                 |
| Node               | runtime 22.14.0                            | runtime 22.14.0                           | runtime 22.14.0                                                | runtime 22.14.0 (đã có)                     |

## 3. Quy tắc cô lập (bất biến)

1. **Luồng dữ liệu một chiều:** Production → (ẩn danh) → STAGING/TEST. Không bao giờ ngược lại. Dump thật chỉ vào TEST/STAGING khi Owner duyệt từng lần và phải xóa sau khi dùng.
2. **Không dùng chung bí mật** giữa các môi trường; khóa mã hóa Production không được sao chép xuống môi trường thấp.
3. **Không dùng chung cụm PostgreSQL:** TEST và STAGING là hai cụm riêng; không tạo DB test trong cụm `55432` (xóa đường "DB integration test cùng cụm").
4. **Tên không được gây hiểu lầm:** không dùng từ `test` cho tài nguyên Production. Việc đổi tên `postgres-test`/`management_lite_test` là thay đổi Production (cần cửa sổ bảo trì, backup, rollback) → chỉ _đề xuất_; trước mắt phải có ghi chú "THƯ MỤC NÀY LÀ PRODUCTION" trong runbook và guard kiểm tra theo `system_identifier`, không theo tên.
5. **Biến `ML_ENV`** (`dev|test|staging|production`) bắt buộc khi khởi động API/web; API từ chối các tổ hợp mâu thuẫn (ví dụ `ML_ENV=test` + cổng DB `55432`, `ML_ENV=staging` + khóa trùng khóa Production). _(Thay đổi mã — đề xuất cho Đợt sau, chưa làm.)_
6. **Guard test** phải từ chối mọi URL trỏ cổng `55432` và so `system_identifier` với danh sách cấm, không chỉ kiểm tên DB. _(Đề xuất, chưa làm.)_
7. **Đường dẫn:** mọi công cụ dev/test/staging từ chối ghi dưới `C:\HoaiPhuong-Server`.

## 4. Đường thăng cấp (promotion)

```
nhánh làm việc (DEV)
   └─ test cục bộ (TEST: cụm riêng, dữ liệu giả)
        └─ CI GitHub (Node 22.14.0, Postgres dùng một lần) → gói phát hành + manifest SHA-256
             └─ STAGING: triển khai gói bằng cùng script, chạy checklist, restore drill, đo hiệu năng
                  └─ Owner ký (Ed25519) → cổng phát hành → PRODUCTION
                       └─ kiểm chứng sau triển khai (Test-ProdProvenance + checklist)
```

Một gói **không được thay đổi** giữa các bước; staging và production dùng _cùng một_ gói (cùng SHA-256).

## 5. Nhu cầu tài nguyên (máy hiện tại)

- RAM trống quan sát được chỉ ~1,5–2,1 GB (máy 11,9 GB, dùng chung với Production và nhiều phiên). Mỗi cụm PostgreSQL phụ: `shared_buffers=32MB`, `max_connections=20`.
- Chỉ chạy TEST/STAGING khi cần và tắt ngay sau đó; không chạy song song với build lớn.
- Ổ `C:` còn ~45 GB; mỗi cụm phụ < 1 GB với dữ liệu hiện tại (dump ~0,4 MB).

## 6. Lộ trình áp dụng (từng bước cần phê duyệt)

| Bước | Việc                                                                 | Phụ thuộc                      |
| ---- | -------------------------------------------------------------------- | ------------------------------ |
| 1    | Hoàn tất tài liệu này, Owner duyệt bản đồ                            | W1                             |
| 2    | Dựng TEST `C:\ML-Test` (cụm `55433`) — Đợt 2                         | OA-4                           |
| 3    | Dựng STAGING `C:\ML-Staging` (`4001/4002`, cụm `55434`), khóa riêng  | Đợt 5                          |
| 4    | Thêm `ML_ENV` + guard cổng/identifier (mã)                           | duyệt thiết kế                 |
| 5    | Đổi tên/ghi nhãn tài nguyên Production gây hiểu lầm (cửa sổ bảo trì) | OA-18 + backup + restore drill |

## 7. Tiêu chí PASS khi triển khai thiết kế

- Mỗi môi trường có thư mục, cổng, cụm DB, bộ khóa **riêng** và liệt kê được bằng một lệnh chỉ đọc.
- `system_identifier` của TEST/STAGING ≠ Production (đọc từ cụm TEST/STAGING, **không truy vấn Production**).
- Test âm tính: công cụ TEST từ chối URL cổng `55432` và đường dẫn dưới `C:\HoaiPhuong-Server`.
- Gói phát hành staging và production có cùng SHA-256.

## 8. Rollback

Mỗi môi trường phụ là thư mục + cổng riêng → rollback = dừng tiến trình và xóa thư mục tương ứng (có script `Remove-*`). Không có bước nào thay đổi Production trong thiết kế này trừ bước 5 (có quy trình riêng).
