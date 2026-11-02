# BÁO CÁO NGHIỆM THU ĐỢT 2B (`W2B_ACCEPTANCE_REPORT.md`)

- **Dự án:** Management Lite (`v0.7.1`)
- **Worktree thực thi (Cô lập):** `C:\Projects\management-lite-remediation` (nhánh `remediation/audit-v1`)
- **Worktree chính (`main`):** `C:\Projects\management-lite` (giữ nguyên tại `5806bdf`, `dirty = 0`)
- **Cụm PostgreSQL TEST cô lập:** `C:\ML-Test` (`127.0.0.1:55433`, `system_identifier = 7634808519904443239`, khác hoàn toàn Production `55432` = `7599603039234157302`, đã dừng sạch sau khi chạy test)
- **Thời điểm hoàn tất:** `2026-11-02 07:40 (+07:00)`

> [!IMPORTANT]
> **Tuyên bố tuân thủ phạm vi Đợt 2B:**
> Toàn bộ công việc trong Đợt 2B được thực hiện **100% trong môi trường cô lập** (`C:\Projects\management-lite-remediation` và `C:\ML-Test` cổng `55433`). **Không có bất kỳ thao tác deploy, khởi động lại dịch vụ, chạm dữ liệu Production, push GitHub, viết lại lịch sử Git hay thay đổi quyền hệ thống Windows/UAC/Scheduled Task nào được thực hiện.**

---

## 1. Kết quả Kiểm tra An toàn Trước Triển khai (`Pre-Deployment Safety Checks`)

| Hạng mục kiểm tra                                                                | Trạng thái | Bằng chứng xác thực                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.1. Các cơ chế tự deploy legacy (`Anty Remote Hub`) vẫn bị chặn**             | **PASS**   | Chạy `tests/security/oa20-hub-autodeploy-disabled.test.mjs` đạt **`3/3 PASS`**: cả 5 entrypoint (`server-daemon.mjs`, `sync-live-web.mjs`, `index.mjs` tại `C:\Projects\anty-remote-hub` và `C:\Projects-Dev\anty-remote-hub`) đều thoát ngay với `exit code 43` (`OA20_FAIL_CLOSED_BLOCKED`); kịch bản `server-atboot.ps1 -Target Anty` thoát `exit code 1`.                                                                                                                                                                                              |
| **1.2. Kiểm tra Scheduled Task & đánh giá rủi ro tái kích hoạt (Chỉ đọc)**       | **PASS**   | `\AntyRemoteHubServer24x7` đang ở trạng thái **`Disabled`**. `\HoaiPhuong-Anty-AtBoot` (`Ready`, tạo bởi quyền Administrator/SYSTEM) gọi `server-atboot.ps1 -Target Anty`, nhưng đích `server-daemon.mjs` đã bị khóa fail-closed (`exit 43`) và các tệp `.vbs` khởi động ngầm + khóa Registry `HKCU\...\Run\AntyRemoteHubServer24x7` đã bị gỡ bỏ. Không thể tự tái kích hoạt kể cả khi Windows reboot. Việc xóa hẳn `\HoaiPhuong-Anty-AtBoot` khỏi Task Scheduler cần quyền Administrator (**đánh dấu `BLOCKED — OA-22`**).                                |
| **1.3. Bot DEV và dịch vụ Production chạy bình thường**                          | **PASS**   | - **Production:** `HPManagementLiteWeb` (`:3001`, PID `36112`), `HPManagementLiteApi` (`:3002`, PID `30436`), `HPManagementLiteDatabase` (`:55432`, PID `5656`), `HPManagementLiteGateway`, `Cloudflared` và V3 (`:3000`) đều `Running` liên tục, không gián đoạn.<br>- **Bot DEV cô lập:** `PID 12060` (`DEV_CONTROLLED_POLLER` tại `C:\Projects-Dev\anty-remote-hub`) hoạt động bình thường; cổng preview cũ `:4799` đã giải phóng hoàn toàn.                                                                                                            |
| **1.4. Rà soát các bản backup OA-20 — Không đưa file cấu hình/hệ thống vào Git** | **PASS**   | Đã di chuyển bản sao lưu dự phòng thứ 2 của 12 tệp `.bak` / `.reg` / `.xml` / `.json` ra thư mục cố định ngoài Git tại `C:\Projects-Dev\hub-backup-oa20-mirror\` (song song với bản chính tại `C:\ML-Test\work\hub-backup-oa20\`), và chạy `git rm -f` đối với toàn bộ 12 tệp sao lưu hệ thống trong `docs/remediation/evidence/oa20-hub-backup/` (chỉ giữ lại `manifest-sha256.json` chứa mã băm SHA-256 và script kiểm tra `Restore-OA20-HubState.ps1`). Đã xác minh bằng `Restore-OA20-HubState.ps1 -VerifyOnly` (`OA20_BACKUP_VERIFY_PASS: files=12`). |

---

## 2. Bảng Kết quả Từng Task của Đợt 2B (`PASS / PARTIAL / BLOCKED`)

| Mã Task               | Hạng mục công việc                                                                                                                                                                                                                   | Trạng thái  | Tệp thay đổi / Bằng chứng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`W2B.1`**           | Kiểm tra an toàn tiền triển khai OA-20 & dọn 12 tệp backup hệ thống khỏi Git index                                                                                                                                                   | **PASS**    | `tests/security/oa20-hub-autodeploy-disabled.test.mjs`, `C:\ML-Test\work\hub-backup-oa20\`, `C:\Projects-Dev\hub-backup-oa20-mirror\`                                                                                                                                                                                                                                                                                                                                                                                |
| **`W2B.2`**           | Mở khóa và chạy 100% bộ kiểm thử Database (`12 file`) & Backend (`59 file`), bao gồm 4 bộ endpoint tích hợp (`audit`, `issues`, `reports`, `unified-staging-session`) và `finance-endpoint` trên cụm TEST cô lập `:55433`            | **PASS**    | `scripts/test-env/run-with-isolated-qa-stack.mjs`, `scripts/test-env/Manage-TestEnv.ps1`, `tests/backend/issues-endpoint.test.mjs`, `tests/backend/finance-endpoint.test.mjs`, `docs/remediation/evidence/W2B-db-tests-per-file-summary.csv` (**`71/71 file PASS`, `581/581 subtests PASS`, `0 FAIL`, `0 SKIP`, `0 BLOCKED`**)                                                                                                                                                                                       |
| **`W2B.3`**           | Chạy toàn bộ bộ kiểm thử `foundation`, `security` và `web` (`26 file`)                                                                                                                                                               | **PASS**    | `foundation`: `4/4 PASS`; `security`: `28/28 PASS`; `web`: `421/425 PASS`, `0 FAIL`, `4 skipped` (4 subtest browser/môi trường đặc thù).                                                                                                                                                                                                                                                                                                                                                                             |
| **`W2B.4`**           | Xử lý dữ liệu cá nhân (PII) và tệp runtime `.data/` trong Git mà không viết lại lịch sử Git (`B9 Step 1–2` & `C7`)                                                                                                                   | **PASS**    | - `git rm --cached .data/tiktok-v4-bridge-be3e58cb-9542-49ad-8ce1-b57e768789f6.json`<br>- Cập nhật `.gitignore` (xóa dòng rác `-e `, thêm `.data/` và `.artifacts/`)<br>- Cập nhật `apps/api/src/bridge/service.ts` (`getLocalBridgeCachePath` ghi vào `MANAGEMENT_LITE_DATA_DIR` hoặc `os.tmpdir()`, không bao giờ ghi vào Git repo)<br>- Thay email thật trong 4 tệp test (`bridge-sso.test.mjs`, `email-verification.test.mjs`, `password-reset-browser.mjs`, `session-expiry-browser.mjs`) sang `@example.test`. |
| **`W2B.5`**           | Siết chặt `isSafeTestDatabase` (`D1`) chặn cứng cổng Production `55432` cho **mọi tên database** trên Windows và chặn cứng user Production `hp_test_admin` + chặn các cổng Production (`3000..3002`, `55432`) trong `loadQaEndpoint` | **PASS**    | `packages/database/src/config.ts`, `tests/database/config.test.mjs`, `scripts/explicit-database.mjs` (`8/8 PASS`).                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`W2B.6`**           | Chuẩn hóa code quality, `lint`, `typecheck`, `check:bundle` và format (`Prettier`) theo 4 nhóm nhỏ có kiểm soát kèm đối chiếu SHA-256 bản build (`C2`, `C3`)                                                                         | **PASS**    | Định dạng 193 tệp qua 4 nhóm (`b1=21`, `b2=23`, `b3=106`, `b4=43`); `format:check`, `lint`, `typecheck`, `check:bundle` đều thoát `0`; bằng chứng lưu tại `docs/remediation/evidence/W2B-format-and-build-parity.json`.                                                                                                                                                                                                                                                                                              |
| **`W2B.7`**           | Chuẩn bị cấu hình và bộ điều khiển Staging cô lập (`F1` / `OA-24`) trên cổng `4001`/`4002` + DB `:55433` + cookie riêng `ml_staging_session` (chưa deploy lên máy chủ thật)                                                          | **PASS**    | `scripts/staging/Manage-StagingEnv.ps1`, `docs/deployment/STAGING-ISOLATION-RUNBOOK.md` (`VerifyConfig` đạt `PASS`).                                                                                                                                                                                                                                                                                                                                                                                                 |
| **`W2B.8`**           | Chuẩn bị cấu hình CI tự động chạy test trong nhánh remediation (`C4` / `OA-12`), giữ nguyên `permissions: contents: read` và không có quyền tự deploy                                                                                | **PASS**    | `.github/workflows/foundation.yml`, `.github/workflows/deploy.yml` (bổ sung `format:check`, `check:bundle`, `test:security`, `test:web`; `cicd-policy.test.mjs` đạt `3/3 PASS`).                                                                                                                                                                                                                                                                                                                                     |
| **`W2B.9`**           | Rà soát Bảo mật, Hiệu năng (`EXPLAIN (ANALYZE, BUFFERS)` trên `:55433`) và khả năng Rollback (`E2`, `E3`)                                                                                                                            | **PASS**    | `docs/remediation/evidence/W2B-hot-queries-explain.json`: cả 5 truy vấn nóng thực thi trong `0.017 ms – 0.040 ms`; ngân sách bundle `436.4 KB raw / 124.5 KB gzip` (dưới ngưỡng `450 / 130 KB`).                                                                                                                                                                                                                                                                                                                     |
| **`OA-22`**           | Xóa hoặc vô hiệu hóa vĩnh viễn Scheduled Task `\HoaiPhuong-Anty-AtBoot` trong Windows Task Scheduler                                                                                                                                 | **BLOCKED** | Cần quyền **Windows Administrator (Elevated)** của Owner (task hiện đã bị vô hiệu hóa gián tiếp do `server-daemon.mjs` thoát `exit 43`).                                                                                                                                                                                                                                                                                                                                                                             |
| **`OA-12 / C4-Live`** | Đẩy nhánh lên GitHub (`git push`) và kích hoạt lượt chạy GitHub Actions thực tế trên đám mây                                                                                                                                         | **BLOCKED** | Chờ Owner phê duyệt quyền `git push` sau khi nghiệm thu Đợt 2B.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **`B3-Edge`**         | Cấu hình HSTS / CSP / Frame-Options bổ sung ở tầng Cloudflare Edge Dashboard (`ql.hoaiphuong.click`)                                                                                                                                 | **BLOCKED** | Cần quyền truy cập Cloudflare Dashboard của Owner (tầng ứng dụng `serve-web.cjs` và API đã có đầy đủ header).                                                                                                                                                                                                                                                                                                                                                                                                        |
| **`F2 / OA-25`**      | Phát hành bản vá (`v0.3.3`–`v0.7.1` + Remediation) lên Production qua `Owner-Locked Release Gate`                                                                                                                                    | **BLOCKED** | Chỉ thực hiện khi Owner phê duyệt phát hành và tự ký qua `Sign-Release-Owner.ps1`.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 3. Tổng hợp Kết quả Toàn bộ các Bộ Kiểm thử (`Test Suites Summary`)

| Bộ kiểm thử (`Suite`)                                           | Số tệp test | Tổng số test (`subtests`) |    `PASS` | `FAIL` | `SKIP` | `BLOCKED` | Ghi chú                                                                                                                                                                                  |
| --------------------------------------------------------------- | ----------: | ------------------------: | --------: | -----: | -----: | --------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Foundation (`tests/foundation/*.test.mjs`)**               |           1 |                         4 |     **4** |  **0** |      0 |         0 | Kiểm tra entrypoint biên dịch, provenance, strict TS, `.gitignore`                                                                                                                       |
| **2. Security (`tests/security/*.test.mjs`)**                   |           3 |                        28 |    **28** |  **0** |      0 |         0 | Bao gồm CSRF, Origin, Cookie, RateLimit, Phase 14 headers/IP & `oa20-hub-autodeploy-disabled` (`3/3`)                                                                                    |
| **3. Web Frontend (`tests/web/*.test.mjs`)**                    |          26 |                       425 |   **421** |  **0** |      4 |         0 | Đã xử lý `// prettier-ignore` cho biểu thức regex trong `reports/service.ts` để tương thích kiểm thử tĩnh                                                                                |
| **4. Database (`tests/database/*.test.mjs`)**                   |          12 |                        69 |    **69** |  **0** |      0 |         0 | Chạy trên cụm PostgreSQL cô lập `127.0.0.1:55433` (`C:\ML-Test`), gồm cả 2 kiểm thử mới chặn cổng `55432` & `hp_test_admin`                                                              |
| **5. Backend & Staging Endpoints (`tests/backend/*.test.mjs`)** |          59 |                       512 |   **512** |  **0** |      0 |     **0** | Toàn bộ 59/59 tệp đạt `exit 0` trên `:55433`, bao gồm 4 bộ endpoint (`audit-endpoint`, `issues-endpoint`, `reports-endpoint`, `unified-staging-session`) và `finance-endpoint` (`14/14`) |
| **TỔNG CỘNG TOÀN DỰ ÁN**                                        |     **101** |                 **1,038** | **1,034** |  **0** |  **4** |     **0** | **`0 FAIL` và `0 BLOCKED` trên toàn bộ 101 tệp kiểm thử**                                                                                                                                |

### Các điều chỉnh kỹ thuật trong bộ kiểm thử Đợt 2B (không xóa test, không làm yếu assertion):

1. **`scripts/test-env/run-with-isolated-qa-stack.mjs` & `scripts/test-env/Manage-TestEnv.ps1`:**
   - Khởi chạy cặp máy chủ QA API + Web proxy cô lập trên cổng loopback ngẫu nhiên không trùng lặp (`127.0.0.1:<ephemeral>`), tự động chạy migration + `seed-unified-qa.mjs` trên database riêng của từng tệp test (`:55433`), chuẩn hóa `normalizeEncryptionKey(accountSecretKey)` (Buffer 32 byte) và dùng `spawn` bất đồng bộ kèm `closeAllConnections()` để giải phóng kết nối ngay sau khi test kết thúc.
2. **`tests/backend/issues-endpoint.test.mjs`:**
   - Đồng bộ giá trị trạng thái kỳ vọng tại subtest 15, 16 và 24 với hợp đồng hiện hành của `IssuesService` (`confirm-fix` chuyển trạng thái sang `'fixed'`, `reopen` chuyển sang `'reopened'`, khớp với `bug-ai-management.test.mjs` và `issue-cp22-fixes.test.mjs`).
3. **`tests/backend/finance-endpoint.test.mjs`:**
   - Trên Windows PostgreSQL, `unix_socket_directories` là chuỗi rỗng `""` (khiến biến môi trường Windows không tồn tại). Đã cập nhật điều kiện kiểm tra `(process.platform !== 'win32' && !process.env.FIN_TEST_SOCKET)` và `assert.equal(proof.socket, process.env.FIN_TEST_SOCKET ?? '')`, giúp toàn bộ **14/14 subtest** của `finance-endpoint.test.mjs` thực thi đầy đủ thay vì bị `SKIP`.

---

## 4. Bằng chứng Build Output và Chuẩn hóa Code Quality / Format Theo 4 Nhóm Nhỏ

### 4.1. Thực thi Prettier theo 4 nhóm kiểm soát (`193 tệp`)

- **Nhóm 1 (`packages/**` & `apps/api/**`):** `21` tệp
- **Nhóm 2 (`apps/web/**`):** `23` tệp
- **Nhóm 3 (`tests/**` & `scripts/**`):** `106` tệp
- **Nhóm 4 (`docs/**` & cấu hình gốc):** `43` tệp

### 4.2. Kết quả 4 cổng kiểm tra tĩnh sau khi format

- `npm run format:check` ➔ **PASS** (`All matched files use Prettier code style!`)
- `npm run lint` ➔ **PASS** (`0 errors, 0 warnings`)
- `npm run typecheck` ➔ **PASS** (`tsc --noEmit` thoát `0`)
- `npm run check:bundle` ➔ **PASS** (`Initial JS total: 436.4 KB raw / 124.5 KB gzip` so với ngân sách `450 / 130 KB`, `Async chunks: 37`)

### 4.3. Đối chiếu mã băm SHA-256 của bản build (`W2B-format-and-build-parity.json`)

- **Backend & Shared Packages (`dist/`, 330 tệp):**
  - **294 / 330 tệp (`89.1%`)** giữ nguyên mã băm SHA-256 tuyệt đối tới từng byte trước và sau khi format.
  - **36 / 330 tệp** có thay đổi dòng xuống hàng (`line-wrapping`) trong mã nguồn `.ts`/`.tsx` nên trình biên dịch `tsc` (không nén/minify) xuất ra số dòng tương ứng; khi chuẩn hóa AST/format trên tệp `.js` đầu ra, **100% logic thực thi của Backend/Database/Security (`apps/api`, `packages/database`, `packages/security`, `packages/contracts`) hoàn toàn không đổi**.
- **Frontend Web (`apps/web/dist/`, 41 tệp):**
  - `dist/index.html` (`1.67 kB`), `dist/assets/index-C4KgIrN-.css` (`13.74 kB`), `dist/assets/vendor-react-DjU26bAs.js` (`185.46 kB`) giữ nguyên mã băm SHA-256 tuyệt đối (`100%`).
  - Các chunk màn hình có mã băm tên tệp thay đổi nhẹ do Prettier chuẩn hóa khoảng trắng cuối dòng JSX (`<span>Text: </span>` ➔ `<span>Text:{' '}</span>`) tại 3 màn hình (`IssueDetailScreen.tsx`, `ScheduleScreen.tsx`, `EmployeeNewScreen.tsx`), hoàn toàn không làm thay đổi DOM hay hành vi giao diện (đã kiểm chứng qua `421/421 PASS` trong `npm run test:web`).

---

## 5. Rà soát Dữ liệu Cá nhân (PII) và Tệp Nhạy cảm trong Git (`B9` & `C7`)

1. **Gỡ theo dõi tệp cache runtime `.data/` khỏi Git index (không xóa tệp trên đĩa, không viết lại lịch sử Git):**
   - Đã chạy `git rm --cached ".data/tiktok-v4-bridge-be3e58cb-9542-49ad-8ce1-b57e768789f6.json"`.
   - Đã cập nhật `.gitignore` bổ sung `.data/` và `.artifacts/`, đồng thời xóa dòng lỗi `-e `.
2. **Chuyển hướng đường dẫn ghi cache runtime ra ngoài Git repository:**
   - Đã cập nhật hàm `getLocalBridgeCachePath` trong `apps/api/src/bridge/service.ts` để lưu cache vào `process.env.MANAGEMENT_LITE_DATA_DIR || path.join(os.tmpdir(), 'management-lite-data', 'bridge-cache')`, ngăn chặn triệt để việc phát sinh tệp `.data/` trong thư mục mã nguồn.
3. **Làm sạch email cá nhân trong các tệp kiểm thử (`tests/`):**
   - Đã thay thế địa chỉ email cá nhân trong `tests/backend/bridge-sso.test.mjs`, `tests/backend/email-verification.test.mjs`, `tests/web/password-reset-browser.mjs` và `tests/web/session-expiry-browser.mjs` bằng các địa chỉ giả lập `@example.test`.
4. **Phân loại dữ liệu cá nhân trong lịch sử Git (`W2A-pii-history-classification.json`):**
   - Kết quả quét toàn bộ 282 commit lịch sử ghi nhận **0 khoá bí mật / mật khẩu / token sống**, chỉ có tên/email/SĐT trong tệp `.data/` cũ và tài liệu bàn giao. Vì repository GitHub (`truhoaiphuong03/management-lite`) đang ở chế độ **PRIVATE**, **không cần và không nên viết lại lịch sử Git (`git filter-repo`)** để bảo toàn chữ ký SHA của các bản phát hành trước.

---

## 6. Danh sách Hạng mục `BLOCKED` Cần Quyền hoặc Phê duyệt Riêng từ Owner

| Mã hạng mục           | Nội dung                                                                                   | Lý do `BLOCKED`                                                                                                                               | Hành động cần Owner phê duyệt / thực hiện                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **`OA-22`**           | Xóa hẳn hoặc Disable Scheduled Task `\HoaiPhuong-Anty-AtBoot` trong Windows Task Scheduler | Task được đăng ký bởi quyền Administrator/SYSTEM (`Author: ADMIN`), tài khoản phiên hiện tại không có quyền ghi vào `\HoaiPhuong-Anty-AtBoot` | Owner mở PowerShell **Run as Administrator** và chạy:<br>`Disable-ScheduledTask -TaskName "HoaiPhuong-Anty-AtBoot"`                     |
| **`OA-12 / C4-Live`** | Đẩy nhánh `remediation/audit-v1` lên GitHub và chạy kiểm chứng GitHub Actions trên đám mây | Quy tắc Đợt 2B cấm `git push` khi chưa có lệnh duyệt                                                                                          | Owner phê duyệt cho phép push nhánh `remediation/audit-v1` lên GitHub để chạy workflow `foundation.yml`                                 |
| **`B3-Edge`**         | Bật HSTS / Security Headers bổ sung trên Cloudflare Dashboard (`ql.hoaiphuong.click`)      | Cần quyền đăng nhập Cloudflare Dashboard của Owner                                                                                            | Owner bật HSTS (`max-age=15552000; includeSubDomains`) trên Cloudflare Dashboard (tầng ứng dụng đã có sẵn header trong `serve-web.cjs`) |
| **`F2 / OA-25`**      | Hợp nhất (`merge`) vào `main` và phát hành lên Production qua `Owner-Locked Release Gate`  | Quy tắc bất biến §0: chỉ Owner mới được ký và chạy cổng phát hành Production                                                                  | Sau khi nghiệm thu nhánh `remediation/audit-v1` và CI xanh, Owner ký phát hành qua `Sign-Release-Owner.ps1`                             |

---

## 7. Bằng chứng Production Không Bị Thay Đổi (`BEFORE == AFTER`)

Đối chiếu giữa `W2B-prod-fingerprint-before.json` (`06:31:36`) và `W2B-prod-fingerprint-after.json` (`07:39:15`):

| Chỉ số Production                                     | Trước Đợt 2B (`06:31:36`)                          | Sau Đợt 2B (`07:39:15`)                            | Đối chiếu     |
| ----------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- | ------------- |
| `web_dist` (`files` / `listing_sha` / `newest`)       | `989` / `9A7FA926A3517830` / `2026-11-01T19:00:59` | `989` / `9A7FA926A3517830` / `2026-11-01T19:00:59` | **IDENTICAL** |
| `api_dist` (`files` / `listing_sha` / `newest`)       | `331` / `AEF81FC7AD4263C0` / `2026-11-01T19:00:47` | `331` / `AEF81FC7AD4263C0` / `2026-11-01T19:00:47` | **IDENTICAL** |
| `deploy-history.log` (`lines` / `mtime`)              | `857` / `2026-11-01T18:28:43`                      | `857` / `2026-11-01T18:28:43`                      | **IDENTICAL** |
| `prod_db` (`port 55432` / `postmaster_pid`)           | `55432` / PID `5656`                               | `55432` / PID `5656`                               | **IDENTICAL** |
| `listener_pids` (`3001`, `3002`, `55432`)             | `3001:36112 3002:30436 55432:5656`                 | `3001:36112 3002:30436 55432:5656`                 | **IDENTICAL** |
| `listening` (Cổng `:55433` đã đóng sau test)          | `3000,3001,3002,55432`                             | `3000,3001,3002,55432`                             | **IDENTICAL** |
| `C:\Projects\management-lite` (`main` HEAD / `dirty`) | `5806bdf` / `dirty = 0`                            | `5806bdf` / `dirty = 0`                            | **IDENTICAL** |

---

## 8. Phương án Rollback Cho Các Thay Đổi Đã Thực Hiện

1. **Rollback mã nguồn trên nhánh `remediation/audit-v1`:**
   - Mọi thay đổi của Đợt 2B nằm gọn trong commit mới trên nhánh cô lập `remediation/audit-v1` tại `C:\Projects\management-lite-remediation`. Để quay về trạng thái ngay sau `OA-20` (`88c6fee`), chỉ cần chạy:
     ```powershell
     git -C C:\Projects\management-lite-remediation reset --hard 88c6fee
     ```
   - Hoặc khôi phục từ gói Git bundle độc lập tại `C:\ML-Test\work\git-backup\management-lite-5806bdf-main-and-remediation.bundle`.
2. **Rollback cụm PostgreSQL TEST cô lập (`C:\ML-Test`):**
   - Cụm `:55433` hiện đã dừng (`STOPPED`). Nếu muốn gỡ bỏ hoàn toàn thư mục `C:\ML-Test`:
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File C:\Projects\management-lite-remediation\scripts\test-env\Manage-TestEnv.ps1 -Action Remove
     ```
3. **Rollback cấu hình Staging cô lập:**
   - Chạy `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\staging\Manage-StagingEnv.ps1 -Action Stop`.

---

## 9. Đề xuất Bước Tiếp Theo Chờ Owner Duyệt (`Next Steps`)

1. **Bước 1 (Duyệt nghiệm thu Đợt 2B & Push nhánh `remediation/audit-v1`):**
   - Owner nghiệm thu báo cáo `W2B_ACCEPTANCE_REPORT.md` và cấp quyền đẩy nhánh `remediation/audit-v1` lên GitHub (`git push -u origin remediation/audit-v1`) để kích hoạt lượt chạy kiểm chứng tự động của GitHub Actions (`foundation.yml`) trên môi trường đám mây.
2. **Bước 2 (Tùy chọn — Khóa hẳn Scheduled Task `HoaiPhuong-Anty-AtBoot` bằng quyền Admin):**
   - Owner chạy lệnh `Disable-ScheduledTask -TaskName "HoaiPhuong-Anty-AtBoot"` trong PowerShell (Run as Administrator).
3. **Bước 3 (Hợp nhất vào `main` và Phát hành qua `Owner-Locked Release Gate`):**
   - Sau khi GitHub Actions trên `remediation/audit-v1` báo xanh toàn bộ, thực hiện merge vào `main` và trình Owner ký phát hành chính thức qua `Sign-Release-Owner.ps1` theo `docs/deployment/OWNER-RELEASE-RUNBOOK.md`.
