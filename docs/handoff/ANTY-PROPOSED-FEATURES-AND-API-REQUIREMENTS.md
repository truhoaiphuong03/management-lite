# ĐỀ XUẤT THIẾT KẾ GIAO DIỆN VÀ HỢP ĐỒNG API CHO TÍNH NĂNG MỚI

**Mã tài liệu:** `ANTY-PROPOSED-FEATURES-AND-API-REQUIREMENTS.md`  
**Người lập:** Anty (Frontend Engineering)  
**Thời gian:** 2026-10-12 20:25 ICT  
**Trạng thái phát hành:** `QA_HOLD` / `RELEASE_HOLD` (Không deploy độc lập, phối hợp đồng bộ với Codex)

---

## 1. MỤC TIÊU VÀ NGUYÊN TẮC

Tài liệu này chuẩn bị thiết kế chi tiết phía Frontend và quy định hợp đồng API giao tiếp Backend cho 4 tính năng mở rộng có giá trị thực tiễn cao nhất theo yêu cầu của Owner:

1. **Xuất báo cáo Excel / CSV (Tài chính & Lương).**
2. **Xuất Nhật ký kiểm toán (Audit Log Export).**
3. **Cấu hình bán kính định vị GPS khi Chấm công (Attendance Geofencing).**
4. **Xác thực 2 yếu tố MFA / TOTP cho Quản trị viên.**

> [!IMPORTANT]
> **Nguyên tắc tuân thủ nghiêm ngặt:** Frontend không tạo mock API tạm bợ trong mã sản phẩm để tuyên bố tính năng đã hoàn tất. Toàn bộ các endpoint và cấu trúc cơ sở dữ liệu dưới đây được chuyển giao cho Codex Backend để thiết kế migration, controller và kiểm thử tích hợp trên môi trường staging trước khi kích hoạt trên giao diện người dùng.

---

## 2. CHI TIẾT ĐỀ XUẤT 4 TÍNH NĂNG MỚI

### 2.1. Tính năng 1: Xuất báo cáo Excel / CSV (Finance & Payroll)

#### A. Trải nghiệm người dùng (UX Flow)

1. Tại `FinanceHistoryScreen` và `PayrollScreen`, bổ sung nút hành động `Xuất dữ liệu` (kèm icon `DownloadIcon`).
2. Khi người dùng click:
   - Hiển thị dialog lựa chọn định dạng (`CSV` hoặc `Excel .xlsx`).
   - Lựa chọn khoảng thời gian (`Tháng này`, `Tháng trước`, hoặc `Tùy chọn: Từ ngày ... Đến ngày ...`).
3. Khi bấm xác nhận xuất:
   - Nút chuyển trạng thái loading và hiển thị `Đang tạo tệp...`.
   - Sử dụng cơ chế streaming tải tệp `blob` qua `fetch`, tự động kích hoạt download trên trình duyệt và dọn dẹp blob URL bằng `URL.revokeObjectURL(url)`.

#### B. Hợp đồng API đề xuất (Gửi Codex)

```http
GET /api/v1/finance/export?format=csv|xlsx&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&category_id=UUID
GET /api/v1/payroll/export?format=csv|xlsx&period_id=UUID
```

- **Headers:** `Cookie: session=...`, `Accept: text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **Response Headers:**
  - `Content-Type: text/csv; charset=utf-8` hoặc `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `Content-Disposition: attachment; filename="finance_export_20261012.csv"`
- **Mã lỗi chuẩn:**
  - `400 Bad Request`: Định dạng không hợp lệ hoặc khoảng thời gian vượt quá 365 ngày.
  - `401 / 403`: Chưa đăng nhập hoặc Staff cố xuất bảng lương tổng của Owner.

---

### 2.2. Tính năng 2: Xuất Nhật ký kiểm toán (Audit Log Export)

#### A. Trải nghiệm người dùng (UX Flow)

1. Tại `AuditScreen` (chỉ dành riêng cho Owner - RBAC-01):
   - Thêm nút `Xuất nhật ký kiểm toán` trên thanh công cụ lọc.
   - Hộp thoại xuất cho phép chọn: Khoảng ngày, Loại hành động (AUTH, ACC, EMP, PAY, v.v.), Định dạng (`NDJSON` hoặc `CSV`).
   - Yêu cầu xác thực quyền Owner (CSRF token).
2. Tệp xuất được gắn mã băm SHA-256 trong header để bảo đảm tính toàn vẹn và bất biến theo tiêu chuẩn `AUDIT-005`.

#### B. Hợp đồng API đề xuất (Gửi Codex)

```http
GET /api/v1/audit/export?format=ndjson|csv&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&action_type=AUTH
```

- **Response Headers:**
  - `Content-Type: application/x-ndjson; charset=utf-8` hoặc `text/csv; charset=utf-8`
  - `X-Audit-Digest: sha256-...` (Checksum bảo đảm tính toàn vẹn)
  - `Content-Disposition: attachment; filename="audit_log_20261012.ndjson"`
- **Bảo mật:** Backend bắt buộc làm sạch (mask/redact) mọi thông tin mật khẩu, token, cipher trước khi xuất.

---

### 2.3. Tính năng 3: Cấu hình bán kính GPS Chấm công (Attendance Geofencing)

#### A. Trải nghiệm người dùng (UX Flow)

1. **Phía Quản trị (`SettingsScreen.tsx`):**
   - Bổ sung nhóm cài đặt `Địa điểm Chấm công & Geofence`:
     - Tọa độ GPS cửa hàng/văn phòng: `Vĩ độ (Latitude)` và `Kinh độ (Longitude)`.
     - Nút `Lấy vị trí hiện tại` sử dụng Geolocation API của trình duyệt để điền nhanh tọa độ.
     - `Bán kính cho phép (mét)`: Slider / Input số từ 20m đến 500m (mặc định 100m).
     - Checkbox: `Bắt buộc định vị khi Chấm công`.
2. **Phía Nhân viên (`ClockScreen.tsx`):**
   - Khi bấm `Vào ca (Clock In)` hoặc `Hết ca (Clock Out)`:
     - Nếu bật Geofence, trình duyệt yêu cầu quyền truy cập vị trí `navigator.geolocation.getCurrentPosition()`.
     - Tính toán khoảng cách theo công thức Haversine ngay trên UI để phản hồi nhanh cho nhân sự:
       - Nếu nằm trong bán kính: Hiển thị badge xanh `Vị trí hợp lệ (~35m)`.
       - Nếu ngoài bán kính: Hiển thị cảnh báo đỏ `Ngoài phạm vi cho phép (~240m > 100m)` và chặn gửi request, hướng dẫn nhân viên đứng gần cửa hàng hơn.

#### B. Hợp đồng API đề xuất (Gửi Codex)

```http
GET /api/v1/settings/attendance-geofence
PUT /api/v1/settings/attendance-geofence
```

**Payload cấu hình:**

```json
{
  "enabled": true,
  "latitude": 10.776889,
  "longitude": 106.700806,
  "radius_meters": 100
}
```

**Payload chấm công cập nhật:**

```json
POST /api/v1/attendance/shifts/clock-in
{
  "latitude": 10.776850,
  "longitude": 106.700810,
  "accuracy_meters": 12.5
}
```

---

### 2.4. Tính năng 4: Xác thực 2 yếu tố MFA / TOTP (Multi-Factor Authentication)

#### A. Trải nghiệm người dùng (UX Flow)

1. **Kích hoạt TOTP (`SettingsScreen.tsx`):**
   - Quản trị viên chọn `Bật xác thực 2 bước (2FA)`.
   - Bước 1: Nhập lại mật khẩu hiện tại.
   - Bước 2: Hiển thị mã QR (chuẩn RFC 6238 `otpauth://totp/...`) để quét bằng Google Authenticator / Microsoft Authenticator / 1Password, kèm chuỗi Base32 nhập tay.
   - Bước 3: Nhập mã 6 chữ số để kích hoạt xác nhận.
   - Bước 4: Hiển thị danh sách 8 mã dự phòng (Backup Recovery Codes) một lần duy nhất, có nút `Sao chép tất cả` và `Tải về`.
2. **Đăng nhập (`LoginScreen.tsx`):**
   - Sau khi nhập username + password thành công, nếu tài khoản đã bật TOTP, API trả về `{ requires_totp: true, challenge_token: "..." }`.
   - Giao diện Login chuyển sang màn hình nhập mã OTP 6 số (hoặc dùng mã phục hồi 8 ký tự).
   - Tự động submit khi nhập đủ 6 số.

#### B. Hợp đồng API đề xuất (Gửi Codex)

```http
POST /api/v1/auth/mfa/totp/setup      -> Sinh secret tạm & QR code URI
POST /api/v1/auth/mfa/totp/enable     -> Xác nhận mã 6 số để bật chính thức
POST /api/v1/auth/mfa/totp/verify     -> Xác thực mã 6 số trong quá trình đăng nhập
POST /api/v1/auth/mfa/totp/disable    -> Tắt 2FA (yêu cầu mật khẩu + OTP)
```

---

## 3. LỘ TRÌNH TRIỂN KHAI PHỐI HỢP VỚI CODEX

1. **Giai đoạn hiện tại (RELEASE_HOLD):**
   - Hoàn tất tài liệu đặc tả và hợp đồng giao diện tại tài liệu này.
   - Đảm bảo toàn bộ 13 module hiện hữu và các bản sửa lỗi (ACC-005, ACC-006, FIN Fake DOM, any lint) đạt 100% PASS và không có bất kỳ regression nào.
2. **Giai đoạn tiếp theo (Sau khi Codex hoàn tất nghiệm thu Windows Staging Stage 7):**
   - Bàn giao 4 hợp đồng API trên cho Codex Backend triển khai các bảng cơ sở dữ liệu và route backend.
   - Anty triển khai components UI tương ứng tích hợp với `packages/ui` và các màn hình hiện có.
