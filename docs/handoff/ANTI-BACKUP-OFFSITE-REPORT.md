# Báo cáo Kiểm tra Sao lưu trên WIN-1 & Triển khai Bản sao Ngoài Máy chủ (Offsite Backup)

- **Ngày thực hiện:** `2026-11-11`
- **Máy thực hiện:** `WIN-1` (`DESKTOP-8T8UHTS`)
- **Worktree làm việc:** `C:\Projects\management-lite-offsite` (nhánh `feat/offsite-backup`)
- **Trạng thái tuân thủ `AGENTS.md` §0:** `PASS` — **0** thao tác ghi vào `C:\HoaiPhuong-Server\`, **0** thao tác ghi vào PostgreSQL Production `:55432`, **0** lộ bí mật/mật khẩu/passphrase.

---

## Phần A — Kết quả Kiểm tra Sao lưu Hiện có trên WIN-1 (Chỉ đọc)

### Câu 1: Có lịch sao lưu tự động hằng ngày không?
- **Trả lời:** **CÓ.** Trên máy `WIN-1` có đăng ký tác vụ Windows Task Scheduler tên **`\HPManagementLiteBackup`** chạy dưới quyền hệ thống `NT AUTHORITY\SYSTEM` (`S-1-5-18`, `LogonType: ServiceAccount`).
  - *Lưu ý kỹ thuật:* Vì tác vụ đăng ký dưới `SYSTEM` (`S-1-5-18`), khi chạy `Get-ScheduledTask` ở cửa sổ PowerShell thường (không Elevated/Admin) Windows sẽ ẩn tác vụ này. Thông tin cấu hình và kết quả chạy thực tế được xác minh từ hồ sơ đặc quyền `C:\HoaiPhuong-Server\reports\HPManagementLiteBackup.task.xml`, `C:\HoaiPhuong-Server\reports\scheduled-tasks-elevated.json`, `C:\HoaiPhuong-Server\reports\scheduled-backup-result.txt` và nhật ký `C:\HoaiPhuong-Server\logs\scheduled-backup.log`.
- **Chi tiết tác vụ `\HPManagementLiteBackup`:**
  - **Tên Task:** `\HPManagementLiteBackup` (`State: Ready`, `Enabled: true`)
  - **Lệnh thực thi:** `pwsh.exe -NoProfile -File C:\HoaiPhuong-Server\scripts\Scheduled-Backup.ps1`
  - **Giờ chạy:** Hằng ngày lúc **`03:00:00+07:00`** (`CalendarTrigger`, `DaysInterval: 1`, `StartBoundary: 2026-10-12T03:00:00+07:00`)
  - **Lần chạy gần nhất:** **`2026-11-11 03:00:02` → `2026-11-11 03:00:04.8963230+07:00`**
  - **Kết quả (`LastTaskResult`):** **`0` (`SUCCESS 2026-11-11T03:00:04.8963230+07:00`)**
- **Lệnh đã chạy (chỉ đọc):**
  ```powershell
  Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' }
  Get-Content -LiteralPath 'C:\HoaiPhuong-Server\reports\HPManagementLiteBackup.task.xml'
  Get-Content -LiteralPath 'C:\HoaiPhuong-Server\reports\scheduled-backup-result.txt'
  Get-Content -LiteralPath 'C:\HoaiPhuong-Server\logs\scheduled-backup.log' -Tail 30
  ```

---

### Câu 2: Bản sao lưu mới nhất, tổng số file, tổng dung lượng & cơ chế tự xóa bản cũ
- **Trả lời:** Trên `C:\HoaiPhuong-Server\backups\` hiện có **2 thư mục** chứa file `.dump` của PostgreSQL:
  1. **Thư mục `C:\HoaiPhuong-Server\backups\postgres` (tạo bởi `Deploy-SemiAutoWindows.ps1` trước mỗi lần deploy):**
     - **Bản mới nhất:** `postgres-20261111T005151Z-f2fea68815774175b34abfd19233993e.dump`
     - **Ngày giờ:** `2026-11-11 07:51:52 +07:00` (`2026-11-11T00:51:51Z`)
     - **Dung lượng bản mới nhất:** `593.971 bytes` (`~580,05 KB`)
     - **Tổng số file trong `backups\postgres`:** `48 file` (`24` file `.dump` + `24` file `.dump.sha256.json`)
     - **Tổng dung lượng trong `backups\postgres`:** `12.609.979 bytes` (`~12,03 MB`; riêng 24 file `.dump` là `12.604.171 bytes`)
  2. **Thư mục `C:\HoaiPhuong-Server\backups\postgresql` (mặc định của `Backup-Postgres.ps1` khi chạy từ lịch hằng ngày `Scheduled-Backup.ps1` lúc 03:00 sáng):**
     - **Bản mới nhất:** `postgres-20261110T200002Z-bbe47ca34e9e4dfa89929d1433b624b3.dump`
     - **Ngày giờ:** `2026-11-11 03:00:03 +07:00` (`2026-11-10T20:00:02Z`)
     - **Dung lượng bản mới nhất:** `593.540 bytes` (`~579,63 KB`)
     - **Tổng số file trong `backups\postgresql`:** `108 file` (`54` file `.dump` + `54` file `.dump.sha256.json`)
     - **Tổng dung lượng trong `backups\postgresql`:** `17.814.870 bytes` (`~16,99 MB`; riêng 54 file `.dump` là `17.802.126 bytes`)
- **Có tự xóa bản cũ không?**
  - **KHÔNG.** Cả `Backup-Postgres.ps1` lẫn `Scheduled-Backup.ps1` đều **không xóa** bản cũ. Dòng 8–10 của `C:\HoaiPhuong-Server\scripts\Scheduled-Backup.ps1` ghi rõ:
    ```powershell
    # Preserve all backups until a verified independent copy is configured.
    $expired=@(Get-ChildItem "$r\backups\postgresql" -Filter 'postgres-*.dump' -File | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Select-Object Name,Length,LastWriteTime)
    ConvertTo-Json -InputObject $expired | Set-Content "$r\reports\backup-retention-review.json"
    ```
    (Chỉ liệt kê các file quá 30 ngày vào `backup-retention-review.json` chứ không xóa).

---

### Câu 3: Bản sao lưu có gồm file chứng từ/hóa đơn (`FIN_RECEIPT_DIR`) không, hay chỉ có database?
- **Trả lời:** **KHÔNG gồm file chứng từ/hóa đơn (`FIN_RECEIPT_DIR`).**
  - Bản sao lưu hiện tại chỉ gồm:
    1. File `.dump` của PostgreSQL (`pg_dump --format=custom`).
    2. File nén cấu hình `C:\HoaiPhuong-Server\backups\config-<timestamp>.zip` (chỉ nén `config\services\*.xml`, `postgresql.conf`, `pg_hba.conf`, `scripts\*.ps1`, `scripts\*.cjs`).
  - Biến `FIN_RECEIPT_DIR` đang trỏ tới `C:\HoaiPhuong-Server\apps\management-lite\data\receipts` (thư mục đang tồn tại, hiện có `0` file chứng từ bên trong).
  - Trong **Phần B**, script `scripts/ops/Push-OffsiteBackup.ps1` đã được bổ sung bước kiểm tra chỉ đọc `FIN_RECEIPT_DIR`: nếu có file chứng từ bên trong sẽ tự động nén thành `receipts-<timestamp>.zip` tại thư mục tạm ngoài Production, mã hóa AES-256-GCM + scrypt (`receipts-<timestamp>.zip.enc`) và đẩy lên cùng Release với bản `.dump.enc`.

---

### Câu 4: Thử khôi phục thật (`pg_restore` sang cụm DEV/TEST cô lập `:55433`) & đối chiếu số dòng với Production
- **Thực hiện:**
  1. Sao chép chỉ đọc bản `.dump` mới nhất (`postgres-20261111T005151Z-f2fea68815774175b34abfd19233993e.dump`) ra thư mục tạm ngoài Production: `C:\ML-Test\work\restore-drill-20261111\`.
  2. Kiểm tra mã băm SHA-256 của bản `.dump` khớp 100% với `.sha256.json`: `C84DE1BAD077B5A6046D5400199CAA8F937BF64FC2E5B8E5A82D15E7CCC70EA8` (và bản `03:00 AM` khớp 100%: `CC0F885ABDB4046E5CC520D9329833A4864B0A983B33991C31BD17CB7CDF2EB6`).
  3. Tạo database tạm `mglite_restore_drill_temp_20261111` trên cụm PostgreSQL 18.6 **TEST cô lập cổng `:55433`** (`C:\ML-Test\pgdata`) và chạy `pg_restore --no-owner --no-privileges --exit-on-error` (hoàn tất trong `5.591 ms`, exit code `0`).
  4. Truy vấn đếm số dòng các bảng chính trên DB tạm `:55433` và đối chiếu với truy vấn chỉ đọc (`SET default_transaction_read_only = on`) trên Production `:55432` lúc `21:10 +07:00`:

| Bảng dữ liệu | Bản khôi phục trên `:55433` (từ dump `07:51 AM`) | Production `:55432` (chỉ đọc lúc `21:10 PM`) | Đánh giá đối chiếu |
| --- | ---: | ---: | --- |
| `workspaces` | `3` | `3` | Khớp 100% |
| `users` | `10` | `10` | Khớp 100% |
| `employees` (Nhân viên) | `3` | `3` | Khớp 100% |
| `attendance_shifts` (Chấm công) | `61` | `62` | Khớp (1 ca mới chấm trong ngày 11/11 sau `07:51 AM`) |
| `work_items` (Công việc) | `5` | `11` | Khớp (6 việc mới tạo trong ngày 11/11 sau `07:51 AM`) |
| `fin_entries` (Thu chi) | `5` | `5` | Khớp 100% |
| `payroll_periods` (Kỳ lương) | `5` | `5` | Khớp 100% |
| `managed_accounts` (Tài khoản) | `17` | `17` | Khớp 100% |
| `print_quotes` (Báo giá in) | `0` | `0` | Khớp 100% |
| `print_orders` (Đơn hàng in) | `0` | `0` | Khớp 100% |

  5. Đã xóa database tạm `DROP DATABASE mglite_restore_drill_temp_20261111` trên `:55433` và xóa sạch thư mục tạm `C:\ML-Test\work\restore-drill-20261111\`.

---

### Câu 5: Ổ `C:` còn trống bao nhiêu?
- **Trả lời:** Ổ `C:` còn trống **`27,10 GB`** (`29.103.308.800 bytes`) trên tổng dung lượng **`231,35 GB`** (đã dùng `204,25 GB`).
- **Lệnh đã chạy:**
  ```powershell
  Get-PSDrive C | Select-Object Name, @{N='UsedGB';E={[math]::Round($_.Used/1GB,2)}}, @{N='FreeGB';E={[math]::Round($_.Free/1GB,2)}}, @{N='TotalGB';E={[math]::Round(($_.Used+$_.Free)/1GB,2)}}, Free, Used
  ```

---

## Phần B — Triển khai & Kết quả Chạy thử Bản sao Ngoài Máy chủ (DEV/TEST)

### 1. Các tệp đã xây dựng
1. [`scripts/ops/offsite-backup-core.mjs`](../../scripts/ops/offsite-backup-core.mjs):
   - Kiểm tra an toàn file passphrase (`readAndValidatePassphraseFile`): từ chối chạy ngay lập tức (`REFUSED_PASSPHRASE_IN_GIT`) nếu file passphrase hoặc file đầu ra nằm trong bất kỳ thư mục Git nào; bắt buộc passphrase tối thiểu `16` ký tự.
   - Mã hóa & giải mã **AES-256-GCM** kết hợp dẫn xuất khóa **scrypt** (`N=131072, r=8, p=1`), xác thực toàn vẹn Header JSON qua GCM AAD và kiểm tra đối chiếu `plaintext_sha256` sau giải mã.
   - Tự động chia nhỏ (`part001`, `part002`...) nếu kích thước file mã hóa vượt quá `1,9 GB` (`1.900.000.000 bytes`) kèm manifest `.sha256.json`, và tự ghép lại khi giải mã.
   - Chính sách lưu giữ (`computeReleasesToPrune`): giữ **14 bản hằng ngày gần nhất** + **1 bản mới nhất của mỗi tháng**, tự động xóa các release/tag cũ hơn.
2. [`scripts/ops/Push-OffsiteBackup.ps1`](../../scripts/ops/Push-OffsiteBackup.ps1):
   - Tự chọn bản `.dump` mới nhất (chỉ đọc từ `C:\HoaiPhuong-Server\backups\postgresql` và `C:\HoaiPhuong-Server\backups\postgres`), đối chiếu `.sha256.json`.
   - Kiểm tra chỉ đọc `FIN_RECEIPT_DIR`; nếu có file chứng từ sẽ nén `.zip` và mã hóa `.zip.enc` tại `C:\HP-Offsite\staging\<run-id>\`.
   - Đẩy lên kho riêng tư `truhoaiphuong03/management-lite-backups` dưới dạng Release Asset (`postgres-<UTC>-sha256-<sha16>.dump.enc` + `.sha256.json`).
   - **Tự kiểm chứng (Round-trip Verification):** tải ngược toàn bộ asset vừa đẩy về thư mục tạm `verify-download`, kiểm tra SHA-256, giải mã thử ra file `.dump` tạm và chạy `pg_restore.exe --list` đảm bảo đọc được TOC hợp lệ trước khi báo `SUCCESS`.
   - Ghi nhật ký ra `C:\HP-Offsite\logs\offsite-backup-YYYYMMDD.log` (không ghi passphrase/khóa/token) và xóa sạch thư mục staging trong khối `finally`.
3. [`scripts/ops/Restore-OffsiteBackup.ps1`](../../scripts/ops/Restore-OffsiteBackup.ps1):
   - Hỗ trợ tải bản mới nhất (`-Latest`), tải theo tên release (`-Tag <tag>`), hoặc giải mã file cục bộ (`-EncryptedFile <path>`), kiểm tra SHA-256, giải mã ra `C:\HP-Offsite\restore\<tag>\` (chặn ghi vào `C:\HoaiPhuong-Server\`) và kiểm chứng bằng `pg_restore --list`.
4. [`tests/backend/offsite-backup.test.mjs`](../../tests/backend/offsite-backup.test.mjs):
   - 5 bài kiểm thử tự động (chạy offline với file dump giả, không cần mạng):
     1. Mã hóa → giải mã khớp từng byte và khớp SHA-256.
     2. Sai passphrase hoặc sửa đổi 1 byte ciphertext bị chặn bởi `DECRYPTION_AUTH_FAILED`.
     3. Từ chối file passphrase nằm trong thư mục Git (`REFUSED_PASSPHRASE_IN_GIT`).
     4. Chia nhỏ nhiều phần (`.part001`, `.part002`...) và ghép lại giải mã chính xác.
     5. Thuật toán giữ 14 bản ngày gần nhất + 1 bản mỗi tháng hoạt động chính xác.

### 2. Kết quả chạy thử toàn trình bằng dữ liệu giả DEV/TEST (không dùng dữ liệu thật)
- Tạo DB giả `mglite_offsite_dev_test_20261111` trên cụm TEST `:55433` (gồm 1 bảng `synthetic_offsite_drill` với 3 dòng dữ liệu giả `DEV_ONLY_ROW_1..3`), xuất `pg_dump` ra `postgres-devtest-20261111.dump` (`SHA256 = 95f3318d7acddca358ecc28a7c2d865c4ce5a5bb1f3d9870ca05bab66ae1f9fe`).
- Chạy `Push-OffsiteBackup.ps1 -TagPrefix test`:
  - Tạo release `test-20261111T142059Z-95f3318d` trên `truhoaiphuong03/management-lite-backups`.
  - Tải ngược release về, kiểm tra khớp SHA-256 (`ddf03a46d70a1d0591cc976da479bb846c937d53d6e51ece4459e21285d79547`), giải mã khớp SHA-256 gốc và `pg_restore --list` đọc thành công `22` dòng TOC.
- Chạy `Restore-OffsiteBackup.ps1 -Tag test-20261111T142059Z-95f3318d`:
  - Tải và giải mã thành công cả file `.dump` và `receipts.zip`, `pg_restore` vào DB tạm `mglite_offsite_dev_restore_20261111` trên `:55433` thu được đúng `3` dòng.
- Đã xóa release `test-20261111T142059Z-95f3318d` khỏi kho `truhoaiphuong03/management-lite-backups` (hiện kho trở về `0` release test) và xóa sạch DB tạm trên `:55433`.

---

## 🛠️ Việc Owner Cần Làm (Copy-Dán Chạy Trong PowerShell Của Owner)

> **Lưu ý:** Owner vui lòng kiểm tra xem đã thực hiện sao lưu 2 khóa `ACCOUNT_SECRET_KEY` và `STORAGE_DRIVE_ENCRYPTION_KEY_HEX` theo [`docs/remediation/OWNER-KEY-BACKUP-GUIDE.md`](../remediation/OWNER-KEY-BACKUP-GUIDE.md) chưa. Nếu chưa, hãy thực hiện song song vì bản `.dump` không chứa 2 khóa nằm trong `api.env`.

### Bước 1: Tạo thư mục `C:\HP-Offsite` và tệp `passphrase.txt` (chỉ tài khoản của bạn và SYSTEM đọc được)
Mở **PowerShell (Run as Administrator)** của riêng bạn (không dán passphrase vào chat AI):

```powershell
New-Item -ItemType Directory -Path 'C:\HP-Offsite\staging', 'C:\HP-Offsite\logs', 'C:\HP-Offsite\restore' -Force | Out-Null

# Nhập passphrase ẩn (>= 16 ký tự, nên dùng cụm từ dài dễ nhớ với bạn)
$sec = Read-Host -Prompt 'Nhập passphrase mã hóa Offsite Backup (>= 16 ký tự)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
if ($plain.Trim().Length -lt 16) { throw 'Passphrase phải từ 16 ký tự trở lên!' }

$passFile = 'C:\HP-Offsite\passphrase.txt'
Set-Content -LiteralPath $passFile -Value $plain.Trim() -NoNewline -Encoding UTF8
$plain = $null

# Khóa quyền truy cập tệp chỉ cho SYSTEM, Administrators và user hiện tại
icacls $passFile /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(F)" "$($env:USERNAME):(F)"
```

### Bước 2: Cất bản sao Passphrase thứ hai ở nơi độc lập ngoài máy chủ
- Lưu passphrase vừa tạo vào **Trình quản lý mật khẩu** của bạn (1Password / Bitwarden / iCloud Keychain) và/hoặc ghi ra giấy/USB bảo mật cất tách biệt với máy `WIN-1`.
- **Quan trọng:** Nếu mất cả máy `WIN-1` và quên passphrase, các bản `.dump.enc` trên GitHub sẽ không thể giải mã.

### Bước 3: Chạy tay lần đầu tiên để đẩy bản sao lưu thật lên GitHub và tự kiểm chứng
Sau khi đã merge PR này (hoặc chạy trực tiếp từ thư mục repo), chạy lệnh sau trong PowerShell của bạn:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Projects\management-lite\scripts\ops\Push-OffsiteBackup.ps1'
```

Kiểm tra kết quả hiển thị `"status": "SUCCESS"` và xem log tại:
```powershell
Get-Content -LiteralPath "C:\HP-Offsite\logs\offsite-backup-$((Get-Date).ToUniversalTime().ToString('yyyyMMdd')).log" -Tail 20
```

### Bước 4: Đăng ký lịch chạy tự động hằng ngày lúc `03:15` sáng (15 phút sau lịch sao lưu PostgreSQL `03:00` sáng)
Chạy trong **PowerShell (Run as Administrator)**:

```powershell
$action = New-ScheduledTaskAction `
  -Execute 'C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\Projects\management-lite\scripts\ops\Push-OffsiteBackup.ps1"'

$trigger = New-ScheduledTaskTrigger -Daily -At '03:15AM'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
  -TaskName 'HPManagementLiteOffsiteBackup' `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -User $env:USERNAME `
  -RunLevel Highest `
  -Force
```
> **Lưu ý:** Task đăng ký với `-User $env:USERNAME` mặc định **chỉ chạy khi user đang đăng nhập**. Nếu muốn chạy cả khi chưa đăng nhập (ví dụ sau khi máy tự khởi động lại), hãy tạo một Fine-grained Personal Access Token (`GH_TOKEN`) riêng **chỉ cấp quyền trên duy nhất kho `truhoaiphuong03/management-lite-backups`** (`Contents: Read and write`), nạp vào môi trường của script và đăng ký task chạy độc lập phiên đăng nhập.

### Bước 5: Cách tải về & khôi phục khi mất máy hoặc cần dựng lại từ bản Offsite
> **Nguyên tắc an toàn:** Tuyệt đối **KHÔNG** chạy `pg_restore --clean` đè vào database đang chạy. Luôn tạo một database mới tên `management_lite_restore_<ngày>`, khôi phục vào database mới đó (không dùng `--clean`), đếm số dòng các bảng chính để kiểm tra trước; **việc chuyển app sang database mới chỉ do Owner tự thực hiện**.

```powershell
# 1. Tải và giải mã bản sao lưu mới nhất từ kho truhoaiphuong03/management-lite-backups về C:\HP-Offsite\restore
powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Projects\management-lite\scripts\ops\Restore-OffsiteBackup.ps1' -Latest -PassphraseFile 'C:\HP-Offsite\passphrase.txt'

# 2. Tạo database mới tên management_lite_restore_<ngày>
$pgBin = 'C:\HoaiPhuong-Server\config\postgresql-18\pgsql\bin'
$psql = Join-Path $pgBin 'psql.exe'
$pgRestore = Join-Path $pgBin 'pg_restore.exe'
$restoreDb = "management_lite_restore_$((Get-Date).ToString('yyyyMMdd'))"

$env:PGPASSFILE = 'C:\HoaiPhuong-Server\config\test-secrets\pgpass.conf'
& $psql --host=127.0.0.1 --port=55432 --username=hp_test_admin --dbname=postgres --no-password -v ON_ERROR_STOP=1 -c "CREATE DATABASE $restoreDb;"

# 3. Khôi phục file .dump vào database mới $restoreDb (KHÔNG dùng --clean)
$latestDump = Get-ChildItem -Path 'C:\HP-Offsite\restore' -Filter '*.dump' -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
& $pgRestore `
  --host=127.0.0.1 --port=55432 --username=hp_test_admin --dbname=$restoreDb `
  --no-password --no-owner --no-privileges --exit-on-error $latestDump.FullName

# 4. Đếm số dòng các bảng chính trên database mới để kiểm tra toàn vẹn
& $psql --host=127.0.0.1 --port=55432 --username=hp_test_admin --dbname=$restoreDb --no-password -c @"
SELECT 'workspaces' AS tbl, COUNT(*)::int AS cnt FROM workspaces
UNION ALL SELECT 'users', COUNT(*)::int FROM users
UNION ALL SELECT 'employees', COUNT(*)::int FROM employees
UNION ALL SELECT 'attendance_shifts', COUNT(*)::int FROM attendance_shifts
UNION ALL SELECT 'work_items', COUNT(*)::int FROM work_items
UNION ALL SELECT 'fin_entries', COUNT(*)::int FROM fin_entries
UNION ALL SELECT 'payroll_periods', COUNT(*)::int FROM payroll_periods
UNION ALL SELECT 'managed_accounts', COUNT(*)::int FROM managed_accounts;
"@
Remove-Item Env:\PGPASSFILE -ErrorAction SilentlyContinue
```

> **Ghi chú quan trọng:** Sau khi kiểm tra số dòng và dữ liệu trên database mới `management_lite_restore_<ngày>` đã đầy đủ, **việc chuyển ứng dụng (cấu hình kết nối DB / đổi tên DB) sang database mới chỉ do Owner tự thực hiện**.
