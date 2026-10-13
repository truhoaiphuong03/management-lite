# SCOPE-EXT-03: WORK-01 (Quản lý Công việc & Phân công Nhân sự - V0.2)

> **Trạng thái:** OWNER APPROVED — CONTRACT LOCKED (2026-10-09)  
> **Phiên bản:** `0.2.0-ext.03-rev03`  
> **Phụ trách:** Anti (Frontend UI & Shared Contracts), Backend theo phân công  
> **Module Canonical:** `WORK` (Nhãn UI hiển thị: **"Công việc"**)  
> **Nhánh thực hiện:** `feat/v0.2-work-web`  
> **Baseline:** `eebcf8157a190c952bede539bb7ed425f3940d6a`

---

## 1. Bối cảnh & Mục tiêu

- **Tên module canonical:** `WORK`. Nhãn hiển thị người dùng: **"Công việc"**. Tuyệt đối không tạo module `TASK` độc lập.
- **Mục tiêu:** Cung cấp chức năng quản lý, phân công và theo dõi tiến độ công việc giữa Chủ sở hữu (Owner) và Nhân viên (Staff).
- **Nguyên tắc cốt lõi:**
  1. **Không hồi tố V0.1:** Giữ nguyên 59 canonical documents; không sửa schema của các module V0.1 (AUTH, HR, ATT, REP) và không đụng chạm module PAY đang do Codex phụ trách.
  2. **Tái sử dụng thực thể Canonical:** Tái sử dụng danh mục thực thể của `WORK` đã định hình trong `02_MODULE_REGISTRY.md` và `20_DBREADY_TABLES_AND_COLUMNS.md`: `work_items`, `work_assignments`, `work_submissions`, `work_reviews`.
  3. **Đa phân công (Multiple Assignments):** Một công việc (`work_item`) có thể giao cho một hoặc nhiều nhân viên (`work_assignments`). Mỗi nhân viên có tiến độ, trạng thái và kết quả nộp bài độc lập.
  4. **Bảo toàn lịch sử (Audit Trail Preservation):** Hành động hủy bỏ công việc (`cancel`) của Owner tuyệt đối không xóa dữ liệu phân công, nộp bài hoặc nghiệm thu trước đó.

---

## 2. Mô hình Nghiệp vụ & Vòng đời Trạng thái

### 2.1. Thực thể Công việc (`work_items`) & Phân công (`work_assignments`)

- **Múi giờ chuẩn:** `Asia/Ho_Chi_Minh` (GMT+7). Mọi hạn chót (`due_at`) hiển thị và tính toán theo múi giờ này.
- **Tiêu đề công việc:** Bắt buộc, độ dài từ 1 đến 200 ký tự.
- **Mức độ ưu tiên (`priority`):**
  - `low` (Thấp - Xám `#94A3B8`)
  - `medium` (Bình thường - Xanh dương `#38BDF8`)
  - `high` (Cao - Vàng cam `#F59E0B`)
  - `urgent` (Khẩn cấp - Đỏ `#EF4444`)
- **Phân loại công việc (`work_type`):**
  - `general` (Việc chung tại cửa hàng)
  - `content` (Nội dung / Bài viết)
  - `video` (Dựng video / Biên tập)
  - `design` (Thiết kế / Hình ảnh)
  - `other` (Khác)
- **Đa phân công (Multiple Assignments):**
  - Một `work_item` có thể giao cho 1 hoặc nhiều `employee_id`.
  - Mỗi nhân viên nhận việc sẽ có 1 bản ghi `work_assignments` độc lập.
  - Mỗi nhân viên tự quản lý tiến độ, tự bắt đầu (`start`), tự nộp bài riêng (`work_submissions`), và được Owner nghiệm thu riêng (`work_reviews`).

### 2.2. Vòng đời Trạng thái theo từng Phân công (Assignment Status Lifecycle)

Vòng đời trạng thái của từng `work_assignment` được chuẩn hóa theo 4 bước tuần tự:

```
   [ todo ]  (Chưa làm / Mới giao)
       │
       ▼  (Nhân viên bấm Bắt đầu làm: POST .../assignments/:id/start)
 [ in_progress ]  (Đang thực hiện)
       │
       ▼  (Nhân viên nộp bài: POST .../assignments/:id/submissions)
  [ in_review ]  (Chờ nghiệm thu / Chờ duyệt)
    │        ▲
    │        │ (Owner yêu cầu sửa: decision = 'request_changes' kèm feedback)
    ▼        │
  [ completed ]  (Hoàn thành - Owner duyệt đạt: decision = 'approved')
```

- **Quy tắc chuyển trạng thái chi tiết:**
  1. `todo` -> `in_progress`: Khi nhân viên bắt đầu làm việc và gọi API bắt đầu (`API-WORK-06`).
  2. `in_progress` -> `in_review`: Khi nhân viên hoàn thành công việc và gửi báo cáo kết quả (`API-WORK-07`) kèm ghi chú giải trình (`submission_note`) và link tài liệu (nếu có). Hành động này tạo bản ghi `work_submissions` mới với `revision_number = count + 1` và tự động chuyển assignment sang `in_review`.
  3. `in_review` -> `completed`: Khi Owner nghiệm thu submission cụ thể và chọn duyệt đạt (`decision = 'approved'` qua `API-WORK-08`). Hành động này tạo bản ghi `work_reviews` và đánh dấu assignment là `completed`.
  4. `in_review` -> `in_progress` (Yêu cầu làm lại): Khi Owner thấy kết quả chưa đạt và chọn `decision = 'request_changes'` kèm nhận xét (`feedback` qua `API-WORK-08`). Assignment quay về `in_progress`, bản ghi review được lưu lại trong lịch sử để nhân viên tiếp tục chỉnh sửa và nộp lại lần kế tiếp (`revision_number` tăng dần).
  5. **Nghiệm thu chặt chẽ (Không duyệt nhanh thiếu submission):** Owner chỉ nghiệm thu và hoàn thành (`completed`) sau khi nhân viên đã nộp báo cáo kết quả (`in_review` với submission hợp lệ). Không cho phép duyệt nhanh hoàn thành trực tiếp từ `todo` hoặc `in_progress` khi chưa có submission hợp lệ.
  6. **Trạng thái tổng quát của `work_items`:**
     - `todo`: Tất cả assignments đều ở `todo`.
     - `in_progress`: Ít nhất một assignment đang `in_progress` hoặc có assignment hỗn hợp.
     - `in_review`: Tất cả assignments đã nộp và chờ nghiệm thu.
     - `completed`: TẤT CẢ assignments đã hoàn thành (`completed`).
     - `cancelled`: Owner hủy bỏ công việc (`API-WORK-09`). Toàn bộ lịch sử phân công, nộp bài và đánh giá được bảo toàn nguyên vẹn, không bị xóa.

### 2.3. Phân quyền Nghiêm ngặt (RBAC)

- **Chủ sở hữu (Owner):**
  - Tạo công việc mới và phân công cho một hoặc nhiều nhân viên trong workspace.
  - Sửa thông tin công việc (tiêu đề, hạn chót, mô tả, ưu tiên).
  - Thêm nhân viên vào công việc (`work_assignments`).
  - Xem toàn bộ công việc của workspace kèm bộ lọc đa năng.
  - Nghiệm thu từng submission của từng nhân viên (`approved` để hoàn thành `completed`, hoặc `request_changes` để yêu cầu sửa lại kèm feedback).
  - Hủy bỏ công việc (`cancel`) mà không làm mất lịch sử đã ghi nhận.
- **Nhân viên (Staff):**
  - Chỉ xem danh sách các công việc được phân công cho chính mình.
  - Xem chi tiết công việc và yêu cầu được giao.
  - Kích hoạt bắt đầu làm việc (`todo` -> `in_progress`).
  - Nộp báo cáo kết quả (`in_progress` -> `in_review`).
  - Không được sửa tiêu đề, deadline hoặc người nhận việc.
  - Không thể tự ý đóng việc sang `completed` mà không qua bước nghiệm thu của Owner.

### 2.4. Tính Độc lập với Chấm công (ATT) và Lương (PAY)

- Tiến độ hoàn thành công việc của `WORK` **KHÔNG TỰ ĐỘNG THAY ĐỔI** giờ chấm công thực tế của `ATT` và không tự suy diễn tiền lương cơ bản của `PAY`.
- Mọi điều chỉnh thưởng/phạt theo hiệu quả công việc (nếu có) phải đi qua hợp đồng `POST /api/v1/payroll/periods/:month/adjustments` đã được chuẩn hóa ở `SCOPE-EXT-02`.

---

## 3. Module Ownership & Dependencies

| Module   | Sở hữu (Owns)                                                        | May Read (Chỉ đọc)                                                    | Tuyệt đối cấm (Must Not Mutate)                          |
| :------- | :------------------------------------------------------------------- | :-------------------------------------------------------------------- | :------------------------------------------------------- |
| **WORK** | `work_items`, `work_assignments`, `work_submissions`, `work_reviews` | `HR` (danh sách nhân viên active), `AUTH` (workspace & session actor) | Không sửa ATT, không sửa PAY, không sửa User Credentials |

- **PostgreSQL Ledger:** Sequence migration tiếp theo được cấp phát dự kiến là `0010_m08_work.sql` (nối tiếp sau `0009_m07_payroll.sql`).

---

## 4. Data Dictionary (Schema Chuẩn cho PostgreSQL)

### 4.1. Bảng `work_items`

| Cột            | Kiểu          | Ràng buộc                                                                                                  | Diễn giải                    |
| :------------- | :------------ | :--------------------------------------------------------------------------------------------------------- | :--------------------------- |
| `id`           | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                                                                    | Khóa chính                   |
| `workspace_id` | `uuid`        | `NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`                                                     | Tenant                       |
| `title`        | `text`        | `NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 200)`                                        | Tiêu đề công việc            |
| `description`  | `text`        | `NULL`                                                                                                     | Chi tiết yêu cầu công việc   |
| `work_type`    | `text`        | `NOT NULL DEFAULT 'general' CHECK (work_type IN ('general', 'content', 'video', 'design', 'other'))`       | Phân loại                    |
| `status`       | `text`        | `NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'in_review', 'completed', 'cancelled'))` | Trạng thái tổng quát         |
| `priority`     | `text`        | `NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent'))`                        | Mức ưu tiên                  |
| `due_at`       | `timestamptz` | `NULL`                                                                                                     | Hạn chót hoàn thành          |
| `created_by`   | `uuid`        | `NOT NULL REFERENCES users(id)`                                                                            | Người khởi tạo               |
| `version`      | `integer`     | `NOT NULL DEFAULT 1 CHECK (version > 0)`                                                                   | Optimistic Concurrency Guard |
| `created_at`   | `timestamptz` | `NOT NULL DEFAULT now()`                                                                                   | Thời điểm tạo                |
| `updated_at`   | `timestamptz` | `NOT NULL DEFAULT now()`                                                                                   | Thời điểm cập nhật           |

### 4.2. Bảng `work_assignments` (Phân công nhân sự)

| Cột            | Kiểu          | Ràng buộc                                                                                     | Diễn giải            |
| :------------- | :------------ | :-------------------------------------------------------------------------------------------- | :------------------- |
| `id`           | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                                                       | Khóa chính           |
| `workspace_id` | `uuid`        | `NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`                                        | Tenant               |
| `work_item_id` | `uuid`        | `NOT NULL REFERENCES work_items(id) ON DELETE CASCADE`                                        | Khóa ngoại công việc |
| `employee_id`  | `uuid`        | `NOT NULL REFERENCES employees(id) ON DELETE RESTRICT`                                        | Nhân viên được giao  |
| `stage`        | `text`        | `NOT NULL DEFAULT 'primary'`                                                                  | Giai đoạn xử lý      |
| `status`       | `text`        | `NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'in_review', 'completed'))` | Trạng thái phân công |
| `assigned_by`  | `uuid`        | `NOT NULL REFERENCES users(id)`                                                               | Người phân công      |
| `assigned_at`  | `timestamptz` | `NOT NULL DEFAULT now()`                                                                      | Thời điểm giao       |

- Ràng buộc duy nhất: `UNIQUE (workspace_id, work_item_id, employee_id)`.

### 4.3. Bảng `work_submissions` (Lịch sử nộp & báo cáo tiến độ - Append-only)

| Cột               | Kiểu          | Ràng buộc                                                     | Diễn giải                      |
| :---------------- | :------------ | :------------------------------------------------------------ | :----------------------------- |
| `id`              | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                       | Khóa chính                     |
| `workspace_id`    | `uuid`        | `NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`        | Tenant                         |
| `work_item_id`    | `uuid`        | `NOT NULL REFERENCES work_items(id) ON DELETE CASCADE`        | Khóa ngoại công việc           |
| `assignment_id`   | `uuid`        | `NOT NULL REFERENCES work_assignments(id) ON DELETE RESTRICT` | Phân công cụ thể               |
| `revision_number` | `integer`     | `NOT NULL CHECK (revision_number > 0)`                        | Lần nộp thứ N                  |
| `submission_note` | `text`        | `NOT NULL`                                                    | Ghi chú / Báo cáo kết quả      |
| `attachments`     | `jsonb`       | `NOT NULL DEFAULT '[]'::jsonb`                                | Danh sách link đính kèm nếu có |
| `submitted_by`    | `uuid`        | `NOT NULL REFERENCES users(id)`                               | Người nộp                      |
| `submitted_at`    | `timestamptz` | `NOT NULL DEFAULT now()`                                      | Thời điểm nộp                  |

- Ràng buộc duy nhất: `UNIQUE (workspace_id, assignment_id, revision_number)`.

### 4.4. Bảng `work_reviews` (Lịch sử nghiệm thu / đánh giá của Owner - Append-only)

| Cột                | Kiểu          | Ràng buộc                                                      | Diễn giải                  |
| :----------------- | :------------ | :------------------------------------------------------------- | :------------------------- |
| `id`               | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                        | Khóa chính                 |
| `workspace_id`     | `uuid`        | `NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`         | Tenant                     |
| `work_item_id`     | `uuid`        | `NOT NULL REFERENCES work_items(id) ON DELETE CASCADE`         | Khóa ngoại công việc       |
| `assignment_id`    | `uuid`        | `NOT NULL REFERENCES work_assignments(id) ON DELETE CASCADE`   | Phân công được duyệt       |
| `submission_id`    | `uuid`        | `NOT NULL REFERENCES work_submissions(id) ON DELETE RESTRICT`  | Lần nộp được nghiệm thu    |
| `reviewer_user_id` | `uuid`        | `NOT NULL REFERENCES users(id)`                                | Owner thẩm định            |
| `decision`         | `text`        | `NOT NULL CHECK (decision IN ('approved', 'request_changes'))` | Kết quả nghiệm thu         |
| `feedback`         | `text`        | `NULL`                                                         | Nhận xét / Yêu cầu sửa đổi |
| `reviewed_at`      | `timestamptz` | `NOT NULL DEFAULT now()`                                       | Thời điểm nghiệm thu       |

---

## 5. Danh mục Hợp đồng API Chuẩn (`API-WORK-01` -> `API-WORK-09`)

Tất cả các endpoint đều chuẩn hóa theo tiền tố `/api/v1/work-items`.

### `API-WORK-01`: `GET /api/v1/work-items`

- **Mục đích:** Lấy danh sách công việc.
- **Phân quyền:** Cả Owner và Staff (Staff tự động chỉ thấy việc được giao cho mình; Owner thấy toàn bộ).
- **Query params:**
  - `status`: `todo`, `in_progress`, `in_review`, `completed`, `cancelled` (hoặc `all`).
  - `priority`: `low`, `medium`, `high`, `urgent`.
  - `assignee_id`: UUID nhân viên (chỉ Owner được lọc theo người khác).
  - `search`: Từ khóa tìm kiếm theo tiêu đề.
- **Phản hồi (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "uuid",
          "title": "Kiểm kê hàng hóa cuối tuần",
          "description": "Kiểm tra số lượng tồn kho trên kệ và trong kho",
          "work_type": "general",
          "status": "todo",
          "priority": "high",
          "due_at": "2026-10-12T17:00:00.000Z",
          "version": 1,
          "created_by": "uuid",
          "created_at": "2026-10-09T10:00:00.000Z",
          "assignments": [
            {
              "id": "uuid-assignment-1",
              "employee_id": "uuid-employee-1",
              "employee_code": "NV01",
              "full_name": "Nguyễn Văn A",
              "status": "todo"
            }
          ]
        }
      ],
      "total": 1
    }
  }
  ```

### `API-WORK-02`: `POST /api/v1/work-items`

- **Mục đích:** Tạo công việc mới và phân công nhân viên.
- **Phân quyền:** Owner-only (Staff bị từ chối 403).
- **Headers:** `X-CSRF-Token`, `Idempotency-Key` (tùy chọn).
- **Body:**
  ```json
  {
    "title": "Kiểm kê hàng hóa cuối tuần",
    "description": "Chi tiết yêu cầu...",
    "work_type": "general",
    "priority": "high",
    "due_at": "2026-10-12T17:00:00.000Z",
    "assignee_ids": ["uuid-employee-1", "uuid-employee-2"]
  }
  ```
- **Phản hồi:** `201 Created`.

### `API-WORK-03`: `GET /api/v1/work-items/:id`

- **Mục đích:** Xem chi tiết công việc, bao gồm phân công, lịch sử nộp bài (`submissions`) và lịch sử nghiệm thu (`reviews`).
- **Phân quyền:** Owner hoặc Nhân viên được phân công.
- **Phản hồi:** `200 OK`.

### `API-WORK-04`: `PATCH /api/v1/work-items/:id`

- **Mục đích:** Sửa đổi thông tin công việc (tiêu đề, hạn chót, mô tả, ưu tiên).
- **Phân quyền:** Owner-only.
- **Headers:** `If-Match: "<version>"`, `X-CSRF-Token`.
- **Phản hồi:** `200 OK`.

### `API-WORK-05`: `POST /api/v1/work-items/:id/assignments`

- **Mục đích:** Phân công thêm nhân sự vào công việc đã có.
- **Phân quyền:** Owner-only.
- **Headers:** `X-CSRF-Token`.
- **Body:**
  ```json
  {
    "employee_ids": ["uuid-employee-3"]
  }
  ```
- **Phản hồi:** `201 Created`.

### `API-WORK-06`: `POST /api/v1/work-items/:id/assignments/:assignmentId/start`

- **Mục đích:** Nhân viên được phân công bấm "Bắt đầu làm việc" chuyển trạng thái từ `todo` sang `in_progress`.
- **Phân quyền:** Nhân viên sở hữu assignment hoặc Owner.
- **Precondition:** Trạng thái assignment hiện tại phải là `todo`.
- **Headers:** `X-CSRF-Token`, `If-Match: "<version>"`.
- **Body:** `{ "note": "Bắt đầu thực hiện công việc" }` (tùy chọn).
- **Phản hồi:** `200 OK` (assignment chuyển sang `in_progress`).

### `API-WORK-07`: `POST /api/v1/work-items/:id/assignments/:assignmentId/submissions`

- **Mục đích:** Nhân viên nộp kết quả công việc, tự động chuyển status của assignment sang `in_review`.
- **Phân quyền:** Nhân viên sở hữu assignment.
- **Precondition:** Trạng thái assignment phải là `in_progress`.
- **Headers:** `X-CSRF-Token`.
- **Body:**
  ```json
  {
    "submission_note": "Đã kiểm kê xong kệ 1-5, phát hiện thiếu 2 sản phẩm.",
    "attachments": [
      { "name": "bien_ban.pdf", "url": "https://drive.google.com/..." }
    ]
  }
  ```
- **Phản hồi:** `201 Created` (tạo bản ghi submission với `revision_number = count + 1`, assignment chuyển sang `in_review`).

### `API-WORK-08`: `POST /api/v1/work-items/:id/assignments/:assignmentId/submissions/:submissionId/reviews`

- **Mục đích:** Owner nghiệm thu kết quả submission cụ thể của nhân viên.
- **Hỗ trợ đồng thời:** `POST /api/v1/work-items/:id/assignments/:assignmentId/reviews` với trường `submission_id` trong body.
- **Phân quyền:** Owner-only.
- **Headers:** `X-CSRF-Token`.
- **Body:**
  ```json
  {
    "submission_id": "uuid-submission",
    "decision": "approved",
    "feedback": "Số liệu khớp, duyệt hoàn thành."
  }
  ```
  _(Nếu `decision` là `approved`: status của assignment chuyển thành `completed`. Nếu là `request_changes`: status chuyển về `in_progress` kèm feedback để nhân viên làm lại)._
- **Phản hồi:** `200 OK`.

### `API-WORK-09`: `POST /api/v1/work-items/:id/cancel`

- **Mục đích:** Owner hủy bỏ công việc.
- **Phân quyền:** Owner-only.
- **Headers:** `If-Match: "<version>"`, `X-CSRF-Token`.
- **Body:**
  ```json
  {
    "reason": "Hủy ca làm việc do lịch trình thay đổi"
  }
  ```
- **Nguyên tắc bảo toàn:** Đổi `status` của `work_items` thành `cancelled`. **Tuyệt đối KHÔNG xóa các bản ghi `work_assignments`, `work_submissions`, `work_reviews` liên quan** nhằm đảm bảo toàn vẹn dữ liệu kiểm toán (Audit Trail).
- **Phản hồi:** `200 OK`.

---

## 6. Đặc tả Giao diện Frontend (`UI-WORK-01`, `UI-WORK-02`, `UI-WORK-03`)

- **Khóa 3 tuyến đường URL chuẩn:**
  1. `/work`: Danh sách công việc (màn hình chính `UI-WORK-01`).
  2. `/work/new`: Màn hình giao việc mới (`UI-WORK-02`, Owner-only).
  3. `/work/:id`: Màn hình chi tiết công việc, nộp bài và nghiệm thu (`UI-WORK-03`).
- **Tên hiển thị:** **"Công việc"**
- **Vị trí AppShell:** Nằm trên thanh điều hướng bên cạnh Lịch làm việc, Chấm công, Báo cáo, Bảng lương.
- **Thiết kế Mobile-First & Dark Theme:** Thống nhất bảng màu `#0B1220`, `#0F172A`, `#1E293B`, `#14B8A6`.
- **Giao diện thích ứng theo Vai trò (Role Adaptive):**
  - **Dành cho Chủ sở hữu (Owner):**
    - Thanh KPI Cards: Cần làm (`todo`), Đang làm (`in_progress`), Chờ duyệt (`in_review`), Đã xong (`completed`).
    - Nút bấm chính: **"+ Giao việc mới"** (dẫn tới `/work/new` hoặc mở Modal).
    - Bộ lọc đa năng: Lọc theo nhân sự, theo trạng thái, theo mức độ ưu tiên.
    - Tại `/work/:id`: Xem danh sách tất cả nhân viên được giao, xem kết quả nộp bài của từng người, bấm nút **"Duyệt đạt"** hoặc **"Yêu cầu sửa"** (kèm hộp thoại nhập phản hồi), và nút **"Hủy công việc"** (bảo toàn lịch sử).
  - **Dành cho Nhân viên (Staff):**
    - Danh sách việc được giao cho chính mình.
    - Tab phân loại: "Cần làm ngay", "Đang làm", "Chờ chủ shop duyệt", "Đã hoàn thành".
    - Tại `/work/:id`:
      - Nút **"Bắt đầu làm việc"** (chuyển sang `in_progress` qua `API-WORK-06`).
      - Nút **"Báo cáo hoàn thành (Nộp bài)"** (mở form nhập ghi chú báo cáo kết quả và đính kèm link qua `API-WORK-07`).
      - Xem phản hồi của Owner nếu bị yêu cầu sửa lại (`request_changes`).
- **Nguyên tắc Chân thực & Không Mock Data:**
  - Nếu API Backend chưa sẵn sàng: Hiển thị Empty State hoặc Banner thông báo `Đang kết nối API Backend WORK...`.
  - Tuyệt đối không tạo nút giả vờ thành công hoặc chèn mock data làm sai lệch dữ liệu thực tế.

---

## 7. Ma trận Kiểm thử & Điều kiện Nghiệm thu (Test Matrix)

1. **Kiểm tra Hợp đồng & Registry:**
   - Định nghĩa DTO đầy đủ tại `packages/contracts/src/work.ts`.
   - Vòng đời trạng thái assignment khóa chặt: `['todo', 'in_progress', 'in_review', 'completed']`.
   - Trạng thái công việc tổng quát: `['todo', 'in_progress', 'in_review', 'completed', 'cancelled']`.
   - Các routes `/work`, `/work/new`, `/work/:id` được đăng ký trong `ROUTE_REGISTRY` (`types.ts`).
   - Menu điều hướng `NAV_ITEMS` hiển thị mục "Công việc" cho cả Owner và Staff.
2. **Kiểm tra Giao diện & RBAC:**
   - Staff đăng nhập: Chỉ thấy việc của mình, có nút nhận việc và nộp việc, không thấy nút giao việc hay duyệt nghiệm thu.
   - Owner đăng nhập: Thấy nút giao việc, bộ lọc toàn bộ nhân viên, các nút duyệt/yêu cầu sửa lại, và nút hủy việc.
3. **Optimistic Concurrency & Security:**
   - Xác minh header `If-Match` và `X-CSRF-Token` được gửi trong mọi thao tác cập nhật, nộp bài, nghiệm thu.
4. **Zero Regression:**
   - Toàn bộ test suite web (bao gồm PAY-01, SCHEDULE-01, foundation) tiếp tục PASS 100%.
   - Nhánh `feat/v0.2-pay-web` và `feat/v0.2-pay-backend` không bị ảnh hưởng.
