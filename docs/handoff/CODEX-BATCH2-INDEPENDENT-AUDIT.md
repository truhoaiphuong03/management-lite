# CODEX-BATCH2-INDEPENDENT-AUDIT

Ngày: **2026-10-12 — MacBook**, không phải Windows Server.
**Kết luận: RELEASE_HOLD.** Chưa xác minh đủ123 chức năng, chưa xử lý credential vận hành và còn lỗi UI/build. Báo cáo này cập nhật đợt backend412PASS trước; không cộng dồn các đợt.

## 1. Source, ownership, commit

- Backend worktree: `/Users/duongbinh/Projects/management-lite-backend-verification-final-20261012`; branch `codex/backend-verification-final-20261012`.
- Base `123893e328bb47ffa2df6b68ff1b4691defc834d`.
- **Commit backend: `447c47fa9733570fc059a5fc1e7884aababa7c5f`**, chỉ10 file API/database/test. ATT-007/010, PAY-004 và AUDIT-005 được sửa/hardening; AUTH/PAY/REP/storage kiểm thử hồi quy, không đổi contract.
- Frontend audit worktree: `/Users/duongbinh/Projects/management-lite-anty-batch2-audit-121612a`, branch `codex/anty-batch2-audit-121612a`, exactHEAD `121612a4abf5c05f2ecfb5b5136ca3170c3dc557`.
- Batch1 snapshot `76e2aec8d3a2e62448dc07ac1796962591768ca2`; bằng chứng độc lập trước đó được giữ nguyên. Không coi claim của Anty là bằng chứng mới.
- Worktree Anty đã tiến tới SHA khác; không checkout/reset/stash/sửa/commit tại đó. Không cherry-pick Anty vào backend. Backend apps/web/packages/ui/tests/web diff rỗng.
- Repo thực tế dùng `packages/database/**`, không có `packages/db/**`. Dùng package database hiện hữu trong phạm vi database/migration Owner giao; không tạo package mới hoặc đổi kiến trúc.
- Worktree backend cũ đã bị tác nhân khác commit18a390b: không nhận report đó làm independent proof, không sửa/reset. Worktree hiện tại giữ đúng base và các thay đổi do đợt này kiểm tra.

## 2. Contract và nghiệp vụ

Đã đọc `ANTY-FUNCTION-ACCEPTANCE.md` và `ANTY-API-REQUIREMENTS.md` tại121612a cùng contracts/service/canonical comments. Giữ nguyên endpoints/request/response; không cần đổi API để khớp giao diện. Phát hiện tài liệu ATT decide sai: approved/reviewer_notes khác accept/reject + reason + clock_out_at; UI thực dùng payload đúng. Regression gửi payload tài liệu trả400, không thay đổi pending/version rồi payload đúng thành công. Yêu cầu Anty sửa tài liệu ở CODEX-TO-ANTY-BATCH2-FINDINGS.md; chưa coi là hai bên đã chấp thuận đổi contract.

PAY tính seconds trước, approved_worked_minutes hiển thị floor; không dùng minutes để tính tiền và không làm tròn từng ca tùy tiện. C04 Owner không có lương cá nhân kể cả promotedStaff/frozen snapshot. REP revision lưu history bất biến, không sửa bản cũ. FILE trash mock không chứng minh provider Drive thật.

## 3. Kết quả từng ID

VERIFIED ghi rõ chiều bằng chứng; WAITING_FOR_UI không phải toàn chức năng PASS. IMPLEMENTED chỉ phần code đã có. BLOCKED không được đổi thành SKIP/PASS. API có prefix `/api/v1`.

|ID|API/phạm vi|Backend|Nghiệm thu hiện tại|Bằng chứng / giới hạn|
|---|---|---|---|---|
|ATT-007|POST /attendance/shifts/:id/correction-requests; POST /attendance/correction-requests/:id/decide|VERIFIED|WAITING_FOR_UI|Staff request browser→API→DB1pending PASS; Staff decide403; claimed end sai400/rollback; accept200/snapshot6000s. Owner decision UI chưa chạy đủ; handoff payload docs400.|
|ATT-010|GET /attendance/me; correction decide; payroll computation|VERIFIED|WAITING_FOR_UI|23:30→01:30 VN qua tháng, unpaid break20phút,6000s; immutable version UPDATE/DELETE reject. UI overnight badge/filters chưa chạy thực tế.|
|PAY-003|GET /payroll/periods/:month/me|VERIFIED|VERIFIED (subset UI)|Staff own payslip API và browser render PASS. Chưa đủ mọi trạng thái trống/error/device.|
|PAY-004|GET /payroll/periods/:month/me|VERIFIED|VERIFIED (subset E2E)|Owner403; formerStaff frozen history403; staleStaff context401; Owner dashboard không có personal payslip, browser PASS.|
|PAY-005|GET /payroll/periods/:month; GET .../me|VERIFIED|WAITING_FOR_UI|Approved seconds/rates/rounding QA PASS; browser approved-hours có mặt. Chưa đối chiếu hết số tiền hiển thị với DB bằng browser.|
|PAY-006|POST /payroll/periods/:month/adjustments|VERIFIED|WAITING_FOR_UI|paid_leave only, required date/amount/reason; unsupported kind400, stale If-Match rejected, finalized immutable. UI write flow chưa chạy.|
|PAY-007|POST /payroll/periods/:month/finalize; POST /payroll/items/:id/disbursements|VERIFIED|WAITING_FOR_UI|Rollback/replay/mismatch, concurrent finalize1completion, concurrent payments/overpayment guards PASS; browser finalize/payment chưa chạy.|
|REP-003|POST /reports/daily/:id/revisions; GET .../revisions|VERIFIED|WAITING_FOR_UI|Required reason, Staff own/Owner permissions, version/If-Match, immutable history backend QA PASS. Frontend fails load before revision flow.|
|AUTH-006|GET /auth/me and authenticated endpoints|VERIFIED|VERIFIED (subset E2E)|Idle/absolute expired401, last_seen unchanged; browser expiredQA session→/login PASS.|
|AUTH-010|POST /auth/login; global identity lookup|VERIFIED|WAITING_FOR_UI|RealDB case-insensitive username/email cross-namespace collision401/no session; registration/login error UI chưa thử riêng.|
|FILE-004|Storage delete-readiness/trash request/confirm|IMPLEMENTED (mock)|BLOCKED|Mock protocol/RBAC/stale snapshot/idempotency QA PASS; no real GoogleDriveProvider adapter or authorized sandbox execution. Không công nhận provider thật.|
|AUDIT-005|GET /audit; audit_events write guards|VERIFIED|VERIFIED (backend/DB)|Owner-only query/sanitization/cursor QA8PASS; migration18 restores missing guard, old rows unchanged, rollback/replay, parallel UPDATE+DELETE rejected, parallel append succeeds.|

## 4. Migration và sửa backend

### AUDIT-005

Guard `trg_audit_events_immutable` đã có trong **migration0002** (báo cáo trước ghi0001 là sai). Không chỉnh nội dung/checksum migration đã phát hành. Thêm0018 additive DDL: CREATE OR REPLACE function + DROP/CREATE trigger trong transaction migrator, không rewrite row.

Test mới `audit-upgrade-qa.test.mjs`: migrate tới17, tạo audit synthetic, bỏ guard trong QA để mô phỏng legacy, rehearsal0018 BEGIN/ROLLBACK khôi phục trạng thái chưa có guard; áp dụng chính thức18/replay0; row cũ JSON giữ nguyên; UPDATE/DELETE chạy song song đều reject;2 INSERT song song thành công. Migrations filesystem/catalog parity được kiểm tra. Guard không bảo vệ khỏi DBA chủ động disable/drop trigger; không tuyên bố điều đó.

### ATT-007/010 và PAY-004

0017 attendance version bất biến giữ nguyên row cũ, correction vẫn append; test overnight6000s và DDL rollback/replay PASS. PAY me() thêm Staff role gate trước đọc frozen history; transaction read hiện hữu xác minh membership có khóa, Owner403/staleStaff401. Không đổi Owner vận hành hoặc snapshot lương thật.

Rollback: chưa áp dụng vận hành. QA đã diễn tập DDL rollback; khi deploy sau này phải backup trước, migrate trong gate. Có thể revert source trên branch riêng; không tự chỉnh migration history/xóa row vận hành. Nếu hạ schema đã áp dụng cần kế hoạch migration riêng, không chạy DROP trigger vận hành trong đợt này.

## 5. Kiểm thử thực chạy

|Bộ kiểm tra|PASS|FAIL|SKIP|Giới hạn|
|---|---:|---:|---:|---|
|45 file backend/database/security trên cluster55923|401|0|0|API, DB, auth/roles, writes, rollback, concurrency; TAP gồm parent/subtest|
|2 file ISSUES component/legacy|12|0|1|Legacy SKIP vô điều kiện, không sửa; component/source assertions không phải browser|
|Tổng47file|413|0|1|Không cộng412/652 trước hoặc rerun|
|3 file Anty Batch2, snapshot121612a|17|0|0|Static/component/service helper; không phải E2E UI|
|Chrome121612a: focused ATT/PAY|10|0|0|Staff correction UI→API→1DBpending; payslip; Owner dashboard|
|Chrome121612a: AUTH expiry|2|0|0|Login và expiredQA session→login|
|Chrome121612a: ISSUES/ACC/SET|20|2|0|ISSUES lost-response retry giữkey/body và1issue; detail reveal/theme FAIL|
|Chrome121612a: REP|1|1|0|Login PASS; report load FAIL hook order. Raw artifact thêm1harness-abort FAIL; không tính thành lỗi sản phẩm thứ hai|
|Lint|1|0|0|Full và targeted lint qua|
|Backend compiler riêng|1|0|0|API/packages qua|
|Typecheck chuẩn toànrepo|0|1|0|TS2742 frontend finance/ui.tsx:342|
|Build chuẩn toànrepo|0|1|0|CùngTS2742|
|Backup/restore|58|0|0|Tablecount+sortedrowJSONdigest khớp|

Runtime REP revision/pager tiếp theo NOT TESTED do trang trắng. ATT Owner quyết định UI; PAY adjustment/finalize/payout UI; overnight badge UI; collision UI chưa có đầy đủ browser proof. Không tuyên bố toàn12 ID end-to-end hoặc123/123 PASS.

Test Anty lúc đầu thiếu dist thất bại; sau compiler emission cho QA (declaration=false)17PASS. Giữ log fail ban đầu. Compiler workaround không thay đổi source nhưng không phải normal build PASS. Dependency của backend worktree tách riêng; npm ci baseline trước đó thiếu sharp trong lock. Chưa sửa frontend type hoặc lock ngoài phạm vi. Tập47file chạy từ bản build API/packages, component JS emit riêng.

## 6. QA riêng, dữ liệu và vận hành

PostgreSQL **55923** loopback, user riêng, data directory dưới evidence của đợt này; không dùng cluster55913 chung với tác nhân khác, không chia sẻ database ghi với Anty. Mỗi file có DB riêng và identity readback trước ghi; bound integration3228 + UI3229 dùng databaseQA riêng khôi phục **synthetic QA dump**, không dữ liệu vận hành. Runner DATABASE_URL sentinel khác TEST_DATABASE_URL; riêng server DATABASE_URL trỏ đúng boundQA. Guard mạng chặn operational endpoints/remote; không phải OS firewall.

Trước/sau: QA tạo mới; tests thêm/đổi dữ liệu synthetic. Sentinel vẫn0publictables. Dừng đúngAPI/web và cluster55923 sau xác minhcwd/system_identifier; giữ nguyên DB/dump. Backup cuối restore58/58bảng khớpcount+digest. Lần restore đầu fail do roleowner của dump không có trên cluster mới; giữ DB QA lỗi, tạo DB mới và restore --no-owner --no-acl; không sửa role vận hành, không xóa dữ liệu. Không ghi/seed/truncate/delete vào production, không đổi Owner thật; không suy ra rowcount sản xuất trước/sau vì không truy vấn so sánh production.

## 7. Credential còn tồn đọng

Rescan known-values: **848 reachableGitblobs,7424localtextfiles,47configentries**;80historymatch/453localmatch có alias/trùng, không phải số secret độc lập. Không in giá trị, không thử validity hoặc đổi secret thật.10 file commit candidate không có known configured credential match.

- ADMIN_PASSWORD/OWNER_PASSWORD/STAFF_PASSWORD/STAFF2_PASSWORD: legacy bootstrap/recover scripts, lịch sử `docs/handoff/MANAGEMENT-LITE-FULL-AUDIT-LOG.md` (54/71), `.env.qa-credentials.local*` và relevantCodexlogs.
- ACCOUNT_SECRET_KEY: `.env/.env.bak` của acc-backend/ui-report/unified-staging; trùng fixture trong tests/security/security.test.mjs:142 và tests/backend/accounts.test.mjs:76–78/history.
- CSRF_SECRET: cùngconfig; trùng devdefault apps/api/src/config.ts:21/history. Production loader từ chối default không chứng minh mọi localruntime đang productionmode.
- PostgreSQL password trong DATABASE_URL/TEST_DATABASE_URL: `.env*`, backup và untracked acc-backend/scripts/setup-acc-qa-users.mjs; chưa thấy configuredPGvalue trong reachableGit history đã quét.

Known-value scan không bao phủ unknownsecrets/binary/keychain/fullmachine/unreachableGitobjects; match không chứng minh credential còn hợp lệ. Tài khoản/secretQA mới sinh không phải credential vận hành. Cần Owner phê duyệt rotation thật; database role+app cutover/health/rollback, authenticated Owner password change+session revoke, CSRF đồng bộinstance. ACCOUNT_SECRET_KEY cần reviewed rewrap và cặp backupDB+key, không thay env đơn thuần; rollback trước mở writer hoặc forwardfix sau ghi mới. Không tự purgehistory/log.

## 8. Handoff và điều kiện phát hành

Yêu cầu UI và contract doc được ghi trong `CODEX-TO-ANTY-BATCH2-FINDINGS.md`, chưa có xác nhận Anty tiếp nhận. Không sửa frontend để biến test thành PASS.

Còn thiếu: sửa REP load, ACC detail, SETtheme; clean dependency install + normaltypecheck/build; providerDrive thật trong sandbox; browserwrite acceptance còn thiếu; Owner phê duyệt/xử lý credential; tích hợp được phê duyệt và đối soát123ID trên exactSHA mới. Windows cần gate môi trường/config/migration riêng; chưa kiểm thử/cập nhậtWindows.

**RELEASE_HOLD.** Không merge/push/deploy. Commit backend chỉ là candidate đã kiểm thử trong QA.

## 9. Evidence và file thay đổi

- [test-summary.json](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/test-summary.json)
- [database-safety.json](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/database-safety.json)
- [tests_backend_function_verification_test_mjs.log](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/tests_backend_function_verification_test_mjs.log)
- [tests_backend_payroll_test_mjs.log](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/tests_backend_payroll_test_mjs.log)
- [tests_database_audit_upgrade_qa_test_mjs.log](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/tests_database_audit_upgrade_qa_test_mjs.log)
- [tests_database_attendance_version_qa_test_mjs.log](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/tests_database_attendance_version_qa_test_mjs.log)
- [batch2-static-final.log](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/batch2-static-final.log)
- [batch2-focused-browser-results.json](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/batch2-focused-browser-results.json)
- [auth-expiry-browser-results.json](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/auth-expiry-browser-results.json)
- [browser-bound-anty-settings-results.json](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/browser-bound-anty-settings-results.json)
- [anty-rep-browser-results.json](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/anty-rep-browser-results.json)
- [rep-runtime-errors.jsonl](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/rep-runtime-errors.jsonl)
- [backup-restore-proof.json](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/backup-restore-proof.json)
- [sentinel-proof.json](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/sentinel-proof.json)
- [shutdown-proof.json](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/shutdown-proof.json)
- [credential-inventory.private-metadata.json](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/credential-inventory.private-metadata.json)
- [lint.log](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/lint.log)
- [typecheck.log](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/typecheck.log)
- [build.log](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/build.log)
- [backend-build.log](/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012/backend-build.log)

10 file trong commit backend:

- `apps/api/src/payroll/service.ts`
- `packages/database/src/migrations/0017_attendance_version_immutable.sql`
- `packages/database/src/migrations/0018_audit_events_immutable.sql`
- `packages/database/src/migrations/catalog.ts`
- `tests/backend/function-verification.test.mjs`
- `tests/backend/payroll.test.mjs`
- `tests/database/attendance-version-qa.test.mjs`
- `tests/database/audit-upgrade-qa.test.mjs`
- `tests/database/finance-service-qa.test.mjs`
- `tests/database/finance-time-receipt.test.mjs`

Tài liệu của đợt này được commit riêng sau backend; root CODEX-FUNCTION-VERIFICATION.md cũ giữ nguyên untracked, không nằm trong commit allowlist mới.
