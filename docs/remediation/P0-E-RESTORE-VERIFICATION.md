# P0-E — Xác minh khả năng restore backup trong môi trường cô lập

**Ngày thực hiện:** 2026-11-01 19:45–19:48 (+07) · **Kết quả:** restore dữ liệu quan hệ **PASS**; khả năng giải mã bí mật sau restore **KHÔNG ĐẠT** (khóa chưa được ký quỹ — xem P0-C). Chưa thể kết luận backup "đạt chuẩn" toàn diện.

## 1. Môi trường cô lập đã dùng

| Thuộc tính  | Giá trị                                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vị trí      | `C:\Projects\management-lite-remediation\.local\ml-restore\` (trong worktree, **ngoài** `C:\HoaiPhuong-Server`)                                                                  |
| PostgreSQL  | 18.6 (binary Production chỉ được _thực thi_, không ghi), cụm **mới** tạo bằng `initdb` (`--data-checksums`, `scram-sha-256`)                                                     |
| Mạng        | `127.0.0.1:55433` (kiểm tra: không lắng nghe địa chỉ nào khác); `pg_hba` từ chối replication                                                                                     |
| Tách biệt   | `system_identifier` của cụm test **khác** cụm Production (đọc Production bằng `pg_controldata` chỉ-đọc); cổng khác `55432`; PID lắng nghe `55432` trước/sau = `5656` (không đổi) |
| Dữ liệu vào | 3 bản dump **sao chép** từ `C:\HoaiPhuong-Server\backups` (mới nhất 11/1 03:00; 10/23 03:00; cũ nhất 10/12 01:14); hash bản sao = sidecar `.sha256.json` (3/3)                   |
| Bảo mật     | `log_statement=none`; mật khẩu cụm ngẫu nhiên, lưu trong `.local\…\secrets`; **không** dùng bất kỳ khóa/bí mật Production; không đọc/ghi `api.env`                               |
| Dọn dẹp     | Sau khi đo: dừng cụm; xóa dump sao chép, thư mục dữ liệu, bí mật, log. Chỉ giữ số liệu tổng hợp (không có dữ liệu cá nhân) trong `docs/remediation/evidence/`                    |

## 2. Kết quả restore (số liệu thật)

| Bản dump                      | Lệnh                                                    | Kết quả           | Thời gian | Bảng           | `schema_migrations`                          | Tổng số dòng | Bảng có dữ liệu |
| ----------------------------- | ------------------------------------------------------- | ----------------- | --------- | -------------- | -------------------------------------------- | ------------ | --------------- |
| **new** (11/1 03:00, 384 KB)  | `pg_restore --no-owner --no-privileges --exit-on-error` | **exit 0, 0 lỗi** | 1,6 s     | 64 (= mục lục) | 31 (đến `0031_accounts_ecosystem_hierarchy`) | 825          | 29/64           |
| **mid** (10/23 03:00, 355 KB) | như trên                                                | **exit 0, 0 lỗi** | 1,3 s     | 62 (= mục lục) | 26 (đến `0026_user_profile_phone`)           | 544          | 14/62           |
| **old** (10/12 01:14, 45 KB)  | như trên                                                | **exit 0, 0 lỗi** | 0,4 s     | 13 (= mục lục) | 4 (đến `0004_m02b_user_workspace_bindings`)  | 4            | 1/13            |

Kiểm tra toàn vẹn trên cả 3 bản: **0** ràng buộc chưa xác thực, **0** chỉ mục không hợp lệ, trigger người dùng còn nguyên (36/36/1 — gồm các trigger bất biến audit/ca làm).
Đối chiếu phiên bản lược đồ: **checksum của mọi dòng `schema_migrations` khớp 100%** với các tệp migration trong repo (31/31, 26/26, 4/4; 0 sai khác, 0 không có trong repo).

Số dòng của các bảng chính (bản mới nhất): `users` 10, `employees` 4, `attendance_shifts` 55, `daily_reports` 50, `audit_events` 235, `workspaces` 3, `work_items` 0, `account_secrets` 1.

> **Đính chính số liệu báo cáo trước:** "126 bảng" là số câu `CREATE TABLE` đếm trùng cả tệp `.sql` lẫn bản nhúng trong `catalog.ts`; số bảng thực là **64**. Con số "127 bảng" khi đọc mục lục dump cũng đếm cả mục không phải bảng; số đúng là 64 (khớp bảng đã restore).

## 3. Kết luận theo tiêu chí

| Tiêu chí                                                 | Kết quả                   | Bằng chứng                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dump đọc được, không hỏng                                | **PASS**                  | 45/45 sha256 khớp (đợt kiểm tra trước) + 3/3 restore thật                                                                                                                                                                                     |
| Restore hoàn toàn trong môi trường cô lập                | **PASS**                  | cụm riêng, `system_identifier` khác, Production không đổi                                                                                                                                                                                     |
| Restore không lỗi, đủ bảng                               | **PASS**                  | exit 0, `--exit-on-error`, bảng restore = mục lục                                                                                                                                                                                             |
| Lược đồ đúng phiên bản                                   | **PASS**                  | 31 migration, checksum khớp repo                                                                                                                                                                                                              |
| Ràng buộc/chỉ mục/trigger toàn vẹn                       | **PASS**                  | 0 vi phạm                                                                                                                                                                                                                                     |
| Thời gian khôi phục (RTO) dữ liệu                        | **PASS (mẫu nhỏ)**        | 0,4–1,6 s cho 45–384 KB; **chưa** đại diện khi dữ liệu lớn                                                                                                                                                                                    |
| Điểm khôi phục (RPO)                                     | **WARNING**               | dump 1 lần/ngày lúc 03:00 ⇒ tối đa mất ~24 giờ dữ liệu                                                                                                                                                                                        |
| Bí mật mã hóa sau restore giải mã được                   | **FAIL (rủi ro đã biết)** | bản mới nhất có `account_secrets` = 1 dòng, `storage_drive_connections` = 1 dòng chứa ciphertext (GCM). Khóa **không** nằm trong backup → không giải mã được nếu mất `api.env`. Chưa thử giải mã vì **không dùng khóa thật** (đúng ràng buộc) |
| Biên lai (`FIN_RECEIPT_DIR`)                             | **WARNING**               | thư mục hiện trống, không thuộc tập backup                                                                                                                                                                                                    |
| Backup ngoài máy                                         | **FAIL (chưa có)**        | chỉ có ổ `C:`                                                                                                                                                                                                                                 |
| Khôi phục toàn hệ thống (mã + cấu hình + dịch vụ + khóa) | **NOT TESTED**            | cần TEST/STAGING và khóa test (Đợt 2)                                                                                                                                                                                                         |

**Kết luận chính thức:** _Backup dữ liệu quan hệ đạt yêu cầu về toàn vẹn và khả năng restore trong 3/3 mẫu._ **Chưa** kết luận backup "đạt chuẩn": thiếu ký quỹ khóa (R3), thiếu bản sao ngoài máy, RPO 24 giờ, và chưa diễn tập khôi phục toàn hệ thống.

## 4. Hạn chế của lần kiểm chứng

- Chỉ 3/45 bản được restore thật (10/12, 10/23, 11/1); 45/45 đã kiểm hash và 1 bản đã đọc mục lục.
- Dữ liệu nhỏ (825 dòng) nên không đo được RTO ở quy mô lớn.
- Không so khớp nội dung với DB Production đang chạy (không truy vấn Production theo ràng buộc); toàn vẹn dựa trên checksum dump + kiểm tra cấu trúc/ràng buộc.
- Phát hiện kỹ thuật: gọi `pg_ctl start` kèm chuyển hướng đầu ra trong PowerShell bị treo vì tiến trình PostgreSQL kế thừa ống; đã khắc phục bằng `Start-Process` có chuyển hướng ra tệp. Lần thử đầu bị hủy bỏ (cụm test bị dừng cùng tiến trình cha); **Production không bị ảnh hưởng** (PID `55432` không đổi).

## 5. Việc tiếp theo (Đợt 2, cần duyệt)

1. Dựng `C:\ML-Test` chính thức theo thiết kế và chạy bộ test DB-live (13+2 bài đang BLOCKED).
2. Diễn tập khôi phục có khóa **test** + escrow (P0-C §5).
3. Đo RTO với dữ liệu tổng hợp lớn hơn; xác định chính sách RPO (dump nhiều lần/ngày hoặc WAL).
4. Quyết định đích sao lưu ngoài máy (OA-7).

## 6. Rollback

Không có thay đổi cần hoàn tác (dữ liệu thử nghiệm đã bị xóa; không đụng Production). Nếu cần lặp lại: `scripts/` kèm tài liệu này không đóng gói script restore (script chạy tạm nằm ngoài repo); chỉ tạo lại khi Đợt 2 được duyệt.
