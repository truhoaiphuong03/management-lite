# Kế hoạch chuẩn hóa UI/UX toàn hệ thống — `management-lite` (v0.3.2 → v0.4.x)

> Nguồn: rà soát tĩnh mã nguồn (31/10/2026) theo `web-design-guidelines` (Vercel) + quy tắc Dual UI. **Chưa có ảnh chụp màn hình thật** (repo không có Playwright/Puppeteer) — Phase 0 bổ sung bước chụp thật để xác nhận.
> Mọi việc chỉ trên DEV/SANDBOX; không đụng Production. Chưa code gì — chờ Owner duyệt.

## A. Kết quả kiểm tra

### Số liệu
| Chỉ số | Kết quả | Đánh giá |
|---|---|---|
| Màu hex cứng trong screens | ≈1.500 chỗ (Payroll 304, Storage 272, Accounts 235, Reports 175, Settings 168, Work 165, IssueDetail 162…) | ❌ |
| Dùng `var(--…)` trong screens | chỉ 15 chỗ | ❌ |
| `style={{}}` inline | Payroll 303, Storage 270, Accounts 217, Work 169, IssueDetail 167 | ⚠️ khó bảo trì |
| File quá lớn | Payroll 5.693 dòng, Storage 4.825, Accounts 3.677, Work 3.052 | ⚠️ |
| Chữ cỡ < 12px | 82 chỗ (+ ~150 chỗ đúng 12px) | ⚠️ khó đọc trên điện thoại |
| `<input/select/textarea>` / `aria-label` | ~190 control, rất ít nhãn aria (Storage 29 control / 0 aria) | ⚠️ |
| `...` thay vì `…` trong chữ hiển thị | ~130 chỗ | 🔹 |
| `transition: all` | `tokens.css:384`, `WorkScreen.tsx:2513` | 🔹 |
| `outline: none` inline | ~75 chỗ | ✅ không lỗi: `tokens.css:263-271` ép `outline … !important` cho focus-visible |
| `<div onClick>` | 0 | ✅ |
| Viewport / safe-area / `touch-action` / reduced-motion | Có | ✅ |
| Bảng bọc `overflowX` | Có đủ ở 7 màn hình bảng | ✅ |

### Lỗi/vấn đề cụ thể
| # | Mức | Thiết bị | Vấn đề | Vị trí |
|---|---|---|---|---|
| U1 | 🔴 Cao | Tất cả | **Giao diện sáng (Light) không dùng được**: Cài đặt cho chọn Sáng nhưng ~1.500 màu cứng tối (`#151F30`, `#F8FAFC`…) → chữ trắng trên nền trắng/khối tối lẫn lộn. Hiện chỉ vá `h1–h4` bằng `!important`. | `tokens.css:236-262, 452-462`; toàn bộ `screens/*` |
| U2 | 🔴 Cao | Desktop | `DesktopSidebar` luôn tối (hex cứng), không theo theme | `Navigation.tsx:213-352` |
| U3 | 🔴 Cao | Điện thoại | Nút thanh đáy **mất tên truy cập**: trên ≤768px nhãn đầy đủ bị `display:none`, nhãn ngắn lại `aria-hidden` → screen reader không đọc được | `Navigation.tsx:435-509`, `tokens.css:407-413` |
| U4 | 🟠 TB | Tất cả | Token **không tồn tại**: `--font-sans`, `--surface-subtle-color`, `--brand-color` → date input mất font, subnav luôn tối/xanh cứng ở light | `tokens.css:316,361,393` |
| U5 | 🟠 TB | Điện thoại | Nhãn đáy 10–10.5px, nhiều chữ 9–11px trong thẻ/badge | `Navigation.tsx:479,496`; Payroll/Accounts/Dashboard |
| U6 | 🟠 TB | Điện thoại | Bảng (Payroll ×2, Accounts, Reports, SystemLogs ×2, PayrollStats ×2) chỉ cuộn ngang, chưa có dạng thẻ như `/storage` (ngoại trừ Storage) | các `<table` |
| U7 | 🟠 TB | Điện thoại | `FinanceHistoryScreen` lưới cố định `96px / 140px+ / 120px+ / 150px / 48px` ≥ 554px → tràn trên màn 360px | `FinanceHistoryScreen.tsx:228,358,413` |
| U8 | 🟠 TB | Tất cả | Trùng/rối menu: "Thu chi cá nhân" vừa là item vừa là nhóm; 2 mục dùng chung icon `audit`; "Tài khoản ACC", "Sổ tay Issues" là tiếng lóng nội bộ | `Navigation.tsx:14-149` |
| U9 | 🟠 TB | Tất cả | 5 màn Finance + NotFound không có `<h1>`/`PageHeader` → bố cục lệch các màn khác, hỏng thứ bậc heading | `Finance*Screen.tsx`, `NotFoundScreen.tsx` |
| U10 | 🟡 Thấp | Tất cả | Thiếu skip-link "Bỏ qua tới nội dung"; `<main>` chưa có `id` | `AppShell.tsx:281` |
| U11 | 🟡 Thấp | Tất cả | Form: nhiều input chưa có `aria-label`/`label htmlFor`, `autoComplete` mới 20/190, `autoFocus` 11 chỗ (có thể bật bàn phím không mong muốn trên điện thoại) | Storage, Accounts, Reports, Work, Settings |
| U12 | 🟡 Thấp | Tất cả | `...` → `…`; `transition: all`; định dạng ngày thủ công 9 chỗ thay vì `Intl` | rải rác |
| U13 | 🟡 Thấp | Điện thoại | `<img>` không `width/height` (IssueDetail ×2, Payroll QR) → nhảy layout | `IssueDetailScreen.tsx:1871,2503`, `PayrollScreen.tsx:5233` |
| U14 | 🟡 Thấp | Tất cả | Thiếu `viewport` `theme-color` theo theme sáng; sidebar/phần tử không có `prefers-color-scheme` đồng bộ | `index.html` |
| U15 | 🔵 Gợi ý | Tất cả | Chưa có hệ thống component dùng chung cho Card/Field/Table/Stat → mỗi màn tự viết style, khó "đồng nhất, gọn" | `packages/ui` |

### Điểm đạt
Viewport + `viewport-fit=cover`, safe-area đáy, khoảng chạm ≥44px ở sidebar, `:focus-visible` toàn cục, reduced-motion, chặn zoom iOS khi focus input (16px), dialog `100dvh`, lưới `auto-fit minmax(min(100%,…))` ở hầu hết màn hình, thẻ di động `/storage`, KPI 2×2.

---

## B. Kế hoạch theo Phase → Task

### Phase 0 — Nền đo kiểm (`v0.3.3`)
| Task | Nội dung | File |
|---|---|---|
| 0.1 | Cài Playwright (devDependency) + script chụp ảnh 3 cỡ (360×780, 768×1024, 1366×768) × 2 theme × ~25 route trên DEV | `scripts/ui-audit/*`, `package.json` |
| 0.2 | Bộ kiểm tự động: không tràn ngang (`scrollWidth ≤ innerWidth`), axe-core (tên nút/nhãn/tương phản) | `tests/web/ui-audit.test.mjs` |
| 0.3 | Xác nhận/hiệu chỉnh danh sách lỗi U1–U15 bằng ảnh thật | báo cáo |

### Phase 1 — Nền móng token & theme (`v0.4.0`) — sửa U1(phần nền), U2, U4, U14
| Task | Nội dung | File |
|---|---|---|
| 1.1 | Định nghĩa token thiếu (`--font-sans`, `--brand-color`, `--surface-subtle-color`), thêm token ngữ nghĩa (`--card-bg`, `--text-muted`, `--accent-*`) | `packages/ui/src/tokens.css` |
| 1.2 | Chuyển `DesktopSidebar`, `AppShell` header/footer sang `var(--…)`; bỏ các vá `!important` | `Navigation.tsx`, `AppShell.tsx`, `tokens.css` |
| 1.3 | `theme-color` meta đổi theo theme; kiểm tra Sáng/Tối/Hệ thống | `index.html`, `SettingsScreen.tsx:50-110` |

### Phase 2 — Điều hướng & khung trang (`v0.4.1`) — U3, U5, U8, U9, U10
| Task | Nội dung | File |
|---|---|---|
| 2.1 | Sửa tên truy cập thanh đáy (1 nhãn duy nhất, `aria-label`), nhãn ≥11px, vùng chạm ≥48px | `Navigation.tsx`, `tokens.css` |
| 2.2 | Gọn menu: bỏ trùng "Thu chi cá nhân", icon riêng cho Nhật ký hệ thống, đổi tên dễ hiểu ("Tài khoản dùng chung", "Sổ tay lỗi") — cần Owner duyệt tên | `Navigation.tsx` |
| 2.3 | Skip-link + `main#main-content`; thêm `PageHeader` cho 5 màn Finance + NotFound | `AppShell.tsx`, `Finance*Screen.tsx`, `NotFoundScreen.tsx` |

### Phase 3 — Bộ component dùng chung (`v0.4.2`) — U15, nền cho U1
| Task | Nội dung | File |
|---|---|---|
| 3.1 | Thêm `Field` (label+input+lỗi+hint), `StatCard`, `DataTable` (tự chuyển thẻ trên ≤768px), `Section` | `packages/ui/src/components/*` |
| 3.2 | Class CSS dùng chung (`.card`, `.grid-auto`, `.table-cards`) thay inline style lặp | `tokens.css` |
| 3.3 | Test component + ví dụ dùng | `tests/web/ui-components.test.mjs` |

### Phase 4 — Chuyển màn hình sang token, từng cụm (U1, U5, U6, U7, U11, U13)
Mỗi cụm 1 phiên bản; kiểm bằng ảnh Phase 0 (Dark + Light, 3 cỡ).
| Phase | Version | Màn hình | Việc chính |
|---|---|---|---|
| 4A | `v0.4.3` | `/` Dashboard, `/clock`, `/attendance`, `/schedule` | hex→token, chữ ≥12px, gọn thẻ |
| 4B | `v0.4.4` | `/work`, `/reports`, `/storage` | hex→token, bảng→thẻ di động (Reports), `transition: all` |
| 4C | `v0.4.5` | `/employees*`, `/payroll`, `/my-pay`, `/payroll/stats` | bảng→thẻ di động, `img` có kích thước, hex→token |
| 4D | `v0.4.6` | `/finance*` (5 màn) | sửa lưới tràn (U7), thẻ di động lịch sử |
| 4E | `v0.4.7` | `/accounts`, `/audit`, `/system-logs`, `/issues*`, `/settings`, login/quên MK/kích hoạt | hex→token, form labels |

### Phase 5 — Đánh bóng & nghiệm thu (`v0.5.0`) — U11, U12
| Task | Nội dung |
|---|---|
| 5.1 | `…` thay `...`; `Intl.DateTimeFormat/NumberFormat` thay định dạng tay; `autoComplete`, `inputMode`, `type` đúng; bỏ `autoFocus` trên di động |
| 5.2 | Rà `aria-label`, `aria-live` cho toast/lỗi, thứ tự heading |
| 5.3 | Chạy lại bộ chụp + axe; Codex QA độc lập; cập nhật `AGENTS.md`, tag, push |

### Quy trình mỗi Phase (theo quy tắc Owner)
Test chọn lọc phân hệ + `npm run build` + `npm run build:web` → nâng version (`package.json`, `version.ts`) → cập nhật `AGENTS.md` → `git commit` + `tag` + `push` (không đồng bộ/sao chép vào Production; chỉ Owner phát hành qua cổng — xem `AGENTS.md` §0).

### Ưu tiên đề xuất
**Phase 0 → 1 → 2** trước (sửa lỗi truy cập + nền theme), sau đó 3 → 4A…4E → 5. Nếu Owner chỉ dùng giao diện Tối, có thể hạ ưu tiên U1/U2 và đẩy Phase 4 xuống làm gọn/di động trước.
</Content>


---

## C. Trạng thái thực hiện (31/10/2026)

- **Phase 0 [DONE — `v0.5.0`]:** `scripts/ui-audit/run.mjs` (`npm run audit:ui`) — Vite DEV cổng 5199 + mock API + Chrome hệ thống, 3 cỡ màn × Dark/Light × 24 route, đo tràn ngang + axe-core. Ảnh/JSON ở `scripts/ui-audit/out-before|out-after|out-final2`. Test tĩnh: `tests/web/ui-audit-phase0-2.test.mjs` (14/14 PASS).
- **Phase 1 [DONE — `v0.5.0`]:** token `--font-sans`, `--brand-color`, `--surface-subtle-color`, `--accent-text/--info-text/--danger-text/--success-text/--warning-text/--purple-text` (có bản Light/Dark đạt AA); `DesktopSidebar`, header/drawer `AppShell`, `NotFoundScreen` dùng token.
- **Phase 2 [DONE — `v0.5.0` & `v0.5.5`]:** thanh đáy điện thoại có `aria-label`, nhãn 11px, cao 52px; icon riêng cho Thu chi/Nhật ký hệ thống; skip-link + `main#main-content`; `NotFoundScreen` dùng `<h1>`; bỏ `transition: all`; đổi tên menu chuẩn tiếng Việt dễ hiểu (`'Tài khoản dùng chung'`, `'Sổ tay lỗi'`) sau khi Owner duyệt.
- **Phase 3 & 4 [DONE — `v0.5.0`]:** `THEME_COLORS` cho toàn bộ component dùng chung và màn hình Web; tự động chuyển bảng dữ liệu thành thẻ dọc trên `<= 768px` (`apps/web/src/responsive-tables.ts`); chuyển ~2.100 màu hex/rgba cứng sang biến theme.
- **Phase 5 [DONE — `v0.5.3` & `v0.5.5`]:** tự gắn tên truy cập cho ô nhập/chọn (`apps/web/src/a11y-forms.ts`), đổi `...` → `…`, nâng chữ `< 12px` lên `12px`, chuẩn hóa tương phản `StatusBadge`/`AppButton`/nút lọc. Kết quả kiểm toán 144 lượt (`24 route × 3 cỡ màn × 2 theme`): **`button-name: 0`, `label: 0`, `select-name: 0`, `color-contrast: 0` (cả Dark & Light), `overflow: 0`**.
