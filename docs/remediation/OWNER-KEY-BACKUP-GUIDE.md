# Hướng dẫn Owner tự sao lưu hai khóa mã hóa ra ngoài ổ C:

**Mục đích:** `ACCOUNT_SECRET_KEY` và `STORAGE_DRIVE_ENCRYPTION_KEY_HEX` mã hóa mật khẩu tài khoản dùng chung và token Google Drive. Chúng chỉ nằm trong `C:\HoaiPhuong-Server\config\test-secrets\api.env` và **không có trong bất kỳ backup nào**. Mất ổ C: hoặc mất tệp này ⇒ dữ liệu đã mã hóa không thể khôi phục.

**Nguyên tắc:** việc này do **Owner tự làm**. Không gửi khóa, tệp `api.env`, passphrase hay nội dung gói ký quỹ cho AI, chat hoặc Git. Công cụ không bao giờ sửa `api.env`; nó chỉ đọc và tạo một tệp mới.

## Chuẩn bị (1 lần)

1. Một nơi lưu **ngoài ổ C:** (USB mã hóa, ổ đĩa ngoài, hoặc kho riêng của bạn) và một nơi thứ hai độc lập (ví dụ trình quản lý mật khẩu — mục "ghi chú bảo mật" kèm tệp, hoặc một USB thứ hai cất ở chỗ khác).
2. Nghĩ ra **passphrase ≥ 16 ký tự** (nên là cụm từ dài). Lưu passphrase **tách khỏi tệp** (ví dụ ghi giấy cất riêng hoặc trong trình quản lý mật khẩu). Mất passphrase = mất khóa.

## Thực hiện

Mở **PowerShell của chính bạn** (không dùng cửa sổ của phiên AI). Thay `E:\` bằng ổ ngoài của bạn.

```powershell
$node = 'C:\HoaiPhuong-Server\config\runtime\node-v22.14.0-win-x64\node.exe'
$tool = 'C:\Projects\management-lite-remediation\scripts\governance\key-escrow.mjs'
$env  = 'C:\HoaiPhuong-Server\config\test-secrets\api.env'
$out  = 'E:\ML-Keys\ml-keys-20261101.escrow'      # PHẢI nằm ngoài ổ C: và ngoài thư mục Git

# 1) Tạo gói ký quỹ (hỏi passphrase ẩn 2 lần). Mặc định gồm 5 bí mật; chỉ muốn 2 khóa mã hóa thì thêm:
#    --vars ACCOUNT_SECRET_KEY,STORAGE_DRIVE_ENCRYPTION_KEY_HEX
& $node $tool seal --env $env --out $out

# 2) Kiểm chứng: giải mã và so với api.env đang chạy. Mọi dòng phải là [MATCH env]
& $node $tool verify --escrow $out --env $env
```

Kết quả hiển thị **dấu vân tay** 8 ký tự cho mỗi khóa (không phải khóa). Ghi các dấu vân tay này vào sổ của bạn: sau này đối chiếu mà không cần mở khóa.

## Sau khi tạo

1. Sao chép `ml-keys-….escrow` sang **nơi thứ hai** và kiểm tra bản sao bằng lệnh `verify` (bước 2) ở máy khác nếu có thể.
2. Cất passphrase riêng. **Không** để passphrase cùng USB với tệp.
3. Không lưu tệp trong `C:\Projects\…`, thư mục backup hiện có, OneDrive đồng bộ công khai, hay repo Git (công cụ từ chối ghi vào thư mục Git).
4. Thử khôi phục thật **ở môi trường TEST** (không phải Production) bằng khóa giả khi Đợt 2B được duyệt.

## Khi nào lặp lại

- Mỗi khi đổi `ACCOUNT_SECRET_KEY` hoặc `STORAGE_DRIVE_ENCRYPTION_KEY_HEX` hoặc `HP_BRIDGE_SECRET`/`CSRF_SECRET`/`GOOGLE_CLIENT_SECRET`.
- Định kỳ mỗi quý: chạy lại `verify` để chắc chắn gói còn đọc được và vẫn khớp `api.env`.

## Khôi phục khi thảm họa (chỉ khi mất `api.env`)

```powershell
& $node $tool restore --escrow E:\ML-Keys\ml-keys-20261101.escrow --out D:\restore\api-keys.env
icacls D:\restore\api-keys.env /inheritance:r /grant:r "$($env:USERNAME):F"   # hạn chế quyền
# đưa các dòng cần thiết vào api.env mới, rồi XÓA tệp tạm D:\restore\api-keys.env
```

## Không nên

- Không chụp màn hình/ghi lại giá trị khóa; không dán vào chat.
- Không đặt passphrase vào biến môi trường hệ thống. (Biến `ESCROW_PASSPHRASE` chỉ dùng cho kiểm thử tự động bằng khóa giả.)
- Không dùng chung khóa của Production cho môi trường TEST/STAGING.

## Lưu ý còn lại (cần Owner quyết định, chưa ai thực hiện)

- Các bản `api.env` cũ nằm trong một số thư mục `C:\HoaiPhuong-Server\backups\pre-deploy-*` (văn bản thường). Xóa là thay đổi dữ liệu nên **chỉ làm khi Owner duyệt riêng**; trước đó, quyền truy cập thư mục backup chỉ nên dành cho tài khoản quản trị.
- Cân nhắc xoay vòng khóa trong tương lai (hiện mã chỉ hỗ trợ một phiên bản khóa).
