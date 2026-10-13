# Owner phát hành từ MacBook — sau khi setup đã nghiệm thu

**Hiện QA_HOLD / RELEASE_HOLD. Không chạy phát hành theo runbook lúc này.**

## Các cấu hình một lần

Windows staging/production service/proxy/backup đã nghiệm thu; runner isolation + native Environment Owner reviewer đúng gói; protected main và permissions được xác minh; controller/config cài bởi admin ngoài artifact. Chỉ sau approval setup mới đặt Enabled:true cho từng môi trường và repository variable CD_ENABLED=true. Mặc định hiện tại tất cả vẫn khóa.

Variables không bí mật: `CD_ENABLED`, `QA_APPROVED_SHA`, `PRODUCTION_OWNER_LOGIN`. QA_APPROVED_SHA phải là **full SHA** được nghiệm thu và chỉ Owner/admin được thay. Không dùng branch name hoặc latest. Runner group names/labels là cấu hình infrastructure cố định, không phải secret.

GitHub không cần DATABASE_URL, ACCOUNT_SECRET_KEY, CSRF_SECRET, Owner password, Google Drive credential hoặc Windows Administrator password. GITHUB_TOKEN tự cấp theo job chỉ contents:read/actions:read. Registration token nhập một lần theo GitHub UI, không lưu. Runtime secret và backup PGPASSFILE lưu cục bộ Windows theo ACL; không đưa .env vào artifact/Git. Token policy API nếu không đủ quyền phải HOLD, không fallback thêm PAT admin tùy tiện.

## Mỗi phiên bản — hoàn toàn thao tác từ MacBook/GitHub

1. Làm việc trên branch riêng, commit source đúng phạm vi. Push branch và tạo PR; CI tự chạy trên hosted runner. Không sửa branch/worktree Anty.
2. Owner review exact diff và kết quả acceptance. Sửa ACC P1, FIN flaky, lint và release gates trước khi phát hành. CI selected regression không thay thế 123 chức năng hoặc Windows acceptance.
3. Owner cho phép merge main theo quy trình riêng; runbook này không tự merge. Chờ **push-main CI** hoàn tất thành công; ghi full commit SHA và run ID.
4. Owner/admin đặt QA_APPROVED_SHA bằng SHA đã nghiệm thu. GitHub Actions → Approved Windows deployment → Run workflow, chọn **main**, nhập full SHA và CI run ID. Có thể dùng GitHub UI trên Mac; không cần gh CLI hoặc RDP. Tạo tag/release mô tả SHA nếu muốn lưu lịch sử, nhưng tag không tự trigger deployment.
5. Hosted Windows build immutable artifact; staging runner deploy và health-check. Nếu staging fail, production không chạy.
6. GitHub hiển thị pending production Environment. Owner xem SHA, CI/run ID, staging evidence và chọn Approve and deploy. Runner tự backup, switch release, kiểm health và rollback nếu lỗi. Approval không còn cần đăng nhập Windows.
7. Xem workflow status, deployment history, exact web release SHA. Chỉ báo phát hành thành công khi runtime evidence đạt; bản thiết kế/QA xanh không tự là production PASS.

Không auto-deploy theo mọi push, release tag latest hoặc thay branch đang chạy. Không lấy artifact từ PR/workflow run khác. Không đổi key và không chạy migration production trong pipeline. Nếu cần schema mới, Owner duyệt migration riêng rồi retest staging/rollback compatibility trước dispatch.

## Khi có lỗi hoặc mất GitHub/runner

- CI fail / approval policy thiếu / runner offline: bản đang chạy giữ nguyên; không cần update thủ công. Chỉ queue lại sau khi đã xác minh SHA và approval còn đúng. Không đổi workflow sang runner khác ít bảo vệ hơn.
- Deploy fail: controller tự quay code về previous release và kiểm health; database không restore. Xem deployment-history và workflow log; ROLLBACK_FAILED_OPERATOR_REQUIRED thì cần operator qua kênh quản trị dự phòng.
- GitHub unavailable: app service, PostgreSQL, TLS renewal và backups phải độc lập runner. Controller/previous releases/dumps local vẫn có. Operator được phê duyệt có thể chạy rollback cục bộ: `Rollback-Release.ps1 -ConfigPath C:\ManagementLite\controller\deployment.config.json -Sha <full-sha-đã-kiểm-toàn-vẹn>`. Không cần GitHub token hoặc Internet cho code rollback; health HTTPS/backup phụ thuộc hạ tầng đã khảo sát.
- Runner compromised: Owner revoke/remove runner, disable CD_ENABLED, giữ app chạy; rebuild runner sạch từ template đã nghiệm thu. Kiểm log/các release, không tự xoay app key hoặc restore DB. Mọi secret rotation cần approval riêng.
- Server/disk/database mất: operator restore backup vào host/database **mới**, restore key/config encrypted đúng bản, đối chiếu dữ liệu rồi Owner phê duyệt cutover. Không restore đè DB đang ghi chỉ vì deployment code fail.

Giữ ít nhất current + previous verified release, dump và encrypted config backup ngoài máy chủ theo retention Owner phê duyệt. Không tự prune/xóa dữ liệu. Duy trì một kênh operator dự phòng cho sự cố hạ tầng; mục tiêu không cần RDP cập nhật thường kỳ không loại bỏ nhu cầu quản trị khi server hỏng.

Nếu runner mất kết nối/timeout giữa maintenance: đọc deployment-state.json để biết previous/candidate. Không dispatch lại mù; controller sẽ HOLD nếu trạng thái in_progress. Operator được phê duyệt kiểm tra junction/service và rollback previous exact SHA. Sau health đạt, rollback controller ghi trạng thái hoàn tất để mở retry. Không tự xóa journal/lock hoặc restore database.
