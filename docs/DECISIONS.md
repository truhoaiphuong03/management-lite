# ARCHITECTURE DECISION RECORDS (ADR) — `management-lite`

> Hồ sơ ghi lại các quyết định kiến trúc và kỹ thuật cốt lõi của dự án `management-lite` theo chuẩn **Universal AI Project Governance V1**. Tham chiếu bổ sung: [`docs/canonical/docs/09_DECISION_LOG.md`](./canonical/docs/09_DECISION_LOG.md) và [`docs/canonical/docs/58_PK01_T1_T4_FOUNDATION_DECISIONS.md`](./canonical/docs/58_PK01_T1_T4_FOUNDATION_DECISIONS.md).

---

## ADR-001: Kiến Trúc Monorepo (`@hp/contracts`, `@hp/database`, `@hp/api`, `@hp/web`) & Bộ Đặc Tả Canonical Bất Biến

- **Ngày:** 2026-10-08 → 2026-10-14 (`PK-00` / `PK-01`)
- **Trạng thái:** `ACCEPTED` (`VERIFIED` @ `c0dce0e`, `69a726a`)
- **Bối cảnh:** Dự án cần sự nhất quán tuyệt đối giữa hợp đồng dữ liệu (API payload), schema PostgreSQL 18 và giao diện React 18, đồng thời bảo vệ các quy tắc nghiệp vụ cốt lõi (RBAC, công thức lương, cô lập dữ liệu workspace) khỏi việc bị sửa lệch qua nhiều phiên AI.
- **Quyết định:**
  1. Tổ chức mã nguồn theo 4 workspace tách biệt: `packages/contracts` (hợp đồng kiểu dữ liệu & phiên bản), `packages/database` (PostgreSQL pool & sequential migrations `0001`–`0032`), `packages/ui` (design system & icons), `apps/api` (Backend HTTP server) và `apps/web` (React 18 + Vite SPA).
  2. Khóa 59 tài liệu đặc tả nền tảng trong `docs/canonical/` bằng bảng băm `SHA-256` (`docs/canonical/manifest.json` — `0.1.0-doc.21`) kiểm chứng qua `npm run canonical:verify`.
- **Hệ quả kỹ thuật:** Đảm bảo an toàn kiểu dữ liệu xuyên suốt từ DB lên UI và giữ nguyên vẹn 59 tài liệu đặc tả gốc.

---

## ADR-002: Bảo Mật Bí Mật Tài Khoản Dùng Chung (`C05 Secret Vault` `AES-256-GCM`) & Hệ Sinh Thái 4 Tầng (`Phase 20 / v0.6.0`)

- **Ngày:** 2026-10-31 (`Phase 20` / `v0.6.0`)
- **Trạng thái:** `ACCEPTED` (`VERIFIED` @ `6e1ee4f`, `4b73268`)
- **Bối cảnh:** Đội ngũ Media quản lý hàng trăm tài khoản đa nền tảng (`SĐT/SIM ➔ Gmail gốc ➔ TikTok / Facebook / YouTube` kèm `Google Authenticator` và `Tài khoản Khôi phục`), đòi hỏi vừa tra cứu 2 chiều 360° nhanh chóng, vừa bảo mật tuyệt đối mật khẩu và khóa 2FA.
- **Quyết định:**
  1. Mọi trường nhạy cảm (`password`, `two_fa_secret`, `totp_secret`, `email_password`, `recovery_code`) bắt buộc mã hóa AEAD `AES-256-GCM` trong bảng `account_secrets` và lưu lịch sử xoay vòng mật khẩu append-only trong `account_secret_history` (`migration 0031`).
  2. Giao diện `ManagedAccountData` tuyệt đối không chứa trường plaintext secret/password; việc giải mã (`reveal`) hoặc ghi mới (`put`) bắt buộc quyền quản trị kèm bằng chứng xác thực lại (`reauth_proof` qua `/api/v1/auth/reauth`) và tự động ẩn trên giao diện sau `30 giây` (hoặc ngay khi ẩn tab/nhấn `Escape`).
- **Hệ quả kỹ thuật:** Ngăn chặn rò rỉ bí mật qua API list hoặc DOM state, đồng thời hỗ trợ sinh mã 6 số 2FA (`TOTP` RFC 6238) và truy vết lịch sử mật khẩu cũ an toàn.

---

## ADR-003: Định Tuyến `RouteTable` `O(1)`, Phân Trang Con Trỏ `Keyset` & Chia Nhỏ Gói Tải Trang (`Phase 15 & Phase 18`)

- **Ngày:** 2026-10-31 (`Phase 15 / v0.5.2` & `Phase 18 / v0.5.5`)
- **Trạng thái:** `ACCEPTED` (`VERIFIED` @ `deeaf16`, `12540e5`)
- **Bối cảnh:** Khi số lượng màn hình tăng lên 29 route và tệp `app.ts` vượt quá 2.500 dòng, gói JS tải lần đầu đạt `~1.080 kB` (gzip `~260 kB`) và các truy vấn chấm công/lịch tuần có nguy cơ chậm dần theo thời gian.
- **Quyết định:**
  1. Trên Web (`apps/web`): Áp dụng `React.lazy` + `Suspense` theo từng route (`lazy-screens.ts`) kết hợp máy chủ tĩnh `scripts/runtime/serve-web.cjs` nén Brotli/Gzip trong RAM và cache `immutable` 1 năm cho `/assets/*`, kéo dung lượng JS tải lần đầu xuống `~418 kB` raw / `~119 kB` gzip (kiểm soát cứng bởi `npm run check:bundle` `<= 450/130 kB`).
  2. Trên Backend (`apps/api`): Thay chuỗi `if/else` tuyến tính bằng `RouteTable` (`O(1)` exact + prefix dispatch), tách các module route lớn (`schedules`, `accounts`, `storage`, `issues`), gộp chèn lịch trực tuần bằng 1 câu lệnh `UNNEST` và dùng phân trang con trỏ (`keyset cursor`) không `OFFSET` cho `/attendance`.
- **Hệ quả kỹ thuật:** Tốc độ tải trang lần đầu giảm hơn 60% dung lượng và thời gian phản hồi API giữ ổn định `O(1)` / `O(log N)` khi dữ liệu lớn.

---

## ADR-004: Chuẩn Giao Diện Dual UI (`Desktop` + `Mobile 320px–430px`) & Kiểm Toán Tự Động 144 Kịch Bản (`Phase UI-0..UI-5 & Phase 27`)

- **Ngày:** 2026-10-31 → 2026-11-01 (`v0.5.0` → `v0.6.7`)
- **Trạng thái:** `ACCEPTED` (`VERIFIED` @ `a0122fb`, `12540e5`, `81ee366`)
- **Bối cảnh:** Nhân sự và Owner sử dụng hệ thống thường xuyên trên cả máy tính lẫn điện thoại di động ở cả 2 chế độ Sáng (`Light`) và Tối (`Dark`).
- **Quyết định:**
  1. Thay thế toàn bộ ~2.100 mã màu hex/rgba cứng bằng hệ thống biến CSS ngữ nghĩa (`packages/ui/src/tokens.css` & `THEME_COLORS`), đảm bảo độ tương phản chuẩn WCAG AA cho cả `Light` và `Dark`.
  2. Tự động chuyển đổi bảng dữ liệu lớn sang dạng thẻ di động (`responsive-tables.ts` / `.rt-cards`) trên màn hình hẹp và kiểm chứng tự động qua `npm run audit:ui` (Playwright + `axe-core` trên 24 màn hình × 3 kích thước khung nhìn × 2 chế độ Sáng/Tối = 144 kịch bản với `overflowX: 0`, `color-contrast: 0`).
- **Hệ quả kỹ thuật:** Triệt tiêu lỗi chữ trắng trên nền sáng và lỗi tràn ngang trên màn hình điện thoại `320px`.

---

## ADR-005: Cổng Phát Hành Khóa Bởi Owner (`Owner-Locked Release Gate — Zero Manual Production Copy`)

- **Ngày:** 2026-10-31 (`Phase 16 / Task 16.2` — `v0.5.4`)
- **Trạng thái:** `ACCEPTED` (`VERIFIED` @ `0f6384e`)
- **Bối cảnh:** Việc sao chép thủ công (`Copy-Item`) hoặc dừng tiến trình `node` trực tiếp trên máy chủ Windows Production (`C:\HoaiPhuong-Server\apps\management-lite`) tiềm ẩn rủi ro lệch phiên bản và gián đoạn dịch vụ.
- **Quyết định:**
  1. Cấm tuyệt đối mọi thao tác chép tay vào thư mục Production.
  2. Mọi bản phát hành phải sinh thông tin định danh tự động qua `scripts/gen-build-info.mjs`, đóng gói kèm bảng băm `SHA-256` (`scripts/deployment/package-release-bundle.mjs`), được Owner ký duyệt bằng `Sign-Release-Owner.ps1` và triển khai qua `Deploy-SemiAutoWindows.ps1` (có kiểm tra `/api/v1/health`, smoke test và tự động rollback khi lỗi) theo [`docs/deployment/OWNER-RELEASE-RUNBOOK.md`](./deployment/OWNER-RELEASE-RUNBOOK.md).
- **Hệ quả kỹ thuật:** Bảo vệ tuyệt đối môi trường Production trước mọi thay đổi chưa được Owner ký duyệt.

---

## ADR-006: Khóa Bất Biến `REMEDIATION_FREEZE` (`§0`), Vô Hiệu Hóa Auto-Deploy Legacy (`OA-20`), Cô Lập DB Test `:55433` (`OA-21`) & Phân Quyền 3 Cấp (`Phase 32 / v0.7.2`)

- **Ngày:** 2026-11-02 (`Remediation Waves W1–W2B` & `Phase 32 / v0.7.2`)
- **Trạng thái:** `ACCEPTED` (`VERIFIED` @ `4ab595c` → `bcdb36c`)
- **Bối cảnh:** Kiểm toán truy vết Production (`W1.5`) phát hiện công cụ tự phát hành ngầm `anty-remote-hub` từng tự động `git reset --hard`, build và ghi đè 219 tệp dist vào `C:\HoaiPhuong-Server\` ngoài cổng Owner; đồng thời bộ kiểm thử cần cơ chế bảo vệ chống chạm vào PostgreSQL Production (`:55432`) và nghiệp vụ nhân sự cần tầng **Quản lý phụ (`admin`)** có thể ủy quyền chi tiết từng phân hệ mà không phải cấp toàn quyền `owner`.
- **Quyết định:**
  1. **Khóa `REMEDIATION_FREEZE` (`AGENTS.md §0`) & Vô hiệu hóa Fail-Closed `anty-remote-hub` (`OA-20`):** Đặt mục `⛔ 0. QUY TẮC BẤT BIẾN VỀ PRODUCTION` lên đầu `AGENTS.md` (ghi đè mọi mục khác), gỡ bỏ Registry Run & VBS Startup launcher của `anty-remote-hub`, khóa Fail-Closed (`exit 43`) `server-daemon.mjs` và `sync-live-web.mjs` kèm test bảo mật `tests/security/oa20-hub-autodeploy-disabled.test.mjs`.
  2. **Tách biệt 4 môi trường & Khóa Fail-Closed DB Test (`OA-21`):** Tách hẳn cụm PostgreSQL TEST tại `C:\ML-Test` (`:55433`, `Manage-TestEnv.ps1`) và STAGING tại `C:\HoaiPhuong-Staging` (`:55434`, `:4000`, `:4001`, `Manage-StagingEnv.ps1`). Trong `packages/database/src/guard.ts`, mọi kết nối test trỏ vào cổng `:55432` bị chặn tức thì (`Fail-Closed`).
  3. **Phân quyền Nhân sự 3 Cấp (`staff / admin / owner`) & 6 Nhóm Quyền phụ (`Phase 32 / v0.7.2`):** Bổ sung cột `sub_permissions TEXT[]` (`migration 0032_employee_sub_permissions.sql`) với 6 quyền ủy quyền (`attendance:review`, `work:manage`, `employees:manage`, `accounts:manage`, `payroll:manage`, `finance:manage`), kiểm tra qua `requirePermission` trong `apps/api/src/auth/guard.ts`, thu hồi phiên cũ ngay khi đổi quyền và chặn hạ quyền `owner` hoạt động cuối cùng.
- **Hệ quả kỹ thuật:** Chấm dứt hoàn toàn tình trạng tự động ghi đè Production ngoài cổng Owner (`0` thay đổi Production qua toàn bộ `71/71` file test trên `:55433`), đồng thời cho phép Owner ủy quyền linh hoạt từng phân hệ cho Quản lý phụ (`admin`).

---

## ADR-007: Áp Dụng Chuẩn Quản Trị `Universal AI Project Governance V1` & Tách Bạch `DONE` Với `APPROVED` (`Phase GOV-08.1`)

- **Ngày:** 2026-11-02 (`GOV-08.1.1` → `GOV-08.1.8`)
- **Trạng thái:** `ACCEPTED` (`APPROVED` bởi Owner theo lệnh `# OWNER APPROVAL — GOV-08.1` ngày `2026-11-02` tại commit `9565c3e` & Draft PR #21; giữ ở nhánh riêng, chưa merge vào `main`)
- **Bối cảnh:** Dự án có lịch sử phát triển dày đặc (`36` Phase / `103` Task, `59` tài liệu Canonical, bộ hồ sơ `docs/remediation/`, `docs/plans/` và bảng `LIVE_CHECKPOINT` trong `AGENTS.md`), cần một cấu trúc hồ sơ chuẩn hóa để `ChatGPT`, `Antigravity` và `Codex` phối hợp đa máy mà không bao giờ quét lại toàn bộ source code hay làm lại các Phase đã nghiệm thu.
- **Quyết định:**
  1. Bổ sung và đồng bộ bộ 6 tài liệu cốt lõi (`PROJECT_STATUS.md`, `AGENTS.md`, `README.md`, `docs/PHASE_TASK_HISTORY.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`) trực tiếp trên `HEAD` mới nhất (`bcdb36c` / `v0.7.2`) theo cơ chế **Non-Destructive Overlay** (bảo toàn 100% khối `REMEDIATION_FREEZE` trong `AGENTS.md` và toàn bộ tài liệu lịch sử).
  2. Định danh duy nhất toàn bộ `103` Task theo 13 trường chuẩn, phân loại minh bạch bằng chứng (`VERIFIED` / `REPORTED`), và áp dụng nghiêm ngặt quy tắc **Git tag hoặc PR không thay thế bằng chứng Owner phê duyệt (`APPROVED`)** (ghi `UNRECORDED_ON_GIT` ở cột `Approval` cho các Task lịch sử chỉ có tag/PR, trong khi vẫn giữ trạng thái `DONE` theo `Zero-Recheck Rule`).
- **Hệ quả kỹ thuật:** Khôi phục ngữ cảnh phiên tức thì cho mọi AI Agent chỉ bằng thao tác đọc `PROJECT_STATUS.md` và `AGENTS.md` mà vẫn giữ kỷ luật nghiệm thu chặt chẽ của Owner.
