# CODEX — SET-002 retest và lockfile

**QA_HOLD / RELEASE_HOLD.** Kiểm tra trên MacBook, không phải Windows Server. SET-002 đạt kiểm tra browser tập trung; lint vẫn thất bại. Không nghiệm thu production hoặc nâng 56 chức năng Component/API thành Full E2E.

## Source và tích hợp

- Worktree mới: `/Users/duongbinh/Projects/management-lite-set002-qa-b6b16fd`.
- Branch: `codex/set002-retest-b6b16fd`.
- Base QA trước: `1b03a3b19e7e6cdc8c7ef7dd07f16f63bbd92cec`, chứa merge cũ `f2aefdcf65a778acc7eb84090ab50a3c332cf47f` và sửa assertion ACC 30 giây.
- Frontend nguồn: `b6b16fd65dad23d6bb5df8f00226b76c7707c179`, parent `b82e847cc56525018aa759a00319858eb7f9d76a`.
- Merge-base với base QA: `b82e847cc56525018aa759a00319858eb7f9d76a`.
- Merge tích hợp mới: `dc4c0b04c564e0e9fba470ea50ca2f75e430525d`, hai parent là base QA và commit frontend trên. Không conflict.
- Backend code `447c47fa9733570fc059a5fc1e7884aababa7c5f` và báo cáo `2679c7c81831d131d566a8bb42d5510350a76156` vẫn nằm trong ancestry.
- Candidate đã kiểm thử, gồm lockfile: `35eda584eaee0397535aa58ef794b6398a89ed3a`.
- API/backend/database byte-for-byte giống mốc `2679c7c`; frontend/UI/web tests giống `b6b16fd`. Không sửa frontend.
- Worktree Anty, Codex nguồn và QA cũ được giữ nguyên; không reset, stash, checkout hoặc ghi vào chúng. Các thay đổi chưa commit của nguồn được bảo toàn.

Sáu file trong bản sửa Anty:

1. `apps/web/index.html`
2. `apps/web/src/App.tsx`
3. `apps/web/src/screens/SettingsScreen.tsx`
4. `packages/ui/src/tokens.css`
5. `tests/web/settings-screen.test.mjs`
6. `docs/handoff/ANTY-SET002-SYSTEM-THEME-FIX.md`

Codex chỉ bổ sung `package-lock.json` và hai báo cáo `CODEX-*.md` trên branch QA. Diff lockfile lưu riêng trong evidence.

## npm ci và lockfile

Node `22.14.0`, npm `10.9.2`, đúng engines của repository.

- Trước sửa: `npm ci --ignore-scripts --no-audit --no-fund` FAIL (EUSAGE).
- Nguyên nhân: `apps/api/package.json` khai báo `sharp@0.35.5`, lockfile thiếu sharp và các package đi kèm.
- Sửa bằng `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`, chỉ trong QA.
- Diff: thêm 31 package records, cập nhật dependency record `apps/api`, bỏ cờ `dev` của semver vì nay cũng là dependency runtime. Không đổi version của package đã tồn tại. 579 dòng thêm / 2 dòng bỏ.
- Sau sửa: `npm ci --no-audit --no-fund` **PASS**, gồm preinstall kiểm tra toolchain. Không dùng workaround bỏ lockfile để kết luận.
- Commit lockfile: `35eda584eaee0397535aa58ef794b6398a89ed3a`. Không sửa lockfile nhánh nguồn.

## Kiểm thử bắt buộc

| Nhóm | Files | PASS | FAIL | SKIP |
|---|---:|---:|---:|---:|
| Backend | 34 | 335 | 0 | 0 |
| Database | 12 | 69 | 0 | 0 |
| Security | 2 | 13 | 0 | 0 |
| Foundation | 1 | 4 | 0 | 0 |
| Web | 41 | 265 | 0 | 1 |
| Tổng kết quả cuối theo từng file | 90 | **686** | **0** | **1** |

Các số trên là TAP tests, có tính subtests; không phải số chức năng được nghiệm thu E2E. Mốc trước là 685 PASS / 0 FAIL / 1 SKIP.

| Gate | Kết quả |
|---|---|
| Typecheck | PASS |
| Lint | **FAIL — 4 errors / 0 warnings** |
| Build TypeScript | PASS |
| Build web Vite | PASS |
| npm ci sau sửa | PASS |
| Backup/restore | PASS — 58/58 bảng khớp số dòng và digest |
| AUDIT-005 sau restore | PASS — UPDATE/DELETE bị từ chối, dữ liệu không đổi |

Một SKIP vẫn là `tests/web/issues-fix-03.test.mjs`: test chủ động `t.skip` vô điều kiện, không có biến môi trường bật lại. Không sửa guard để đổi thành PASS. Kịch bản ISSUES retry riêng dùng runtime/database binding đã xác minh và đạt trong Chrome, nhưng không thay thế trạng thái SKIP của file legacy.

### Những lần chạy đầu chưa đạt

Không xóa hoặc che các lần lỗi đầu; lưu `.initial` và kết quả retry riêng.

- Ba suite QA thiếu `VERIFY_QA_SYSTEM_IDENTIFIER`: bổ sung identity thực của cluster riêng vào harness, chạy lại trên database mới; tất cả đạt, không đổi source/test assertions.
- Unified ACC reveal 500: fixture dump QA được mã hóa bằng key QA cũ, server ban đầu dùng key QA mới. Khởi động lại **API QA do phiên này tạo**, dùng key synthetic khớp fixture; suite đạt 13/13. Không dùng hoặc xoay credential vận hành.
- FIN mounted test chạy song song: 1 PASS / 3 FAIL, lỗi đầu `container.querySelectorAll is not a function` trong fake DOM khi timeout focus AppDialog chạy; hai lỗi sau là cascade/overlapping act. Chạy riêng đạt 4/4. **Flaky harness còn mở**, không coi là đã sửa chỉ vì retry đạt.
- Theme harness lần đầu đạt 8 assertions nhưng exit 1 do CDP timeout lúc teardown. Sửa quản lý pending CDP trong script evidence ngoài repo; chạy lại cùng assertions đạt 8/8 và exit 0.

## Chrome trước/sau và SET-002

Mốc Chrome cũ: **46 PASS / 1 FAIL**. Lỗi cũ: `SET-002 System follows subsequent OS appearance change`.

- Chạy lại đúng `theme-browser.mjs`, giữ nguyên assertions: **8 PASS / 0 FAIL**. Lỗi System cũ đã đạt.
- Extended theme: **18 PASS / 0 FAIL**, gồm 8 assertion lặp lại và 10 assertion bổ sung. Không cộng thành 26 ca độc lập.
- Xác minh computed background/text Light/Dark, System đổi hai chiều không reload, manual override cả hai chiều, reload persistence của Light và System, System vẫn theo OS sau reload, một listener duy nhất và cleanup gỡ listener thực tế.
- Dark: background `rgb(11, 18, 32)`, text `rgb(248, 250, 252)`; Light: background `rgb(248, 250, 252)`, text `rgb(15, 23, 42)`.
- Cleanup browser dùng exported `removeThemeListener()` trên module thật và đo listener đã về 0. App root cleanup có trong source; **chưa kiểm thử riêng React root unmount thực tế**, không gọi phần này Full E2E.

Các batch Chrome hồi quy:

| Batch | PASS | FAIL | Ghi chú |
|---|---:|---:|---|
| Theme gốc | 8 | 0 | Cùng kịch bản từng FAIL |
| Settings / ISSUES / ACC | 20 | 2 | Hai assertion ACC expiry không đạt ở lần chạy đầy đủ đầu |
| REP | 5 | 0 | Pagination thực, không lỗi React Hooks |
| ATT / PAY | 10 | 0 | UI/API/database |
| AUTH expiry | 2 | 0 | UI hết hạn session |
| Tổng assertion chức năng của cohort | **45** | **2** | Thêm 1 harness-completion FAIL riêng do assertion ACC |

Không báo Chrome full regression toàn PASS. File raw batch Settings chứa 20 PASS / 3 FAIL nếu tính cả harness-completion; dòng tổng trên tách harness khỏi assertion chức năng.

### ACC 30 giây — kiểm tra ưu tiên theo Owner

- Lần full batch đầu: hai assertion expiry FAIL. Chưa đủ bằng chứng kết luận production bug hoặc nguyên nhân timer.
- Retry cả batch gặp precondition sai (profile đã Light nên chọn Light không đổi màu) và CDP timeout; không dùng lần này thay thế kết quả chức năng. Theme độc lập đã chứng minh behavior đúng.
- Chạy **chỉ ACC** tuần tự, profile mới, tab foreground, không interception các request không liên quan: **8 PASS / 0 FAIL**.
- Quan sát lúc **31.001 giây**, `document.visibilityState = visible`, không còn countdown; assertion kiểm tra reauth input xuất hiện và secret đã ẩn đạt.
- Kết luận: ACC đạt ca foreground tập trung; **độ ổn định của full harness/expiry vẫn cần điều tra**, không xóa lần FAIL hoặc kết luận đã sửa lỗi bảo mật. Không in giá trị secret.

## Tài nguyên và kiểm soát tải

Theo snapshot lúc Owner yêu cầu tối ưu: CPU 62,43% idle; load 2,48 / 2,83 / 3,63; RAM khoảng 15 GB dùng, 565 MB chưa dùng, compressor khoảng 3,6 GB. RAM có sức ép; snapshot này không chứng minh CPU luôn quá tải.

Bộ 90 file đã hoàn tất trước yêu cầu mới. Không chạy lại toàn bộ sau đó. Chỉ một Chrome ACC tập trung chạy, tiếp theo backup/restore tuần tự. Không mở thêm bộ toàn hệ thống. Các node/npm/PostgreSQL khác và Chrome người dùng được giữ nguyên; không thể suy ra mọi tiến trình là task của phiên này.

Không phát hiện tiến trình QA test còn treo cần dừng tại thời điểm kết thúc. Theo yêu cầu mới chỉ dừng khi xác nhận treo, API QA PID 8374, Vite QA PID 4104 và cluster QA cổng 55943 đang khỏe được giữ nguyên; không dừng dịch vụ vận hành. Các Chrome child của harness đã thoát theo teardown.

## Database, rollback và dữ liệu

- PostgreSQL mới: loopback `55943`, system identifier `7695683766436580904`, data directory thuộc evidence riêng.
- Mỗi suite database có database riêng; server integration dùng riêng `backend_test_batch2_bound_v2`. Không dùng chung DB ghi với Anty.
- `DATABASE_URL` của test trỏ sentinel riêng, `TEST_DATABASE_URL` trỏ database QA đã xác minh. Server bound dùng database QA synthetic riêng.
- Network guard chặn endpoint ngoài loopback và các cổng operational đã biết; đây là guard của Node, không tuyên bố firewall hệ điều hành.
- Migration 0018 chỉ chạy QA. Backup/restore: 58 bảng, số dòng và digest trước/sau trùng. AUDIT-005 UPDATE/DELETE bị từ chối sau restore. Sentinel có 0 bảng public trước/sau.
- Test có ghi dữ liệu synthetic QA đúng phạm vi; không tuyên bố QA không thay đổi. Không thao tác database vận hành, Owner thật hoặc Google Drive thật.
- Dump và state riêng được giữ để rollback/đối chiếu. Credential fixture đã chuyển khỏi worktree sang evidence private, không commit. Không xoay secret thật.
- Rollback source: dùng lại branch/worktree QA cũ giữ nguyên ở `1b03a3b`; nhánh mới và lock commit riêng có thể loại khỏi kế hoạch tích hợp mà không reset nguồn.

## Lỗi còn mở và phân công

1. **Anty — lint blocker:** `SettingsScreen.tsx` 34:44, 35:28, 99:32, 100:16, cùng rule `@typescript-eslint/no-explicit-any`. Fallback MediaQueryList bị ép `any`. Bàn giao trong `CODEX-ANTY-SET002-LINT-HANDOFF.md`: sửa trên branch riêng, dùng kiểu cụ thể, không tắt rule.
2. **Anty / harness frontend — FIN flaky:** fake DOM thiếu querySelectorAll cho focus trap; cần test ổn định dưới tải. Không sửa frontend hoặc test của Anty trong QA này.
3. **Codex / Anty — ACC expiry full harness chưa ổn định:** foreground tập trung đạt, lần full trước FAIL. Cần xác định timer/browser/interception trước khi đóng issue; không tự kết luận lỗi sản phẩm đã sửa.
4. **Legacy ISSUES SKIP:** giữ nguyên và báo riêng; không tính PASS.

Release gate: lint chưa đạt, Chrome full cohort chưa sạch, còn flaky harness, chưa có đủ bằng chứng 123/123 Full E2E, Google Drive thật và credential rotation vẫn theo gate Owner trước đó. Không mở rộng phạm vi hoặc tự đổi secret để xử lý gate.

**Kết luận: QA_HOLD. Production: RELEASE_HOLD trong mọi trường hợp cho đến khi Owner phê duyệt.** Không merge main, push GitHub hoặc triển khai Windows.

## Evidence

Evidence private: `/Users/duongbinh/.codex/audits/management-lite-set002-retest-20261012/`.

Các file không chứa giá trị credential dùng để đối chiếu:

- `integration-source-proof.json`, `lockfile-diff-proof.json`, `lockfile.diff`
- `npm-ci-before.log`, `npm-ci-after.log`, `typecheck.log`, `lint.log`, `build.log`, `build-web.log`
- `test-summary.json`, các `tests_*.result.json` và binding proof tương ứng
- `theme-browser-results.json`, `theme-extended-results.json`, computed style JSON
- `browser-bound-anty-settings-results.initial.json`, retry result và `acc-30s-focused-results.json`, `acc-timer-observation.json`
- `anty-rep-browser-results.json`, `batch2-focused-browser-results.json`, `auth-expiry-browser-results.json`
- `backup-restore-proof.json`, `restored-audit-guard.json`, `sentinel-proof.json`, `resource-snapshot.txt`

Các file `runtime-*.json`, `*.private`, private server logs và dump chứa dữ liệu synthetic nhạy cảm được giữ cục bộ, không công bố hoặc đưa vào Git. Chỉ trích xuất kết quả đã làm sạch trong báo cáo.

## Cập nhật sau baseline 5435319

Xem `CODEX-QA-FOLLOWUP-ACC-FIN.md`: ACC background throttling đã tái hiện lỗi ứng dụng (secret còn ở 31 giây); FIN xác nhận fake DOM thiếu API và race timeout focus 30 ms. Lint vẫn chờ commit Anty. Giữ QA_HOLD / RELEASE_HOLD; không chạy lại 90 file. Các số baseline trên là kết quả đợt trước.
