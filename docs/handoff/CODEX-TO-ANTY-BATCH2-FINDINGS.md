# CODEX → ANTY: Batch2 independent findings

Ngày: 2026-10-12, MacBook. Snapshot frontend được kiểm thử: `121612a4abf5c05f2ecfb5b5136ca3170c3dc557`; Batch1: `76e2aec8d3a2e62448dc07ac1796962591768ca2`.
Backend giữ nguyên endpoint/request/response. Đây là yêu cầu bàn giao trong repo, chưa có xác nhận Anty đã đọc. Codex không sửa frontend, tests/web hoặc tài liệu ANTY.

## P1 REP-003 / REP-006: trắng trang Báo cáo

Đăng nhập Owner QA → mở `/reports` → trang không có heading/table/pager. Console: `Rendered more hooks than during the previous render`. `ReportsScreen.tsx` có early return khi loading trước `useMemo` của pagedReports (khoảng dòng680–700 ở121612a). Batch2 chỉ thêm testid vào revision modal, chưa sửa thứ tự hook. Giữ hook chạy cùng thứ tự ở mọi render; sau sửa chạy lại tạo/nộp/revise/lịch sử và filter/pager. Hiện revision UI NOT TESTED vì lỗi load; backend revision/If-Match/immutable history đã chạy.

## P2 ACC-004: detail reveal không mở modal

Owner → Accounts → mở chi tiết một account → bấm Xem mật khẩu → không có form reauth/modal. Đường list hoạt động và auto-hide30giây đã PASS. Early detail return chứa nút setShowRevealModal, nhưng modal JSX chỉ nằm ở list return. Yêu cầu dùng cùng modal render cho detail, giữ nguyên step-up/RBAC backend.

## P2 SET-002: theme chỉ lưu preference

Owner → Settings → chọn giao diện sáng → reload giữ lựa chọn, nhưng computed root/body background và colorScheme không đổi. Hiện persistence PASS, visual theme FAIL. Áp dụng lựa chọn theme hiện có; không mở rộng sang chức năng đổi tiền tệ hoặc timezone nghiệp vụ.

## ATT-007: sửa ví dụ contract, không đổi endpoint

`ANTY-API-REQUIREMENTS.md` mục2.1 ghi `decision: approved/rejected`, `reviewer_notes`. Backend C01 và ClockScreen thực tế dùng `decision: accept/reject`, `reason`, và khi accept cần `clock_out_at`. Test thực gửi ví dụ tài liệu trả400, pending/version không đổi; payload đúng trả200. Đề nghị Anty sửa tài liệu cho khớp contract hiện có, không yêu cầu Codex đổi API âm thầm.

## FILE-004: provider thật chưa được xác minh

Mock state machine/readiness/trash tests PASS không chứng minh Google Drive thật. Cần thống nhất adapter/sandbox và quyền thử nghiệm riêng trước khi nghiệm thu provider. Hiện BLOCKED, không chỉ thiếu nút UI.

## Build/lock: điều kiện tích hợp

Fresh npm ci thất bại vì lock thiếu sharp; npm install không ghi lock cho phép chạy QA. Typecheck/build chuẩn TS2742 tại `apps/web/src/finance/ui.tsx:342`; backend compiler riêng và lint PASS. Đề nghị người phụ trách frontend/release sửa type annotation và reconcile lock, rồi npm ci/typecheck/build lại. Không dùng declaration=false QA emission làm bằng chứng production build PASS.

## Bằng chứng

- Chrome121612a: `browser-bound-anty-settings-results.json`20PASS2FAIL; `anty-rep-browser-results.json`1PASS1assertionFAIL, thêm1harness abort.
- Focused Browser:10PASS (Staff correction→API→DB1pending; payslip; Owner dashboard).
- Session expiry Browser:2PASS (login, expiry→/login).
- Đường dẫn evidence: `/Users/duongbinh/.codex/audits/management-lite-batch2-independent-20261012`.

Sau mỗi bản sửa, cung cấp SHA mới; Codex kiểm thử trong worktree kiểm toán riêng, không cherry-pick vào branch backend.
