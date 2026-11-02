# CI/CD MacBook → GitHub → Windows Server

**DESIGN_PREPARED — VALIDATION_PARTIAL. QA_HOLD / RELEASE_HOLD.** Ngày 12/10/2026, kiểm tra từ MacBook. Chưa cài runner, bật CD, đổi DNS hoặc triển khai Windows.

## Kết luận thiết kế

MacBook phát triển source → push/PR vào GitHub private `truhoaiphuong03/management-lite` → CI trên GitHub-hosted Ubuntu với PostgreSQL disposable → Owner nghiệm thu exact SHA → workflow dispatch từ protected main → build artifact trên GitHub-hosted Windows x64 → deploy Windows staging riêng → Environment production chờ Owner approval → runner deployment cài sẵn chuyển release, kiểm health, rollback nếu lỗi.

Push source chỉ chạy CI. Windows tự cập nhật sau khi Owner chọn release SHA và phê duyệt trên GitHub; không cần RDP để cập nhật thường kỳ. Không bỏ approval để biến mọi push thành production deploy.

## Khảo sát hiện tại và giới hạn bằng chứng

| Hạng mục                                              | Kết quả hiện tại                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Repository local                                      | Remote URL đúng repository Owner cung cấp; private là thông tin Owner xác nhận, chưa đọc được settings private                   |
| GitHub owner                                          | Public API xác nhận `truhoaiphuong03` là **User**, không phải Organization                                                       |
| GitHub plan / reviewer / runner policy                | NOT VERIFIED; không thay đổi settings                                                                                            |
| Windows Services / service wrapper / application root | NOT VERIFIED — chưa có phiên Windows/SSH/WinRM được cung cấp                                                                     |
| Node / PostgreSQL trên Windows                        | NOT VERIFIED; project yêu cầu Node 22.14.0 / npm 10.9.2                                                                          |
| Backup / restore Windows                              | NOT TESTED; bằng chứng MacBook 58/58 đợt trước không thay thế Windows                                                            |
| Firewall / reverse proxy / origin HTTPS               | NOT VERIFIED; không cài hoặc thay cấu hình                                                                                       |
| DNS public                                            | `ql.hoaiphuong.click` A: 172.67.205.124, 104.21.42.108; AAAA thuộc Cloudflare; NS: dara.ns.cloudflare.com, guy.ns.cloudflare.com |
| Public HTTPS HEAD                                     | 403 từ Cloudflare; không chứng minh origin app khỏe                                                                              |
| Cloudflare origin / TLS mode / origin IP              | NOT VERIFIED; IP public proxy không xác nhận origin Windows                                                                      |

Không suy đoán IIS/NSSM/WinSW đang được sử dụng. `Get-WindowsInventory.ps1` đã chuẩn bị để operator chạy read-only sau khi có quyền; cố ý không xuất command line, file .env hoặc credential. Operator xác minh đường dẫn wrapper/DB/runtime và backup riêng, chỉ bàn giao metadata đã làm sạch.

## Hai gate hạ tầng GitHub cần Owner quyết định

1. Tài liệu GitHub hiện tại: required reviewers cho private repository không có trên Free/Pro/Team; cần gói Enterprise phù hợp. Chưa xác minh gói thực tế. Workflow đọc policy API và fail closed khi không thấy đúng Owner reviewer.
2. Runner groups có thể giới hạn repository và workflow, là ranh giới chống PR chọn production runner. Repository hiện thuộc tài khoản cá nhân; cấu hình groups mẫu chưa dùng được nguyên trạng. **Không thay bằng labels đơn thuần**, vì labels chỉ dùng định tuyến. Owner cần phê duyệt tổ chức/gói phù hợp và mapping repository, hoặc một thiết kế deployment repository được bảo vệ riêng. Chưa chuyển/tạo repo hoặc mua gói. Nếu đổi owner/name, phải cập nhật allowlist workflow/controller và test trước khi bật.

Đây là các gate còn thiếu, không phải đã thiết lập xong. Giữ `CD_ENABLED` unset/false, `Enabled:false` tại controller cho tới khi có bằng chứng staging và Owner phê duyệt rõ ràng. Không có fallback bỏ reviewer hoặc chạy runner repository-level không được cô lập.

## Workflow và quyền

`.github/workflows/foundation.yml`: CI trên push/PR, hosted Ubuntu, token chỉ contents:read, checkout không giữ credential, npm ci/lint/typecheck/build/build:web, selected backend/database/security/foundation/SET-002 và controller simulation. PostgreSQL mới theo job, fresh DB theo file, sentinel riêng; không nhận secret production, không dùng pull_request_target, không self-hosted.

CI này là **selected regression**, không phải toàn bộ 90 file hoặc 123 chức năng. Danh sách trong `ci-isolated-tests.mjs`; exact-SHA acceptance bên ngoài CI vẫn bắt buộc. Bốn lỗi lint và ACC P1 hiện tại vẫn giữ CI/release HOLD; không bỏ test/rule để workflow xanh.

`deploy-windows.yml`: chỉ workflow_dispatch từ main. Guard yêu cầu full SHA 40 ký tự, Owner `QA_APPROVED_SHA` đúng SHA, CI run push main thành công đúng SHA và đúng workflow, SHA thuộc ancestry origin/main; API production phải có đúng **một required reviewer là Owner** và chỉ protected branches. API lỗi/thiếu quyền trả HOLD. Job production vẫn chờ native Environment approval; API check không thay thế approval.

Token CD: contents:read + actions:read; không cần PAT lâu dài hoặc quyền push/deployments:write. Actions checkout/setup-node/upload/download đều pin full SHA. Production runner chỉ download artifact của **chính workflow run đã build**, gọi controller admin cài ngoài artifact. Không checkout, npm, build hoặc execute script từ release archive trên runner. Artifact SHA256 được truyền cùng artifact tin cậy của current run; checksum chứng minh toàn vẹn, không được gọi là chữ ký độc lập.

GitHub Environment production: chỉ Owner reviewer, protected branches, tắt admin bypass trong UI. Nếu Owner cũng dispatch thì prevent self-review phải tương thích; một Owner duy nhất bật prevent self-review sẽ không tự approve được. Quyền thay environment, repo variables, branch policy và controller chỉ dành Owner/admin được chỉ định. Runner group chỉ cho `.../.github/workflows/deploy-windows.yml@refs/heads/main`; không mở wildcard PR/branch. Không giả định Environment tự cô lập runner.

## Release layout và triển khai

Ví dụ đề xuất, chưa áp lên Windows:

```text
C:\ManagementLite\
  controller\             # admin cài script/config tin cậy, runner chỉ đọc
  releases\<full-sha>\    # immutable: dist, web, node_modules, package.json, release.json
  current                   # junction tới đúng release
  protected\runtime.env    # app service đọc, không nằm trong release/GitHub
  protected\backup.pgpass  # backup role riêng; không chứa ACCOUNT_SECRET_KEY
  shared\receipts\        # dữ liệu runtime, giữ nguyên giữa release
  backups\                 # DB dump + data snapshot, ACL riêng
  deployment-history.jsonl
  last-success.json
```

Frontend production là Vite **static build**, không dùng Vite dev server. Caddy là cấu hình đề xuất nếu chưa có proxy; IIS hiện hữu cần adapter tương đương và survey trước, không tự thay. Proxy phục vụ current/web, chuyển /api tới API loopback. Node Windows Service chạy controller Start-ManagedApi với external runtime.env; giữ NODE_ENV=production, HOST=127.0.0.1, ALLOWED_ORIGINS production và TRUSTED_PROXIES đúng proxy đã xác minh. Không đổi ACCOUNT_SECRET_KEY, CSRF secret, Owner hoặc DB URL khi deploy code.

Artifact build trên Windows x64 vì argon2/sharp có native dependency; không chuyển node_modules Mac sang Windows. Node runtime mục tiêu phải đúng 22.14.0, OS/architecture tương thích; Windows packaging/start thật chưa kiểm thử. Nếu runtime upgrade cần packet riêng, không tự nâng phiên bản.

Controller: local disabled switch → exclusive file lock → kiểm previous release integrity → SHA/digest/platform/file manifest/path traversal → đối chiếu schema_migrations id/checksum và database system_identifier read-only → dừng đúng API service trong maintenance window → backup DB + shared receipts + kiểm encrypted config/key backup còn mới → chuyển junction → start service → health/ready/web SHA/unauthenticated RBAC smoke → ghi history. Lỗi sau khi dừng service khôi phục pointer cũ, start và kiểm health cũ; thất bại kép ghi operator-required. Release và backup được giữ lại, không tự xóa.

Phải xác nhận mọi writer/worker của ứng dụng nằm trong maintenance control trước khi bật. Dừng API trước dump và receipts backup để tránh race giữa metadata DB và file. Các writer ngoài ứng dụng hoặc tác vụ độc lập phải được operator xử lý trong maintenance plan; không tự dừng dịch vụ lạ.

## Database và khôi phục

Không gọi migrate trong workflow/controller. Manifest chứa danh sách migration id/checksum, đối chiếu đúng schema hiện có; thiếu/dư/sai checksum là HOLD. Migration production là nhiệm vụ được Owner phê duyệt riêng, có backup/restore staging, rồi mới xét code release tương thích. Rollback cũ cũng phải có schema tương thích.

`pg_dump -Fc` dùng backup role read-only và PGPASSFILE ngoài Git. `pg_restore --list` chỉ kiểm archive đọc được, **không chứng minh restore thành công**. Windows staging phải restore vào DB mới, đối chiếu count/digest, AUDIT-005 và quyền trước phát hành. Không restore database cũ đè production khi code deploy thất bại, vì sẽ làm mất ghi mới.

Backup encrypted runtime config/key riêng phải có restore drill, giữ ACCOUNT_SECRET_KEY nguyên vẹn và lưu ngoài máy chủ theo retention đã phê duyệt. Script chỉ kiểm tồn tại/độ mới của encrypted backup; không giải mã, đọc hoặc đổi key. Chứng minh nội dung/khả năng giải mã thuộc drill Windows còn thiếu.

Backup root/logs ACL hạn chế, không upload dump hoặc config lên Actions artifact. History có UTC timestamp, SHA, run ID, kết quả và rollback; nếu file log lỗi thì có workflow-log fallback để không ngăn rollback. Không tự prune release/backup; Owner đặt retention sau survey dung lượng.

## Kiểm thử đã chạy và chưa chạy

- Controller PowerShell thực chạy trên Mac, temp staging directory, simulation: **14 PASS / 0 FAIL / 0 SKIP**. Bao gồm parser, disabled/production simulation guard, concurrency lock, bad digest, immutable release, activate, health rollback, manual rollback/protected sentinel, schema mismatch, ZIP traversal, .env rejection tampered rollback target và interrupted-deployment guard.
- Backend deployment policy test: **1 PASS / 0 FAIL / 0 SKIP**, gồm 15 scenario policy assertions (1 hợp lệ + 14 từ chối), mock API + Git fixture riêng, không dùng token thật.
- Tổng tests tập trung: **15 PASS / 0 FAIL / 0 SKIP**, không cộng vào baseline application 686 PASS.
- actionlint hai workflow: PASS sau khai báo custom runner labels trong .github/actionlint.yaml; focused ESLint các JS mới và policy test: PASS; Node syntax check: PASS.
- PowerShell engine dùng portable 7.6.6 trong audit riêng, không cài system hoặc Windows runner. Không chạy app regression/full Chrome.
- **NOT TESTED:** GitHub Actions thực/private Environment approval; Windows hosted artifact/native dependency start; Windows Service/junction ACL thật; PostgreSQL Windows backup/restore; firewall/proxy/TLS origin; toàn bộ acceptance production. Simulation không mở DB, service hoặc network deployment.

## File chuẩn bị và bước tiếp theo

Workflow CI/CD, script deploy/rollback/common/launcher/smoke/inventory, config + Caddy example, simulation tests và policy test đều nằm branch riêng `codex/cicd-windows-design-20261012`, từ base `e2bedec14714709cf5db2a0c0782f4bb9c3cb941`. Không sửa worktree Anty/Codex QA và không chạm frontend.

Đọc tiếp `CODEX-WINDOWS-RUNNER-SETUP.md` và `CODEX-OWNER-RELEASE-RUNBOOK.md`. Bước tiếp theo cần Windows staging được chỉ định và quyết định GitHub plan/runner isolation; hiện chỉ có bản chuẩn bị cục bộ. Không yêu cầu hoặc lưu password/token trong chat.

Evidence: `/Users/duongbinh/.codex/audits/management-lite-cicd-design-20261012/`, gồm infrastructure-survey.json, simulation.log, policy-test.log, actionlint.log và focused-eslint.log.

## Nguồn chính thức đã đối chiếu

- [GitHub Environment approval và giới hạn plan](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)
- [Self-hosted runner security, token tối thiểu và pin action](https://docs.github.com/en/actions/reference/security/secure-use)
- [Runner groups và quyền truy cập](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access)
- [Environment REST API, Actions read permission](https://docs.github.com/en/rest/deployments/environments)
- [Windows service accounts](https://learn.microsoft.com/windows/security/identity-protection/access-control/service-accounts)
- [PostgreSQL dump](https://www.postgresql.org/docs/16/app-pgdump.html), [restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [PGPASSFILE](https://www.postgresql.org/docs/17/libpq-pgpass.html)
- [Caddy HTTPS và điều kiện DNS/port/certificate](https://caddyserver.com/docs/automatic-https)

Deployment journal `deployment-state.json` ghi previous/candidate trước khi dừng service. Nếu runner/process bị kill hoặc server reboot, catch/finally không bảo đảm chạy; job tiếp theo từ chối retry khi journal in_progress. Operator kiểm tra current/service rồi chạy rollback exact previous SHA qua kênh quản trị dự phòng. Đây không phải database restore; Windows crash/reboot drill còn NOT TESTED.
