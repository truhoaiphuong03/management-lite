# Hệ Thống Tự Động Cảnh Báo Lỗi, Yêu Cầu AI Fix 1-Chạm & Dọn Nhật Ký (`Phase 21 — v0.6.1`) Implementation Plan

> **For agentic workers:** Implement this plan task-by-task following V4 Governance Rules & Owner Multi-Machine Surgical Read Rules (`AGENTS.md`). Khi thực hiện hoặc nâng cấp tính năng Báo lỗi / Nhật ký hệ thống / Sổ tay lỗi trong tương lai, **chỉ cần mở đúng tài liệu này và các khoảng dòng (`StartLine..EndLine`) được chỉ định bên dưới**, tuyệt đối không quét lại toàn bộ mã nguồn. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tự động hóa hoàn toàn quy trình phát hiện lỗi trên `https://ql.hoaiphuong.click` (`Nhật ký hệ thống /system-logs` ➔ `Cảnh báo trên Trang chủ /dashboard` ➔ `Nút Yêu cầu AI Fix 1-chạm & Tự động chuyển vào Sổ tay lỗi /issues` ➔ `Dọn lỗi cũ & Xác nhận đóng hàng loạt`).

**Architecture:** Mở rộng `SystemLogService` (`apps/api/src/system-log/service.ts`) và `app.ts` thêm 3 khả năng: (1) Route đồng danh `GET /api/v1/system/version` để triệt tiêu lỗi 404 từ công cụ giám sát; (2) API dọn sạch log lỗi cũ theo `fingerprint` hoặc toàn bộ log trước thời điểm hiện tại (`DELETE /api/v1/system/logs`); (3) API chuyển thẳng nhóm lỗi từ `/system-logs` sang phiếu `Sổ tay lỗi (/issues)` kèm sinh gói lệnh `AI Fix Prompt` chuẩn (`POST /api/v1/system/logs/escalate`). Trên giao diện Web, bổ sung nút thao tác 1 chạm trên `SystemLogsScreen.tsx`, cảnh báo chủ động trên `DashboardScreen.tsx`, và nút duyệt đóng hàng loạt (`Bulk Confirm`) trên `IssuesScreen.tsx`.

**Tech Stack:** Node.js 22, TypeScript, PostgreSQL (`system_logs`, `issues`, `issue_activity_log`), React 18, Vite.

**Spec:** `AGENTS.md` (Mục `1. LIVE_CHECKPOINT` & `2. PHASE_TASK_TRACKER` — `Phase 21 / v0.6.1`).

## Global Constraints

- **Không tạo migration phức tạp hay thêm thư viện thứ ba:** Tận dụng 100% bảng `system_logs` (`0028_system_logs.sql`) và `issues` hiện có.
- **Bảo mật & Phân quyền (`Owner-Only + CSRF`):** Mọi thao tác xóa nhật ký lỗi (`DELETE /api/v1/system/logs`), chuyển lỗi sang Sổ tay lỗi (`POST /api/v1/system/logs/escalate`) và đóng hàng loạt phiếu lỗi chỉ dành cho `role === 'owner'` và bắt buộc kiểm tra `requireCsrf`.
- **Khử thông tin nhạy cảm (`Sanitization`):** Mọi gói lệnh `AI Fix Prompt` sinh tự động phải đi qua `sanitizeLogText` / `redactSensitiveData` trước khi trả về trình duyệt hoặc lưu vào `issues`.
- **Chuẩn giao diện đa thiết bị (`Desktop + Mobile 320px–430px + Light/Dark AA`):** Chỉ dùng biến màu `THEME_COLORS` / `var(--*-text)`, nút bấm cao tối thiểu `36px`, không gây tràn ngang trên màn hình `320px`.

## Review Focus

- Khi bấm **"🔧 Yêu cầu AI sửa"** nhiều lần trên cùng một nhóm lỗi (`fingerprint`), hệ thống không được tạo trùng nhiều phiếu `open` trong `Sổ tay lỗi (/issues)` mà phải trả về phiếu đang mở sẵn có kèm gói lệnh `AI Fix Prompt`.
- Khi bấm **"✓ Đã xử lý / Xóa nhóm lỗi"** trên một `fingerprint`, toàn bộ bản ghi `system_logs` có cùng `fingerprint` trong Workspace của Owner phải được xóa ngay để không còn hiện lại trong bảng `Lỗi lặp lại nhiều nhất`.
- Route `GET /api/v1/system/version` phải trả về HTTP `200` với cấu trúc envelope chuẩn giống `/api/v1/health` và không ghi thêm cảnh báo `404 NOT_FOUND` vào `system_logs`.
- Trên `DashboardScreen.tsx`, thẻ cảnh báo lỗi hệ thống chỉ truy vấn `/api/v1/system/logs/summary?hours=24` khi `role === 'owner'` (tài khoản `staff` tuyệt đối không gọi endpoint này để tránh tạo lỗi `403 FORBIDDEN` trong log).
- Nút **"✓ Xác nhận & Đóng hàng loạt"** trên `IssuesScreen.tsx` chỉ tác động lên các phiếu đang ở trạng thái `awaiting_owner` hoặc `waiting_for_owner` và ghi đầy đủ lịch sử `fix_confirmed` vào `issue_activity_log`.

---

## 📊 BẢNG ĐỊNH TUYẾN FILE & KHOẢNG DÒNG (`SURGICAL FILE MAP` CHO PHASE 21)

| Mã Task       | Hạng mục thực hiện                                                                                                                                                              | File mục tiêu & Khoảng dòng (`StartLine..EndLine`)                                                                                                          | File kiểm thử (`Scoped Test`)                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Task 21.1** | Mở route `GET /api/v1/system/version` + API Dọn log cũ (`DELETE /api/v1/system/logs`) + API Chuyển lỗi sang Sổ tay lỗi & Sinh lệnh AI Fix (`POST /api/v1/system/logs/escalate`) | - `apps/api/src/system-log/service.ts:355-481`<br>- `apps/api/src/app.ts:984-1092`                                                                          | `tests/backend/system-logs-escalation.test.mjs` |
| **Task 21.2** | Giao diện `/system-logs`: Nút **`🔧 Yêu cầu AI sửa (Copy lệnh)`**, nút **`✓ Đã xử lý (Ẩn lỗi)`** trên từng dòng lỗi & nút **`🧹 Dọn sạch log cũ`** trên thanh công cụ           | - `apps/web/src/screens/SystemLogsScreen.tsx:35-65, 292-340, 416-490, 636-680`                                                                              | `tests/web/system-logs-screen.test.mjs`         |
| **Task 21.3** | Cảnh báo chủ động trên Trang chủ (`/dashboard`): Tự động hiện thẻ cảnh báo đỏ trong **Trung tâm Việc cần xử lý (`Action Center`)** khi phát hiện lỗi mới trong 24h              | - `apps/web/src/screens/DashboardScreen.tsx:100-130, 550-620, 960-1120`                                                                                     | `tests/web/dashboard-error-alert.test.mjs`      |
| **Task 21.4** | Giao diện `/issues` (`Sổ tay lỗi`): Nút **`✓ Xác nhận & Đóng hàng loạt`** cho các phiếu `Chờ Owner duyệt` (`awaiting_owner` / `waiting_for_owner`)                              | - `apps/api/src/routes/issues-routes.ts:1-160`<br>- `apps/api/src/issues/service.ts:900-1150`<br>- `apps/web/src/screens/IssuesScreen.tsx:220-360, 750-920` | `tests/web/issues-bulk-confirm.test.mjs`        |

---

### Task 21.1: Backend Route `/api/v1/system/version`, Dọn Log Cũ & Chuyển Lỗi Sang Sổ Tay Lỗi (`Escalate to Issue`)

**Files:**

- Modify: `apps/api/src/system-log/service.ts:355-481`
- Modify: `apps/api/src/app.ts:984-1092`
- Test: `tests/backend/system-logs-escalation.test.mjs`

- [x] **Step 1: Bổ sung các phương thức xử lý trong `SystemLogService` (`apps/api/src/system-log/service.ts:424-481`)**
  1. Cập nhật truy vấn `top` trong `summary()` (`lines 375-386`) để trả thêm `last_id: (array_agg(id ORDER BY occurred_at DESC))[1]` và `last_release: (array_agg(release ORDER BY occurred_at DESC))[1]` giúp giao diện biết nhóm lỗi thuộc phiên bản nào và mở ngay bản ghi mới nhất.
  2. Thêm phương thức `dismiss(auth: AuthenticatedContext, opts: { fingerprint?: string; beforeIso?: string }): Promise<{ deleted_count: number }>`:
     - Kiểm tra `requireRole(['owner'], auth)`.
     - Nếu có `opts.fingerprint`: xóa các bản ghi `WHERE (workspace_id = $1 OR workspace_id IS NULL) AND fingerprint = $2` (cùng các bản ghi đang chờ trong `this.queue` có cùng `fingerprint`).
     - Nếu không có `fingerprint` (dọn toàn bộ log cũ): xóa các bản ghi `WHERE (workspace_id = $1 OR workspace_id IS NULL) AND occurred_at <= COALESCE($2::timestamptz, now())`.
     - Trả về `{ deleted_count: res.rowCount ?? 0 }`.
  3. Thêm phương thức `buildAiFixPrompt(row: SystemLogRow, occurrencesCount: number): string`:
     - Sinh chuỗi Markdown chuẩn để Owner dán thẳng cho Antigravity/ChatGPT:
       ```markdown
       🛠️ [YÊU CẦU AI SỬA LỖI HỆ THỐNG — MANAGEMENT LITE]

       - Mã lỗi / HTTP: ${row.error_code ?? 'ERROR'} (HTTP ${row.status ?? '—'})
       - Thông điệp lỗi: ${row.message}
       - Đường dẫn (Route): ${row.method ?? 'GET'} ${row.route ?? '/'}
       - Nguồn: ${row.source === 'web' ? 'Trình duyệt (Web)' : 'Máy chủ (API)'} | Phiên bản: ${row.release ?? 'latest'}
       - Số lần lặp lại: ${occurrencesCount} lần | Fingerprint: ${row.fingerprint}
       - Request ID mẫu: ${row.request_id ?? '—'}
         ${row.stack ? `- Stack trace:\n\`\`\`\n${row.stack}\n\`\`\`` : ''}
         👉 Yêu cầu: Tìm nguyên nhân gốc rễ theo đúng file trong MODULE_FILE_MAP (AGENTS.md), sửa triệt để, chạy kiểm thử và cập nhật lên web.
       ```
  4. Thêm phương thức `escalate(auth: AuthenticatedContext, input: { fingerprint?: string; log_id?: string }): Promise<{ issue_id: string | null; bug_code: string | null; ai_fix_prompt: string; deduplicated: boolean }>`:
     - Kiểm tra `requireRole(['owner'], auth)`.
     - Lấy bản ghi `system_logs` mới nhất theo `log_id` hoặc `fingerprint`.
     - Kiểm tra trong bảng `issues` xem đã có phiếu nào chưa đóng (`status <> 'closed'`) chứa mã `fingerprint` trong `metadata_context->>'log_fingerprint'` chưa.
     - Nếu chưa có: chèn phiếu mới vào `issues` (`type = 'bug'`, `severity = row.status && row.status >= 500 ? 'P1' : 'P2'`, `status = 'open'`, `route_template = normalizeSafeRoute(row.route)`, `metadata_context = { log_fingerprint: row.fingerprint, request_id: row.request_id, status: row.status }`).
     - Trả về `{ issue_id, bug_code, ai_fix_prompt, deduplicated }`.

- [x] **Step 2: Gắn 3 endpoint vào `apps/api/src/app.ts` (`lines 984-1091`)**
  1. Tại dòng `985`: Mở rộng điều kiện `if (method === 'GET' && (pathname === '/api/v1/health' || pathname === '/api/v1/system/version'))` để trả về thông tin phiên bản chuẩn HTTP `200`, triệt tiêu lỗi `404 NOT_FOUND` trên `/api/v1/system/version`.
  2. Bên trong khối `if (pathname.startsWith('/api/v1/system/logs') ...)` (`lines 1005-1091`):
     - `DELETE /api/v1/system/logs`: gọi `requireCsrf(req, logAuth, csrfSecret, allowedOrigins)` ➔ gọi `systemLogService.dismiss(logAuth, { fingerprint: sp.get('fingerprint') ?? undefined, beforeIso: sp.get('before') ?? undefined })`.
     - `POST /api/v1/system/logs/escalate`: gọi `requireCsrf(req, logAuth, csrfSecret, allowedOrigins)` ➔ đọc body `{ fingerprint, log_id }` ➔ gọi `systemLogService.escalate(logAuth, body)`.

- [x] **Step 3: Viết và chạy kiểm thử `tests/backend/system-logs-escalation.test.mjs`**
  - Kiểm tra `GET /api/v1/system/version` trả về `200 OK` và đúng `version`.
  - Kiểm tra `POST /api/v1/system/logs/escalate` tạo phiếu `issues`, chống trùng lặp khi gọi lần 2 cùng `fingerprint`, và trả về `ai_fix_prompt`.
  - Kiểm tra `DELETE /api/v1/system/logs?fingerprint=...` xóa đúng nhóm lỗi.

---

### Task 21.2: Nâng Cấp Giao Diện `/system-logs` — Nút Yêu Cầu Fix 1-Chạm & Dọn Log Cũ

**Files:**

- Modify: `apps/web/src/screens/SystemLogsScreen.tsx:35-65, 292-340, 416-490, 636-680`
- Test: `tests/web/system-logs-screen.test.mjs`

- [x] **Step 1: Bổ sung thao tác 1 chạm trên bảng `Lỗi lặp lại nhiều nhất` (`SystemLogsScreen.tsx:416-490`)**
  - Thêm cột **`Thao tác xử lý`** vào bảng `Lỗi lặp lại nhiều nhất` với 2 nút trên mỗi dòng lỗi:
    1. **`🔧 Yêu cầu AI sửa`**: Gọi `POST /api/v1/system/logs/escalate` với `{ fingerprint: t.fingerprint }`, tự động sao chép `ai_fix_prompt` vào Clipboard và hiện thông báo xanh: _"Đã tạo phiếu Sổ tay lỗi & sao chép lệnh sửa lỗi! Hãy dán (Ctrl+V) vào khung chat cho AI."_
    2. **`✓ Đã sửa / Ẩn`**: Gọi `DELETE /api/v1/system/logs?fingerprint=${t.fingerprint}` và làm mới danh sách ngay lập tức.
  - Trên thanh công cụ đầu trang (`lines 304-335`), thêm nút **`🧹 Dọn sạch log cũ`** để xóa toàn bộ nhật ký lỗi lịch sử đã xử lý xong.

- [x] **Step 2: Chuẩn hóa màu sắc theo Theme (`THEME_COLORS`) trong `SystemLogsScreen.tsx`**
  - Thay các màu cứng (`#cbd5e1`, `#e2e8f0`, `#f1f5f9`) ở `lines 110-130` sang biến theme (`var(--border-color)`, `var(--surface-subtle)`, `var(--text-color)`) để hiển thị sắc nét trên cả chế độ Sáng và Tối.

---

### Task 21.3: Cảnh Báo Lỗi Hệ Thống Chủ Động Trên Trang Chủ (`/dashboard`)

**Files:**

- Modify: `apps/web/src/screens/DashboardScreen.tsx:100-130, 550-620, 960-1120`
- Test: `tests/web/dashboard-error-alert.test.mjs`

- [x] **Step 1: Nạp tóm tắt lỗi hệ thống cho Chủ sở hữu (`DashboardScreen.tsx`)**
  - Trong `useEffect` của `DashboardScreen.tsx` (chỉ chạy khi `role === 'owner'`), gọi nhẹ `/api/v1/system/logs/summary?hours=24`.
  - Nếu `totals.error > 0` hoặc có nhóm lỗi `top_errors` mới, hiển thị thẻ cảnh báo nổi bật trong **Trung tâm Việc cần xử lý (`Action Center`)**:
    - Tiêu đề: **`⚠️ Phát hiện X lỗi hệ thống trong 24 giờ qua`** (kèm tên lỗi mới nhất).
    - Nút hành động 1: **`Xem & Yêu cầu Fix (/system-logs)`** (chuyển thẳng sang `/system-logs`).
    - Nút hành động 2: **`Đã biết / Dọn log cũ`** (gọi xóa nhanh log cũ ngay từ Dashboard).

---

### Task 21.4: Nút `"Xác Nhận & Đóng Hàng Loạt"` Trên Sổ Tay Lỗi (`/issues`)

**Files:**

- Modify: `apps/api/src/routes/issues-routes.ts:1-160`
- Modify: `apps/api/src/issues/service.ts:900-1150`
- Modify: `apps/web/src/screens/IssuesScreen.tsx:220-360, 750-920`
- Test: `tests/web/issues-bulk-confirm.test.mjs`

- [x] **Step 1: Bổ sung endpoint `POST /api/v1/issues/bulk-confirm` (`issues-routes.ts` & `issues/service.ts`)**
  - Cho phép Owner xác nhận hoàn tất toàn bộ (hoặc danh sách `issue_ids` được chọn) các phiếu đang ở trạng thái `awaiting_owner` / `waiting_for_owner` / `fixed` sang `closed` trong 1 giao dịch SQL (`UPDATE issues SET status = 'closed', closed_at = NOW(), version = version + 1 WHERE workspace_id = $1 AND status IN ('awaiting_owner', 'waiting_for_owner', 'fixed')`).
- [x] **Step 2: Thêm nút `"✓ Xác nhận & Đóng tất cả phiếu chờ duyệt (N)"` trên `IssuesScreen.tsx`**
  - Khi số lượng phiếu ở trạng thái `Chờ Owner duyệt` (`awaiting_owner` / `waiting_for_owner`) `> 0`, hiển thị nút **`✓ Duyệt & Đóng tất cả (N phiếu)`** ngay trên thanh bộ lọc của `/issues` để Owner nghiệm thu chỉ với 1 cú nhấp chuột.
