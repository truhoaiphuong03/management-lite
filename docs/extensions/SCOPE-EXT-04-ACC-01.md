# SCOPE-EXT-04: ACC-01 (Quản lý Tài khoản & Bảo mật Bí mật - V0.2 / Canonical C05)

> **Trạng thái:** DRAFT & READY FOR REVIEWER CONFIRMATION (2026-10-09)  
> **Phiên bản:** `0.2.0-ext.04-rev01`  
> **Phụ trách:** Anti (Frontend UI & Shared Contracts), Backend theo phân công  
> **Module Canonical:** `ACC` (Nhãn UI hiển thị: **"Tài khoản ACC"**)  
> **Tuyến đường giao diện:** `/accounts` (UI17) và `/accounts/:id` (UI18)  
> **Nhánh thực hiện:** `feat/v0.2-acc-web`  
> **Baseline:** `b0106ea70c3239eb8aad3e7fcc5af32fd8e88253`

---

## 1. Bối cảnh & Căn cứ Pháp lý Canonical

1. **Khung thẩm quyền Canonical:**
   - `02_MODULE_REGISTRY.md`: Module `ACC` sở hữu các thực thể `managed_accounts`, `account_secrets`, `contact_points`, `account_contact_links`. Phân quyền: **Chủ sở hữu duy nhất (Owner-only)**.
   - `18_SEC02_SECURITY_ARCHITECTURE.md`: Kiến trúc bảo mật cho Managed Account Secrets (SEC-T01, SEC-T05, SEC-T08, SEC-021..SEC-024).
   - `20_DBREADY_TABLES_AND_COLUMNS.md`: Cấu trúc dữ liệu chuẩn cho `managed_accounts`, `account_secrets`, `secret_access_events`.
   - `25_APIREADY_ENDPOINT_MATRIX.md`: Danh mục endpoint chuẩn của `ACC`.
   - `36_APISYNC_NORMATIVE_CONTRACTS.md`: Hợp đồng chuẩn tắc C05 cho Secret Write & Reveal kèm xác thực lại (Reauth).
   - `45_UIREVIEW_SCREEN_AND_ROUTE_MATRIX.md`: Định tuyến giao diện chuẩn `UI17 (/accounts)` và `UI18 (/accounts/:id)`.

2. **Mục tiêu Nghiệp vụ:**
   - Cung cấp cho Chủ shop (Owner) công cụ quản trị tập trung các tài khoản dịch vụ quan trọng phục vụ kinh doanh: **TikTok, Gmail / Google, AI / LLM (OpenAI, Claude, v.v.), PM / Quản lý dự án (Trello, Jira, Notion, v.v.)** và các nền tảng khác.
   - Bảo vệ tuyệt đối bí mật đăng nhập (Mật khẩu, API Key, Mã khôi phục) bằng cơ chế mã hóa và giao thức xác thực lại theo lớp (Defense in Depth).

---

## 2. Nguyên tắc Bảo mật Bất khả xâm phạm (Security Invariants)

1. **Owner-Only & Chặn tuyệt đối Nhân viên (Staff 403 Forbidden):**
   - Chỉ có tài khoản có vai trò `owner` mới được xem danh sách, chi tiết, hoặc thao tác với tài khoản và secret.
   - Nhân viên (`staff`) tuyệt đối không có quyền xem metadata hoặc secret, cả ở tầng giao diện UI lẫn API Backend (tự động chặn 403 Forbidden).

2. **Không để lộ Secret trong danh sách hay metadata:**
   - `GET /api/v1/accounts` và `GET /api/v1/accounts/:id` **TUYỆT ĐỐI KHÔNG BAO GIỜ** trả về mật khẩu hay secret dạng plaintext trong response.
   - Không ghi mật khẩu vào `console.log`, analytics, telemetry, log file hoặc error response.
   - Không lưu trữ mật khẩu trong `localStorage`, `sessionStorage`, cookies hoặc browser cache.

3. **Giao thức Xác thực lại Phân vùng (Action-Bound Reauthentication):**
   - Việc xem (`reveal`) hoặc cập nhật (`write`) mật khẩu bắt buộc phải trải qua bước xác thực lại mật khẩu đăng nhập của Owner (`POST /api/v1/auth/reauth`).
   - Bằng chứng xác thực (`reauth_proof`):
     - Có thời hạn ngắn (tối đa 5 phút).
     - Ràng buộc chặt chẽ với: Session hiện tại, Người dùng (Owner), Hành động cụ thể (`secret_reveal` hoặc `secret_write`), và Tài khoản cụ thể (`account_id`).
     - **Sử dụng duy nhất 1 lần (Single-use):** Tiêu thụ ngay lập tức trong transaction thực hiện; không thể tái sử dụng.
   - Phản hồi chứa secret (`POST /api/v1/accounts/:id/secrets/reveal`):
     - Gửi kèm header `Cache-Control: no-store`.
     - Phía Client: Chỉ lưu tạm thời trong React state nội bộ của component; tự động xóa sạch khi người dùng đóng modal, hết thời gian đếm ngược (countdown), hoặc chuyển trang.

4. **Bảo toàn Dữ liệu & Không Xóa Cứng (No Hard Deletion):**
   - Khi không còn sử dụng tài khoản, Owner thực hiện Lưu trữ (`archive`).
   - Hành động lưu trữ chỉ chuyển `status` sang `archived`, giữ nguyên dữ liệu và lịch sử kiểm toán (Audit Trail); cho phép Khôi phục (`restore`) khi cần.

---

## 3. Danh mục Hợp đồng API Chuẩn (`API-ACC-01` -> `API-ACC-07` & `API-AUTH-REAUTH`)

### `API-AUTH-REAUTH`: `POST /api/v1/auth/reauth`

- **Mục đích:** Xác thực lại danh tính Owner cho hành động nhạy cảm với tài khoản.
- **Phân quyền:** Owner-only.
- **Body:**
  ```json
  {
    "password": "string",
    "action": "secret_reveal | secret_write",
    "account_id": "uuid"
  }
  ```
- **Phản hồi (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "reauth_proof": "csprng_token_string",
      "expires_at": "2026-10-09T11:15:00.000Z"
    },
    "meta": { "request_id": "uuid" }
  }
  ```

### `API-ACC-01`: `GET /api/v1/accounts`

- **Mục đích:** Lấy danh sách tài khoản quản lý (chỉ metadata).
- **Phân quyền:** Owner-only.
- **Query params:** `platform` (lọc theo nền tảng), `status` (`active` | `archived` | `all`), `search` (từ khóa).
- **Phản hồi (200 OK):** Danh sách tài khoản kèm phiên bản version, không bao gồm secret.

### `API-ACC-02`: `POST /api/v1/accounts`

- **Mục đích:** Tạo mới tài khoản quản lý.
- **Phân quyền:** Owner-only.
- **Headers:** `X-CSRF-Token`.
- **Body:**
  ```json
  {
    "platform": "tiktok | gmail | ai | pm | other",
    "username": "duongbinh_shop",
    "platform_account_id": "123456789",
    "notes": "Tài khoản kênh chính"
  }
  ```

### `API-ACC-03`: `GET /api/v1/accounts/:id`

- **Mục đích:** Xem chi tiết tài khoản (metadata và danh sách loại secret đã cấu hình, không trả về giá trị secret).
- **Phân quyền:** Owner-only.

### `API-ACC-04`: `PATCH /api/v1/accounts/:id`

- **Mục đích:** Cập nhật thông tin tài khoản (username, platform_account_id, notes).
- **Phân quyền:** Owner-only.
- **Headers:** `If-Match: "<version>"`, `X-CSRF-Token`.

### `API-ACC-05`: `POST /api/v1/accounts/:id/archive` & `POST /api/v1/accounts/:id/restore`

- **Mục đích:** Lưu trữ hoặc khôi phục tài khoản quản lý.
- **Phân quyền:** Owner-only.
- **Headers:** `If-Match: "<version>"`, `X-CSRF-Token`.

### `API-ACC-06`: `PUT /api/v1/accounts/:id/secrets`

- **Mục đích:** Cập nhật mật khẩu hoặc secret mới cho tài khoản.
- **Phân quyền:** Owner-only.
- **Headers:** `If-Match: "<account_version>"`, `X-CSRF-Token`.
- **Body:**
  ```json
  {
    "secret_type": "password",
    "secret_value": "NewStrongSecret#2026",
    "reauth_proof": "csprng_token_string"
  }
  ```
- **Phản hồi (200 OK):** `{ "secret_version": 2, "updated_at": "..." }` (không trả về secret).

### `API-ACC-07`: `POST /api/v1/accounts/:id/secrets/reveal`

- **Mục đích:** Xem mật khẩu / secret của tài khoản sau khi đã xác thực lại.
- **Phân quyền:** Owner-only.
- **Headers:** `X-CSRF-Token`.
- **Body:**
  ```json
  {
    "secret_type": "password",
    "reauth_proof": "csprng_token_string"
  }
  ```
- **Phản hồi (200 OK):**
  - Headers: `Cache-Control: no-store`.
  - Body: `{ "secret_value": "PlainTextSecretHere" }`.

---

## 4. Đặc tả Giao diện Người dùng (UI-ACC-01 / UI17 & UI18)

1. **Khóa 2 tuyến đường URL chuẩn:**
   - `/accounts`: Danh sách tài khoản, bộ lọc, thẻ KPI tổng quan, nút thêm tài khoản mới.
   - `/accounts/:id`: Màn hình chi tiết tài khoản, quản lý mật khẩu/secret, lưu trữ và khôi phục.
2. **Giao diện thích ứng theo Vai trò (RBAC):**
   - **Owner:** Toàn quyền truy cập, hiển thị đầy đủ giao diện quản lý.
   - **Staff:** Bị chặn ngay từ tầng điều hướng (Sidebar ẩn mục này) và trang hiển thị thông báo cấm truy cập (`403 Forbidden`).
3. **Modal Xác thực lại Mật khẩu (Reauth Modal):**
   - Rõ ràng, an toàn, yêu cầu Owner nhập lại mật khẩu tài khoản đang đăng nhập.
   - Hiển thị rõ mục đích xác thực: _"Xác thực lại để xem mật khẩu"_ hoặc _"Xác thực lại để cập nhật bí mật"_.
   - Tự động xóa thông tin sau khi dùng.
4. **Bộ đếm thời gian hiển thị Mật khẩu (Auto-hide Countdown):**
   - Khi xem mật khẩu thành công: hiển thị ô mật khẩu kèm nút Sao chép, nút Ẩn, và thanh đếm lùi thời gian (ví dụ 60 giây).
   - Khi hết thời gian hoặc người dùng đóng modal: xóa ngay giá trị mật khẩu khỏi bộ nhớ.
