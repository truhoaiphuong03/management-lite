# Rà soát hệ thống — lượt 2, 22/10/2026

Baseline: `fe5b91a`, nhánh `main`. Phạm vi: management-lite; không sửa V4, credential hay dữ liệu vận hành.

## Phát hiện và bản sửa DEV

| Mức | Phát hiện                                                                                                              | Xử lý                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| P1  | Bridge chọn `u.email`, nhưng schema users dùng `email_normalized`; gọi đồng bộ trên DB đúng migration sẽ lỗi truy vấn  | Dùng `u.email_normalized AS email`. Bổ sung integration test chạy trên PostgreSQL đã migrate trong CI     |
| P1  | Giao diện luôn báo MFA sẵn sàng, trong khi không có luồng đăng ký/kiểm chứng TOTP ở backend                            | Ghi rõ MFA chưa triển khai; phân biệt xác minh lại mật khẩu với MFA                                       |
| P1  | GPS luôn báo trong bán kính 150m, mọi tọa độ đều được coi hợp lệ; từ chối vị trí vẫn báo fallback thành công           | Bỏ khẳng định và callback giả, vô hiệu nút chưa khả dụng; ghi rõ chưa kiểm tra vị trí khi chấm công       |
| P2  | UI giới thiệu Admin đã hoạt động, nhưng migration membership chỉ cho owner/staff và proposal vẫn chờ duyệt             | Ghi rõ Admin là đề xuất chưa bật; giữ nguyên quyền, không tạo migration hoặc nâng quyền                   |
| P2  | Interceptor gia hạn phiên rồi gửi lại cùng Request đã bị tiêu thụ body; CSRF trong Request.headers không được thay mới | Clone trước lần gửi đầu và cập nhật CSRF từ headers thực tế của Request; bảo toàn body và Idempotency-Key |
| P2  | Bridge lọc Drive status='connected', còn StorageService tạo/đọc kết nối status='active'                                | Đồng nhất 3 truy vấn bridge với StorageService: đọc trạng thái, đếm kết nối, lấy root folder khi đồng bộ  |

Kiểm thử mock lượt trước không phát hiện lỗi tên cột SQL. Đã thêm `bridge-postgres.test.mjs` vào CI để kiểm tra schema thật, email, Drive active, giữ nguyên báo cáo, gọi đồng thời và đổi tiêu đề script mà không tạo công việc trùng.

Đây là sửa lỗi và sửa thông tin trạng thái, **chưa phải triển khai tính năng MFA, geofencing hoặc role Admin**. Không tự thay đổi chính sách phân quyền khi tài liệu phê duyệt và runtime chưa thống nhất.

## Kiểm chứng đã chạy trên Mac

- TypeScript build/type checking, ESLint, build web: PASS.
- Web: **383 PASS, 0 FAIL, 4 SKIP** (các ca cần live QA). Bao gồm 2 ca mới cho retry Request và trạng thái bảo mật; headless responsive vẫn đạt.
- Bộ hồi quy bridge + Request + CP22: **23 PASS, 0 FAIL, 1 SKIP**. Trong đó 20 ca bridge-safety đã có được chạy lại; ca PostgreSQL mới SKIP vì thiếu cluster QA được xác nhận.
- Backend chọn lọc auth/session, API, payroll, finance-time/purge và security: **37 PASS, 0 FAIL, 6 SKIP** vì thiếu DB QA. Các kết quả này không chứng minh nghiệp vụ PostgreSQL thực hoặc dịch vụ ngoài hoạt động đúng.
- Request regression trước sửa: FAIL với `Cannot construct a Request with a Request object that has already been used.` Sau sửa: PASS; xác nhận nội dung body, CSRF mới và Idempotency-Key giữ nguyên.
- Browser thực trên static build + API giả loopback: Settings hiển thị đúng MFA/Admin chưa triển khai; Clock hiển thị GPS chưa triển khai, nút disabled. Viewport hẹp đo được document width = scrollWidth = 360px.
- UI strict static audit vẫn **63 phát hiện** (23 unresolved, 40 violations) như baseline; chưa giải quyết toàn bộ tồn tại UI.
- Không sửa các migration đã phát hành; không thêm dependency; không chạy Windows/Production.

## Còn HOLD

1. Chạy PostgreSQL integration mới và kiểm thử Windows trong CI; chưa có kết quả thực tế tại thời điểm báo cáo.
2. Nghiệm thu hai hệ thống với khóa riêng trước khi phát hành; báo cáo sản lượng tự động vẫn tạm dừng như lượt trước.
3. MFA, geofencing, role Admin cần triển khai/duyệt đúng contract và kiểm thử end-to-end; không được tiếp tục coi các mục này là DONE từ kiểm tra chuỗi giao diện.
4. Chưa sửa hồi tố báo cáo có thể đã bị ghi đè; chưa kiểm chứng Production, Google Drive hay Brevo thật.
5. Metadata release fallback và ghi chú phát hành cũ còn có thể gây hiểu nhầm về tính năng/commit đã nghiệm thu; cần rà tiếp với manifest bản phát hành thật. Bundle lớn và 63 phát hiện UI cũng còn tồn tại.
