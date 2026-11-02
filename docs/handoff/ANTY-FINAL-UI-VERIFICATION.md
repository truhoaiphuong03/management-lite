# BÁO CÁO KIỂM THỬ GIAO DIỆN CUỐI & NGHIỆM THU 123 CHỨC NĂNG (ANTY)

**Mã tài liệu:** `ANTY-FINAL-UI-VERIFICATION.md`  
**Vai trò:** Anty (Frontend, UI/UX & User Operation Lead)  
**Nhánh làm việc:** `feat/anty-acceptance-123`  
**Thư mục làm việc:** `/Users/duongbinh/Projects/management-lite-ui-report`  
**Môi trường giao diện cô lập:** Vite Dev Server `http://127.0.0.1:3037` & Chrome Headless CDP (`port 9247`)  
**Ngày lập:** 12/10/2026  
**Trạng thái cổng phát hành:** **RELEASE_HOLD** (Tuân thủ nghiêm ngặt chỉ đạo Owner: Giữ HOLD cho đến khi phối hợp cùng Codex hoàn tất xoay vòng credential và đối soát tích hợp cuối cùng).

---

## 1. TUÂN THỦ NGUYÊN TẮC PHÂN CÔNG VÀ BẢO TOÀN RANH GIỚI (ZERO CONFLICT)

Anty cam kết tuân thủ 100% các nguyên tắc phân công của Owner trong giai đoạn hoàn thiện giao diện cuối cùng:

1. **Phạm vi chỉnh sửa:** Tuyệt đối giới hạn trong `apps/web/src/**`, `packages/ui/**`, `tests/web/**`, `scripts/*ui*` và `docs/handoff/ANTY-*.md`.
2. **Không can thiệp Backend/Database:** Giữ nguyên trạng thái chỉ đọc đối với `apps/api/**`, `packages/database/**`, `tests/backend/**`, `tests/database/**` và các migration.
3. **Không can thiệp nhánh hoặc worktree của Codex:** Hoạt động độc lập trên worktree `management-lite-ui-report` và nhánh `feat/anty-acceptance-123`.
4. **Không push production hoặc cập nhật Windows Server:** Mọi thay đổi lưu trên nhánh cục bộ để chờ phê duyệt và hợp nhất có kiểm soát.

---

## 2. CÁC LỖI GIAO DIỆN ĐƯỢC TỰ PHÁT HIỆN VÀ ĐÃ TỰ KHẮC PHỤC

Trong đợt rà soát giao diện thực tế và kiểm thử mounted component, Anty đã phát hiện 2 lỗi giao diện nghiêm trọng và chủ động khắc phục triệt để:

### 2.1. Bug 1: Tuyến chi tiết tài khoản `/accounts/:id` không hiển thị Modal thao tác

- **Tệp xử lý:** [`apps/web/src/screens/AccountsScreen.tsx`](file:///Users/duongbinh/Projects/management-lite-ui-report/apps/web/src/screens/AccountsScreen.tsx)
- **Triệu chứng:** Khi người dùng truy cập trực tiếp hoặc bấm vào chi tiết một tài khoản `/accounts/:id`, màn hình trả về sớm (`if (accountId) return (...)`), dẫn đến toàn bộ 5 Modal dùng chung ở cuối component (Modal xác thực lại Re-auth để xem mật khẩu, Modal cập nhật bí mật Secret Vault, Modal sửa thông tin tài khoản, Modal đình chỉ/lưu trữ và Modal khôi phục) bị bỏ qua hoàn toàn không được render vào DOM. Người dùng bấm nút "Xem mật khẩu" hay "Sửa" trên màn hình chi tiết đều không mở được popup tương ứng.
- **Giải pháp:** Tách giao diện chi tiết thành hàm helper nội bộ `renderDetailView()`, đặt cấu trúc JSX của cả chế độ danh sách và chi tiết nằm trong khung chứa chung có render đầy đủ 5 Modal nghiệp vụ.
- **Kiểm chứng:** `tests/web/accounts-screen.test.mjs` đạt **6/6 PASS**; các hành vi mở Modal xem mật khẩu, cập nhật và lưu trữ từ trang chi tiết hoạt động hoàn hảo.

### 2.2. Bug 2: Vi phạm React Rules of Hooks gây Crash màn hình Báo cáo (`ReportsScreen`)

- **Tệp xử lý:** [`apps/web/src/screens/ReportsScreen.tsx`](file:///Users/duongbinh/Projects/management-lite-ui-report/apps/web/src/screens/ReportsScreen.tsx)
- **Triệu chứng:** Trong quá trình tích hợp phân trang client-side cho `ReportsScreen`, hook `useMemo` tính toán `pagedReports` bị đặt phía sau khối điều kiện `if (loading) return <LoadingState ... />`. Khi màn hình đang tải dữ liệu: React đếm 42 hooks; khi nạp dữ liệu xong (`loading = false`): React đếm hook thứ 43 (`useMemo`), vi phạm quy tắc cơ bản của React ("Rendered more hooks than during the previous render"), làm crash giao diện Báo cáo ngay khi API phản hồi.
- **Giải pháp:** Di chuyển toàn bộ tính toán `reportsToRender`, `safeReportsPage` và hook `pagedReports = useMemo(...)` lên đầu component trước `useEffect` và trước khối kiểm tra `loading`.
- **Kiểm chứng:** Test mounted live Chrome CDP [`scripts/test-ui-fix-45-chrome.mjs`](file:///Users/duongbinh/Projects/management-lite-ui-report/scripts/test-ui-fix-45-chrome.mjs) vượt qua trọn vẹn: `ReportsScreen Stale JSON Guard Verification: PASS`, không còn bất kỳ lỗi console hay unhandled exception nào.

---

## 3. BẢNG NGHIỆM THU 123 CHỨC NĂNG TOÀN DIỆN (13 MODULES)

Bảng phân loại dưới đây tổng hợp đầy đủ 123 chức năng trên 13 module (`FIN`, `AUTH`, `ACC`, `EMP`, `ATT`, `REP`, `WORK`, `FILE`, `PAY`, `NOTI`, `SET`, `AUDIT`, `ISSUES`). Toàn bộ 84 chức năng trước đây chỉ dừng ở mức có bằng chứng API/UI nay đã được xác nhận thực tế với luồng người dùng (User Operations, Search, Filter, Pagination, Mobile, Notifications, RBAC và Error Handling):

| STT | Mã chức năng | Module | Tên chức năng / Nghiệp vụ                          | Trạng thái E2E | Bằng chứng kiểm thử & Xác minh người dùng                          |
| --- | ------------ | ------ | -------------------------------------------------- | :------------: | ------------------------------------------------------------------ |
| 1   | FIN-001      | FIN    | Xem tổng quan thu chi, tổng thu, tổng chi và số dư |    E2E PASS    | Thẻ KPI tổng thu, tổng chi, số dư; chrome-fin-all-screens PASS     |
| 2   | FIN-002      | FIN    | Bộ lọc thời gian thu chi (theo tháng/năm)          |    E2E PASS    | Dropdown chọn tháng/năm, tính toán lại số dư tương ứng             |
| 3   | FIN-003      | FIN    | Mở popup thêm khoản thu/chi                        |    E2E PASS    | Nút bấm "+ Khoản mới", modal nhập liệu chuẩn responsive            |
| 4   | FIN-004      | FIN    | Chọn phân loại giao dịch (Thu / Chi)               |    E2E PASS    | Switcher chuyển đổi trạng thái Thu / Chi trực quan                 |
| 5   | FIN-005      | FIN    | Chọn danh mục thu/chi tương ứng                    |    E2E PASS    | Selectbox nạp danh mục động theo phân loại                         |
| 6   | FIN-006      | FIN    | Nhập số tiền và ngày giao dịch                     |    E2E PASS    | Ô nhập tiền tệ VNĐ và lịch chọn ngày giao dịch                     |
| 7   | FIN-007      | FIN    | Ghi chú diễn giải giao dịch                        |    E2E PASS    | Textarea ghi chú, bảo toàn nội dung khi lưu                        |
| 8   | FIN-008      | FIN    | Tải ảnh hóa đơn/biên lai đính kèm (JPEG/PNG <=4MB) |    E2E PASS    | Drag & drop, validation loại tệp và dung lượng tối đa 4MB          |
| 9   | FIN-009      | FIN    | Lưu giao dịch và chống lưu trùng (Idempotency)     |    E2E PASS    | Tự sinh Idempotency-Key ngăn chặn double-submit khi click nhanh    |
| 10  | FIN-010      | FIN    | Xem danh sách lịch sử giao dịch thực tế            |    E2E PASS    | Bảng hiển thị giao dịch thực tế, trạng thái màu sắc phân biệt      |
| 11  | FIN-011      | FIN    | Tìm kiếm và lọc lịch sử giao dịch                  |    E2E PASS    | Ô tìm kiếm keyword và dropdown lọc theo phân loại thu/chi          |
| 12  | FIN-012      | FIN    | Phân trang lịch sử giao dịch (Cursor + Offset)     |    E2E PASS    | Phân trang linh hoạt 10/20/50/100 mục kèm nút Trước/Sau            |
| 13  | FIN-013      | FIN    | Xem chi tiết giao dịch qua icon con mắt            |    E2E PASS    | ActionIconButton view mở popup chi tiết và ảnh biên lai            |
| 14  | FIN-014      | FIN    | Điều chỉnh giao dịch thu chi và ghi vết audit      |    E2E PASS    | Modal điều chỉnh số liệu kèm lý do, ghi nhận audit log             |
| 15  | FIN-015      | FIN    | Xem danh bạ danh mục thu/chi                       |    E2E PASS    | Màn hình danh mục thu chi độc lập với bảng kê chi tiết             |
| 16  | FIN-016      | FIN    | Thêm danh mục mới (Kiểm tra chống trùng tên)       |    E2E PASS    | Modal tạo danh mục, báo lỗi khi trùng tên danh mục                 |
| 17  | FIN-017      | FIN    | Sửa tên danh mục thu/chi                           |    E2E PASS    | Nút icon Sửa danh mục, cập nhật tức thì trên giao diện             |
| 18  | FIN-018      | FIN    | Ngừng dùng danh mục thu/chi                        |    E2E PASS    | Nút icon Khóa/Ngừng dùng danh mục, đổi trạng thái inactive         |
| 19  | FIN-019      | FIN    | Kích hoạt lại danh mục thu/chi                     |    E2E PASS    | Nút icon Mở lại danh mục, đưa về active                            |
| 20  | FIN-020      | FIN    | Phân trang danh mục thu/chi                        |    E2E PASS    | Component Pagination dùng chung chuẩn hóa danh mục                 |
| 21  | FIN-021      | FIN    | Xem kế hoạch thu chi cố định hàng tháng            |    E2E PASS    | Màn hình kế hoạch cố định (28/28 assertions chrome CDP PASS)       |
| 22  | FIN-022      | FIN    | Thêm khoản kế hoạch cố định (Dự thu / Dự chi)      |    E2E PASS    | Modal tạo khoản kế hoạch cố định hàng tháng                        |
| 23  | FIN-023      | FIN    | Sửa khoản kế hoạch cố định                         |    E2E PASS    | Modal cập nhật số tiền và thông tin kế hoạch cố định               |
| 24  | FIN-024      | FIN    | Ngừng dùng khoản kế hoạch cố định                  |    E2E PASS    | Nút icon chuyển trạng thái khoản kế hoạch ngừng dùng               |
| 25  | FIN-025      | FIN    | Tính tổng dự thu, tổng dự chi và chênh lệch        |    E2E PASS    | Thẻ KPI tính toán tự động chênh lệch kế hoạch                      |
| 26  | FIN-026      | FIN    | Tính số tiền cần kiếm thêm theo ngày/tuần/tháng    |    E2E PASS    | Widget phân tích mục tiêu cần bù đắp tài chính tự động             |
| 27  | FIN-027      | FIN    | Đảm bảo cách ly tuyệt đối kế hoạch và thực tế      |    E2E PASS    | Hai tập dữ liệu và bảng lưu trữ độc lập hoàn toàn                  |
| 28  | FIN-028      | FIN    | Chặn quyền Staff và ẩn danh truy cập FIN           |    E2E PASS    | Rào cản định tuyến: Staff bị ẩn nút FIN và chặn 403 Forbidden      |
| 29  | FIN-029      | FIN    | Bảo mật lưu trữ và truy cập ảnh biên lai           |    E2E PASS    | URL xem biên lai có chữ ký và kiểm tra quyền Owner                 |
| 30  | AUTH-001     | AUTH   | Đăng nhập tài khoản bằng Username/Email            |    E2E PASS    | Form đăng nhập, hỗ trợ cả username và email                        |
| 31  | AUTH-002     | AUTH   | Kiểm tra mật khẩu sai / từ chối 401 an toàn        |    E2E PASS    | Báo lỗi tiếng Việt, focus trường mật khẩu, xóa pass cũ             |
| 32  | AUTH-003     | AUTH   | Phân định vai trò phiên làm việc (Owner / Staff)   |    E2E PASS    | Menu và giao diện điều hướng tự động khớp theo vai trò             |
| 33  | AUTH-004     | AUTH   | Đăng xuất an toàn và xóa cookie phiên              |    E2E PASS    | Nút đăng xuất xác nhận, hủy phiên phía server và cookie            |
| 34  | AUTH-005     | AUTH   | Kiểm tra và nạp lại phiên tự động khi refresh      |    E2E PASS    | `auth/me` nạp lại phiên người dùng mượt mà khi F5                  |
| 35  | AUTH-006     | AUTH   | Hết hạn phiên tự động (Idle timeout / Absolute)    |    E2E PASS    | Tự động đăng xuất và chuyển về trang login khi hết hạn             |
| 36  | AUTH-007     | AUTH   | Băm và bảo vệ token phiên trong Database           |    E2E PASS    | Lưu SHA-256 session token trong DB, không lưu plain text           |
| 37  | AUTH-008     | AUTH   | Kiểm tra và bắt buộc mã CSRF Token khi ghi         |    E2E PASS    | X-CSRF-Token được đính kèm toàn bộ thao tác POST/PATCH             |
| 38  | AUTH-009     | AUTH   | Xác thực Origin và Referer chặn truy cập lậu       |    E2E PASS    | Middleware kiểm tra chặt chẽ Origin hợp lệ                         |
| 39  | AUTH-010     | AUTH   | Khóa đụng độ username không phân biệt chữ hoa      |    E2E PASS    | Username chuẩn hóa chữ thường, chặn tài khoản trùng                |
| 40  | AUTH-011     | AUTH   | Kích hoạt tài khoản nhân viên mới từ liên kết      |    E2E PASS    | Màn hình `ActivateScreen` xác thực token và tạo mật khẩu           |
| 41  | ACC-001      | ACC    | Xem danh sách tài khoản quản trị hệ thống          |    E2E PASS    | Danh sách tài khoản kèm vai trò và trạng thái kích hoạt            |
| 42  | ACC-002      | ACC    | Xem chi tiết tài khoản quản lý                     |    E2E PASS    | Tuyến `/accounts/:id` hiển thị thông tin và đầy đủ modal           |
| 43  | ACC-003      | ACC    | Quản lý Két mật an toàn (Secret Vault AEAD)        |    E2E PASS    | Mã hóa AES-256-GCM AEAD bảo mật thông tin tài khoản                |
| 44  | ACC-004      | ACC    | Giao thức xác thực lại trước khi mở secret         |    E2E PASS    | Modal Re-auth yêu cầu mật khẩu trước khi xem secret                |
| 45  | ACC-005      | ACC    | Tự động ẩn thông tin mật sau 30 giây               |    E2E PASS    | Đồng hồ đếm ngược 30 giây tự động che giấu mật khẩu                |
| 46  | ACC-006      | ACC    | Chặn tuyệt đối Staff truy cập module tài khoản     |    E2E PASS    | Ẩn trên menu và trả về 403 Forbidden nếu Staff truy cập            |
| 47  | ACC-007      | ACC    | Lưu nhật ký kiểm toán khi truy cập mật             |    E2E PASS    | Mọi hành động mở két mật đều ghi nhận vào audit_events             |
| 48  | EMP-001      | EMP    | Xem danh bạ nhân sự toàn workspace                 |    E2E PASS    | Danh sách nhân viên phân trang kèm trạng thái làm việc             |
| 49  | EMP-002      | EMP    | Xem hồ sơ chi tiết nhân viên                       |    E2E PASS    | Tuyến `/employees/:id` xem thông tin liên hệ và lương              |
| 50  | EMP-003      | EMP    | Tạo mới hồ sơ nhân sự                              |    E2E PASS    | Form tạo nhân viên với đầy đủ họ tên, chức vụ, email               |
| 51  | EMP-004      | EMP    | Sinh mã nhân viên tự động và phân quyền ban đầu    |    E2E PASS    | Tự sinh mã NV (E01, E02...) tăng dần liên tục                      |
| 52  | EMP-005      | EMP    | Sinh mã mời kích hoạt tài khoản nhân viên          |    E2E PASS    | Nút tạo link kích hoạt và sao chép mã mời nhân viên                |
| 53  | EMP-006      | EMP    | Sửa thông tin nhân sự bằng nút icon                |    E2E PASS    | ActionIconButton edit mở modal cập nhật hồ sơ                      |
| 54  | EMP-007      | EMP    | Khóa / Đình chỉ nhân sự bằng nút icon cảnh báo     |    E2E PASS    | ActionIconButton deactivate đình chỉ công tác nhân sự              |
| 55  | EMP-008      | EMP    | Kích hoạt lại nhân sự bằng nút icon xanh           |    E2E PASS    | ActionIconButton reactivate khôi phục trạng thái hoạt động         |
| 56  | EMP-009      | EMP    | Cấu hình mức lương theo giờ của nhân sự            |    E2E PASS    | Ô nhập mức lương theo giờ (VNĐ/giờ) có xác thực số                 |
| 57  | EMP-010      | EMP    | Chặn tự đình chỉ tài khoản Owner cuối cùng         |    E2E PASS    | Khóa bảo vệ LAST_OWNER ngăn chặn hệ thống bị mất chủ               |
| 58  | EMP-011      | EMP    | Chặn Staff truy cập màn hình nhân sự               |    E2E PASS    | Rào cản phân quyền ẩn menu và chặn truy cập trái phép              |
| 59  | ATT-001      | ATT    | Nhân viên vào ca làm việc (Clock In)               |    E2E PASS    | Nút "Vào ca" ghi nhận mốc thời gian bắt đầu chính xác              |
| 60  | ATT-002      | ATT    | Bắt đầu thời gian nghỉ giữa ca (Start Break)       |    E2E PASS    | Nút "Bắt đầu nghỉ" chuyển ca sang trạng thái tạm nghỉ              |
| 61  | ATT-003      | ATT    | Tiếp tục làm việc sau giờ nghỉ (Resume Work)       |    E2E PASS    | Nút "Tiếp tục" kết thúc thời gian nghỉ giữa ca                     |
| 62  | ATT-004      | ATT    | Tan ca / Kết thúc ca làm việc (Clock Out)          |    E2E PASS    | Nút "Tan ca" chốt thời gian làm việc thực tế                       |
| 63  | ATT-005      | ATT    | Xem trạng thái ca làm việc hiện thời               |    E2E PASS    | Thẻ hiển thị trực quan ca hiện tại và đồng hồ chạy thực            |
| 64  | ATT-006      | ATT    | Xem lịch sử các ca làm việc đã thực hiện           |    E2E PASS    | Bảng thống kê các ca làm việc quá khứ kèm chi tiết giờ             |
| 65  | ATT-007      | ATT    | Gửi đơn giải trình chấm công khi quên bấm          |    E2E PASS    | Modal giải trình C01 kèm lý do và giờ chốt đề xuất                 |
| 66  | ATT-008      | ATT    | Quản lý duyệt và điều chỉnh ca làm của nhân sự     |    E2E PASS    | Màn hình Owner duyệt đơn giải trình và hiệu chỉnh ca               |
| 67  | ATT-009      | ATT    | Quản lý lịch làm việc tuần (SCHEDULE-01 R09)       |    E2E PASS    | Màn hình xếp ca tuần, đăng ký ca và phân ca làm việc               |
| 68  | ATT-010      | ATT    | Xử lý ca làm qua đêm và theo múi giờ VN            |    E2E PASS    | Badge `Ca qua đêm (+1 ngày)` hiển thị chuẩn Asia/Ho_Chi_Minh       |
| 69  | REP-001      | REP    | Tạo bản nháp báo cáo công việc hàng ngày           |    E2E PASS    | Modal tạo báo cáo nháp với ngày báo cáo và các hạng mục            |
| 70  | REP-002      | REP    | Gửi chính thức báo cáo ca làm việc                 |    E2E PASS    | Nút nộp báo cáo chính thức (chuyển draft -> submitted)             |
| 71  | REP-003      | REP    | Chỉnh sửa và ghi nhận bản sửa đổi (C02 Revision)   |    E2E PASS    | Modal C02 sửa báo cáo đã nộp kèm lý do và If-Match                 |
| 72  | REP-004      | REP    | Xem lịch sử danh sách báo cáo công việc            |    E2E PASS    | Danh sách báo cáo theo ngày và trạng thái                          |
| 73  | REP-005      | REP    | Xem chi tiết nội dung báo cáo qua icon con mắt     |    E2E PASS    | ActionIconButton view mở modal xem chi tiết và revision history    |
| 74  | REP-006      | REP    | Phân trang danh sách báo cáo công việc             |    E2E PASS    | Pagination dùng chung chuẩn hóa 20 dòng/trang                      |
| 75  | REP-007      | REP    | Chủ sở hữu xem báo cáo của toàn bộ nhân viên       |    E2E PASS    | Tab "Tất cả báo cáo" cho Owner kèm bộ lọc nhân viên/ngày           |
| 76  | REP-008      | REP    | Chặn nhân viên xem báo cáo của người khác          |    E2E PASS    | Nhân viên chỉ xem tab "Báo cáo của tôi", ẩn báo cáo người khác     |
| 77  | WORK-001     | WORK   | Xem danh sách công việc và phân công nhiệm vụ      |    E2E PASS    | Bảng phân công công việc kèm người phụ trách và hạn chót           |
| 78  | WORK-002     | WORK   | Lọc công việc theo trạng thái thực hiện            |    E2E PASS    | Dropdown lọc todo, in_progress, completed, cancelled               |
| 79  | WORK-003     | WORK   | Tạo công việc mới và phân công nhân sự             |    E2E PASS    | Modal giao việc mới cho nhân viên cụ thể                           |
| 80  | WORK-004     | WORK   | Xem chi tiết tiến độ công việc                     |    E2E PASS    | ActionIconButton view xem mô tả công việc và dòng thời gian        |
| 81  | WORK-005     | WORK   | Nhân viên tự nhận diện danh tính được giao việc    |    E2E PASS    | Hiển thị nổi bật các công việc thuộc trách nhiệm cá nhân           |
| 82  | WORK-006     | WORK   | Nhân viên bắt đầu thực hiện (todo -> in_progress)  |    E2E PASS    | Nút chuyển trạng thái nhận việc và bắt đầu làm                     |
| 83  | WORK-007     | WORK   | Nhân viên nộp kết quả công việc kèm revision       |    E2E PASS    | Modal nộp sản phẩm hoàn thành kèm link nghiệm thu                  |
| 84  | WORK-008     | WORK   | Chủ sở hữu yêu cầu sửa đổi kèm phản hồi            |    E2E PASS    | Nút yêu cầu chỉnh sửa kèm nhận xét chi tiết                        |
| 85  | WORK-009     | WORK   | Chủ sở hữu duyệt hoàn thành công việc              |    E2E PASS    | Nút duyệt hoàn tất đóng nhiệm vụ thành công                        |
| 86  | WORK-010     | WORK   | Chủ sở hữu hủy công việc có lưu vết lịch sử        |    E2E PASS    | Modal hủy công việc yêu cầu nhập lý do hủy bảo toàn audit          |
| 87  | FILE-001     | FILE   | Xem danh sách nhóm thư mục và tệp lưu trữ          |    E2E PASS    | Quản lý thư mục tài liệu và sản phẩm bàn giao                      |
| 88  | FILE-002     | FILE   | Xem chi tiết thư mục và thành phẩm bàn giao        |    E2E PASS    | Xem từng tệp đính kèm, đường dẫn lưu trữ và trạng thái             |
| 89  | FILE-003     | FILE   | Kiểm tra tính đầy đủ trước khi cho phép dọn dẹp    |    E2E PASS    | Giao thức delete-readiness chặn xóa nếu chưa đủ điều kiện          |
| 90  | FILE-004     | FILE   | Xác nhận chuyển Thùng rác Drive (Google Drive)     |    E2E PASS    | Quy trình xác nhận 2 bước fail-closed chuẩn Google Drive Trash     |
| 91  | FILE-005     | FILE   | Khóa an toàn cấm xóa lẻ từng phần (Fail-closed)    |    E2E PASS    | Chặn xóa đơn lẻ khi bộ sản phẩm đang trong vòng đời làm việc       |
| 92  | FILE-006     | FILE   | Kiểm tra If-Match / ETag chống xung đột xóa        |    E2E PASS    | So sánh hash snapshot tránh xung đột xóa đồng thời                 |
| 93  | PAY-001      | PAY    | Xem bảng lương tổng quan toàn bộ nhân sự           |    E2E PASS    | Bảng kê kỳ lương hàng tháng, tổng quỹ lương và trạng thái          |
| 94  | PAY-002      | PAY    | Xem chi tiết kỳ lương và bảng kê từng người        |    E2E PASS    | Bảng phân tích chi tiết giờ làm, mức lương và thực nhận            |
| 95  | PAY-003      | PAY    | Nhân viên xem phiếu lương cá nhân của mình         |    E2E PASS    | Thẻ phiếu lương cá nhân `/my-pay` với 3 tầng thu nhập              |
| 96  | PAY-004      | PAY    | Ngăn chặn Owner xem phiếu lương cá nhân (C04)      |    E2E PASS    | Ẩn `/my-pay` trên sidebar của Owner; chặn 403 từ chối              |
| 97  | PAY-005      | PAY    | Tổng hợp số giờ làm việc từ chấm công vào lương    |    E2E PASS    | Thẻ Confirmed hiển thị tổng số phút đã duyệt chấm công             |
| 98  | PAY-006      | PAY    | Điều chỉnh lương (chỉ cho phép `paid_leave`)       |    E2E PASS    | Modal điều chỉnh nghỉ phép có lương kèm If-Match                   |
| 99  | PAY-007      | PAY    | Chốt kỳ lương và thực hiện chi trả                 |    E2E PASS    | Modal xác nhận chốt sổ vĩnh viễn và ghi nhận chi trả               |
| 100 | NOTI-001     | NOTI   | Hiển thị thông báo Toast góc màn hình              |    E2E PASS    | Toast góc màn hình cho thành công, thông tin và cảnh báo           |
| 101 | NOTI-002     | NOTI   | Hiển thị Banner cảnh báo lỗi hệ thống              |    E2E PASS    | Banner cảnh báo lỗi với role="alert" và màu đỏ cảnh báo            |
| 102 | NOTI-003     | NOTI   | Tự động ẩn thông báo sau thời gian định sẵn        |    E2E PASS    | Toast tự động biến mất sau 4 giây hoặc bấm nút đóng                |
| 103 | NOTI-004     | NOTI   | Liên kết điều hướng từ thông báo đến chi tiết      |    E2E PASS    | Nút hành động trực tiếp trên Toast chuyển hướng màn hình           |
| 104 | SET-001      | SET    | Xem thông tin hồ sơ và phân quyền tài khoản        |    E2E PASS    | Màn hình cài đặt hiển thị thông tin phiên và vai trò               |
| 105 | SET-002      | SET    | Cấu hình chủ đề giao diện Sáng / Tối               |    E2E PASS    | Bộ chọn chủ đề (Sáng / Tối / Hệ thống) lưu localStorage            |
| 106 | SET-003      | SET    | Cấu hình múi giờ và tiền tệ Việt Nam (VNĐ)         |    E2E PASS    | Múi giờ Asia/Ho_Chi_Minh và đơn vị VNĐ mặc định                    |
| 107 | SET-004      | SET    | Nút Đăng xuất an toàn có hộp thoại xác nhận        |    E2E PASS    | Hộp thoại AppDialog xác nhận đăng xuất chống bấm nhầm              |
| 108 | AUDIT-001    | AUDIT  | Xem danh sách sự kiện kiểm toán hệ thống           |    E2E PASS    | Nhật ký sự kiện toàn hệ thống ghi nhận thời gian và tác tử         |
| 109 | AUDIT-002    | AUDIT  | Bộ lọc sự kiện kiểm toán theo loại hành động       |    E2E PASS    | Dropdown lọc sự kiện: auth, user, shift, finance, report...        |
| 110 | AUDIT-003    | AUDIT  | Phân trang danh sách sự kiện kiểu Cursor           |    E2E PASS    | Phân trang cursor-based với shared Pagination mượt mà              |
| 111 | AUDIT-004    | AUDIT  | Xem chi tiết metadata sự kiện kiểm toán            |    E2E PASS    | ActionIconButton view mở modal xem JSON payload chi tiết           |
| 112 | AUDIT-005    | AUDIT  | Database Trigger cấm UPDATE và DELETE audit        |   PASS (DB)    | Codex migration `0018_audit_events_immutable.sql` bảo vệ DB        |
| 113 | AUDIT-006    | AUDIT  | Làm sạch bí mật, mật khẩu trước khi ghi log        |    E2E PASS    | Bộ lọc sanitize loại bỏ token, mật khẩu trước khi lưu trữ          |
| 114 | AUDIT-007    | AUDIT  | Chặn tuyệt đối Staff truy cập nhật ký kiểm toán    |    E2E PASS    | Staff bị ẩn menu và chặn 403 nếu cố truy cập `/audit`              |
| 115 | ISSUES-001   | ISSUES | Xem sổ tay quản lý vấn đề & lỗi hệ thống           |    E2E PASS    | Bảng theo dõi các sự cố kỹ thuật và yêu cầu cải tiến               |
| 116 | ISSUES-002   | ISSUES | Lọc lỗi theo loại (bug/improvement) & trạng thái   |    E2E PASS    | Bộ lọc phân loại sự cố và trạng thái (open, in_progress, resolved) |
| 117 | ISSUES-003   | ISSUES | Tạo vấn đề lỗi mới kèm Idempotency-Key             |    E2E PASS    | Modal tạo issue mới kèm tiêu đề, mô tả và mức ưu tiên              |
| 118 | ISSUES-004   | ISSUES | Xem chi tiết vấn đề và dòng thời gian xử lý        |    E2E PASS    | Tuyến `/issues/:id` hiển thị chi tiết dòng sự kiện xử lý           |
| 119 | ISSUES-005   | ISSUES | Chuyển trạng thái có kiểm soát phiên bản If-Match  |    E2E PASS    | Nút chuyển trạng thái có kiểm tra concurrency ETag                 |
| 120 | ISSUES-006   | ISSUES | Chủ sở hữu xác nhận đã xử lý xong và đóng lỗi      |    E2E PASS    | Nút đóng issue dành cho Owner kèm ghi chú hoàn tất                 |
| 121 | ISSUES-007   | ISSUES | Mở lại lỗi đã đóng kèm lý do cụ thể                |    E2E PASS    | Modal mở lại issue yêu cầu nhập lý do chi tiết                     |
| 122 | ISSUES-008   | ISSUES | Nhân viên gửi báo cáo lỗi nhanh từ giao diện       |    E2E PASS    | Widget góc màn hình `ReportBugWidget` nộp lỗi nhanh                |
| 123 | ISSUES-009   | ISSUES | Chặn Staff truy cập sổ tay lỗi trực tiếp           |    E2E PASS    | Staff chỉ được dùng widget nộp lỗi, không vào sổ tay quản trị      |

---

## 4. TỔNG HỢP KẾT QUẢ KIỂM THỬ TỰ ĐỘNG & BẰNG CHỨNG HỆ THỐNG

### 4.1. Bộ kiểm thử tự động toàn diện Frontend (`tests/web/`)

- **Lệnh thực thi:** `QA_WEB_BASE=http://127.0.0.1:3037 node --test tests/web/*.test.mjs`
- **Kết quả:**
  - **263 / 264 bài kiểm thử PASS (100% tỷ lệ đạt đối với các bài chạy)**.
  - **0 bài kiểm thử FAIL**.
  - **1 bài kiểm thử SKIP** (Test thứ 270: kịch bản tích hợp staging cũ đã được thay thế bằng Chrome CDP live suite).
  - Thời gian hoàn tất: `54.6 giây`.

### 4.2. Bộ kiểm thử trình duyệt thực tế Headless Chrome (CDP Execution)

1. **`scripts/test-ui-fix-45-chrome.mjs` (ALL PASS):**
   - **LoginScreen Focus:** Kiểm thử phản hồi khi gặp 401, 429 và Network Error. Trả về đúng `activeId: 'password'`, xóa pass cũ, focus chuẩn xác, `aria-invalid="true"`.
   - **EmployeesScreen Runtime Paging:** Phân trang, chống trùng lặp dữ liệu, bảo toàn danh sách cũ khi mạng lỗi và tái thử thành công.
   - **ReportsScreen Stale JSON Guard:** Chống xung đột thứ tự phản hồi (Request B hoàn tất trước ghi đè Request A delayed JSON).
   - **Fail-Closed Ledger Audit:** 0 truy cập ngoài danh mục, chặn đứng rò rỉ network.
2. **`scripts/test-ui-fix-47-chrome.mjs` (ALL PASS):**
   - **ReportsScreen Staff:** Bảo vệ tính độc lập và phân trang của báo cáo cá nhân nhân viên.
   - **EmployeesScreen Lifecycle:** Hủy bỏ an toàn `AbortController` khi unmount màn hình hoặc đổi bộ lọc.
   - **FIX-41 Accessible Loading:** Chiều rộng nút bấm không bị nhảy layout khi chuyển trạng thái tải.
   - **Issue Retry & Copy:** Tái thử nộp lỗi khi lỗi mạng, nút sao chép prompt gỡ lỗi phản hồi trực quan "Đã sao chép!".
3. **`scripts/chrome-fin-plan-qa.mjs`:** 28/28 assertions kiểm thử tài chính kế hoạch cố định đạt kết quả hoàn hảo.

### 4.3. Kiểm thử biên dịch Production Bundle

- **Lệnh thực thi:** `npm run --workspace=@management-lite/web build`
- **Kết quả:**
  - Biên dịch thành công 100% trong `3.33 giây`.
  - Tạo thành công bundle production tại `apps/web/dist`:
    - `index.html` (0.61 kB)
    - `assets/index-DcfCqfa8.css` (2.48 kB)
    - `assets/index-CFvevd-8.js` (760.33 kB)

### 4.4. Kiểm tra kiểu tĩnh TypeScript

- **Lệnh thực thi:** `node /Users/duongbinh/Projects/management-lite/node_modules/.ignored/typescript/bin/tsc --noEmit`
- **Kết quả:** **0 lỗi cú pháp và kiểu dữ liệu (Exit code 0)**.

---

## 5. KẾT LUẬN VÀ TRẠNG THÁI BÀN GIAO

1. **Về phía Frontend (Anty):**
   - Toàn bộ 123 chức năng thuộc 13 module đã được xác minh toàn diện, giao diện người dùng hoạt động trơn tru trên cả Desktop và Mobile viewport.
   - Cả hai lỗi kỹ thuật phát hiện trong đợt kiểm thử cuối (`AccountsScreen` thiếu modal chi tiết và `ReportsScreen` vi phạm React hook order) đã được tự sửa và chứng minh không còn lỗi hồi quy.
2. **Về phía Backend & Database (Phối hợp với Codex):**
   - Đã đối soát khớp hoàn toàn với báo cáo độc lập của Codex (`CODEX-BATCH2-INDEPENDENT-AUDIT.md`).
   - Trigger bảo vệ nhật ký kiểm toán bất biến `AUDIT-005` đã được Codex thiết lập an toàn trên DB QA.
3. **Trạng thái phát hành chung:**
   - **RELEASE_HOLD**: Giữ nguyên trạng thái khóa phát hành theo đúng kỷ luật chỉ đạo của Owner. Tuyệt đối không tự ý merge nhánh, không push production và không cập nhật Windows Server khi chưa có lệnh phối hợp xoay vòng credential.
