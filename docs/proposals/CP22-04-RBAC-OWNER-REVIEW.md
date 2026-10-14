# CP2.2 #4 — đề xuất chức vụ và phân quyền, chờ Owner duyệt

Ngày: 14/10/2026. Chưa bật role admin trong runtime. SQL cùng thư mục là bản nháp, **không nằm trong migration registry**.

## Nguyên tắc

Chức vụ (biên tập, kỹ thuật, trưởng nhóm...) là dữ liệu nhân sự theo workspace; không tự cấp quyền hệ thống. Vai trò owner/admin/staff thuộc membership. Không suy ra admin từ tên chức vụ, email, giao diện hoặc tài khoản Windows. Không tự nâng quyền người dùng hiện có.

| Nghiệp vụ | Owner | Admin đề xuất | Staff |
|---|---|---|---|
| Nhân sự, chức vụ | Quản lý trong workspace | Quản lý hồ sơ nghiệp vụ; không cấp quyền hoặc xem bí mật | Xem hồ sơ mình |
| Đăng ký/sửa lịch cá nhân | Có hồ sơ nhân viên mới được đăng ký | Có hồ sơ nhân viên mới được đăng ký | Chỉ lịch mình |
| Xem lịch nhân viên, xếp công việc vào ca đã đăng ký | Có | Có, sau khi được duyệt | Chỉ xem phần việc/lịch mình |
| Giao việc, duyệt bài | Có | Có trong workspace | Bắt đầu/nộp việc được giao |
| Báo cáo/chấm công | Xem và duyệt theo nghiệp vụ | Xem và duyệt theo nghiệp vụ; không tự duyệt hồ sơ mình | Chỉ dữ liệu mình |
| Lương, thu chi, tài khoản và kho bí mật | Có theo module | Chỉ dữ liệu cá nhân; không truy cập kho bí mật | Chỉ dữ liệu cá nhân |
| Tạo tài khoản, đổi role, khóa tài khoản, cấp quyền | Có; bảo vệ Owner cuối cùng | Không | Không |
| Đóng bug sau xác minh fix | Chỉ Owner | Không | Không |
| Đổi mật khẩu | Mật khẩu mình và xác minh mật khẩu cũ | Như Owner | Như Owner |
| Quên mật khẩu | Email đã xác minh, token dùng một lần | Như Owner | Như Owner |

## Dữ liệu và migration đề xuất

`CP22-04-RBAC.draft.sql` tạo danh mục chức vụ theo workspace, thêm FK composite từ employees để ngăn gán chức vụ khác workspace; mở CHECK role thêm admin. Không backfill membership, không sửa credentials, sessions hoặc audit cũ. Không chạy trên production.

Owner cần duyệt: phạm vi admin ở bảng trên, danh sách chức vụ ban đầu, ai được giữ admin, và việc admin duyệt báo cáo/chấm công của người khác. Sau duyệt mới lập migration có số thứ tự chính thức, cập nhật catalog/checksum và sửa đồng bộ contract, AuthService, guard, mọi service, UI.

## Điều kiện trước khi phát hành

- Test 3 role × tất cả endpoint, cả gọi API trực tiếp, CSRF, IDOR và cross-workspace.
- Đổi role/khóa membership phải vô hiệu hóa mọi phiên mang quyền cũ; kiểm tra lại quyền trong cùng transaction mutation.
- Bảo vệ Owner cuối cùng và chống tự nâng quyền; audit ghi người đổi, role trước/sau, lý do, request ID.
- Migration thử trên DB riêng; chứng minh FK không nhận chức vụ khác workspace; không thay đổi role hiện hữu.
- Không rollback CHECK về hai role nếu còn admin: hạ quyền qua quy trình được Owner duyệt và thu hồi phiên trước. Roll forward được ưu tiên; không xóa danh mục chức vụ đã được tham chiếu.

Trạng thái: **READY FOR OWNER REVIEW**; triển khai runtime admin vẫn **PENDING APPROVAL**, không được báo PASS.
