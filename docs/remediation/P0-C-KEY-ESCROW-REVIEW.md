# Đánh giá an toàn công cụ ký quỹ khóa (`scripts/governance/key-escrow.mjs`)

**Phạm vi:** rà soát thiết kế + mã công cụ do Đợt 1 tạo ra. **Chỉ kiểm thử bằng khóa giả** do kiểm thử tự sinh; không đọc/in/lưu khóa Production.

## 1. Mô hình đe dọa

| Tài sản                      | Mối đe dọa                            | Biện pháp                                                                                           |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Giá trị khóa trong `api.env` | rò rỉ qua log, Git, báo cáo, ảnh chụp | Công cụ không bao giờ in giá trị; chỉ in dấu vân tay 8 hex; từ chối ghi vào thư mục Git             |
| Tệp `.escrow`                | kẻ có tệp thử đoán passphrase         | scrypt N=2¹⁷, r=8, p=1 + AES-256-GCM; passphrase ≥ 16 ký tự                                         |
| Tệp `.escrow`                | sửa/hoán đổi nội dung                 | GCM có AAD là toàn bộ phần đầu (tham số KDF, danh sách biến, ngày tạo) → sửa là giải mã thất bại    |
| Tệp `.escrow` độc hại        | DoS bằng tham số KDF khổng lồ         | Kiểm tra giới hạn N∈[2¹⁴,2²⁰], r≤16, p≤4 **trước khi** chạy scrypt                                  |
| Tệp khôi phục dạng rõ        | bị commit hoặc để lại                 | `restore` từ chối ghi trong thư mục Git và từ chối ghi đè; in hướng dẫn hạn chế ACL và xóa sau dùng |
| Passphrase                   | lộ qua lịch sử lệnh/biến môi trường   | Mặc định nhập ẩn; biến `ESCROW_PASSPHRASE` chỉ dành cho kiểm thử tự động                            |

## 2. Kết quả rà soát

| #   | Phát hiện                                                                                         | Mức        | Xử lý                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Bản Đợt 1 có thể ghi `.escrow`/tệp khôi phục vào thư mục repo → nguy cơ commit                    | Trung bình | **Đã sửa**: `guardOutput` từ chối đường dẫn nằm trong Git work tree (seal có `--allow-in-repo` chỉ cho kiểm thử; restore luôn từ chối) |
| R2  | Tham số KDF trong tệp được tin cậy trước khi xác thực (DoS qua `N` lớn)                           | Trung bình | **Đã sửa**: `parseEscrowFile` kiểm tra giới hạn và kiểu dữ liệu                                                                        |
| R3  | JSON hỏng gây stack trace thay vì thông báo                                                       | Thấp       | **Đã sửa**: thông báo lỗi gọn, không in nội dung tệp                                                                                   |
| R4  | Cảnh báo lưu trên ổ C: chưa có                                                                    | Thấp       | **Đã thêm** cảnh báo khi đường dẫn đầu ra bắt đầu bằng `C:\`                                                                           |
| R5  | `mode: 0o600` không có hiệu lực trên Windows                                                      | Thấp       | Đã thay thông điệp bằng hướng dẫn `icacls`                                                                                             |
| R6  | Dấu vân tay 8 hex của bí mật entropy thấp (vd. mật khẩu) cho phép kiểm tra phỏng đoán ngoại tuyến | Thấp       | Chấp nhận với khóa ngẫu nhiên 256-bit; **danh sách mặc định không chứa mật khẩu**; tài liệu cảnh báo không ký quỹ bí mật entropy thấp  |
| R7  | Tệp `.escrow` không có chữ ký ngoài passphrase; mất passphrase = mất khóa                         | Thông tin  | Hướng dẫn Owner giữ passphrase tách rời và dùng 2 bản sao; cân nhắc chia sẻ Shamir ở giai đoạn sau                                     |
| R8  | Công cụ đọc `api.env` bằng quyền của người chạy                                                   | Thông tin  | Chỉ Owner chạy; công cụ không sửa `api.env`                                                                                            |
| R9  | Không có cơ chế xoay vòng khóa trong ứng dụng (`key_version` luôn `v1`)                           | Thiết kế   | Ngoài phạm vi công cụ; ghi vào đợt sau                                                                                                 |

## 3. Kiểm thử (khóa giả, Node 22.14.0)

15 tình huống, **PASS 15/15**: seal; tệp không chứa giá trị rõ (0 rò rỉ); verify không có env; verify khớp env; verify khi một giá trị đổi → `DIFFERS`; sai passphrase → từ chối; sửa tệp → từ chối; passphrase ngắn → từ chối; khứ hồi `restore` trùng khớp; ghi đè bị từ chối; `seal --out` trong thư mục Git bị từ chối (không tạo tệp); `restore --out` trong thư mục Git bị từ chối; KDF `N=2³⁰` bị từ chối trong 0,1 s; JSON hỏng xử lý gọn; seal bình thường vẫn chạy và cảnh báo ổ C:.

## 4. Kết luận

Công cụ **an toàn để Owner sử dụng** theo `OWNER-KEY-BACKUP-GUIDE.md`. Điều kiện còn lại: (a) Owner tự chạy `seal` + `verify` trên `api.env` thật và giữ 2 bản sao ngoài ổ C:; (b) diễn tập khôi phục ở TEST (Đợt 2B) bằng khóa giả. **Chưa** có khóa Production nào được ký quỹ.
