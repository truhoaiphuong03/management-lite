# Quy trình Phát hành qua Cổng Khóa Chủ sở hữu (`Owner-Locked Release Gate`)

> Tài liệu chuẩn hóa thuộc **Phase 16 (`Task 16.2`)** — Thay thế hoàn toàn thao tác chép tệp thủ công (`Copy-Item`) hoặc dừng tiến trình `node` trực tiếp trên máy chủ Production (`https://ql.hoaiphuong.click`).

---

## 1. Nguyên tắc bất biến (`Zero Manual Production Copy`)

1. **Cấm chép tay sang Production:**
   - Tuyệt đối không dùng `Copy-Item`, `robocopy` hay sửa trực tiếp trong `C:\HoaiPhuong-Server\apps\management-lite`.
   - Tuyệt đối không chạy `Stop-Process -Name node` trực tiếp khi chưa đi qua kịch bản phát hành có khả năng tự động quay lui (`Rollback`).
2. **Một nguồn sự thật duy nhất (`Single Source of Truth`):**
   - Số phiên bản được lấy từ `package.json` và mã commit lấy tự động từ `git rev-parse HEAD` thông qua `node scripts/gen-build-info.mjs`.
   - Gói phát hành được đóng gói định danh kèm bảng băm `SHA-256` (`manifest.json`) bằng `scripts/deployment/package-release-bundle.mjs`.

---

## 2. Các bước chuẩn bị trước khi phát hành (Trên môi trường `DEV`)

Chạy tuần tự tại thư mục gốc `C:\Projects\management-lite`:

```powershell
# 1. Đồng bộ thông tin phiên bản + commit và biên dịch toàn bộ TypeScript + Giao diện Web
node scripts/gen-build-info.mjs --sync-contracts
npm run build
npm run build:web
node scripts/gen-build-info.mjs

# 2. Kiểm tra ngân sách dung lượng gói tải lần đầu (<= 450 KB raw / <= 130 KB gzip)
npm run check:bundle

# 3. Chạy bộ kiểm thử bảo mật, giao diện và backend
node --test tests/security/*.test.mjs
node --test tests/web/*.test.mjs

# 4. Đóng gói bản phát hành có manifest SHA-256
node scripts/deployment/package-release-bundle.mjs --type=full
```

---

## 3. Phê duyệt và Triển khai qua Cổng Owner (`Owner-Locked Gate`)

Chỉ **Chủ sở hữu (`Owner`)** thực hiện bước ký duyệt và kích hoạt triển khai trong cửa sổ **PowerShell (`Run as Administrator`)**:

### 3.1. Sao lưu Khóa Mã hóa (`key-escrow.mjs`) & Cơ sở dữ liệu (`Backup-Postgres.ps1`) ra Ngoài Ổ `C:` (Trước khi phát hành có Migration)

1. **Niêm phong (`seal`) và kiểm chứng (`verify`) 2 khóa mã hóa Production ra thiết bị ngoài ổ `C:` (không trích xuất ra tệp plaintext):**

   ```powershell
   cd C:\Projects\management-lite
   New-Item -ItemType Directory -Path "D:\HoaiPhuong-KeyEscrow" -Force | Out-Null

   # Niêm phong 2 khóa ACCOUNT_SECRET_KEY và STORAGE_DRIVE_ENCRYPTION_KEY_HEX
   node scripts/governance/key-escrow.mjs seal `
     --env "C:\HoaiPhuong-Server\config\test-secrets\api.env" `
     --out "D:\HoaiPhuong-KeyEscrow\ml-prod-keys-20261102.escrow" `
     --vars ACCOUNT_SECRET_KEY,STORAGE_DRIVE_ENCRYPTION_KEY_HEX

   # Kiểm chứng giải mã AES-256-GCM trong bộ nhớ và đối chiếu khớp với api.env (không ghi tệp plaintext)
   node scripts/governance/key-escrow.mjs verify `
     --escrow "D:\HoaiPhuong-KeyEscrow\ml-prod-keys-20261102.escrow" `
     --env "C:\HoaiPhuong-Server\config\test-secrets\api.env"
   ```

2. **Tạo bản sao lưu PostgreSQL Production trực tiếp ra thiết bị ngoài ổ `C:` bằng `C:\HoaiPhuong-Server\scripts\Backup-Postgres.ps1`:**
   ```powershell
   New-Item -ItemType Directory -Path "D:\HoaiPhuong-DBBackups" -Force | Out-Null

   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\HoaiPhuong-Server\scripts\Backup-Postgres.ps1" `
     -PgBin "C:\HoaiPhuong-Server\config\postgresql-18\pgsql\bin" `
     -Database "management_lite_test" `
     -User "hp_test_admin" `
     -PasswordFile "C:\HoaiPhuong-Server\config\test-secrets\pgpass.conf" `
     -BackupDirectory "D:\HoaiPhuong-DBBackups" `
     -Port 55432
   ```

### 3.2. Kiểm tra Preflight Chỉ Đọc (`-DryRunPreflightOnly`) & Phát hành 1-Chạm (`Invoke-OwnerReleaseToWeb.ps1`)

1. **Chạy kiểm tra Preflight chỉ đọc (Xác minh Controller SHA-256, Artifact, `schemaIdentity`, `ci-run-receipt` và Live GitHub Actions API — `0` ghi đĩa Production):**

   ```powershell
   cd C:\Projects\management-lite
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deployment\Invoke-OwnerReleaseToWeb.ps1 `
     -CommitSha (git rev-parse HEAD) `
     -DryRunPreflightOnly
   ```

2. **Ký duyệt Ed25519 và triển khai 1-chạm có Pre-Deploy Backup + Migration (`Invoke-OwnerReleaseToWeb.ps1`):**

   ```powershell
   # Nếu đăng ký cặp khóa Owner mới lần đầu, thêm cờ -EnrollNewPublicKey
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deployment\Invoke-OwnerReleaseToWeb.ps1 `
     -CommitSha (git rev-parse HEAD) `
     -EnrollNewPublicKey
   ```

   _(Lưu ý tương thích: Quy trình 1-chạm `Invoke-OwnerReleaseToWeb.ps1` thay thế thao tác rời rạc `Sign-Release-Owner.ps1` + `Deploy-SemiAutoWindows.ps1` trước đây)._

3. **Phục hồi Tiến về Phía trước (`Forward Recovery`) nếu Migration đã thành công nhưng Runtime Cutover gặp sự cố (`STOP_NO_GO_INCOMPATIBLE_ROLLBACK`):**
   - Không chỉnh sửa thủ công `approval-watermark.json` hoặc `approval-audit.jsonl`.
   - Chạy lại `Invoke-OwnerReleaseToWeb.ps1` kèm cờ `-Force` và nhập Passphrase Owner để ký biên nhận `sequence` mới tiếp theo:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deployment\Invoke-OwnerReleaseToWeb.ps1 `
     -CommitSha (git rev-parse HEAD) `
     -Force
   ```

4. **Cập nhật máy chủ tĩnh (`serve-web.cjs`):**
   - Sau khi gói phát hành được cổng Owner xác thực, dịch vụ Web tĩnh sử dụng tệp chuẩn trong kho mã `scripts/runtime/serve-web.cjs` (bao gồm header bảo mật CSP, XFO, HSTS, nén Brotli/Gzip và bộ nhớ đệm `immutable` 1 năm cho `/assets/*`).

---

## 4. Khôi phục khẩn cấp (`Rollback`)

Nếu cổng kiểm tra sức khỏe (`/api/v1/health`) hoặc kiểm thử khói (`Test-CriticalSmoke.ps1`) báo lỗi, hệ thống tự động khôi phục về bản chụp trước đó. Trong trường hợp cần khôi phục thủ công theo lệnh Owner:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Projects\management-lite\scripts\deployment\Rollback-Release.ps1
```
