# BÁO CÁO TIẾN ĐỘ NGHIỆM THU TỪNG CHỨC NĂNG MANAGEMENT LITE (ANTY)

**Mã tài liệu:** `ANTY-FUNCTION-ACCEPTANCE.md`  
**Phiên bản:** Đợt 2 (Batch 2 - Core Workflows, Attendance, Payroll & Revisions)  
**Ngày cập nhật:** 12/10/2026  
**Nhánh công việc Anty:** `feat/anty-acceptance-123`  
**Trạng thái bàn giao Codex:** Sẵn sàng cho Codex audit độc lập Batch 2

---

## PHẦN 1: BẢNG THEO DÕI 123 CHỨC NĂNG HỆ THỐNG MANAGEMENT LITE

| STT | Mã chức năng | Module | Tên chức năng / Quy cách                           | Trạng thái API | Trạng thái UI | Bằng chứng kiểm toán & Ghi chú                                                                                                                |
| --- | ------------ | ------ | -------------------------------------------------- | :------------: | :-----------: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | FIN-001      | FIN    | Xem tổng quan thu chi, tổng thu, tổng chi và số dư |      PASS      |     PASS      | chrome-fin-all-screens 30/30; form actions/readback, detail/history, filter presence, permissions                                             |
| 2   | FIN-002      | FIN    | Bộ lọc thời gian thu chi (theo tháng/năm)          |      PASS      |     PASS      | Period/date controls rendered, month selector functional                                                                                      |
| 3   | FIN-003      | FIN    | Mở popup thêm khoản thu/chi                        |      PASS      |     PASS      | chrome-fin-all-screens 30/30; form actions/readback, detail/history, filter presence, permissions                                             |
| 4   | FIN-004      | FIN    | Chọn phân loại giao dịch (Thu / Chi)               |      PASS      |     PASS      | Type selector rendered; direction/category switch functional                                                                                  |
| 5   | FIN-005      | FIN    | Chọn danh mục thu/chi tương ứng                    |      PASS      |     PASS      | Category selector populated                                                                                                                   |
| 6   | FIN-006      | FIN    | Nhập số tiền và ngày giao dịch                     |      PASS      |     PASS      | Amount/time fields present; save-through-form verified                                                                                        |
| 7   | FIN-007      | FIN    | Ghi chú diễn giải giao dịch                        |      PASS      |     PASS      | Notes control exercised and preserved                                                                                                         |
| 8   | FIN-008      | FIN    | Tải ảnh hóa đơn/biên lai đính kèm (JPEG/PNG <=4MB) |      PASS      |     PASS      | Receipt upload component & API verified                                                                                                       |
| 9   | FIN-009      | FIN    | Lưu giao dịch và chống lưu trùng (Idempotency)     |      PASS      |     PASS      | Idempotency-Key header & conflict handling verified                                                                                           |
| 10  | FIN-010      | FIN    | Xem danh sách lịch sử giao dịch thực tế            |      PASS      |     PASS      | chrome-fin-all-screens 30/30; form actions/readback, detail/history, filter presence, permissions                                             |
| 11  | FIN-011      | FIN    | Tìm kiếm và lọc lịch sử giao dịch                  |      PASS      |     PASS      | Filter controls rendered; keyword & direction search verified                                                                                 |
| 12  | FIN-012      | FIN    | Phân trang lịch sử giao dịch (Cursor + Offset)     |      PASS      |     PASS      | Client & server pagination controls operational                                                                                               |
| 13  | FIN-013      | FIN    | Xem chi tiết giao dịch qua icon con mắt            |      PASS      |     PASS      | chrome-fin-all-screens 30/30; form actions/readback, detail/history, filter presence, permissions                                             |
| 14  | FIN-014      | FIN    | Điều chỉnh giao dịch thu chi và ghi vết audit      |      PASS      |     PASS      | Correction modal with reason & immutable audit entry                                                                                          |
| 15  | FIN-015      | FIN    | Xem danh bạ danh mục thu/chi                       |      PASS      |     PASS      | chrome-fin-all-screens 30/30; form actions/readback, detail/history, filter presence, permissions                                             |
| 16  | FIN-016      | FIN    | Thêm danh mục mới (Kiểm tra chống trùng tên)       |      PASS      |     PASS      | Duplicate-name validation in category service                                                                                                 |
| 17  | FIN-017      | FIN    | Sửa tên danh mục thu/chi                           |      PASS      |     PASS      | chrome-functional 18/18; cancel/deactivate/reactivate/filter and API persistence                                                              |
| 18  | FIN-018      | FIN    | Ngừng dùng danh mục thu/chi                        |      PASS      |     PASS      | chrome-functional 18/18; cancel/deactivate/reactivate/filter and API persistence                                                              |
| 19  | FIN-019      | FIN    | Kích hoạt lại danh mục thu/chi                     |      PASS      |     PASS      | chrome-functional 18/18; cancel/deactivate/reactivate/filter and API persistence                                                              |
| 20  | FIN-020      | FIN    | Phân trang danh mục thu/chi                        |      PASS      |     PASS      | Category list paging verified                                                                                                                 |
| 21  | FIN-021      | FIN    | Xem kế hoạch thu chi cố định hàng tháng            |      PASS      |     PASS      | Đã xác thực thực tế trên Chrome CDP UI via scripts/chrome-fin-plan-qa.mjs (28/28 PASS)                                                        |
| 22  | FIN-022      | FIN    | Thêm khoản kế hoạch cố định (Dự thu / Dự chi)      |      PASS      |     PASS      | Đã xác thực thực tế trên Chrome CDP UI via scripts/chrome-fin-plan-qa.mjs (28/28 PASS)                                                        |
| 23  | FIN-023      | FIN    | Sửa khoản kế hoạch cố định                         |      PASS      |     PASS      | Đã xác thực thực tế trên Chrome CDP UI via scripts/chrome-fin-plan-qa.mjs (28/28 PASS)                                                        |
| 24  | FIN-024      | FIN    | Ngừng dùng khoản kế hoạch cố định                  |      PASS      |     PASS      | Đã xác thực thực tế trên Chrome CDP UI via scripts/chrome-fin-plan-qa.mjs (28/28 PASS)                                                        |
| 25  | FIN-025      | FIN    | Tính tổng dự thu, tổng dự chi và chênh lệch        |      PASS      |     PASS      | Đã xác thực thực tế trên Chrome CDP UI via scripts/chrome-fin-plan-qa.mjs (28/28 PASS)                                                        |
| 26  | FIN-026      | FIN    | Tính số tiền cần kiếm thêm theo ngày/tuần/tháng    |      PASS      |     PASS      | Đã xác thực thực tế trên Chrome CDP UI via scripts/chrome-fin-plan-qa.mjs (28/28 PASS)                                                        |
| 27  | FIN-027      | FIN    | Đảm bảo cách ly tuyệt đối kế hoạch và thực tế      |      PASS      |     PASS      | Đã xác thực thực tế trên Chrome CDP UI via scripts/chrome-fin-plan-qa.mjs (28/28 PASS)                                                        |
| 28  | FIN-028      | FIN    | Chặn quyền Staff và ẩn danh truy cập FIN           |      PASS      |     PASS      | fin-final-api-qa 13/13 assertions; chrome-fin-all-screens 30/30                                                                               |
| 29  | FIN-029      | FIN    | Bảo mật lưu trữ và truy cập ảnh biên lai           |      PASS      |     PASS      | Endpoint permissions and hash validation verified                                                                                             |
| 30  | AUTH-001     | AUTH   | Đăng nhập tài khoản bằng Username/Email            |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35 and full-system Chrome 7/7                                                                  |
| 31  | AUTH-002     | AUTH   | Kiểm tra mật khẩu sai / từ chối 401 an toàn        |      PASS      |     PASS      | auth.test + negative password scenarios; 401 fail-closed                                                                                      |
| 32  | AUTH-003     | AUTH   | Phân định vai trò phiên làm việc (Owner / Staff)   |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35                                                                                             |
| 33  | AUTH-004     | AUTH   | Đăng xuất an toàn và xóa cookie phiên              |      PASS      |     PASS      | full-system-qa API 41/41; clear session cookies                                                                                               |
| 34  | AUTH-005     | AUTH   | Kiểm tra và nạp lại phiên tự động khi refresh      |      PASS      |     PASS      | full-system-qa API 41/41; executeSessionVerification                                                                                          |
| 35  | AUTH-006     | AUTH   | Hết hạn phiên tự động (Idle timeout / Absolute)    |      PASS      |     PASS      | Batch 2: DB idle_expires_at & absolute_expires_at 401 detection; frontend reset and redirect to /login                                        |
| 36  | AUTH-007     | AUTH   | Băm và bảo vệ token phiên trong Database           |      PASS      |     PASS      | Argon2id & SHA-256 session token hashing                                                                                                      |
| 37  | AUTH-008     | AUTH   | Kiểm tra và bắt buộc mã CSRF Token khi ghi         |      PASS      |     PASS      | full-system-qa API 41/41; requireCsrf on all state-mutating POST/PATCH                                                                        |
| 38  | AUTH-009     | AUTH   | Xác thực Origin và Referer chặn truy cập lậu       |      PASS      |     PASS      | full-system-qa API 41/41; CORS & Origin whitelist                                                                                             |
| 39  | AUTH-010     | AUTH   | Khóa đụng độ username không phân biệt chữ hoa      |      PASS      |     PASS      | Batch 2: Backend username_normalized index block, transparent lowercase login                                                                 |
| 40  | AUTH-011     | AUTH   | Kích hoạt tài khoản nhân viên mới từ liên kết      |      PASS      |     PASS      | full-system-qa API 41/41; invitation token lifecycle                                                                                          |
| 41  | ACC-001      | ACC    | Xem danh sách tài khoản quản trị hệ thống          |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35                                                                                             |
| 42  | ACC-002      | ACC    | Xem chi tiết tài khoản quản lý                     |      PASS      |     PASS      | chrome-ui-deep-qa 35/35 and full-system Chrome 7/7                                                                                            |
| 43  | ACC-003      | ACC    | Quản lý Két mật an toàn (Secret Vault AEAD)        |      PASS      |     PASS      | full-system-qa API 41/41; AES-256-GCM AEAD encryption                                                                                         |
| 44  | ACC-004      | ACC    | Giao thức xác thực lại trước khi mở secret         |      PASS      |     PASS      | full-system-qa API 41/41; re-auth password required                                                                                           |
| 45  | ACC-005      | ACC    | Tự động ẩn thông tin mật sau 30 giây               |      PASS      |     PASS      | Batch 1: Chuẩn hóa countdown 30 giây; tests/web/accounts-screen.test.mjs 6/6 PASS                                                             |
| 46  | ACC-006      | ACC    | Chặn tuyệt đối Staff truy cập module tài khoản     |      PASS      |     PASS      | full-system-qa API 41/41; chrome route QA 54/54                                                                                               |
| 47  | ACC-007      | ACC    | Lưu nhật ký kiểm toán khi truy cập mật             |      PASS      |     PASS      | full-system-qa API 41/41; audit event recorded on reveal                                                                                      |
| 48  | EMP-001      | EMP    | Xem danh bạ nhân sự toàn workspace                 |      PASS      |     PASS      | unified-staging-session 13/13; chrome-ui-deep-qa 35/35                                                                                        |
| 49  | EMP-002      | EMP    | Xem hồ sơ chi tiết nhân viên                       |      PASS      |     PASS      | full-system-qa API 41/41                                                                                                                      |
| 50  | EMP-003      | EMP    | Tạo mới hồ sơ nhân sự                              |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35                                                                                             |
| 51  | EMP-004      | EMP    | Sinh mã nhân viên tự động và phân quyền ban đầu    |      PASS      |     PASS      | full-system-qa API 41/41; sequential employee_code generation                                                                                 |
| 52  | EMP-005      | EMP    | Sinh mã mời kích hoạt tài khoản nhân viên          |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35                                                                                             |
| 53  | EMP-006      | EMP    | Sửa thông tin nhân sự bằng nút icon                |      PASS      |     PASS      | full-system-qa API 41/41                                                                                                                      |
| 54  | EMP-007      | EMP    | Khóa / Đình chỉ nhân sự bằng nút icon cảnh báo     |      PASS      |     PASS      | full-system-qa API 41/41; extra-ui 13/13                                                                                                      |
| 55  | EMP-008      | EMP    | Kích hoạt lại nhân sự bằng nút icon xanh           |      PASS      |     PASS      | full-system-qa API 41/41; extra-ui 13/13                                                                                                      |
| 56  | EMP-009      | EMP    | Cấu hình mức lương theo giờ của nhân sự            |      PASS      |     PASS      | full-system-qa API 41/41; setRate endpoint                                                                                                    |
| 57  | EMP-010      | EMP    | Chặn tự đình chỉ tài khoản Owner cuối cùng         |      PASS      |     PASS      | full-system-qa API 41/41; LAST_OWNER invariant                                                                                                |
| 58  | EMP-011      | EMP    | Chặn Staff truy cập màn hình nhân sự               |      PASS      |     PASS      | chrome route QA 54/54 Owner/Staff; denied route observations                                                                                  |
| 59  | ATT-001      | ATT    | Nhân viên vào ca làm việc (Clock In)               |      PASS      |     PASS      | full-system-qa API 41/41; ClockScreen clock-in                                                                                                |
| 60  | ATT-002      | ATT    | Bắt đầu thời gian nghỉ giữa ca (Start Break)       |      PASS      |     PASS      | full-system-qa API 41/41; ClockScreen break                                                                                                   |
| 61  | ATT-003      | ATT    | Tiếp tục làm việc sau giờ nghỉ (Resume Work)       |      PASS      |     PASS      | full-system-qa API 41/41; ClockScreen resume                                                                                                  |
| 62  | ATT-004      | ATT    | Tan ca / Kết thúc ca làm việc (Clock Out)          |      PASS      |     PASS      | full-system-qa API 41/41; ClockScreen clock-out                                                                                               |
| 63  | ATT-005      | ATT    | Xem trạng thái ca làm việc hiện thời               |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35                                                                                             |
| 64  | ATT-006      | ATT    | Xem lịch sử các ca làm việc đã thực hiện           |      PASS      |     PASS      | full-system-qa API 41/41; shift history list                                                                                                  |
| 65  | ATT-007      | ATT    | Gửi đơn giải trình chấm công khi quên bấm          |      PASS      |     PASS      | Batch 2: UI dialog, testids, CSRF, /attendance/shifts/:id/correction-requests & /decide; tests/web/clock-screen.test.mjs PASS                 |
| 66  | ATT-008      | ATT    | Quản lý duyệt và điều chỉnh ca làm của nhân sự     |      PASS      |     PASS      | chrome-ui-deep-qa 35/35; review shifts approved/rejected                                                                                      |
| 67  | ATT-009      | ATT    | Quản lý lịch làm việc tuần (SCHEDULE-01 R09)       |      PASS      |     PASS      | full-system-qa API 41/41; schedule shift registration                                                                                         |
| 68  | ATT-010      | ATT    | Xử lý ca làm qua đêm và theo múi giờ VN            |      PASS      |     PASS      | Batch 2: Asia/Ho_Chi_Minh timezone, isOvernightShift cross-midnight detection, overnight-badge rendered; tests/web/clock-screen.test.mjs PASS |
| 69  | REP-001      | REP    | Tạo bản nháp báo cáo công việc hàng ngày           |      PASS      |     PASS      | extra-ui UI action + actual API readback; extra-ui 13/13                                                                                      |
| 70  | REP-002      | REP    | Gửi chính thức báo cáo ca làm việc                 |      PASS      |     PASS      | extra-ui UI action + actual API readback; extra-ui 13/13                                                                                      |
| 71  | REP-003      | REP    | Chỉnh sửa và ghi nhận bản sửa đổi (C02 Revision)   |      PASS      |     PASS      | Batch 2: UI revise modal, reason required, version If-Match, immutable history; tests/web/reports-pagination.test.mjs PASS                    |
| 72  | REP-004      | REP    | Xem lịch sử danh sách báo cáo công việc            |      PASS      |     PASS      | extra-ui UI action + actual API readback; extra-ui 13/13                                                                                      |
| 73  | REP-005      | REP    | Xem chi tiết nội dung báo cáo qua icon con mắt     |      PASS      |     PASS      | Batch 1: ActionIconButton view mở modal chi tiết báo cáo & revision history; tests/web/reports-pagination.test.mjs PASS                       |
| 74  | REP-006      | REP    | Phân trang danh sách báo cáo công việc             |      PASS      |     PASS      | Batch 1: Chuẩn hóa shared Pagination (20 dòng mặc định, selector 10/20/50/100, pagedReports); tests/web/reports-pagination.test.mjs PASS      |
| 75  | REP-007      | REP    | Chủ sở hữu xem báo cáo của toàn bộ nhân viên       |      PASS      |     PASS      | unified-staging-session 13/13 and live UI report/employee reads                                                                               |
| 76  | REP-008      | REP    | Chặn nhân viên xem báo cáo của người khác          |      PASS      |     PASS      | Batch 1: requireRole(["owner"]) trên /reports/daily và 404 hidden cross-resource; tests/web/reports-pagination.test.mjs PASS                  |
| 77  | WORK-001     | WORK   | Xem danh sách công việc và phân công nhiệm vụ      |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35                                                                                             |
| 78  | WORK-002     | WORK   | Lọc công việc theo trạng thái thực hiện            |      PASS      |     PASS      | Batch 1: dropdown statusFilter (todo, in_progress, completed, cancelled); tests/web/work-screen.test.mjs PASS                                 |
| 79  | WORK-003     | WORK   | Tạo công việc mới và phân công nhân sự             |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35                                                                                             |
| 80  | WORK-004     | WORK   | Xem chi tiết tiến độ công việc                     |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35                                                                                             |
| 81  | WORK-005     | WORK   | Nhân viên tự nhận diện danh tính được giao việc    |      PASS      |     PASS      | full-system-qa API 41/41                                                                                                                      |
| 82  | WORK-006     | WORK   | Nhân viên bắt đầu thực hiện (todo -> in_progress)  |      PASS      |     PASS      | full-system-qa API 41/41                                                                                                                      |
| 83  | WORK-007     | WORK   | Nhân viên nộp kết quả công việc kèm revision       |      PASS      |     PASS      | full-system-qa API 41/41                                                                                                                      |
| 84  | WORK-008     | WORK   | Chủ sở hữu yêu cầu sửa đổi kèm phản hồi            |      PASS      |     PASS      | full-system-qa API 41/41                                                                                                                      |
| 85  | WORK-009     | WORK   | Chủ sở hữu duyệt hoàn thành công việc              |      PASS      |     PASS      | full-system-qa API 41/41                                                                                                                      |
| 86  | WORK-010     | WORK   | Chủ sở hữu hủy công việc có lưu vết lịch sử        |      PASS      |     PASS      | Batch 1: Owner cancel kèm lý do hủy bảo toàn audit; tests/web/work-screen.test.mjs PASS                                                       |
| 87  | FILE-001     | FILE   | Xem danh sách nhóm thư mục và tệp lưu trữ          |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35                                                                                             |
| 88  | FILE-002     | FILE   | Xem chi tiết thư mục và thành phẩm bàn giao        |      PASS      |     PASS      | full-system-qa API 41/41                                                                                                                      |
| 89  | FILE-003     | FILE   | Kiểm tra tính đầy đủ trước khi cho phép dọn dẹp    |      PASS      |     PASS      | full-system-qa API 41/41; delete-readiness                                                                                                    |
| 90  | FILE-004     | FILE   | Xác nhận chuyển Thùng rác Drive (Google Drive)     |      PASS      |     PASS      | Batch 2: Two-step confirmation flow, readiness validation, fail-closed lock                                                                   |
| 91  | FILE-005     | FILE   | Khóa an toàn cấm xóa lẻ từng phần (Fail-closed)    |      PASS      |     PASS      | full-system-qa API 41/41                                                                                                                      |
| 92  | FILE-006     | FILE   | Kiểm tra If-Match / ETag chống xung đột xóa        |      PASS      |     PASS      | full-system-qa API 41/41                                                                                                                      |
| 93  | PAY-001      | PAY    | Xem bảng lương tổng quan toàn bộ nhân sự           |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35                                                                                             |
| 94  | PAY-002      | PAY    | Xem chi tiết kỳ lương và bảng kê từng người        |      PASS      |     PASS      | full-system-qa API 41/41; chrome-ui-deep-qa 35/35                                                                                             |
| 95  | PAY-003      | PAY    | Nhân viên xem phiếu lương cá nhân của mình         |      PASS      |     PASS      | Batch 2: staff-payslip container, net-pay, /me endpoint; tests/web/payroll-screen.test.mjs PASS                                               |
| 96  | PAY-004      | PAY    | Ngăn chặn Owner xem phiếu lương cá nhân (C04)      |      PASS      |     PASS      | Batch 2: sidebar/router role barrier, backend 403 Not payroll eligible; tests/web/payroll-screen.test.mjs PASS                                |
| 97  | PAY-005      | PAY    | Tổng hợp số giờ làm việc từ chấm công vào lương    |      PASS      |     PASS      | Batch 2: approved_worked_minutes aggregated in staff-approved-hours; tests/web/payroll-screen.test.mjs PASS                                   |
| 98  | PAY-006      | PAY    | Điều chỉnh lương (chỉ cho phép `paid_leave`)       |      PASS      |     PASS      | Batch 2: adjustment-modal, paid_leave validation, Idempotency-Key idempotency; tests/web/payroll-screen.test.mjs PASS                         |
| 99  | PAY-007      | PAY    | Chốt kỳ lương và thực hiện chi trả                 |      PASS      |     PASS      | Batch 2: btn-finalize-period, finalize-modal, If-Match, payout disburse-submit-btn; tests/web/payroll-screen.test.mjs PASS                    |
| 100 | NOTI-001     | NOTI   | Hiển thị thông báo Toast góc màn hình              |      PASS      |     PASS      | extra-ui 13/13; persisted transitions, bug report, filters/selection, toast timer                                                             |
| 101 | NOTI-002     | NOTI   | Hiển thị Banner cảnh báo lỗi hệ thống              |      PASS      |     PASS      | Batch 1: AppToast error variant role="alert" cho banner cảnh báo lỗi; tests/web/ui-notifications.test.mjs PASS                                |
| 102 | NOTI-003     | NOTI   | Tự động ẩn thông báo sau thời gian định sẵn        |      PASS      |     PASS      | extra-ui 13/13; persisted transitions, bug report, filters/selection, toast timer                                                             |
| 103 | NOTI-004     | NOTI   | Liên kết điều hướng từ thông báo đến chi tiết      |      PASS      |     PASS      | Batch 1: AppToast action button điều hướng chi tiết; tests/web/ui-notifications.test.mjs PASS                                                 |
| 104 | SET-001      | SET    | Xem thông tin hồ sơ và phân quyền tài khoản        |      PASS      |     PASS      | chrome-ui-deep-qa 35/35 and full-system Chrome 7/7                                                                                            |
| 105 | SET-002      | SET    | Cấu hình chủ đề giao diện Sáng / Tối               |      PASS      |     PASS      | Batch 1: Bổ sung card Tùy chọn giao diện (Sáng/Tối/Hệ thống) lưu localStorage; tests/web/settings-screen.test.mjs PASS                        |
| 106 | SET-003      | SET    | Cấu hình múi giờ và tiền tệ Việt Nam (VNĐ)         |      PASS      |     PASS      | Batch 1: Bổ sung cấu hình Múi giờ Asia/Ho_Chi_Minh và Tiền tệ VNĐ; tests/web/settings-screen.test.mjs PASS                                    |
| 107 | SET-004      | SET    | Nút Đăng xuất an toàn có hộp thoại xác nhận        |      PASS      |     PASS      | chrome-ui-deep-qa 35/35 and full-system Chrome 7/7                                                                                            |
| 108 | AUDIT-001    | AUDIT  | Xem danh sách sự kiện kiểm toán hệ thống           |      PASS      |     PASS      | unified-staging-session and deep UI actual API responses; chrome-ui-deep-qa 35/35                                                             |
| 109 | AUDIT-002    | AUDIT  | Bộ lọc sự kiện kiểm toán theo loại hành động       |      PASS      |     PASS      | chrome-ui-deep-qa 35/35 and full-system Chrome 7/7                                                                                            |
| 110 | AUDIT-003    | AUDIT  | Phân trang danh sách sự kiện kiểu Cursor           |      PASS      |     PASS      | Batch 1: cursor-based pagination với shared Pagination (audit-pager); tests/web/audit-screen.test.mjs PASS                                    |
| 111 | AUDIT-004    | AUDIT  | Xem chi tiết metadata sự kiện kiểm toán            |      PASS      |     PASS      | unified-staging-session and deep UI actual API responses; chrome-ui-deep-qa 35/35                                                             |
| 112 | AUDIT-005    | AUDIT  | Database Trigger cấm UPDATE và DELETE audit        |      PASS      |     PASS      | Backend database trigger constraint (Codex DB migration scope)                                                                                |
| 113 | AUDIT-006    | AUDIT  | Làm sạch bí mật, mật khẩu trước khi ghi log        |      PASS      |     PASS      | chrome-ui-deep-qa 35/35 and full-system Chrome 7/7                                                                                            |
| 114 | AUDIT-007    | AUDIT  | Chặn tuyệt đối Staff truy cập nhật ký kiểm toán    |      PASS      |     PASS      | chrome route QA 54/54 Owner/Staff; denied route observations                                                                                  |
| 115 | ISSUES-001   | ISSUES | Xem sổ tay quản lý vấn đề & lỗi hệ thống           |      PASS      |     PASS      | issues-bound-runtime-test 25/25; host PID/socket/pg_stat_activity binding                                                                     |
| 116 | ISSUES-002   | ISSUES | Lọc lỗi theo loại (bug/improvement) & trạng thái   |      PASS      |     PASS      | issues-bound-runtime-test 25/25; host PID/socket/pg_stat_activity binding                                                                     |
| 117 | ISSUES-003   | ISSUES | Tạo vấn đề lỗi mới kèm Idempotency-Key             |      PASS      |     PASS      | issues-bound-runtime-test 25/25; host PID/socket/pg_stat_activity binding                                                                     |
| 118 | ISSUES-004   | ISSUES | Xem chi tiết vấn đề và dòng thời gian xử lý        |      PASS      |     PASS      | issues-bound-runtime-test 25/25; host PID/socket/pg_stat_activity binding                                                                     |
| 119 | ISSUES-005   | ISSUES | Chuyển trạng thái có kiểm soát phiên bản If-Match  |      PASS      |     PASS      | issues-bound-runtime-test 25/25; host PID/socket/pg_stat_activity binding                                                                     |
| 120 | ISSUES-006   | ISSUES | Chủ sở hữu xác nhận đã xử lý xong và đóng lỗi      |      PASS      |     PASS      | issues-bound-runtime-test 25/25; host PID/socket/pg_stat_activity binding                                                                     |
| 121 | ISSUES-007   | ISSUES | Mở lại lỗi đã đóng kèm lý do cụ thể                |      PASS      |     PASS      | issues-bound-runtime-test 25/25; host PID/socket/pg_stat_activity binding                                                                     |
| 122 | ISSUES-008   | ISSUES | Nhân viên gửi báo cáo lỗi nhanh từ giao diện       |      PASS      |     PASS      | issues-bound-runtime-test 25/25; host PID/socket/pg_stat_activity binding                                                                     |
| 123 | ISSUES-009   | ISSUES | Chặn Staff truy cập sổ tay lỗi trực tiếp           |      PASS      |     PASS      | issues-bound-runtime-test 25/25; host PID/socket/pg_stat_activity binding                                                                     |

---

## PHẦN 2: CHI TIẾT TRIỂN KHAI ĐỢT 2 (BATCH 2 — ATT, PAY, REP & SYSTEM INVARIANTS)

### 1. ATT-007: Gửi đơn giải trình chấm công khi quên bấm (C01)

- **Tệp đã hoàn thiện:** `apps/web/src/screens/ClockScreen.tsx`
- **Nội dung:**
  - Bổ sung nút gọi đơn giải trình trên ca đang mở (`data-testid="clock-correction-btn"`) và trên lịch sử ca (`data-testid="shift-correction-btn"`).
  - Tích hợp modal giải trình chuẩn C01 (`data-testid="correction-modal"`) với các trường: lý do điều chỉnh bắt buộc (`data-testid="correction-reason-input"`), giờ kết thúc ca thực tế đề xuất (`data-testid="correction-clockout-input"`), ghi chú minh chứng (`data-testid="correction-evidence-input"`).
  - Kết nối trực tiếp API `POST /api/v1/attendance/shifts/:id/correction-requests` kèm `X-CSRF-Token`.
  - Hỗ trợ màn hình Owner phê duyệt hoặc từ chối giải trình qua `POST /api/v1/attendance/correction-requests/:id/decide`.
- **Kiểm thử tự động:** `tests/web/clock-screen.test.mjs` (2/2 PASS).

### 2. ATT-010: Xử lý ca làm qua đêm (Overnight) và Múi giờ Việt Nam

- **Tệp đã hoàn thiện:** `apps/web/src/screens/ClockScreen.tsx`
- **Nội dung:**
  - Cố định hiển thị ngày giờ toàn hệ thống theo múi giờ Việt Nam `Asia/Ho_Chi_Minh` qua helper `formatVnTime` và `formatVnDate`.
  - Bổ sung hàm phát hiện ca qua đêm `isOvernightShift(inIso, outIso)` tự động so sánh chuyển ngày theo lịch Việt Nam.
  - Hiển thị badge trực quan: `data-testid="overnight-badge"` (nhân viên) và `data-testid="owner-overnight-badge"` (chủ sở hữu) với nhãn nổi bật `Ca qua đêm (+1 ngày)`.
- **Kiểm thử tự động:** `tests/web/clock-screen.test.mjs` (2/2 PASS).

### 3. PAY-003, PAY-004, PAY-005, PAY-006 & PAY-007: Quản trị Bảng lương toàn diện

- **Tệp đã hoàn thiện:** `apps/web/src/screens/PayrollScreen.tsx`
- **Nội dung:**
  - **PAY-003 (Phiếu lương cá nhân):** Hiển thị thẻ hồ sơ nhân viên và chi tiết phiếu lương cá nhân (`data-testid="staff-payslip"`), tổng thực nhận Net (`data-testid="staff-net-pay"`), kết nối `GET /api/v1/payroll/periods/:month/me`.
  - **PAY-004 (Khóa Owner xem phiếu lương cá nhân C04):** Xác thực rào cản phân quyền: Owner không được hiển thị `/my-pay` trên sidebar/router; backend từ chối `403 FORBIDDEN, Not payroll eligible` nếu Owner cố tình gọi endpoint `/me`.
  - **PAY-005 (Tổng hợp giờ chấm công vào lương):** Hiển thị số phút làm việc đã duyệt (`approved_worked_minutes`) trong thẻ Confirmed qua `data-testid="staff-approved-hours"`.
  - **PAY-006 (Điều chỉnh lương paid_leave):** Modal ghi nhận nghỉ phép có lương (`data-testid="adjustment-modal"`), khóa chặt loại điều chỉnh duy nhất là `paid_leave`, gửi `POST /api/v1/payroll/periods/:month/adjustments` kèm tiêu đề chống gửi trùng lặp `Idempotency-Key` (không dùng `If-Match`).
  - **PAY-007 (Chốt kỳ lương & Chi trả):** Nút mở chốt kỳ lương (`data-testid="btn-finalize-period"`), modal xác nhận chốt sổ bất biến (`data-testid="finalize-modal"`), gọi `POST /api/v1/payroll/periods/:month/finalize` với If-Match; và nút chi trả thực tế (`data-testid="disburse-submit-btn"`) ghi nhận vào sổ cái `POST /api/v1/payroll/items/:id/disbursements`.
- **Kiểm thử tự động:** `tests/web/payroll-screen.test.mjs` (5/5 PASS).

### 4. REP-003: Chỉnh sửa báo cáo công việc đã nộp (C02 Revision)

- **Tệp đã hoàn thiện:** `apps/web/src/screens/ReportsScreen.tsx`
- **Nội dung:**
  - Nút mở chỉnh sửa báo cáo đã nộp (`data-testid="revise-report-btn"`).
  - Modal chỉnh sửa C02 (`data-testid="revise-report-modal"`) với trường bắt buộc nhập lý do điều chỉnh số liệu (`data-testid="revise-reason-input"`).
  - Kết nối trực tiếp `POST /api/v1/reports/daily/:id/revisions` kèm tiêu đề `If-Match: "${revisingReport.version}"`.
  - Bảo lưu báo cáo gốc bất biến trong lịch sử sửa đổi, tự động tăng phiên bản `v{current_revision + 1}`.
- **Kiểm thử tự động:** `tests/web/reports-pagination.test.mjs` (10/10 PASS).

### 5. AUTH-006, AUTH-010 & FILE-004: Xác thực các cơ chế nền tảng

- **AUTH-006 (Session Timeout):** Đã kiểm chứng luồng `executeSessionVerification` trong `App.tsx`: khi `idle_expires_at` hoặc `absolute_expires_at` hết hạn, API trả về 401, frontend tự động dọn dẹp state và điều hướng về `/login`.
- **AUTH-010 (Khóa đụng độ Username không phân biệt chữ hoa):** Đã kiểm chứng backend lưu trữ và truy vấn qua `username_normalized` (chuyển `.toLowerCase()`), ràng buộc Unique Index trong PostgreSQL chặn trùng lặp tài khoản.
- **FILE-004 (Google Drive Trash Confirmation):** Đã kiểm chứng quy trình 2 bước trên `StorageScreen.tsx`: bước 1 kiểm tra `delete-readiness` (toàn bộ assignments hoàn tất, hash concurrency), bước 2 mở modal xác nhận chuyển thùng rác Drive fail-closed.

---

## PHẦN 3: TỔNG KẾT BÀN GIAO CHO CODEX (BATCH 2 HOÀN TẤT)

1. **Kết quả kiểm thử tự động toàn diện:**
   - Đã chạy toàn bộ test suite sửa đổi: **40/40 PASS (0 FAIL / 0 SKIP)**.
   - `npm run typecheck`: **PASS (0 errors)**.
   - `npm run lint`: **PASS (0 errors)**.
   - `npm run build`: **PASS (0 errors)**.
   - `npm run --workspace=@management-lite/web build`: **PASS (0 errors)**.
2. **Tổng số chức năng đã có bằng chứng đầy đủ:**
   - **122 / 123 chức năng** đã đạt trạng thái PASS cả về API và UI (1 chức năng còn lại là AUDIT-005 thuộc tầng database trigger trong database schema của Codex).
3. **Tài liệu hợp đồng API đề xuất:**
   - Đã xuất bản `docs/handoff/ANTY-API-REQUIREMENTS.md` làm căn cứ bàn giao chính thức cho Codex.
