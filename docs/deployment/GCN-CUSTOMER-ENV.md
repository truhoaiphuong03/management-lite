# Cấu hình Môi trường & Google Cloud — Đăng nhập Khách hàng Web (`GCN-CUST-02A`)

> Tài liệu triển khai cấu hình cho phân hệ khách hàng web cô lập (`/api/v1/public/*`).
> **Không ghi giá trị bí mật thật vào Git.** Chỉ cấu hình trên máy chủ khi Owner phê duyệt triển khai.

---

## 1. Biến môi trường cần thiết

| Biến môi trường                | Bắt buộc (Prod)                             | Giá trị mẫu / Mô tả                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`             | Có                                          | OAuth 2.0 Web Client ID tên `"GCN Customer Login"` (dạng `<id>.apps.googleusercontent.com`). **Không cần** Client Secret.                                                                         |
| `PUBLIC_CUSTOMER_WORKSPACE_ID` | Có (thiếu → `/api/v1/public/*` trả `503`)   | UUID của `workspaces.id` sở hữu khách hàng web.                                                                                                                                                   |
| `GCN_PROXY_SECRET`             | Khuyến nghị cao (bắt buộc khi đi qua proxy) | Chuỗi bí mật ngẫu nhiên `>= 32` byte (`openssl rand -hex 32`). API **chỉ** tin header `X-GCN-Client-IP` khi `X-GCN-Proxy-Secret` khớp chính xác (so sánh hằng thời gian `timingSafeEqualTokens`). |
| `PRIVACY_POLICY_VERSION`       | Có (mặc định `2026-04-01`)                  | Phiên bản Chính sách quyền riêng tư được lưu vào `web_customers.consent_version` khi khách mới đồng ý đăng ký.                                                                                    |
| `PUBLIC_SITE_ORIGIN`           | Khuyến nghị                                 | `https://hoaiphuong.click`                                                                                                                                                                        |

### Cập nhật `ALLOWED_ORIGINS` (BẮT BUỘC cho trình duyệt)

Thêm `https://hoaiphuong.click` vào biến `ALLOWED_ORIGINS` hiện có của API (phân tách bằng dấu phẩy, không khoảng trắng thừa):

```env
ALLOWED_ORIGINS=https://ql.hoaiphuong.click,https://hoaiphuong.click
```

- Khi test local với trang chủ (Cloudflare Pages dev): bổ sung thêm `http://localhost:8788` vào `ALLOWED_ORIGINS` của môi trường DEV/TEST.
- Khi test bản Preview Gói 4 (Cloudflare Pages preview URL, ví dụ `https://<hash>.<project>.pages.dev`): chỉ thêm vào môi trường DEV/Staging hoặc đúng danh sách Origin được phép.

### Cô lập Cookie & CSRF

- **Cookie khách hàng:** `__Host-gcn_customer` (production, `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`) / `gcn_customer` (dev).
- **Cookie nhân viên:** `__Host-mglite_session` / `mglite_session`. Hai cõi hoàn toàn tách biệt:
  - Cookie khách hàng gọi các API nội bộ (`/api/v1/accounts`, `/employees`, `/payroll`, `/finance`, `/auth/me`) luôn bị từ chối `401`.
  - Cookie nhân viên gọi `/api/v1/public/auth/me`, `DELETE /api/v1/public/account` luôn bị từ chối `401`.
- **CSRF khách hàng:** Dùng khóa tách miền `CSRF_SECRET + ':customer'`, trả `csrf_token` trong `POST /api/v1/public/auth/google` và `GET /api/v1/public/auth/me`, bắt buộc gửi qua header `X-CSRF-Token` kèm `Origin` hợp lệ cho `POST /api/v1/public/auth/logout` và `DELETE /api/v1/public/account`.

---

## 2. Hướng dẫn Owner bấm tạo OAuth Client trên Google Cloud Console

Dự án Google Cloud đang cấp OAuth Google Drive cho `ql.hoaiphuong.click` có **Project Number: `980505397989`**.

### Bước A — Chọn đúng Dự án Google Cloud

1. Mở trình duyệt và đăng nhập tài khoản Google sở hữu dự án tại: `https://console.cloud.google.com/`
2. Nhấp bộ chọn Project ở góc trên bên trái → tìm và chọn đúng dự án có **Project Number `980505397989`**.

### Bước B — Kiểm tra / Cập nhật Màn hình đồng ý OAuth (Google Auth Platform / OAuth consent screen)

1. Menu trái → **APIs & Services** → **OAuth consent screen** (hoặc **Google Auth Platform → Branding / Data Access** trên giao diện mới).
2. Mục **App information / Branding**:
   - **App name:** `Gà Công Nghệ`
   - **User support email:** chọn email quản trị của Owner
   - **App domain → Privacy policy link:** `https://hoaiphuong.click/chinh-sach-quyen-rieng-tu`
   - **Authorized domains:** đảm bảo có `hoaiphuong.click`
3. Mục **Scopes / Data Access**:
   - Chỉ giữ đúng 3 scope cơ bản không nhạy cảm: `openid`, `email`, `profile` (tuyệt đối không thêm scope Drive/Gmail cho client đăng nhập khách hàng này).
4. Lưu (**Save**). Nếu app đang ở chế độ _Testing_ và cần khách ngoài đăng nhập thật, chuyển trạng thái xuất bản sang **In production** (3 scope `openid`, `email`, `profile` không yêu cầu Google verification phức tạp).

### Bước C — Tạo OAuth 2.0 Client ID mới (`GCN Customer Login`)

1. Menu trái → **APIs & Services** → **Credentials** (hoặc **Google Auth Platform → Clients**).
2. Nhấp **+ Create Credentials** → **OAuth client ID**.
3. **Application type:** chọn **Web application**.
4. **Name:** nhập `GCN Customer Login`.
5. Mục **Authorized JavaScript origins** → bấm **+ Add URI** lần lượt thêm:
   - `https://hoaiphuong.click`
   - `http://localhost:8788`
   - URL Preview của Gói 4 (ví dụ `https://<branch-or-hash>.<ten-pages-project>.pages.dev` sau khi có URL Preview)
6. Mục **Authorized redirect URIs:** để trống (Google Identity Services One Tap / Sign-In button trả thẳng ID Token về frontend, không cần redirect URI hay client secret).
7. Nhấp **Create**.
8. Copy giá trị **Client ID** (`*.apps.googleusercontent.com`) — **không cần copy hay lưu Client Secret** — để nạp vào biến môi trường `GOOGLE_CLIENT_ID` khi triển khai.
