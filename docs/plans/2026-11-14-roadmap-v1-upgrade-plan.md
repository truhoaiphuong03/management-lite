# Lộ Trình Nâng Cấp Thực Chiến `v0.9.23` → `v1.0.0` Implementation Plan

> **For agentic workers:** Implement this plan task-by-task following V4 Governance Rules (only after Owner design approval; verify each step before completion). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai trọn bộ 4 giai đoạn nâng cấp thực chiến đã được Owner phê duyệt (`v0.9.23` → `v0.10.0` → `v0.10.1` → `v1.0.0`) trên nhánh riêng `feat/roadmap-v1-upgrade-20261114`, kiểm thử E2E từng giai đoạn trên Staging và đóng gói sẵn lệnh phát hành qua cổng Owner (`REMEDIATION_FREEZE` giữ nguyên).

**Architecture:** Kế thừa nguyên vẹn nền tảng Monorepo TypeScript/PostgreSQL 18 và bản vá QA `2016a48`. Mở rộng phi phá hủy (backward-compatible 100%): tái sử dụng `resolveVietQrBankCode` + hồ sơ ngân hàng của Owner (`/api/v1/employees/me`) để sinh mã VietQR thu khách trên Báo giá PDF A4 & Sổ công nợ phải thu; đồng bộ tự động giao dịch `PT-...`/`PC-...` (và hủy `VOID`) sang `fin_entries` bằng khóa chống trùng `operation_key`; chia nhỏ gói JS `PrintQuoteScreen` + tách Modal `StorageScreen` xuống dưới ngưỡng 200 kB/chunk; mở rộng phân trang `limit/offset` an toàn cho `work-items` & `print-quotes`; bổ sung cảnh báo chủ động trên `Action Center` (`/dashboard`).

**Tech Stack:** TypeScript 5, Node.js HTTP (`RouteTable`), PostgreSQL 18 (`pg` PoolClient + Savepoints), React 18 + Vite 6 (`rollupOptions.output.manualChunks` + `React.lazy`), Node Test Runner (`node --test`).

**Spec:** Owner Approval (`A1–A4`, `2026-11-14T06:43:32+07:00`) + [`docs/handoff/GLOBAL-PAGINATION-HOLD-API-PLAN.md`](../handoff/GLOBAL-PAGINATION-HOLD-API-PLAN.md) + [`docs/deployment/OWNER-RELEASE-RUNBOOK.md`](../deployment/OWNER-RELEASE-RUNBOOK.md).

## Global Constraints

- **Zero Production Modification (`AGENTS.md §0`):** Tuyệt đối không ghi vào `C:\HoaiPhuong-Server\`, không chạm PostgreSQL `:55432`, không tự push `main` hoặc gắn `git tag` khi đang bật `REMEDIATION_FREEZE`.
- **Customer-Safe PDF Invariant:** File PDF A4 & bản xem trước gửi khách tuyệt đối không lộ `vendorCost`, `profit`, tên nhà in hoặc ghi chú nội bộ.
- **Idempotent Ledger Sync:** Mọi bút toán tự động ghi sang `fin_entries` phải bọc trong `SAVEPOINT` và dùng `operation_key` duy nhất (`pq_ar_receipt:<txId>`, `pq_ap_payout:<txId>`) để không bao giờ ghi trùng hoặc làm hỏng giao dịch gốc.
- **Backward-Compatible Pagination:** Khi không truyền `limit`/`offset`, các API danh sách bắt buộc trả về đúng cấu trúc mảng như cũ; ngân sách gói JS tải lần đầu giữ `<= 450 KB raw / 130 KB gzip`.
- **Dual UI & Theme AA:** Mọi phần tử UI mới dùng biến CSS theme (`var(--surface-color)`, `var(--border-color)`...), cỡ chữ `>= 12px`, không tràn ngang ở `320px`.

## Review Focus

1. **Owner chưa khai báo số tài khoản ngân hàng trong `/settings`:** Khối VietQR trên Báo giá PDF A4 và Modal thu tiền khách phải tự ẩn gọn (không hiện ảnh lỗi hay số tài khoản rỗng), kèm gợi ý nhẹ cho Owner vào `/settings` cập nhật ngân hàng.
2. **Môi trường máy chủ/CI ngoại tuyến khi xuất PDF A4 (`renderCustomerSafeA4PdfBuffer`):** Tải ảnh QR trên server phải có timeout cứng `2500ms` chuyển sang `data:image/png;base64,...`; nếu mạng chặn hoặc timeout thì chỉ in bảng thông tin số tài khoản chữ rõ nét, không bao giờ treo tiến trình Chromium hoặc in icon ảnh vỡ.
3. **Hủy phiếu thu/chi ngành in (`voidArTransactionTx` / `voidApTransactionTx`):** Nếu phiếu `PT-...`/`PC-...` bị hủy (`VOIDED`), hệ thống không được để phiếu thu/chi mồ côi làm lệch tổng `/finance` — cần tự động ghi bút toán đảo chiều (`reversal` / cập nhật bản ghi đối ứng có `operation_key` riêng `pq_ar_void:<txId>` / `pq_ap_void:<txId>`).
4. **Nhân bản báo giá (`⧉ Nhân bản`) khi bảng giá xưởng đã tăng/giảm:** Các dòng lấy từ danh mục (`baseCostSource === 'CATALOG'`) phải tự động tra phiên bản giá mới nhất đang hoạt động của `vendorPriceItemId` và thông báo rõ số dòng đã cập nhật giá mới.
5. **Tương thích SSR `renderToStaticMarkup` khi chia nhỏ chunk `PrintQuoteScreen`:** Các tab được render trực tiếp trong bài test SSR (`QuotesListTab`, `CreateQuoteTab`, `OrdersTab`, `VendorsCatalogTab`, `CustomersTab`, `AnalyticsTab`) được tách chunk qua `manualChunks` của Vite thay vì `React.lazy` ở cấp tab gốc để vừa giảm chunk `< 160 kB` vừa giữ `100%` test SSR xanh; riêng các Modal (`PdfPreviewModal`, `CatalogModalDialog`, `StorageModals`) dùng `React.lazy` + `<Suspense>`.

---

### Phase 1 (`v0.9.23`): Chuẩn Hóa Tài Liệu Quản Trị, Đóng Gói Bản Vá QA & Dọn Worktree Cũ

**Files:**

- Modify: `docs/ROADMAP.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `AGENTS.md`
- Modify: `package.json`, `packages/contracts/src/version.ts`, `packages/contracts/src/release-notes-catalog.ts`
- Create: `scripts/ops/prepare-owner-release-commands.mjs`
- Test: `tests/web/phase16-release-integrity.test.mjs`

**Interfaces:**

- Produces: `SYSTEM_VERSION = '0.9.23'`, đồng bộ sổ cái `ROADMAP.md` từ `v0.7.2` → `v0.9.23` (ghi nhận đầy đủ `v0.9.0..v0.9.22` + `BUG-QA-01..12`), công cụ in sẵn bộ lệnh kiểm tra & phát hành an toàn qua cổng Owner (`npm run release:print-owner-gate`).

- [x] **Step 1: Đồng bộ `docs/ROADMAP.md`, `PROJECT_STATUS.md` và tạo `scripts/ops/prepare-owner-release-commands.mjs`**
- [x] **Step 2: Nâng version `0.9.23` trong `package.json`, `version.ts`, `release-notes-catalog.ts` & chạy `node scripts/gen-build-info.mjs`**
- [x] **Step 3: Chạy kiểm tra `npm run typecheck && node --test tests/web/phase16-release-integrity.test.mjs`**
- [x] **Step 4: Commit mốc `v0.9.23` lên nhánh `feat/roadmap-v1-upgrade-20261114`**

---

### Phase 2 (`v0.10.0`): VietQR Báo Giá & Công Nợ Khách, Liên Thông Thu/Chi In Ấn ➔ `/finance` & Nhân Bản Báo Giá 1-Chạm

**Files:**

- Create: `packages/contracts/src/vietqr.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/web/src/screens/helpers/payroll-helpers.ts`
- Modify: `apps/web/src/screens/helpers/printquote-helpers.ts`
- Modify: `apps/api/src/printquote/pdf-renderer.ts`
- Modify: `apps/api/src/printquote/service.ts`
- Modify: `apps/api/src/printquote/ledger-ar-ap-ops.ts`
- Modify: `apps/web/src/screens/PrintQuoteScreen.tsx`
- Modify: `apps/web/src/screens/printquote/QuotesListTab.tsx`
- Modify: `apps/web/src/screens/printquote/ReceivablesTab.tsx`
- Test: `tests/web/printquote-v0100-upgrade.test.mjs`

**Interfaces:**

- Produces:
  - `resolveVietQrBankCode(bankName: string | null | undefined): string` & `buildVietQrImageUrl(params: VietQrUrlParams): string` dùng chung cho cả Backend & Frontend trong `packages/contracts/src/vietqr.ts`.
  - `PaymentBankMeta` tùy chọn trong `buildPrintQuoteA4Html` & `ServerA4PdfMeta` (hiển thị ngân hàng nhận thanh toán, số tiền đặt cọc gợi ý 50% / tất toán 100%, nội dung `COC <quoteCode>` và mã QR nếu có).
  - `syncPrintLedgerToFinanceTx(client, params)` trong `ledger-ar-ap-ops.ts` tự động ghi `fin_entries` khi tạo `createCustomerReceiptTx` (`income`, danh mục `'Thu tiền đơn in ấn'`), `createVendorPayoutTx` (`expense`, danh mục `'Chi trả xưởng gia công in'`), và ghi bút toán đảo khi `voidArTransactionTx` / `voidApTransactionTx`.
  - Nút `⧉ Nhân bản` hiển thị trên **mọi** dòng báo giá trong `QuotesListTab` (cả Nháp lẫn Đã chốt) và tự động làm mới đơn giá `vendorPriceItems` mới nhất khi nhân bản.
  - Khung **Mã VietQR thu tiền khách** trực tiếp trong Modal lập phiếu thu & xem nhanh công nợ trên `ReceivablesTab.tsx`.

- [x] **Step 1: Viết bài test `tests/web/printquote-v0100-upgrade.test.mjs` kiểm tra VietQR URL/PDF an toàn khách hàng, Nhân bản làm mới giá danh mục và cấu trúc SQL đồng bộ `fin_entries`**
- [x] **Step 2: Tạo `packages/contracts/src/vietqr.ts` và tích hợp vào `printquote-helpers.ts`, `pdf-renderer.ts`, `PrintQuoteService`, `ReceivablesTab.tsx`**
- [x] **Step 3: Triển khai `syncPrintLedgerToFinanceTx` trong `ledger-ar-ap-ops.ts` (có `SAVEPOINT` + `ON CONFLICT (workspace_id, owner_user_id, operation_key) DO NOTHING`)**
- [x] **Step 4: Nâng cấp `handleCloneQuoteAsNew` trong `PrintQuoteScreen.tsx` & mở nút `⧉ Nhân bản` cho mọi trạng thái trên `QuotesListTab.tsx`**
- [x] **Step 5: Nâng version `0.10.0`, chạy test + build + kiểm thử thực tế trên Staging, rồi commit**

---

### Phase 3 (`v0.10.1`): Tối Ưu Tải 4G (Chia Nhỏ Chunk `PrintQuote` & Modal `Storage`) & Mở Rộng Phân Trang API

**Files:**

- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/screens/PrintQuoteScreen.tsx`
- Create: `apps/web/src/screens/storage/StorageDriveOAuthModal.tsx`
- Modify: `apps/web/src/screens/StorageScreen.tsx`
- Modify: `apps/api/src/work/service.ts`, `apps/api/src/app.ts`
- Modify: `apps/api/src/printquote/service.ts`, `apps/api/src/routes/printquote-routes.ts`
- Modify: `scripts/perf/ensure-hot-indexes.sql`
- Test: `tests/web/phase3-perf-pagination-v0101.test.mjs`

**Interfaces:**

- Produces:
  - Mỗi chunk JS của `PrintQuote` giảm xuống `< 175 kB` raw (`PrintQuoteScreen`, `printquote-editor`, `printquote-orders`, `printquote-catalogs`) mà vẫn giữ nguyên `100%` tương thích SSR `renderToStaticMarkup`.
  - Tách `StorageDriveOAuthModal` (`React.lazy`) khỏi `StorageScreen.tsx`.
  - Hỗ trợ tham số tùy chọn `?limit=<1..100>&offset=<>=0>` tương thích ngược tuyệt đối trên `GET /api/v1/work-items` và `GET /api/v1/print-quotes/quotes` (trả nguyên mảng cũ khi không truyền `offset`, trả `{ items, total, limit, offset }` hoặc giữ mảng `data` kèm `meta: { total, limit, offset }` chuẩn envelope hệ thống!).

- [x] **Step 1: Viết test `tests/web/phase3-perf-pagination-v0101.test.mjs` kiểm tra giới hạn kích thước chunk `< 195 kB` và hợp đồng phân trang tương thích ngược**
- [x] **Step 2: Cấu hình tách chunk `PrintQuote` trong `vite.config.ts` + `React.lazy` cho `PdfPreviewModal`/`CatalogModalDialog` và tách `StorageDriveOAuthModal.tsx`**
- [x] **Step 3: Mở rộng `offset` + `meta.pagination` tương thích ngược trên `GET /api/v1/work-items` & `GET /api/v1/print-quotes/quotes` + bổ sung chỉ mục nóng trong `ensure-hot-indexes.sql`**
- [x] **Step 4: Nâng version `0.10.1`, chạy `build:web`, `check:bundle`, bộ test phân trang/SSR và commit**

---

### Phase 4 (`v1.0.0`): Mở Rộng Trung Tâm Nhắc Việc Chủ Động (`Action Center`) Trên Dashboard & Chốt Mốc `v1.0.0`

**Files:**

- Modify: `apps/api/src/printquote/service.ts` (hoặc tóm tắt cảnh báo nhẹ trong `/api/v1/print-quotes/stats`)
- Modify: `apps/web/src/screens/DashboardScreen.tsx`
- Modify: `package.json`, `packages/contracts/src/version.ts`, `packages/contracts/src/release-notes-catalog.ts`, `AGENTS.md`, `PROJECT_STATUS.md`, `docs/ROADMAP.md`
- Test: `tests/web/dashboard-v100-action-center.test.mjs`

**Interfaces:**

- Produces:
  - Cảnh báo chủ động trong `Action Center` trên `/dashboard` cho Owner (chỉ hiện khi thực sự có mục cần xử lý, không gây rối khi = 0):
    1. `action-center-printquote-alerts`: Đơn in cần giao / Công nợ khách hàng ngành in còn tồn đọng chờ thu (`/print-quotes/receivables` hoặc `/print-quotes/orders`).
    2. `action-center-accounts-health`: Tài khoản dùng chung có trạng thái cần kiểm tra (`checkpoint` / `die` / `warning`) dẫn thẳng tới `/accounts`.
  - Chốt phiên bản `v1.0.0` đồng bộ toàn hệ thống, vượt qua toàn bộ cổng kiểm thử (`format:check`, `typecheck`, `lint`, `build`, `build:web`, `check:bundle`, `test:security`, E2E trình duyệt trên Staging) và đẩy nhánh `feat/roadmap-v1-upgrade-20261114` lên GitHub.

- [x] **Step 1: Viết test `tests/web/dashboard-v100-action-center.test.mjs` cho 2 thẻ nhắc việc mới trên `DashboardScreen`**
- [x] **Step 2: Triển khai nhắc việc Đơn in / Công nợ phải thu & Sức khỏe tài khoản trên `DashboardScreen.tsx` (Owner-only, fail-safe không chặn tải trang)**
- [x] **Step 3: Nâng version `1.0.0`, cập nhật `RELEASE_NOTES_CATALOG`, `AGENTS.md`, `PROJECT_STATUS.md`, `docs/ROADMAP.md`**
- [x] **Step 4: Chạy toàn bộ cổng kiểm chứng (`verification-before-completion`), kiểm thử E2E trực tiếp trên Staging `:4001`, commit & push lên `origin/feat/roadmap-v1-upgrade-20261114`**
