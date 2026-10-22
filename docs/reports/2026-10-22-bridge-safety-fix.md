# Sửa an toàn đồng bộ — 22/10/2026

## Kết quả DEV

- Bridge không sửa/xóa báo cáo ngày hoặc dùng tổng sản lượng để gán cho nhân viên đầu tiên. Trả `reports_synced: 0` cùng cảnh báo rõ ràng. Chỉ mở lại quy đổi báo cáo khi có hợp đồng dữ liệu theo sự kiện, nhân viên, ngày nghiệp vụ và lịch sử sửa; không suy diễn từ tổng hệ thống.
- Nhân sự thiếu email thật được bỏ qua kèm cảnh báo, không tạo danh tính email giả.
- Thiếu `HP_BRIDGE_SECRET` trả lỗi cấu hình, không dùng khóa chung. Mỗi môi trường chỉ gọi một endpoint; dev mặc định loopback, Production mặc định HTTPS. Không theo redirect mang khóa sang nơi khác; timeout bao phủ cả đọc response body.
- Phải có summary mới, hợp lệ và phản hồi nhận đủ nhân sự (`success`, `total_employees_received`, `workspace_connected`, các bộ đếm hợp lệ) trước khi ghi công việc cục bộ. Không fallback từ dữ liệu lỗi/cache thành lần đồng bộ thành công.
- Công việc chỉ sinh từ script thật, định danh bằng ID nguồn; khóa transaction theo workspace để tránh hai lần đồng bộ đồng thời tạo trùng. Giữ nhận diện các bản ghi cũ theo tiêu đề; không sửa nội dung công việc thủ công.
- Cache tách theo workspace; cache cũ chung không được sử dụng. Dữ liệu cache không biến trạng thái offline thành connected. Không bịa email, kết nối Drive hoặc số member từ dữ liệu fallback.
- `today_reports` lọc theo ngày hiện tại trong timezone của workspace, mặc định Việt Nam.
- Phiên bản dùng chung hiển thị `0.1.3`, kiểm thử đối chiếu với package gốc.
- Dashboard ghi rõ phạm vi đồng bộ; dùng ErrorState chung cho lỗi, vùng status cho cảnh báo giữ nguyên báo cáo.

## Bằng chứng kiểm tra

- TypeScript build/type checking, ESLint, Vite production build: PASS.
- 40/40 ca: bridge-safety (20), CI policy, foundation, security; không skip. Bao gồm missing key, URL không an toàn, mất mạng, HTTP lỗi, response sai, thiếu xác nhận, số liệu âm, nguồn rỗng, giữ nguyên báo cáo, script trùng/đổi tên, cache khác workspace, Staff bị chặn, timeout response body, thiếu email thật và rollback khi ghi DB thất bại.
- Khi phía nhận đã xác nhận nhân sự nhưng ghi DB cục bộ thất bại, trả thông báo rõ phần đã xác nhận, rollback phần cục bộ và không cập nhật mốc thành công.
- Bộ web: 381 PASS, 4 SKIP do cần môi trường QA. Có headless Chrome kiểm tra responsive/theme/focus trên API mô phỏng.
- Browser cục bộ: xác nhận banner giữ nguyên báo cáo, ErrorState khi nguồn không phản hồi và phiên bản 0.1.3. Màn hình hẹp đo được document width = scrollWidth = 360px. Chỉ sử dụng dữ liệu giả trên server loopback.
- Định dạng các file sửa và git diff whitespace: PASS.
- Đã thêm bridge-safety vào danh sách kiểm thử CI.

## Giới hạn nghiệm thu / phát hành

Đây là bản sửa DEV, chưa deploy Production. PostgreSQL QA thực và Windows chưa được chạy lại trên máy Mac; không dùng DB vận hành thay thế. Kiểm thử SQL/transaction trong bridge-safety là mock, chưa chứng minh hành vi lock hoặc rollback trên PostgreSQL thật.

Endpoint phía V4 vẫn có cơ chế khóa mặc định và phản hồi xác nhận tổng hợp; bản sửa này chỉ thay management-lite, chưa thể chứng minh từng nhân sự đã được xử lý đầy đủ bên nhận. Trước phát hành, cấu hình khóa riêng giống nhau ở hai đầu, kiểm tra endpoint đích và chạy nghiệm thu cô lập hai hệ thống. Không tự thay credential hoặc source repo V4 trong gói sửa này.

Không sửa hồi tố dữ liệu báo cáo đã bị đồng bộ trước đây; cần đối chiếu backup/audit trước mọi khôi phục. Báo cáo sản lượng tự động tiếp tục tạm dừng cho đến khi có ánh xạ đáng tin cậy.

Các tồn tại nền từ audit: strict UI audit còn 63 phát hiện cần phân loại (23 unresolved, 40 violations), định dạng toàn repository chưa đạt từ trước; bundle JS còn lớn (~968 kB minified). Không chứng nhận toàn hệ thống hoặc Production đã hết lỗi.
