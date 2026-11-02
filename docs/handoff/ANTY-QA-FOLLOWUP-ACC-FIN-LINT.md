# BÁO CÁO HOÀN THIỆN QA FRONTEND VÀ LỘ TRÌNH NÂNG CẤP HỆ THỐNG

**Mã tài liệu:** `ANTY-QA-FOLLOWUP-ACC-FIN-LINT.md`  
**Người lập:** Anty (Frontend Engineering)  
**Thời gian:** 2026-10-12 20:10 ICT  
**Trạng thái hệ thống:** `QA_HOLD` / `RELEASE_HOLD` (Tuyệt đối tuân thủ)  
**Branch:** `fix/anty-qa-followup-acc-fin-lint`  
**Base commit:** `0cf5b23ba799c715183c49389eebbffcfd86dfe0`  
**Fix commit:** `cb34496`

---

## 1. MỤC TIÊU VÀ PHẠM VI CÔNG VIỆC

Theo chỉ đạo của Owner:

1. Tiếp tục nâng cấp và hoàn thiện Management Lite song song với Codex trong khi Codex MacBook đóng gói Windows artifact và Codex Windows chuẩn bị nghiệm thu staging.
2. Tuyệt đối tuân thủ ranh giới làm việc:
   - Chỉ thao tác trong worktree độc lập `/Users/duongbinh/Projects/management-lite-ui-report` trên branch riêng `fix/anty-qa-followup-acc-fin-lint`.
   - Giữ nguyên staging packaging worktree của Codex.
   - Không can thiệp backend (`apps/api/**`), database (`packages/db/**`), migration, lockfile hoặc CI/CD.
   - Không merge main, không push production, không tự triển khai Windows.

---

## 2. KẾT QUẢ XỬ LÝ LỖI ƯU TIÊN 1 (QA REMEDIATION)

### 2.1. Xử lý triệt để 4 lỗi `no-explicit-any` tại `SettingsScreen.tsx`

- **Hiện tượng:** Tại dòng 34, 35, 99, 100 của `apps/web/src/screens/SettingsScreen.tsx`, việc hỗ trợ Safari cũ (< 14) thông qua `addListener` / `removeListener` sử dụng ép kiểu `(mql as any)`.
- **Giải pháp xử lý:** Định nghĩa interface typed chính xác:
  ```typescript
  interface LegacyMediaQueryList extends MediaQueryList {
    addListener?: (
      listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void,
    ) => void;
    removeListener?: (
      listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void,
    ) => void;
  }
  ```
- **Kết quả:** Xóa bỏ hoàn toàn 4 lần xuất hiện của `any`. Grep kiểm tra xác nhận zero `any` trong `SettingsScreen.tsx`.

### 2.2. Xử lý dứt điểm lỗi ACC-005 Background Expiry tại `AccountsScreen.tsx`

- **Nguyên nhân gốc (Root Cause):**
  - Trình duyệt hiện đại (đặc biệt là Chrome headless/background tab) tiến hành throttle timer: các tác vụ `setInterval` / `setTimeout` trong tab chạy ngầm bị giãn chu kỳ từ 1.000ms đến hơn 2.000ms.
  - Bộ đếm cũ dựa vào việc giảm dần từng tick (`tick-decrement`: `setRevealCountdown(c => c - 1)`). Khi tab bị đưa xuống background, sau 31 giây thực tế mới chỉ có ~15 ticks được kích hoạt, dẫn đến secret vẫn còn lưu trong React state và hiển thị trong DOM ở mốc 31s (được ghi nhận trong báo cáo của Codex `acc-background-timeline.json`).
- **Giải pháp bảo mật cao cấp:**
  1. **Tính hạn chót theo thời gian thực (Real-time Deadline Calculation):** Lưu mốc `revealDeadlineRef.current = Date.now() + 30000`. Khi timer kích hoạt, kiểm tra `Date.now() >= deadline`. Nếu quá hạn, lập tức ẩn secret và xóa countdown về 0.
  2. **Bảo vệ tab ngầm với `visibilitychange` (Fail-safe on Hidden):** Đăng ký lắng nghe sự kiện `visibilitychange` trên document:
     ```typescript
     const handleVisibilityChange = () => {
       if (document.visibilityState === 'hidden') {
         // Lập tức tiêu hủy secret khỏi DOM và state khi người dùng rời tab
         setRevealedSecret(null);
         setRevealCountdown(0);
         revealDeadlineRef.current = null;
       }
     };
     ```
  3. **Tái xác thực khi focus trở lại:** Khi window nhận sự kiện `focus`, nếu `Date.now() >= revealDeadlineRef.current`, lập tức xóa secret.
- **Kiểm thử hồi quy:** Bổ sung test case `ACC-005: Real-time deadline calculation & background tab visibility protection against throttling` trong `tests/web/accounts-screen.test.mjs`, mô phỏng cả trường hợp 31s elapsed và ẩn tab. Toàn bộ 8/8 tests pass.

### 2.3. Ổn định hóa Test Harness FIN (`fake-dom.mjs` & `finance-categories-mounted.test.mjs`)

- **Nguyên nhân gốc:**
  - `AppDialog` có cơ chế auto-focus sau 30ms timer (`setTimeout(..., 30)`). Trong môi trường `fake-dom.mjs`, focus effect gọi `container.querySelectorAll(...)`, `el.closest('[aria-hidden="true"]')`, và `container.contains(...)`.
  - Class `FakeNode` và `FakeElement` trước đây chưa triển khai các phương thức duyệt DOM này. Khi test thực thi flush chậm (> 30ms), timer nổ gây văng ngoại lệ `TypeError: container.querySelectorAll is not a function`.
- **Giải pháp xử lý:**
  1. Bổ sung các phương thức chuẩn DOM `contains()`, `querySelectorAll()`, `querySelector()` và `closest()` vào `FakeNode` và `FakeElement` với bộ phân tích selector hỗ trợ attribute, `:not(...)`, và tag names.
  2. Bọc toàn bộ các block test mount trong `try { ... } finally { await act(async () => root.unmount()); }` để đảm bảo dọn dẹp an toàn ngay cả khi có assertion fail.
  3. Bổ sung test kiểm chứng timeout 30ms của `AppDialog` với delay 50ms không gây ra lỗi.
- **Kết quả:** Toàn bộ 5/5 tests danh mục tài chính và 62/62 tests web liên quan pass sạch sẽ (thời gian chạy 506ms).

---

## 3. NÂNG CẤP UI/UX VÀ TRẢI NGHIỆM NGƯỜI DÙNG (ƯU TIÊN 2)

### 3.1. Phím tắt Accessibility (ACC-006)

- Bổ sung trình lắng nghe phím `Escape` trên toàn màn hình Accounts (`AccountsScreen.tsx`):
  - Nhấn `Escape` lập tức đóng các modal đang mở (modal xác thực mật khẩu, modal cập nhật secret, modal lưu trữ tài khoản).
  - Tự động xóa trạng thái secret đang mở mà không làm rò rỉ dữ liệu.
- Đã được kiểm thử hồi quy tự động trong `tests/web/accounts-screen.test.mjs`.

### 3.2. Đánh giá rà soát các module Frontend hiện hành

1. **Module Cài đặt (Settings):**
   - Đã hỗ trợ đồng bộ mượt mà System/Light/Dark với OS mà không cần reload trang.
   - Quản lý cấu hình tiền tệ và múi giờ ổn định, lưu trữ local an toàn.
2. **Module Tài khoản & Bảo mật (Accounts):**
   - Đã bảo vệ chống rò rỉ secret dưới mọi điều kiện điều hướng, thu nhỏ cửa sổ hoặc tab ngầm.
   - Thao tác icon có aria-label, tooltip và dialog xác nhận rõ ràng.
3. **Module Tài chính (Finance):**
   - Các danh mục thu/chi hiển thị trực quan với badge trạng thái.
   - Chặn phân loại trùng lặp và xác nhận 2 bước khi vô hiệu hóa danh mục.

---

## 4. CÁC HẠNG MỤC CẦN PHỐI HỢP BACKEND VỚI CODEX

Để tiếp tục nâng cao tính năng cho các chu kỳ tiếp theo sau khi dỡ bỏ `RELEASE_HOLD`, Anty đề xuất các API contract cần Codex backend phối hợp:

1. **API Xuất báo cáo tổng hợp (Bulk Data Export):**
   - _Yêu cầu:_ Endpoint `GET /api/v1/finance/export` và `GET /api/v1/payroll/export` hỗ trợ định dạng `format=csv|xlsx` với filter theo khoảng thời gian (`from_date`, `to_date`).
2. **Chính sách lưu trữ và xuất Audit Log (Audit Retention Policy):**
   - _Yêu cầu:_ Endpoint hỗ trợ quản trị viên tải về snapshot log nén theo chu kỳ (hỗ trợ compliance AUDIT-005).
3. **Cấu hình bán kính chấm công GPS (Attendance Geofence Configuration):**
   - _Yêu cầu:_ Mở rộng API cài đặt doanh nghiệp để cấu hình tọa độ GPS trung tâm và bán kính cho phép chấm công linh hoạt (mặc định 100m).
4. **Xác thực 2 yếu tố (TOTP/MFA):**
   - _Yêu cầu:_ Các endpoint sinh secret TOTP, xác thực mã OTP khi đăng nhập cho tài khoản Quản trị viên (Owner/Admin).

---

## 5. TỔNG KẾT VÀ BẢN ĐỒ COMMIT

| Commit    | Tác giả      | Nội dung thay đổi                                                                               |
| --------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `0cf5b23` | Codex / Anty | Base acceptance commit (đã hợp nhất các mốc bàn giao trước)                                     |
| `cb34496` | Anty         | `fix(web): remediate SettingsScreen any lint, ACC-005 background expiry, and FIN fake DOM race` |

**Kết quả kiểm tra kỹ thuật:**

- **Unit & Component Tests:** 62 PASS / 0 FAIL (506ms).
- **Production Web Build:** `npm run build:web` thành công trong 3.30s (88 modules transformed).
- **TypeScript:** 0 lint errors, zero `any` trong `SettingsScreen.tsx`.
- **Trạng thái release:** Tiếp tục duy trì `QA_HOLD` / `RELEASE_HOLD`, sẵn sàng đồng bộ khi Codex hoàn tất nghiệm thu Windows.
