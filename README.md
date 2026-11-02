# Management Lite (`management-lite`)

> **Phiên bản mã nguồn (Repository Version):** `v0.7.2` (`bcdb36c` trên `main`)
> **Chuẩn quản trị:** Universal AI Project Governance V1 + `REMEDIATION_FREEZE` (`AGENTS.md §0`)
> **Điểm vào bắt buộc cho AI Agent:** Đọc [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) và [`AGENTS.md`](./AGENTS.md) trước tiên.

---

## 1. Giới Thiệu Dự Án

**Management Lite** là hệ thống quản trị vận hành nội bộ hợp nhất cho **Hoài Phương Media**, được thiết kế theo kiến trúc **Dual UI (Desktop & Mobile `320px–430px`, Light/Dark AA)**, phân quyền nhân sự 3 cấp (**Nhân viên `staff` / Quản lý phụ `admin` với 6 nhóm quyền phụ ủy quyền / Chủ sở hữu `owner`**) và bao gồm 7 phân hệ điều hướng chính:

1. **Tổng quan (`/dashboard`):** Trung tâm Việc cần xử lý (`Action Center`), chỉ số KPI vận hành, cảnh báo lỗi hệ thống chủ động (dành cho Owner) và bảng liên thông sản lượng với hệ thống `tiktok-ai-factory-v4`.
2. **Công việc (`/work`, `/reports`):** Giao việc theo mẫu nhân sự Media (`Dựng Video`, `Viết Kịch bản`, `Đăng bài & Chăm sóc kênh`, `Thiết kế Ảnh/Thumbnail`), lọc thông minh, xem bằng chứng nghiệm thu và báo cáo công việc hằng ngày (ủy quyền qua `work:manage`).
3. **Chấm công (`/clock`, `/attendance`, `/schedule`):** Vào/ra ca, xem bảng công gom theo từng nhân viên và từng tháng (`employee-month-selector`), duyệt nhanh ca chờ 1-chạm (`attendance:review`), đóng ca treo giúp nhân viên, xuất CSV tổng hợp công và quản lý lịch trực tuần (`UNNEST` batching).
4. **Nhân sự (`/employees`, `/payroll`, `/payroll/stats`, `/my-pay`):** Hồ sơ nhân sự mở rộng (SĐT, CCCD, Ngày sinh `dd/mm/yyyy`, 35 ngân hàng Napas), phân quyền 3 cấp (`staff / admin / owner` + 6 quyền phụ chi tiết `sub_permissions`, nút **Phân quyền / Sửa** 1-chạm), tính lương tự động (`Thưởng +`, `Phụ cấp +`, `Khấu trừ -`, `Nghỉ phép hưởng lương +`), sinh mã chuyển khoản `VietQR` và xuất/nhập bảng công Excel (`employees:manage`, `payroll:manage`).
5. **Tài khoản (`/accounts`):** Hệ sinh thái quản lý tài khoản dùng chung 4 tầng (`SĐT/SIM ➔ Gmail gốc ➔ TikTok / Facebook / YouTube` + `Google Authenticator` + `Tài khoản Khôi phục`), tra cứu 2 chiều 360°, sinh mã 6 số 2FA (`TOTP`) trực tiếp, lưu lịch sử mật khẩu cũ mã hóa `AES-256-GCM` (`C05 Secret Vault` + `reauth`, ủy quyền qua `accounts:manage`).
6. **Thu chi (`/finance`, `/storage`):** Sổ thu chi nội bộ (tự động đồng bộ phiếu chi lương từ `/payroll`, đính kèm hóa đơn, ủy quyền qua `finance:manage`) và kho lưu trữ liên kết Google Drive OAuth 2.0 (`/storage`).
7. **Quản trị (`/issues`, `/system-logs`, `/settings`):** Sổ tay lỗi tích hợp phân tích AI, chuyển lỗi từ nhật ký hệ thống sang phiếu lỗi kèm gói lệnh `AI Fix Prompt` 1-chạm, duyệt đóng hàng loạt (`Bulk Confirm`), và quản lý phiên bản/giao diện.

---

## 2. Phân Biệt 4 Môi Trường & Cổng Phát Hành (`DEV / TEST / STAGING / PRODUCTION`)

| Môi trường                                     | Đường dẫn / Cổng cô lập                                                                                                                               | Quy tắc bắt buộc                                                                                                                                                                                                                                  |
| :--------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **DEV (Worktree Phát triển)**                  | Nhánh/worktree riêng tách từ `main` (`v0.7.2`); chạy cục bộ qua `npm run dev:api` + `npm run dev:web`.                                                | Mọi thay đổi phải thực hiện trên nhánh/worktree riêng, có Task ID, bằng chứng kiểm thử (`PASS`) và phê duyệt của Owner (`APPROVED`).                                                                                                              |
| **TEST (Cụm PostgreSQL Cô lập `:55433`)**      | `C:\ML-Test` (`scripts/test-env/Manage-TestEnv.ps1` & `scripts/test-env/run-with-isolated-qa-stack.mjs`, cổng DB `:55433`, API `:3101`, Web `:3102`). | Khóa bảo vệ Fail-Closed (`OA-21` — `guard.ts` chặn mọi bài test chạm vào cổng `:55432`). Xem [`docs/remediation/TEST-ENV.md`](./docs/remediation/TEST-ENV.md).                                                                                    |
| **STAGING (Cụm Thử nghiệm Cô lập `:55434`)**   | `C:\HoaiPhuong-Staging` (`scripts/staging/Manage-StagingEnv.ps1`, cổng DB `:55434`, Web `:4000`, API `:4001`).                                        | Hoàn toàn tách biệt khỏi dịch vụ, thư mục và cơ sở dữ liệu Production. Xem [`docs/deployment/STAGING-ISOLATION-RUNBOOK.md`](./docs/deployment/STAGING-ISOLATION-RUNBOOK.md).                                                                      |
| **PRODUCTION (`https://ql.hoaiphuong.click`)** | Máy chủ Windows (`C:\HoaiPhuong-Server\apps\management-lite`, DB `:55432`, Web `:3000`, API `:3001`), khóa bởi **`REMEDIATION_FREEZE` (`§0`)**.       | **CẤM AI tự deploy hoặc ghi vào `C:\HoaiPhuong-Server\` (`AGENTS.md §0`).** Chỉ phát hành qua **Owner-Locked Release Gate** (`Sign-Release-Owner.ps1`) do chính Owner ký và chạy theo [`docs/deployment/OWNER-RELEASE-RUNBOOK.md`](./docs/deployment/OWNER-RELEASE-RUNBOOK.md). |

---

## 3. Cấu Trúc Monorepo & Lệnh Phát Triển

```text
management-lite/
├── PROJECT_STATUS.md                # Điểm vào trạng thái dự án (Governance V1 Entry Point)
├── AGENTS.md                        # §0 REMEDIATION_FREEZE, LIVE_CHECKPOINT, PHASE_TASK_TRACKER & MODULE_FILE_MAP
├── README.md                        # Tài liệu tổng quan & hướng dẫn vận hành 4 môi trường
├── docs/
│   ├── PHASE_TASK_HISTORY.md        # Sổ cái 36 Phases / 103 Tasks (13 trường chuẩn)
│   ├── ROADMAP.md                   # Lộ trình phát triển & các hạng mục chờ duyệt
│   ├── DECISIONS.md                 # Hồ sơ quyết định kiến trúc (ADR-001..ADR-007)
│   ├── deployment/                  # OWNER-RELEASE-RUNBOOK.md & STAGING-ISOLATION-RUNBOOK.md
│   ├── remediation/                 # Chính sách P0-A..P0-E, TEST-ENV.md, báo cáo OA-20/W2A/W2B & evidence/
│   ├── plans/                       # Kế hoạch kỹ thuật chi tiết các Phase lớn
│   ├── canonical/                   # 59 tài liệu đặc tả nền tảng (0.1.0-doc.21, SHA-256 verified)
│   ├── handoff/                     # Báo cáo nghiệm thu & bàn giao lịch sử
│   └── reports/                     # Báo cáo kiểm toán & xử lý sự cố
├── packages/
│   ├── contracts/                   # Shared TypeScript contracts, 3-tier RBAC sub_permissions & version catalog
│   ├── database/                    # PostgreSQL 18 pool, fail-closed test guard & 32 migrations (0001..0032)
│   └── ui/                          # Design tokens (Light/Dark AA), Icons & shared components
├── apps/
│   ├── api/                         # Backend HTTP server (RouteTable O(1), 3-tier guard, services, security)
│   └── web/                         # React 18 + Vite SPA (route-level React.lazy, responsive cards)
├── scripts/                         # Build info, bundle budget, UI audit, governance, test-env, staging & ops scripts
└── tests/                           # Bộ kiểm thử foundation, security, database, backend, web (71/71 isolated PASS)
```

### Các lệnh kiểm tra & phát triển chuẩn (`Node.js 22.14.0`, `npm 10.9.2`):
- **Kiểm tra định dạng, lint, typecheck & test tổng thể:** `npm run verify`
- **Kiểm thử toàn bộ trên cụm PostgreSQL TEST cô lập (`:55433`):** `npm run test:isolated`
- **Kiểm thử giao diện Web (`tests/web`):** `npm run test:web`
- **Kiểm thử bảo mật (`tests/security`):** `npm run test:security`
- **Kiểm thử Backend (`tests/backend`):** `npm run test:backend`
- **Kiểm toán UI/UX tự động (144 kịch bản Playwright + Axe):** `npm run audit:ui`
- **Kiểm tra ngân sách dung lượng gói Web (`<= 450 kB raw / <= 130 kB gzip`):** `npm run check:bundle`
- **Xác minh toàn vẹn 59 tài liệu Canonical (`SHA-256`):** `npm run canonical:verify`

---

## 4. Liên Kết Tài Liệu Quản Trị Dự Án

- **Trạng thái hiện tại:** [`PROJECT_STATUS.md`](./PROJECT_STATUS.md)
- **Quy tắc bất biến Production (`§0`), Checkpoint & Bản đồ File:** [`AGENTS.md`](./AGENTS.md)
- **Lịch sử Phase & Task (13 trường chuẩn):** [`docs/PHASE_TASK_HISTORY.md`](./docs/PHASE_TASK_HISTORY.md)
- **Lộ trình & Hạng mục chờ duyệt:** [`docs/ROADMAP.md`](./docs/ROADMAP.md)
- **Quyết định Kiến trúc (ADR):** [`docs/DECISIONS.md`](./docs/DECISIONS.md)
- **Quy trình phát hành Production (Owner-Locked Gate):** [`docs/deployment/OWNER-RELEASE-RUNBOOK.md`](./docs/deployment/OWNER-RELEASE-RUNBOOK.md)
- **Quy trình vận hành Staging cô lập:** [`docs/deployment/STAGING-ISOLATION-RUNBOOK.md`](./docs/deployment/STAGING-ISOLATION-RUNBOOK.md)
- **Hồ sơ Kiểm toán & Khắc phục P0 (`W1–W2B`, `OA-20..23`):** [`docs/remediation/README.md`](./docs/remediation/README.md)
