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

Chỉ **Chủ sở hữu (`Owner`)** thực hiện bước ký duyệt và kích hoạt triển khai:

1. **Ký duyệt SHA phát hành (Owner):**
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\HoaiPhuong-Server\Sign-Release-Owner.ps1 -CommitSha (git rev-parse HEAD)
   ```
2. **Triển khai bán tự động có kiểm tra sức khỏe & tự động khôi phục khi lỗi:**
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\HoaiPhuong-Server\cicd-preparation\owner-locked-gate\Deploy-SemiAutoWindows.ps1
   ```
3. **Cập nhật máy chủ tĩnh (`serve-web.cjs`):**
   - Sau khi gói phát hành được cổng Owner xác thực, dịch vụ Web tĩnh sử dụng tệp chuẩn trong kho mã `scripts/runtime/serve-web.cjs` (bao gồm header bảo mật CSP, XFO, HSTS, nén Brotli/Gzip và bộ nhớ đệm `immutable` 1 năm cho `/assets/*`).

---

## 4. Khôi phục khẩn cấp (`Rollback`)

Nếu cổng kiểm tra sức khỏe (`/api/v1/health`) hoặc kiểm thử khói (`Test-CriticalSmoke.ps1`) báo lỗi, hệ thống tự động khôi phục về bản chụp trước đó. Trong trường hợp cần khôi phục thủ công theo lệnh Owner:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Projects\management-lite\scripts\deployment\Rollback-Release.ps1
```
