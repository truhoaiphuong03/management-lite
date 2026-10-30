# AGENTS.md — `management-lite` (`https://ql.hoaiphuong.click`)

<!-- LIVE_CHECKPOINT_START -->

## 📌 1. LIVE_CHECKPOINT (ĐỌC DUY NHẤT MỤC NÀY ĐẦU PHIÊN — CẤM ĐỌC LẠI TOÀN BỘ SOURCE)

- **Dự án:** `management-lite` | **Nhánh:** `main` | **Version hiện tại:** `v0.1.4`
- **Tiến độ lũy kế:** Hoàn tất **Phase 1/4 (`25%`)** của lộ trình nâng cấp toàn diện (`docs/plans/2026-10-30-system-upgrade-plan.md`), cộng với 100% khung 14 màn hình quản trị, 30/30 migrations trên PostgreSQL 18 (`management_lite_test`), RBAC, Brevo Email, Storage V2 Google Drive, Liên thông V4 Bridge và Import/Export Excel lương.
- **VIỆC TIẾP THEO (`NEXT_ACTION`):**
  - Thực thi **Phase 2 (`v0.1.5`) — Task 2.1, Task 2.2, Task 2.3:** Mở khóa tính **Thưởng (`bonus`), Phụ cấp (`allowance`), Khấu trừ (`deduction`)**, hiển thị **Số TK Ngân hàng & mã QR chuyển khoản (`VietQR`)** tự động trong cửa sổ Chi trả lương, và tự động ghi **Phiếu chi lương** vào **Sổ thu chi (`/finance`)**.

---

## 📊 2. BẢNG THEO DÕI TIẾN ĐỘ NÂNG CẤP (`PHASE_TASK_TRACKER`)

| Phase & Version đích | Mã Task | Nội dung Task | File mục tiêu (Chỉ mở đúng file này) | Trạng thái |
|---|---|---|---|---|
| **Phase 1 (`v0.1.4`)**<br>Hồ sơ Nhân sự, Ngân hàng & Kích hoạt Hạ tầng Server | `Task 1.0` | Mở rộng hồ sơ nhân sự (SĐT, CCCD, Ngày sinh, Địa chỉ, Chức danh) + Thông tin Ngân hàng + Modal nhắc SĐT (`migration 0030`) | `packages/database/src/migrations/0030_employee_profile_and_bank_info.sql`, `apps/api/src/employees/service.ts`, `apps/web/src/screens/EmployeeDetailScreen.tsx`, `apps/web/src/App.tsx` | `[DONE]` (`5b9e996`) |
| **Phase 1 (`v0.1.4`)** | `Task 1.1` | Hợp nhất `Google Drive Live OAuth`, `ACCOUNT_SECRET_KEY` & `FIN_RECEIPT_DIR` vào `api.env` và phát hành `v0.1.4` | `C:\HoaiPhuong-Server\config\test-secrets\api.env`, `packages/contracts/src/version.ts`, `package.json` | `[DONE]` (`v0.1.4`) |
| **Phase 2 (`v0.1.5`)**<br>Bảng lương Thưởng/Khấu trừ, `VietQR` & Sổ thu chi | `Task 2.1` | Mở khóa tính **Thưởng (`bonus`), Phụ cấp (`allowance`), Khấu trừ (`deduction`)** trong bảng lương & khi import Excel | `packages/contracts/src/payroll.ts`, `apps/api/src/payroll/service.ts`, `apps/api/src/payroll/timesheet-service.ts`, `apps/web/src/screens/PayrollScreen.tsx` | `[TODO - NEXT]` |
| **Phase 2 (`v0.1.5`)** | `Task 2.2` | Hiển thị **Số TK Ngân hàng & mã QR chuyển khoản (`VietQR`)** tự động trong cửa sổ Chi trả lương | `packages/contracts/src/payroll.ts`, `apps/api/src/payroll/service.ts`, `apps/web/src/screens/PayrollScreen.tsx` | `[TODO]` |
| **Phase 2 (`v0.1.5`)** | `Task 2.3` | Tự động ghi **Phiếu chi lương** vào **Sổ thu chi (`/finance`)** khi xác nhận chi trả lương | `apps/api/src/payroll/service.ts`, `apps/web/src/screens/PayrollScreen.tsx` | `[TODO]` |
| **Phase 3 (`v0.1.6`)**<br>Nhân sự, Báo cáo & Dashboard UX | `Task 3.1` | Hiển thị cột **SĐT, Chức danh, Ngân hàng** & nút **Xuất CSV/Excel** trên bảng Danh sách nhân sự (`/employees`) | `apps/web/src/screens/EmployeesScreen.tsx` | `[TODO]` |
| **Phase 3 (`v0.1.6`)** | `Task 3.2` | Nút nhắc nộp Báo cáo ngay sau khi Ra ca (`/clock`) & Trung tâm Việc cần xử lý trên Dashboard (`/dashboard`) | `apps/web/src/screens/ClockScreen.tsx`, `apps/web/src/screens/DashboardScreen.tsx` | `[TODO]` |
| **Phase 4 (`v0.2.0`)**<br>Liên thông V4 & Tối ưu Bundle | `Task 4.1` | Giao diện xác nhận ánh xạ nhân sự cố định giữa V4 (`hoaiphuong.click`) và mã `NV001`, `NV002`... | `apps/api/src/bridge/service.ts`, `apps/web/src/screens/DashboardScreen.tsx` | `[TODO]` |
| **Phase 4 (`v0.2.0`)** | `Task 4.2` | Chia nhỏ gói JS (`manualChunks`) giảm bundle chính từ `~1 MB` xuống `< 400 kB` | `apps/web/vite.config.ts` | `[TODO]` |

---

## 🗺️ 3. BẢN ĐỒ MODULE & FILE CỐT LÕI (`MODULE_FILE_MAP` — TRA CỨU NHANH ĐỂ TIẾT KIỆM TOKEN)

> **Quy tắc tiết kiệm Token:** Khi làm việc với phân hệ nào, **CHỈ MỞ** đúng file trong dòng của phân hệ đó (kết hợp `StartLine`/`EndLine`). **CẤM** đọc các phân hệ không liên quan.

| Phân hệ (Module) | Hợp đồng & Schema (`packages/`) | Backend API (`apps/api/src/`) | Giao diện Web (`apps/web/src/`) | Bộ kiểm thử chọn lọc (`tests/`) |
|---|---|---|---|---|
| **Phiên bản & Release** | `packages/contracts/src/version.ts` | `app.ts` (`/api/v1/system/version`) | `screens/SettingsScreen.tsx` | `tests/web/settings-screen.test.mjs` |
| **Xác thực & Hồ sơ cá nhân** | `packages/contracts/src/auth.ts` | `auth/service.ts`, `email/brevo-service.ts` | `App.tsx`, `screens/LoginScreen.tsx`, `screens/SettingsScreen.tsx` | `tests/web/settings-screen.test.mjs` |
| **Nhân sự (`/employees`)** | `packages/contracts/src/employees.ts`, `migrations/0030_*.sql` | `employees/service.ts`, `app.ts` | `screens/EmployeesScreen.tsx`, `screens/EmployeeDetailScreen.tsx`, `screens/EmployeeNewScreen.tsx` | `tests/web/employee-detail-screen.test.mjs` |
| **Chấm công (`/clock`, `/attendance`)** | `packages/contracts/src/attendance.ts` | `attendance/service.ts` | `screens/ClockScreen.tsx`, `screens/AttendanceScreen.tsx` | `tests/backend/att-*.test.mjs` |
| **Báo cáo & Công việc (`/reports`, `/work`)** | `packages/contracts/src/reports.ts`, `work.ts` | `reports/service.ts`, `work/service.ts` | `screens/ReportsScreen.tsx`, `screens/WorkScreen.tsx`, `screens/WorkDetailScreen.tsx` | `tests/backend/report-work-link-postgres.test.mjs` |
| **Bảng lương & Thống kê (`/payroll`)** | `packages/contracts/src/payroll.ts`, `migrations/0027_*.sql` | `payroll/service.ts`, `payroll/timesheet-service.ts` | `screens/PayrollScreen.tsx`, `screens/PayrollStatsScreen.tsx` | `tests/backend/pay-18-23-invariants.test.mjs`, `tests/web/payroll-stats-screen.test.mjs` |
| **Sổ thu chi (`/finance`)** | `packages/contracts/src/finance.ts` | `finance/service.ts`, `finance/receipt-store.ts` | `screens/FinanceOverviewScreen.tsx`, `screens/FinanceLedgerScreen.tsx` | `tests/web/finance-*.test.mjs` |
| **Kho Google Drive (`/storage`)** | `packages/contracts/src/storage.ts`, `migrations/0025_*.sql` | `storage/service.ts`, `storage/google-drive-provider.ts` | `screens/StorageScreen.tsx` | `tests/backend/storage-*.test.mjs` |
| **Tài khoản dùng chung (`/accounts`)** | `packages/contracts/src/accounts.ts` | `accounts/service.ts` | `screens/AccountsScreen.tsx` | `tests/web/accounts-*.test.mjs` |
| **Tổng quan & Bridge V4 (`/dashboard`)** | `packages/contracts/src/dashboard.ts` | `dashboard/service.ts`, `bridge/service.ts` | `screens/DashboardScreen.tsx` | `tests/web/cross-system-bridge.test.mjs` |
| **Nhật ký hệ thống (`/system-logs`)** | `migrations/0028_system_logs.sql` | `system-logs/service.ts` | `screens/SystemLogsScreen.tsx` | `tests/web/system-logs-screen.test.mjs` |

<!-- LIVE_CHECKPOINT_END -->

## 🔄 4. QUY TRÌNH ĐỒNG BỘ ĐA MÁY & PHÁT HÀNH VERSION

- **Trước khi làm:** Đọc duy nhất mục `1. LIVE_CHECKPOINT` & `2. PHASE_TASK_TRACKER`, mở đúng file trong `3. MODULE_FILE_MAP`.
- **Sau khi xong mỗi Phase:**
  1. Chạy kiểm thử chọn lọc của phân hệ vừa sửa + `npm run build` + `npm run build:web`.
  2. Tăng số Version trong `package.json` và `packages/contracts/src/version.ts` (`SYSTEM_VERSION` & `RELEASE_NOTES_CATALOG`).
  3. Cập nhật bảng `PHASE_TASK_TRACKER` trong `AGENTS.md`.
  4. `git commit` + `git tag v0.1.x` + `git push` lên GitHub và đồng bộ sang `C:\HoaiPhuong-Server\apps\management-lite`.
