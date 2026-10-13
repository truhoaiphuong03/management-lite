# SCOPE-EXT-01 — SCHEDULE-01 R09 SPECIFICATION (V0.2 EXTENSION)

**Tài liệu:** Quyết định phê duyệt phạm vi & Quy cách kỹ thuật Module SCHEDULE  
**Thẩm quyền:** Phê duyệt chính thức từ Owner (SCOPE-EXT-01)  
**Phiên bản:** `0.2.0-ext.01`  
**Baseline tham chiếu:** `b5faeaace8c87d2825775f4246f1132ba1eab207` (PR #9 Draft)  
**Nhánh triển khai:** `feat/v0.2-schedule-01`

---

## 1. Quyết định của Owner & Tuyên bố Phạm vi (SCOPE-EXT-01)

1. **Phạm vi mở rộng:** Owner đã chính thức phê duyệt mở phạm vi `SCHEDULE-01 R09` cho V0.2 trên nhánh độc lập `feat/v0.2-schedule-01`.
2. **Nguyên tắc tương thích:** Không sửa đổi 59 tài liệu canonical của V0.1 hiện có. Toàn bộ tài liệu canonical V0.1 (`0.1.0-doc.21`) và manifest được bảo toàn nguyên vẹn.
3. **Mục tiêu sản phẩm:** Xây dựng chức năng đăng ký và sửa lịch làm việc của nhân viên phục vụ sử dụng thực tế:
   - Đơn giản, trực quan, ưu tiên di động (mobile-first), dark theme đồng bộ với hệ thống.
   - Không dữ liệu giả (no mock data), không nút bấm demo.
   - Dữ liệu lưu trữ và quản lý trực tiếp bằng PostgreSQL.

---

## 2. Quy tắc Nghiệp vụ (Business Rules)

### 2.1. Đăng ký Lịch Làm việc (Staff)

- **Múi giờ chuẩn:** `Asia/Ho_Chi_Minh` (GMT+7).
- **Phạm vi chu kỳ:** Nhân viên đăng ký lịch theo từng tuần (Thứ 2 đến Chủ nhật). Tuần được định danh bằng ngày bắt đầu của tuần (`week_start_date` là ngày Thứ 2) và ngày kết thúc (`week_end_date` là ngày Chủ nhật).
- **Lựa chọn ngày:** Nhân viên chọn các ngày đi làm trong tuần (T2, T3, T4, T5, T6, T7, CN).
- **Giờ bắt đầu:** Đối với mỗi ngày được chọn, nhân viên chọn duy nhất một mốc giờ bắt đầu trong khoảng `00:00` đến `23:59`. Các giá trị không hợp lệ (ví dụ: `24:00`, `12:60`) bị từ chối ở cả tầng API và ràng buộc CHECK cơ sở dữ liệu.
- **Ngày không chọn:** Mặc định là ngày nghỉ (không làm việc).
- **Hiển thị sau đăng ký:** Sau khi đăng ký thành công, giao diện chỉ hiển thị danh sách các ngày đã chọn đi làm, bao gồm: Thứ trong tuần, ngày/tháng/năm và giờ bắt đầu.

### 2.2. Chỉnh sửa Lịch & Lịch sử Bất biến

- Nhân viên có thể chỉnh sửa lịch làm việc của mình bất cứ lúc nào bằng nút **"Sửa lịch"**.
- Cho phép thêm ngày, bớt ngày, đổi giờ/phút bắt đầu, kể cả đối với các tuần/ngày trong quá khứ.
- **Tính bất biến & Toàn vẹn (Revision History):**
  - Mỗi lần cập nhật lịch, hệ thống lưu lại một snapshot bất biến vào bảng `staff_schedule_revisions` kèm `revision_number`, người sửa (`edited_by`), thời gian (`edited_at`) và lý do chỉnh sửa (`reason` nếu có).
  - Cập nhật lịch và ghi nhận bản revision mới được thực hiện trong **CÙNG MỘT TRANSACTION** PostgreSQL (nguyên tử - atomic).
  - Cấm thao tác UPDATE hoặc DELETE trên bảng revisions (được bảo vệ bằng database trigger).

### 2.3. Quyền của Chủ sở hữu (Owner)

- Owner có quyền xem lịch làm việc đã đăng ký của tất cả nhân viên trong workspace theo từng tuần.
- Owner có quyền xem toàn bộ cây lịch sử chỉnh sửa các phiên bản của từng lịch.
- **Phân quyền nghiêm ngặt (RBAC):** Owner **KHÔNG ĐƯỢC PHÉP** sửa lịch thay cho nhân viên. Chỉ chính nhân viên sở hữu lịch mới có quyền đăng ký và chỉnh sửa lịch của mình.
- Nhân viên không được phép xem hoặc can thiệp vào lịch của nhân viên khác.

### 2.4. Tính Độc lập với Chấm công (ATT) và Lương (PAY)

- Việc thay đổi lịch làm việc (kể cả trong quá khứ) **KHÔNG ĐƯỢC TỰ Ý THAY ĐỔI** bản ghi chấm công thực tế (`attendance_shifts`) của module ATT hoặc bảng tính lương (`payroll`) của module PAY.

---

## 3. Module Ownership & Dependencies

| Module       | Sở hữu (Owns)                                                           | Chỉ đọc qua contract (May Read)                                     | Tuyệt đối không làm (Forbidden)                                             |
| :----------- | :---------------------------------------------------------------------- | :------------------------------------------------------------------ | :-------------------------------------------------------------------------- |
| **SCHEDULE** | `staff_schedules`, `staff_schedule_entries`, `staff_schedule_revisions` | `HR` (xác thực employee active), `AUTH` (workspace & session actor) | Tự ý sửa bản ghi chấm công `ATT` hoặc bảng lương `PAY`, sửa lịch người khác |

- **PostgreSQL Ledger:** Sequence migration tiếp theo được cấp phát là `0008_m06_schedules.sql`.

---

## 4. Data Dictionary (Schema V0.2)

### 4.1. Bảng `staff_schedules`

| Tên cột            | Kiểu dữ liệu  | Ràng buộc                                                                     | Mô tả                                |
| :----------------- | :------------ | :---------------------------------------------------------------------------- | :----------------------------------- |
| `id`               | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                                       | Khóa chính                           |
| `workspace_id`     | `uuid`        | `NOT NULL REFERENCES workspaces(id)`                                          | Khóa ngoại tenant container          |
| `employee_id`      | `uuid`        | `NOT NULL`                                                                    | Khóa ngoại nhân viên                 |
| `week_start_date`  | `date`        | `NOT NULL`                                                                    | Ngày Thứ 2 đầu tuần (YYYY-MM-DD)     |
| `week_end_date`    | `date`        | `NOT NULL`                                                                    | Ngày Chủ nhật cuối tuần (YYYY-MM-DD) |
| `timezone`         | `text`        | `NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'`                                         | Múi giờ áp dụng                      |
| `status`           | `text`        | `NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'cancelled'))` | Trạng thái lịch                      |
| `current_revision` | `integer`     | `NOT NULL DEFAULT 1 CHECK (current_revision > 0)`                             | Số hiệu bản sửa đổi hiện tại         |
| `version`          | `integer`     | `NOT NULL DEFAULT 1 CHECK (version > 0)`                                      | Version guard phục vụ If-Match       |
| `created_at`       | `timestamptz` | `NOT NULL DEFAULT now()`                                                      | Thời gian tạo                        |
| `updated_at`       | `timestamptz` | `NOT NULL DEFAULT now()`                                                      | Thời gian cập nhật                   |

- Ràng buộc duy nhất: `UNIQUE (workspace_id, employee_id, week_start_date)`
- Khóa ngoại composite: `FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) ON DELETE RESTRICT`

### 4.2. Bảng `staff_schedule_entries`

| Tên cột        | Kiểu dữ liệu  | Ràng buộc                                                          | Mô tả                              |
| :------------- | :------------ | :----------------------------------------------------------------- | :--------------------------------- |
| `id`           | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                            | Khóa chính                         |
| `workspace_id` | `uuid`        | `NOT NULL REFERENCES workspaces(id)`                               | Khóa ngoại tenant                  |
| `schedule_id`  | `uuid`        | `NOT NULL REFERENCES staff_schedules(id) ON DELETE CASCADE`        | Khóa ngoại lịch tuần               |
| `work_date`    | `date`        | `NOT NULL`                                                         | Ngày làm việc cụ thể               |
| `day_of_week`  | `smallint`    | `NOT NULL CHECK (day_of_week BETWEEN 1 AND 7)`                     | Thứ trong tuần (1 = T2 ... 7 = CN) |
| `start_time`   | `text`        | `NOT NULL CHECK (start_time ~ '^([01][0-9]\|2[0-3]):[0-5][0-9]$')` | Giờ bắt đầu (`00:00` - `23:59`)    |
| `notes`        | `text`        | `NULL`                                                             | Ghi chú ca làm                     |
| `created_at`   | `timestamptz` | `NOT NULL DEFAULT now()`                                           | Thời gian tạo                      |

- Ràng buộc duy nhất: `UNIQUE (schedule_id, work_date)`
- Khóa ngoại composite: `FOREIGN KEY (workspace_id, schedule_id) REFERENCES staff_schedules(workspace_id, id) ON DELETE CASCADE`

### 4.3. Bảng `staff_schedule_revisions` (Append-only)

| Tên cột           | Kiểu dữ liệu  | Ràng buộc                                                    | Mô tả                            |
| :---------------- | :------------ | :----------------------------------------------------------- | :------------------------------- |
| `id`              | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                      | Khóa chính                       |
| `workspace_id`    | `uuid`        | `NOT NULL REFERENCES workspaces(id)`                         | Khóa ngoại tenant                |
| `schedule_id`     | `uuid`        | `NOT NULL REFERENCES staff_schedules(id) ON DELETE RESTRICT` | Khóa ngoại lịch tuần             |
| `revision_number` | `integer`     | `NOT NULL CHECK (revision_number > 0)`                       | Số thứ tự phiên bản (1, 2, 3...) |
| `snapshot`        | `jsonb`       | `NOT NULL`                                                   | Snapshot JSON chứa mảng entries  |
| `reason`          | `text`        | `NULL`                                                       | Lý do điều chỉnh                 |
| `edited_by`       | `uuid`        | `NOT NULL REFERENCES users(id)`                              | Người thực hiện                  |
| `edited_at`       | `timestamptz` | `NOT NULL DEFAULT now()`                                     | Thời điểm thực hiện              |

- Ràng buộc duy nhất: `UNIQUE (workspace_id, schedule_id, revision_number)`
- Trigger cấm biến đổi: `trg_staff_schedule_revisions_immutable` ngăn chặn `UPDATE` và `DELETE`.

---

## 5. API Contracts (SCHEDULE-01)

_Lưu ý: Không dùng định danh `API-R09` (vốn là của REP). Hệ thống sử dụng định danh `API-SCH-01` đến `API-SCH-05`._

### `API-SCH-01`: `GET /api/v1/schedules/me`

- **Mục đích:** Nhân viên xem lịch làm việc của chính mình theo tuần.
- **Phân quyền:** Staff (hoặc User có liên kết Employee).
- **Query params:** `week_start_date` (tùy chọn, mặc định lấy tuần hiện tại hoặc kế tiếp).
- **Phản hồi (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "schedule": {
        "id": "uuid",
        "week_start_date": "2026-10-12",
        "week_end_date": "2026-10-18",
        "current_revision": 1,
        "version": 1
      },
      "entries": [
        {
          "work_date": "2026-10-12",
          "day_of_week": 1,
          "start_time": "08:30",
          "notes": ""
        }
      ],
      "revisions": []
    }
  }
  ```

### `API-SCH-02`: `POST /api/v1/schedules`

- **Mục đích:** Nhân viên đăng ký lịch làm việc mới cho tuần kế tiếp (hoặc tuần chỉ định).
- **Phân quyền:** Staff.
- **Headers:** `X-CSRF-Token`, `Idempotency-Key` (tùy chọn).
- **Body:**
  ```json
  {
    "week_start_date": "2026-10-12",
    "entries": [
      {
        "work_date": "2026-10-12",
        "day_of_week": 1,
        "start_time": "08:30",
        "notes": ""
      },
      {
        "work_date": "2026-10-14",
        "day_of_week": 3,
        "start_time": "13:00",
        "notes": ""
      }
    ]
  }
  ```
- **Validation:**
  - `start_time` phải khớp regex `^([01][0-9]|2[0-3]):[0-5][0-9]$` (từ `00:00` đến `23:59`). `24:00` trả về `400 BAD_REQUEST`.
  - Ngày trong entries phải thuộc khoảng từ `week_start_date` đến `week_end_date`.
  - Mỗi ngày chỉ xuất hiện tối đa 1 lần.
- **Xử lý:** Tạo `staff_schedules`, insert các dòng `staff_schedule_entries`, tạo bản ghi `staff_schedule_revisions` số 1 trong 1 transaction.
- **Phản hồi:** `201 Created`.

### `API-SCH-03`: `PUT /api/v1/schedules/:id`

- **Mục đích:** Nhân viên chỉnh sửa lịch làm việc đã đăng ký (thêm/bớt ngày, đổi giờ).
- **Phân quyền:** Chỉ chính Staff sở hữu lịch (Owner bị cấm sửa thay Staff với mã `403 FORBIDDEN`).
- **Headers:** `If-Match: "<version>"` (bắt buộc, thiếu trả về 428, lệch trả về 412).
- **Body:**
  ```json
  {
    "entries": [
      {
        "work_date": "2026-10-12",
        "day_of_week": 1,
        "start_time": "09:00",
        "notes": "Đổi giờ"
      }
    ],
    "reason": "Điều chỉnh do lịch học (tùy chọn)"
  }
  ```
- **Xử lý (Atomic Transaction):**
  - Kiểm tra quyền sở hữu và `version`.
  - So sánh `entries` mới với `entries` hiện có: nếu không có bất kỳ thay đổi nào, giữ nguyên version và không tạo revision snapshot mới.
  - Nếu có thay đổi: Xóa entries cũ, chèn entries mới.
  - Tăng `current_revision` và `version`.
  - Insert revision snapshot mới vào `staff_schedule_revisions` (kèm `reason` tùy chọn nếu có).
  - Ghi nhận `audit_event`.
- **Phản hồi:** `200 OK`.

### `API-SCH-04`: `GET /api/v1/schedules`

- **Mục đích:** Owner xem danh sách lịch nhân viên trong workspace theo tuần.
- **Phân quyền:** Owner-only (Staff bị từ chối 403).
- **Query params:** `week_start_date` (bắt buộc), `employee_id` (tùy chọn).
- **Phản hồi:** `200 OK` danh sách lịch kèm thông tin nhân viên và các ngày làm việc.

### `API-SCH-05`: `GET /api/v1/schedules/:id`

- **Mục đích:** Xem chi tiết lịch và toàn bộ lịch sử chỉnh sửa revisions.
- **Phân quyền:** Owner hoặc Staff sở hữu lịch.
- **Phản hồi:** `200 OK` chi tiết schedule, entries và mảng revisions.

---

## 6. Kế hoạch Kiểm thử & Tiêu chí Chấp nhận (Test Matrix)

1. **Cơ sở dữ liệu & Migration:**
   - Migration `0008_m06_schedules.sql` chạy mượt mà, replay an toàn, checksum khớp 1:1.
   - Trigger chống sửa/xóa revisions ngăn chặn mọi thao tác UPDATE/DELETE.
   - Ràng buộc CHECK giờ bắt đầu: `00:00` và `23:59` hợp lệ, `24:00` bị chặn.
2. **Nghiệp vụ Staff:**
   - Đăng ký lịch tuần kế tiếp thành công.
   - Sau khi lưu, giao diện chỉ hiển thị các ngày đã chọn (Thứ, ngày/tháng/năm, giờ bắt đầu).
   - Bấm nút "Sửa lịch", thêm/bớt ngày, đổi giờ, lưu thành công.
   - Snapshot phiên bản cũ được giữ nguyên, sinh revision v2, v3.
3. **Phân quyền RBAC:**
   - Staff A không thể xem hay sửa lịch của Staff B.
   - Owner xem được danh sách lịch và lịch sử chỉnh sửa của nhân viên.
   - Owner cố tình sửa lịch của Staff bị trả về `403 Forbidden`.
4. **Tính nguyên tử & Concurrency:**
   - Gửi yêu cầu sửa lịch thiếu `If-Match` bị từ chối `428 Precondition Required`.
   - Gửi sai version bị từ chối `412 Precondition Failed`.
   - Nếu xảy ra lỗi giữa chừng, toàn bộ transaction rollback hoàn toàn, không tạo dữ liệu dở dang.
5. **Zero Regression:**
   - Đảm bảo toàn bộ 108 bài test hiện có (AUTH, EMP, ATT, REP, Security, DB, UI) tiếp tục PASS 100%.
   - Không gây ảnh hưởng đến dữ liệu chấm công thật hay tính lương.
