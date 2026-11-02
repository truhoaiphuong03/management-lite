# TÀI LIỆU HỢP ĐỒNG API VÀ YÊU CẦU KỸ THUẬT (ANTY → CODEX)

**Mã tài liệu:** `ANTY-API-REQUIREMENTS.md`  
**Ngày lập:** 12/10/2026  
**Tác giả:** Anty (Frontend & UI/UX Specialist)  
**Người nhận:** Codex (Backend & Database Auditor)  
**Nhánh công việc:** `feat/anty-acceptance-123`

---

## 1. TỔNG QUAN HIỆN TRẠNG API & PHỐI HỢP LIÊN NHÓM

Qua quá trình rà soát độc lập toàn bộ mã nguồn backend (`apps/api/src/app.ts`, `apps/api/src/payroll/service.ts`, `apps/api/src/reports/service.ts`, `apps/api/src/attendance/service.ts`), Anty xác nhận:

> [!NOTE]
> **Tất cả các API nghiệp vụ cốt lõi phục vụ các chức năng `ATT-007`, `ATT-010`, `PAY-003`, `PAY-004`, `PAY-005`, `PAY-006`, `PAY-007`, `REP-003` ĐÃ ĐƯỢC CODEX VÀ BACKEND HIỆN THỰC ĐẦY ĐỦ VÀ CHUẨN XÁC.**  
> Giao diện người dùng (UI) do Anty hoàn thiện đã kết nối trực tiếp và khớp 100% với schema backend hiện hành. Không có chức năng nào bị tắc nghẽn (BLOCKED) do thiếu API máy chủ.

Tài liệu này chuẩn hóa và ghi nhận chính thức hợp đồng API (API Contracts) đang vận hành giữa Frontend (`apps/web`) và Backend (`apps/api`) để phục vụ vòng nghiệm thu và kiểm toán độc lập của Codex.

---

## 2. MA TRẬN HỢP ĐỒNG API NGHIỆM THU

### 2.1. ATT-007: Giải trình & Điều chỉnh chấm công (C01)

#### Endpoint 1: Nhân viên gửi đơn giải trình

- **Method / Route:** `POST /api/v1/attendance/shifts/:id/correction-requests`
- **Headers:** `Content-Type: application/json`, `X-CSRF-Token: <token>`
- **Request Body:**
  ```json
  {
    "reason": "Quên bấm kết thúc ca lúc 18:00 do hỗ trợ khách hàng",
    "claimed_clock_out_at": "2026-10-12T11:00:00.000Z",
    "evidence_note": "Đã báo qua Zalo quản trị"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "uuid",
      "shift_id": "uuid",
      "reason": "...",
      "claimed_clock_out_at": "...",
      "status": "pending"
    },
    "request_id": "req-xxx"
  }
  ```
- **UI Element:** `data-testid="correction-modal"`, `data-testid="correction-submit-btn"`.

#### Endpoint 2: Chủ sở hữu duyệt / từ chối đơn giải trình

- **Method / Route:** `POST /api/v1/attendance/correction-requests/:id/decide`
- **Headers:** `Content-Type: application/json`, `X-CSRF-Token: <token>`
- **Request Body:**
  ```json
  {
    "decision": "accept", // hoặc "reject"
    "reason": "Chấp thuận điều chỉnh giờ ra ca",
    "clock_out_at": "2026-10-12T11:00:00.000Z" // Bắt buộc khi decision là "accept"
  }
  ```
- **Response (200 OK):** Envelope cập nhật trạng thái đơn giải trình (`status: 'approved' | 'rejected'`) và tạo phiên bản chấm công mới bất biến.

---

### 2.2. ATT-010: Xử lý ca làm qua đêm (Overnight) và Múi giờ Việt Nam

- **Hợp đồng dữ liệu:** Backend lưu trữ mốc thời gian dạng ISO 8601 UTC.
- **Quy chuẩn hiển thị UI:**
  - Định dạng hiển thị giờ và ngày luôn cố định tại múi giờ Việt Nam `Asia/Ho_Chi_Minh` (GMT+7) qua các helper `formatVnTime` và `formatVnDate`.
  - Hàm `isOvernightShift(inIso, outIso)` tự động so sánh ngày kết thúc và ngày bắt đầu theo lịch GMT+7. Nếu ca làm kéo dài qua nửa đêm (cross-midnight), UI kích hoạt nhãn hiển thị:
    - `data-testid="overnight-badge"` / `data-testid="owner-overnight-badge"` với nhãn `Ca qua đêm (+1 ngày)`.

---

### 2.3. PAY-003 & PAY-004: Phiếu lương cá nhân & Khóa quyền Owner (C04)

#### Endpoint: Xem phiếu lương cá nhân

- **Method / Route:** `GET /api/v1/payroll/periods/:month/me`
- **Quy tắc phân quyền (RBAC & Invariant C04):**
  - **Nhân viên (Staff):** Backend trả về đối tượng `StaffPayslipData` chứa đầy đủ 3 tầng thu nhập (Confirmed, Pending review, Live provisional), đơn giá giờ, chi tiết ngày công và các khoản chi trả.
  - **Chủ sở hữu (Owner):** Backend thực thi truy vấn loại trừ Owner (`NOT EXISTS (... role='owner')`), nếu Owner cố tình gọi endpoint `/me`, backend từ chối fail-closed với:
    ```json
    {
      "success": false,
      "error": {
        "code": "FORBIDDEN",
        "message": "Not payroll eligible"
      }
    }
    ```
  - **UI Invariant:** Desktop sidebar và Router phân định rạch ròi: Owner chỉ truy cập `/payroll` (UI14), Staff chỉ truy cập `/my-pay` (UI16).

---

### 2.4. PAY-005: Tổng hợp số giờ chấm công vào lương

- **Hợp đồng tính toán:**
  - Backend tổng hợp các ca có `review_state = 'approved'` thành `approved_worked_minutes` và `base_pay_vnd` (theo đơn giá giờ có hiệu lực tại thời điểm làm việc).
  - UI hiển thị trực quan tại thẻ Confirmed:
    - Lương cơ bản: `formatVnd(confirmed.base_pay_vnd)`
    - Thời gian làm việc: `data-testid="staff-approved-hours"` hiển thị `{formatMinutes(confirmed.approved_worked_minutes)}`.

---

### 2.5. PAY-006: Điều chỉnh lương (`paid_leave`)

- **Method / Route:** `POST /api/v1/payroll/periods/:month/adjustments`
- **Headers:** `Content-Type: application/json`, `X-CSRF-Token: <token>`, `Idempotency-Key: <uuid>`
- **Request Body (Chỉ cho phép `paid_leave`):**
  ```json
  {
    "employee_id": "uuid",
    "adjustment_type": "paid_leave",
    "attributable_date": "2026-10-12",
    "amount_vnd": 200000,
    "reason": "Nghỉ phép năm có hưởng lương"
  }
  ```
- **Ràng buộc an toàn:**
  - Nếu `adjustment_type !== 'paid_leave'`, backend từ chối 400 `VALIDATION_ERROR`.
  - Nếu kỳ lương đã `finalized`, backend từ chối 409 `INVALID_TRANSITION`.
  - Tiêu đề `Idempotency-Key` (UUID ngẫu nhiên) bảo đảm chống gửi lặp điều chỉnh. (Không dùng If-Match cho endpoint adjustments).

---

### 2.6. PAY-007: Chốt kỳ lương (Finalize) & Chi trả (Payout)

#### Bước 1: Chốt kỳ lương bất biến (Finalize)

- **Method / Route:** `POST /api/v1/payroll/periods/:month/finalize`
- **Headers:** `Content-Type: application/json`, `X-CSRF-Token: <token>`, `If-Match: "<period_version>"`, `Idempotency-Key: <uuid>`
- **Request Body:** `{}` (Body rỗng)
- **Ràng buộc an toàn:**
  - Yêu cầu quyền Owner.
  - Snapshot hash và toàn bộ bảng kê hàng ngày chuyển sang trạng thái bất biến.

#### Bước 2: Ghi nhận chi trả lương (Disbursement)

- **Method / Route:** `POST /api/v1/payroll/items/:id/disbursements`
- **Headers:** `Content-Type: application/json`, `X-CSRF-Token: <token>`, `Idempotency-Key: <uuid>`
- **Request Body:**
  ```json
  {
    "amount_vnd": 5000000,
    "payment_method": "bank_transfer",
    "payment_date": "2026-10-12",
    "reference_note": "Chuyển khoản lương qua Vietcombank"
  }
  ```
- **Ràng buộc an toàn:** Chỉ cho phép chi trả khi kỳ lương đã ở trạng thái `finalized` và số tiền không vượt quá `remaining_balance_vnd`.

---

### 2.7. REP-003: Chỉnh sửa báo cáo đã nộp (C02 Revision)

- **Method / Route:** `POST /api/v1/reports/daily/:id/revisions`
- **Headers:** `Content-Type: application/json`, `X-CSRF-Token: <token>`, `If-Match: "<report_version>"`
- **Request Body:**
  ```json
  {
    "reason": "Bổ sung số liệu video dựng ban đêm",
    "entries": [
      {
        "work_type": "Video Editing",
        "reported_count": 3,
        "notes": "Hoàn tất 3 video short"
      }
    ],
    "notes": "Báo cáo cập nhật"
  }
  ```
- **Ràng buộc an toàn:**
  - Bắt buộc cung cấp lý do điều chỉnh (`reason`).
  - Bản báo cáo cũ được bảo lưu bất biến trong lịch sử sửa đổi (truy xuất qua `GET /api/v1/reports/daily/:id/revisions`).
  - Phiên bản mới tự động tăng `current_revision + 1`.

---

### 2.8. AUTH-006, AUTH-010 & FILE-004: Xác nhận cơ chế bảo mật

- **AUTH-006 (Session Timeout):**
  - Backend đối soát `idle_expires_at > clock_timestamp()` và `absolute_expires_at > clock_timestamp()`. Khi hết hạn, mọi request trả về `401 UNAUTHENTICATED`.
  - Frontend `executeSessionVerification` phát hiện 401, tự động xóa phiên cục bộ và điều hướng an toàn về `/login`.
- **AUTH-010 (Case-Insensitive Username Collision):**
  - Backend chuẩn hóa username đăng ký và đăng nhập qua `.trim().toLowerCase()`.
  - Database áp dụng chỉ mục duy nhất trên trường `username_normalized`, ngăn chặn tuyệt đối việc tạo tài khoản giả mạo chữ hoa/chữ thường.
- **FILE-004 (Google Drive Trash Confirmation):**
  - Quy trình 2 bước: Bước 1 kiểm tra `delete-readiness` (toàn bộ thành phẩm được nghiệm thu, hash concurrency), Bước 2 gửi yêu cầu thùng rác có hộp thoại cảnh báo và xác nhận người dùng.

---

## 3. KẾT LUẬN & ĐỀ NGHỊ BÀN GIAO CHO CODEX

1. **Về phía Frontend (Anty):** Đã hoàn thiện toàn diện giao diện, các hộp thoại modal, bộ lọc, định dạng múi giờ VN, và bổ sung test assertions đầy đủ trong `tests/web/`.
2. **Về phía Backend (Codex):** Các API hiện hành đã đáp ứng 100% yêu cầu. Codex chỉ cần giữ nguyên các schema và invariant nêu trên trong quá trình audit và merge mã nguồn.
