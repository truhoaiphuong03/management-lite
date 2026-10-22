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
- **VIỆC TIẾP THEO (`NEXT_ACTION`):**
  - Hệ sinh thái `ql.hoaiphuong.click` (`v0.1.3`) ↔ `hoaiphuong.click` đã kết nối dữ liệu toàn diện, kiểm thử PASS 100% và phát hành tự động lên web. Sẵn sàng nhận yêu cầu mới!

<!-- LIVE_CHECKPOINT_END -->

## 🔄 QUY TRÌNH ĐỒNG BỘ ĐA MÁY (3 máy: MacBook M2 + 2 Windows)
Script: `scripts/sync-all.sh` (macOS) · `scripts/sync-all.ps1` (Windows). Thư mục gốc `~/Projects` (đổi bằng biến `PROJECTS_DIR`).
- **Trước khi làm:** `scripts/sync-all.sh start` → fetch + pull `--ff-only` cả 4 dự án (tự clone nếu thiếu; DỪNG nếu có thay đổi chưa commit).
- **Sau khi làm:** cập nhật `LIVE_CHECKPOINT` → `scripts/sync-all.sh end` → auto commit + `pull --rebase` + push.
- **Quy tắc:** mỗi máy chỉ làm 1 nhánh/1 dự án tại một thời điểm; không bao giờ đổi máy khi chưa push; không commit `.env`/secrets.
- **Máy:** Máy 1 MacBook Air M2 `MacBook-Air-cua-Duong` · Windows 2 `DESKTOP-ATTJ7FE` · Windows 1.
- **Windows lần đầu:** `git clone https://github.com/truhoaiphuong03/management-lite.git ~/Projects/management-lite` rồi chạy `.\scripts\sync-all.ps1 start` (có thể cần `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).
