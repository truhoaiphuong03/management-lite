# 2026-10-27 — Thống kê lương, Excel chấm công, liên kết báo cáo (bàn giao đa máy)

Máy làm: Máy 1 MacBook Air M2. Nhánh: `codex/shared-admin-sso-no-gps`. Commit code: `61bfab5`.

## Đã làm
- **Migration `0027_timesheet_import`**: thêm `attendance_shifts.source` (`clock`/`import`) và `import_ref` (duy nhất theo workspace) để nhập lại không bị trùng.
- **Thống kê lương** `GET /api/v1/payroll-tools/stats?granularity=day|week|month|year&from&to&employee_id` (Owner). Dùng lại `PayrollService.overview` từng tháng nên khớp bảng lương tháng. Tuần Thứ Hai–Chủ nhật, múi giờ Asia/Ho_Chi_Minh. Mỗi ngày công gắn báo cáo công việc cùng nhân viên + ngày; có đếm ngày thiếu báo cáo.
- **Excel**: `GET .../timesheet/export?employee_id&year` (mỗi tháng có dữ liệu một tab `T<m>`, đúng mẫu Google Sheet, có công thức, chỉ tháng có ca đã duyệt). `POST .../timesheet/import` (JSON `file_base64`, `year`, `employee_id` hoặc `new_employee_name`, `commit`). `commit=false` = Xem trước (chạy cùng đường code rồi ROLLBACK).
- **Nhập**: tạo nhân viên nếu chưa có (không tài khoản), chèn đơn giá lịch sử (20.000 rồi 25.000 từ ngày 01 của tháng đổi giá), ca đã hoàn tất + đã duyệt (người duyệt = Owner đang nhập), báo cáo công việc `submitted` từ cột công việc. Bỏ qua ca trùng thời gian/đã nhập, ca tương lai, ca thiếu đơn giá. Cột THƯỞNG chưa hỗ trợ → cảnh báo, không nhập.
- **Web**: màn hình `/payroll/stats` (`PayrollStatsScreen.tsx`), nút "Thống kê & Excel" ở trang Lương; `/reports?employee=<uuid>&date=YYYY-MM-DD` tự lọc.
- Tệp mới: `apps/api/src/payroll/{xlsx,timesheet,stats,timesheet-service}.ts`, test `tests/backend/timesheet-xlsx.test.mjs`.

## Kiểm tra đã chạy (Mac)
typecheck, eslint, prettier PASS. Web 384 PASS. Backend 192 PASS / 16 FAIL (cũ: thiếu PostgreSQL/Windows, baseline trước khi sửa là 188/16). DB 28 PASS / 2 FAIL cũ.
File Google Sheet thật đọc đúng: 53 ca, 167,28 giờ.

## CHƯA làm / chưa kiểm chứng
- Phần ghi DB của import và `stats`/`export` **chưa chạy trên PostgreSQL thật** (Mac không có PostgreSQL).
- **Chưa deploy Production** và **chưa nhập dữ liệu thật**. Cổng phát hành yêu cầu chữ ký Owner độc lập; workflow `deploy.yml` chỉ chạy trên `main`. AI không tự ký.
- Nhánh này chưa merge vào `main` (còn việc SSO/HOLD cũ).

## Việc tiếp theo cho máy khác
1. `scripts/sync-all.sh start` (hoặc `.ps1`), `npm run build`.
2. Trên PostgreSQL QA: `npm run migrate` (0027), chạy import ở chế độ Xem trước với file chấm công (Nguyễn Huỳnh Thế Vinh, năm 2026, đơn giá 20.000 → 25.000 từ 01/07). Kỳ vọng: 53 ca, 167,28 giờ, lương ≈ 3.896.250 đ (lệch vài đồng do làm tròn theo ngày).
3. Nếu đạt: Owner duyệt, rồi quy trình phát hành chuẩn (Approve-ReleaseSha → Deploy) mới nhập Production.
4. Cân nhắc viết test PostgreSQL cho import/stats (đặt trong `tests/database` hoặc `tests/backend` có điều kiện QA).

## Nhật ký hệ thống (`/system-logs`) — thêm cùng ngày
- **Migration `0028_system_logs`**: bảng `system_logs` (level, source api/web, request_id, route đã chuẩn hóa, status, duration_ms, error_code, message, stack, fingerprint, release, metadata). Tự xóa bản ghi quá 30 ngày.
- **Ghi log** (`apps/api/src/system-log/service.ts`, hook `res.once('finish')` trong `app.ts`): mọi 4xx (trừ 401 và 404 tệp tĩnh), 5xx, yêu cầu ≥ 3 giây. Ghi bất đồng bộ theo lô, không bao giờ làm hỏng request. Mật khẩu/token/chuỗi kết nối bị che trước khi lưu. Lỗi trình duyệt gửi qua `apps/web/src/client-error-reporter.ts` (giới hạn 20/phút/người, chống trùng).
- **API (Owner)**: `GET /api/v1/system/logs` (lọc level, source, status_min, route, request_id, fingerprint, q, from, to, cursor), `/logs/summary?hours=`, `/logs/:id` (kèm audit cùng request_id và số lần gặp). `POST /api/v1/system/client-errors`.
- **Màn hình**: thẻ tổng số lỗi/cảnh báo/chậm, biểu đồ theo thời gian, "Lỗi lặp lại nhiều nhất" (bấm để lọc), bảng có phân trang, chi tiết có stack + nút "Sao chép báo cáo lỗi".
- **Chưa kiểm chứng**: đọc/ghi `system_logs` trên PostgreSQL thật (test hiện dùng DB giả cho phần ghi; hook yêu cầu đã chạy thử với handler thật).
- **Lưu ý**: cờ `implemented:false` của `/activate`, `/employees*`, `/attendance/corrections` bị test khóa (ui-demo, ui-fix-43) — không đổi.
