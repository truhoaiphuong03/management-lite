# CODEX — QA follow-up ACC / FIN / lint

**QA_HOLD / RELEASE_HOLD**. Kiểm tra MacBook ngày 12/10/2026 (Asia/Ho_Chi_Minh). Base đã xác minh: `543531907bbbc67a40b07d1bdeacc1e6516e48c2`, branch `codex/set002-retest-b6b16fd`, worktree `/Users/duongbinh/Projects/management-lite-set002-qa-b6b16fd` sạch trước kiểm tra.

## Phạm vi và runtime

API PID 8374 cổng 3428, Vite PID 4104 cổng 3429 và PostgreSQL PID 3635 cổng 55943 đã có sẵn. Dùng lại, không mở server trùng. Browser test xác minh database và system_identifier trước ghi fixture synthetic: `backend_test_batch2_bound_v2`, cluster `7695683766436580904`.

Chỉ chạy ACC tập trung tuần tự, sau đó FIN tập trung; không chạy lại toàn bộ Chrome hoặc 90 file. Không sửa backend, frontend, web tests hoặc dependencies. Script quan sát/tái hiện đặt ngoài repository trong evidence riêng. Không dừng dịch vụ Anty hoặc vận hành; Chrome riêng của từng harness thoát theo teardown.

CPU snapshot đầu đợt còn 66,18% idle; RAM khoảng 15 GB dùng, 319 MB unused, compressor 3.242 MB. Không tạo tải song song để tái hiện FIN; dùng mô hình flush chậm có kiểm soát.

## ACC — lỗi ứng dụng đã xác nhận, giao Anty

**OPEN — P1: secret còn trong DOM quá thời hạn khi callback timer bị throttling.** Source `apps/web/src/screens/AccountsScreen.tsx:251` giảm countdown một đơn vị trên mỗi callback `setInterval(1000)` và khởi tạo lại effect theo countdown. Không tính deadline theo thời gian thực. Khi callback chậm, thời gian hiển thị bị kéo dài.

| Ca ACC tập trung | Quan sát tại mốc gốc | Callback | Secret trong DOM | Kết quả |
|---|---|---:|---|---|
| Foreground | 31,007 giây, visible | 30 | Không | 8 PASS / 0 FAIL |
| Background thật, kích hoạt tab trống khác | 31,003 giây, hidden | 15 | Có, countdown 15s | 7 PASS / 1 assertion FAIL |
| Renderer pause 2,2 giây rồi resume | 31,005 giây, visible | 29 | Có, countdown 1s | 7 PASS / 1 assertion FAIL |

Không tăng mốc chờ 31 giây của test cũ. Background trace ghi toàn bộ 15 callback ở trạng thái hidden, callback cách lịch hẹn tối đa 1993 ms. Ca pause dùng CDP Debugger pause/resume, không tạo busy loop hoặc sửa timer ứng dụng.

Mỗi ca lỗi còn có một record `harness completion FAIL` do assertion ném lỗi; không tính đó là lỗi chức năng thứ hai. Các log chỉ chứa timestamp, visibility, countdown và boolean secretPresent; không ghi secret hoặc token.

Lần full Chrome cũ không có timestamp từng callback hoặc visibility nên không thể chứng minh lịch trình chính xác của lần đó. File mtime chỉ là thời gian ghi artifact, không phải timestamp reveal. Bằng chứng mới tái hiện cùng cơ chế thất bại trên frontend nguyên bản, xác nhận đây không chỉ là timeout test. Ca background đầu gặp CDP timeout; retry có instrumentation đã hoàn tất và ghi visibility hidden thực tế. Một locator ban đầu của harness mới dùng `[role=dialog] code` không khớp modal hiện tại; sửa selector thành node `code` duy nhất trong AccountsScreen, giữ lại artifact lỗi locator. Không sửa source hoặc assertion expiry để làm xanh.

### Hướng sửa bàn giao Anty

- Tạo branch sửa riêng từ SHA đã xác minh; không sửa worktree QA hoặc branch nguồn của Codex.
- Countdown hiển thị phải dẫn xuất từ deadline, không phải số lần callback đã chạy; xóa secret khi deadline hết trên callback/resume.
- Với dữ liệu bí mật, xem xét xóa ngay khi tab chuyển hidden/blur theo contract đã thống nhất. JavaScript không thể thay DOM khi renderer bị suspend hoàn toàn; cần loại secret trước khi ẩn và kiểm tra lại deadline khi trở về.
- Giữ cleanup khi unmount/navigation; không log secret.
- Nghiệm thu bằng đúng ca foreground, background thật và pause/resume, đo DOM secretPresent; không chỉ kiểm tra chuỗi countdown.

Codex không sửa frontend. Thay đổi behavior cần Anty thực hiện trong phạm vi ACC và gửi commit để nghiệm thu độc lập.

## FIN — nguyên nhân harness frontend đã xác nhận

File `tests/web/finance-categories-mounted.test.mjs` dùng fake DOM chung từ `tests/web/helpers/fake-dom.mjs`, mock fetch/sessionStorage và React act. Các test top-level mặc định chạy tuần tự trong file; nhiều file regression chạy ở process riêng. Không có bằng chứng shared-state xuyên process là nguyên nhân đầu tiên.

`AppDialog` đặt timeout focus **30 ms**. FakeElement không có `querySelectorAll`, `closest` hoặc `contains`; focus là no-op. Test flush sáu lượt `setTimeout(0)` và thường đóng/unmount dialog trước khi callback focus chạy. Khi tải máy làm flush chậm, callback focus chạy trong lúc dialog còn mở và ném TypeError. Cleanup timer có trong component, nhưng test lỗi trước root.unmount khiến cleanup không tới được; state/act từ test hỏng có thể gây cascade vào các test sau. Đây là lỗi harness DOM/timing, chưa có bằng chứng browser AppDialog thật lỗi API DOM.

- Chạy riêng bình thường: **4 PASS / 0 FAIL**.
- Tái hiện chỉ test `Ngừng dùng` với preload ngoài repo: mô phỏng mỗi flush 0 ms thành 8 ms, giữ timer component 30 ms nguyên bản. **0 PASS / 1 FAIL**.
- Trace: focus callback chạy sau **31 ms**, `querySelectorAll`, `closest`, `contains` đều undefined; lỗi `container.querySelectorAll is not a function` giống lỗi regression trước.
- Đây là mô hình scheduling chậm có chủ ý, không phải lần chạy suite tiêu chuẩn và không cộng vào baseline 686 PASS. Không dùng fake timers; không sửa timeout hoặc assertion.

**Giao Anty:** bổ sung DOM đủ API hoặc test dialog bằng môi trường DOM/browser phù hợp; kiểm soát timer deterministically; bảo đảm unmount/cleanup trong finally, dọn container và mock globals giữa test. Không sửa production dialog để né test và không bỏ assertion. Codex không được sửa tests/web hoặc packages/ui nên chỉ lập bàn giao.

## Lint — WAITING_FOR_ANTY

Đã kiểm tra branch `fix/anty-codex-findings-remediation`: vẫn ở `b6b16fd65dad23d6bb5df8f00226b76c7707c179`, chưa nhận commit sửa. Không fetch/push hoặc sửa branch Anty.

Bốn lỗi hiện có trong `apps/web/src/screens/SettingsScreen.tsx`: 34:44, 35:28, 99:32, 100:16, cùng rule `@typescript-eslint/no-explicit-any`. Bàn giao trong `CODEX-ANTY-SET002-LINT-HANDOFF.md`; giữ requirement sửa branch riêng.

Do chưa có commit mới hoặc thay đổi source/config, không chạy lại ESLint/typecheck/build/SET-002 một cách dư thừa. Sau bàn giao: xác minh SHA/phạm vi, tạo worktree QA mới hoặc tích hợp riêng, dừng nếu conflict; chạy lint, typecheck, build và các test SET-002 liên quan. Chưa thực hiện bước tích hợp này, không báo PASS.

## Kết quả và lỗi còn mở

Baseline kế thừa từ báo cáo trước: 90 files **686 PASS / 0 FAIL / 1 SKIP**; không chạy lại đợt này, không coi đây là số acceptance mới. Theme 8/8 và 18/18, npm ci/typecheck/build, backup/restore 58/58 là bằng chứng đợt trước, không chạy lại hoặc gắn timestamp mới.

Các lỗi mở thực tế:

1. P1 ACC: secret quá hạn dưới background throttling/pause — tái hiện bằng browser thật, Anty sửa frontend; Codex nghiệm thu lại.
2. FIN test harness thiếu API DOM và phụ thuộc scheduling — tái hiện riêng, Anty sửa tests/web/helper.
3. Lint: bốn lỗi any — WAITING_FOR_ANTY, chưa có SHA mới.
4. Legacy ISSUES SKIP và các release gate cũ vẫn giữ nguyên; không mở rộng thành nghiệm thu 123/123 hoặc Full E2E.

**QA_HOLD / RELEASE_HOLD.** Không đổi credential, Owner thật, database vận hành, Google Drive thật, main hoặc Windows. Không merge/push/deploy. QA synthetic chỉ có fixture ACC và session phát sinh đúng phạm vi; không truncate/delete dữ liệu hoặc chạy migration đợt này.

## Evidence

`/Users/duongbinh/.codex/audits/management-lite-set002-retest-20261012/followup-5435319/`:

- `acc-timing.mjs`, `acc-foreground-timeline.json`, `acc-background-timeline.json`, `acc-frozen-timeline.json`
- Các `acc-*-results.json`, trace command chỉ gồm method/time, không có request params
- `prior-acc-evidence.json` (mtime và kết quả cũ, không coi mtime là reveal time)
- `fin-timer-observe.mjs`, `fin-normal.log`, `fin-slow-flush.log`, `fin-*-trace.jsonl`, `fin-*-result.json`
- `diagnosis-summary.json` gồm SHA256 artifacts

Không đưa runtime private config hoặc giá trị credential vào Git/báo cáo.
