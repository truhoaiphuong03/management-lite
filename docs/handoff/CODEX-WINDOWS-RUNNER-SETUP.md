# Cài đặt Windows runner một lần — chưa thực hiện

**QA_HOLD / RELEASE_HOLD. Chỉ là runbook để Owner xem xét. Không chạy trên production lúc này.**

## 1. Khảo sát và staging trước

Operator được phép truy cập Windows chạy `Get-WindowsInventory.ps1 -ApplicationRoot <đường-dẫn-đã-xác-minh>` để lấy metadata read-only. Xác minh riêng: Windows edition/architecture, Node/npm thực, PostgreSQL server version/bin/system_identifier/database, app services và wrapper/cwd, startup/recovery account, data paths, backup jobs/restore evidence, firewall, IIS/Caddy/TLS, runtime DB target. Không gửi command line chứa mật khẩu hoặc nội dung .env.

Chọn Windows staging VM riêng, PostgreSQL cluster/database độc lập và dữ liệu synthetic. Không dùng DB production hoặc DB ghi của Anty. Xác minh API runtime thực gắn với DB staging, không chỉ dựa vào tên _qa. Staging không trỏ domain production, credentials production hoặc Google Drive thật.

Tại staging, cài Node 22.14.0 x64 / npm 10.9.2 và PowerShell 7.4+ tương thích sau xác minh OS. PostgreSQL tools phải tương thích server; chưa biết version production thì không đoán đường dẫn hoặc chạy installer.

## 2. Tạo layout, dịch vụ và quyền (sau phê duyệt)

Admin tạo Root, releases, backups, controller, protected và shared trên ổ local NTFS, cùng marker `.management-lite-managed-root`. Controller config giữ Enabled:false. Không dùng network share hoặc junction cho Root/releases/backups. Khởi tạo release baseline đã biết SHA + manifest và current junction bằng kế hoạch cutover riêng; deploy script cố ý từ chối first install chưa có baseline.

Chọn WinSW hoặc NSSM sau survey; không cài đè wrapper hiện hữu. Service API dùng PowerShell Start-ManagedApi.ps1 ở controller ngoài release, service account riêng, tự khởi động, recovery phù hợp. Node chạy entrypoint full path từ current, env-file ngoài release. App service chỉ đọc releases/runtime.env, ghi data/logs đúng thư mục. Không bootstrap Owner hoặc tạo account thật trong cài đặt runner.

Runner account riêng, không LocalSystem/Administrator, không interactive logon; chỉ read controller và artifact download, write managed releases/backups/history/current và START/STOP/QUERY đúng service ManagementLiteApi. Không cấp điều khiển PostgreSQL, firewall, DNS hoặc service khác. Quyền junction/SCM và disk space phải chạy thử trên staging; không tự nâng quyền nếu bị deny.

Runtime ACCOUNT_SECRET_KEY và các secret khác thuộc app service, ngoài GitHub và release. Runner không cần đọc runtime.env hoặc thay key. Backup.pgpass chỉ chứa credential backup role read-only, được ACL riêng; role cần đọc bảng/schema/sequence và chỉ quyền introspection cần thiết để xác minh system_identifier. Không cấp superuser/DDL/app Owner role. Admin tạo role chỉ sau approval riêng. Key/config encrypted backup do job admin riêng quản lý; controller chỉ kiểm freshness.

Đảm bảo all application writers nằm trong maintenance plan; không dừng các service không thuộc phạm vi. Proxy static web dùng current/web, API loopback; không chạy Vite development server ở production.

## 3. GitHub policy phải có trước khi đăng ký runner

Repository đang thuộc User; chưa có runner group phù hợp. Owner quyết định organization/Enterprise hoặc architecture deployment repo được bảo vệ trước. Không dùng repo-level production runner như workaround khi không có workflow isolation.

Protected main: required CI, Owner review cho workflow/controller/lockfile, không force push/deletion, write/admin chỉ người được phép. Environment production: required reviewer chỉ Owner, protected branches, disable admin bypass. Environment staging riêng. Kiểm tra private repository plan thật có required reviewers; không dùng checkbox trong workflow_dispatch thay approval native.

Runner group staging/production tách biệt, repository allowlist và selected workflow exact path `OWNER/REPO/.github/workflows/deploy-windows.yml@refs/heads/main`. Runner labels ml-staging-deploy và ml-production-deploy chỉ để định tuyến. Khi Owner đổi repo mapping, cập nhật hardcoded allowlist, URL và tests trong packet riêng trước bật.

Cài runner từ **Settings → Actions → Runners → New self-hosted runner** theo [hướng dẫn GitHub](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners), kiểm checksum tải xuống, dùng registration token ngắn hạn được GitHub tạo. Owner/admin nhập token trên Windows, không đưa vào chat, Git, script hoặc log. Cài service bằng admin một lần, nhưng service chạy dưới account hạn chế trên. Không ghi PAT lâu dài vào filesystem. Staging trước, production chưa được phép cài.

Runner chỉ cần outbound HTTPS 443 tới GitHub/Actions/artifact endpoints theo [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners); không mở inbound port cho GitHub. Giữ automatic runner security updates. Runtime Node version ứng dụng độc lập với embedded Node của runner/actions.

## 4. Firewall, HTTPS và DNS (đề xuất, chưa thay đổi)

Chỉ proxy public 443 và 80 nếu ACME challenge cần; API và PostgreSQL loopback hoặc network ACL riêng. Không public 3002/5432. RDP quản trị chỉ từ kênh quản trị đã phê duyệt. Khảo sát rule hiện có trước sửa.

Nếu dùng Caddy, example là đề xuất mới; nếu đang IIS thì giữ IIS và chuẩn bị adapter root/proxy tương đương. Kiểm certificates, renewal, SPA fallback, release-version no-store, trusted proxies và secure cookies. Với Cloudflare cần kiểm Full (strict)/origin certificate và challenge path thật; public A/AAAA hiện là proxy không chứng minh origin đúng. Không đổi DNS, TLS mode hoặc deploy domain theo tài liệu này.

## 5. Checklist nghiệm thu staging Windows bắt buộc

1. Runtime API/DB binding và system_identifier đúng staging, external env/key không đổi qua deploy/rollback.
2. Artifact Windows x64 load được argon2/sharp, khởi động app; manifest/integrity và service process tree đúng.
3. Deploy thành công, health/ready/web SHA/401 RBAC và acceptance Owner/Staff trên dữ liệu synthetic.
4. Backup PostgreSQL + receipts + encrypted config, restore **DB mới** trên staging; so sánh count/digest và AUDIT-005; thử khôi phục key/config vào isolated staging. `pg_restore --list` một mình không đủ.
5. Cố ý candidate health fail → rollback old code, không restore DB cũ, dữ liệu mới không mất; schema mismatch phải dừng không migrate.
6. Quyền runner tối thiểu, malicious PR không schedule được runner group, Owner approval native thật, offline runner/GitHub không ảnh hưởng service đang chạy.
7. Khi tất cả đạt và application QA_READY, Owner mới phê duyệt production setup/Enabled/CD_ENABLED. Hiện chưa có các bằng chứng này.
