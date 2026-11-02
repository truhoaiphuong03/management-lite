# Hệ Sinh Thái Quản Lý Tài Khoản Đa Tầng (ACC-ECOSYSTEM v0.6.0) Implementation Plan

> **For agentic workers:** Implement this plan task-by-task following V4 Governance & Surgical Read Rules (only after Owner approval; never re-read unrelated modules; verify each task before completion). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng cấp phân hệ Quản lý Tài khoản (`/accounts` & `/accounts/:id`) thành Hệ sinh thái Liên kết 4 Tầng (`Số điện thoại/SIM ➔ Gmail gốc ➔ TikTok / Facebook / YouTube` + `Google Authenticator` + `Tài khoản Khôi phục`) kèm Tra cứu 2 chiều 360°, tự sinh mã 6 số 2FA (TOTP), lưu lịch sử mật khẩu cũ và giao diện 4 góc nhìn trực quan.

**Architecture:** Mở rộng additive trên PostgreSQL (`migration 0031_accounts_ecosystem_hierarchy.sql`) giữ tương thích ngược 100% với bảng `managed_accounts`, `account_secrets`, `contact_points`, `account_contact_links`, `account_relationships`. Toàn bộ bí mật (`password`, `two_fa_secret`, `totp_secret`, `email_password`, `recovery_code`) tiếp tục mã hóa AEAD `AES-256-GCM` (C05 / SEC-02) và bổ sung bảng `account_secret_history` (append-only khi xoay vòng mật khẩu). Giao diện tách logic tính toán cây liên kết, bộ lọc 360° và bộ sinh mã TOTP 6 số sang `apps/web/src/screens/helpers/accounts-helpers.ts` để giữ `AccountsScreen.tsx` gọn, rõ và bảo toàn tuyệt đối các test bảo mật `ACC-005`/`ACC-006`.

**Tech Stack:** TypeScript, Node.js HTTP (`RouteTable`), PostgreSQL (`pg`), React 18, Web Crypto API / Node `crypto` (`AES-256-GCM`, `HMAC-SHA1` RFC 6238 TOTP).

**Spec:** Bản đặc tả được Owner phê duyệt trực tiếp trong hội thoại ngày `2026-10-31` (tích hợp ngay trong mục **1. Đặc tả Nghiệp vụ & Bản đồ File Phẫu thuật** bên dưới để không bao giờ phải đọc lại toàn bộ source code).

---

## Global Constraints & Existing Test Invariants (BẮT BUỘC GIỮ NGUYÊN — CẤM LÀM GÃY)

1. **Tương thích ngược `status` và `ManagedAccountData`:**
   - Trường `status` của `managed_accounts` bắt buộc giữ `'active' | 'archived'`. Trạng thái sức khỏe thực tế (`'healthy' | 'verify_required' | 'locked'`) lưu ở cột mới `health_status` (mặc định `'healthy'`).
   - `ManagedAccountData` trong `packages/contracts/src/accounts.ts` **TUYỆT ĐỐI KHÔNG** được có bất kỳ thuộc tính nào mang tên `secret` hoặc `password` (test regex `/export interface ManagedAccountData[\s\S]*?(secret|password):/` trong `tests/web/accounts-screen.test.mjs:210-214` sẽ fail nếu vi phạm!).
2. **Bảo toàn các chuỗi kiểm thử tĩnh trong `apps/web/src/screens/AccountsScreen.tsx` (`tests/web/accounts-screen.test.mjs`):**
   - Không được xuất hiện chuỗi `account.secret`, `account.password`, `account.plaintext` trong `AccountsScreen.tsx` (kể cả trong comment!).
   - Phải giữ nguyên các chuỗi/biểu thức sau trong `AccountsScreen.tsx`:
     - `role !== 'owner'`, `'403 Forbidden'`, `'Chỉ Chủ sở hữu (Owner) mới có quyền truy cập'`
     - `'C05 Secret Vault'`, `'SEC-02'`, `'/api/v1/auth/reauth'`, `'secret_reveal'`, `'secret_write'`, `'reauth_proof'`
     - `setRevealCountdown(30)`, `'tự động ẩn sau 30 giây'`, `setRevealedSecret(null)`, `revealDeadlineRef`, `Date.now() + 30000`
     - `document.visibilityState === 'hidden'`, `addEventListener('visibilitychange'`, `e.key === 'Escape'`, `closeRevealModal()`, `addEventListener('keydown'`
     - `<ActionIconButton`, `<Pagination`, `'Xem pass'`, `'Xem mật khẩu'`, `'Xem mã 2FA'`, `'Xem pass Email'`, `handleArchiveAccount`
     - `data-testid="filter-account-group"`, `data-testid="filter-account-assignee"`, `data-testid="accounts-pager"`
3. **Quy tắc giao diện & A11y (`Phase UI-0..UI-5`):**
   - Mọi màu sắc dùng biến CSS theme (`var(--surface-subtle)`, `var(--text-color)`, `var(--accent-text)`...), cỡ chữ $\ge 12\text{px}$, dùng ký tự `…` thay cho `...`, mọi `input`/`select` có `aria-label` hoặc `<label>`, không tràn ngang ở khung nhìn điện thoại `320px`.

---

## Review Focus (5 Tình huống Thực tế Dễ Lỗi Nhất Cần Kiểm Thử Chặt)

1. **Nhập SĐT theo nhiều kiểu định dạng khác nhau (`0901 234 567`, `+84901234567`, `0901.234.567`):** Phải tự động chuẩn hóa về `0901234567` để đếm đúng số lượng Gmail trên cùng 1 SĐT (`phone_gmail_count`), không bị tách thành 3 SĐT khác nhau.
2. **Tra cứu 2 chiều 360° khi chỉ nhập `ID TikTok` (hoặc UID / FB / YTB):** Khi tìm `@shop01_tiktok`, kết quả cụm (`buildAccountClusters`) phải trả về cả **Gmail gốc** của kênh đó, **các kênh anh em (FB/YTB)** chung Gmail gốc, **SĐT**, **GG Authenticator** và **Tài khoản khôi phục** (ngay cả khi tên Gmail gốc không chứa chữ `tiktok`).
3. **Chặn vòng lặp liên kết cha-con (`Self-link / Cycle Prevention`):** Một tài khoản không được chọn chính nó làm `parent_account_id`, `recovery_account_id`, hoặc `authenticator_account_id` (`400 VALIDATION_ERROR`).
4. **Sinh mã 6 số 2FA (`computeTotpCode`) từ chuỗi Base32 có khoảng trắng hoặc chữ thường:** Khi người dùng copy khóa 2FA từ Google dạng `jbsw y3dp ehpk 3pxp`, hàm `computeTotpCode` phải tự loại bỏ khoảng trắng, viết hoa và sinh đúng mã 6 chữ số RFC 6238 mà không ném lỗi.
5. **Giữ lại lịch sử mật khẩu cũ khi cập nhật (`PUT /api/v1/accounts/:id/secrets`):** Khi ghi đè mật khẩu mới, bản mã (`ciphertext`, `nonce`, `auth_tag`, `secret_version`) cũ phải được lưu vào `account_secret_history` trước khi cập nhật `account_secrets`, và không làm lộ plaintext khi chưa `reauth`.

---

## 🗺️ Bản đồ File Phẫu thuật (`SURGICAL FILE MAP` — Chỉ đọc đúng các file & dòng này khi làm Phase 20)

| File                                               | Dòng cần đọc / sửa                            | Trách nhiệm trong Phase 20 (`v0.6.0`)                                                                                                                                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/database/src/migrations/catalog.ts`      | `1800–1963`                                   | Thêm `ACCOUNTS_ECOSYSTEM_HIERARCHY_SQL` (`0031_accounts_ecosystem_hierarchy`) mở rộng `platform`, thêm `phone_number`, `phone_note`, `parent_account_id`, `recovery_account_id`, `authenticator_account_id`, `health_status` và bảng `account_secret_history`.                       |
| `packages/contracts/src/accounts.ts`               | `1–99` (toàn file ngắn)                       | Mở rộng `AccountPlatform` (`facebook`, `youtube`, `authenticator`, `recovery`), thêm `AccountHealthStatus`, mở rộng `ManagedAccountData`, `CreateAccountRequest`, `UpdateAccountRequest`, `PhoneClusterSummary`, `SecretHistoryEntry`.                                               |
| `apps/api/src/accounts/service.ts`                 | `35–120`, `415–1000`, `1200–1476`             | Hỗ trợ các trường liên kết mới trong `listAccounts`, `getAccount`, `createAccount`, `updateAccount`; tự động lưu `account_secret_history` trong `putAccountSecret`; hỗ trợ giải mã lịch sử mật khẩu trong `revealAccountSecret` & tạo nhanh kênh con (`create_child_platforms`).     |
| `apps/api/src/routes/accounts-routes.ts`           | `66–130`, `180–231`                           | Mở rộng `assertAllowedFields` cho `POST /api/v1/accounts`, `PATCH /api/v1/accounts/:id`, và `POST /api/v1/accounts/:id/secrets/reveal` (hỗ trợ `history_id` tùy chọn).                                                                                                               |
| `apps/web/src/screens/helpers/accounts-helpers.ts` | `1–56` (toàn file ngắn)                       | Thêm cấu hình màu/nhãn cho `facebook`, `youtube`, `authenticator`, `recovery`; thêm hàm chuẩn hóa SĐT `normalizeVnPhone`, bộ gom cụm & tra cứu 2 chiều 360° `filterAndBuildAccountEcosystem`, bộ tính thống kê SĐT `buildPhoneSummaries`, và hàm sinh mã 6 số 2FA `computeTotpCode`. |
| `apps/web/src/screens/AccountsScreen.tsx`          | `80–160`, `460–750`, `1010–1560`, `1650–2660` | Thiết kế lại giao diện `/accounts` (4 Tab góc nhìn: Cụm Gmail, Theo SĐT, Theo Authenticator/Khôi phục, Bảng phẳng; Thanh tra cứu 360°; Modal Thêm/Sửa thông minh + Tạo nhanh Cụm + Dán hàng loạt; Hiển thị mã 6 số 2FA trực tiếp & Lịch sử mật khẩu cũ).                             |
| `tests/web/accounts-screen.test.mjs`               | `1025–1064`                                   | Thêm bộ test kiểm thử đầy đủ Phase 20 (`ACC-ECOSYSTEM-v060`).                                                                                                                                                                                                                        |

---

### Task 20.1: Database Migration `0031` & Shared Contracts (`packages/database` + `packages/contracts`)

**Files:**

- Modify: `packages/database/src/migrations/catalog.ts:1800-1963`
- Modify: `packages/contracts/src/accounts.ts:1-99`
- Test: `tests/web/accounts-screen.test.mjs`

**Interfaces:**

- Produces in `packages/contracts/src/accounts.ts`:
  ```ts
  export type AccountPlatform =
    | 'tiktok'
    | 'gmail'
    | 'facebook'
    | 'youtube'
    | 'authenticator'
    | 'recovery'
    | 'ai'
    | 'pm'
    | 'other';

  export type AccountHealthStatus = 'healthy' | 'verify_required' | 'locked';

  export interface LinkedAccountSummary {
    id: string;
    platform: AccountPlatform;
    username: string | null;
    platform_account_id: string | null;
    status: AccountStatus;
    health_status?: AccountHealthStatus;
  }

  export interface PhoneUsageSummary {
    phone_number: string;
    phone_note: string | null;
    gmail_count: number;
    total_count: number;
    accounts: LinkedAccountSummary[];
  }

  export interface SecretHistoryMetadata {
    id: string;
    secret_type: AccountSecretType;
    secret_version: number;
    archived_at: string;
  }
  ```
- Extends `ManagedAccountData` (without any property named `secret` or `password`):
  - `health_status?: AccountHealthStatus;`
  - `phone_number?: string | null;`
  - `phone_note?: string | null;`
  - `phone_gmail_count?: number;`
  - `phone_total_count?: number;`
  - `parent_account_id?: string | null;`
  - `parent_account_username?: string | null;`
  - `parent_account_platform?: AccountPlatform | null;`
  - `recovery_account_id?: string | null;`
  - `recovery_account_username?: string | null;`
  - `authenticator_account_id?: string | null;`
  - `authenticator_account_username?: string | null;`
  - `child_accounts?: LinkedAccountSummary[];`
- Extends `ManagedAccountDetailData`:
  - `secret_history?: SecretHistoryMetadata[];`
  - `protected_accounts?: LinkedAccountSummary[];` (các tài khoản đang dùng nick này làm Recovery hoặc Authenticator)
  - `same_phone_accounts?: LinkedAccountSummary[];` (các tài khoản cùng SĐT)
- Extends `CreateAccountRequest` & `UpdateAccountRequest`:
  - `health_status?: AccountHealthStatus;`
  - `phone_number?: string | null;`
  - `phone_note?: string | null;`
  - `parent_account_id?: string | null;`
  - `recovery_account_id?: string | null;`
  - `authenticator_account_id?: string | null;`
  - `create_child_platforms?: AccountPlatform[];` (chỉ trong `CreateAccountRequest` để tạo nhanh cụm kênh con TikTok/FB/YTB cùng lúc với Gmail gốc)

- [ ] **Step 1: Add migration `0031_accounts_ecosystem_hierarchy` in `packages/database/src/migrations/catalog.ts`**
  - Update `managed_accounts_platform_check` to allow `'tiktok', 'gmail', 'facebook', 'youtube', 'authenticator', 'recovery', 'ai', 'pm', 'other'`.
  - Add columns to `managed_accounts`:
    - `health_status text NOT NULL DEFAULT 'healthy' CHECK (health_status IN ('healthy', 'verify_required', 'locked'))`
    - `phone_number text NULL`
    - `phone_note text NULL`
    - `parent_account_id uuid NULL`
    - `recovery_account_id uuid NULL`
    - `authenticator_account_id uuid NULL`
  - Add composite foreign keys `(parent_account_id, workspace_id)`, `(recovery_account_id, workspace_id)`, `(authenticator_account_id, workspace_id)` referencing `managed_accounts(id, workspace_id) ON DELETE SET NULL`, plus self-link check constraints (`parent_account_id IS DISTINCT FROM id`, etc.) and indexes on `(workspace_id, phone_number)` and `(workspace_id, parent_account_id)`.
  - Create table `account_secret_history` (`id`, `workspace_id`, `account_id`, `secret_type`, `ciphertext`, `nonce`, `auth_tag`, `key_version`, `encryption_schema_version`, `secret_version`, `archived_at`) with `FOREIGN KEY (account_id, workspace_id) REFERENCES managed_accounts(id, workspace_id) ON DELETE RESTRICT`.

- [ ] **Step 2: Update `packages/contracts/src/accounts.ts` with the extended types and DTOs**
  - Ensure `ManagedAccountData` has zero fields matching `(secret|password):`.

---

### Task 20.2: Backend Accounts Service & Routes (`apps/api/src/accounts/service.ts` + `apps/api/src/routes/accounts-routes.ts`)

**Files:**

- Modify: `apps/api/src/accounts/service.ts:35-120`, `415-1000`, `1200-1476`
- Modify: `apps/api/src/routes/accounts-routes.ts:66-130`, `180-231`
- Test: `tests/backend/phase20-accounts-ecosystem.test.mjs`

**Interfaces:**

- Consumes: `CreateAccountRequest`, `UpdateAccountRequest`, `ManagedAccountData`, `ManagedAccountDetailData` from Task 20.1.
- Produces:
  - `normalizeAccountPhone(raw: unknown): string | null` in `apps/api/src/accounts/service.ts` (converts `+84...`, spaces, dots, dashes into canonical digits e.g. `0901234567`).
  - `listAccounts` returns enriched `items` with `phone_number`, `phone_note`, `phone_gmail_count`, `phone_total_count`, `parent_account_id`, `parent_account_username`, `recovery_account_id`, `recovery_account_username`, `authenticator_account_id`, `authenticator_account_username`, `child_accounts`, and `phone_summaries: PhoneUsageSummary[]`.
  - `createAccount` supports optional `create_child_platforms?: AccountPlatform[]` (when creating a `gmail` account, automatically creates linked child `tiktok`/`facebook`/`youtube` accounts inheriting `parent_account_id`, `phone_number`, `recovery_account_id`, `authenticator_account_id`, and `assigned_employee_id`).
  - `putAccountSecret` archives the existing row from `account_secrets` into `account_secret_history` before overwriting `account_secrets`.
  - `revealAccountSecret` accepts optional `history_id?: string` in `RevealAccountSecretRequest` to decrypt a historical secret from `account_secret_history` using the same single-use `reauth_proof`.

- [ ] **Step 1: Implement phone normalization, hierarchy joins, and phone counters in `AccountsService`**
  - In `ALLOWED_PLATFORMS`, include `'facebook'`, `'youtube'`, `'authenticator'`, `'recovery'`.
  - In `createAccount` and `updateAccount`, validate that `parent_account_id`, `recovery_account_id`, and `authenticator_account_id` (when provided) exist in the same `workspace_id` and are not equal to the account's own `id`. Also sync `contact_points` / `account_contact_links` for `phone_number`.
  - In `putAccountSecret`, copy the existing `account_secrets` row (if any) into `account_secret_history` within the same transaction before upserting the new ciphertext.

- [ ] **Step 2: Update `apps/api/src/routes/accounts-routes.ts` allowed fields**
  - Add `'health_status'`, `'phone_number'`, `'phone_note'`, `'parent_account_id'`, `'recovery_account_id'`, `'authenticator_account_id'`, `'create_child_platforms'` to `POST /api/v1/accounts` and `PATCH /api/v1/accounts/:id`.
  - Add `'history_id'` to `POST /api/v1/accounts/:id/secrets/reveal`.

- [ ] **Step 3: Write and run `tests/backend/phase20-accounts-ecosystem.test.mjs`**
  - Verify phone normalization (`+84 901.234.567` ➔ `0901234567`), self-link rejection, 1 phone ➔ 5 Gmail counter, parent Gmail ➔ TikTok/FB/YTB child creation, and secret history preservation.

---

### Task 20.3: Frontend Ecosystem Helpers, 360° Bidirectional Lookup & Live 2FA TOTP (`apps/web/src/screens/helpers/accounts-helpers.ts`)

**Files:**

- Modify: `apps/web/src/screens/helpers/accounts-helpers.ts:1-56`
- Test: `tests/web/accounts-screen.test.mjs`

**Interfaces:**

- Produces in `apps/web/src/screens/helpers/accounts-helpers.ts`:
  - `PLATFORM_CONFIG` updated with `facebook`, `youtube`, `authenticator`, `recovery`.
  - `normalizeVnPhone(input: string): string`
  - `filterAccounts360(accounts: ManagedAccountData[], query: string): { matchedIds: Set<string>; includedClusterIds: Set<string>; visibleAccounts: ManagedAccountData[] }`:
    - Bidirectional 360° graph traversal: if any account matches `query` (by username, UID, TikTok ID, phone number, phone note, recovery email, parent username, authenticator username, or child username), automatically includes its **parent Gmail**, **all sibling channels** under that Gmail, **its recovery & authenticator accounts**, and **all child accounts**!
  - `buildGmailClusters(accounts: ManagedAccountData[])`: groups root Gmail accounts with their attached TikTok/FB/YTB children + standalone accounts.
  - `buildPhoneClusters(accounts: ManagedAccountData[])`: groups accounts by `phone_number`, counting `gmail_count` (highlighting warning badge when `gmail_count >= 4`), `social_count`, and `phone_note` (SIM location).
  - `buildProtectionClusters(accounts: ManagedAccountData[])`: groups accounts by `authenticator_account_id` and `recovery_account_id` / `recovery_email`.
  - `computeTotpCode(secretBase32: string, timestampMs?: number): Promise<{ code: string; remainingSeconds: number } | null>`: pure RFC 6238 `HMAC-SHA1` 6-digit TOTP generator using Web Crypto (`crypto.subtle`) so the user sees the live 6-digit code (`123 456`) right in the UI!

- [ ] **Step 1: Implement `normalizeVnPhone`, `filterAccounts360`, `buildGmailClusters`, `buildPhoneClusters`, `buildProtectionClusters`, and `computeTotpCode` in `apps/web/src/screens/helpers/accounts-helpers.ts`**
- [ ] **Step 2: Add unit tests in `tests/web/accounts-screen.test.mjs` testing `filterAccounts360` (searching TikTok ID returns parent Gmail + sibling FB/YTB + SĐT + Authenticator + Recovery) and `computeTotpCode` (RFC 6238 test vector)**

---

### Task 20.4: Redesign `AccountsScreen.tsx` (4 View Tabs, 360° Search, Smart Modal, Live 2FA & Bulk Paste)

**Files:**

- Modify: `apps/web/src/screens/AccountsScreen.tsx:80-160`, `460-750`, `1010-1560`, `1650-2660`
- Test: `tests/web/accounts-screen.test.mjs`

**Interfaces:**

- Consumes: helpers from `apps/web/src/screens/helpers/accounts-helpers.ts`.
- UI Features to deliver while keeping all existing `data-testid` and security guards intact:
  1. **Thanh Tìm kiếm Truy vết 2 chiều 360° (`data-testid="search-accounts-360"`):**
     - Khi nhập `ID TikTok`, `UID`, `SĐT`, hoặc `Gmail`, hiển thị băng thông báo kết quả truy vết: _"🔍 Truy vết 360°: Tìm thấy X kết quả khớp trực tiếp — Đang hiển thị toàn bộ Y tài khoản trong cùng cụm liên kết (Gmail gốc, SĐT, Authenticator, Khôi phục & Kênh đi kèm)"_.
  2. **4 Tab Chế độ Xem (`data-testid="view-mode-tabs"`):**
     - `all` (**📋 Danh sách & Tra cứu** — mặc định tương thích mọi bộ test hiện hữu, nâng cấp cột hiển thị rõ `Gmail gốc`, `SĐT (X Gmail)`, `GG Authenticator`, `TK Khôi phục`, `Trạng thái sức khỏe`, `Nút +Kênh con` và `Copy 1 chạm`)
     - `clusters` (**🌳 Theo Cụm Gmail gốc**: Gom mỗi Gmail gốc thành 1 thẻ lớn, bên trong liệt kê các nhánh `🎵 TikTok`, `📘 Facebook`, `▶️ YouTube`, kèm SĐT, Authenticator, TK Khôi phục và nút **`+ Gắn TikTok / FB / YTB`**)
     - `phones` (**📱 Theo Số điện thoại (`1 SĐT ➔ N Gmail`)**: Hiển thị từng thẻ SĐT kèm vị trí SIM, bộ đếm `X Gmail • Y Kênh MXH`, cảnh báo nếu $\ge 4$ Gmail, và danh sách 5 Gmail + kênh thuộc SĐT đó)
     - `protection` (**🔐 Theo GG Authenticator & TK Khôi phục**: Hiển thị mỗi tài khoản Google Authenticator đang giữ 2FA cho những nick nào, và mỗi Tài khoản Khôi phục đang cứu hộ cho những nick nào)
  3. **Cửa sổ "Thêm / Sửa Tài khoản" Thiết kế lại & Nhập nhanh (`Create / Edit Modal`):**
     - Thanh nút chọn nhanh Loại tài khoản bằng biểu tượng màu (`📧 Gmail`, `🎵 TikTok`, `📘 Facebook`, `▶️ YouTube`, `🔐 GG Authenticator`, `🛟 TK Khôi phục`, `🤖 AI/Khác`) + giữ `<select>` đồng bộ.
     - Khối **Liên kết Hệ sinh thái**:
       - Chọn **🔗 Tài khoản Gmail gốc** (khi tạo TikTok / FB / YTB — tự động kế thừa SĐT, Authenticator, TK khôi phục từ Gmail gốc).
       - Nhập/chọn **📱 Số điện thoại liên kết** (kèm `datalist` gợi ý các SĐT đã có và hiện ngay badge _"SĐT này đang tạo X Gmail"_ + ô **Vị trí SIM / Ghi chú SIM**).
       - Chọn **🔐 Tài khoản Google Authenticator giữ 2FA** & **🛟 Tài khoản dùng để khôi phục**.
       - Khi tạo **Gmail mới**: có hàng checkbox **"⚡ Tạo kèm luôn kênh gắn với Gmail này: `[ ] TikTok` `[ ] Facebook` `[ ] YouTube`"** (`create_child_platforms`).
     - Chế độ chuyển đổi **"📋 Dán nhanh nhiều tài khoản (`email|pass|recovery|2fa|sdt`)"** ngay trong Modal Thêm mới để nhập hàng loạt.
  4. **Trình tạo Mã 6 số 2FA trực tiếp (`Live 6-Digit TOTP`) & Lịch sử Mật khẩu cũ (`Secret History`):**
     - Khi mở khóa xem `2FA Secret`, tự động hiển thị **Mã 6 số đang chạy (`123 456`) + đồng hồ đếm ngược 30s + nút Copy 6 số** bên cạnh chuỗi Secret gốc.
     - Trong trang Chi tiết (`/accounts/:id`), hiển thị danh sách **Lịch sử mật khẩu cũ đã đổi (`secret_history`)** với nút bấm xác thực để xem lại mật khẩu cũ khi cần cứu tài khoản.

- [ ] **Step 1: Update `AccountsScreen.tsx` with the 4 View Mode Tabs, 360° Search banner, redesigned Create/Edit modal, Bulk Paste mode, Live 6-Digit 2FA display, and Secret History viewer**
- [ ] **Step 2: Run `npm run build` and `node --test tests/web/accounts-screen.test.mjs` to verify 0 regressions and all new tests pass**
- [ ] **Step 3: Bump version to `v0.6.0`, update `AGENTS.md`, commit, push to GitHub, and deploy to `https://ql.hoaiphuong.click`**
