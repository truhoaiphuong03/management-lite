# PROJECT STATUS — `management-lite`

> **Điểm vào đầu tiên (Entry Point):** Mọi AI (`ChatGPT`, `Antigravity`, `Codex`) bắt buộc đọc file này và [`AGENTS.md`](./AGENTS.md) (đặc biệt mục **`⛔ 0. QUY TẮC BẤT BIẾN VỀ PRODUCTION / REMEDIATION_FREEZE`**) trước khi thực hiện bất kỳ thao tác nào. Tuyệt đối tuân thủ **Universal AI Project Governance V1** (`Zero-Recheck Rule`).

| Thuộc tính                                       | Giá trị hiện tại                                                                                                                                                                                                                                                                  |
| :----------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project ID**                                   | `management-lite`                                                                                                                                                                                                                                                                 |
| **Phiên bản mã nguồn (Repo Version)**            | `v0.7.2` (`package.json` & `packages/contracts/src/version.ts`, tag `v0.7.2`, commit `bcdb36c`)                                                                                                                                                                                   |
| **Phiên bản Production (`ql.hoaiphuong.click`)** | `v0.7.0` (`8ee37a2`, kèm `DRIFT` 219 file dist trước khi khóa `OA-20` — theo [`docs/remediation/evidence/W1.5-prod-provenance-baseline.json`](./docs/remediation/evidence/W1.5-prod-provenance-baseline.json); **chưa** nhận `v0.7.2`, đang khóa bảo vệ bởi `REMEDIATION_FREEZE`) |
| **Repository**                                   | `https://github.com/truhoaiphuong03/management-lite` _(Private)_                                                                                                                                                                                                                  |
| **Nhánh chuẩn (Default Branch)**                 | `main` (Baseline HEAD: `bcdb36c4af3888e3b1a0919d704a600d44b36248` / `bcdb36c`)                                                                                                                                                                                                    |
| **Nhánh hiện tại (Active Branch)**               | `docs/governance-management-lite-v1` _(tách trực tiếp từ `origin/main` @ `bcdb36c`)_                                                                                                                                                                                              |
| **Trạng thái tổng thể**                          | `PASS` _(35 Phases / 95 Tasks sản phẩm & remediation đã `DONE` trên `main`; `GOV-08.1.1..08.1.5` `DONE`, `GOV-08.1.6..08.1.8` đạt `PASS`, chờ Owner `APPROVED`)_                                                                                                                  |
| **Phase hiện tại**                               | `Phase GOV-08.1 — Chuẩn hóa & Đồng bộ Tài liệu Quản trị Dự án lên HEAD v0.7.2 (Universal AI Project Governance V1)`                                                                                                                                                               |
| **Cổng phát hành & Khóa Production**             | **KHÓA BỞI `REMEDIATION_FREEZE` (`AGENTS.md §0`) & `Owner-Locked Release Gate`** ([`docs/deployment/OWNER-RELEASE-RUNBOOK.md`](./docs/deployment/OWNER-RELEASE-RUNBOOK.md)). AI tuyệt đối không tự deploy, không ghi vào `C:\HoaiPhuong-Server\` hoặc PostgreSQL `:55432`.        |
| **`NEXT_ACTION`**                                | **Dừng chờ Owner nghiệm thu (`APPROVED`) nhánh `docs/governance-management-lite-v1` (`GOV-08.1`). Không tự merge vào `main`, không sửa code và không tác động Production.**                                                                                                       |

---

## 1. Tóm Tắt Tiến Độ & Phân Loại Bằng Chứng (`Phase 0` → `Phase 32`, `Phase REM`, `Phase GOV-08.1`)

- **Tổng số Phase đã ghi nhận:** `36` Phase (`35` Phase sản phẩm & remediation trên `main`: `Phase 0` Foundation `PK-00..v0.1.3`, `Phase 1` → `Phase 32`, cụm `Phase UI-0 → UI-5`, `Phase REM` Waves `W1–W2B`; cùng `1` Phase quản trị `Phase GOV-08.1`).
- **Tổng số Task định danh duy nhất:** `103` Task (`95` Task sản phẩm & remediation `P00-T01` → `P32-T02`, `PREM-T01` → `PREM-T06` + `8` Task quản trị `GOV-08.1.1` → `GOV-08.1.8`).
  - **`VERIFIED` (`101/103` Tasks):** Đã xác minh trực tiếp bằng commit SHA, git tag (`v0.1.4` → `v0.7.2`), migration SQL (`0001` → `0032`), bằng chứng kiểm toán `docs/remediation/evidence/*` và bộ test cô lập (`71/71 PASS` trên `:55433`).
  - **`REPORTED` (`2/103` Tasks — `P01-T02`, `P08-T01`):** Phần code trong repo đã `VERIFIED`, riêng thao tác cấu hình file môi trường máy chủ `C:\HoaiPhuong-Server\config\test-secrets\api.env` nằm ngoài Git nên được ghi nhận theo báo cáo phiên (`REPORTED`).
  - **Quy tắc nhãn `Approval` (Chuẩn Governance V1):** Git tag (`v0.1.4` → `v0.7.2`) hoặc PR/merge commit trên `main` là bằng chứng kỹ thuật (`DONE` — khóa bảo vệ theo `Zero-Recheck Rule`), **không thay thế** bằng chứng phê duyệt tường minh của Owner (`APPROVED`). Do đó cột `Approval` của 95 Task lịch sử trên `main` được ghi trung thực là `UNRECORDED_ON_GIT (Git tag/PR không thay thế Owner APPROVED; khóa Zero-Recheck)`.

---

## 2. Các Mâu Thuẫn Tài Liệu Đã Được Ghi Nhận & Điều Hòa (`GOV-08.1.4` & `GOV-08.1.6`)

1. **Đồng bộ 11 commit mới trên `origin/main` (`d5693ef` → `bcdb36c`, `v0.7.1` → `v0.7.2`):** Nhánh `docs/governance-management-lite-v1` (ở `04284c9`, tách từ `d5693ef`) đã được tái tạo trực tiếp từ `origin/main` (`bcdb36c`), bảo toàn nguyên vẹn 100% khối `<!-- REMEDIATION_FREEZE_START --> ... <!-- REMEDIATION_FREEZE_END -->` (`§0`), cập nhật đầy đủ `Phase REM` (`W1`, `W2A`, `OA-20`, `OA-21`, `OA-23`, `W2B`) và `Phase 32` (`v0.7.2` — vai trò `admin` & 6 quyền phụ `sub_permissions`).
2. **Bảo toàn tuyệt đối `REMEDIATION_FREEZE` & Vô hiệu hóa Auto-Deploy Legacy (`OA-20`):** Mục `§0` và `§4` trong `AGENTS.md` cùng [`docs/remediation/OA20_ACCEPTANCE_REPORT.md`](./docs/remediation/OA20_ACCEPTANCE_REPORT.md) đã khóa fail-closed (`exit 43`) cơ chế tự deploy của `anty-remote-hub` và cấm mọi AI ghi vào `C:\HoaiPhuong-Server\` hoặc PostgreSQL `:55432`.
3. **Truy vết thực tế Production (`W1.5` & `W2B`):** Thay vì suy đoán từ tài liệu cũ, trạng thái Production được dẫn chiếu trực tiếp từ bằng chứng chỉ đọc [`docs/remediation/evidence/W1.5-prod-provenance-baseline.json`](./docs/remediation/evidence/W1.5-prod-provenance-baseline.json) và [`docs/remediation/evidence/W2B-prod-fingerprint-after.json`](./docs/remediation/evidence/W2B-prod-fingerprint-after.json) (`release-version.json` ở `v0.7.0` / `8ee37a2`, 0 thay đổi trong suốt đợt Remediation `W1–W2B`).
4. **Chuẩn hóa mã Task trong `AGENTS.md`:** Khử trùng lặp `Task 10.0` (gốc: `10.1`) với `Task 10.1–10.3`, cập nhật `Task 31.1–31.2`, và bổ sung dòng `Remediation Waves (W1–W2B)` cùng `Phase 32 (v0.7.2)` vào bảng `PHASE_TASK_TRACKER` khớp với `LIVE_CHECKPOINT`.
5. **Tách bạch `DONE` (Git tag/PR) với `APPROVED` (Owner phê duyệt):** Rà soát lại toàn bộ sổ cái [`docs/PHASE_TASK_HISTORY.md`](./docs/PHASE_TASK_HISTORY.md), không dùng Git tag hay PR để gán nhãn `APPROVED` khi chưa có bản ghi Owner phê duyệt riêng.

---

## 3. Liên Kết Bộ 6 Tài Liệu Quản Trị Cốt Lõi

1. **Điểm vào trạng thái:** [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) _(file này)_
2. **Quy tắc bất biến Production (`§0`), Checkpoint sống & Bản đồ file (`MODULE_FILE_MAP`):** [`AGENTS.md`](./AGENTS.md)
3. **Tổng quan dự án, cài đặt & phân biệt môi trường:** [`README.md`](./README.md)
4. **Sổ cái lịch sử Phase/Task (13 trường chuẩn & phân loại bằng chứng):** [`docs/PHASE_TASK_HISTORY.md`](./docs/PHASE_TASK_HISTORY.md)
5. **Lộ trình các Phase & Hạng mục chờ duyệt:** [`docs/ROADMAP.md`](./docs/ROADMAP.md)
6. **Quyết định kiến trúc (ADR):** [`docs/DECISIONS.md`](./docs/DECISIONS.md)
   - _Tài liệu vận hành & kiểm toán bảo toàn nguyên trạng:_ [`docs/remediation/`](./docs/remediation/), [`docs/deployment/OWNER-RELEASE-RUNBOOK.md`](./docs/deployment/OWNER-RELEASE-RUNBOOK.md), [`docs/deployment/STAGING-ISOLATION-RUNBOOK.md`](./docs/deployment/STAGING-ISOLATION-RUNBOOK.md), [`docs/plans/`](./docs/plans/), [`docs/canonical/`](./docs/canonical/), [`docs/handoff/`](./docs/handoff/), [`docs/reports/`](./docs/reports/).
