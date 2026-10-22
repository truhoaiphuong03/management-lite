# Liên thông quản trị — 2026-10-22

Trạng thái: DEV đã kiểm thử; chưa triển khai hoặc kích hoạt Production.

## Thay đổi
- Xóa toàn bộ giao diện và mã GPS còn lại trong ứng dụng; bỏ mô tả GPS khỏi danh mục phát hành.
- Sửa đồng bộ Dashboard lấy CSRF từ `/api/v1/auth/me` thay vì endpoint không tồn tại `/api/v1/auth/session`; không gửi yêu cầu ghi khi thiếu token.
- Không trả tổng hợp thành công với số 0 khi nguồn dữ liệu quản lý lỗi; hiển thị lỗi đọc bridge.
- Đăng nhập liên thông bằng mã dùng một lần, hạn 60 giây; trạng thái trình duyệt hạn 5 phút. Có tiếp tục luồng sau đăng nhập quản lý. Không truyền mật khẩu giữa hai web.
- Chỉ liên kết Owner có đúng ID, workspace và email với UID quản trị V4 hiện hữu trong allowlist. Không tự tạo hoặc nâng quyền người dùng.
- V4 yêu cầu khóa riêng cho bridge summary và sync, bỏ khóa mặc định và cơ chế bỏ qua dựa trên Host localhost.

## Cấu hình kích hoạt
Cả hai máy chủ: `HP_BRIDGE_SECRET` (ít nhất 32 ký tự), `MGLITE_SSO_OWNER_ID`, `MGLITE_SSO_OWNER_EMAIL`, `MGLITE_SSO_WORKSPACE_ID`.
Quản lý: `MGLITE_SSO_CALLBACK_URL` mặc định `https://hoaiphuong.click/api/auth/management/callback`.
V4: `MGLITE_SSO_ADMIN_UID` phải là UID admin hiện hữu trong `V4_ADMIN_UIDS`; `MANAGEMENT_LITE_SSO_URL` mặc định `https://ql.hoaiphuong.click`; giữ cấu hình `APP_SESSION_SECRET` hiện hữu. Lấy ID người dùng/workspace từ phiên đã xác thực, không dùng ID hồ sơ nhân viên thay thế.
Mã một lần lưu trong bộ nhớ: khi nhiều replica cần sticky routing hoặc kho mã dùng chung; restart làm hết hiệu lực mã đang chờ.

## Quan sát web thật
- Quản lý đã có tài khoản mong muốn `truhoaiphuong03@gmail.com` (ADM01) và hồ sơ Owner cũ ADMIN (`owner@management-lite.local`). Chưa đổi mật khẩu hoặc xóa/ngưng tài khoản nào.
- V4 từ chối lần đăng nhập bằng thông tin được cung cấp; đăng nhập Google chưa hoàn tất. Chưa kiểm kê được tài khoản V4.
- Giao diện quản lý có 2 hồ sơ hoạt động nhưng public-summary trả active_employees=0; chưa xác định nguyên nhân môi trường/dữ liệu. V4 summary trả 5 sản phẩm, 5 kịch bản. Chưa xác nhận liên thông Production.
- Chưa có API xóa cứng tài khoản quản lý được hỗ trợ. Cần kiểm kê và xử lý phụ thuộc dữ liệu trước xóa vĩnh viễn; không chạy SQL tùy tiện.
- Quan sát thấy main đã tự triển khai commit trước đó; bản này nằm trên nhánh review riêng `codex/shared-admin-sso-no-gps`, không merge/push nhánh phát hành.

## Kiểm chứng
- Quản lý: build, lint PASS; 47 kiểm thử API/bridge/SSO/CSRF/bảo mật chọn lọc PASS.
- V4: typecheck PASS; kiểm thử SSO/bridge/auth chọn lọc PASS.
- HTTP hai ứng dụng cục bộ PASS: phiên nguồn được xác minh, ánh xạ admin hiện hữu, chặn phát lại mã; dùng fixture, không chứng minh dữ liệu Production.
- Giao diện chấm công cục bộ đã kiểm tra không còn khối/nút GPS.
- Chưa nghiệm thu PostgreSQL QA hoặc Windows; các vấn đề UI và sản lượng đã ghi trong báo cáo trước vẫn còn mở.

## Tiếp tục triển khai — 2026-10-22
- CI GitHub lần 102: Windows security PASS; PostgreSQL bridge FAIL. Importer chèn `in_progress`, trái trigger bắt buộc công việc mới ở `todo`. Đã sửa trạng thái và dùng `chr(10)` tách dấu nguồn theo dòng, chống trùng khi đổi tiêu đề. Bổ sung kiểm thử trạng thái, giữ kiểm thử concurrent/retry PostgreSQL. CI đang xác minh lại.
- Đã yêu cầu mã khôi phục qua giao diện V4 và bàn giao form đặt mật khẩu mới cho Owner. Thông báo chung không xác nhận email tồn tại hoặc mã đã được chuyển phát. Chưa đặt mật khẩu mới hoặc xóa tài khoản.
- `scripts/deployment/Approve-ReleaseSha.ps1` yêu cầu Owner ký trong console Windows Administrator độc lập và chặn AI tự ký. `Deploy-SemiAutoWindows.ps1` kiểm tra gói, CI receipt và manifest phê duyệt. Không bỏ qua cổng này. Cần CI xanh, cấu hình ánh xạ SSO đúng trên hai máy chủ, rồi ký và triển khai qua controller.
