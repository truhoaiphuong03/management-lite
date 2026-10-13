# Đề xuất tách TEST_DATABASE_URL khỏi database localhost đang dùng (CHƯA ÁP DỤNG)

Ngày: 12/10/2026. Trạng thái: **đề xuất, chờ Owner duyệt**. Không có cấu hình, mã nguồn hay dữ liệu nào bị thay đổi theo tài liệu này.

## 1. Nguyên nhân gốc (đã xác minh trong mã nguồn)

| Yếu tố | Thực tế |
|---|---|
| `.env` | `DATABASE_URL` và `TEST_DATABASE_URL` cùng trỏ vào `127.0.0.1:55499/mglite_unified_qa_test`, và `CONFIRM_ISOLATED_TEST_DB=true` đặt sẵn trong `.env`. |
| Tên DB | `mglite_unified_qa_test` chứa `_test`, nên lọt qua `isSafeTestDatabase` (`packages/database/src/config.ts`), vốn chỉ kiểm tra tên DB, hostname, `NODE_ENV`. |
| Cổng xác nhận | `CONFIRM_ISOLATED_TEST_DB` là biến môi trường tĩnh; vì nằm trong `.env` nên mọi lần chạy test đều "tự xác nhận". |
| Thiếu | Không có bước nào so sánh `TEST_DATABASE_URL` với `DATABASE_URL`, hay kiểm tra DB có dữ liệu thật. |

Hậu quả: bộ test backend chạy trực tiếp trên DB live, áp migration 0016 và tạo dữ liệu fixture (xem báo cáo kiểm kê).

## 2. Phương án đề xuất

### B1. Tách DB (cấu hình, cần Owner duyệt)
1. Tạo DB riêng trên cùng cluster: `mglite_ci_test` (tên chứa `_ci_test`, không trùng DB live).
2. `.env` giữ `DATABASE_URL` (live). Chuyển `TEST_DATABASE_URL` và `CONFIRM_ISOLATED_TEST_DB` sang file mới `.env.test` (không nạp mặc định). Script test nạp `.env.test`.
3. Bỏ `CONFIRM_ISOLATED_TEST_DB` khỏi `.env`.
4. DB test được tạo lại sạch trước mỗi lần chạy lớn (`DROP/CREATE` + `scripts/migrate.mjs`), như quy trình `fin_qa_*` đã dùng.

### B2. Cơ chế chặn trong mã (cần sửa `isSafeTestDatabase`, cần duyệt)
Thêm các điều kiện fail-closed:
1. **Từ chối nếu `TEST_DATABASE_URL` trùng `DATABASE_URL`** (so khớp host + port + tên DB, bỏ qua mật khẩu).
2. **Từ chối nếu DB test trùng DB mà API live đang dùng** (đọc `DATABASE_URL` trong `.env` nếu có).
3. **Từ chối nếu DB đã có dấu hiệu dữ liệu thật**: bảng `fin_entries` có bản ghi do người dùng tạo, hoặc `users.username_normalized` có `admin`/`owner` với mật khẩu khác fixture. Cách gọn nhất: yêu cầu bảng marker `_qa_marker(created_by='test-harness')`, do script reset tạo; DB không có marker bị từ chối.
4. **Tên DB phải khớp** `^(mglite|fin)_(ci|qa)_` thay vì chỉ chứa `test`.
5. In rõ DB đích (host:port/db, che mật khẩu) ở đầu mỗi bộ test.

### B3. Quy trình
1. `npm run test:backend` chỉ chạy được qua wrapper `scripts/test-safe.mjs`: nạp `.env.test`, kiểm tra B2, rồi mới spawn `node --test`.
2. Ghi vào README: tuyệt đối không export `DATABASE_URL` live khi chạy test.
3. (Tùy chọn) Dùng cổng Postgres riêng (ví dụ 55500) cho DB test để tách hẳn khỏi cluster live.

## 3. Thứ tự áp dụng khi được duyệt
1. Tạo `mglite_ci_test` + `.env.test` (không đụng DB live).
2. Triển khai B2 kèm test cho guard (trường hợp trùng URL phải bị từ chối).
3. Chạy lại toàn bộ test trên DB mới.
4. Chỉ sau đó mới sửa `.env` (bỏ biến test).

## 4. Rủi ro / lưu ý
- Sửa `.env` ảnh hưởng mọi dev; làm sau cùng và backup `.env` trước.
- DB `mglite_unified_qa_test` hiện vừa là live vừa mang tên test: nên đổi tên thành `mglite_live` sau này, nhưng đổi tên DB cần dừng API, **cần cửa sổ bảo trì và Owner duyệt riêng**.
