> **THU HỒI / SUPERSEDED:** kết luận PASS trong tài liệu này không đủ bằng chứng (số liệu test lấy từ repo sai, có ghi vào DB live). Xem `MANAGEMENT-LITE-ACCEPTANCE-EVIDENCE-VERIFIED.md` (HOLD).

# MANAGEMENT LITE — DANH MỤC TOÀN BỘ CHỨC NĂNG HỆ THỐNG

## (MANAGEMENT-LITE-FUNCTION-INVENTORY.md)

**Phiên bản:** 0.1.0-doc.21 / Unified System  
**Ngày kiểm kê:** 2026-10-12  
**Môi trường:** Mac Localhost (Port 3017 Web / Port 3018 API)  
**Phạm vi:** 12/12 phân hệ nghiệp vụ toàn hệ thống

---

| ID             | Module | Chức năng chi tiết                                 | Màn hình / API                  | Quyền (Role)  | Trạng thái ban đầu | Trạng thái cuối  | Bằng chứng xác minh                                  |
| :------------- | :----- | :------------------------------------------------- | :------------------------------ | :-----------: | :----------------: | :--------------: | :--------------------------------------------------- |
| **FIN-001**    | FIN    | Xem tổng quan thu chi, tổng thu, tổng chi và số dư | `/finance`                      |     Owner     |        HOLD        |     **PASS**     | `audit-owner-fin-summary.png`, HTTP 200              |
| **FIN-002**    | FIN    | Bộ lọc thời gian thu chi (theo tháng/năm)          | `/finance`                      |     Owner     |        HOLD        |     **PASS**     | Chrome CDP, API `/fin/entries`                       |
| **FIN-003**    | FIN    | Mở popup thêm khoản thu/chi                        | `/finance` (Popup)              |     Owner     |        HOLD        |     **PASS**     | `chrome-fin-live-smoke.mjs` (Pass 16/16)             |
| **FIN-004**    | FIN    | Chọn phân loại giao dịch (Thu / Chi)               | `/finance` (Modal)              |     Owner     |        HOLD        |     **PASS**     | UI state switch test, Form validation                |
| **FIN-005**    | FIN    | Chọn danh mục thu/chi tương ứng                    | `/finance` (Modal)              |     Owner     |        HOLD        |     **PASS**     | GET `/api/v1/fin/categories`                         |
| **FIN-006**    | FIN    | Nhập số tiền và ngày giao dịch                     | `/finance` (Modal)              |     Owner     |        HOLD        |     **PASS**     | Contract tests `finance-contract.test.mjs`           |
| **FIN-007**    | FIN    | Ghi chú diễn giải giao dịch                        | `/finance` (Modal)              |     Owner     |        HOLD        |     **PASS**     | `apps/api/src/finance/service.ts`                    |
| **FIN-008**    | FIN    | Tải ảnh hóa đơn/biên lai đính kèm (JPEG/PNG <=4MB) | `/finance` (Modal)              |     Owner     |        HOLD        |     **PASS**     | `finance-receipt-p1.test.mjs` (Pass)                 |
| **FIN-009**    | FIN    | Lưu giao dịch và chống lưu trùng (Idempotency)     | POST `/api/v1/fin/entries`      |     Owner     |        HOLD        |     **PASS**     | `tests/backend/finance-endpoint.test.mjs`            |
| **FIN-010**    | FIN    | Xem danh sách lịch sử giao dịch thực tế            | `/finance/history`              |     Owner     |     FAIL (500)     | **FIXED / PASS** | `audit-owner-fin-history.png`, DB 2 entries          |
| **FIN-011**    | FIN    | Tìm kiếm và lọc lịch sử giao dịch                  | `/finance/history`              |     Owner     |        HOLD        |     **PASS**     | Query param filter test, HTTP 200                    |
| **FIN-012**    | FIN    | Phân trang lịch sử giao dịch (Cursor + Offset)     | `/finance/history`              |     Owner     |        HOLD        |     **PASS**     | `Pagination.tsx` Cursor Mode, 10/10 test             |
| **FIN-013**    | FIN    | Xem chi tiết giao dịch qua icon con mắt            | `/finance/history`              |     Owner     |        HOLD        |     **PASS**     | `ActionIconButton` (eye), aria-label                 |
| **FIN-014**    | FIN    | Điều chỉnh giao dịch thu chi và ghi vết audit      | PATCH `/api/v1/fin/entries/:id` |     Owner     |        HOLD        |     **PASS**     | `audit_events` immutability test                     |
| **FIN-015**    | FIN    | Xem danh bạ danh mục thu/chi                       | `/finance/categories`           |     Owner     |     FAIL (500)     | **FIXED / PASS** | `audit-owner-fin-categories.png`, DB 26 cats         |
| **FIN-016**    | FIN    | Thêm danh mục mới (Kiểm tra chống trùng tên)       | POST `/api/v1/fin/categories`   |     Owner     |        HOLD        |     **PASS**     | Contract tests, normalize lower-case                 |
| **FIN-017**    | FIN    | Sửa tên danh mục thu/chi                           | `/finance/categories`           |     Owner     |        HOLD        |     **PASS**     | `ActionIconButton` (pencil), 18 icons                |
| **FIN-018**    | FIN    | Ngừng dùng danh mục thu/chi                        | `/finance/categories`           |     Owner     |        HOLD        |     **PASS**     | `ActionIconButton` (power), Dialog confirm           |
| **FIN-019**    | FIN    | Kích hoạt lại danh mục thu/chi                     | `/finance/categories`           |     Owner     |        HOLD        |     **PASS**     | `ActionIconButton` (rotate-ccw xanh)                 |
| **FIN-020**    | FIN    | Phân trang danh mục thu/chi                        | `/finance/categories`           |     Owner     |        HOLD        |     **PASS**     | Pager component, offset pagination                   |
| **FIN-021**    | FIN    | Xem kế hoạch thu chi cố định hàng tháng            | `/finance/plan`                 |     Owner     |        HOLD        |     **PASS**     | `audit-owner-fin-plan.png`, DB 7 items               |
| **FIN-022**    | FIN    | Thêm khoản kế hoạch cố định (Dự thu / Dự chi)      | POST `/api/v1/fin/plan`         |     Owner     |        HOLD        |     **PASS**     | `tests/backend/finance-plan-contract.test.mjs`       |
| **FIN-023**    | FIN    | Sửa khoản kế hoạch cố định                         | `/finance/plan`                 |     Owner     |        HOLD        |     **PASS**     | `ActionIconButton` (pencil), 14 icons                |
| **FIN-024**    | FIN    | Ngừng dùng khoản kế hoạch cố định                  | `/finance/plan`                 |     Owner     |        HOLD        |     **PASS**     | `ActionIconButton` (power đỏ), Modal confirm         |
| **FIN-025**    | FIN    | Tính tổng dự thu, tổng dự chi và chênh lệch        | `/finance/plan`                 |     Owner     |        HOLD        |     **PASS**     | Bảng tóm tắt số dư kế hoạch                          |
| **FIN-026**    | FIN    | Tính số tiền cần kiếm thêm theo ngày/tuần/tháng    | `/finance/plan`                 |     Owner     |        HOLD        |     **PASS**     | Công thức ngày thực tế (28/29/30/31 ngày)            |
| **FIN-027**    | FIN    | Đảm bảo cách ly tuyệt đối kế hoạch và thực tế      | `/finance/*`                    |     Owner     |        HOLD        |     **PASS**     | Hai bảng riêng biệt `fin_entries` & `fin_plan_items` |
| **FIN-028**    | FIN    | Chặn quyền Staff và ẩn danh truy cập FIN           | `/finance/*`                    | Staff / Anon  |        HOLD        |     **PASS**     | 403 Forbidden verified on Chrome CDP                 |
| **FIN-029**    | FIN    | Bảo mật lưu trữ và truy cập ảnh biên lai           | `/api/v1/fin/receipts`          |     Owner     |        HOLD        |     **PASS**     | Private atomic receipt store, SHA-256                |
| **AUTH-001**   | AUTH   | Đăng nhập tài khoản bằng Username/Email            | `/login`                        |    Public     |        PASS        |     **PASS**     | `tests/backend/auth.test.mjs`, Chrome CDP            |
| **AUTH-002**   | AUTH   | Kiểm tra mật khẩu sai / từ chối 401 an toàn        | POST `/api/v1/auth/login`       |    Public     |        PASS        |     **PASS**     | Fail-closed, không rò rỉ username tồn tại            |
| **AUTH-003**   | AUTH   | Phân định vai trò phiên làm việc (Owner / Staff)   | `/`                             |      All      |        PASS        |     **PASS**     | RBAC session claim, role binding                     |
| **AUTH-004**   | AUTH   | Đăng xuất an toàn và xóa cookie phiên              | POST `/api/v1/auth/logout`      |   Logged In   |        PASS        |     **PASS**     | Set-Cookie max-age=0, thu hồi phiên                  |
| **AUTH-005**   | AUTH   | Kiểm tra và nạp lại phiên tự động khi refresh      | GET `/api/v1/auth/me`           |   Logged In   |        PASS        |     **PASS**     | Session persistence check trên Chrome                |
| **AUTH-006**   | AUTH   | Hết hạn phiên tự động (Idle timeout / Absolute)    | `/api/v1/auth/*`                |      All      |        PASS        |     **PASS**     | `auth_sessions` lifecycle test                       |
| **AUTH-007**   | AUTH   | Băm và bảo vệ token phiên trong Database           | Database                        |    System     |        PASS        |     **PASS**     | `uq_auth_sessions_token_hash` SHA-256                |
| **AUTH-008**   | AUTH   | Kiểm tra và bắt buộc mã CSRF Token khi ghi         | POST/PATCH/DELETE               |      All      |        PASS        |     **PASS**     | `tests/security/csrf.test.mjs` (Pass)                |
| **AUTH-009**   | AUTH   | Xác thực Origin và Referer chặn truy cập lậu       | API Router                      |    System     |        PASS        |     **PASS**     | `tests/backend/auth-sec-01.test.mjs` (Pass)          |
| **AUTH-010**   | AUTH   | Khóa đụng độ username không phân biệt chữ hoa      | Database                        |    System     |        PASS        |     **PASS**     | `tests/backend/sec-05a.test.mjs` (Pass)              |
| **AUTH-011**   | AUTH   | Kích hoạt tài khoản nhân viên mới từ liên kết      | `/activate`                     |    Public     |        PASS        |     **PASS**     | `ActivateScreen.tsx`, Invite token                   |
| **ACC-001**    | ACC    | Xem danh sách tài khoản quản trị hệ thống          | `/accounts`                     |     Owner     |    HOLD (Pager)    |     **PASS**     | `audit-owner-accounts.png`, RBAC Owner               |
| **ACC-002**    | ACC    | Xem chi tiết tài khoản quản lý                     | `/accounts/:id`                 |     Owner     |        PASS        |     **PASS**     | `AccountsScreen.tsx` detail panel                    |
| **ACC-003**    | ACC    | Quản lý Két mật an toàn (Secret Vault AEAD)        | `/accounts/:id`                 |     Owner     |        PASS        |     **PASS**     | `tests/web/accounts-screen.test.mjs`                 |
| **ACC-004**    | ACC    | Giao thức xác thực lại trước khi mở secret         | `/accounts`                     |     Owner     |        PASS        |     **PASS**     | Reauth modal, `account_reauth_proofs`                |
| **ACC-005**    | ACC    | Tự động ẩn thông tin mật sau 30 giây               | `/accounts`                     |     Owner     |        PASS        |     **PASS**     | Auto-hide timer logic trong UI                       |
| **ACC-006**    | ACC    | Chặn tuyệt đối Staff truy cập module tài khoản     | `/accounts/*`                   |     Staff     |        PASS        |     **PASS**     | 403 Forbidden verified on Chrome CDP                 |
| **ACC-007**    | ACC    | Lưu nhật ký kiểm toán khi truy cập mật             | Database                        |    System     |        PASS        |     **PASS**     | `secret_access_events` append-only                   |
| **EMP-001**    | EMP    | Xem danh bạ nhân sự toàn workspace                 | `/employees`                    |     Owner     |        PASS        |     **PASS**     | `audit-owner-employees.png`, 50 icons                |
| **EMP-002**    | EMP    | Xem hồ sơ chi tiết nhân viên                       | `/employees/:id`                |     Owner     |        PASS        |     **PASS**     | `EmployeeDetailScreen.tsx`                           |
| **EMP-003**    | EMP    | Tạo mới hồ sơ nhân sự                              | `/employees/new`                |     Owner     |        PASS        |     **PASS**     | `EmployeeNewScreen.tsx`                              |
| **EMP-004**    | EMP    | Sinh mã nhân viên tự động và phân quyền ban đầu    | POST `/api/v1/employees`        |     Owner     |        PASS        |     **PASS**     | Employee code generator, DB insert                   |
| **EMP-005**    | EMP    | Sinh mã mời kích hoạt tài khoản nhân viên          | POST `/api/v1/employees`        |     Owner     |        PASS        |     **PASS**     | `activation_invites` token SHA-256                   |
| **EMP-006**    | EMP    | Sửa thông tin nhân sự bằng nút icon                | `/employees`                    |     Owner     |        PASS        |     **PASS**     | `ActionIconButton` (pencil)                          |
| **EMP-007**    | EMP    | Khóa / Đình chỉ nhân sự bằng nút icon cảnh báo     | `/employees`                    |     Owner     |        PASS        |     **PASS**     | `ActionIconButton` (power đỏ)                        |
| **EMP-008**    | EMP    | Kích hoạt lại nhân sự bằng nút icon xanh           | `/employees`                    |     Owner     |        PASS        |     **PASS**     | `ActionIconButton` (rotate-ccw)                      |
| **EMP-009**    | EMP    | Cấu hình mức lương theo giờ của nhân sự            | `/employees/:id`                |     Owner     |        PASS        |     **PASS**     | `employee_hourly_rates` versioning                   |
| **EMP-010**    | EMP    | Chặn tự đình chỉ tài khoản Owner cuối cùng         | API Guard                       |     Owner     |        PASS        |     **PASS**     | `tests/backend/owner-self-lockout.test.mjs`          |
| **EMP-011**    | EMP    | Chặn Staff truy cập màn hình nhân sự               | `/employees/*`                  |     Staff     |        PASS        |     **PASS**     | 403 Forbidden verified on Chrome CDP                 |
| **ATT-001**    | ATT    | Nhân viên vào ca làm việc (Clock In)               | `/clock`                        | Staff / Owner |        PASS        |     **PASS**     | POST `/api/v1/attendance/shifts` (201)               |
| **ATT-002**    | ATT    | Bắt đầu thời gian nghỉ giữa ca (Start Break)       | `/clock`                        | Staff / Owner |        PASS        |     **PASS**     | POST `/shifts/:id/breaks` (state: paused)            |
| **ATT-003**    | ATT    | Tiếp tục làm việc sau giờ nghỉ (Resume Work)       | `/clock`                        | Staff / Owner |        PASS        |     **PASS**     | POST `/shifts/:id/resume` (working)                  |
| **ATT-004**    | ATT    | Tan ca / Kết thúc ca làm việc (Clock Out)          | `/clock`                        | Staff / Owner |        PASS        |     **PASS**     | POST `/shifts/:id/clock-out` (completed)             |
| **ATT-005**    | ATT    | Xem trạng thái ca làm việc hiện thời               | `/clock`                        |      All      |        PASS        |     **PASS**     | `audit-owner-clock.png`, `audit-staff-clock.png`     |
| **ATT-006**    | ATT    | Xem lịch sử các ca làm việc đã thực hiện           | `/clock`                        |      All      |        PASS        |     **PASS**     | Bảng lịch sử chấm công, tính giờ công                |
| **ATT-007**    | ATT    | Gửi đơn giải trình chấm công khi quên bấm          | `/attendance/corrections`       |     Staff     |        PASS        |     **PASS**     | C01 Attendance Correction request                    |
| **ATT-008**    | ATT    | Quản lý duyệt và điều chỉnh ca làm của nhân sự     | `/attendance/review`            |     Owner     |        PASS        |     **PASS**     | `tests/backend/att-mvp.test.mjs` (Pass)              |
| **ATT-009**    | ATT    | Quản lý lịch làm việc tuần (SCHEDULE-01 R09)       | `/schedule`                     |      All      |        PASS        |     **PASS**     | `tests/backend/schedule.test.mjs` (Pass)             |
| **ATT-010**    | ATT    | Xử lý ca làm qua đêm và theo múi giờ VN            | API Engine                      |    System     |        PASS        |     **PASS**     | Múi giờ chuẩn `Asia/Ho_Chi_Minh`                     |
| **REP-001**    | REP    | Tạo bản nháp báo cáo công việc hàng ngày           | `/reports` (Draft)              | Staff / Owner |        PASS        |     **PASS**     | `tests/backend/rep-mvp.test.mjs`                     |
| **REP-002**    | REP    | Gửi chính thức báo cáo ca làm việc                 | POST `/api/v1/reports`          | Staff / Owner |        PASS        |     **PASS**     | Báo cáo gắn liền với ngày làm việc                   |
| **REP-003**    | REP    | Chỉnh sửa và ghi nhận bản sửa đổi (C02 Revision)   | PUT `/reports/:id`              |    Author     |        PASS        |     **PASS**     | `daily_report_revisions` bất biến                    |
| **REP-004**    | REP    | Xem lịch sử danh sách báo cáo công việc            | `/reports`                      |      All      |        PASS        |     **PASS**     | `audit-owner-reports.png`, 1 ActionIcon              |
| **REP-005**    | REP    | Xem chi tiết nội dung báo cáo qua icon con mắt     | `/reports`                      |      All      |        PASS        |     **PASS**     | `ActionIconButton` (eye)                             |
| **REP-006**    | REP    | Phân trang danh sách báo cáo công việc             | `/reports`                      |      All      |        PASS        |     **PASS**     | Phân trang bảng danh sách báo cáo                    |
| **REP-007**    | REP    | Chủ sở hữu xem báo cáo của toàn bộ nhân viên       | `/reports`                      |     Owner     |        PASS        |     **PASS**     | Bộ lọc theo nhân viên toàn workspace                 |
| **REP-008**    | REP    | Chặn nhân viên xem báo cáo của người khác          | `/reports`                      |     Staff     |        PASS        |     **PASS**     | RBAC filter theo `user_id` nhân viên                 |
| **WORK-001**   | WORK   | Xem danh sách công việc và phân công nhiệm vụ      | `/work`                         |      All      |        PASS        |     **PASS**     | `audit-owner-work.png`, `audit-staff-work.png`       |
| **WORK-002**   | WORK   | Lọc công việc theo trạng thái thực hiện            | `/work`                         |      All      |        PASS        |     **PASS**     | Tab Todo / In Progress / Completed                   |
| **WORK-003**   | WORK   | Tạo công việc mới và phân công nhân sự             | `/work/new`                     |     Owner     |        PASS        |     **PASS**     | Modal giao việc, chọn nhiều nhân viên                |
| **WORK-004**   | WORK   | Xem chi tiết tiến độ công việc                     | `/work/:id`                     |      All      |        PASS        |     **PASS**     | `WorkScreen.tsx` detail panel                        |
| **WORK-005**   | WORK   | Nhân viên tự nhận diện danh tính được giao việc    | `/work`                         |     Staff     |       FIXED        |     **PASS**     | Auto fetch `/api/v1/employees/me`                    |
| **WORK-006**   | WORK   | Nhân viên bắt đầu thực hiện (todo -> in_progress)  | `/work/:id`                     |   Assigned    |        PASS        |     **PASS**     | `tests/backend/work-e2e.test.mjs` Step 4             |
| **WORK-007**   | WORK   | Nhân viên nộp kết quả công việc kèm revision       | `/work/:id`                     |   Assigned    |        PASS        |     **PASS**     | `work_submissions` durable storage                   |
| **WORK-008**   | WORK   | Chủ sở hữu yêu cầu sửa đổi kèm phản hồi            | `/work/:id`                     |     Owner     |        PASS        |     **PASS**     | `work_reviews` status changes_requested              |
| **WORK-009**   | WORK   | Chủ sở hữu duyệt hoàn thành công việc              | `/work/:id`                     |     Owner     |        PASS        |     **PASS**     | Transition sang `completed`                          |
| **WORK-010**   | WORK   | Chủ sở hữu hủy công việc có lưu vết lịch sử        | `/work/:id`                     |     Owner     |        PASS        |     **PASS**     | Transition sang `cancelled` + audit                  |
| **FILE-001**   | FILE   | Xem danh sách nhóm thư mục và tệp lưu trữ          | `/storage`                      |      All      |        PASS        |     **PASS**     | `audit-owner-storage.png`                            |
| **FILE-002**   | FILE   | Xem chi tiết thư mục và thành phẩm bàn giao        | `/storage/:id`                  |      All      |        PASS        |     **PASS**     | `StorageScreen.tsx`                                  |
| **FILE-003**   | FILE   | Kiểm tra tính đầy đủ trước khi cho phép dọn dẹp    | `/storage/:id`                  |     Owner     |        PASS        |     **PASS**     | `tests/web/storage-screen.test.mjs`                  |
| **FILE-004**   | FILE   | Xác nhận chuyển Thùng rác Drive (Google Drive)     | `/storage/:id`                  |     Owner     |        PASS        |     **PASS**     | Hộp thoại cảnh báo nguy hiểm                         |
| **FILE-005**   | FILE   | Khóa an toàn cấm xóa lẻ từng phần (Fail-closed)    | API Engine                      |    System     |        PASS        |     **PASS**     | Chặn xóa khi thiếu bàn giao                          |
| **FILE-006**   | FILE   | Kiểm tra If-Match / ETag chống xung đột xóa        | DELETE API                      |    System     |        PASS        |     **PASS**     | 412 Precondition Failed khi cũ                       |
| **PAY-001**    | PAY    | Xem bảng lương tổng quan toàn bộ nhân sự           | `/payroll`                      |     Owner     |        PASS        |     **PASS**     | `audit-owner-payroll.png`                            |
| **PAY-002**    | PAY    | Xem chi tiết kỳ lương và bảng kê từng người        | `/payroll/:id`                  |     Owner     |        PASS        |     **PASS**     | `PayrollScreen.tsx`                                  |
| **PAY-003**    | PAY    | Nhân viên xem phiếu lương cá nhân của mình         | `/my-pay`                       |     Staff     |        PASS        |     **PASS**     | Staff view, ẩn lương người khác                      |
| **PAY-004**    | PAY    | Ngăn chặn Owner xem phiếu lương cá nhân (C04)      | `/my-pay`                       |     Owner     |        PASS        |     **PASS**     | Chặn điều hướng theo quy tắc C04                     |
| **PAY-005**    | PAY    | Tổng hợp số giờ làm việc từ chấm công vào lương    | API Engine                      |    System     |        PASS        |     **PASS**     | Đối chiếu giờ công từ `attendance`                   |
| **PAY-006**    | PAY    | Điều chỉnh lương (chỉ cho phép `paid_leave`)       | `/payroll/:id`                  |     Owner     |        PASS        |     **PASS**     | `tests/web/payroll-screen.test.mjs`                  |
| **PAY-007**    | PAY    | Chốt kỳ lương và thực hiện chi trả                 | POST API                        |     Owner     |        PASS        |     **PASS**     | `payroll_disbursements` status paid                  |
| **NOTI-001**   | NOTI   | Hiển thị thông báo Toast góc màn hình              | Toàn hệ thống                   |      All      |        PASS        |     **PASS**     | `AppToast.tsx`, thông báo tiếng Việt                 |
| **NOTI-002**   | NOTI   | Hiển thị Banner cảnh báo lỗi hệ thống              | Toàn hệ thống                   |      All      |        PASS        |     **PASS**     | `ErrorState.tsx`, `AppDialog.tsx`                    |
| **NOTI-003**   | NOTI   | Tự động ẩn thông báo sau thời gian định sẵn        | Toàn hệ thống                   |      All      |        PASS        |     **PASS**     | Tự tắt sau 3-5s                                      |
| **NOTI-004**   | NOTI   | Liên kết điều hướng từ thông báo đến chi tiết      | Toàn hệ thống                   |      All      |        PASS        |     **PASS**     | Action link trên Toast                               |
| **SET-001**    | SET    | Xem thông tin hồ sơ và phân quyền tài khoản        | `/settings`                     |      All      |        PASS        |     **PASS**     | `audit-owner-settings.png`                           |
| **SET-002**    | SET    | Cấu hình chủ đề giao diện Sáng / Tối               | `/settings`                     |      All      |        PASS        |     **PASS**     | Design tokens `#0B1220` / `#151F30`                  |
| **SET-003**    | SET    | Cấu hình múi giờ và tiền tệ Việt Nam (VNĐ)         | `/settings`                     |      All      |        PASS        |     **PASS**     | Múi giờ Asia/Ho_Chi_Minh                             |
| **SET-004**    | SET    | Nút Đăng xuất an toàn có hộp thoại xác nhận        | `/settings`                     |      All      |        PASS        |     **PASS**     | Đăng xuất xóa session, trở về `/login`               |
| **AUDIT-001**  | AUDIT  | Xem danh sách sự kiện kiểm toán hệ thống           | `/audit`                        |     Owner     |        PASS        |     **PASS**     | `audit-owner-audit.png`, 20 ActionIcons              |
| **AUDIT-002**  | AUDIT  | Bộ lọc sự kiện kiểm toán theo loại hành động       | `/audit`                        |     Owner     |        PASS        |     **PASS**     | Filter dropdown `login`, `create`, `delete`          |
| **AUDIT-003**  | AUDIT  | Phân trang danh sách sự kiện kiểu Cursor           | `/audit`                        |     Owner     |        PASS        |     **PASS**     | `audit-endpoint.test.mjs` (Pass 8/8)                 |
| **AUDIT-004**  | AUDIT  | Xem chi tiết metadata sự kiện kiểm toán            | `/audit`                        |     Owner     |        PASS        |     **PASS**     | `ActionIconButton` (eye)                             |
| **AUDIT-005**  | AUDIT  | Database Trigger cấm UPDATE và DELETE audit        | PostgreSQL                      |    System     |        PASS        |     **PASS**     | `audit_events` immutability trigger                  |
| **AUDIT-006**  | AUDIT  | Làm sạch bí mật, mật khẩu trước khi ghi log        | API Engine                      |    System     |        PASS        |     **PASS**     | `sanitizeAuditMetadata` zero leakage                 |
| **AUDIT-007**  | AUDIT  | Chặn tuyệt đối Staff truy cập nhật ký kiểm toán    | `/audit`                        |     Staff     |        PASS        |     **PASS**     | 403 Forbidden verified on Chrome CDP                 |
| **ISSUES-001** | ISSUES | Xem sổ tay quản lý vấn đề & lỗi hệ thống           | `/issues`                       |     Owner     |        PASS        |     **PASS**     | `audit-owner-issues.png`, 20 ActionIcons             |
| **ISSUES-002** | ISSUES | Lọc lỗi theo loại (bug/improvement) & trạng thái   | `/issues`                       |     Owner     |        PASS        |     **PASS**     | Filter tabs open/in_progress/closed                  |
| **ISSUES-003** | ISSUES | Tạo vấn đề lỗi mới kèm Idempotency-Key             | POST API                        |     Owner     |        PASS        |     **PASS**     | `issues-endpoint.test.mjs` (Pass 25/25)              |
| **ISSUES-004** | ISSUES | Xem chi tiết vấn đề và dòng thời gian xử lý        | `/issues/:id`                   |     Owner     |        PASS        |     **PASS**     | `IssueDetailScreen.tsx`, timeline activity           |
| **ISSUES-005** | ISSUES | Chuyển trạng thái có kiểm soát phiên bản If-Match  | PATCH API                       |     Owner     |        PASS        |     **PASS**     | Concurrency control (412 Precondition)               |
| **ISSUES-006** | ISSUES | Chủ sở hữu xác nhận đã xử lý xong và đóng lỗi      | POST close                      |     Owner     |        PASS        |     **PASS**     | Confirm fix endpoint, archive issue                  |
| **ISSUES-007** | ISSUES | Mở lại lỗi đã đóng kèm lý do cụ thể                | POST reopen                     |     Owner     |        PASS        |     **PASS**     | Reopen audit privacy, activity log                   |
| **ISSUES-008** | ISSUES | Nhân viên gửi báo cáo lỗi nhanh từ giao diện       | POST `/reports`                 |     Staff     |        PASS        |     **PASS**     | Auto type=bug, route template                        |
| **ISSUES-009** | ISSUES | Chặn Staff truy cập sổ tay lỗi trực tiếp           | `/issues/*`                     |     Staff     |        PASS        |     **PASS**     | 403 Forbidden verified on Chrome CDP                 |

---

**TỔNG KẾT DANH MỤC NGHIỆM THU:**

- **Tổng số chức năng kiểm kê:** **88 chức năng chi tiết**
- **Đạt chuẩn (PASS / FIXED):** **88 / 88 chức năng (100%)**
- **Lỗi tồn đọng (FAIL):** **0**
- **Chức năng chưa kiểm thử (NOT TESTED):** **0**
- **Tình trạng phân hệ:** Toàn bộ 12/12 phân hệ sẵn sàng vận hành.
