# ROADMAP — `management-lite`

> Phân tách rõ giữa **(1) Các Phase đã hoàn thành trong Repository (`DONE` — Cấm làm lại theo Zero-Recheck Rule)**, **(2) Phase quản trị hiện tại đang chờ Owner nghiệm thu (`PASS`)**, và **(3) Các hạng mục đề xuất / cổng phát hành chờ lệnh Owner (`BACKLOG` / `PENDING OWNER GATE`)**.

---

## 1. Các Phase Đã Hoàn Thành Trên Nhánh `main` (`v0.1.0` → `v0.7.2` — `DONE`)

> Toàn bộ `35` Phase sản phẩm & remediation (`95` Task định danh duy nhất) dưới đây đã hoàn thành trong mã nguồn nhánh `main` (commit `bcdb36c`, tag `v0.7.2`). Chi tiết 13 trường của từng Task xem tại [`docs/PHASE_TASK_HISTORY.md`](./PHASE_TASK_HISTORY.md). **Tuyệt đối không tự ý chạy lại hoặc làm lại (Zero-Recheck Rule).**

- **Phase 0 (`v0.1.0` – `v0.1.3` — Foundation `PK-00`, `FT-01`, `PK-01`, `AUTH-01A`, `C06-DB-01`, `CP2.2`):** Nền tảng Monorepo, 59 tài liệu Canonical (`0.1.0-doc.21`), PostgreSQL 18 migrations (`0001`–`0029`), xác thực Argon2id + CSRF + RBAC, cô lập workspace và tích hợp phân tích lỗi AI (`DONE`).
- **Phase 1 → Phase 4 (`v0.1.4` – `v0.2.0`):** Hồ sơ nhân sự mở rộng & ngân hàng (`migration 0030`), bảng lương `Thưởng/Phụ cấp/Khấu trừ` + `VietQR` + tự động ghi Sổ thu chi, xuất CSV nhân sự, Trung tâm Việc cần xử lý trên Dashboard, bảng ánh xạ nhân sự V4 và chia nhỏ gói JS (`DONE`).
- **Phase 5 → Phase 10 (`v0.2.1` – `v0.2.6`):** Chi tiết phiếu lương cá nhân (`/my-pay`), bộ chọn `Ngày/Tháng/Năm` tiếng Việt & gợi ý 35 ngân hàng Napas, tự duyệt ca Owner & đóng ca treo giúp nhân viên (`owner-close`), sửa CSRF Google Drive OAuth, và nâng cấp Trung tâm Công việc `ML-03..05` (`DONE`).
- **Phase 11 → Phase 13 (`v0.3.0` – `v0.3.2`):** Thanh điều hướng phụ `Sub-Navigation Bar`, tối ưu giao diện điện thoại (`MobileBottomNav` 1 dòng, modal `100dvh`, lưới KPI `2×2`, thẻ Drive di động) và hotfix lưu hồ sơ nhân sự (`DONE`).
- **Phase 14 (`v0.3.3`):** Gia cố bảo mật khẩn cấp (xác thực IP tin cậy `CF-Connecting-IP`, khóa đăng nhập sai theo tài khoản, header CSP/XFO/HSTS, `scripts/runtime/serve-web.cjs`, dọn phiên/idempotency, `statement_timeout=30s`) (`DONE` trên repo).
- **Phase UI-0 → UI-5 (`v0.5.0`, `v0.5.3`, `v0.5.5`):** Công cụ kiểm toán tự động `npm run audit:ui` (Playwright + Axe), chuyển ~2.100 màu cứng sang biến CSS theme Light/Dark đạt chuẩn tương phản AA (`0` lỗi trên 144 kịch bản), tự động chuyển bảng sang thẻ di động (`responsive-tables.ts`), gắn nhãn truy cập form (`a11y-forms.ts`) và Việt hóa nhãn menu (`DONE`).
- **Phase 15 → Phase 19 (`v0.5.2` – `v0.5.6`) & Hotfix `v0.5.7`:** Tối ưu tốc độ tải trang (`React.lazy` theo route, nén Brotli/Gzip, cache `immutable`, giảm JS khởi đầu `1.080 kB → 418 kB`), quy trình phát hành qua cổng Owner (`OWNER-RELEASE-RUNBOOK.md` + `gen-build-info.mjs`), sửa tràn ngang `320px`, bảng định tuyến `RouteTable` `O(1)` + phân trang con trỏ `keyset` + `UNNEST` lịch tuần, bộ công cụ vận hành/kiểm toán dữ liệu (`scripts/ops/*`) và nút Báo lỗi nổi kéo thả tự do (`DONE`).
- **Phase 20 → Phase 22 (`v0.6.0` – `v0.6.2`):** Hệ sinh thái Quản lý Tài khoản 4 tầng (`SĐT/SIM ➔ Gmail gốc ➔ TikTok/FB/YTB` + `GG Authenticator` + `TK Khôi phục`, `migration 0031`), tra cứu 360°, mã 6 số 2FA trực tiếp, lịch sử mật khẩu cũ, tự động cảnh báo lỗi trên Dashboard + nút `🔧 Yêu cầu AI sửa` 1-chạm + đóng hàng loạt phiếu lỗi (`Bulk Confirm`), và tinh gọn giao diện `/accounts` (`DONE`).
- **Phase 23 → Phase 27 (`v0.6.3` – `v0.6.7`):** Dọn code thừa & khử trùng lặp helpers (`423/423 test:web` + `25/25 test:security PASS`), điều hướng 1-chạm không qua trang trung gian, tối giản hóa giao diện điện thoại/máy tính, nâng cấp bộ Icon SVG hiện đại (`strokeWidth="1.75"`) và vượt qua `144/144` kịch bản Playwright + Axe (`0` lỗi) (`DONE`).
- **Phase 28 → Phase 31 (`v0.6.8` – `v0.7.1`):** Xem chấm công gom theo từng nhân viên kèm lọc nhanh 1-chạm, xuất CSV tổng hợp công + duyệt nhanh ca chờ theo nhân viên + đối soát bảng lương, bộ chọn Tháng công riêng trên từng thẻ nhân viên (`employee-month-selector-*`), chuẩn hóa 4 mẫu giao việc Media trên `/work/new`, và đưa phân hệ `Tài khoản` (`/accounts`) lên trực tiếp Thanh menu đứng với thứ tự ưu tiên & nhãn 2 chữ đồng bộ (`DONE`).
- **Phase REM (`Audit Remediation Waves W1 / W2A / OA-20 / OA-21 / OA-23 / W2B` — `4ab595c` → `0610c4b`):** Ban hành mục `⛔ 0. QUY TẮC BẤT BIẾN VỀ PRODUCTION` (`REMEDIATION_FREEZE`) trong `AGENTS.md`, khóa Fail-Closed (`exit 43`) cơ chế tự deploy của `anty-remote-hub` (`OA-20`), cô lập hoàn toàn cụm PostgreSQL TEST `:55433` với khóa chặn Fail-Closed (`OA-21`) và vượt qua `71/71` file test (`722` tests `PASS`), bổ sung Staging cô lập `:55434` (`STAGING-ISOLATION-RUNBOOK.md`) và xác nhận `0` thay đổi trên Production (`DONE`).
- **Phase 32 (`v0.7.2` — `d720534`, `f09d04f`, `bcdb36c`):** Mở khóa đổi vai trò nhân sự (`staff ↔ admin ↔ owner`), bổ sung vai trò **Quản lý phụ (`admin`)** + 6 nhóm quyền phụ chi tiết (`attendance:review`, `work:manage`, `employees:manage`, `accounts:manage`, `payroll:manage`, `finance:manage`) (`migration 0032_employee_sub_permissions.sql`), nút **Phân quyền / Sửa** 1-chạm trên `/employees` và bảo vệ chống khóa Owner cuối cùng (`DONE`).

---

## 2. Phase Quản Trị Hiện Tại (`PASS` — Chờ Owner Nghiệm Thu)

### Phase `GOV-08.1` — Chuẩn Hóa & Đồng Bộ Tài Liệu Quản Trị Dự Án `management-lite` Lên `v0.7.2` (`PASS` — `Approval: PENDING`)

- **Nhánh thực hiện:** `docs/governance-management-lite-v1` (tách trực tiếp từ `origin/main` @ `bcdb36c` / `v0.7.2`).
- **Phạm vi:**
  - `GOV-08.1.1` → `GOV-08.1.5` (`DONE` @ `04284c9`, đã được Owner phê duyệt tiếp tục): Thiết lập bộ 6 tài liệu cốt lõi (`PROJECT_STATUS.md`, `AGENTS.md`, `README.md`, `docs/PHASE_TASK_HISTORY.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`).
  - `GOV-08.1.6` → `GOV-08.1.8` (`PASS`): Đồng bộ 11 commit mới từ `origin/main` (`bcdb36c` / `v0.7.2`), bảo toàn nguyên vẹn 100% khối `REMEDIATION_FREEZE` (`AGENTS.md §0`) & `Owner-Locked Release Gate`, cập nhật `Phase REM` (`PREM-T01..T06`) + `Phase 32` (`P32-T01..T02`), và chuẩn hóa toàn bộ cột `Approval` (Git tag/PR không thay thế bằng chứng Owner `APPROVED`).
- **`NEXT_ACTION`:** Trình Owner nghiệm thu (`APPROVED`) nhánh `docs/governance-management-lite-v1`. Tuyệt đối không tự merge vào `main` và không tác động Production.

---

## 3. Hạng Mục Vận Hành & Đề Xuất Chờ Lệnh Owner (`BACKLOG` / `PENDING OWNER GATE`)

> **Quy tắc bắt buộc (`AGENTS.md §0`):** Tuyệt đối không tự ý thực thi bất kỳ hạng mục nào dưới đây khi chưa có lệnh phê duyệt tường minh bằng văn bản của Owner.

1. **`REL-GATE-072` — Phát Hành Chính Thức `v0.7.2` Qua Cổng `Owner-Locked Release Gate` Khi Owner Gỡ `REMEDIATION_FREEZE` (`PENDING OWNER GATE`):**
   - **Mô tả:** Máy chủ Production (`https://ql.hoaiphuong.click`) hiện đang được khóa bảo vệ bởi `REMEDIATION_FREEZE` (`AGENTS.md §0`) ở mốc `v0.7.0` (`8ee37a2`). Khi Owner quyết định phát hành `v0.7.2` (`bcdb36c`, bao gồm `migration 0032` và các bản vá bảo mật/hiệu năng), chỉ chính Owner ký duyệt bằng `Sign-Release-Owner.ps1` và chạy `Deploy-SemiAutoWindows.ps1` theo [`docs/deployment/OWNER-RELEASE-RUNBOOK.md`](./deployment/OWNER-RELEASE-RUNBOOK.md).
2. **`PROP-PAGINATION-HOLD` — Kế hoạch Phân Trang Mở Rộng Toàn Cục (`BACKLOG`):**
   - **Nguồn:** [`docs/handoff/GLOBAL-PAGINATION-HOLD-API-PLAN.md`](./handoff/GLOBAL-PAGINATION-HOLD-API-PLAN.md).
   - **Trạng thái:** Đã áp dụng keyset pagination cho `/attendance` ở Phase 18 (`v0.5.5`); các phân hệ còn lại chỉ mở khi có yêu cầu mới của Owner.
