# P0-C — Đánh giá phương án ký quỹ khóa (key escrow)

**Phạm vi khóa:** `ACCOUNT_SECRET_KEY`, `STORAGE_DRIVE_ENCRYPTION_KEY_HEX` (và các bí mật cùng chỗ trong `api.env`).
**Ràng buộc:** tài liệu này **không đọc, không in, không xuất** giá trị khóa. Mọi kiểm thử dùng dữ liệu **giả** do chính kiểm thử sinh ra. Việc ký quỹ khóa thật do **Owner tự chạy**.

## 1. Sự thật đã xác minh (từ mã, lược đồ và danh sách tên biến — không từ giá trị)

| Điểm                                                                                                                                                                                                                                   | Bằng chứng                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Bí mật tài khoản dùng chung mã hóa bằng **AES-256-GCM, có AAD**; bảng `account_secrets` lưu `ciphertext`, `nonce`, `auth_tag`, `key_version` (mặc định `'v1'`), `encryption_schema_version`                                            | `packages/database/src/migrations/0011_m06_accounts.sql:26-37` |
| Token Google Drive mã hóa bằng khóa lấy theo thứ tự: `STORAGE_DRIVE_ENCRYPTION_KEY_HEX` → `ACCOUNTS_SECRET_KEY_HEX` → `ACCOUNT_SECRET_KEY`; Production **bắt buộc** có khóa, nếu thiếu → lỗi 500 `DRIVE_ENCRYPTION_KEY_NOT_CONFIGURED` | `apps/api/src/storage/service.ts:68-109`                       |
| Mã luôn dùng `keyVersion: 1` — **chưa hỗ trợ nhiều khóa/xoay vòng**, dù lược đồ đã có cột `key_version`                                                                                                                                | cùng tệp, dòng 91 và 108                                       |
| Mã có sẵn một khóa **mặc định dành cho test** (hằng số trong mã nguồn); Production từ chối dùng nó                                                                                                                                     | `service.ts:66, 95-105`                                        |
| Khóa chỉ nằm trong `C:\HoaiPhuong-Server\config\test-secrets\api.env` (có cả `HP_BRIDGE_SECRET`, `CSRF_SECRET`, `GOOGLE_CLIENT_SECRET`, `BREVO_API_KEY`, `GEMINI_API_KEY`, `ADMIN_PASSWORD`…)                                          | danh sách **tên** biến                                         |
| Backup hằng ngày (dump DB + `config-*.zip`) **không chứa** `api.env` hay hai khóa trên                                                                                                                                                 | liệt kê tên mục trong zip + tìm theo tên trong thư mục backup  |
| Các thư mục `pre-deploy-202610xx` có bản sao `api.env` cũ (văn bản thường), **không có** hai khóa mã hóa; có `CSRF_SECRET`                                                                                                             | so sánh dấu vân tay cụt, không in giá trị                      |
| `FIN_RECEIPT_DIR` hiện trống và không nằm trong tập backup                                                                                                                                                                             | đếm tệp                                                        |

**Hệ quả:** nếu mất ổ C: (hoặc `api.env`), ta khôi phục được cấu trúc và hầu hết dữ liệu nhưng **mọi bí mật tài khoản dùng chung và token Drive trở nên không giải mã được vĩnh viễn** (GCM xác thực thất bại, không có đường lui).

## 2. So sánh phương án

Tiêu chí: độ an toàn trước kẻ tấn công (A), khả năng khôi phục khi mất máy (R), độ phức tạp vận hành (C), tác động lên hệ thống (I), chi phí (£), AI không nhìn thấy khóa (V).

| #   | Phương án                                                                       | A   | R   | C       | I                       | £          | V                 | Nhận xét                                                                                    |
| --- | ------------------------------------------------------------------------------- | --- | --- | ------- | ----------------------- | ---------- | ----------------- | ------------------------------------------------------------------------------------------- |
| 1   | Sao chép `api.env` vào thư mục backup hiện có                                   | ✗   | ✓   | thấp    | thấp                    | 0          | ✗                 | **Loại**: khóa thường nằm cạnh dữ liệu, cùng ổ, lộ cùng nhau                                |
| 2   | Trình quản lý mật khẩu của Owner (ghi chú bảo mật)                              | ✓   | ✓   | thấp    | không                   | thấp       | ✓                 | Đơn giản, tốt cho khởi đầu; phụ thuộc kỷ luật thủ công; cần bản sao ngoại tuyến             |
| 3   | **Gói mã hóa bằng passphrase (công cụ `key-escrow.mjs`) + 2 bản sao tách biệt** | ✓   | ✓   | thấp–TB | không                   | 0          | ✓ (Owner tự chạy) | **Khuyến nghị**: không phụ thuộc dịch vụ ngoài, kiểm chứng được bằng dấu vân tay            |
| 4   | DPAPI máy/người dùng                                                            | ✓   | ✗   | thấp    | không                   | 0          | ✓                 | **Loại cho mục đích khôi phục**: gắn với máy, mất máy là mất khóa                           |
| 5   | Chia sẻ bí mật Shamir 2-of-3                                                    | ✓✓  | ✓✓  | cao     | không                   | 0          | ✓                 | Tốt ở giai đoạn sau nếu có nhiều người giữ; thừa cho 1 Owner                                |
| 6   | KMS đám mây + mã hóa phong bì (envelope)                                        | ✓✓  | ✓✓  | cao     | **mã nguồn + vận hành** | trung bình | ✓                 | Đáp ứng xoay vòng chuẩn, nhưng phải sửa mã (nhiều phiên bản khóa) và phụ thuộc nhà cung cấp |
| 7   | Két vật lý (giấy/USB mã hóa)                                                    | ✓   | ✓   | thấp    | không                   | thấp       | ✓                 | Dùng làm _bản sao ngoại tuyến_ cho phương án 3                                              |

**Khuyến nghị:** Phương án **3** làm cốt lõi, lưu **2 bản sao ở 2 nơi độc lập** (ví dụ USB ngoại tuyến cất riêng + bản trong trình quản lý mật khẩu của Owner), **passphrase giữ riêng tách khỏi tệp**. Phương án 6 chỉ cân nhắc khi cần xoay vòng khóa theo chuẩn.

## 3. Công cụ đã cung cấp: `scripts/governance/key-escrow.mjs`

| Tính chất     | Chi tiết                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mật mã        | scrypt (N=2¹⁷, r=8, p=1) → AES-256-GCM, AAD gắn với phần đầu tệp (sửa tệp là giải mã thất bại)                                                       |
| Không in khóa | chỉ in _dấu vân tay_ = 8 ký tự đầu của `SHA-256("ml-escrow-fp:" + tên + ":" + giá trị)`                                                              |
| `seal`        | đọc `api.env`, mã hóa các biến chọn (mặc định: 2 khóa + `HP_BRIDGE_SECRET`, `CSRF_SECRET`, `GOOGLE_CLIENT_SECRET`) → 1 tệp `.escrow`; từ chối ghi đè |
| `verify`      | giải mã và so với `api.env` đang chạy: `MATCH/DIFFERS/MISSING`, **không in giá trị**                                                                 |
| `restore`     | ghi lại tệp env mới (từ chối ghi đè) — chỉ dùng khi khôi phục thảm họa                                                                               |
| Passphrase    | ≥ 16 ký tự, nhập ẩn (hoặc biến `ESCROW_PASSPHRASE` cho kiểm thử)                                                                                     |

**Kết quả kiểm thử với dữ liệu giả (đã chạy bằng Node 22.14.0, 10 tình huống):** seal; tệp không chứa giá trị rõ (0 rò rỉ); verify không có env; verify khớp env; verify khi một giá trị bị đổi → `DIFFERS`; sai passphrase → từ chối; tệp bị sửa → từ chối; passphrase ngắn → từ chối; vòng khứ hồi (restore) trùng khớp; ghi đè bị từ chối. **Đã chạy: PASS 10/10.** Công cụ **chưa** được chạy trên `api.env` thật.

## 4. Quy trình để Owner thực hiện (chưa ai làm)

1. Mở PowerShell **của Owner** (không phải phiên AI). Dùng runtime sẵn có: `C:\HoaiPhuong-Server\config\runtime\node-v22.14.0-win-x64\node.exe`.
2. `node scripts\governance\key-escrow.mjs seal --env C:\HoaiPhuong-Server\config\test-secrets\api.env --out D:\...\ml-keys-YYYYMMDD.escrow` (nhập passphrase ẩn 2 lần). Chọn đích **không phải ổ C:**.
3. `node ... verify --escrow <tệp> --env <api.env>` → mọi dòng phải `[MATCH env]`.
4. Sao chép tệp `.escrow` sang nơi thứ hai; ghi **dấu vân tay** (8 ký tự/biến) vào sổ của Owner để sau này đối chiếu mà không cần mở khóa.
5. Lưu passphrase tách rời (không cùng nơi với tệp, không trong repo, không gửi cho AI).
6. Lặp lại khi khóa đổi hoặc theo lịch (đề xuất mỗi quý) và sau mỗi lần xoay khóa.

## 5. Kiểm chứng khôi phục thật (Đợt 2, cần duyệt)

Trong cụm TEST cô lập: dùng **khóa test giả** để tạo `account_secrets` mẫu → dump → restore → đọc lại bằng khóa đúng (PASS) và bằng khóa sai (phải thất bại, chứng minh rủi ro) → khôi phục khóa từ `.escrow` → đọc lại (PASS). Không dùng dữ liệu hay khóa Production.

## 6. Rủi ro còn lại và việc cần Owner quyết định

| #   | Vấn đề                                                                        | Đề xuất                                                                                                                    |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `api.env` cũ rải trong ≥ 5 thư mục `pre-deploy-*` (văn bản thường)            | **Xóa file** là thay đổi dữ liệu → chỉ khi Owner duyệt riêng (OA-19); trước đó đảm bảo ACL thư mục backup chỉ cho quản trị |
| 2   | Chưa có xoay vòng khóa (mã chỉ biết `v1`)                                     | Thiết kế riêng: thêm `key_version` thực sự + tái mã hóa có kiểm soát; làm sau khi có escrow và TEST                        |
| 3   | Khóa test mặc định nằm trong mã nguồn                                         | Đã bị chặn ở Production; nên bỏ hẳn khỏi nhánh chạy thật (thay đổi mã, đợt sau)                                            |
| 4   | Ai giữ passphrase nếu Owner không có mặt?                                     | Owner quyết định người thứ hai/chia sẻ (Shamir)                                                                            |
| 5   | Biên lai (`FIN_RECEIPT_DIR`) hiện trống nhưng chưa được backup khi có dữ liệu | Thêm vào kế hoạch backup (OA-7)                                                                                            |

## 7. Tiêu chí nghiệm thu (P0-C)

- [x] Đánh giá phương án có bằng chứng, không đọc/in giá trị khóa.
- [x] Công cụ ký quỹ kiểm thử PASS 10/10 bằng dữ liệu giả.
- [ ] **Owner** chạy `seal` + `verify` trên `api.env` thật (đích ngoài ổ C:, 2 bản sao) — _chưa thực hiện_.
- [ ] Diễn tập khôi phục ở TEST (Đợt 2) — _chưa thực hiện_.

## 8. Rollback

Công cụ chỉ đọc `api.env` và chỉ ghi tệp mới; xóa tệp `.escrow` là hoàn tác. Không thay đổi `api.env`, mã chạy, hay dữ liệu.
