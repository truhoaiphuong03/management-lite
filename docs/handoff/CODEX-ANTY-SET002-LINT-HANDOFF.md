# Giao Anty: SET-002 lint và harness frontend

Trạng thái: OPEN. Codex không sửa frontend.

Nguồn: `fix/anty-codex-findings-remediation`, commit `b6b16fd65dad23d6bb5df8f00226b76c7707c179`.
Anty tạo branch sửa riêng từ commit này, giữ nguyên branch nguồn và gửi SHA mới để Codex kiểm tra tập trung.

## Bốn lỗi lint cần sửa

Lệnh tái hiện: `npm run lint` sau `npm ci`, Node 22.14.0 / npm 10.9.2.

| File | Dòng:cột | Rule |
|---|---|---|
| apps/web/src/screens/SettingsScreen.tsx | 34:44 | @typescript-eslint/no-explicit-any |
| apps/web/src/screens/SettingsScreen.tsx | 35:28 | @typescript-eslint/no-explicit-any |
| apps/web/src/screens/SettingsScreen.tsx | 99:32 | @typescript-eslint/no-explicit-any |
| apps/web/src/screens/SettingsScreen.tsx | 100:16 | @typescript-eslint/no-explicit-any |

Nguyên nhân: ép `MediaQueryList` sang `any` ở fallback `removeListener`/`addListener`. Dùng API đã có kiểu hoặc khai báo interface fallback cụ thể; không tắt rule. Giữ nguyên cleanup và tương thích fallback.

Kiểm thử theme thực tế đã đạt: System đổi hai chiều không reload, manual override, reload persistence, không tích lũy listener và gọi cleanup gỡ listener. Không thay đổi behavior chỉ để lint đạt.

## Test FIN chưa ổn định

`tests/web/finance-categories-mounted.test.mjs`: khi chạy song song, timeout focus trong AppDialog gọi `container.querySelectorAll` nhưng fake DOM chưa cung cấp API này; lỗi đầu kéo theo hai lỗi sau. Chạy riêng đạt 4/4. Anty rà soát fake DOM hoặc chuyển kiểm thử dialog sang DOM đầy đủ; không bỏ assertion, không sửa production component chỉ để test xanh. Đây là rủi ro harness đã tái hiện, không kết luận lỗi trình duyệt thực từ fake DOM.

Không merge, push hoặc deploy trong bàn giao này. Production RELEASE_HOLD.

## Bổ sung sau kiểm tra tập trung ngày 12/10/2026

**ACC P1 — cần Anty sửa trên branch riêng:** background thật tại 31,003 giây vẫn có secret trong DOM, countdown 15s, chỉ 15 callback; renderer pause 2,2 giây rồi resume tại 31,005 giây còn secret và countdown 1s. Source AccountsScreen.tsx:251 đếm callback thay vì deadline. Sửa expiry theo thời gian thực và xử lý hidden/resume đúng contract; không nới timeout test. Xem `CODEX-QA-FOLLOWUP-ACC-FIN.md` và evidence browser tương ứng.

**FIN nguyên nhân đã tái hiện:** callback focus 30 ms chạy sau 31 ms, FakeElement thiếu querySelectorAll/closest/contains. Chạy riêng 4/4; một test riêng với mô hình flush chậm tái hiện TypeError. Sửa harness frontend, cô lập mock/state và luôn cleanup bằng finally; không bỏ assertion hoặc sửa UI sản phẩm để né test.

Lint vẫn WAITING_FOR_ANTY: branch nguồn chưa có commit sau b6b16fd. Gửi SHA và danh sách file khi bàn giao; Codex sẽ tích hợp QA riêng, chạy kiểm tra tập trung.
