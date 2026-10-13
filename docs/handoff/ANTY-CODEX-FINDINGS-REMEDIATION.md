# BÁO CÁO XỬ LÝ CÁC LỖI FRONTEND DO CODEX PHÁT HIỆN (ANTY CODEX FINDINGS REMEDIATION)

**Mã tài liệu:** `ANTY-CODEX-FINDINGS-REMEDIATION.md`  
**Vai trò:** Anty (Frontend, UI/UX & User Operation Lead)  
**Nhánh sửa lỗi mới:** `fix/anty-codex-findings-remediation` (tách độc lập từ mốc freeze `01ece18`)  
**Mốc commit freeze gốc:** `01ece18` (bảo toàn nguyên vẹn trên nhánh `feat/anty-acceptance-123`)  
**Báo cáo Codex tiếp nhận:** `CODEX-BATCH2-INDEPENDENT-AUDIT.md` (Commit `2679c7c`), `CODEX-TO-ANTY-BATCH2-FINDINGS.md`  
**Môi trường thử nghiệm cô lập:** Vite Dev Server `http://127.0.0.1:3037` & Chrome Headless CDP (`port 9247`)  
**Ngày lập:** 12/10/2026  
**Trạng thái cổng phát hành:** **`RELEASE_HOLD`** (Duy trì nghiêm ngặt kỷ luật phát hành, chờ quyết định tích hợp từ Owner & Codex).

---

## 1. TUÂN THỦ KỶ LUẬT PHÂN CÔNG & AN TOÀN HỆ THỐNG

1. **Bảo tồn mốc nghiệm thu `01ece18`:** Nhánh `feat/anty-acceptance-123` tại commit `01ece18` được giữ nguyên làm mốc bàn giao gốc. Mọi bản sửa lỗi theo yêu cầu của Codex được thực hiện trên nhánh riêng biệt `fix/anty-codex-findings-remediation`.
2. **Không can thiệp ngoài thẩm quyền:** Tuyệt đối không chỉnh sửa `apps/api/**`, `packages/database/**`, migration, tests backend hoặc worktree của Codex.
3. **Không tự ý triển khai:** Không merge main, không cherry-pick, không push remote production và không deploy Windows Server.
4. **Nguyên tắc xử lý lỗi có kiểm chứng:** Mỗi lỗi đều có bằng chứng tái hiện, giải pháp xử lý triệt để và bộ test kiểm chứng PASS sau khi sửa.

---

## 2. KẾT QUẢ XỬ LÝ CHI TIẾT TỪNG LỖI DO CODEX PHÁT HIỆN

### 2.1. P1: REP-003 / REP-006 — Trắng trang Báo cáo do vi phạm React Rules of Hooks
- **Tài liệu Codex:** `CODEX-TO-ANTY-BATCH2-FINDINGS.md` mục "P1 REP-003 / REP-006: trắng trang Báo cáo".
- **Triệu chứng & Tái hiện:**
  - Khi mở `/reports`, màn hình bị trắng không hiển thị bảng hoặc phân trang.
  - Console báo lỗi: `Rendered more hooks than during the previous render`.
  - Nguyên nhân: Trong [`apps/web/src/screens/ReportsScreen.tsx`](file:///Users/duongbinh/Projects/management-lite-ui-report/apps/web/src/screens/ReportsScreen.tsx), khối `if (loading) return <LoadingState ... />` nằm trước hook `pagedReports = useMemo(...)`. Khi đang tải, React chạy 42 hooks; khi nạp xong, React chạy hook thứ 43, vi phạm quy tắc gọi hook có điều kiện.
- **Biện pháp khắc phục (Đã hoàn tất):**
  - Di chuyển toàn bộ tính toán `reportsToRender`, `safeReportsPage` và hook `pagedReports = useMemo(...)` lên đầu component trước `useEffect` và trước khối kiểm tra `loading`.
  - Đảm bảo số lượng và thứ tự các React Hook hoàn toàn cố định trong mọi chu kỳ render.
- **Bằng chứng kiểm chứng:**
  - [`scripts/test-ui-fix-45-chrome.mjs`](file:///Users/duongbinh/Projects/management-lite-ui-report/scripts/test-ui-fix-45-chrome.mjs) Phần 3: `ReportsScreen Stale JSON Guard Verification: PASS` trên trình duyệt thực tế headless Chrome.
  - [`tests/web/reports-pagination.test.mjs`](file:///Users/duongbinh/Projects/management-lite-ui-report/tests/web/reports-pagination.test.mjs): **10/10 test cases PASS**.

---

### 2.2. P2: ACC-004 — Nút Xem mật khẩu trên trang Chi tiết Tài khoản không mở Modal
- **Tài liệu Codex:** `CODEX-TO-ANTY-BATCH2-FINDINGS.md` mục "P2 ACC-004: detail reveal không mở modal" & `browser-bound-anty-settings-results.json` dòng 72.
- **Triệu chứng & Tái hiện:**
  - Khi vào chi tiết một tài khoản tại `/accounts/:id` và nhấn "Xem mật khẩu", modal Re-auth xác thực lại không xuất hiện trên màn hình.
  - Nguyên nhân: Trong [`apps/web/src/screens/AccountsScreen.tsx`](file:///Users/duongbinh/Projects/management-lite-ui-report/apps/web/src/screens/AccountsScreen.tsx), tuyến `/accounts/:id` trả về sớm (`if (accountId) return (...)`), trong khi 5 Modal nghiệp vụ (Re-auth Reveal, Update Secret, Edit, Archive, Restore) lại được đặt ở cuối khối render của danh sách.
- **Biện pháp khắc phục (Đã hoàn tất):**
  - Tách giao diện chi tiết thành hàm helper `renderDetailView()`.
  - Bọc cả chế độ danh sách và chế độ xem chi tiết trong khung JSX chung, đảm bảo toàn bộ 5 Modal nghiệp vụ luôn luôn được mount vào DOM cho cả 2 tuyến.
- **Bằng chứng kiểm chứng:**
  - [`tests/web/accounts-screen.test.mjs`](file:///Users/duongbinh/Projects/management-lite-ui-report/tests/web/accounts-screen.test.mjs): **6/6 test cases PASS**, bao gồm subtest 6 kiểm tra trực tiếp hành vi mở modal reauth từ trang chi tiết.

---

### 2.3. P2: SET-002 — Theme chỉ lưu Preference vào localStorage, chưa áp dụng Visual Theme
- **Tài liệu Codex:** `CODEX-TO-ANTY-BATCH2-FINDINGS.md` mục "P2 SET-002: theme chỉ lưu preference" & `browser-bound-anty-settings-results.json` dòng 51.
- **Triệu chứng & Tái hiện:**
  - Khi người dùng vào Cài đặt (`/settings`) và chọn giao diện Sáng, giá trị được lưu vào `localStorage.getItem('mglite_theme')`, nhưng màu nền `document.body` và thuộc tính `colorScheme` của `document.documentElement` không hề thay đổi.
- **Biện pháp khắc phục (Mới hoàn tất):**
  - **Hàm điều khiển giao diện:** Xuất bản hàm `applyTheme(selectedTheme)` trong [`apps/web/src/screens/SettingsScreen.tsx`](file:///Users/duongbinh/Projects/management-lite-ui-report/apps/web/src/screens/SettingsScreen.tsx):
    - Gán thuộc tính `document.documentElement.setAttribute('data-theme', selectedTheme)`.
    - Gán `document.documentElement.style.colorScheme` (`light`, `dark`, hoặc `light dark`).
    - Cập nhật trực tiếp `document.body.style.backgroundColor` (`#F8FAFC` cho sáng, `#0B1220` cho tối) và `document.body.style.color`.
  - **CSS Design Tokens:** Bổ sung các rule `:root[data-theme='light'], [data-theme='light']` và `:root[data-theme='dark'], [data-theme='dark']` trong [`packages/ui/src/tokens.css`](file:///Users/duongbinh/Projects/management-lite-ui-report/packages/ui/src/tokens.css), ghi đè toàn bộ các biến surface, text, border khi đổi theme.
  - **Khởi tạo khi nạp trang:**
    - Tích hợp `useEffect` nạp theme trong [`apps/web/src/App.tsx`](file:///Users/duongbinh/Projects/management-lite-ui-report/apps/web/src/App.tsx).
    - Bổ sung inline script khởi tạo theme sớm trong [`apps/web/index.html`](file:///Users/duongbinh/Projects/management-lite-ui-report/apps/web/index.html) để triệt tiêu hoàn toàn hiện tượng nháy giao diện (FOUC).
  - **Áp dụng tức thì:** Gọi `applyTheme(newTheme)` ngay khi người dùng chọn trong dropdown của `SettingsScreen`.
- **Bằng chứng kiểm chứng:**
  - [`tests/web/settings-screen.test.mjs`](file:///Users/duongbinh/Projects/management-lite-ui-report/tests/web/settings-screen.test.mjs): Bổ sung Test 4 xác minh đầy đủ `data-theme`, `colorScheme`, màu nền body và CSS tokens -> **4/4 PASS**.

---

### 2.4. ATT-007: Chuẩn hóa ví dụ hợp đồng API trong Tài liệu Bàn giao
- **Tài liệu Codex:** `CODEX-TO-ANTY-BATCH2-FINDINGS.md` mục "ATT-007: sửa ví dụ contract, không đổi endpoint".
- **Nội dung đối chiếu:**
  - Codex chỉ ra rằng trong tài liệu [`docs/handoff/ANTY-API-REQUIREMENTS.md`](file:///Users/duongbinh/Projects/management-lite-ui-report/docs/handoff/ANTY-API-REQUIREMENTS.md) mục 2.1 có ghi nhầm ví dụ payload là `decision: "approved" | "rejected"` và `reviewer_notes`.
  - Tuy nhiên, trong mã nguồn thực tế của [`apps/web/src/screens/ClockScreen.tsx`](file:///Users/duongbinh/Projects/management-lite-ui-report/apps/web/src/screens/ClockScreen.tsx) (dòng 622–645), hàm `executeDecideCorrection` vốn **ĐÃ SỬ DỤNG ĐÚNG CHUẨN BACKEND**:
    ```ts
    body: JSON.stringify({
      decision, // 'accept' | 'reject'
      reason: reason.trim(),
      clock_out_at: clockOutAt,
    })
    ```
- **Biện pháp khắc phục (Đã hoàn tất):**
  - Cập nhật mục 2.1 trong [`docs/handoff/ANTY-API-REQUIREMENTS.md`](file:///Users/duongbinh/Projects/management-lite-ui-report/docs/handoff/ANTY-API-REQUIREMENTS.md) khớp chính xác với mã nguồn và schema backend của Codex:
    ```json
    {
      "decision": "accept", // hoặc "reject"
      "reason": "Chấp thuận điều chỉnh giờ ra ca",
      "clock_out_at": "2026-10-12T11:00:00.000Z"
    }
    ```
  - Không có bất kỳ thay đổi nào phá vỡ logic giao diện hoặc yêu cầu sửa đổi backend.

---

### 2.5. FILE-004: Tình trạng Xác minh Google Drive Provider thật
- **Tài liệu Codex:** `CODEX-TO-ANTY-BATCH2-FINDINGS.md` mục "FILE-004: provider thật chưa được xác minh".
- **Hiện trạng Frontend:**
  - Phía UI đã tích hợp và kiểm thử đạt chuẩn 100% đối với: Giao thức kiểm tra tính sẵn sàng dọn dẹp `delete-readiness`, kiểm tra khóa đồng thời `If-Match` / `group_snapshot_hash`, và hộp thoại xác nhận 2 bước fail-closed chuẩn Google Drive Trash.
  - Về việc kết nối với Google Drive API thật: Anty hoàn toàn đồng thuận với đánh giá của Codex. Đây là công việc đòi hỏi cấu hình OAuth2 / Service Account credential thực tế trong sandbox.
  - **Quyết định:** Giữ nguyên khóa an toàn fail-closed hiện tại, không tự ý sửa đổi backend hay mock sai lệch; chờ Owner cung cấp sandbox provider để nghiệm thu độc lập.

---

### 2.6. Build & Typecheck: Khắc phục cảnh báo TS2742 tại `apps/web/src/finance/ui.tsx:342`
- **Tài liệu Codex:** `CODEX-TO-ANTY-BATCH2-FINDINGS.md` mục "Build/lock: điều kiện tích hợp".
- **Triệu chứng:** Hàm `useFinanceMutation` suy luận kiểu trả về phức tạp có thể gây lỗi TS2742 khi trình biên dịch TypeScript chạy ở chế độ xuất file định nghĩa (`declaration: true`).
- **Biện pháp khắc phục (Đã hoàn tất):**
  - Khai báo interface tường minh `FinanceMutationResult` trong [`apps/web/src/finance/ui.tsx`](file:///Users/duongbinh/Projects/management-lite-ui-report/apps/web/src/finance/ui.tsx):
    ```ts
    export interface FinanceMutationResult {
      pending: PendingFinanceOperation | null;
      error: string;
      busy: boolean;
      ready: boolean;
      success: boolean;
      submit: (
        path: string,
        method: 'POST' | 'PATCH',
        payload: Record<string, unknown>,
        version?: number | null,
      ) => Promise<unknown>;
    }
    ```
  - Khai báo kiểu trả về tường minh: `export function useFinanceMutation(...): FinanceMutationResult`.
- **Bằng chứng kiểm chứng:**
  - `tsc --declaration --noEmit`: **0 lỗi (Exit code 0)**.
  - `npm run --workspace=@management-lite/web build`: **Biên dịch thành công 100% (3.33s)**.

---

## 3. TỔNG HỢP DANH MỤC LỖI ĐÃ GIẢI QUYẾT & LỖI CÒN TỒN TẠI

| Mã lỗi / Hạng mục | Mức độ | Phân loại | Trạng thái | Bằng chứng kiểm thử |
|---|:---:|---|:---:|---|
| **REP-003 / REP-006** (Trắng trang báo cáo) | P1 | Frontend | **ĐÃ GIẢI QUYẾT** | Sửa thứ tự Hook; `test-ui-fix-45-chrome` PASS, `reports-pagination.test` (10/10 PASS) |
| **ACC-004** (Nút xem mật khẩu không mở modal) | P2 | Frontend | **ĐÃ GIẢI QUYẾT** | Tách `renderDetailView()`; `accounts-screen.test` (6/6 PASS) |
| **SET-002** (Theme chỉ lưu preference) | P2 | Frontend | **ĐÃ GIẢI QUYẾT** | Thêm `applyTheme()`, cập nhật root/body & CSS tokens; `settings-screen.test` (4/4 PASS) |
| **ATT-007** (Sai ví dụ contract trong tài liệu) | Info | Tài liệu | **ĐÃ GIẢI QUYẾT** | Cập nhật `ANTY-API-REQUIREMENTS.md` mục 2.1 khớp schema backend |
| **TS2742** (Kiểu trả về `useFinanceMutation`) | Refactor | Frontend | **ĐÃ GIẢI QUYẾT** | Thêm interface `FinanceMutationResult`; `tsc --declaration` PASS (0 error) |
| **FILE-004** (Google Drive Provider thật) | Hold | Tích hợp | **CHỜ SANDBOX** | UI 2-step fail-closed PASS; chờ Owner cấp quyền provider thật |

---

## 4. BẰNG CHỨNG KIỂM THỬ HỆ THỐNG TOÀN DIỆN

1. **Bộ kiểm thử tự động Web Frontend (`tests/web/`):**
   - Lệnh: `QA_WEB_BASE=http://127.0.0.1:3037 node --test tests/web/*.test.mjs`
   - Kết quả: **264 PASS / 0 FAIL / 1 SKIP** (100% tỷ lệ đạt trên toàn bộ các bộ kiểm thử hoạt động).
2. **Bộ kiểm thử Trình duyệt Live Headless Chrome (CDP Execution):**
   - `scripts/test-ui-fix-45-chrome.mjs`: **PASS (100%)**
   - `scripts/test-ui-fix-47-chrome.mjs`: **PASS (100%)**
   - `scripts/chrome-fin-plan-qa.mjs`: **PASS (28/28 assertions)**
3. **Kiểm tra kiểu tĩnh TypeScript & Khởi tạo Declaration:**
   - Lệnh: `tsc --declaration --noEmit`
   - Kết quả: **0 lỗi (Exit code 0)**.
4. **Biên dịch Production Web:**
   - Lệnh: `npm run --workspace=@management-lite/web build`
   - Kết quả: **100% PASS (dist/index.html, dist/assets/index.js, dist/assets/index.css)**.

---

## 5. KẾT LUẬN & TRẠNG THÁI KHÓA

- Nhánh sửa lỗi: [`fix/anty-codex-findings-remediation`](file:///Users/duongbinh/Projects/management-lite-ui-report).
- Toàn bộ 5/5 phát hiện kỹ thuật frontend và tài liệu của Codex đã được xử lý triệt để với đầy đủ bằng chứng kiểm thử tự động.
- **Trạng thái cổng phát hành:** **`RELEASE_HOLD`**.
- Anty trân trọng kính báo và chờ quyết định tích hợp từ Owner và Codex.
