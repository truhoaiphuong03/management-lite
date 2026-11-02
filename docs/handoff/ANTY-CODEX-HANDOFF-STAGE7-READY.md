# BÁO CÁO BÀN GIAO FRONTEND CHO CODEX MACBOOK (STAGE 7 READY)

- **Người thực hiện:** Anty (Frontend Pair-Programmer)
- **Đối tác phối hợp:** Codex (Backend & Deployment) / Owner
- **Trạng thái:** `READY_FOR_CODEX_REVIEW`
- **Mã nhánh frontend:** `fix/anty-qa-followup-acc-fin-lint`
- **Worktree:** `/Users/duongbinh/Projects/management-lite-ui-report`
- **Mốc build Windows Stage 7 đang nghiệm thu:** `0cf5b23ba799c715183c49389eebbffcfd86dfe0` (Tuyệt đối giữ nguyên, không sửa đổi)
- **Quy chế áp dụng:** Tuân thủ nghiêm ngặt `QA_HOLD` và `RELEASE_HOLD`. Không merge `main`, không push production, không can thiệp môi trường Windows.

---

## I. TỔNG HỢP CÁC COMMIT ĐÃ HOÀN TẤT

Chuỗi commit độc lập trên nhánh `fix/anty-qa-followup-acc-fin-lint` từ mốc `0cf5b23`:

1. **`cb34496`** - `fix(web): remediate SettingsScreen any lint, ACC-005 background expiry, and FIN fake DOM race`
   - Loại bỏ triệt để 4 lỗi `no-explicit-any` tại `apps/web/src/screens/SettingsScreen.tsx`.
   - Nâng cấp `ACC-005` bằng cơ chế hạn giờ thời gian thực (`deadline-based countdown`) và xóa tức thì secret khi tab chuyển background (`document.hidden`).
   - Khắc phục race condition trong fake-DOM helper khi unmount modal tài chính.
2. **`943095d`** - `docs(handoff): document QA remediation and enhancement roadmap in ANTY-QA-FOLLOWUP-ACC-FIN-LINT.md`
   - Tài liệu hóa chi tiết kết quả sửa lỗi và lộ trình nâng cấp UI.
3. **`465dbf7`** - `feat(ui): add AppSkeleton component, Chrome ACC-005/006 verification suite, and new features API requirements`
   - Bổ sung component chuẩn `@management-lite/ui/AppSkeleton` hỗ trợ text, circle, rect và animation wave/shimmer.
   - Bổ sung kịch bản kiểm thử Chrome tự động (`scripts/chrome-acc-qa-recheck.mjs`) kiểm tra ACC-005 và ACC-006.
   - Lập tài liệu đặc tả API đề xuất (`docs/handoff/ANTY-PROPOSED-FEATURES-AND-API-REQUIREMENTS.md`).
4. **`79db9f2`** - `feat(web): integrate AppSkeleton on 3 screens, add offline banner, date presets, and high-risk invariants tests`
   - Tích hợp `AppSkeleton` vào `EmployeesScreen`, `FinanceHistoryScreen`, `PayrollScreen`.
   - Thêm banner thông báo ngoại tuyến trên shell ứng dụng (`App.tsx`).
   - Thêm bộ lọc ngày nhanh (Hôm nay, Hôm qua) chuẩn Asia/Ho_Chi_Minh tại `ReportsScreen`.
   - Thiết lập bộ kiểm thử bất biến rủi ro cao (`tests/web/high-risk-acceptance-invariants.test.mjs`).
5. **`c7ba001`** - `refactor(web): refine offline banner messaging, classify high-risk tests, and verify 4-state skeleton accessibility`
   - Chuẩn hóa thông điệp offline: phân định rõ mất mạng cục bộ vs lỗi máy chủ, loại bỏ tuyên bố lưu nháp khi chưa có cơ chế draft.
   - Bổ sung kiểm thử động cho sự kiện `online`/`offline` (`tests/web/ui-enhancements.test.mjs`).
   - Phân loại minh bạch các tầng kiểm thử rủi ro cao (`[Unit Test]`, `[Source Invariant]`).
   - Xác nhận khả năng tiếp cận (a11y) và đủ 4 trạng thái (loading, success, error, empty) cho `AppSkeleton`.

---

## II. DANH SÁCH FILE THAY ĐỔI & PHẠM VI ẢNH HƯỞNG

Toàn bộ thay đổi chỉ giới hạn trong phạm vi frontend của Anty, hoàn toàn không chỉnh sửa backend (`apps/api/**`), cơ sở dữ liệu (`packages/db/**`), migration, lockfile hoặc kịch bản CI/CD.

| Phân loại                | Tệp tin thay đổi                                              | Mô tả tóm tắt                                                                                               |
| :----------------------- | :------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------- |
| **Shell & App**          | `apps/web/src/App.tsx`                                        | Thêm banner mất mạng cục bộ, lắng nghe sự kiện `online`/`offline` có dọn dẹp listener.                      |
| **Màn hình Web**         | `apps/web/src/screens/AccountsScreen.tsx`                     | Nâng cấp bảo vệ secret ACC-005 (deadline + background purge), đóng modal bằng phím Escape (ACC-006).        |
|                          | `apps/web/src/screens/EmployeesScreen.tsx`                    | Tích hợp `AppSkeleton` trạng thái tải bảng nhân viên; bảo toàn 4 trạng thái lifecycle.                      |
|                          | `apps/web/src/screens/FinanceHistoryScreen.tsx`               | Tích hợp `AppSkeleton` cho bảng giao dịch tài chính; bảo toàn 4 trạng thái lifecycle.                       |
|                          | `apps/web/src/screens/PayrollScreen.tsx`                      | Tích hợp `AppSkeleton` cho KPI cards và bảng lương; bảo toàn 4 trạng thái lifecycle.                        |
|                          | `apps/web/src/screens/ReportsScreen.tsx`                      | Bổ sung nút lọc ngày nhanh (Hôm nay, Hôm qua) chuẩn Asia/Ho_Chi_Minh.                                       |
|                          | `apps/web/src/screens/SettingsScreen.tsx`                     | Khắc phục 4 lỗi `no-explicit-any` với type-safe guard `isThemeValue`, `isTimezoneValue`, `isCurrencyValue`. |
| **Giao diện dùng chung** | `packages/ui/src/components/AppSkeleton.tsx`                  | Component hiển thị khung giữ chỗ, hỗ trợ `aria-busy`, `role="presentation"`, `aria-hidden`.                 |
|                          | `packages/ui/src/components/index.ts`                         | Export `AppSkeleton`.                                                                                       |
| **Kiểm thử Web**         | `tests/web/accounts-screen.test.mjs`                          | Bổ sung kiểm thử unit test cho deadline timer và phím Escape.                                               |
|                          | `tests/web/finance-categories-mounted.test.mjs`               | Ổn định fake DOM cleanup khi unmount dialog tài chính.                                                      |
|                          | `tests/web/helpers/fake-dom.mjs`                              | Mở rộng hỗ trợ dispatchEvent, removeEventListener và mock container methods.                                |
|                          | `tests/web/high-risk-acceptance-invariants.test.mjs`          | Kiểm thử bất biến ca đêm, RBAC phía client và fail-closed session.                                          |
|                          | `tests/web/screens-skeleton.test.mjs`                         | Kiểm thử a11y và 4-state lifecycle trên 3 màn hình.                                                         |
|                          | `tests/web/skeleton.test.mjs`                                 | Kiểm thử rendering các biến thể (text, circle, rect) của `AppSkeleton`.                                     |
|                          | `tests/web/ui-enhancements.test.mjs`                          | Kiểm thử date presets và sự kiện mạng `online`/`offline`.                                                   |
| **Kịch bản QA Chrome**   | `scripts/chrome-acc-qa-recheck.mjs`                           | Kiểm thử tự động trên Chrome thật cho ACC-005 và ACC-006.                                                   |
|                          | `scripts/chrome-screens-skeleton-responsive.mjs`              | Kiểm thử responsive (360px, 768px, 1440px) và skeleton loading.                                             |
| **Tài liệu Handoff**     | `docs/handoff/ANTY-PROPOSED-FEATURES-AND-API-REQUIREMENTS.md` | Đặc tả API cho các tính năng UI đề xuất mới.                                                                |
|                          | `docs/handoff/ANTY-CODEX-HANDOFF-STAGE7-READY.md`             | Báo cáo bàn giao nghiệm thu Stage 7 cho Codex.                                                              |

---

## III. KẾT QUẢ RÀ SOÁT CÁC ĐIỂM CHÚ Ý CỦA OWNER & CODEX

### 1. Rà soát Offline Banner

- **Điều chỉnh nội dung thông điệp:**
  Đã sửa thành: _"Mất kết nối mạng cục bộ (Offline). Vui lòng kiểm tra Wi-Fi / 4G trước khi gửi yêu cầu. Nếu máy chủ phản hồi lỗi, vui lòng thử lại sau."_
- **Tính chính xác kỹ thuật:**
  - Không khẳng định dữ liệu chưa lưu được bảo toàn đối với các form thông thường chưa có cơ chế local draft/IndexedDB.
  - Phân định rõ ràng giữa mất kết nối mạng phía client (`navigator.onLine === false`) và lỗi phía máy chủ/API (HTTP 5xx / timeout).
- **Bằng chứng kiểm thử:**
  - `tests/web/ui-enhancements.test.mjs` kiểm tra mô phỏng sự kiện `offline` -> `online` và hủy đăng ký event listener đúng vòng đời (PASS).

### 2. Rà soát AppSkeleton & Hiệu năng Giao diện

- **Khả năng tiếp cận (Accessibility):**
  - Khung bao ngoài khai báo `aria-busy="true"` khi đang tải.
  - Các phần tử skeleton khai báo `aria-hidden="true"` và `role="presentation"` để tránh đọc thừa trên màn hình đọc trợ năng.
- **Bảo toàn 4 trạng thái (4-State Lifecycle):**
  - Đã rà soát và kiểm thử khẳng định trên cả 3 màn hình:
    1. _Loading:_ Hiển thị `AppSkeleton` với kích thước tương ứng.
    2. _Success:_ Render danh sách dữ liệu thực tế (`map`).
    3. _Error:_ Hiển thị banner lỗi rõ ràng (`ErrorState` / `AppCard`) kèm nút thử lại khi tải thất bại.
    4. _Empty:_ Hiển thị thông báo khi không có bản ghi (`EmptyState` / "Chưa có dữ liệu").
- **Tuyên bố về Layout Shift:**
  - Không tuyên bố tuyệt đối `CLS = 0` vì chưa đo bằng công cụ Web Vitals chuẩn (Lighthouse / PerformanceObserver).
  - Tuyên bố chính xác: _"Giảm thiểu layout shift bằng khung giữ chỗ có kích thước cố định (pre-allocated layout dimensions)"_.

### 3. Phân loại Kiểm thử Rủi ro cao & Ranh giới Bảo mật RBAC

- **Phân loại minh bạch trong mã nguồn (`high-risk-acceptance-invariants.test.mjs`):**
  - `[Unit Test] ATT-009 / ATT-010`: Kiểm tra thuật toán tính giờ làm việc ca qua đêm (22:00 -> 06:00 hôm sau) và phân chia múi giờ độc lập phía client.
  - `[Source Invariant] PAY-C04 / Client RBAC`: Kiểm tra cấu hình `ROUTE_REGISTRY` chặn chuyển trang ở tầng UI (Owner: `/payroll`, Staff: `/my-pay`).
  - `[Source Invariant] AUTH-006 / Client Session Guard`: Kiểm tra client router chuyển về `/login` khi nhận mã lỗi 401.
- **Ranh giới bảo mật:**
  - **Khẳng định rõ ràng:** Kiểm tra UI và router phía frontend **không thể và không bao giờ** thay thế cho việc thực thi phân quyền trên Backend và Database.
  - Mọi xác thực phiên làm việc, thu hồi token (token revocation), kiểm tra quyền truy cập API và bảo vệ bản ghi cơ sở dữ liệu phải do Codex nghiệm thu trên môi trường staging.

### 4. Danh sách các ca kiểm thử cần Codex xác thực trên Staging Backend

Codex cần chạy kiểm thử tích hợp thực tế với database QA/staging cho các nghiệp vụ sau:

1. **Ca làm việc qua đêm (ATT-009 / ATT-010):**
   - Chấm công vào lúc 22:00 ngày T và ra lúc 06:00 ngày T+1.
   - Kiểm tra API tính toán tổng giờ làm (8.0 giờ) và lưu vết đúng ngày công hoặc chia tách ca theo chính sách doanh nghiệp.
2. **Thu hồi phiên đăng nhập khi Idle (AUTH-006):**
   - Hết hạn phiên trên máy chủ: Kiểm tra máy chủ trả về mã HTTP 401 và vô hiệu hóa refresh token / access token trên cơ sở dữ liệu.
3. **Phân quyền Backend (PAY-C04 / RBAC):**
   - Sử dụng token của nhân viên (Staff) gọi trực tiếp endpoint `GET /api/v1/payroll/summary` hoặc `GET /api/v1/payroll/runs` -> Phải nhận HTTP 403 Forbidden.
   - Sử dụng token của chủ cơ sở (Owner) gọi trực tiếp endpoint `GET /api/v1/payroll/me` hoặc endpoint chỉ dành cho staff -> Phải nhận HTTP 403 Forbidden hoặc được xử lý đúng quyền.

---

## IV. BẢO MẬT CREDENTIAL & DỮ LIỆU NHẠY CẢM

- **Rà soát mã nguồn:**
  - Kiểm tra diff toàn diện trên toàn bộ commit `0cf5b23..c7ba001`: Không chứa bất kỳ mật khẩu, token, API key hoặc chuỗi bí mật nào được hardcode.
  - Các biến liên quan đến `secret` và `password` chỉ là tên state React (`revealedSecret`, `clearRevealedSecret`, `setRevealReauthPassword`) và logic form.
- **Kịch bản kiểm thử Chrome:**
  - Trong `scripts/chrome-acc-qa-recheck.mjs`, thông tin kiểm thử được ẩn/redacted khi xuất log (`[REDACTED]`), không in giá trị secret ra console hay báo cáo.
- **Vệ sinh dữ liệu:**
  - Secret hiển thị tạm thời tự động bị hủy khỏi DOM sau 30 giây thời gian thực (ACC-005) hoặc ngay khi người dùng chuyển sang tab khác (`document.hidden`).

---

## V. ĐẶC TẢ API GỬI CODEX XEM XÉT

Tài liệu chi tiết tại `docs/handoff/ANTY-PROPOSED-FEATURES-AND-API-REQUIREMENTS.md`. Tóm tắt 4 nhóm API đề xuất cho các tính năng mở rộng tiếp theo:

1. **Xuất báo cáo Excel / CSV (`GET /api/v1/finance/export`, `GET /api/v1/payroll/export`)**
   - Mục đích: Xuất sổ quỹ thu chi và bảng tính lương chi tiết theo bộ lọc ngày/kỳ tính lương.
   - Quyền: Owner only.
2. **Xuất Nhật ký kiểm toán (`GET /api/v1/audit/export`)**
   - Mục đích: Xuất log kiểm toán hệ thống định dạng NDJSON/CSV có kèm SHA-256 digest bảo đảm tính bất biến (`AUDIT-005`).
   - Quyền: Owner only.
3. **Cấu hình bán kính GPS Chấm công (`GET/PUT /api/v1/settings/attendance-geofence`)**
   - Mục đích: Thiết lập tọa độ và bán kính geofence (20m - 500m) cho chấm công văn phòng/cửa hàng.
   - Quyền: Owner xem và cấu hình.
4. **Xác thực 2 yếu tố MFA / TOTP (`POST /api/v1/auth/mfa/totp/...`)**
   - Mục đích: Cung cấp luồng kích hoạt và xác thực 2FA chuẩn TOTP RFC 6238 cho tài khoản quản trị.
   - Quyền: Xác thực người dùng hiện tại qua mật khẩu + TOTP.

_Lưu ý: Anty tuyệt đối không tự ý phát triển backend endpoint mới hay cài đặt mock server trong mã nguồn sản phẩm. Toàn bộ danh mục trên là đề xuất thiết kế giao diện và hợp đồng API chuyển giao để Codex Backend xem xét triển khai đồng bộ._

---

## VI. TỔNG HỢP KẾT QUẢ KIỂM THỬ ĐÃ THỰC HIỆN

| Bộ kiểm thử                               | Công cụ / Môi trường              | Kết quả                 | Ghi chú                                              |
| :---------------------------------------- | :-------------------------------- | :---------------------- | :--------------------------------------------------- |
| **Kiểm tra kiểu dữ liệu (TypeScript)**    | `tsc --noEmit` (TypeScript 5.9.3) | **0 lỗi (PASS)**        | Sạch hoàn toàn, không có lỗi linter/type.            |
| **Đóng gói Web (Build)**                  | `npm run build:web` (Vite 6.4.4)  | **PASS (3.30s)**        | Tạo bundle sản phẩm thành công.                      |
| **Targeted Unit & Invariant Tests**       | Node.js Test Runner (v22.14.0)    | **31 PASS / 0 FAIL**    | Bao phủ 7 file test trọng tâm frontend.              |
| **Kiểm thử Chrome ACC-005 / ACC-006**     | Chrome CDP (Headless Browser)     | **11 / 11 PASS (100%)** | Xác nhận xóa DOM khi background & Escape modal.      |
| **Kiểm thử Chrome Responsive & Skeleton** | Chrome CDP (360px, 768px, 1440px) | **14 / 14 PASS (100%)** | Kiểm tra hiển thị skeleton và giao diện đa thiết bị. |

---

## VII. ĐỀ XUẤT LỆNH HỒI QUY CHO CODEX KHI TÍCH HỢP

Khi Codex hoàn tất kiểm thử Windows Stage 7 và bắt đầu tích hợp mã frontend từ nhánh `fix/anty-qa-followup-acc-fin-lint`, khuyến nghị Codex chạy bộ lệnh sau để xác thực hồi quy:

```bash
# 1. Kiểm tra build web
npm run --workspace=@management-lite/web build

# 2. Chạy bộ unit và invariant tests trọng tâm của frontend
node --test \
  tests/web/screens-skeleton.test.mjs \
  tests/web/ui-enhancements.test.mjs \
  tests/web/high-risk-acceptance-invariants.test.mjs \
  tests/web/skeleton.test.mjs \
  tests/web/settings-screen.test.mjs \
  tests/web/accounts-screen.test.mjs \
  tests/web/finance-categories-mounted.test.mjs

# 3. Chạy smoke test Chrome (yêu cầu web server chạy port 3017, API port 3018)
node scripts/chrome-acc-qa-recheck.mjs
node scripts/chrome-screens-skeleton-responsive.mjs
```

---

## VIII. KẾT LUẬN & TRẠNG THÁI HIỆN TẠI

1. Toàn bộ yêu cầu rà soát và kiểm thử của Owner đã được Anty xử lý triệt để, có bằng chứng test tự động và báo cáo đối chiếu chi tiết.
2. Bản build Windows Stage 7 `0cf5b23ba799c715183c49389eebbffcfd86dfe0` hoàn toàn được bảo vệ, không bị tác động.
3. Anty duy trì trạng thái **`READY_FOR_CODEX_REVIEW`** và sẵn sàng hỗ trợ Codex khi bước tích hợp chung được Owner phê duyệt.
