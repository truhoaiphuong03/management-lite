# Kế Hoạch Nâng Cấp Toàn Diện Hệ Thống `management-lite` (`ql.hoaiphuong.click`)

> **For Lead Developer (Antigravity):** Tài liệu này tổng hợp kết quả rà soát chuyên sâu toàn bộ 14 phân hệ, 63 bảng PostgreSQL 18 (`30` migrations) và cấu hình dịch vụ Windows Server của `management-lite`, đồng thời lập kế hoạch nâng cấp theo 4 giai đoạn ưu tiên.

**Goal:** Kích hoạt 100% các tính năng hạ tầng đang chờ cấu hình (`Google Drive Live OAuth`, `Account Secrets Encryption`, `AI Receipt Store`), hoàn thiện vòng lặp nghiệp vụ **Chấm công → Báo cáo → Bảng lương (Thưởng/Phụ cấp/Khấu trừ + VietQR) → Sổ thu chi**, nâng cấp trải nghiệm Quản trị Nhân sự/Dashboard và tối ưu hiệu năng tải trang.

**Architecture:** Giữ nguyên kiến trúc Monorepo (`@hp/contracts` → `@hp/database` → `@hp/api` Fastify → `@hp/web` React/Vite) và nguyên tắc **Dual UI (Desktop & Mobile responsive)**. Mọi thay đổi schema đều đi qua migration tuần tự (`0031+`) và kiểm thử tự động trước khi Owner phát hành lên Production qua cổng phát hành (AI không tự đồng bộ — xem `AGENTS.md` §0).

**Tech Stack:** TypeScript, Fastify, PostgreSQL 18, React 18, Vite, Node test runner (`node --test`).

---

## Tổng Hợp Kết Quả Rà Soát: Hệ Thống Đã Có Gì & Còn Thiếu Gì?

### 1. Những gì đã hoàn thiện và chạy ổn định (`88% - 90%`)

- **14 màn hình nghiệp vụ cốt lõi** đã hoạt động trên `https://ql.hoaiphuong.click`: Tổng quan (`/dashboard`), Chấm công (`/clock`), Bảng công (`/attendance`), Sửa giờ công (`/attendance/corrections`), Báo cáo ngày (`/reports`), Công việc (`/work`), Lịch trình (`/schedule`), Bảng lương (`/payroll`), Thống kê & Import/Export Excel lương (`/payroll/stats`), Sổ thu chi (`/finance`), Lưu trữ Google Drive (`/storage`), Tài khoản dùng chung (`/accounts`), Nhân sự (`/employees`), Nhật ký hệ thống (`/system-logs`) và Cài đặt (`/settings`).
- **Hồ sơ nhân sự & Ngân hàng (Migration `0030`):** Đã hỗ trợ đầy đủ SĐT, Ngày sinh, Giới tính, CCCD, Địa chỉ, Chức danh, Liên hệ khẩn cấp, Ngân hàng nhận lương (Ngân hàng, Số TK, Chủ TK) và cửa sổ tự động nhắc nhân viên cập nhật SĐT khi đăng nhập.

### 2. Các điểm còn thiếu / nghẽn cần nâng cấp (`10% - 12%` còn lại)

| Nhóm                             | Hạng mục còn thiếu / chưa kích hoạt                                                      | Hiện trạng kỹ thuật trong Code / Server                                                                                                                                                                                                       | Mức ưu tiên          |
| -------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **A. Hạ tầng & Cấu hình Server** | **1. Google Drive Live OAuth (`/storage`)**                                              | 5 biến OAuth thật đang nằm ở file rời `C:\HoaiPhuong-Server\config\test-secrets\google-drive-oauth.env`, chưa nạp vào `api.env` của dịch vụ `HPManagementLiteApi`.                                                                            | **P0 (Làm ngay)**    |
| **A. Hạ tầng & Cấu hình Server** | **2. Mã hóa Mật khẩu & 2FA (`/accounts`)**                                               | Biến `ACCOUNT_SECRET_KEY` (32-byte hex AES-256-GCM) chưa được khai báo trong `api.env`, khiến chức năng lưu/xem mật khẩu & TOTP tài khoản dùng chung chưa bật trên Server.                                                                    | **P0 (Làm ngay)**    |
| **A. Hạ tầng & Cấu hình Server** | **3. Lưu trữ & Quét hóa đơn AI (`/finance`)**                                            | Đã có `GEMINI_API_KEY` trong `api.env` nhưng thiếu `FIN_RECEIPT_DIR`, làm `ReceiptStore` và tính năng đính kèm/OCR ảnh hóa đơn thu chi bị tắt.                                                                                                | **P0 (Làm ngay)**    |
| **B. Bảng lương & Thu chi**      | **4. Thưởng (`bonus`), Phụ cấp (`allowance`) & Khấu trừ (`deduction`) (`OI-04`)**        | `PayrollService.adjustment()` (`apps/api/src/payroll/service.ts:510`) đang chặn cứng chỉ cho phép `'paid_leave'` và gán cứng `bonus_vnd = 0`, `allowance_vnd = 0`, `deduction_vnd = 0`. Import cột `THƯỞNG` từ Excel mới chỉ dừng ở cảnh báo. | **P1 (Quan trọng)**  |
| **B. Bảng lương & Thu chi**      | **5. Hiển thị Số TK & Mã QR chuyển khoản (`VietQR`) khi Chi trả lương**                  | Nhân sự đã có thông tin ngân hàng (migration `0030`), nhưng màn hình `/payroll` và modal **Chi trả lương** chưa hiển thị Số TK/Ngân hàng và chưa tạo mã **VietQR** tự động theo số tiền thực lĩnh.                                            | **P1 (Quan trọng)**  |
| **B. Bảng lương & Thu chi**      | **6. Tự động ghi nhận Phiếu chi lương sang Sổ thu chi (`/finance`)**                     | Khi Owner bấm **Chi trả lương** ở `/payroll`, hệ thống chưa tự động (hoặc tùy chọn 1-click) tạo phiếu chi tương ứng bên `/finance`, khiến Owner phải nhập tay 2 lần.                                                                          | **P1 (Quan trọng)**  |
| **C. Nhân sự, Báo cáo & UX**     | **7. Danh sách Nhân sự (`/employees`) thiếu cột SĐT, Chức danh, Ngân hàng & Xuất Excel** | Bảng `/employees` hiện chỉ hiện Mã NV, Họ tên, Email, Trạng thái; chưa hiển thị nhanh SĐT, Chức danh, trạng thái đã có TK ngân hàng và nút xuất danh sách nhân sự.                                                                            | **P2 (Nâng cao UX)** |
| **C. Nhân sự, Báo cáo & UX**     | **8. Nhắc nộp Báo cáo ngày sau khi Chấm công ra ca (`/clock` → `/reports`)**             | Khi nhân viên bấm **Ra ca (Clock-out)**, chưa có nút/hộp thoại gợi ý chuyển sang điền ngay Báo cáo công việc cho ca vừa làm.                                                                                                                  | **P2 (Nâng cao UX)** |
| **C. Nhân sự, Báo cáo & UX**     | **9. Trung tâm Việc cần xử lý trên Dashboard (`/dashboard`)**                            | Dashboard chưa có các thẻ đếm hành động nhanh cho Owner (_Ca chờ duyệt_, _Yêu cầu sửa giờ công chờ duyệt_, _Nhân sự thiếu SĐT/Ngân hàng_, _Việc chờ nghiệm thu_).                                                                             | **P2 (Nâng cao UX)** |
| **D. Liên thông V4 & Hiệu năng** | **10. Bảng ánh xạ Nhân sự V4 (`hoaiphuong.click` ↔ `NV001`...) & Chia nhỏ Bundle Web**   | Cần giao diện xác nhận ánh xạ tài khoản V4 với mã nhân viên `NVxxx` để mở khóa tự động đồng bộ sản lượng kịch bản/video; đồng thời tách bundle Vite (`~1.03 MB` → các chunk `< 400 kB`).                                                      | **P3 (Tối ưu)**      |

---

## Lộ Trình Triển Khai Chi Tiết (4 Giai Đoạn)

---

### GIAI ĐOẠN 1: Kích Hoạt Hạ Tầng & Dịch Vụ Thực Tế Trên Server (`P0 — Không đổi Schema`)

#### Task 1.1: Hợp nhất cấu hình `Google Drive Live OAuth`, `ACCOUNT_SECRET_KEY` và `FIN_RECEIPT_DIR` vào `api.env`

**Files:**

- Modify (Server Config): `C:\HoaiPhuong-Server\config\test-secrets\api.env`
- Reference: `apps/api/src/config.ts` (`lines 100-150`)
- Reference: `apps/api/src/server.ts` (`lines 125-210`)

**Step 1: Kiểm tra và bổ sung biến môi trường vào `api.env`**

- Gộp 5 biến từ `C:\HoaiPhuong-Server\config\test-secrets\google-drive-oauth.env`:
  - `GOOGLE_DRIVE_LIVE_ENABLED=true`
  - `GOOGLE_CLIENT_ID=...`
  - `GOOGLE_CLIENT_SECRET=...`
  - `GOOGLE_REDIRECT_URI=https://ql.hoaiphuong.click/api/v1/storage/drive/callback`
  - `STORAGE_DRIVE_ENCRYPTION_KEY_HEX=...`
- Sinh và nạp khóa mã hóa AES-256-GCM 32-byte (64 ký tự hex) cho `ACCOUNT_SECRET_KEY`.
- Tạo thư mục `C:\HoaiPhuong-Server\data\management-lite\receipts` và khai báo `FIN_RECEIPT_DIR=C:\HoaiPhuong-Server\data\management-lite\receipts`.

**Step 2: Khởi động lại dịch vụ và kiểm tra Health/Status**

- Run: `Restart-Service HPManagementLiteApi`
- Verify: Kiểm tra API `/api/v1/storage/drive/connections`, `/api/v1/accounts`, và `/api/v1/finance/entries` hoạt động không báo lỗi thiếu khóa cấu hình.

---

### GIAI ĐOẠN 2: Nâng Cấp Bảng Lương (`Thưởng / Phụ Cấp / Khấu Trừ`), Mã `VietQR` & Đồng Bộ Sổ Thu Chi (`P1`)

#### Task 2.1: Mở khóa nghiệp vụ Thưởng (`bonus`), Phụ cấp (`allowance`) & Khấu trừ (`deduction`) (`OI-04`)

**Files:**

- Modify: `packages/contracts/src/payroll.ts`
- Modify: `apps/api/src/payroll/service.ts` (`lines 320-650`)
- Modify: `apps/api/src/payroll/timesheet-service.ts`
- Modify: `apps/web/src/screens/PayrollScreen.tsx`
- Test: `tests/backend/pay-18-23-invariants.test.mjs`

**Step 1: Mở rộng Contract & Service tính lương**

- Cho phép `adjustment_type` nhận 4 giá trị: `'paid_leave' | 'bonus' | 'allowance' | 'deduction'`.
- Trong `PayrollService.projection()` và `PayrollService.finalize()`:
  - Tính tổng từng nhóm từ `payroll_adjustments`:
    - `leave_pay_vnd` (`adjustment_type = 'paid_leave'`)
    - `bonus_vnd` (`adjustment_type = 'bonus'`)
    - `allowance_vnd` (`adjustment_type = 'allowance'`)
    - `deduction_vnd` (`adjustment_type = 'deduction'`)
  - Công thức thực lĩnh chuẩn:
    $$\text{net\_pay\_vnd} = \max(0, \text{base\_pay\_vnd} + \text{leave\_pay\_vnd} + \text{allowance\_vnd} + \text{bonus\_vnd} - \text{deduction\_vnd})$$
- Trong `TimesheetService` (`apps/api/src/payroll/timesheet-service.ts`): Khi import file Excel chấm công có cột `THƯỞNG > 0`, hỗ trợ ghi nhận hoặc tạo điều chỉnh thưởng tương ứng.

**Step 2: Cập nhật giao diện `PayrollScreen.tsx`**

- Trong modal **Thêm điều chỉnh lương**, mở bộ chọn loại điều chỉnh:
  - `Nghỉ phép hưởng lương (+)`
  - `Thưởng (+)`
  - `Phụ cấp (+)`
  - `Khấu trừ / Phạt (-)`
- Hiển thị rõ các cột `Phụ cấp`, `Thưởng`, `Khấu trừ` trên bảng lương và phiếu lương cá nhân.

**Step 3: Chạy kiểm thử**

- Run: `node --test tests/backend/pay-18-23-invariants.test.mjs tests/web/payroll-stats-screen.test.mjs`

---

#### Task 2.2: Tích hợp Thông tin Ngân hàng & Mã QR chuyển khoản (`VietQR`) ngay trong Modal Chi trả lương

**Files:**

- Modify: `packages/contracts/src/payroll.ts`
- Modify: `apps/api/src/payroll/service.ts`
- Modify: `apps/web/src/screens/PayrollScreen.tsx`
- Test: `tests/web/payroll-vietqr.test.mjs`

**Step 1: Bổ sung thông tin ngân hàng vào dòng chiếu lương (`PayrollProjectionRow`)**

- Join thêm `e.phone`, `e.bank_name`, `e.bank_account_number`, `e.bank_account_holder` trong truy vấn `PayrollService.projection()`.

**Step 2: Hiển thị thông tin chuyển khoản & mã VietQR trên `PayrollScreen.tsx`**

- Trong bảng lương và hộp thoại **Chi trả lương (`Ghi nhận chi trả`)**:
  - Hiển thị rõ: **Ngân hàng**, **Số tài khoản** (kèm nút `Sao chép`), **Chủ tài khoản**.
  - Nếu nhân sự đã có tên ngân hàng + số tài khoản, tự động dựng mã QR chuyển khoản chuẩn Napas/VietQR với số tiền mặc định bằng **Số tiền còn phải trả (`remaining_vnd`)** và nội dung chuyển khoản `LUONG <KY_LUONG> <MA_NV> <HO_TEN>`.
  - Nếu nhân sự chưa cập nhật ngân hàng, hiển thị cảnh báo kèm link mở nhanh sang hồ sơ nhân sự (`/employees/:id`).

---

#### Task 2.3: Tùy chọn tự động tạo Phiếu chi trong Sổ thu chi (`/finance`) khi Chi trả lương

**Files:**

- Modify: `packages/contracts/src/payroll.ts`
- Modify: `apps/api/src/payroll/service.ts`
- Modify: `apps/web/src/screens/PayrollScreen.tsx`

**Step 1: Liên kết `disburse()` với `fin_entries`**

- Thêm tùy chọn `create_finance_expense?: boolean` (mặc định `true` trên UI khi Owner bấm chi trả) trong `PayDisburseRequest`.
- Khi `create_finance_expense === true`, tự động ghi 1 dòng `expense` vào bảng `fin_entries` với số tiền chi trả, ngày chi trả và mô tả `Chi trả lương kỳ <period_month> - <full_name> (<employee_code>)`.

---

### GIAI ĐOẠN 3: Hoàn Thiện Quản Trị Nhân Sự, Báo Cáo Ngày & Trung Tâm Nhắc Việc Dashboard (`P2`)

#### Task 3.1: Nâng cấp Bảng danh sách Nhân sự (`/employees`) & Xuất Excel/CSV

**Files:**

- Modify: `apps/web/src/screens/EmployeesScreen.tsx`
- Modify: `tests/web/employee-detail-screen.test.mjs`

**Step 1: Hiển thị thông tin mở rộng trên `EmployeesScreen.tsx`**

- Bổ sung cột/thẻ: **Chức danh (`position_title`)**, **Số điện thoại (`phone`)**, và **Ngân hàng (`bank_name` / trạng thái đã cập nhật)**.
- Thêm ô tìm kiếm nhanh theo Mã NV, Họ tên, Email, SĐT và nút **Xuất CSV/Excel danh sách nhân sự**.

---

#### Task 3.2: Liên kết khép kín Chấm công Ra ca (`/clock`) → Nộp Báo cáo ngày (`/reports/new`)

**Files:**

- Modify: `apps/web/src/screens/ClockScreen.tsx`
- Modify: `apps/web/src/screens/DashboardScreen.tsx`

**Step 1: Gợi ý nộp báo cáo ngay sau khi Clock-out**

- Trên `ClockScreen.tsx`, ngay sau khi nhân viên bấm **Ra ca** thành công, hiển thị thẻ hành động nổi bật: _"Bạn đã hoàn thành ca làm việc! Bấm vào đây để gửi Báo cáo công việc hôm nay"_ dẫn thẳng tới `/reports/new`.
- Trên `DashboardScreen.tsx`, hiển thị danh sách **Việc cần xử lý (Action Center)** riêng cho Owner (duyệt ca, duyệt sửa giờ, nhân sự thiếu SĐT/Ngân hàng) và cho Nhân viên (nhắc nộp báo cáo, công việc đang làm).

---

### GIAI ĐOẠN 4: Liên Thông V4 Nâng Cao & Tối Ưu Hóa Bundle Web (`P3`)

#### Task 4.1: Giao diện xác nhận ánh xạ nhân sự Bridge (`hoaiphuong.click` ↔ `ql.hoaiphuong.click`)

**Files:**

- Modify: `apps/api/src/bridge/service.ts`
- Modify: `apps/web/src/screens/DashboardScreen.tsx`

**Step 1: Cho phép Owner ghép tài khoản V4 với mã nhân viên `NVxxx` cố định**

- Lưu bảng ánh xạ xác nhận để chức năng đồng bộ sản lượng Kịch bản/Video từ V4 tự động điền đúng nhân sự mà không sợ nhầm người.

#### Task 4.2: Chia nhỏ Bundle Frontend (`manualChunks`)

**Files:**

- Modify: `apps/web/vite.config.ts`

**Step 1: Cấu hình `rollupOptions.output.manualChunks`**

- Tách `vendor` (React/Router) và các màn hình lớn để giảm dung lượng gói JS chính từ `~1,030 kB` xuống `< 400 kB`, giúp tải trang trên mạng di động 4G nhanh hơn gấp đôi.
