# GLOBAL UI/UX + PHÂN TRANG — Giai đoạn 1: Kiểm kê, nền tảng, rủi ro, rollback

Ngày 12/10/2026. Kiểm kê dựa trên đọc mã nguồn (`apps/web/src/screens/*`, `apps/api/src/*`) bằng grep + đọc chọn lọc.
Mức tin cậy: **trung bình** — cột "API" suy ra từ service/route, chưa chạy từng endpoint với dữ liệu lớn. Các màn hình ngoài FIN **chưa được sửa gì**.

## 1. Chuẩn chung đã xây dựng (design-system)

| Thành phần | File | Nội dung |
|---|---|---|
| `ActionIconButton` | `packages/ui/src/components/ActionIconButton.tsx` | 7 hành động: view (eye), edit (pencil), deactivate (power, amber), reactivate (rotate-ccw, xanh), delete (trash-2, đỏ), download, copy. 40×40, tooltip + `aria-label` tiếng Việt kèm tên dòng, hover/disabled từ `AppButton`, focus từ `:focus-visible` toàn cục. Nút nguy hiểm chỉ mở xác nhận do màn hình gọi. |
| Icon mới | `Icons.tsx` | `PencilIcon`, `PowerIcon`, `Trash2Icon`, `DownloadIcon` (eye/rotate-ccw/copy đã có) |
| `Pagination` + helper | `packages/ui/src/components/Pagination.tsx` | Mặc định 20; lựa chọn 10/20/50/100; "Hiển thị a–b / tổng"; Trước/Sau vô hiệu ở đầu/cuối; `pageCount`, `clampPage`, `pageRange`. |
| Adapter FIN | `apps/web/src/finance/ui.tsx` | `FinanceIconButton` và `FinancePager` giờ là lớp mỏng bọc component chung (giữ nguyên testid cũ). |

Test: `tests/web/ui-shared-components.test.mjs` (8 test). Toàn bộ test web: 241 test, 240 pass, 0 fail, 1 skipped.

## 2. Bảng kiểm kê màn hình

Ký hiệu — Phân trang: **S** = server (API), **C** = client, **—** = không có. Icon: số nút thao tác dạng chữ còn lại cần đổi (theo grep các nhãn Sửa/Xóa/Chi tiết/Ngừng dùng/Kích hoạt lại…).

| # | Nhóm | Màn hình (file) | Có danh sách? | Phân trang hiện tại | API hiện tại | Nút chữ cần đổi icon | Trạng thái |
|---|---|---|---|---|---|---|---|
| 1 | Tổng quan | `DashboardScreen`, `GroupOverviewScreen` | Thẻ KPI/liên kết, không có bảng dài | — (không cần) | — | 0 | Không cần xử lý |
| 2 | Ca & Chấm công | `ClockScreen` (1832 dòng) | Ca làm việc (`/attendance/shifts`) | Chưa có pager UI | limit mặc định 50, tối đa 100 (có `limit`) | 0 theo grep (nút nghiệp vụ: Duyệt/Từ chối…) | **Giai đoạn 3** |
| 3 | Ca & Chấm công | `ScheduleScreen` (1912) | Lịch làm việc (`/schedules`) | — | Không thấy `limit`/`cursor` trong `schedules/` | 0 | **HOLD**: cần thêm phân trang API trước |
| 4 | Công việc | `WorkScreen` (2458) | Công việc (`/work-items`) | — | Không thấy `limit`/`cursor` trong `work/` | 0 | **HOLD**: cần thêm phân trang API trước |
| 5 | Nhân sự & Lương | `EmployeesScreen` (763) | Nhân viên | Cursor + "tải thêm" (append) + `ListFooter` | `limit` mặc định 20, **tối đa 50** (<100 so với chuẩn) | 2 (Chi tiết, Kích hoạt lại) | **Giai đoạn 3** (cần nâng max lên 100, giữ cursor) |
| 6 | Nhân sự & Lương | `EmployeeDetailScreen`, `EmployeeNewScreen` | Chi tiết/biểu mẫu | — | — | 0 | Không cần phân trang |
| 7 | Nhân sự & Lương | `PayrollScreen` (4776) | Nhiều bảng (bảng giá giờ, kỳ lương, phiếu lương) | — | Không thấy `limit`/`cursor` trong `payroll/` | chưa đếm được (mã lớn) | **HOLD**: cần kiểm kê riêng; rủi ro tiền lương cao |
| 8 | Thu chi cá nhân | `FinanceHistoryScreen` | Giao dịch | **S**, offset, 20 mặc định | `limit`≤100 + `offset` (+cursor cũ) | 1 → icon ✔ | **Hoàn tất** |
| 9 | Thu chi cá nhân | `FinanceCategoriesScreen` | Danh mục | **S**, offset, 20 mặc định | như trên | 3 → icon ✔ | **Hoàn tất** |
| 10 | Thu chi cá nhân | `FinancePlanScreen` | Khoản kế hoạch (tối đa 200/người) | **C** có chủ đích | `/fin/plan` trả toàn bộ (giới hạn cứng 200) | 3 → icon ✔ | **Hoàn tất** (client vì tổng/công thức cần đủ danh sách) |
| 11 | Thu chi cá nhân | `FinanceOverviewScreen`, `FinanceEntryScreen` | Tổng hợp theo danh mục (ngắn); chi tiết giao dịch | — (không cần) | — | giữ nút chữ chính | Không cần xử lý |
| 12 | Quản trị | `AuditScreen` (935) | Nhật ký kiểm toán | Cursor + Trước/Sau tự cài, **cố định 10/trang** | `limit` mặc định 20, tối đa 100 (cursor) | 0 | **Giai đoạn 3**: thay UI bằng `Pagination`, giữ cursor |
| 13 | Quản trị | `IssuesScreen` (1123) | Báo lỗi | Cursor + "tải thêm" | `limit` mặc định 20, tối đa 100 | 0 | **Giai đoạn 3** |
| 14 | Quản trị | `AccountsScreen` (2482) | Tài khoản (`/accounts`) | **C** (lọc ở client) + `ListFooter` chỉ đếm | Không thấy `limit` trong `accounts/` | 2 (Chi tiết, Sửa) | **HOLD**: tài khoản chứa dữ liệu nhạy cảm; cần API phân trang + rà quyền trước |
| 15 | Quản trị | `StorageScreen` (2622) | Thư mục/tệp | — | Không thấy `limit` trong `storage/` | 1 (Chi tiết) | **HOLD**: cần API phân trang |
| 16 | Quản trị | `ReportsScreen` (2478) | Báo cáo của tôi / theo ngày | Cursor + "tải thêm" | `reports/me` limit 30 (max 100); `reports/daily` 50 (max 100) | 0 | **Giai đoạn 3** |
| 17 | Quản trị | `SettingsScreen`, `IssueDetailScreen`, `ActivateScreen`, `LoginScreen`, `PlaceholderScreen`, `NotFoundScreen` | Biểu mẫu/chi tiết | — | — | 0 | Không cần |

Ghi chú: ở nhiều màn hình, danh sách nhân viên (`/employees?limit=50` lặp cursor) chỉ để nạp dropdown — theo chỉ đạo, **không ép phân trang** (nhưng lưu ý max=50 là hợp đồng hiện tại).

## 3. Tổng kết số liệu (Giai đoạn 1)
- Tổng file màn hình: 25. Màn hình có danh sách thực sự cần xét: **13** (Clock, Schedule, Work, Employees, Payroll, FinHistory, FinCategories, FinPlan, Audit, Issues, Accounts, Storage, Reports).
- Đã hoàn tất icon + phân trang: **3/13** (toàn bộ FIN).
- Giai đoạn 3 có thể làm ngay không cần đổi API: **5** (Employees, Audit, Issues, Reports, Clock — API đã có limit/cursor).
- **HOLD 5**: Schedule, Work, Payroll, Accounts, Storage — API chưa có phân trang; cần thiết kế contract + test + rà quyền trước.

## 4. Quy ước hợp đồng API đề xuất (tương thích ngược)
- Danh sách lớn: `limit` (1–100, mặc định 20) + **`offset` hoặc `cursor`**, loại trừ nhau (đã chạy ổn ở FIN: `offset` → trả `total`; không truyền `offset` → hành vi cursor cũ giữ nguyên).
- Dữ liệu thay đổi liên tục/nhật ký (Audit, Issues): tiếp tục dùng **cursor**; `Pagination` hiển thị Trước/Sau + kích thước trang, không bắt buộc tổng.
- Mọi `ORDER BY` kèm khóa phụ duy nhất (`id`) để không trùng/mất bản ghi.
- `total` tính trong cùng điều kiện lọc + phân quyền với `items`.

## 5. Rủi ro và rollback
| Rủi ro | Giảm thiểu |
|---|---|
| Đổi `limit` tối đa của `/employees` 50→100 ảnh hưởng vòng lặp nạp dropdown | Giữ mặc định 20, chỉ nâng trần; vòng lặp cursor vẫn đúng |
| Thay UI "tải thêm" bằng Trước/Sau làm đổi hành vi người dùng | Triển khai theo từng màn hình, có ảnh trước/sau, Owner duyệt từng nhóm |
| Thêm `offset` vào endpoint chưa có → lộ dữ liệu ngoài quyền | Mỗi endpoint: test 401/403, đối chiếu `total` với phân quyền |
| Payroll/Accounts nhạy cảm | HOLD đến khi có kiểm kê riêng |
| Rollback | Toàn bộ thay đổi nằm ở thư mục làm việc (chưa commit). Quay lại bằng backup `~/Backups/fin-ui-update-20261012-000721/code/` + `tracked-changes.patch`, hoặc `git stash`/revert theo commit sau khi Owner duyệt. Các component mới là file thêm mới nên xóa được độc lập. |

## 6. Phạm vi đã thay đổi trong lượt này
- Thêm: `ActionIconButton.tsx`, `Pagination.tsx`, 4 icon, test mới, script QA Chrome mới.
- Sửa: `finance/ui.tsx`, 3 màn hình FIN (mặc định 20/trang, 10/20/50/100, kế hoạch có chọn kích thước trang).
- Không đổi: API, DB, migration, công thức, dữ liệu, các module khác.
