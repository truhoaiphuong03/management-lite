# Phương án API phân trang cho 5 module HOLD (CHƯA TRIỂN KHAI)

Ngày 12/10/2026. Phạm vi: Công việc, Lịch làm việc, Lương, Tài khoản, Lưu trữ.
Nguyên tắc: **tương thích ngược tuyệt đối**, không đổi dữ liệu, mỗi module một lô riêng, mỗi lô có bộ test quyền truy cập bắt buộc trước khi UI dùng.

## 1. Hợp đồng chung (mẫu đã chạy ổn ở FIN)
- Tham số tùy chọn: `limit` (1–100) và `offset` (≥0, số nguyên).
- **Không truyền `limit` và `offset` ⇒ trả đúng như hiện tại** (không phá client cũ, không đổi shape).
- Có `limit` hoặc `offset` ⇒ trả thêm `{ total, limit, offset }`; `limit` mặc định 20 khi chỉ có `offset`.
- Tham số sai (`limit=0`, `101`, `offset=-1`, `1.5`, lặp tham số) ⇒ `400 VALIDATION_ERROR`; whitelist tham số của endpoint phải được mở rộng tường minh (hiện `work` từ chối mọi khóa lạ).
- `total` đếm trong **cùng** điều kiện lọc + phân quyền với `items` (cùng một mệnh đề `WHERE`).
- `ORDER BY` luôn có khóa phụ duy nhất (`id`) để không trùng/mất bản ghi.
- Chỉ phân trang ở backend; UI dùng `Pagination` chung, đổi bộ lọc ⇒ về trang 1, kẹp trang khi hết dữ liệu (`clampPage`).

## 2. Từng module

### 2.1 Công việc — `GET /api/v1/work-items` (`work/service.ts: list`)
- Hiện: whitelist `status|priority|assignee_id|search`; trả **toàn bộ** + gọi `detail()` cho từng dòng (N+1 truy vấn).
- Thay đổi: thêm `limit/offset` vào whitelist; chạy `COUNT(*)` với cùng `WHERE`; `ORDER BY w.created_at DESC, w.id` (đã có khóa phụ); chỉ gọi `detail()` cho các id của trang ⇒ **giảm tải**, không đổi dữ liệu mỗi dòng.
- Phân quyền: Staff chỉ thấy việc của mình (`own`); `total` phải tính trong phạm vi đó.
- Test quyền: 401 chưa đăng nhập; Staff A không thấy `total`/item của Staff B; Staff truyền `assignee_id` của người khác ⇒ 403 (giữ nguyên); Owner thấy tất cả; tổng các trang = tổng không phân trang; lọc `search` không lẫn workspace khác.

### 2.2 Lịch làm việc — `GET /api/v1/schedules` (`listSchedulesForOwner`)
- Hiện: lọc theo `week_start_date` và `employee_id` — **đã giới hạn theo tuần**, kích thước bị chặn tự nhiên (số nhân viên × 1 tuần).
- Đề xuất: **không ép phân trang**. Nếu muốn, thêm `limit/offset` tùy chọn theo cùng hợp đồng chung; ưu tiên thấp.
- Test quyền: Staff gọi bị 403 (Owner-only) — giữ; `employee_id` ngoài workspace ⇒ không trả dữ liệu.

### 2.3 Lương — nhiều endpoint `/api/v1/payroll/*` (`PayrollScreen`, 4776 dòng)
- Cần kiểm kê từng bảng (bảng giá giờ, kỳ lương, phiếu lương, điều chỉnh) trước khi chọn endpoint nào cần phân trang. **Chưa đủ thông tin để sửa**.
- Quy tắc riêng (tiền): không đổi công thức, không đổi thứ tự cộng; mọi tổng tiền tính trên TOÀN BỘ tập kết quả, không chỉ trang hiện tại (cùng bài học Kế hoạch FIN: client-paging khi tổng cần đủ danh sách).
- Lô đề xuất: (a) bảng giá giờ; (b) danh sách phiếu lương theo kỳ. Mỗi lô: test 401/403/Staff chỉ xem phiếu của mình; đối chiếu `SUM` toàn bộ = `SUM` các trang.
- Mức rủi ro **cao** ⇒ làm sau cùng, cần Owner duyệt riêng.

### 2.4 Tài khoản — `GET /api/v1/accounts` (`accounts/service.ts: listAccounts`)
- Hiện: Owner-only; lọc `platform|status|search`; trả toàn bộ; UI lọc thêm ở client.
- Thay đổi: thêm `limit/offset`; `COUNT(*)` cùng `conditions`; `ORDER BY` hiện có + `id`.
- **Nhạy cảm**: dữ liệu mật khẩu/tài khoản mạng xã hội. Phân trang **không** được làm thay đổi trường trả về; không log `search`.
- Test quyền: Staff ⇒ 403; Owner workspace khác không thấy; `total` khớp bộ lọc `status` mặc định `active`; UI chuyển lọc client → lọc server (tìm kiếm qua `search`).

### 2.5 Lưu trữ — `GET /api/v1/storage/folders` (`storage/service.ts: listFolders`)
- Hiện: trả toàn bộ thư mục; Staff bị lọc phức tạp theo phân công (`folder_assignments`, thư mục cha).
- Thay đổi: thêm `limit/offset` + `COUNT(*)` dùng **cùng** mệnh đề phân quyền (đây là điểm rủi ro rò rỉ chính: `total` không được đếm thư mục Staff không có quyền).
- `deliverable_count` là subquery từng dòng — chỉ chạy cho các dòng của trang.
- Test quyền: Staff thấy đúng thư mục được phân công + thư mục con của thư mục cha được phân công; `total` bằng đúng số đó; Staff không đoán được tổng của workspace.

## 3. Bộ test quyền truy cập bắt buộc (mẫu chung)
Với mỗi endpoint, trên DB `fin_qa_*`/`*_ci_test` riêng:
1. Chưa đăng nhập ⇒ 401 (cả khi có `limit/offset`).
2. Vai trò không được phép ⇒ 403.
3. Staff A vs Staff B: `items` và `total` tách biệt.
4. Workspace khác: `total = 0` với id lạ.
5. `limit/offset` sai ⇒ 400, không tạo/đổi dữ liệu.
6. Tính nhất quán: ghép các trang = toàn bộ danh sách không phân trang; không trùng, không thiếu; thứ tự ổn định khi có bản ghi trùng khóa sắp xếp chính.
7. Tương thích ngược: gọi không tham số ⇒ response byte-tương-đương hợp đồng cũ (so sánh shape).

## 4. Thứ tự đề xuất
1. Công việc (rủi ro thấp–vừa, có lợi ích hiệu năng ngay).
2. Lưu trữ (rủi ro phân quyền vừa).
3. Tài khoản (Owner-only nhưng nhạy cảm).
4. Lịch làm việc (tùy chọn).
5. Lương (kiểm kê riêng rồi mới làm).

Mỗi lô chỉ bắt đầu sau khi Owner duyệt, backup DB và có DB test tách riêng.
