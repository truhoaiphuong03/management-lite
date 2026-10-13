# CODEX INTEGRATED QA RESULT

Ngày: **2026-10-12 — MacBook**. **QA_HOLD / RELEASE_HOLD**.

Tích hợp không conflict. Typecheck/lint/build và90 file test đều hoàn tất, nhưng Chrome phát hiện SET-002 System không cập nhật khi OS appearance đổi lúc trang đang mở. Chưa được báo QA_READY. Production luôn RELEASE_HOLD chờ Owner; báo cáo này không nghiệm thu123/123 hoặc nâng56 chức năng Component/API thành FullE2E.

## 1. Nguồn, SHA và ancestry

|Nguồn|Branch|SHA đầy đủ|
|---|---|---|
|Anty frontend|fix/anty-codex-findings-remediation|b82e847cc56525018aa759a00319858eb7f9d76a|
|Mốc nghiệm thu Anty cũ|feat/anty-acceptance-123, mốc lịch sử|01ece1804c848bfbecbbd088387ff712489a96ad|
|Codex backend code|codex/backend-verification-final-20261012|447c47fa9733570fc059a5fc1e7884aababa7c5f|
|Codex backend report|codex/backend-verification-final-20261012|2679c7c81831d131d566a8bb42d5510350a76156|
|Merge-base hai nguồn|—|123893e328bb47ffa2df6b68ff1b4691defc834d|
|Merge tích hợp QA|codex/integrated-qa-b82e847-447c47f|f2aefdcf65a778acc7eb84090ab50a3c332cf47f|
|Candidate cuối đã test, cập nhật test ACC-005|codex/integrated-qa-b82e847-447c47f|1b22b49dfea08a2eb5b76fa4c2a9c98f2723027b|

Worktree thứ ba: `/Users/duongbinh/Projects/management-lite-integrated-qa-b82e847`. Tạo từ2679c7c, merge --no-ff với exact SHA b82e847. Hai parent merge là2679c7c vàb82e847; merge-base123893e. Đã chạy is-ancestor:01ece18→b82e847,447c47f→2679c7c, cả hai nguồn→merge,merge→ tested candidate đều true.

**Conflict:0**; không dùng chiến lược ghi đè hoặc giải quyết conflict thủ công. Worktree Anty và Codex nguồn giữ nguyên SHA/branch; không checkout/reset/stash/cherry-pick/sửa vào đó. Untracked report Codex và các thư mục bàn giao/ảnh của Anty giữ nguyên. Source-proof ghi status quan sát cuối; không suy ra mọi thay đổi ngoài đợt này đều do Codex.

apps/web, packages/ui và tests/web trong candidate khớp blob Anty b82e847; appsapi/packagesdatabase khớp Codex 2679c7c. Chỉ có thêm chỉnh testbackendACC sau merge, không sửa code frontend. Report được commit riêng sau testedcandidate; thay đổi tài liệu không làm thay đổi runtime được test.

## 2. Tương thích contract

|Nhóm|Kết quả thực tế|Giới hạn|
|---|---|---|
|ATT-007|Anty đã sửa tài liệu thành accept/reject + reason + clock_out_at; UI dùng đúng payload. Staff request 201, Owner decision 200, Staff decide 403, lỗi input 400/rollback; browser gửi1pending vàoDB |Owner quyết định toàn luồng UI chưa được nâng Full E2E|
|ATT-010|Ca23:30→01:30 VN qua tháng,20 phút unpaid break =6000 giây; snapshot append-only|Badge/device/mọi timezone UI chưa có đủacceptance|
|PAY-003..007|Staff/me, Owner exclusion kểcảpromotedStaff; paid_leave/If-Match/finalize/payment/idempotency/concurrency/overpay tests PASS; browser Staff payslip vàOwner dashboard PASS|UIadjustment/finalize/payment đầyđủ chưa được nâng Full E2E|
|REP-003/006|API revision/immutable history/cursor PASS. Chrome Owner reports tải được, pagination tiến/lùi, không trùng, previous khôi phục đúng cards; không tái phát hook exception|Không coi pagination5checks là toànmoduleFullE2E; revision UI write flow chưa chạy đầy đủ|
|ACC-004/005|Detail reveal mởmodal; listserver step-up + visible secret + expiry 30 giây PASS; Owner/Staff/proof rollback tests PASS|Detail modal opening không đồng nghĩa mọi CRUD/detail flow đềuFullE2E|
|FILE-004|Contract readiness/trash mock/RBAC/stale hash/idempotency tests PASS|BLOCKED provider Google Drive thật; không thử thao tác pháhủy Drive thật, không dùng credentialvận hành|
|AUDIT-005|0018guard upgrade + rollback/replay/concurrenttampering tests PASS; restore DB vẫn chặn UPDATE/DELETE|Không áp migration vận hành hoặc tuyên bố chống DBA chủ động drop trigger|

Không đổi endpoint/request/response trong đợt tích hợp.

## 3. SET-002 — kiểm tra màu thật

Đã chạy Chrome với select thật và đọc computed background/text/colorScheme, không chỉ localStorage:

|Tình huống|Background|Text|Kết quả|
|---|---|---|---|
|Dark|rgb(11,18,32)|rgb(248,250,252)|PASS|
|Light|rgb(248,250,252)|rgb(15,23,42)|PASS|
|Light → Dark|Khôi phục Dark|Khôi phục Dark|PASS|
|ChọnSystem khi OS light|Màu Light thật|Màu Light thật|PASS|
|ChọnSystem khi OS dark|Màu Dark thật|Màu Dark thật|PASS|
|Reload Light|Giữ màu Light thật|Giữ màu Light thật|PASS|
|Đang System, OS dark→light khi trang vẫn mở|Body vẫnDark|Text vẫnDark|**FAIL**|

Nguyên nhân: applyTheme đọc matchMedia tại thời điểm gọi; không có listener change để cập nhật khi systemappearance đổi. Không sửa frontend. **P2 — Anty phụ trách**, tái hiện:Settings→System với OS dark→đổi OS light không reload; kiểm tra body/text vẫn dark. Cần listener có cleanup, chỉtheo OS khi đang System, giữLight/Dark manual; commit mới rồi Codex retest.

## 4. Kết quả kiểm thử

|Bộ|Files|PASS|FAIL|SKIP|
|---|---:|---:|---:|---:|
|Backend|34|335|0|0|
|Database|12|69|0|0|
|Security|2|13|0|0|
|Foundation|1|4|0|0|
|Frontend|41|264|0|1|
|**Tổng TAP**|**90**|**685**|**0**|**1**|

TAP gồm parent/subtest; không phải685 chức năng. Frontend có static/component và một số Chrome suite dùng mock response; không đổi classification56Component/API sangFullE2E. Không cộng số 652/413 cũ hoặc lần rerun.

|Check khác|Kết quả|
|---|---|
|npm run typecheck|PASS|
|npm run lint|PASS; targeted ACC test lint PASS|
|npm run build|PASS; lỗi TS2742 trước đó đã được Anty sửa|
|npm run build:web|PASS|
|Chrome riêng ISSUES/ACC/SET|22PASS/0FAIL|
|Chrome REP pagination|5PASS/0FAIL|
|Chrome theme|7PASS/1FAIL|
|Chrome focused ATT/PAY|10PASS/0FAIL|
|Chrome AUTH expiry|2PASS/0FAIL|
|**Tổng Chrome riêng**|**46PASS/1FAIL**; không cộng trùngChrome nằm trongfrontendTAP|
|Backup/restore|58/58 bảng khớp count+sortedrowJSONdigest|
|Auditguard sau restore|UPDATE/DELETEđềuREJECTED, row giữ nguyên|
|npm ci --ignore-scripts|FAIL vì package-lock thiếu sharp và phụthuộc; chưa chứng minh cài đặt tái lập|

Legacy `tests/web/issues-fix-03.test.mjs` vẫn SKIP vô điều kiện, giữ nguyên. Browser ISSUES riêng đã chứng minh response bị mất sau commit, retry giữ body/key vàDB 1 row; không đổi legacy SKIP thành PASS.

### Rerun và thay đổi test có căn cứ

- Lần đầu 90 files:678PASS/7FAIL/1SKIP. Các Chrome wrappers thiếu QA_WEB_BASE bịguardchặn; chạy lại với endpoint riêng 3329. Admin test cần migratedschema và existingOwner fixture: seed đúng workspace/Owner synthetic trong DB riêng rồi PASS; không dùng Owner thật.
- ACC test cũ assertion 60 giây trái contract ACC-00530 giây tại ANTY-FUNCTION-ACCEPTANCE và bằng chứng Chrome30 giây. Commit1b22b49 chỉ sửa 4 dòng text/assertion thành 30, giữ nguyênzero-storage/cleanup/nullclear assertions; rerun HTTP/source 10/10 PASS. Không gọi source assertion này làBrowser E2E dùtênfilecũ chứaE2E.
- REP browser harness ban đầu tìm tbody,tr trong UI card nên FAIL. Đổi locator trongscriptQA ngoàirepo sang cards đang render, giữ assertions không trùng/next/previous/pageindicator; 5/5 PASS. Không sửaReact source hoặc bỏassertions.
- Cài dependency riêng bằng npm install --ignore-scripts --package-lock=false để tiếp tục test; không sửa package.json/lockfile. Full typecheck/build dùng config chuẩn, không workaround declaration=false trong đợt này.

## 5. QA, migration và dữ liệu

Cluster QA mới độc quyền **127.0.0.1:55933**, data directory dưới evidence đợt này, user/password synthetic riêng. Không dùng cluster/database ghi Anty. Test từng file có database riêng, identity proof trước ghi. Bound API 3328 và Vite 3329 chỉ dùngQA; fixture restore từdump synthetic QA, không data vận hành. Runner DATABASE_URL là sentinel khác TEST_DATABASE_URL; API process DATABASE_URL trỏ bound QA rõ ràng.

0017/0018 chỉ áp QA. Migration catalog/SQL parity và replay/rollback đã test; không đổi checksum migration cũ. Backup cuối khi read/write QA service đã dừng, restore DB riêng,58bảngkhớp. Restore audit guard được chạyUPDATE/DELETE kỳ vọng reject vàso sánhrow giữ nguyên. Sentinel 0 public tables, không fallback ghi. Dừng đúngAPI/web/cluster 55933 sau identity/cwd proof; giữ data/dump. Không dừng tiến trình Anty, khôngseed/truncate/delete production.

Không đổi credential thật; temporary synthetic credential file chuyển ra evidence 600, không commit .env. Không thử đăng nhập bằng credential vận hành hoặc thao tác Drive thật. Credential history/config risks của đợt trước vẫnchờ Owner phê duyệt rotation; chưa được coi là đã giải quyết chỉ vì integration PASS.

## 6. Lỗi còn lại và release gates

|Gate|Trạng thái|Phân công|
|---|---|---|
|SET-002System livemediachange|FAIL/P2; chặnQA_READY trong đợt này|Anty frontend, Codex retest SHA mới|
|Lockfile/npm ci tái lập|HOLD|Người phụ trách package/release reconcile lock trong branch được giao; Codex chạy clean install lại|
|685TAP + typecheck/lint/build|PASS có bằng chứng|Không đủđểđổi QA_HOLD thành QA_READY khi Chrome còn FAIL|
|Legacy ISSUES SKIP|SKIP có lý do|Giữbằng chứngbrowser riêng, xử lý test legacy theo đúng scope|
|Google Drive provider thật|BLOCKED|Backendadapter + authorized sandbox tương lai; không destructive test Drive vận hành|
|Credential rotation vận hành|HOLD|Owner phê duyệt/thực hiện kế hoạch backup/cutover/rollback|
|123/123 Full E2E|NOT VERIFIED|Giữ nguyên 56 Component/API; acceptance còn thiếu phải chạy theo ID|
|Production/GitHubmain/Windows|RELEASE_HOLD|Owner phê duyệt gate riêng; chưa merge/push/deploy|

Bản fix frontend tiếp theo chỉ được tích hợp vào QA worktree riêng sau xác minh SHA/ancestry; không ghi đè worktree nguồn.

## 7. File thay đổi và evidence

35 file candidate so với merge-base, trước tài liệu mới này. Nguồn Anty 22 file + Codex 12 file + 1 backend test align; không có conflict:

- `apps/api/src/payroll/service.ts`
- `apps/web/index.html`
- `apps/web/src/App.tsx`
- `apps/web/src/finance/ui.tsx`
- `apps/web/src/screens/AccountsScreen.tsx`
- `apps/web/src/screens/ClockScreen.tsx`
- `apps/web/src/screens/PayrollScreen.tsx`
- `apps/web/src/screens/ReportsScreen.tsx`
- `apps/web/src/screens/SettingsScreen.tsx`
- `docs/handoff/ANTY-API-REQUIREMENTS.md`
- `docs/handoff/ANTY-CODEX-FINDINGS-REMEDIATION.md`
- `docs/handoff/ANTY-FINAL-UI-VERIFICATION.md`
- `docs/handoff/ANTY-FUNCTION-ACCEPTANCE.md`
- `docs/handoff/CODEX-BATCH2-INDEPENDENT-AUDIT.md`
- `docs/handoff/CODEX-TO-ANTY-BATCH2-FINDINGS.md`
- `packages/database/src/migrations/0017_attendance_version_immutable.sql`
- `packages/database/src/migrations/0018_audit_events_immutable.sql`
- `packages/database/src/migrations/catalog.ts`
- `packages/ui/src/tokens.css`
- `scripts/test-ui-fix-45-chrome.mjs`
- `tests/backend/acc-e2e.test.mjs`
- `tests/backend/function-verification.test.mjs`
- `tests/backend/payroll.test.mjs`
- `tests/database/attendance-version-qa.test.mjs`
- `tests/database/audit-upgrade-qa.test.mjs`
- `tests/database/finance-service-qa.test.mjs`
- `tests/database/finance-time-receipt.test.mjs`
- `tests/web/accounts-screen.test.mjs`
- `tests/web/audit-screen.test.mjs`
- `tests/web/clock-screen.test.mjs`
- `tests/web/payroll-screen.test.mjs`
- `tests/web/reports-pagination.test.mjs`
- `tests/web/settings-screen.test.mjs`
- `tests/web/ui-notifications.test.mjs`
- `tests/web/work-screen.test.mjs`

Evidence chỉ rõ từng file test và log, không có giá trị secret:

- [integration-source-proof.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/integration-source-proof.json)
- [test-summary.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/test-summary.json)
- [command-results.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/command-results.json)
- [database-safety.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/database-safety.json)
- [theme-computed-styles.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/theme-computed-styles.json)
- [theme-browser-results.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/theme-browser-results.json)
- [browser-bound-anty-settings-results.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/browser-bound-anty-settings-results.json)
- [anty-rep-browser-results.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/anty-rep-browser-results.json)
- [batch2-focused-browser-results.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/batch2-focused-browser-results.json)
- [auth-expiry-browser-results.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/auth-expiry-browser-results.json)
- [backup-restore-proof.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/backup-restore-proof.json)
- [restored-audit-guard.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/restored-audit-guard.json)
- [sentinel-proof.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/sentinel-proof.json)
- [shutdown-proof.json](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/shutdown-proof.json)
- [npm-ci.log](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/npm-ci.log)
- [tests_database_audit_upgrade_qa_test_mjs.log](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/tests_database_audit_upgrade_qa_test_mjs.log)
- [tests_backend_acc_e2e_test_mjs.log](/Users/duongbinh/.codex/audits/management-lite-integrated-qa-b82e847-20261012/tests_backend_acc_e2e_test_mjs.log)

**Kết luận cuối: QA_HOLD / RELEASE_HOLD. Không merge main, push production hoặc cập nhật Windows.**
