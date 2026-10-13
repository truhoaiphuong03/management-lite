# ANTY — BÁO CÁO SỬA LỖI SET-002 SYSTEM THEME DYNAMIC OS APPEARANCE CHANGE

**Ngày thực hiện:** 2026-10-12  
**Người thực hiện:** Anty (Frontend Engineering)  
**Mục tiêu:** Khắc phục lỗi duy nhất còn tồn đọng sau tích hợp QA của Codex (commit `f2aefdc` / `1b03a3b`):  
- `SET-002 System follows subsequent OS appearance change` -> **FAIL** trong kiểm thử Chrome headless của Codex (`theme-browser-results.json`).  
**Trạng thái kiểm soát:** **QA_HOLD / RELEASE_HOLD** (Không tự ý merge `main`, không push production, không cập nhật Windows).

---

## 1. NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE)

1. **Thiếu Event Listener trên MediaQueryList:**  
   Trong hàm `applyTheme(selectedTheme)` trước đây, khi người dùng chọn `theme === 'system'`, ứng dụng chỉ đánh giá thuộc tính `window.matchMedia('(prefers-color-scheme: dark)').matches` một lần duy nhất tại thời điểm thiết lập. Không có `change` event listener nào được đăng ký trên `MediaQueryList`. Khi hệ điều hành đổi giữa Dark và Light mode (hoặc CDP gửi lệnh `Emulation.setEmulatedMedia`), trình duyệt không kích hoạt cập nhật lại các thuộc tính trực quan trên `document.body`.

2. **Khóa kiểu dáng trực tiếp qua Inline Styles:**  
   Thuộc tính `document.body.style.backgroundColor` và `document.body.style.color` được gán trực tiếp (inline style) khi kích hoạt theme, có độ ưu tiên CSS specificity cao hơn các CSS variable rules thông thường. Khi OS thay đổi diện mạo, giá trị inline style cũ vẫn tồn tại khiến `getComputedStyle(document.body).backgroundColor` không đổi.

3. **Thiếu CSS Token Overrides cho `[data-theme='system']`:**  
   Tệp `packages/ui/src/tokens.css` chỉ mới định nghĩa các biến `--bg-color`, `--surface-color`, v.v. cho `[data-theme='light']` và `[data-theme='dark']`, chưa có quy tắc `@media (prefers-color-scheme: light)` và `@media (prefers-color-scheme: dark)` cho `[data-theme='system']`.

---

## 2. GIẢI PHÁP ĐÃ TRIỂN KHAI (IMPLEMENTATION)

### 2.1. Quản lý vòng đời Event Listener động trong `SettingsScreen.tsx`
- Bổ sung singleton quản lý `activeMediaQuery: MediaQueryList | null` và `activeMediaListener: ((e: MediaQueryListEvent | MediaQueryList) => void) | null`.
- Xuất khẩu hàm `removeThemeListener(): void` để dọn dẹp listener triệt để (tương thích cả `removeEventListener('change', ...)` và `removeListener(...)`).
- Trong `applyTheme(selectedTheme: string)`:
  - Khi chọn `light` hoặc `dark`: Gọi `removeThemeListener()`, gán `root.style.colorScheme` tương ứng và thiết lập màu nền/chữ trực quan. Mọi thay đổi OS sau đó sẽ **hoàn toàn không ghi đè** lựa chọn thủ công của người dùng.
  - Khi chọn `system`:
    1. Gọi `removeThemeListener()` để đảm bảo không bị trùng lặp listener.
    2. Đặt `root.style.colorScheme = 'light dark'`.
    3. Đăng ký listener `activeMediaListener` lắng nghe sự kiện `'change'` trên `window.matchMedia('(prefers-color-scheme: dark)')`.
    4. Cập nhật ngay lập tức `document.body.style.backgroundColor` và `document.body.style.color` tương ứng với `e.matches` mà **không cần tải lại trang**.
    5. Có kiểm tra điều kiện an toàn `document.documentElement.getAttribute('data-theme') === 'system'` trước khi cập nhật.

### 2.2. Dọn dẹp Listener tại Root Application (`App.tsx`)
- `App.tsx` nạp `savedTheme` từ `localStorage.getItem('mglite_theme') || 'dark'` khi khởi động.
- Trong `useEffect` khởi tạo, đăng ký dọn dẹp qua hàm trả về `return () => { removeThemeListener(); };`, đảm bảo giải phóng bộ nhớ khi ứng dụng unmount.

### 2.3. Cập nhật CSS Design Tokens (`packages/ui/src/tokens.css`)
- Bổ sung quy tắc `@media (prefers-color-scheme: light)` cho `:root[data-theme='system'], [data-theme='system']` với đầy đủ các token giao diện sáng (`--bg-color: #f8fafc`, `--surface-color: #ffffff`, `--text-color: #0f172a`, v.v.).
- Bổ sung quy tắc `@media (prefers-color-scheme: dark)` cho `:root[data-theme='system'], [data-theme='system']` với đầy đủ các token giao diện tối (`--bg-color: #0b1220`, `--surface-color: #151f30`, `--text-color: #f8fafc`, v.v.).

### 2.4. Khử FOUC ban đầu (`apps/web/index.html`)
- Đoạn mã khởi tạo sớm trong `<head>` được bổ sung nhánh `else { document.documentElement.style.colorScheme = 'light dark'; }` cho chủ đề hệ thống, ngăn chặn hiện tượng chớp nháy màu sắc trước khi React render.

### 2.5. Bổ sung Regression Test (`tests/web/settings-screen.test.mjs`)
- Bổ sung kịch bản kiểm thử mô phỏng chính xác kịch bản CDP của Codex:
  - Chọn `system` khi OS đang dark -> hiển thị giao diện tối, listener được gắn.
  - OS đổi sang light trong thời gian thực (`change` event với `matches: false`) -> màu nền/chữ của `body` lập tức chuyển sang sáng mà không cần reload.
  - OS đổi lại dark trong thời gian thực (`change` event với `matches: true`) -> màu nền/chữ của `body` lập tức chuyển sang tối mà không cần reload.
  - Người dùng chọn thủ công `light` -> listener bị hủy (`removeThemeListener`), `attachedListener === null`.
  - Thay đổi OS tiếp theo hoàn toàn bị bỏ qua, bảo toàn lựa chọn thủ công của người dùng.

---

## 3. KẾT QUẢ KIỂM THỬ VÀ NGHIỆM THU

1. **Unit & Behavioral Regression Test:**
   ```bash
   node --test tests/web/settings-screen.test.mjs
   ```
   - **Kết quả:** 5/5 PASS (100%).

2. **Toàn bộ Web Test Suite:**
   ```bash
   QA_WEB_BASE=http://127.0.0.1:3037 node --test tests/web/*.test.mjs
   ```
   - **Kết quả:** **265 PASS / 0 FAIL / 1 SKIP** (Skip duy nhất là bài kiểm tra ISSUES thủ công có sẵn).

3. **TypeScript Typecheck:**
   ```bash
   node /Users/duongbinh/Projects/management-lite/node_modules/.ignored/typescript/bin/tsc --declaration --noEmit
   ```
   - **Kết quả:** **0 lỗi** (Exit code 0).

4. **Web Bundle Build:**
   ```bash
   npm run --workspace=@management-lite/web build
   ```
   - **Kết quả:** Thành công trong 3.28 giây (Vite v6.4.4), 0 lỗi.

5. **Prettier Format Check:**
   ```bash
   node /Users/duongbinh/Projects/management-lite/node_modules/.ignored/prettier/bin/prettier.cjs --check ...
   ```
   - **Kết quả:** Toàn bộ file sửa đổi tuân thủ Prettier format 100%.

6. **Chrome Headless Mounted Suites (Fail-Closed CDP):**
   - `scripts/test-ui-fix-45-chrome.mjs`: **PASS 100%** (Login focus 401/429/Network error, EmployeesScreen mounted pagination, ReportsScreen stale JSON guard, Fail-closed ledger audit).
   - `scripts/test-ui-fix-47-chrome.mjs`: **PASS 100%** (Controlled probe fail-closed, ReportsScreen staff delay, EmployeesScreen unmount/lifecycle, FIX-41 layout stability, Issue retry/copy).

---

## 4. DANH SÁCH FILE THAY ĐỔI

| STT | Đường dẫn file | Mục đích thay đổi |
|:---:|:---|:---|
| 1 | `apps/web/src/screens/SettingsScreen.tsx` | Bổ sung `removeThemeListener`, quản lý `activeMediaQuery`/`activeMediaListener` lắng nghe sự kiện đổi OS appearance cho system theme |
| 2 | `apps/web/src/App.tsx` | Nhập `removeThemeListener` và dọn dẹp listener khi unmount ứng dụng |
| 3 | `packages/ui/src/tokens.css` | Bổ sung CSS media queries `@media (prefers-color-scheme: light/dark)` cho `[data-theme='system']` |
| 4 | `apps/web/index.html` | Thiết lập `colorScheme = 'light dark'` sớm cho system theme |
| 5 | `tests/web/settings-screen.test.mjs` | Bổ sung bài test tự động cho dynamic OS change, manual override guard, và cleanup lifecycle |

---

## 5. KẾT LUẬN & ĐỀ XUẤT TIẾP THEO

- Toàn bộ yêu cầu của Owner đối với lỗi **SET-002 System theme** đã được giải quyết triệt để và an toàn trong phạm vi frontend.
- Mã nguồn sẵn sàng để Codex chạy lại kịch bản tích hợp Chrome (`theme-browser.mjs`) để xác nhận kết quả chuyển từ FAIL sang **PASS**.
- Tiếp tục duy trì **QA_HOLD / RELEASE_HOLD** cho đến khi Codex và Owner tiến hành nghiệm thu tích hợp cuối cùng.
