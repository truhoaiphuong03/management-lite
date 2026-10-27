# AGENTS.md — `management-lite`

<!-- LIVE_CHECKPOINT_START -->

## 📌 LIVE_CHECKPOINT (ĐỌC DUY NHẤT MỤC NÀY ĐẦU PHIÊN — CẤM KIỂM TRA LẠI VIỆC ĐÃ XONG)

- **Dự án:** `management-lite` | **Nhánh:** `main`
- **Tiến độ lũy kế:** Giai đoạn 5/5 (100%)
- **Hạng mục ĐÃ XONG (`DONE`):**
  - [x] Khung quản lý vận hành Lite & Mobile P0 multi-profile headless browser launcher (`481977f`).
  - [x] Hoàn thiện kiểm thử tự động Mobile P0 (macOS/Linux/Windows headless + multi-route 320px audit) & chuẩn hóa bố cục responsive `minmax(min(100%, ...), 1fr)` trên toàn bộ 14 màn hình quản trị.
  - [x] Hoàn thành phân quyền RBAC 3 vai trò (`CP22-04`: `Owner` / `Admin` / `Staff`) và 4 tính năng mở rộng (Export Excel/CSV, Audit Export, GPS Geofencing, MFA/TOTP) (`c771cf9`).
  - [x] Hoàn tất bộ kiểm thử nghiệm thu tự động `tests/web/cp22-04-extensions.test.mjs` (PASS 100%) — Sẵn sàng đồng bộ MacBook ↔ Windows Server.
  - [x] Hợp nhất toàn bộ tính năng phát triển trên máy Windows (`anty/feat-storage-v2-google-drive` `c145f5c`) vào `main`: Storage V2 Google Drive (migration `0025`), Xác thực Email Brevo `/verify-email`, Lịch sử/Phê duyệt chấm công & Form Tài khoản nâng cao (migration `0024`).
  - [x] Cập nhật danh mục phát hành chính thức `v0.1.2` (`RELEASE_NOTES_CATALOG`) và đồng bộ tự động cả Backend API + Frontend Web + Migration trực tiếp lên `https://ql.hoaiphuong.click`.
  - [x] Kết nối dữ liệu toàn diện hai chiều giữa `ql.hoaiphuong.click` (`management-lite` `v0.1.3`) và `hoaiphuong.click` (`tiktok-ai-factory-v4`): Đồng bộ Nhân sự/Tài khoản, Tự động quy đổi sản lượng Kịch bản/Prompt/Video sang Báo cáo & Công việc, và Liên kết Kênh TikTok & Kho Google Drive.
  - [x] [WIN-1 • 2026-10-20 15:36] Đã thực thi & kiểm tra (npm run typecheck && npm run test:security): Kiểm tra lại lần nữa
  - [x] [MAC • 2026-10-22] DEV: Sửa an toàn bridge (giữ nguyên báo cáo, chặn nguồn lỗi/thiếu khóa, xác nhận nhân sự, cache theo workspace, chống trùng công việc), bộ đếm ngày theo timezone và phiên bản UI 0.1.3. 40/40 kiểm thử hồi quy/bảo mật PASS; web 381 PASS, 4 SKIP. Chi tiết: `docs/reports/2026-10-22-bridge-safety-fix.md`. Chưa deploy Production.
  - [x] [MAC • 2026-10-22 • Rà soát 2] DEV: Sửa retry Request/CSRF khi gia hạn phiên, cột email và trạng thái Drive trong bridge; bỏ thông báo GPS/MFA thành công giả, ghi rõ Admin chưa bật. Web 383 PASS/4 SKIP; backend chọn lọc 37 PASS/6 SKIP; hồi quy bridge + Request + CP22 23 PASS/1 SKIP. Đã thêm kiểm thử PostgreSQL bridge vào CI, chưa chạy tại Mac. Chi tiết: `docs/reports/2026-10-22-system-audit-round2.md`.
  - [x] [WIN-1 • 2026-10-22 10:23] Đã thực thi & kiểm tra (npm run typecheck && npm run test:security): Kiểm tra báo cáo tiến độ dự án #5
  - [x] [MAC • 2026-10-27] DEV: Thống kê lương theo ngày/tuần/tháng/năm (`/payroll/stats`, API `/api/v1/payroll-tools/stats`, liên kết báo cáo công việc theo nhân viên + ngày), xuất/nhập Excel chấm công theo năm đúng mẫu Google Sheet (mỗi tháng một tab, chỉ tháng có dữ liệu; `/api/v1/payroll-tools/timesheet/{export,import}`, có xem trước, không ghi đè ca đã có), migration `0027_timesheet_import`. Web 384 PASS; backend +4 PASS mới, 16 FAIL cũ do thiếu PostgreSQL/Windows (giống trước khi sửa). Phần ghi DB (import) CHƯA chạy trên PostgreSQL thật. Chưa nhập dữ liệu thật, chưa deploy. Bàn giao: `docs/reports/2026-10-27-timesheet-stats-handoff.md`.
- **KẾT LUẬN RÀ SOÁT (2026-10-22):** Nghiệm thu hệ thống hiện **HOLD**. Các mốc DONE lịch sử không chứng minh MFA/GPS/Admin đã triển khai: hiện chỉ có giao diện giới thiệu, membership DB vẫn owner/staff. Không tự cấp quyền hoặc khẳng định có MFA/geofencing.
- [DEV • MAC • 2026-10-22] Nhánh review `codex/shared-admin-sso-no-gps`: bỏ GPS, sửa CSRF Dashboard và chuẩn bị SSO Owner → admin V4, siết khóa bridge. 47 kiểm thử quản lý và HTTP liên thông cục bộ PASS. Chưa kích hoạt Production, chưa đổi mật khẩu/xóa tài khoản; V4 từ chối đăng nhập, số nhân sự bridge chưa khớp. Chi tiết: `docs/reports/2026-10-22-shared-admin-sso.md`.
- **VIỆC TIẾP THEO (`NEXT_ACTION`):**
  - [MAC • 2026-10-27] Chạy migration `0027` + thử import tệp chấm công (Nguyễn Huỳnh Thế Vinh, năm 2026, 53 ca/167,28 giờ, đơn giá 20.000 → 25.000 từ 01/07) trên PostgreSQL QA bằng chế độ Xem trước, đối chiếu tổng lương ~3.896.250 đ (lệch vài đồng do làm tròn theo ngày), rồi Owner duyệt mới nhập Production.
  - [MAC • 2026-10-22] Đã sửa lỗi PostgreSQL importer tạo trạng thái sai (`todo` bắt buộc) và dấu phân tách nguồn chống trùng; CI đang xác minh lại. Đã mở khôi phục V4, Owner cần tự hoàn tất mật khẩu. Cổng phát hành yêu cầu chữ ký Owner độc lập, không tự ký từ AI.
  - Chạy nghiệm thu PostgreSQL QA/Windows, kiểm thử hai hệ thống với khóa riêng; chưa deploy Production. Báo cáo sản lượng tự động vẫn tạm dừng đến khi có ánh xạ nhân viên/ngày đáng tin cậy. Rà tiếp metadata release, 63 phát hiện UI và các luồng tích hợp chưa chạy.

<!-- LIVE_CHECKPOINT_END -->

## 🔄 QUY TRÌNH ĐỒNG BỘ ĐA MÁY (3 máy: MacBook M2 + 2 Windows)
Script: `scripts/sync-all.sh` (macOS) · `scripts/sync-all.ps1` (Windows). Thư mục gốc `~/Projects` (đổi bằng biến `PROJECTS_DIR`).
- **Trước khi làm:** `scripts/sync-all.sh start` → fetch + pull `--ff-only` cả 4 dự án (tự clone nếu thiếu; DỪNG nếu có thay đổi chưa commit).
- **Sau khi làm:** cập nhật `LIVE_CHECKPOINT` → `scripts/sync-all.sh end` → auto commit + `pull --rebase` + push.
- **Quy tắc:** mỗi máy chỉ làm 1 nhánh/1 dự án tại một thời điểm; không bao giờ đổi máy khi chưa push; không commit `.env`/secrets.
- **Máy:** Máy 1 MacBook Air M2 `MacBook-Air-cua-Duong` · Windows 2 `DESKTOP-ATTJ7FE` · Windows 1.
- **Windows lần đầu:** `git clone https://github.com/truhoaiphuong03/management-lite.git ~/Projects/management-lite` rồi chạy `.\scripts\sync-all.ps1 start` (có thể cần `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).
