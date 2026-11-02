# MANAGEMENT-LITE — GITHUB / WINDOWS RELEASE REPORT

**Trạng thái cuối: `RELEASE_HOLD`** (code đã push lên **nhánh kiểm thử**; không gắn production-ready, không triển khai Windows).

## 1. Repository / branch

- `https://github.com/truhoaiphuong03/management-lite.git`. Hai thư mục `management-lite` và `management-lite-ui-report` là **hai worktree của cùng một repo**.
- Localhost 3017/3018 chạy từ worktree `management-lite-ui-report` (branch `feat/ui-report-01-mvp`). Worktree `management-lite` (`feat/v0.2-file-web`) không chứa code FIN/UI mới.
- Nhánh push: `test/management-lite-fin-ui-20261012` (nhánh mới, không force-push, không ghi đè lịch sử).

## 2–3. Commit SHA và file thay đổi

- Trước: `ab7500c` (= `origin/feat/v0.2-unified-staging`). Sau: **`e1b821d9c86ff29afab244920df4d5b21ba8aff9`**, xác minh bằng `git ls-remote`.
- 183 file, +46.779/−1.541: module FIN (API, web, contracts), migration 0014–0016, `ActionIconButton`/`Pagination`/`ListFooter`, các màn Employees/Reports/Audit/Issues/Clock, test, script QA.
- Loại khỏi commit: `.env*`, dữ liệu biên lai, `*.log`, `*.png`, `*.patch`, thư mục con và ảnh trong `docs/handoff`. 18 mục chưa commit còn lại chỉ là các file đã loại này.
- Secret scan: phát hiện **mật khẩu DB hardcode** trong `scripts/seed-fin-categories.mjs` (kèm fallback sang DB live). Đã gỡ trước khi commit, giờ bắt buộc `DATABASE_URL`. Quét lại phần diff staged cho 0 kết quả.
- **Mật khẩu này đã từng nằm trong file local; nên xoay (đổi) mật khẩu `mglite_test_role` — Owner quyết.**
- Các báo cáo cũ có kết luận PASS (FINAL-ACCEPTANCE, FULL-AUDIT-LOG, FUNCTION-INVENTORY, OVERNIGHT, LOCALHOST-FULL-COMPLETION) đã gắn banner "thu hồi" trước khi commit.

## 4. Lỗi đã xử lý

- 3 fail phân trang FIN Kế hoạch: **không phải lỗi sản phẩm**. Script reset QA không chạy seed kế hoạch (12 khoản chi + 1 thu). Sau khi seed, chạy lại Chrome pagination QA trên DB cô lập `fin_qa_redesign` → **36/36 PASS**.
- Mật khẩu hardcode (xem mục 2–3).

## 5. Kết quả test (đợt chạy gần nhất, DB cô lập, repo đúng)

- `tsc --noEmit` sạch; `eslint .` rc=0, không lỗi (build `tsc` đã chạy ở phiên trước).
- foundation 4/4, security 13/13, web 242/243 (1 skip), database 31/35 (4 skip), backend 303/307 (3 fail, 1 skip). Chrome QA FIN: pagination 36/36, all-screens 30/30, plan 28/28.
- Sau đó chỉ sửa một script seed; chưa chạy lại toàn bộ suite sau thay đổi này (không ảnh hưởng runtime).
- `prettier --check`: **215 file chưa đúng format** (đã tồn tại sẵn, chưa chạy `--write` để không tạo diff khổng lồ).

## 6. Còn FAIL/SKIP/HOLD

- 3 fail `recover-owner-access` (script chỉ chạy trên DB live; test hardcode `credential_version=25`, thực tế 29) → test chưa chạy được an toàn, cần sửa thiết kế test.
- 4 test FIN-DB + `finance-endpoint` skip (cần cluster/cổng riêng); web ISSUES-FIX-03 skip.
- **Chưa làm:** icon + phân trang cho Work, Schedule, Payroll, Storage, Accounts. Cần thêm API phân trang backend, thay đổi hợp đồng API, không thể làm an toàn trong lượt này.
- Bảng 88 chức năng chưa dựng lại. Chưa xác minh bảo mật Owner/Staff bằng test mới ngoài suite security 13/13.
- Mọi điều này là blocker nghiệm thu, không phải xử lý bằng cách bỏ test.

## 7–9. Tag / push / Actions

- Không tạo release tag (chưa đạt tiêu chí). Push thành công (xem mục 2–3). Repo có `.github/workflows/foundation.yml`; **chưa kiểm tra kết quả Actions** (chưa có quyền xem từ đây).

## 10–14. Windows Server — HOLD

Không có thông tin máy đích, phương thức truy cập, đường dẫn/dịch vụ/DB Windows, backup và diễn tập khôi phục Windows. Không suy đoán. Không có thay đổi nào trên Windows, DNS, SSL, Cloudflare hay `hoaiphuong.click`. Không sao chép DB Mac. Vì vậy các mục commit đang chạy trên Windows, backup, rollback, healthcheck và đối chiếu dữ liệu Windows: **không thực hiện**.

- Mac localhost vẫn ổn định: API 3018 và web 3017 trả 200, không restart.

## 15. Rollback (khi triển khai sau này)

Code: checkout lại commit Windows hiện tại đã ghi nhận. Không restore DB cũ đè dữ liệu mới. Migration 0014–0016 chỉ thêm bảng/cột FIN, cần backup trước khi áp dụng.

## 16. Kết luận

`RELEASE_HOLD`. Điều kiện để mở: hoàn thiện 5 màn còn thiếu icon/phân trang, giải quyết test fail/skip, Actions xanh, và Owner cấp thông tin Windows.
