# ROADMAP — `management-lite`

> Phân tách rõ giữa **(1) Các Phase đã hoàn thành trong Repository (`DONE` — Cấm làm lại theo Zero-Recheck Rule)**, **(2) Phase quản trị hiện tại đang chờ Owner nghiệm thu (`PASS`)**, và **(3) Các hạng mục đề xuất / cổng phát hành chờ lệnh Owner (`BACKLOG` / `PENDING OWNER GATE`)**.

---

## 1. Các Phase Đã Hoàn Thành Trên Nhánh `main` & Nhánh Nâng Cấp (`v0.1.0` → `v1.0.0` — `DONE`)

> Toàn bộ các Phase sản phẩm & remediation từ `v0.1.0` → `v1.0.0` dưới đây đã hoàn thành trong mã nguồn. Chi tiết 13 trường của từng Task xem tại [`docs/PHASE_TASK_HISTORY.md`](./PHASE_TASK_HISTORY.md). **Tuyệt đối không tự ý chạy lại hoặc làm lại (Zero-Recheck Rule).**

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
- **Phase PQ-MAIN & UI-MINIMALIST (`v0.9.0` → `v0.9.22` — `5134bff` → `25cbea2`):** Hợp nhất phân hệ Báo giá In ấn UX V2 + Sổ công nợ AR/AP (`migrations 0033..0036`), tối ưu thác API (`v0.9.7`), chuẩn hóa Nhân sự/Chấm công (`migrations 0040..0043`), sao lưu mã hóa Offsite (`2fa780c`), thiết kế lại giao diện tối giản cho `/login`, `/dashboard`, `/clock`, `/work` (`v0.9.21`–`v0.9.22`) và vá `Payroll 40001` (`4368785`) (`DONE`).
- **Phase QA-REMEDIATION (`v0.9.23` — `9acae08`):** Khắc phục dứt điểm 12 lỗi kiểm thử toàn diện (`BUG-QA-01..12`), dọn sạch code thừa (`0` orphan/unused), chuẩn hóa `Manage-StagingEnv.ps1` + `cleanup-macbook-dev.sh` và công cụ `release:print-owner-gate` (`DONE`).
- **Phase PQ-VIETQR-FINSYNC (`v0.10.0` — `508759d`):** Tích hợp mã `VietQR` thanh toán trên Báo giá PDF A4 & Sổ công nợ khách hàng (`/print-quotes/receivables`) từ hồ sơ ngân hàng Owner, tự động đồng bộ phiếu thu/chi in ấn (`PT-...`/`PC-...` + hủy `VOID`) sang Sổ thu chi tổng (`/finance`) bằng `SAVEPOINT` + `operation_key` và mở nút **`⧉ Nhân bản`** 1-chạm kèm làm mới giá xưởng (`DONE`).
- **Phase PERF-4G-PAGINATION (`v0.10.1` — `efcb7a8`):** Chia nhỏ các gói JS phân hệ Báo giá In ấn xuống `< 91 kB/chunk`, giảm JS tải lần đầu xuống **`375.3 KB raw / 108.5 KB gzip`**, tải trễ `PdfPreviewModal` & `StorageDriveOAuthModal`, và bổ sung phân trang `?limit=&offset=` tương thích ngược cho `GET /api/v1/work-items` & `GET /api/v1/print-quotes/quotes` + chỉ mục nóng (`DONE`).
- **Phase V1-MILESTONE (`v1.0.0`):** Mở rộng **Trung tâm Việc cần xử lý (`Action Center`)** 0-request-phụ trên `/dashboard` cảnh báo chủ động công nợ/đơn in ấn (`action-center-printquote-alerts`) và sức khỏe kho tài khoản (`action-center-accounts-health`) cho Owner, chốt mốc phát hành `Management Lite v1.0.0` (`DONE`).

---

## 2. Phase Quản Trị Đã Được Owner Nghiệm Thu (`APPROVED` — Nhánh Riêng, Chưa Merge `main`)

### Phase `GOV-08.1` — Chuẩn Hóa & Đồng Bộ Tài Liệu Quản Trị Dự Án `management-lite` Lên `v0.7.2` (`APPROVED` / `DONE` trên nhánh tài liệu)

- **Nhánh thực hiện & PR:** `docs/governance-management-lite-v1` — Draft PR [#21](https://github.com/truhoaiphuong03/management-lite/pull/21) (đã kiểm tra merge sạch với `origin/main` @ `71b5310` trong worktree sandbox; **chưa merge vào `main`** theo lệnh Owner).
- **Căn cứ phê duyệt (`Approval`):** **`APPROVED` bởi Owner** theo lệnh `# OWNER APPROVAL — GOV-08.1` (`2026-11-02T10:57:16+07:00`) đối với kết quả tại commit `9565c3e` và Draft PR #21 (bao gồm bộ 6 tài liệu Governance V1, kết quả kiểm tra `36` Phase / `103` Task, đối chiếu bảo toàn `REMEDIATION_FREEZE` và kiểm tra merge thử trong sandbox).
- **Phạm vi đã nghiệm thu (`Zero-Recheck` — Không làm lại):**
  - `GOV-08.1.1` → `GOV-08.1.5` (`APPROVED` @ `04284c9` / `9565c3e`): Thiết lập bộ 6 tài liệu cốt lõi (`PROJECT_STATUS.md`, `AGENTS.md`, `README.md`, `docs/PHASE_TASK_HISTORY.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`).
  - `GOV-08.1.6` → `GOV-08.1.8` (`APPROVED` @ `607ced8` / `9565c3e`): Đồng bộ 11 commit từ `origin/main` (`v0.7.2`), bảo toàn nguyên vẹn 100% khối `REMEDIATION_FREEZE` (`AGENTS.md §0`) & `Owner-Locked Release Gate`, cập nhật `Phase REM` (`PREM-T01..T06`) + `Phase 32` (`P32-T01..T02`), chuẩn hóa cột `Approval` và đối chiếu an toàn với `71b5310`.
- **`NEXT_ACTION`:** **Giữ nguyên Draft PR #21 (chưa merge vào `main`), giữ nguyên `REMEDIATION_FREEZE` (không gỡ khóa Production) và giữ `GOV-08.2` / `GOV-09` ở trạng thái chưa được phép triển khai cho đến khi có lệnh mới của Owner.**

---

## 2B. Lộ Trình Đang Triển Khai Trên MacBook DEV (`MGL-PRINTQUOTE V1` — Nhánh `feature/printquote-module-v1`)

> Đã được Owner phê duyệt bắt đầu phát triển theo lệnh `# TRIỂN KHAI MGL-PRINTQUOTE V1 TRÊN MACBOOK` (`2026-11-02`). Chỉ phát triển và kiểm thử trên MacBook DEV (`127.0.0.1:55499`), chưa phát hành lên Windows Production.

- **Phase PQ-0 — Đồng bộ và Cách ly DEV (`PQ0-T01..T04` — `PASS`):** Xác minh môi trường MacBook, đồng bộ `origin/main` (`71b5310`), giữ nguyên worktree `docs/governance-management-lite-v1` (`300da19`), kiểm toán `printquote-v1` (`27d8538`, `8/8 PASS`) và khởi tạo PostgreSQL 18.6 DEV cô lập trên `:55499` (`PASS`).
- **Phase PQ-1 — Tích hợp Pricing Engine (`PQ1-T01..T02` — `PASS`):** Tích hợp động cơ tính giá in ấn (`packages/contracts/src/printquote.ts`) hỗ trợ giá vốn đơn vị/lô, lợi nhuận VND/% theo đơn vị/lô, cước vận chuyển cộng 1 lần, gộp ship vào đơn giá báo khách, phân bổ ship đa sản phẩm chính xác 100%, lưu tách biệt giá vốn/giá bán/lợi nhuận, khóa bất biến lịch sử đơn và viết bộ unit test đầy đủ (`7/7 PASS`).
- **Phase PQ-2 — Database và API (`PQ2-T01..T03` — `PASS`):** Migration bổ sung `0033_printquote_v1.sql` (`catalog.ts`), dịch vụ `PrintQuoteService` & route `/api/v1/print-quotes/*` bảo vệ quyền Owner, transaction + idempotency + lưu phiên bản báo giá, và integration test trên PostgreSQL DEV (`15/15` migrator + `2/2` PostgreSQL integration `PASS`).
- **Phase PQ-3 — UI và PDF A4 (`PQ3-T01..T03` — `PASS`):** Nhóm menu **Báo giá in ấn** (`/print-quotes`) với 6 chức năng (Tạo báo giá, Danh sách báo giá, Nhà in & Bảng giá, Khách hàng, Đơn hàng, Lợi nhuận & Công nợ), giao diện đồng nhất Desktop/iPhone và xuất PDF A4 tiếng Việt chỉ hiển thị giá bán (tuyệt đối không lộ giá nhà in hoặc lợi nhuận).
- **Phase PQ-4 — Đơn hàng, Công nợ & Kiểm thử Toàn diện (`PQ4-T01..T03` — `PASS`):** Quản lý ngày đặt in (`print_ordered_at`), trạng thái sản xuất & giao hàng độc lập, tiền cọc/thanh toán từng lần/công nợ, lợi nhuận dự kiến vs thực tế, dashboard thống kê, kiểm thử Unit/Integration/E2E/Security/Regression (`15/15` PrintQuote tests + `427` Web tests + `28` Security tests + `23` DB tests `PASS`) và diễn tập backup/rollback thành công trên PostgreSQL DEV `:55499`. Chờ Owner phê duyệt nghiệm thu (`APPROVED`).

---

## 3. Hạng Mục Vận Hành & Đề Xuất Chờ Lệnh Owner (`BACKLOG` / `PENDING OWNER GATE`)

> **Quy tắc bắt buộc (`AGENTS.md §0`):** Tuyệt đối không tự ý thực thi bất kỳ hạng mục nào dưới đây khi chưa có lệnh phê duyệt tường minh bằng văn bản của Owner.

1. **`REL-GATE-100` — Phát Hành Chính Thức `v1.0.0` Qua Cổng `Owner-Locked Release Gate` (`PENDING OWNER GATE`):**
   - **Mô tả:** Máy chủ Production (`https://ql.hoaiphuong.click`) hiện đang live tại `v0.9.22` (`07d2cbf`) và khóa bảo vệ bởi `REMEDIATION_FREEZE` (`AGENTS.md §0`). Nhánh nâng cấp `feat/roadmap-v1-upgrade-20261114` (`v0.9.23` → `v1.0.0`) đã vượt qua toàn bộ kiểm thử CI và E2E Staging. Khi Owner quyết định phát hành `v1.0.0`, Owner merge nhánh vào `main` và chạy bộ lệnh ký duyệt từ `npm run release:print-owner-gate` (`Sign-Release-Owner.ps1` + `Deploy-SemiAutoWindows.ps1`) theo [`docs/deployment/OWNER-RELEASE-RUNBOOK.md`](./deployment/OWNER-RELEASE-RUNBOOK.md).
2. **`PROP-PAGINATION-HOLD` — Kế hoạch Phân Trang Mở Rộng Toàn Cục (`BACKLOG`):**
   - **Nguồn:** [`docs/handoff/GLOBAL-PAGINATION-HOLD-API-PLAN.md`](./handoff/GLOBAL-PAGINATION-HOLD-API-PLAN.md).
   - **Trạng thái:** Đã áp dụng keyset pagination cho `/attendance` (`v0.5.5`), phân trang `/issues` & `/system-logs` (`v0.9.10`), và `?limit=&offset=` tương thích ngược cho `/api/v1/work-items` & `/api/v1/print-quotes/quotes` (`v0.10.1`); các phân hệ còn lại mở khi có yêu cầu mới của Owner.
