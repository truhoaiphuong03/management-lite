# Kế hoạch khắc phục sau kiểm toán toàn diện (2026-10-31, nền `v0.3.2`)

> Trạng thái: **CHỜ OWNER DUYỆT** — chưa có dòng code nào được viết cho kế hoạch này.
> Nguyên tắc: chỉ làm trên DEV/SANDBOX; triển khai Production chỉ qua đường phát hành được Owner phê duyệt.

## Phase 14 (`v0.3.3`) — Bảo mật khẩn (P0)

| Task | Nội dung | File mục tiêu | Nghiệm thu |
|---|---|---|---|
| 14.1 | `getClientIp`: không tin phần tử đầu `X-Forwarded-For`; dùng `CF-Connecting-IP` hoặc phần tử phải nhất chưa tin cậy. Thêm khóa chống dò mật khẩu theo **tài khoản** (backoff) ngoài khóa theo IP | `apps/api/src/app.ts`, `apps/api/src/auth/service.ts`, `apps/api/src/config.ts` | Test: peer tin cậy + XFF giả không đổi được khóa; 6 lần sai liên tiếp bị chặn dù đổi IP |
| 14.2 | Header bảo mật cho web + API: CSP, `frame-ancestors 'none'`/`X-Frame-Options`, HSTS, Referrer-Policy, Permissions-Policy. Chuyển script theme inline ra file | `scripts/runtime/serve-web.cjs` (đưa vào repo), `apps/api/src/app.ts` (`sendJson`), `apps/web/index.html` | Test header trên mọi phản hồi; không vỡ giao diện |
| 14.3 | Validate `X-Request-Id`; gom `sessionCookieName` vào closure `requireAuth` (41/50 chỗ đang bỏ sót); handler `uncaughtException`/`unhandledRejection`; timeout cho server + proxy | `apps/api/src/app.ts`, `apps/api/src/main.ts`, `apps/api/src/server.ts` | Test đặt `SESSION_COOKIE_NAME` tùy chỉnh vẫn đăng nhập được mọi route |
| 14.4 | Job dọn `auth_sessions` hết hạn >7 ngày, `idempotency_records` quá TTL; `statement_timeout=15s`, `application_name` | `apps/api/src/auth/service.ts`, `packages/database/src/config.ts`, migration `0031` | Test dọn dữ liệu; truy vấn treo bị cắt |

## Phase 15 (`v0.5.2`) — Tốc độ tải trang — **ĐÃ XONG**

> Đánh số lại: phiên UI đã phát hành `v0.5.0` và giữ `v0.5.1` cho Phase UI-5, nên các Phase 15–19 lấy số trống kế tiếp tại thời điểm phát hành (Phase 15 = `v0.5.2`).
> Kết quả đo: JS tải lần đầu `1.080 kB → 418 kB` thô, `260 kB → 119 kB` nén; tải lại không còn request asset nào (đã kiểm chứng bằng Chrome thật).

| Task | Nội dung | File mục tiêu | Nghiệm thu |
|---|---|---|---|
| 15.1 | Máy chủ tĩnh: `/assets/*` cache `immutable` 1 năm, `index.html` `no-cache`+ETag, nén brotli/gzip, 404 thật cho asset thiếu, fs bất đồng bộ | `scripts/runtime/serve-web.cjs` | Tải lần 2 ≈ 0 KB JS; có `content-encoding` |
| 15.2 | `React.lazy` + `Suspense` theo route (hiện 0 lazy, 29 màn nạp cùng lúc) | `apps/web/src/App.tsx`, `apps/web/vite.config.ts` | JS khởi đầu ≤ 500 KB thô / ≤ 140 KB gzip (hiện 1.080 / 260 KB) |
| 15.3 | `/api/v1/health`: tính thông tin phát hành 1 lần lúc khởi động, bỏ `execFileSync git` và đọc file đồng bộ mỗi request | `apps/api/src/app.ts` | Không còn lệnh đồng bộ trong health |
| 15.4 | ~~`AccountsScreen`: bỏ `setInterval 500ms`~~ **Bỏ có chủ đích:** timer chỉ tồn tại ≤30 giây khi đang hiện bí mật và điều khiển đồng hồ đếm ngược; không phải polling nền. Mục P-06 của kiểm toán đã đánh giá sai | `apps/web/src/screens/AccountsScreen.tsx` | Không đổi; test ACC-005 giữ nguyên |
| 15.5 | Script ngân sách bundle chạy trong `verify` | `scripts/check-bundle-budget.mjs` | Fail khi vượt ngân sách |

## Phase 16 (`v0.5.4`) — Toàn vẹn phát hành & nợ kiểm thử — **ĐÃ XONG**

| Task | Nội dung | File mục tiêu |
|---|---|---|
| 16.1 | Sinh `build-info` tự động từ git lúc build; bỏ `SYSTEM_COMMIT` sửa tay và `release-version.json` viết tay; một nguồn sự thật duy nhất | `scripts/gen-build-info.mjs`, `packages/contracts/src/version.ts`, `apps/api/src/app.ts` |
| 16.2 | Quy trình phát hành qua cổng Owner (`owner-locked-gate`), tài liệu hóa, thay cách chép tay | `scripts/deployment/*`, `docs/` |
| 16.3 | `.gitattributes` + `endOfLine` Prettier để hết 394 file lệch format | `.gitattributes`, `.prettierrc.json` |
| 16.4 | Sửa 11 test đang đỏ (5 file): cập nhật test lỗi thời hoặc sửa code thật; bắt buộc chạy **toàn bộ** `tests/web` + `tests/security` trước mỗi lần báo PASS | `tests/web/{mobile-responsive-p0,ui-demo,ui-fix-45,uiux-audit-01,version}.test.mjs` |

## Phase 17 (`v0.5.4`) — Điện thoại 320px & hồi quy giao diện — **ĐÃ XONG**

| Task | Nội dung | File mục tiêu |
|---|---|---|
| 17.1 | Tìm và sửa **7 phần tử tràn ngang ở 320px** (Chrome headless đã phát hiện) | `tests/web/mobile-responsive-p0.test.mjs`, các màn liên quan |
| 17.2 | Khôi phục mẫu `minmax(min(100%, 240px), 1fr)` ở Dashboard (hoặc cập nhật test có chủ đích) | `apps/web/src/screens/DashboardScreen.tsx` |
| 17.3 | Bỏ `transition: 'all'` ở WorkScreen; sửa nhãn "Vấn đề & Issues" | `apps/web/src/screens/WorkScreen.tsx`, `DashboardScreen.tsx` |

## Phase 18 (`v0.5.5`) — Hiệu năng backend/DB & sức khỏe mã nguồn — **ĐÃ XONG**

| Task | Nội dung | File mục tiêu |
|---|---|---|
| 18.1 | Tách `app.ts` thành module route (`schedules`, `accounts`, `storage`, `issues/audit`) + bảng định tuyến `RouteTable` (`O(1)` exact + prefix dispatch); không đổi hành vi | `apps/api/src/app.ts`, `apps/api/src/routes/*` |
| 18.2 | Phân trang keyset (`cursor`) cho `attendance`; gộp insert lịch trực bằng `unnest` (`insertScheduleEntriesBatch`); giữ toàn vẹn truy vấn Bridge V4 | `attendance/service.ts`, `schedules/service.ts` |
| 18.3 | Tách các module hàm tiện ích giao diện độc lập (`payroll-helpers.ts`, `work-helpers.ts`, `accounts-helpers.ts`, `storage-helpers.ts`) khỏi 4 màn hình lớn | `apps/web/src/screens/*`, `apps/web/src/screens/helpers/*` |
| 18.4 | Bộ chỉ mục tối ưu đường nóng (`ensure-hot-indexes.sql`) & công cụ đo `EXPLAIN ANALYZE` (`explain-hot-queries.mjs`) | `scripts/perf/*`, `tests/backend/phase18-perf-architecture.test.mjs` |

## Phase 19 (`v0.5.6`) — Vệ sinh dữ liệu & vận hành — **ĐÃ XONG (Code & Công cụ Dry-Run)**

| Task | Nội dung |
|---|---|
| 19.1 | Nhận diện workspace thử nghiệm bằng cờ `is_test` (`isTestWorkspaceRecord`) & công cụ kiểm toán `scripts/ops/audit-test-workspaces.mjs` (chế độ đọc an toàn) |
| 19.2 | Công cụ kiểm toán vệ sinh biến môi trường & sinh bộ khóa xoay vòng CSPRNG (`scripts/ops/audit-secrets-hygiene.mjs`) |
| 19.3 | Công cụ diễn tập khôi phục sao lưu cô lập trong transaction (`scripts/ops/backup-restore-drill.mjs`), đo RPO/RTO và kiểm tra SHA-256 |
| 19.4 | Chuẩn hóa kiểm tra Ngày sinh (`YYYY-MM-DD` / `DD/MM/YYYY`), Số tài khoản chỉ chữ số (`6–25 số`) trong `profile-validator.ts`, sửa lỗi thiếu `$` SQL placeholder trong `EmployeeService` & công cụ `scripts/ops/verify-profile-data.mjs` |
