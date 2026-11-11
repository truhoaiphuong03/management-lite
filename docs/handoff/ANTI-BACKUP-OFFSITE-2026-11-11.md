# Giao việc cho Anti — Kiểm tra sao lưu Management Lite trên WIN-1 + thêm bản sao ngoài máy chủ

Ngày: 2026-11-11 · Người giao: Claude (theo yêu cầu Owner) · Người làm: Anti · Người duyệt cuối: Owner

## Bối cảnh (đã kiểm tra)

- Sao lưu hiện tại chỉ nằm **trên chính WIN-1**: `C:\HoaiPhuong-Server\backups\postgres\*.dump` (tạo bởi `Backup-Postgres.ps1` khi deploy, xem `scripts/deployment/Deploy-SemiAutoWindows.ps1` dòng ~1714).
- Kho GitHub riêng tư `truhoaiphuong03/management-lite-backups` được tạo để chứa bản sao **đã mã hoá** (AES-256-GCM + scrypt, dạng Release Assets) — nhưng hiện có **0 bản**. Tức là chưa từng có bản sao ra ngoài máy chủ.
- Hai khoá mã hoá (`ACCOUNT_SECRET_KEY`, `STORAGE_DRIVE_ENCRYPTION_KEY_HEX`) không nằm trong bản sao lưu nào — xem `docs/remediation/OWNER-KEY-BACKUP-GUIDE.md` (việc này Owner tự làm, Anti chỉ hỏi Owner đã làm chưa).

## ⛔ Luật bắt buộc (đọc `AGENTS.md` mục 0 trước)

- **Không ghi** bất cứ thứ gì vào `C:\HoaiPhuong-Server\` (kể cả thư mục `backups`). Chỉ được **đọc**.
- **Không đụng** PostgreSQL Production cổng `55432` ngoài lệnh chỉ đọc; không dừng/khởi động dịch vụ `HPManagementLite*`.
- **Không push lên `main`** (push vào main = tự deploy lên web thật). Làm trên nhánh `feat/offsite-backup`, mở PR.
- Không in, không commit, không gửi qua chat: mật khẩu DB, passphrase, nội dung `api.env`, file `.dump`.
- Việc đăng ký lịch chạy tự động (Task Scheduler) và lần chạy thật đầu tiên: **Anti chỉ viết sẵn lệnh, Owner tự chạy.**

## Phần A — Kiểm tra sao lưu hiện có (chỉ đọc, trên WIN-1)

Trả lời từng câu, kèm lệnh đã chạy và kết quả:

1. Có lịch sao lưu tự động hằng ngày không? (`Get-ScheduledTask` — tìm task liên quan backup/postgres; ghi tên, giờ chạy, lần chạy gần nhất, kết quả `LastTaskResult`.)
2. Bản sao lưu mới nhất: tên file, ngày giờ, dung lượng. Tổng số file và tổng dung lượng trong `backups\postgres`. Có tự xoá bản cũ không?
3. Bản sao lưu có gồm **file chứng từ/hoá đơn** (`FIN_RECEIPT_DIR`) không, hay chỉ có database?
4. **Thử khôi phục thật**: copy bản `.dump` mới nhất ra thư mục ngoài Production, `pg_restore` vào một database tạm trên cụm **DEV/TEST** (ví dụ `:55499`, KHÔNG phải `55432`), đếm số dòng vài bảng chính (nhân viên, chấm công, thu chi) so với Production (truy vấn chỉ đọc). Xong thì xoá database tạm. Có thể dùng `scripts/ops/backup-restore-drill.mjs`.
5. Ổ C: còn trống bao nhiêu?

## Phần B — Thêm bản sao ra ngoài máy chủ

Viết script mới `scripts/ops/Push-OffsiteBackup.ps1` (hoặc `.mjs`) + script giải mã `scripts/ops/Restore-OffsiteBackup.ps1`:

1. Lấy bản `.dump` mới nhất (+ nén thư mục chứng từ nếu Phần A cho thấy chưa có) — **chỉ đọc** từ `C:\HoaiPhuong-Server\`, file tạm để ở thư mục ngoài, ví dụ `C:\HP-Offsite\staging\`, xoá sau khi xong.
2. Mã hoá AES-256-GCM, khoá dẫn xuất bằng scrypt từ passphrase. Passphrase đọc từ file do Owner tạo **ngoài repo** (ví dụ `C:\HP-Offsite\passphrase.txt`, quyền chỉ user chạy task) — script từ chối chạy nếu file nằm trong thư mục Git.
3. Tải lên kho `management-lite-backups` dạng Release Asset (`gh release create`/`upload`), tên kèm ngày giờ và mã SHA-256. Nếu file > 1.9 GB thì chia nhỏ.
4. **Tự kiểm chứng**: tải ngược bản vừa lên, so SHA-256, giải mã thử ra file tạm và chạy `pg_restore --list` để chắc đọc được.
5. Giữ 14 bản hằng ngày gần nhất + 1 bản mỗi tháng; xoá release cũ hơn.
6. Ghi log ra `C:\HP-Offsite\logs\` (không ghi passphrase/khoá vào log). Lỗi thì exit code ≠ 0.
7. Kèm test tự động (`tests/backend/offsite-backup.test.mjs`): mã hoá → giải mã khớp; sai passphrase thì báo lỗi; từ chối passphrase file trong thư mục Git. Chạy với file dump **giả**, không mạng.

Thử toàn bộ quy trình bằng một bản dump từ DB **DEV/TEST** (không dùng dữ liệu thật) lên một release tên `test-...`, sau đó xoá release test.

## Bàn giao (bằng chứng cần có trong PR)

- File báo cáo `docs/handoff/ANTI-BACKUP-OFFSITE-REPORT.md`: trả lời 5 câu Phần A + kết quả thử khôi phục + kết quả chạy thử Phần B.
- Nhánh `feat/offsite-backup`, PR vào `main` (KHÔNG tự merge). `npm run lint`, `npm run typecheck`, test mới đều PASS.
- Mục "Việc Owner cần làm" trong báo cáo, mỗi bước là một lệnh copy-dán được: (1) tạo passphrase file, (2) cất passphrase bản thứ hai ở nơi khác, (3) chạy tay lần đầu, (4) lệnh `Register-ScheduledTask` chạy hằng ngày sau giờ sao lưu, (5) cách khôi phục khi mất máy.
- Nếu gặp việc buộc phải ghi vào Production: **DỪNG và báo Owner.**
