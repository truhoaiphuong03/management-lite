# BÁO CÁO NGHIỆM THU XỬ LÝ RỦI RO P0 SAU ĐỢT 2A (`W2A_P0_REMEDIATION_REPORT.md`)

- **Ngày thực hiện:** `2026-11-01`
- **Máy thực thi:** `DESKTOP-8T8UHTS` (`WIN-1`, RAM `11.9 GB`)
- **Worktree thực thi:** `C:\Projects\management-lite-remediation` (nhánh `remediation/audit-v1`)
- **Worktree chính:** `C:\Projects\management-lite` (nhánh `main` @ `5806bdf5f813f5880493dadf2b1f2397845c2165`, `[ahead 1]` so với `origin/main` @ `d5693efd452621ee54e996ff29c3e9bf510711ef`)
- **Trạng thái Production (`C:\HoaiPhuong-Server\` & PostgreSQL `:55432`):** **0 thay đổi (`ZERO PRODUCTION MODIFICATION`)** — Đối chiếu fingerprint trước/sau khớp 100%.

---

## 1. TASK 1 — OA-20: KIỂM SOÁT ANTY REMOTE HUB & CƠ CHẾ TỰ ĐỘNG PHÁT HÀNH (`RESEARCH & DESIGN ONLY`)

> **Tuân thủ tuyệt đối chỉ thị Owner:** Chỉ điều tra pháp y (read-only) và thiết kế phương án; **không sửa code Hub, không dừng tiến trình, không thay đổi Scheduled Task/Registry/Startup/Services** trong bước này.

### 1.1. Trạng thái thực tế của `anty-remote-hub` tại thời điểm kiểm tra (`2026-11-01 20:41–21:05`)

1. **Vì sao từ sau `18:30:44` ngày `2026-11-01` chưa phát sinh thêm đợt tự deploy mới?**
   - Trước `18:30:44`, tiến trình legacy **`C:\Projects\anty-remote-hub\src\server-daemon.mjs` ➔ `src\index.mjs`** chạy ngầm ở Session 0 (`PID 8724 / 15744 / 16044`) và đã gây ra đợt tự deploy lúc `18:28:43` (`deploy-history.log` dòng 857).
   - Lúc **`18:30:44`**, kịch bản [Chuyen-Bot-Telegram-DEV.cmd](file:///C:/Projects-Dev/anty-remote-hub/Chuyen-Bot-Telegram-DEV.cmd#L1-L40) đã dừng các PID `8724 / 15744 / 16044` và khởi chạy bản **Bot DEV cô lập** (`PID 12060`: `node.exe C:\Projects-Dev\anty-remote-hub\start-dev-bot.mjs`, giữ khóa `C:\Projects-Dev\anty-remote-hub\.anty-poller.lock`).
   - Trong bản `C:\Projects-Dev\anty-remote-hub\src\index.mjs`, ba hàm nguy hiểm đã được khóa cứng (`LAB_ISOLATION_MODE = 'FAIL_CLOSED_ISOLATED_LAB'`):
     - `executeWebReleaseAndDeploy` ([index.mjs](file:///C:/Projects-Dev/anty-remote-hub/src/index.mjs#L1796-L1801)) ➔ gọi `disallowLiveDeployment(...)` (không deploy).
     - `ensureWindows24x7WatchdogInstalled` ([index.mjs](file:///C:/Projects-Dev/anty-remote-hub/src/index.mjs#L3091-L3097)) ➔ bị chặn.
     - `autoPullAndPublishWebProjectsOnServer` ([index.mjs](file:///C:/Projects-Dev/anty-remote-hub/src/index.mjs#L3099-L3105)) ➔ bị chặn.
     - Toàn bộ đường dẫn dự án của Bot DEV được ánh xạ sang `C:\Projects-Dev\*` ([start-dev-bot.mjs](file:///C:/Projects-Dev/anty-remote-hub/start-dev-bot.mjs#L19-L41)).

2. **PHÁT HIỆN P0 NGHIÊM TRỌNG — 4 Cơ chế Tự khởi động (Persistence Vectors) VẪN ĐANG TRỎ VỀ BẢN LEGACY `C:\Projects\anty-remote-hub\src\server-daemon.mjs`:**
   Chỉ cần máy `WIN-1` khởi động lại (Reboot), đăng nhập lại (Logon), hoặc chạy script khởi động server là **daemon legacy có auto-deploy sẽ lập tức sống dậy** và chiếm lại quyền từ bản DEV:

   | # | Cơ chế tự khởi động (Persistence Vector) | Vị trí / Cấu hình cụ thể | Hành vi khi kích hoạt | Mức rủi ro |
   |---|---|---|---|---|
   | **V1** | **Windows Scheduled Task (`AtBoot`)** | Task `\HoaiPhuong-Anty-AtBoot` (`State: Ready`, Trigger: `MSFT_TaskBootTrigger`, User: `ADMIN`, RunLevel: `Limited`) gọi `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\ProgramData\HoaiPhuong\ServerStartup\server-atboot.ps1" -Target Anty` ([server-atboot.ps1](file:///C:/ProgramData/HoaiPhuong/ServerStartup/server-atboot.ps1#L156-L170)) | Khởi chạy `node.exe C:\Projects\anty-remote-hub\src\server-daemon.mjs` trong `C:\Projects\anty-remote-hub` ngay khi máy boot. | **P0 CRITICAL** |
   | **V2** | **Registry CurrentVersion\Run (`AtLogon`)** | `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` ➔ `AntyRemoteHubServer24x7` = `wscript.exe //B //NoLogo "C:\Projects\anty-daemon-hidden.vbs"` ([anty-daemon-hidden.vbs](file:///C:/Projects/anty-daemon-hidden.vbs#L1-L4)) | Khởi chạy ẩn `node.exe C:\Projects\anty-remote-hub\src\server-daemon.mjs` ngay khi `ADMIN` đăng nhập Windows. | **P0 CRITICAL** |
   | **V3** | **Windows Startup Folder (`AtLogon`)** | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\anty-remote-hub.vbs` (`LastWriteTime: 2026-11-01 18:26:03`) | Chạy `cmd /c cd /d "C:\Projects\anty-remote-hub" && node src/server-daemon.mjs` khi đăng nhập. | **P0 CRITICAL** |
   | **V4** | **Scheduled Task phụ + Tự phục hồi Watchdog + Tự `git reset --hard`** | Task `\AntyRemoteHubServer24x7` (hiện `Disabled`, nhưng [index.mjs](file:///C:/Projects/anty-remote-hub/src/index.mjs#L3727-L3785) `ensureWindows24x7WatchdogInstalled()` tự tạo lại V2, V3 và `schtasks /Create /F` mỗi lần `C:\Projects\anty-remote-hub` chạy). Đặc biệt, [server-daemon.mjs](file:///C:/Projects/anty-remote-hub/src/server-daemon.mjs#L51-L68) chạy **`git fetch origin main && git reset --hard origin/main`** trên `C:\Projects\anty-remote-hub` trước mỗi vòng lặp `while (true)`! | Nếu chỉ sửa file trong `C:\Projects\anty-remote-hub` mà không commit/push hoặc không chặn `server-daemon.mjs`, chính `server-daemon.mjs` sẽ tự `git reset --hard origin/main` xóa sạch bản vá và bật lại auto-deploy! | **P0 CRITICAL** |

3. **Danh sách 7 điểm kích hoạt Auto-Push / Auto-Deploy bên trong `C:\Projects\anty-remote-hub\src\index.mjs` & `sync-live-web.mjs`:**
   - **T1 (`snapshotProjects(true)` — mỗi `8 giây`, dòng `2870–2950`, `3918`):** Quét mọi repo trong `C:\Projects\*`; nếu phát hiện nhánh `main` đang `[ahead N]` (dòng `2887`), **tự động chạy `git push`** lên GitHub và gọi `executeWebReleaseAndDeploy`!
   - **T2 (`autoPullAndPublishWebProjectsOnServer()` — lúc khởi động dòng `3850` & mỗi `45 giây` dòng `3863, 3935`):** Tự chạy `git pull --rebase --autostash` trên `C:\Projects\management-lite` và nếu `commitSha` khác `C:\Projects\anty-remote-hub\.data\web-releases.json` (`012f7ea`), tự gọi `executeWebReleaseAndDeploy`.
   - **T3 (`watchAntigravityConversations(true)` — mỗi `6 giây`, dòng `3035–3118`, `3922`):** Đọc `.gemini\antigravity\brain\*\transcript.jsonl`, tự chạy `autoCommitAndPushProject` + `executeWebReleaseAndDeploy` (dòng `3104`) ngay khi phiên Antigravity kết thúc lượt trả lời.
   - **T4 (`watchWebBugReports()` — mỗi `4 giây`, dòng `3104`, `3926`):** Tự sửa bug, commit, push và gọi `executeWebReleaseAndDeploy`.
   - **T5 (`localTaskWorker` — dòng `1637`):** Tự gọi `executeWebReleaseAndDeploy` sau khi hoàn thành task Telegram.
   - **T6 (`executeWebReleaseAndDeploy` — dòng `1804–1977`):** Tự nâng patch version, `git commit`, `git push`, sau đó gọi `syncManagementLiteLiveOnWindows`.
   - **T7 (`syncManagementLiteLiveOnWindows` trong `src/sync-live-web.mjs` — dòng `67–148` ở CẢ `C:\Projects\anty-remote-hub\src\sync-live-web.mjs` VÀ `C:\Projects-Dev\anty-remote-hub\src\sync-live-web.mjs`):** Chạy `git reset --hard origin/main` trên `C:\Projects\management-lite`, `npm run build`, `robocopy /MIR` thẳng vào `C:\HoaiPhuong-Server\apps\management-lite\apps\web\dist` + `dist`, và `Stop-Service`/`Start-Service HPManagementLiteApi, HPManagementLiteWeb`.

---

### 1.2. Phân tách rõ Dịch vụ Production, Monitoring, Telegram Bot và Auto-Deploy

| Phân nhóm | Thành phần / Tiến trình / Task | PID / Cổng hiện tại | Phụ thuộc vào Auto-Deploy? | Tác động nếu tắt Auto-Deploy |
|---|---|---|---|---|
| **1. Production Core (`management-lite`)** | Windows Services: `HPManagementLiteWeb` (`:3001`, PID `36112`), `HPManagementLiteApi` (`:3002`, PID `30436`), `HPManagementLiteGateway` (`PID 39468`), `HPManagementLiteDatabase` (`:55432`, PID `5656`), `Cloudflared` (`PID 14332`) | `3001`, `3002`, `55432` | **Độc lập 100%** | **Không gián đoạn** (`0 downtime`). |
| **2. Production Apps khác** | `\HoaiPhuong-TikTok-AtBoot` (`:3000`, PID `14768`), `\HoaiPhuong-VideoAutomation-AtBoot` (`:3401`, PID `7872`) | `3000`, `3401` | **Độc lập 100%** (`server-atboot.ps1 -Target TikTok` / `VideoAutomation`) | **Không gián đoạn**. |
| **3. Monitoring (`AI Quota`)** | `\HoaiPhuong-AIQuota-AtBoot` (`:3462`, PID `1092`, chạy tại `C:\HoaiPhuong-Server\apps\ai-quota-monitor\src\server.mjs`) | `3462` | **Độc lập 100%** (`server-atboot.ps1 -Target AIQuota`) | **Không gián đoạn**. |
| **4. Telegram Bot & Điều phối DEV** | `node.exe C:\Projects-Dev\anty-remote-hub\start-dev-bot.mjs` (`PID 12060`) | Lock `.anty-poller.lock` | Đã tách khỏi Auto-Deploy (`LAB_ISOLATION_MODE = 'FAIL_CLOSED_ISOLATED_LAB'`) | Tiếp tục nhận/trả lời tin nhắn Telegram bình thường trên `C:\Projects-Dev\*`. *(Lưu ý: `PID 39584` `scratch\web-dashboard-preview.mjs` đang giữ cổng `:4799` — là `legacyControlPort` trong `preflight.mjs`; nếu khởi động lại `start-dev-bot.mjs` cần tắt `PID 39584` hoặc đặt `ANTY_LEGACY_CONTROL_PORT=0`).* |
| **5. Auto-Deploy Legacy (`CẦN VÔ HIỆU HÓA`)** | `C:\Projects\anty-remote-hub\src\{server-daemon.mjs, index.mjs, sync-live-web.mjs}`, `C:\Projects-Dev\anty-remote-hub\src\sync-live-web.mjs`, cùng 4 Persistence Vectors (`V1..V4`) | Hiện dừng tạm thời từ `18:30:44`, nhưng **sẽ tự bật lại khi Reboot/Logon** | Chính là nguồn gây tự deploy trái phép | Khi vô hiệu hóa theo phương án dưới đây, chặn 100% tự deploy/tự reset Git mà không ảnh hưởng nhóm 1–4. |

---

### 1.3. Phương án Vô hiệu hóa Riêng Chức năng Auto-Deploy (An toàn, Không gián đoạn Production) & Rollback

Để vô hiệu hóa triệt để chức năng tự động phát hành mà **không ảnh hưởng dịch vụ Production (nhóm 1–2), Monitoring (nhóm 3) hay Telegram Bot DEV (nhóm 4)**, đề xuất Owner phê duyệt thực thi **Gói 4 Bước Khóa Kép (Double-Lock Disablement Plan)**:

1. **Bước 1 — Chuyển 3 Persistence Vectors (`V1`, `V2`, `V3`) từ bản Legacy sang bản DEV cô lập (hoặc tắt hẳn):**
   - **V1 (`C:\ProgramData\HoaiPhuong\ServerStartup\server-atboot.ps1` khối `-Target Anty`, dòng `156–170`):** Đổi đường dẫn từ `C:\Projects\anty-remote-hub\src\server-daemon.mjs` sang `C:\Projects-Dev\anty-remote-hub\start-dev-bot.mjs` (hoặc đặt cờ `$EnableAntyAtBoot = $false` nếu muốn khởi động Bot thủ công).
   - **V2 (`HKCU:\Software\Microsoft\Windows\CurrentVersion\Run`):** Xóa giá trị `AntyRemoteHubServer24x7` (sau khi xuất bản sao lưu `.reg` vào `C:\ML-Test\work\hub-backup\`).
   - **V3 (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\anty-remote-hub.vbs` & `C:\Projects\anty-daemon-hidden.vbs`):** Di chuyển 2 file `.vbs` này vào thư mục sao lưu `C:\ML-Test\work\hub-backup\` (không xóa mất).
2. **Bước 2 — Khóa cứng `sync-live-web.mjs` ở CẢ 2 thư mục (`C:\Projects\anty-remote-hub` & `C:\Projects-Dev\anty-remote-hub`):**
   - Đặt chốt chặn fail-closed ngay đầu hàm `syncManagementLiteLiveOnWindows()` và `syncWebProjectLiveOnWindows()` trong `src/sync-live-web.mjs`: từ chối thực thi nếu không có biến môi trường xác nhận thủ công `ALLOW_LEGACY_HUB_LIVE_SYNC= NEVER_ENABLED_BY_DEFAULT` (mặc định `throw new Error('LIVE_DEPLOY_DISABLED_BY_OWNER_OA20')`).
3. **Bước 3 — Vô hiệu hóa tự `git reset --hard` & tự deploy trong `C:\Projects\anty-remote-hub\src\{server-daemon.mjs, index.mjs}`:**
   - Trong `C:\Projects\anty-remote-hub\src\server-daemon.mjs` (dòng `51–68`): tắt lệnh `git reset --hard origin/main` tự động.
   - Trong `C:\Projects\anty-remote-hub\src\index.mjs`: áp dụng cùng chốt `disallowLiveDeployment` cho `executeWebReleaseAndDeploy`, `autoPullAndPublishWebProjectsOnServer`, `ensureWindows24x7WatchdogInstalled`, và tắt nhánh `git push` tự động trong `snapshotProjects` (dòng `2887`).
4. **Bước 4 — Giải phóng cổng `:4799` của tiến trình preview cũ (`PID 39584` `scratch\web-dashboard-preview.mjs`):**
   - Để đảm bảo `C:\Projects-Dev\anty-remote-hub\start-dev-bot.mjs` (`PID 12060`) có thể khởi động lại bất kỳ lúc nào mà không vướng kiểm tra `legacyControlPort = 4799` của `TelegramPollerLockManager`.

#### Phương án Rollback & Khôi phục (< 30 giây nếu cần hoàn tác)
- Trước khi chạm vào bất kỳ cấu hình nào của Hub, toàn bộ bản gốc của `server-atboot.ps1`, khóa Registry `HKCU_Run_AntyRemoteHubServer24x7.reg`, 2 file `.vbs`, và bản sao `C:\Projects\anty-remote-hub\src\*` được lưu kèm mã băm SHA-256 tại `C:\ML-Test\work\hub-backup\`.
- Nếu cần khôi phục nguyên trạng: chạy script `Restore-AntyHubState.ps1` để chép trả file `.vbs`, nạp lại `.reg`, hoàn nguyên `server-atboot.ps1` và khởi chạy lại tiến trình.

---

## 2. TASK 2 — OA-21: BẢO VỆ DATABASE PRODUCTION TRONG BỘ ĐIỀU KHIỂN SANDBOX (`DONE & VERIFIED`)

### 2.1. Các thay đổi đã thực hiện trên nhánh `remediation/audit-v1`

1. **[scripts/deployment/Deploy-SemiAutoWindows.ps1](file:///C:/Projects/management-lite-remediation/scripts/deployment/Deploy-SemiAutoWindows.ps1#L1-L215) & [L374-L427](file:///C:/Projects/management-lite-remediation/scripts/deployment/Deploy-SemiAutoWindows.ps1#L374-L427) & [L1270-L1335](file:///C:/Projects/management-lite-remediation/scripts/deployment/Deploy-SemiAutoWindows.ps1#L1270-L1335):**
   - Bổ sung tham số cấu hình kết nối DB tường minh: `-DbHost`, `-DbPort`, `-DbUser`, `-PgPassFilePath`, `-PgBinDir`.
   - Trong chế độ `-SandboxMode`:
     - **Cấm tuyệt đối đường dẫn Production:** Từ chối ngay lập tức (`SANDBOX_VIOLATION_PRODUCTION_PATH_FORBIDDEN`) nếu `ServerRoot` hoặc `TargetDir` nằm trong `C:\HoaiPhuong-Server`.
     - **Cấm tuyệt đối cổng `55432`:** Từ chối ngay lập tức (`SANDBOX_VIOLATION_PRODUCTION_PORT_55432_FORBIDDEN` / status `REJECTED_SANDBOX_PRODUCTION_PORT_FORBIDDEN`) nếu `-DbPort 55432` hoặc chuỗi kết nối trong biến môi trường (`TEST_DATABASE_URL`, `DATABASE_URL`, `PGPORT`) chứa cổng `55432`.
     - **Cấm tuyệt đối tài khoản Production `hp_test_admin`:** Từ chối ngay lập tức (`SANDBOX_VIOLATION_PRODUCTION_CREDENTIAL_FORBIDDEN` / status `REJECTED_SANDBOX_PRODUCTION_CREDENTIAL_FORBIDDEN`) nếu `-DbUser hp_test_admin`, biến môi trường, hoặc nội dung file `pgpass.conf` chứa `hp_test_admin` hoặc `:55432:`.
     - **Cấm tuyệt đối đọc `pgpass.conf` Production:** Không bao giờ mặc định trỏ tới `C:\HoaiPhuong-Server\config\test-secrets\pgpass.conf`; từ chối ngay (`SANDBOX_VIOLATION_PRODUCTION_PGPASS_FORBIDDEN` / status `REJECTED_SANDBOX_PRODUCTION_PGPASS_FORBIDDEN`) nếu `-PgPassFilePath` hoặc `PGPASSFILE` nằm dưới `C:\HoaiPhuong-Server`.
     - **Bắt buộc xác nhận môi trường TEST (`Fail-Closed`):** Hàm `Assert-SandboxDatabaseIsolation` kiểm tra `CONFIRM_ISOLATED_TEST_DB -eq 'true'` trước mọi thao tác DB (`Get-DatabaseSchemaAndAuthState`, backup, migration); nếu thiếu hoặc khác `'true'`, dừng ngay với mã `SANDBOX_VIOLATION_UNCONFIRMED_TEST_DB` (`REJECTED_SANDBOX_DB_UNCONFIRMED`).
     - Sử dụng `psql.exe` / `pg_dump.exe` của cụm cô lập (`C:\ML-Test\pgsql\bin`) thay vì `C:\HoaiPhuong-Server\config\postgresql-18\pgsql\bin`.

2. **[tests/backend/auth-remember-01-cutover-fallback.test.mjs](file:///C:/Projects/management-lite-remediation/tests/backend/auth-remember-01-cutover-fallback.test.mjs#L110-L235) & [L518-L626](file:///C:/Projects/management-lite-remediation/tests/backend/auth-remember-01-cutover-fallback.test.mjs#L518-L626):**
   - Đọc thông số từ `TEST_DATABASE_URL` (`127.0.0.1:55433`, `ml_test_admin`) và tạo file `pgpass.conf` cô lập ngay trong thư mục tạm của sandbox (`<sandboxRoot>/config/sandbox-db/pgpass.conf`).
   - Bổ sung **Scenario 0 (`OA-21`)** kiểm chứng 5 trường hợp từ chối fail-closed (không tạo bất kỳ kết nối nào tới Production):
     1. Truyền `-PgPassFilePath C:\HoaiPhuong-Server\config\test-secrets\pgpass.conf` ➔ bị chặn bởi `SANDBOX_VIOLATION_PRODUCTION_PGPASS_FORBIDDEN`.
     2. Truyền `-DbUser hp_test_admin` ➔ bị chặn bởi `SANDBOX_VIOLATION_PRODUCTION_CREDENTIAL_FORBIDDEN`.
     3. Truyền `-DbPort 55432` ➔ bị chặn bởi `SANDBOX_VIOLATION_PRODUCTION_PORT_55432_FORBIDDEN`.
     4. Truyền `-ServerRoot C:\HoaiPhuong-Server\sandbox-attempt` ➔ bị chặn bởi `SANDBOX_VIOLATION_PRODUCTION_PATH_FORBIDDEN`.
     5. Chạy khi `CONFIRM_ISOLATED_TEST_DB=''` ➔ bị chặn bởi `SANDBOX_VIOLATION_UNCONFIRMED_TEST_DB`.

3. **[scripts/test-env/Manage-TestEnv.ps1](file:///C:/Projects/management-lite-remediation/scripts/test-env/Manage-TestEnv.ps1#L53-L66) & [L188-L194](file:///C:/Projects/management-lite-remediation/scripts/test-env/Manage-TestEnv.ps1#L188-L194):**
   - Gỡ `auth-remember-01-cutover-fallback.test.mjs` khỏi danh sách `$blocked` sau khi đã khóa an toàn.
   - Bổ sung kiểm tra `pg_isready.exe` trong `Start-Cluster` để đảm bảo PostgreSQL `:55433` đã sẵn sàng nhận kết nối trước khi chạy lệnh `psql` đầu tiên.

### 2.2. Kết quả kiểm thử thực tế trên cụm `C:\ML-Test` (`127.0.0.1:55433`)

| Bộ kiểm thử | Số subtest | Kết quả | Thời gian | Bằng chứng log |
|---|---:|---|---:|---|
| `tests/backend/auth-remember-01-cutover-fallback.test.mjs` | `12` (Scenario 0 + 11 kịch bản cutover/rollback/schema) | **12/12 PASS (`0 fail`)** | `83.6s` | `C:\ML-Test\work\20261101-210150\001-auth-remember-01-cutover-fallback.test.log` |
| `tests/backend/windows-p0-gate.test.mjs` | `3` | **3/3 PASS (`0 fail`)** | `37.4s` | `C:\ML-Test\work\20261101-210150\004-windows-p0-gate.test.log` |
| `tests/backend/cicd-policy.test.mjs` | `3` | **3/3 PASS (`0 fail`)** | `1.6s` | `C:\ML-Test\work\20261101-210150\002-cicd-policy.test.log` |

---

## 3. TASK 3 — OA-23: SỬA TEST PAYROLL (`DONE & VERIFIED`)

### 3.1. Nguyên nhân gốc & Cách khắc phục ([tests/backend/payroll.test.mjs](file:///C:/Projects/management-lite-remediation/tests/backend/payroll.test.mjs#L74-L168))

- **Nguyên nhân gốc:** `tests/backend/payroll.test.mjs` trước đây gán cứng các kỳ lương `'2026-08'`, `'2026-09'`, `'2026-10'`, `'2026-11'` và giả định ngày hiện tại của máy chủ luôn nằm trong tháng `2026-10`. Trong khi đó, `PayrollService` gọi `SELECT date_trunc('second',clock_timestamp()) AS at` và kiểm tra `period > currentMonthInTimezone(now, tz)` (`PAYROLL_FUTURE_PERIOD_FORBIDDEN`). Khi sang ngày `2026-11-01`, `'2026-11'` trở thành tháng hiện tại thay vì tháng tương lai, làm sai lệch kịch bản test.
- **Cách khắc phục (Không sửa bất kỳ dòng logic nghiệp vụ Production nào trong `apps/api/src/payroll/*`):**
  1. Thiết lập đồng hồ kiểm thử có thể điều khiển (`testClock`) trong `payroll.test.mjs` (mặc định neo tại ngày 15 của tháng hiện tại hoặc nhận mốc bất kỳ qua biến môi trường `PAYROLL_TEST_CLOCK_ISO`), hỗ trợ `.nowMs()`, `.iso()`, và `.advanceMs(ms)`.
  2. Bọc `pool.connect` (hỗ trợ cả kiểu callback `pool.connect(cb)` của `pool.query` lẫn Promise `await pool.connect()`) để ánh xạ truy vấn đồng hồ `SELECT date_trunc('second',clock_timestamp()) AS at` sang `SELECT date_trunc('second', $1::timestamptz) AS at` với giá trị `testClock.iso()`.
  3. Tính động `olderMonth` (`T-2`), `prevMonth` (`T-1`), `currMonth` (`T`), `nextMonth` (`T+1`) và các mốc biên ngày/giờ (`currBounds`, `olderBounds`, `crossStartIso`, `crossEndIso`) từ `testClock`.

### 3.2. Kết quả kiểm thử `payroll.test.mjs` và các bộ test liên quan trên `C:\ML-Test` (`55433`)

| Bộ kiểm thử & Kịch bản đồng hồ | Số test | Kết quả | Thời gian | Bằng chứng log |
|---|---:|---|---:|---|
| `tests/backend/payroll.test.mjs` (Mặc định tháng hiện tại `2026-11`) | `23` | **23/23 PASS (`0 fail`)** | `3.6s` | `C:\ML-Test\work\20261101-210150\003-payroll.test.log` |
| `tests/backend/payroll.test.mjs` (`PAYROLL_TEST_CLOCK_ISO=2026-10-15T12:00:00.000Z`) | `23` | **23/23 PASS (`0 fail`)** | `3.4s` | `C:\ML-Test\work\20261101-210432\001-payroll.test.log` |
| `tests/backend/payroll.test.mjs` (`PAYROLL_TEST_CLOCK_ISO=2027-01-01T00:15:00.000Z` — biên giao thừa) | `23` | **23/23 PASS (`0 fail`)** | `3.7s` | `C:\ML-Test\work\20261101-210439\001-payroll.test.log` |
| `tests/backend/timesheet-postgres.test.mjs` | `14` | **14/14 PASS (`0 fail`)** | `3.5s` | `C:\ML-Test\work\20261101-210516\001-timesheet-postgres.test.log` |
| `tests/backend/timesheet-xlsx.test.mjs` | `4` | **4/4 PASS (`0 fail`)** | `0.2s` | `C:\ML-Test\work\20261101-210516\002-timesheet-xlsx.test.log` |
| `tests/web/payroll-screen.test.mjs` | `11` | **11/11 PASS (`0 fail`)** | `1.6s` | `C:\ML-Test\work\20261101-210516\003-payroll-screen.test.log` |
| `npm run typecheck` & `npm run build` (`tsc`) | — | **PASS (`0 errors`)** | — | Task `task-944` |
| `tests/foundation/*.test.mjs` & `tests/security/*.test.mjs` | `29` (`4 + 25`) | **29/29 PASS (`0 fail`)** | `6.8s` | Task `task-944` |

*(Cụm PostgreSQL TEST `C:\ML-Test` tại cổng `55433` đã được dừng sạch sau khi chạy test: `test_port_listening: False`, `test_postgres_processes: 0`).*

---

## 4. TASK 4 — KIỂM TRA TÌNH TRẠNG GIT & BẢO VỆ COMMIT `5806bdf`

### 4.1. Trạng thái nhánh và Worktree

| Worktree | Nhánh | HEAD SHA | So với `origin/main` (`d5693ef`) | Trạng thái Working Tree |
|---|---|---|---|---|
| `C:\Projects\management-lite` | `main` | `5806bdf5f813f5880493dadf2b1f2397845c2165` | `ahead 1, behind 0` (`5806bdf` là bản vá `AGENTS.md` W2A.1) | Sạch (`0 modified, 0 untracked`) |
| `C:\Projects\management-lite-remediation` | `remediation/audit-v1` | Chứa đầy đủ `5806bdf` + các commit W1, W2A và bản vá P0 (`OA-21`, `OA-23`) | `ahead 5, behind 0` | Sạch sau khi commit P0 |
| Nhánh phụ bảo vệ trong repo | `remediation/agents-md` | `5806bdf5f813f5880493dadf2b1f2397845c2165` | `ahead 1, behind 0` | Giữ tham chiếu Git nội bộ cho `5806bdf` |

### 4.2. Sao lưu bảo vệ `5806bdf` bên ngoài Repository (`C:\ML-Test\work\git-backup\`)

Để đảm bảo kể cả trong kịch bản xấu nhất khi một tiến trình bên ngoài chạy `git reset --hard origin/main` trên `C:\Projects\management-lite`, commit `5806bdf` và toàn bộ nhánh `remediation/audit-v1` vẫn không bao giờ bị mất:
1. **Tham chiếu đa nhánh trong Git:** `5806bdf` đang được giữ đồng thời bởi 3 nhánh (`main`, `remediation/agents-md`, `remediation/audit-v1`). Lệnh `git reset --hard origin/main` trên `main` không xóa được `remediation/agents-md` hay `remediation/audit-v1`.
2. **Bản vá độc lập ngoài repo:** `C:\ML-Test\work\git-backup\5806bdf-agents-md.patch` (`SHA-256: 38857EF02B6A6D291F3C88D8CB0B1EEBCF6F244C4AF348E35F9A5E15A88C835D`).
3. **Git Bundle đầy đủ ngoài repo:** `C:\ML-Test\work\git-backup\management-lite-5806bdf-main-and-remediation.bundle` (chứa toàn bộ `main`, `remediation/agents-md`, `remediation/audit-v1`).

---

## 5. CÁC RỦI RO P0 CÒN TỒN TẠI & ĐIỀU KIỆN CHUYỂN SANG ĐỢT 2B (`GO / NO-GO`)

### 5.1. Rủi ro P0 đã xử lý dứt điểm vs. Rủi ro còn chờ lệnh Owner

| Mã | Rủi ro P0 | Trạng thái hiện tại | Ghi chú |
|---|---|---|---|
| **OA-21** | `Deploy-SemiAutoWindows.ps1 -SandboxMode` đọc `pgpass.conf` Production, dùng `hp_test_admin` và kết nối cổng `55432` | ✅ **ĐÃ KHẮC PHỤC & KIỂM CHỨNG (`PASS`)** | Đã khóa fail-closed và vượt qua `12/12` kịch bản trong `auth-remember-01-cutover-fallback.test.mjs` trên cổng `55433`. |
| **OA-23** | `tests/backend/payroll.test.mjs` lỗi `19/23` khi bước sang tháng `2026-11` do phụ thuộc ngày tháng cố định | ✅ **ĐÃ KHẮC PHỤC & KIỂM CHỨNG (`PASS`)** | Đã dùng `testClock` điều khiển được; đạt `23/23 PASS` ở cả `2026-11`, `2026-10` và `2027-01-01`. |
| **OA-17** | Chỉ thị tự đồng bộ Production trong `AGENTS.md` | ✅ **ĐÃ VÁ LOCAL (`5806bdf`) & SAO LƯU NGOÀI REPO** | Chưa push lên `origin/main` theo đúng lệnh đóng băng của Owner. |
| **OA-20** | 4 Persistence Vectors (`HoaiPhuong-Anty-AtBoot`, Registry `HKCU\...\Run`, `Startup\anty-remote-hub.vbs`, `sync-live-web.mjs`) vẫn trỏ về daemon legacy `C:\Projects\anty-remote-hub` | ⚠️ **ĐÃ ĐIỀU TRA XONG — CHỜ OWNER DUYỆT THỰC THI VÔ HIỆU HÓA** | Hiện tại đang an toàn tạm thời vì `Chuyen-Bot-Telegram-DEV.cmd` đã dừng daemon legacy lúc `18:30:44` và chạy Bot DEV (`PID 12060`), nhưng **nếu máy Reboot/Logon trước khi thực thi Gói 4 Bước OA-20 thì daemon legacy sẽ tự chạy lại**. |

### 5.2. Đề xuất Điều kiện Chuyển sang Đợt 2B (`GO / NO-GO Criteria`)

- **Trạng thái khuyến nghị:** **CONDITIONAL GO CHO ĐỢT 2B** sau khi Owner phê duyệt quyết định **OA-20 (Thực thi Gói 4 Bước vô hiệu hóa Persistence của Auto-Deploy Legacy)**.
- **Các quyết định cần Owner phê duyệt để bắt đầu Đợt 2B:**
  1. **OA-20 (Thực thi):** Cho phép áp dụng **Gói 4 Bước Khóa Kép** (Mục 1.3) để gỡ 3 vector khởi động tự động của `C:\Projects\anty-remote-hub` (chuyển sang `C:\Projects-Dev\anty-remote-hub\start-dev-bot.mjs` hoặc tắt tự chạy) và đặt chốt fail-closed trong `sync-live-web.mjs` (kèm bản sao lưu rollback tại `C:\ML-Test\work\hub-backup\`).
  2. **OA-22 (Phạm vi Đợt 2B):** Phê duyệt chạy tiếp bộ kiểm thử toàn diện (`tests/database`, `tests/backend`, `tests/web`, `tests/security`) trên cụm `C:\ML-Test` (`55433`) và xử lý các hạng mục chất lượng mã / bảo mật tiếp theo trong nhánh `remediation/audit-v1`.
