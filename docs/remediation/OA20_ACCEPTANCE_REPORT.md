# BÁO CÁO NGHIỆM THU OA-20 — VÔ HIỆU HÓA CƠ CHẾ TỰ ĐỘNG PHÁT HÀNH PRODUCTION CỦA ANTY REMOTE HUB LEGACY (`OA20_ACCEPTANCE_REPORT.md`)

- **Ngày thực hiện:** `2026-11-02 05:56 – 06:07 (+07:00)`
- **Máy thực thi:** `DESKTOP-8T8UHTS` (`WIN-1`, RAM `11.9 GB`)
- **Worktree thực thi:** `C:\Projects\management-lite-remediation` (nhánh `remediation/audit-v1`)
- **Worktree chính:** `C:\Projects\management-lite` (nhánh `main` @ `5806bdf5f813f5880493dadf2b1f2397845c2165`, `[ahead 1]` so với `origin/main` @ `d5693efd452621ee54e996ff29c3e9bf510711ef`)
- **Trạng thái Production (`C:\HoaiPhuong-Server\` & PostgreSQL `:55432`):** **0 thay đổi (`ZERO PRODUCTION MODIFICATION`)** — Toàn bộ SHA-256, PID, số dòng log phát hành khớp 100% trước và sau.

---

## 1. TRẠNG THÁI TRƯỚC VÀ SAU KHI THỰC THI OA-20 (`BEFORE VS AFTER`)

| Hạng mục kiểm tra | Trạng thái TRƯỚC OA-20 (`05:56:46`) | Trạng thái SAU OA-20 (`06:06:16`) | Đánh giá |
|---|---|---|---|
| **1. Registry `HKCU\...\Run\AntyRemoteHubServer24x7`** | Tồn tại: `wscript.exe //B //NoLogo C:\Projects\anty-daemon-hidden.vbs` | **Đã gỡ bỏ hoàn toàn** (`Exists=False`) | ✅ **PASS** |
| **2. VBS Launcher tại `C:\Projects\anty-daemon-hidden.vbs`** | Tồn tại (`222 bytes`, gọi `C:\Projects\anty-remote-hub\src\server-daemon.mjs`) | **Đã gỡ bỏ hoàn toàn** (`Exists=False`) | ✅ **PASS** |
| **3. VBS Launcher tại `%APPDATA%\...\Startup\anty-remote-hub.vbs`** | Tồn tại (`222 bytes`, `LastWriteTime: 2026-11-01 18:26:03`) | **Đã gỡ bỏ hoàn toàn** (`Exists=False`) | ✅ **PASS** |
| **4. Scheduled Task `\AntyRemoteHubServer24x7`** | `State: Disabled` | `State: Disabled` (và chặn hàm `ensureWindows24x7WatchdogInstalled` tự bật lại) | ✅ **PASS** |
| **5. Scheduled Task `\HoaiPhuong-Anty-AtBoot` (`server-atboot.ps1 -Target Anty`)** | Gọi `C:\Projects\anty-remote-hub\src\server-daemon.mjs` (tự `git reset --hard` và chạy vòng lặp vô hạn) | Gọi `server-daemon.mjs` đã khóa **Fail-Closed (`exit 43`)** ➔ `server-atboot.ps1 -Target Anty` dừng ngay (`exit 1`, không lặp, không chạy daemon) | ✅ **PASS** |
| **6. `C:\Projects\anty-remote-hub\src\server-daemon.mjs` & `C:\Projects-Dev\...\server-daemon.mjs`** | Chạy `git fetch origin main && git reset --hard origin/main` và `while(true)` spawn `src/index.mjs` | **Khóa Fail-Closed (`exit 43`, `OA20_FAIL_CLOSED_SERVER_DAEMON_DISABLED`)** | ✅ **PASS** |
| **7. `C:\Projects\anty-remote-hub\src\sync-live-web.mjs` & `C:\Projects-Dev\...\sync-live-web.mjs`** | Tự `git reset --hard`, build, chép đè `C:\HoaiPhuong-Server\apps\management-lite`, chạy migration `:55432` và `Restart-Service` | **Khóa Fail-Closed (`exit 43`, `OA20_FAIL_CLOSED_LIVE_SYNC_DISABLED`)** cả khi chạy CLI lẫn khi `import` | ✅ **PASS** |
| **8. `C:\Projects\anty-remote-hub\src\index.mjs`** | Chứa 7 điểm tự push/deploy và tự cài lại Watchdog (`ensureWindows24x7WatchdogInstalled`) | **Khóa Fail-Closed 2 tầng:** chặn ngay entrypoint (`exit 43`) + chặn tại hàm `executeWebReleaseAndDeploy`, `ensureWindows24x7WatchdogInstalled`, `autoPullAndPublishWebProjectsOnServer` | ✅ **PASS** |
| **9. Tiến trình Preview cũ (`PID 39584` `scratch\web-dashboard-preview.mjs`)** | Chiếm cổng `:4799` (`legacyControlPort`) và `:4800` | **Đã xác minh và dừng an toàn** (`still_alive=False`, cổng `4799` và `4800` đã giải phóng) | ✅ **PASS** |
| **10. Tiến trình Bot DEV (`PID 12060` `start-dev-bot.mjs`)** | Đang chạy (`PID 12060`, giữ `.anty-poller.lock`) | **Hoạt động ổn định (`PID 12060`, `DEV_CONTROLLED_POLLER`)**, không bị gián đoạn | ✅ **PASS** |
| **11. Dịch vụ Production (`3001`, `3002`, `55432`, `Cloudflared`, `3000`, `3401`, `3462`)** | `Running` (`3001:36112`, `3002:30436`, `55432:5656`) | **`Running` nguyên vẹn cùng PID (`3001:36112`, `3002:30436`, `55432:5656`)**, `0` giây downtime | ✅ **PASS** |
| **12. Production Bundle & DB Fingerprint** | `web_dist: 9A7FA926A3517830`, `api_dist: AEF81FC7AD4263C0`, `deploy_history: 857` | **`web_dist: 9A7FA926A3517830`, `api_dist: AEF81FC7AD4263C0`, `deploy_history: 857`** | ✅ **PASS** |

---

## 2. CÁC CƠ CHẾ KHỞI ĐỘNG & ĐƯỜNG TỰ DEPLOY ĐÃ VÔ HIỆU HÓA

1. **Vô hiệu hóa khởi động khi đăng nhập Windows (`AtLogon`):**
   - Đã xóa giá trị Registry `AntyRemoteHubServer24x7` tại `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` (giữ nguyên toàn bộ các khóa ứng dụng khác như `VideoAutomationV1`, `UniKey`, `Zalo`).
   - Đã xóa file `C:\Users\ADMIN\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\anty-remote-hub.vbs` và `C:\Projects\anty-daemon-hidden.vbs` (sau khi sao lưu vào 2 thư mục cố định kèm kiểm chứng SHA-256).
2. **Vô hiệu hóa khởi động qua Scheduled Task (`AtBoot` & `Every 5 Minutes`):**
   - Task `\AntyRemoteHubServer24x7` được giữ ở trạng thái `Disabled`, đồng thời hàm `ensureWindows24x7WatchdogInstalled()` trong `C:\Projects\anty-remote-hub\src\index.mjs` đã bị khóa fail-closed để không bao giờ tự tạo lại `.vbs`, Registry Run hay Scheduled Task.
   - Task `\HoaiPhuong-Anty-AtBoot` (do ACL của `C:\ProgramData\HoaiPhuong\ServerStartup\server-atboot.ps1` thuộc `BUILTIN\Administrators:(F)` và `ADMIN:(RX)`) gọi trực tiếp `C:\Projects\anty-remote-hub\src\server-daemon.mjs` (không có vòng lặp `while($true)` trong nhánh `'Anty'` của `server-atboot.ps1`). Khi `server-daemon.mjs` bị khóa fail-closed (`exit 43`), `server-atboot.ps1 -Target Anty` dừng ngay lập tức với `exit 1` (`ERROR: Anty launcher exited 43`) mà không sinh bất kỳ tiến trình nền nào.
3. **Khóa Fail-Closed toàn bộ đường gọi trực tiếp & gián tiếp tới Auto-Deploy:**
   - [C:\Projects\anty-remote-hub\src\server-daemon.mjs](file:///C:/Projects/anty-remote-hub/src/server-daemon.mjs#L1-L21) & [C:\Projects-Dev\anty-remote-hub\src\server-daemon.mjs](file:///C:/Projects-Dev/anty-remote-hub/src/server-daemon.mjs#L1-L21): loại bỏ hoàn toàn `git fetch origin main && git reset --hard origin/main` và vòng lặp `while (true)`; trả về mã lỗi `43` (`OA20_FAIL_CLOSED_SERVER_DAEMON_DISABLED`).
   - [C:\Projects\anty-remote-hub\src\sync-live-web.mjs](file:///C:/Projects/anty-remote-hub/src/sync-live-web.mjs#L1-L40) & [C:\Projects-Dev\anty-remote-hub\src\sync-live-web.mjs](file:///C:/Projects-Dev/anty-remote-hub/src/sync-live-web.mjs#L1-L40): loại bỏ toàn bộ lệnh `git reset --hard`, `npm run build`, chép file vào `C:\HoaiPhuong-Server`, chạy `migrate.mjs` trên `:55432` và `Restart-Service`; trả về mã lỗi `43` (`OA20_FAIL_CLOSED_LIVE_SYNC_DISABLED`).
   - [C:\Projects\anty-remote-hub\src\index.mjs](file:///C:/Projects/anty-remote-hub/src/index.mjs#L27-L48): chặn ngay tại entrypoint (`exit 43`, `OA20_FAIL_CLOSED_LEGACY_INDEX_DISABLED`) và đặt chốt chặn thứ cấp bên trong `executeWebReleaseAndDeploy`, `ensureWindows24x7WatchdogInstalled`, `autoPullAndPublishWebProjectsOnServer`.
4. **Xác minh và dừng tiến trình Preview cũ (`PID 39584`):**
   - Trước khi dừng đã xác minh đầy đủ: `PID = 39584`, `ParentPID = 40088`, `ExecutablePath = C:\Program Files\nodejs\node.exe`, `CommandLine = "C:\Program Files\nodejs\node.exe" C:\Users\ADMIN\.gemini\antigravity\brain\ad6704e1-48f3-4562-935e-4a9348432903\scratch\web-dashboard-preview.mjs`, `listening_ports = [4799, 4800]`, `child_process_count = 0`, `service_count = 0`.
   - Sau khi dừng `PID 39584`, cổng `:4799` (`legacyControlPort` của `TelegramPollerLockManager`) và `:4800` đã giải phóng hoàn toàn (`0` listener), giúp Bot DEV không bao giờ bị chặn ở bước `PREFLIGHT_LOCK` nếu cần khởi động lại.

---

## 3. DANH MỤC SAO LƯU CỐ ĐỊNH & MÃ BĂM SHA-256 (`DUAL PERMANENT BACKUP`)

Toàn bộ 12 bản sao lưu được lưu đồng thời tại **2 thư mục cố định không bị dọn tự động**:
- Thư mục chính: `C:\ML-Test\work\hub-backup-oa20\`
- Thư mục đối chiếu trong nhánh `remediation/audit-v1`: [docs/remediation/evidence/oa20-hub-backup/](file:///C:/Projects/management-lite-remediation/docs/remediation/evidence/oa20-hub-backup/manifest-sha256.json)

| # | Tên file sao lưu | Dung lượng (Bytes) | Mã băm `SHA-256` | Nguồn gốc |
|---:|---|---:|---|---|
| 1 | `anty-daemon-hidden.vbs.bak` | `222` | `CE00A4F877E79B06B5FC130ED2ABC6E27B39B3AC0D2B9D5E55198F1BA3B028ED` | `C:\Projects\anty-daemon-hidden.vbs` |
| 2 | `Startup-anty-remote-hub.vbs.bak` | `222` | `CE00A4F877E79B06B5FC130ED2ABC6E27B39B3AC0D2B9D5E55198F1BA3B028ED` | `%APPDATA%\...\Startup\anty-remote-hub.vbs` |
| 3 | `HKCU-Run-AntyRemoteHubServer24x7.json` | `260` | `527498947DD4D7A78FEBB34E8E98DF1746320D14F724FA0E6E637130E184FC59` | Giá trị Registry `AntyRemoteHubServer24x7` |
| 4 | `HKCU-Run-before-oa20.reg` | `2088` | `50B2B429AED6B5961E4F9A9F7A05F6E3F63C864B0D76C4BF55DE87E33B65AE25` | Toàn bộ khóa `HKCU\...\Run` |
| 5 | `server-atboot.ps1.bak` | `2440` | `6435664C8126385396DC6CE2AE7502D65AE8C5DBD65C1FE2D319B360547A8F6E` | `C:\ProgramData\HoaiPhuong\ServerStartup\server-atboot.ps1` |
| 6 | `Task-HoaiPhuong-Anty-AtBoot.xml` | `1716` | `11E8E214E462495A34C4D286293D19000692988B91C5A50C5310444742EA8653` | Export XML Task `\HoaiPhuong-Anty-AtBoot` |
| 7 | `Task-AntyRemoteHubServer24x7.xml` | `1461` | `786EBE4BAFFEC30423B1CA67401BF4F6F17D2B5A38F42FB550D94782D774F1FA` | Export XML Task `\AntyRemoteHubServer24x7` |
| 8 | `legacy-server-daemon.mjs.bak` | `3022` | `360737DDAC35DF067CAA5A045C7417F3C873FDD5B6299FBAC464ACD33BF43F79` | `C:\Projects\anty-remote-hub\src\server-daemon.mjs` |
| 9 | `legacy-sync-live-web.mjs.bak` | `10700` | `60F299CC2107CABC4747C68422B3961A489E558E2FF616C05CB7AFFE3FF2AEF0` | `C:\Projects\anty-remote-hub\src\sync-live-web.mjs` |
| 10 | `legacy-index.mjs.bak` | `169909` | `37E272395560EBC2544E29604EA3A66409815417A8823427B41CF3A89DF31B57` | `C:\Projects\anty-remote-hub\src\index.mjs` |
| 11 | `dev-server-daemon.mjs.bak` | `3022` | `360737DDAC35DF067CAA5A045C7417F3C873FDD5B6299FBAC464ACD33BF43F79` | `C:\Projects-Dev\anty-remote-hub\src\server-daemon.mjs` |
| 12 | `dev-sync-live-web.mjs.bak` | `10252` | `99E37F44F9C7BB9709C1D2B4869BED94945EC6A73F893DCF6416F3055567FE7D` | `C:\Projects-Dev\anty-remote-hub\src\sync-live-web.mjs` |

---

## 4. KẾT QUẢ XÁC MINH DỊCH VỤ PRODUCTION, MONITORING VÀ BOT DEV SAU THAY ĐỔI

| Thành phần | Dịch vụ / Tiến trình | Endpoint / Kiểm tra | Kết quả thực tế |
|---|---|---|---|
| **Management Lite Web** | `HPManagementLiteWeb` (`Running`, PID `36112`, `:3001`) | `GET http://127.0.0.1:3001/` | **`200 OK` (`1674 bytes`)** |
| **Management Lite API** | `HPManagementLiteApi` (`Running`, PID `30436`, `:3002`) | `GET http://127.0.0.1:3002/api/v1/health` & `/api/v1/ready` | **`200 OK` (`369 bytes` / `143 bytes`)** |
| **PostgreSQL Production** | `HPManagementLiteDatabase` (`Running`, PID `5656`, `:55432`) | Listener `:55432` + `/api/v1/ready` xác nhận DB | **`PASS` (PID `5656` giữ nguyên từ đầu phiên)** |
| **Cloudflare Tunnel** | `Cloudflared` (`Running`, PID `14332`) | `GET https://ql.hoaiphuong.click/api/v1/health` & `https://hoaiphuong.click/api/health` | **`200 OK` (`370 bytes` / `39 bytes`)** |
| **TikTok AI Factory V4** | `node.exe` (`PID 14768`, `:3000`) | `GET http://127.0.0.1:3000/api/health` | **`200 OK` (`39 bytes`)** |
| **Video Automation V1** | `node.exe` (`PID 7872`, `:3401`) | `GET http://127.0.0.1:3401/` | **`200 OK` (`453 bytes`)** |
| **AI Quota Monitor** | `node.exe` (`PID 1092`, `:3462`) | `GET http://127.0.0.1:3462/` | **`200 OK` (`3507 bytes`)** |
| **Bot DEV cô lập** | `node.exe` (`PID 12060`, `C:\Projects-Dev\anty-remote-hub\start-dev-bot.mjs`) | Giữ khóa `.anty-poller.lock` (`mode: DEV_CONTROLLED_POLLER`) + `Priority 12` & `Priority 21` PASS | **`PASS` (Hoạt động liên tục từ `18:30:44` hôm qua)** |

---

## 5. BẰNG CHỨNG MÔ PHỎNG CÁC ĐƯỜNG AUTO-DEPLOY ĐỀU BỊ CHẶN FAIL-CLOSED

Đã thực thi mô phỏng trực tiếp 6 trigger khởi động / đồng bộ và viết bộ kiểm thử tự động [tests/security/oa20-hub-autodeploy-disabled.test.mjs](file:///C:/Projects/management-lite-remediation/tests/security/oa20-hub-autodeploy-disabled.test.mjs#L1-L195) (`28/28` bài test trong `tests/security/*.test.mjs` đạt **`PASS`**):

| # | Trigger mô phỏng | Lệnh thực thi | Mã thoát | Phản hồi Fail-Closed ghi nhận | Tác dụng phụ lên hệ thống |
|---:|---|---|---:|---|---|
| 1 | **Task Boot (`HoaiPhuong-Anty-AtBoot`)** | `powershell -File C:\ProgramData\HoaiPhuong\ServerStartup\server-atboot.ps1 -Target Anty` | `1` | `OA20_FAIL_CLOSED_SERVER_DAEMON_DISABLED` (`Anty-startup.log`: `ERROR: Anty launcher exited 43`) | `0` tiến trình sinh ra, `0` tác động Git/Prod |
| 2 | **Watchdog Legacy (`server-daemon.mjs`)** | `node C:\Projects\anty-remote-hub\src\server-daemon.mjs` | `43` | `OA20_FAIL_CLOSED_SERVER_DAEMON_DISABLED` | `0` lệnh `git reset`, `0` tiến trình con |
| 3 | **Watchdog DEV (`server-daemon.mjs`)** | `node C:\Projects-Dev\anty-remote-hub\src\server-daemon.mjs` | `43` | `OA20_FAIL_CLOSED_SERVER_DAEMON_DISABLED` | `0` lệnh `git reset`, `0` tiến trình con |
| 4 | **Sync Script Legacy (`sync-live-web.mjs`)** | `node C:\Projects\anty-remote-hub\src\sync-live-web.mjs` | `43` | `OA20_FAIL_CLOSED_LIVE_SYNC_DISABLED` | `0` tác động `C:\HoaiPhuong-Server` / `:55432` |
| 5 | **Sync Script DEV (`sync-live-web.mjs`)** | `node C:\Projects-Dev\anty-remote-hub\src\sync-live-web.mjs` | `43` | `OA20_FAIL_CLOSED_LIVE_SYNC_DISABLED` | `0` tác động `C:\HoaiPhuong-Server` / `:55432` |
| 6 | **Index Legacy (`C:\Projects\anty-remote-hub\src\index.mjs`)** | `node C:\Projects\anty-remote-hub\src\index.mjs` | `43` | `OA20_FAIL_CLOSED_LEGACY_INDEX_DISABLED` | Không tạo lại `.vbs`, không ghi Registry `HKCU\...\Run` |

---

## 6. RỦI RO CÒN TỒN TẠI (`RESIDUAL RISKS`)

1. **Task `\HoaiPhuong-Anty-AtBoot` và file `C:\ProgramData\HoaiPhuong\ServerStartup\server-atboot.ps1` có ACL thuộc `BUILTIN\Administrators:(F)` (`ADMIN:(RX)` ở phiên không nâng quyền UAC):**
   - **Tác động thực tế:** Đã được **vô hiệu hóa 100% ở tầng đích (`server-daemon.mjs` trả về `exit 43`)**, nên khi máy khởi động lại, `\HoaiPhuong-Anty-AtBoot` gọi `server-daemon.mjs`, nhận mã `43` và dừng ngay lập tức sau `< 0.3 giây` mà không làm gì.
   - **Khuyến nghị tùy chọn cho Owner (nếu muốn tắt luôn trạng thái `Ready` của Task trong Task Scheduler):** Khi mở PowerShell với quyền `Run as Administrator`, Owner có thể chạy `Disable-ScheduledTask -TaskName "HoaiPhuong-Anty-AtBoot"`. (Không bắt buộc vì đích gọi đã bị khóa fail-closed).
2. **Commit `5806bdf` trên `main` (`AGENTS.md` W2A.1) đang ở trạng thái local `[ahead 1]`:**
   - Do tuân thủ lệnh đóng băng không `git push`, `origin/main` trên GitHub vẫn ở `d5693ef`. Tuy nhiên, mọi đường tự `git reset --hard origin/main` từ `anty-remote-hub` trên `WIN-1` nay đã bị khóa cứng bởi `OA-20`, và `5806bdf` đã có bản sao lưu bundle ngoài repo tại `C:\ML-Test\work\git-backup\`.

---

## 7. PHƯƠNG ÁN ROLLBACK ĐÃ KIỂM CHỨNG (`VERIFIED ROLLBACK PLAN`)

- Công cụ kiểm chứng & khôi phục: [Restore-OA20-HubState.ps1](file:///C:/Projects/management-lite-remediation/docs/remediation/evidence/oa20-hub-backup/Restore-OA20-HubState.ps1#L1-L103) (cũng nằm tại `C:\ML-Test\work\hub-backup-oa20\Restore-OA20-HubState.ps1`).
- **Kết quả chạy diễn tập khôi phục (`-VerifyOnly`):**
  - Đã kiểm tra khớp mã băm `SHA-256` của toàn bộ 12/12 file sao lưu tại cả 2 thư mục, giải nén diễn tập vào `C:\ML-Test\work\hub-restore-drill-oa20`, kiểm tra đọc/parse thành công XML Scheduled Task và JSON Registry (`OA20_BACKUP_VERIFY_PASS: files=12`).
- **Chốt an toàn chống tự bật lại Auto-Deploy (`Requirement 9`):**
  - Script `Restore-OA20-HubState.ps1` cho phép khôi phục từng thành phần độc lập (`-Component DevHubScripts`, `-Component ServerAtBoot`...) và **mặc định từ chối khôi phục các thành phần auto-deploy legacy (`REFUSED_LEGACY_AUTO_DEPLOY_RESTORE`)** nếu không có cờ tường minh `-ForceReEnableLegacyAutoDeploy` của Owner.

---

## 8. ĐỀ XUẤT ĐIỀU KIỆN GO / NO-GO CHO ĐỢT 2B

- **Toàn bộ rủi ro P0 sau Đợt 2A (`OA-17`, `OA-20`, `OA-21`, `OA-23`) đã được xử lý dứt điểm và có kiểm thử tự động bảo vệ:**
  - `OA-17`: Đã vá `AGENTS.md` (`5806bdf`) và sao lưu ngoài repo.
  - `OA-20`: Đã gỡ bỏ các cơ chế tự khởi động legacy và khóa fail-closed mọi đường auto-deploy (`tests/security/oa20-hub-autodeploy-disabled.test.mjs`: `3/3 PASS`, tổng `tests/security`: `28/28 PASS`).
  - `OA-21`: Đã khóa fail-closed `Deploy-SemiAutoWindows.ps1 -SandboxMode` (`tests/backend/auth-remember-01-cutover-fallback.test.mjs`: `12/12 PASS` trên cổng `55433`).
  - `OA-23`: Đã sửa `tests/backend/payroll.test.mjs` với đồng hồ kiểm thử điều khiển được (`23/23 PASS` qua các mốc tháng/năm).
- **Khuyến nghị trình Owner:** **GO (ĐỦ ĐIỀU KIỆN AN TOÀN) ĐỂ PHÊ DUYỆT TRIỂN KHAI ĐỢT 2B** trên nhánh cô lập `remediation/audit-v1` và cụm PostgreSQL TEST `C:\ML-Test` (`55433`).
