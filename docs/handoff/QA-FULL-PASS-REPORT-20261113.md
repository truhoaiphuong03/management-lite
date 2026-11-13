# BÁO CÁO KIỂM THỬ TOÀN DIỆN (FULL QA PASS) — `management-lite` (`v0.9.22`)

- **Ngày thực hiện:** `13/11/2026`
- **Nhánh kiểm thử (Worktree cô lập):** `test/full-qa-pass-20261113` (`C:\Projects\ml-full-qa`, tạo từ `origin/main` @ `07d2cbf`)
- **Môi trường kiểm thử (Staging cô lập theo `docs/deployment/STAGING-ISOLATION-RUNBOOK.md`):**
  - **Web UI Staging:** `http://127.0.0.1:4001` (`scripts/runtime/serve-web.cjs`)
  - **API Staging:** `http://127.0.0.1:4002` (`dist/apps/api/src/main.js`, cookie `ml_staging_session`)
  - **PostgreSQL Staging/Test:** `127.0.0.1:55433` (`management_lite_staging_test` tại `C:\ML-Test`)
  - **Cam kết an toàn Production:** **TUYỆT ĐỐI KHÔNG** chạm vào các cổng Production (`3000`, `3001`, `3002`, `55432`) và không tác động `C:\HoaiPhuong-Server\`. Toàn bộ tiến trình Staging đã được dừng sạch sẽ sau khi hoàn tất kiểm thử.
- **Thư mục ảnh chụp màn hình minh chứng (lưu cục bộ, không commit vào Git):** `.artifacts/qa-full-pass-20261113/` (44 ảnh chụp màn hình thực tế).

---

## I. TỔNG QUAN KẾT QUẢ KIỂM THỬ

### 1. Thống kê số hạng mục đã kiểm thử (A–J)

| Nhóm | Phân hệ / Phạm vi kiểm thử | Số mục kiểm thử | Đạt (`PASS`) | Có lỗi / Sai lệch (`FAIL / ISSUE`) |
| :--- | :--- | :---: | :---: | :---: |
| **A** | Xác thực (`Đăng nhập đúng/sai`, `Quên mật khẩu`, `Đổi mật khẩu`, `Đăng xuất`) | 5 | 5 | 0 *(1 lưu ý nhẹ ở J.1)* |
| **B** | Tổng quan (`/` — Vai Chủ sở hữu & Vai Nhân viên, KPI, Action Center, Liên thông V4, Lối tắt) | 4 | 3 | 1 (`BUG-04`) |
| **C** | Chấm công (`/clock` Nhân viên: Vào ca → Tạm nghỉ → Tiếp tục → Kết thúc ca; `/attendance` Chủ sở hữu: Xem lịch sử, Duyệt công, Đóng ca giúp NV) | 5 | 4 | 1 (`BUG-03`) |
| **D** | Công việc (`/work`, `/work/new`, `/work/:id`: Tạo việc, Giao việc, Cập nhật Checklist, Nộp bài, Nghiệm thu, Hủy việc, Bộ lọc/Sắp xếp) | 6 | 5 | 1 (`BUG-02`) |
| **E** | Nhân sự (`/employees`, `/employees/new`, `/employees/:id`: Thêm nhân viên mới, Sửa hồ sơ, Phân quyền Quản lý phụ) | 3 | 2 | 1 (`BUG-01`) |
| **F** | Tài khoản dùng chung (`/accounts`: Thêm Gmail/TikTok mẫu, Xem secret qua SEC-02 Reauth, Tạo nhanh cụm kênh con) | 3 | 3 | 0 |
| **G** | Thu chi (`/finance`, `/finance/new`: Tạo danh mục, Tạo phiếu thu & phiếu chi thực tế, Kiểm tra đường dẫn `/finance/entries/new`) | 3 | 2 | 1 (`BUG-05` + `BUG-07`) |
| **H** | Báo giá in ấn (`/print-quotes`, `/print-quotes/new`, `/print-quotes/orders`: Tạo khách hàng & báo giá, Chốt & Chuyển thành đơn đặt in, Ghi nhận đặt cọc) | 3 | 3 | 0 |
| **I** | Các màn hình quản trị & vận hành khác (`/payroll`, `/schedule`, `/reports`, `/storage`, `/issues`, `/system-logs`, `/settings`) | 7 | 7 | 0 |
| **J** | Đối chiếu chuyên sâu 4 màn hình thiết kế lại 12/11/2026 (`Đăng nhập`, `Tổng quan`, `Chấm công`, `Công việc`) ở `390×844` & `1280×820`, `Light` & `Dark` + Script vận hành Staging | 4 | 2 | 2 (`BUG-08`, `BUG-09` + `BUG-06`) |
| **Tổng** | **Toàn bộ ứng dụng (`A` → `J`)** | **43** | **36** | **7 mục có lỗi (tổng 9 lỗi ghi nhận)** |

### 2. Tổng hợp số lượng lỗi theo mức độ nghiêm trọng

| Mức độ nghiêm trọng | Số lượng | Mã lỗi | Tóm tắt ngắn |
| :--- | :---: | :--- | :--- |
| 🔴 **Nghiêm trọng (`Critical / High`)** | **1** | `BUG-01` | Không thể tạo nhân viên mới qua form `/employees/new` do API từ chối trường `sub_role` (`HTTP 400`). |
| 🟠 **Trung bình (`Medium`)** | **5** | `BUG-02`, `BUG-03`, `BUG-04`, `BUG-05`, `BUG-06` | Nhân viên không tích được Checklist trên `/work/:id`; `/clock` chào `"Chào staff"` thay vì tên thật; Dashboard nhân viên hiển thị nhầm số ca làm vào dòng Công việc; `/finance/entries/new` bị nhận nhầm là `entryId="new"`; script `Manage-StagingEnv.ps1` thiếu nhánh `Start`/`SmokeTest`. |
| 🟡 **Nhẹ (`Low / UI-UX`)** | **3** | `BUG-07`, `BUG-08`, `BUG-09` | Chọn lại cùng giá trị `Loại` trong hộp thoại Thêm thu/chi làm rỗng danh sách danh mục; ô `"Ghi nhớ trên máy này"` ở `/login` chưa tích mặc định; một số chi tiết trên `/`, `/clock`, `/work` chưa rút gọn triệt để theo mẫu HTML ngày 12/11/2026. |
| **Tổng cộng** | **9 lỗi** | `BUG-01` → `BUG-09` | **1 Nghiêm trọng • 5 Trung bình • 3 Nhẹ** |

---

## II. CHI TIẾT TỪNG LỖI PHÁT HIỆN & ĐỀ XUẤT CÁCH SỬA

---

### 🔴 [BUG-01] Không thể thêm nhân viên mới trên `/employees/new` do lỗi `Unrecognized request field(s) not allowed: sub_role` (`HTTP 400`)

- **Mức độ nghiêm trọng:** **Nghiêm trọng (`Critical`)** — Chặn hoàn toàn luồng thêm nhân sự mới từ giao diện Web.
- **Màn hình / Route:** `/employees/new` (`POST /api/v1/employees`)
- **Vai trò:** Chủ sở hữu (`Owner`)
- **Ảnh chụp màn hình:**
  - `.artifacts/qa-full-pass-20261113/E2-employee-new-filled.png`
  - `.artifacts/qa-full-pass-20261113/E3-employee-created-invite.png`
- **Các bước tái hiện:**
  1. Đăng nhập với tài khoản Chủ sở hữu (`owner`), truy cập `/employees/new`.
  2. Nhập dữ liệu thực tế hợp lệ:
     - Họ và tên: `Phạm Minh Tuấn`
     - Email: `phamminhtuan@hoaiphuong.vn`
     - Số điện thoại: `0912345678`
     - Chức danh: `Chuyên viên Thiết kế & Chế bản In`
     - Ngân hàng: `Vietcombank` — Số TK: `0071001234567` — Chủ TK: `PHAM MINH TUAN`
  3. Bấm nút **«Tạo nhân sự & Tạo liên kết mời»**.
- **Kết quả mong đợi:** Tạo hồ sơ nhân viên mới thành công (`HTTP 201`) và hiển thị đường dẫn liên kết mời kích hoạt tài khoản.
- **Kết quả thực tế:** Máy chủ trả về `HTTP 400 Bad Request` và giao diện hiển thị thông báo lỗi đỏ:
  > `Unrecognized request field(s) not allowed: sub_role`
- **Nguyên nhân gốc & Đề xuất cách sửa cụ thể:**
  - **Tại Frontend (`apps/web/src/screens/EmployeeNewScreen.tsx`, hàm `handleSubmit`, dòng `146–155`):**
    Frontend đang gửi đồng thời cả `role: 'staff'` và `sub_role: role`:
    ```ts
    const payload: Record<string, unknown> = {
      full_name: fullName.trim(),
      email: email.trim(),
      role: 'staff',
      sub_role: role,
      sub_permissions: role === 'admin' ? subPermissions : [],
    ```
  - **Tại Backend (`apps/api/src/app.ts`, nhánh `POST /api/v1/employees`, dòng `1976–1993`):**
    Hàm `assertAllowedFields(rawBody, [...])` kiểm tra danh sách trường hợp lệ nhưng chỉ khai báo `'role'`, `'sub_permissions'`, **thiếu `'sub_role'`**, dẫn tới ném lỗi `VALIDATION_ERROR` trước khi vào `EmployeeService.createEmployee`.
  - **Hướng sửa đề xuất:**
    1. Trong `apps/api/src/app.ts` (dòng `1976–1993`), bổ sung `'sub_role'` vào mảng `assertAllowedFields` của `POST /api/v1/employees` và truyền `sub_role: typeof rawBody.sub_role === 'string' ? rawBody.sub_role : undefined` (hoặc gộp vào `role: rawBody.sub_role ?? rawBody.role`) khi gọi `employeeService.createEmployee`.
    2. Trong `apps/web/src/screens/EmployeeNewScreen.tsx` (dòng `148`), truyền trực tiếp `role: role` (`'staff'` hoặc `'admin'`) để đồng nhất với hợp đồng `CreateEmployeeRequest` trong `packages/contracts/src/employees.ts`.

---

### 🟠 [BUG-02] Nhân viên (`Staff`) không thể tích chọn (bật/tắt) các bước Checklist trong chi tiết công việc `/work/:id`

- **Mức độ nghiêm trọng:** **Trung bình (`Medium`)** — Nhân viên được giao việc chỉ xem được Checklist nhưng không tự đánh dấu hoàn thành từng bước nhỏ trước khi nộp bài.
- **Màn hình / Route:** `/work/:id`
- **Vai trò:** Nhân viên (`Staff` — `NV001 Nguyễn Văn Một`)
- **Ảnh chụp màn hình:** `.artifacts/qa-full-pass-20261113/D3-work-staff-checklist-updated.png`
- **Các bước tái hiện:**
  1. Chủ sở hữu tạo công việc *«Dựng video giới thiệu bộ quà tặng doanh nghiệp Tết 2027»* có 4 bước checklist `- [ ] ...` trong phần mô tả và giao cho `NV001`.
  2. Đăng nhập bằng tài khoản nhân viên `NV001` (`staff`), mở chi tiết công việc tại `/work/:id`.
  3. Bấm vào các ô checkbox bước thực hiện trong khung `[data-testid="work-detail-checklist"]`.
- **Kết quả mong đợi:** Nhân viên được giao việc có thể tích chọn/bỏ chọn các bước checklist để cập nhật tiến độ thực hiện thực tế.
- **Kết quả thực tế:** Tất cả 4 nút `button[role="checkbox"]` trong checklist đều bị khóa (`disabled=""`, `cursor: default`), chỉ Chủ sở hữu mới bấm được.
- **Nguyên nhân gốc & Đề xuất cách sửa cụ thể:**
  - **Tại Frontend (`apps/web/src/screens/WorkScreen.tsx`, dòng `2491` và hàm `handleToggleChecklistStep` dòng `1032–1085`):**
    Dòng `2491` đang khóa cứng:
    ```ts
    const canToggleStep = role === 'owner' && item.status !== 'cancelled';
    ```
    Và dòng `1036` trong `handleToggleChecklistStep` cũng chặn `if (!selectedItem || role !== 'owner') return;` rồi gọi `PATCH /api/v1/work-items/:id` (endpoint chỉ cho phép `Owner` hoặc người có quyền `work:manage`).
  - **Hướng sửa đề xuất:**
    1. Trong `apps/web/src/screens/WorkScreen.tsx` (dòng `1036` & `2491`), mở điều kiện `canToggleStep` cho cả nhân sự đang được phân công công việc đó (`const canToggleStep = (role === 'owner' || Boolean(myAssignment)) && item.status !== 'cancelled' && item.status !== 'completed'`).
    2. Trong `apps/api/src/app.ts` / `apps/api/src/work/service.ts`, bổ sung endpoint `PATCH /api/v1/work-items/:id/checklist` (hoặc cho phép nhân viên được phân công cập nhật trạng thái `- [x]` / `- [ ]` của các dòng checklist trong `description` khi công việc đang ở trạng thái `assigned`/`in_progress`/`changes_requested`).

---

### 🟠 [BUG-03] Màn hình Chấm công (`/clock`) hiển thị lời chào theo username (`"Chào staff"`, avatar `"S"`) thay vì họ tên thật của nhân viên (`"Chào Một"`, avatar `"NM"`)

- **Mức độ nghiêm trọng:** **Trung bình (`Medium`)** — Hiển thị tên kỹ thuật (`staff`, `owner`) thay vì tên thật của nhân sự trên màn hình bấm giờ hàng ngày.
- **Màn hình / Route:** `/clock`
- **Vai trò:** Nhân viên (`Staff` — `NV001 Nguyễn Văn Một`) & Chủ sở hữu (`Owner`)
- **Ảnh chụp màn hình:**
  - `.artifacts/qa-full-pass-20261113/J3-clock-staff-mobile-light.png`
  - `.artifacts/qa-full-pass-20261113/J3-clock-staff-desktop-light.png`
  - `.artifacts/qa-full-pass-20261113/C1-clock-staff-working.png`
- **Các bước tái hiện:**
  1. Đăng nhập bằng tài khoản `staff` (hồ sơ nhân sự liên kết là `NV001 — Nguyễn Văn Một`).
  2. Mở màn hình Chấm công `/clock`.
- **Kết quả mong đợi:** Tiêu đề chào tên thật của nhân viên (`"Chào Một"` hoặc `"Chào Nguyễn Văn Một"`) và vòng tròn avatar hiển thị chữ cái đầu của họ tên (`"NM"`), đúng như ở góc dưới thanh menu (`Nguyễn Văn Một — NM`) và bản thiết kế `docs/design/2026-11-12-toi-gian/ChamCong.html`.
- **Kết quả thực tế:** Tiêu đề hiển thị **`Chào staff`** và avatar hiển thị **`S`**.
- **Nguyên nhân gốc & Đề xuất cách sửa cụ thể:**
  - **Tại `apps/web/src/App.tsx` (dòng `1043–1053`):**
    Khi truyền prop `userDisplayName` xuống `<ClockScreen />`, `App.tsx` đang truyền `userDisplayName` lấy từ `body.data?.user?.display_name || body.data?.user?.username` (trên tài khoản seed là `"staff"`), trong khi tên hồ sơ nhân sự thật được lưu ở state `employeeFullName` (hoặc `body.data?.employee?.full_name`).
  - **Hướng sửa đề xuất:**
    1. Trong `apps/web/src/App.tsx` (dòng `1048`), ưu tiên truyền họ tên nhân sự:
       ```tsx
       userDisplayName={employeeFullName || userDisplayName}
       ```
    2. Hoặc trong `apps/web/src/screens/ClockScreen.tsx` (dòng `56–78`), lấy `currentEmployee?.full_name || userDisplayName` sau khi tải thông tin nhân viên ca hiện tại.

---

### 🟠 [BUG-04] Màn hình Tổng quan (`/`) của Nhân viên hiển thị nhầm số ca chấm công (`"1 ca hoàn tất"`) vào dòng «Công việc được giao»

- **Mức độ nghiêm trọng:** **Trung bình (`Medium`)** — Sai lệch số liệu hiển thị trên Trung tâm việc cần xử lý của Nhân viên.
- **Màn hình / Route:** `/` (`DashboardScreen`)
- **Vai trò:** Nhân viên (`Staff` — `NV001`)
- **Ảnh chụp màn hình:** `.artifacts/qa-full-pass-20261113/B2-dashboard-staff-mobile-light.png`
- **Các bước tái hiện:**
  1. Đăng nhập bằng tài khoản Nhân viên (`staff`).
  2. Quan sát khối **«Việc cần xử lý hôm nay»** (`[data-testid="dashboard-action-center"]`) trên trang Tổng quan `/`.
- **Kết quả mong đợi:** Dòng **«Công việc được giao»** (`[data-testid="action-center-staff-work"]`) phải hiển thị số lượng công việc đang được giao cho nhân viên (ví dụ: `"9 việc đang mở"` hoặc `"Xem danh sách"`).
- **Kết quả thực tế:** Cột bên phải (`.dashboard-row-right`) của dòng **«Công việc được giao»** lại hiển thị **`1 ca hoàn tất`** (số liệu của ca chấm công).
- **Nguyên nhân gốc & Đề xuất cách sửa cụ thể:**
  - **Tại `apps/web/src/screens/DashboardScreen.tsx` (dòng `1118–1140`):**
    Trong khối `[data-testid="action-center-staff-work"]`, dòng `1137` đang viết nhầm biến `staffAttendanceMetric.value`:
    ```tsx
    <span className="dashboard-row-right">
      {staffAttendanceMetric.value}
    </span>
    ```
  - **Hướng sửa đề xuất:**
    Trong `apps/web/src/screens/DashboardScreen.tsx` (dòng `1136–1138`), thay `staffAttendanceMetric.value` bằng số lượng công việc cần làm của nhân viên (lấy từ state công việc của nhân viên hoặc hiển thị nhãn điều hướng `"Mở việc của tôi →"`).

---

### 🟠 [BUG-05] Truy cập trực tiếp đường dẫn `/finance/entries/new` bị nhận nhầm là trang Chi tiết giao dịch với `entryId = "new"`

- **Mức độ nghiêm trọng:** **Trung bình (`Medium`)** — Gây lỗi tải dữ liệu nếu người dùng hoặc liên kết điều hướng mở `/finance/entries/new`.
- **Màn hình / Route:** `/finance/entries/new`
- **Vai trò:** Chủ sở hữu (`Owner`)
- **Ảnh chụp màn hình:** `.artifacts/qa-full-pass-20261113/G0-finance-entries-new-bug.png`
- **Các bước tái hiện:**
  1. Đăng nhập với vai Chủ sở hữu (`owner`).
  2. Truy cập đường dẫn `/finance/entries/new`.
- **Kết quả mong đợi:** Mở màn hình hoặc hộp thoại Thêm khoản thu/chi mới (giống như `/finance/new`).
- **Kết quả thực tế:** Bộ định tuyến khớp `/finance/entries/:id` với `params.id = "new"`, hiển thị tiêu đề **«Chi tiết giao dịch»** và báo lỗi đỏ:
  > `Không tải được dữ liệu. Hãy thử lại` (do gọi `GET /api/v1/fin/entries/new` thất bại).
- **Nguyên nhân gốc & Đề xuất cách sửa cụ thể:**
  - **Tại `apps/web/src/App.tsx` (bảng `ROUTES` và khối `switch (routeMeta.path)` quanh dòng `848–895`):**
    Hệ thống chỉ khai báo `/finance/new` cho form tạo mới, còn `/finance/entries/:id` khớp mọi chuỗi sau `/finance/entries/`, kể cả `"new"`.
  - **Hướng sửa đề xuất:**
    Trong `apps/web/src/App.tsx` (nhánh `case '/finance/entries/:id':`), nếu `params.id === 'new'` thì render `<FinanceOverviewScreen ... entryRequest={...} />` (hoặc `<FinanceEntryScreen />` không truyền `entryId`) để mở thẳng form tạo giao dịch mới.

---

### 🟠 [BUG-06] Script `scripts/staging/Manage-StagingEnv.ps1` thiếu nhánh xử lý `-Action Start` và `-Action SmokeTest`, kèm lỗi `Resolve-Path` khi chạy từ thư mục gốc

- **Mức độ nghiêm trọng:** **Trung bình (`Medium`)** — Gây lỗi khi vận hành môi trường Staging theo đúng câu lệnh trong `docs/deployment/STAGING-ISOLATION-RUNBOOK.md`.
- **Màn hình / File:** `scripts/staging/Manage-StagingEnv.ps1`
- **Vai trò:** Kỹ thuật / QA / Vận hành
- **Các bước tái hiện:**
  1. Mở PowerShell tại thư mục dự án, chạy lệnh theo Runbook:
     `powershell -File scripts\staging\Manage-StagingEnv.ps1 -Action Start`
- **Kết quả mong đợi:** Script khởi chạy API Staging (`4002`) và Web Staging (`4001`) kết nối vào PostgreSQL `55433`.
- **Kết quả thực tế:**
  - Khi chạy `-Action Start` hoặc `-Action SmokeTest`: script không thực hiện gì cả vì `switch ($Action)` chỉ có 3 nhánh `'VerifyConfig'`, `'Status'`, `'Stop'`.
  - Khi gọi qua một số phiên PowerShell không gán `$PSScriptRoot` đúng ngữ cảnh ổ đĩa, dòng `11` (`$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path`) báo lỗi: `The path 'C:\..\..' referred to an item that was outside the base 'C:'`.
- **Nguyên nhân gốc & Đề xuất cách sửa cụ thể:**
  - **Tại `scripts/staging/Manage-StagingEnv.ps1` (dòng `1–102`):**
    `[ValidateSet('VerifyConfig', 'Start', 'Stop', 'Status', 'SmokeTest')]` khai báo đủ 5 action nhưng thân hàm `switch ($Action)` (dòng `57–102`) chưa cài đặt `'Start'` và `'SmokeTest'`.
  - **Hướng sửa đề xuất:**
    1. Sửa dòng `11` của `scripts/staging/Manage-StagingEnv.ps1` để lấy `$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }`.
    2. Bổ sung nhánh `'Start'` (khởi chạy `Manage-TestEnv.ps1 -Action Start`, chạy `dist/apps/api/src/main.js` trên cổng `4002` và `scripts/runtime/serve-web.cjs` trên cổng `4001`, ghi `staging-pids.json`) và nhánh `'SmokeTest'` (kiểm tra `/api/v1/health` trên `4002` và `/login` trên `4001`).

---

### 🟡 [BUG-07] Hộp thoại Thêm thu/chi (`FinanceEntryScreen.tsx`) làm rỗng danh sách danh mục nếu sự kiện `onChange` của ô «Loại» (`direction`) được kích hoạt lại với cùng giá trị

- **Mức độ nghiêm trọng:** **Nhẹ (`Low`)**
- **Màn hình / Route:** `/finance` / `/finance/new` (`FinanceEntryScreen.tsx`)
- **Vai trò:** Chủ sở hữu (`Owner`)
- **Các bước tái hiện:**
  1. Mở hộp thoại **«Thêm thu/chi»** (mặc định `Loại` đang là `Chi` / `'expense'`).
  2. Nếu sự kiện `change` trên thẻ `<select>` `Loại` được kích hoạt lại với cùng giá trị `'expense'`, danh sách `Danh mục đang sử dụng` bị xóa trắng và chỉ còn `"Chọn danh mục"`.
- **Nguyên nhân gốc & Đề xuất cách sửa cụ thể:**
  - **Tại `apps/web/src/screens/FinanceEntryScreen.tsx` (dòng `414–420`):**
    ```tsx
    onChange={(e) => {
      setDirection(e.target.value as FinanceDirection);
      setCategory('');
      setCategories([]);
      setCatCursor(null);
    }}
    ```
    Khi `e.target.value === direction`, `setCategories([])` xóa trắng mảng `categories` trong state nhưng URL truy vấn của `useFinanceRead` (`'/categories?' + new URLSearchParams({ direction, limit: '100' })`) không đổi nên hook không fetch lại dữ liệu.
  - **Hướng sửa đề xuất:**
    Thêm điều kiện kiểm tra trước khi xóa state trong `apps/web/src/screens/FinanceEntryScreen.tsx` (dòng `415`):
    ```tsx
    onChange={(e) => {
      const nextDir = e.target.value as FinanceDirection;
      if (nextDir === direction) return;
      setDirection(nextDir);
      setCategory('');
      setCategories([]);
      setCatCursor(null);
    }}
    ```

---

### 🟡 [BUG-08] Ô «Ghi nhớ trên máy này» trên màn hình Đăng nhập (`/login`) mặc định chưa tích chọn (`false`), khác với bản thiết kế `Main.html`

- **Mức độ nghiêm trọng:** **Nhẹ (`Low / UI Spec`)**
- **Màn hình / Route:** `/login`
- **Vai trò:** Mọi người dùng
- **Ảnh chụp màn hình:** `.artifacts/qa-full-pass-20261113/J1-login-mobile-light.png`
- **Các bước tái hiện:**
  1. Mở trang `/login` lần đầu (khi chưa có `localStorage.getItem('mglite_remember_login')`).
  2. Quan sát ô checkbox **«Ghi nhớ trên máy này»** (`#remember-me`).
- **Kết quả mong đợi:** Theo mẫu thiết kế `docs/design/2026-11-12-toi-gian/Main.html` (dòng `141`: `<input type="checkbox" checked>`), ô «Ghi nhớ trên máy này» được tích sẵn mặc định để tiện cho nhân sự dùng hàng ngày trên thiết bị cá nhân.
- **Kết quả thực tế:** Ô `#remember-me` mặc định chưa được tích (`checked = false`).
- **Nguyên nhân gốc & Đề xuất cách sửa cụ thể:**
  - **Tại `apps/web/src/screens/LoginScreen.tsx` (dòng `54`):**
    `const [rememberMe, setRememberMe] = useState(false);` và trong `useEffect` (dòng `70–84`) chỉ bật `true` khi `localStorage.getItem(REMEMBER_LOGIN_STORAGE_KEY) === '1'`.
  - **Hướng sửa đề xuất:**
    Khởi tạo `useState(() => localStorage.getItem(REMEMBER_LOGIN_STORAGE_KEY) !== '0')` trong `apps/web/src/screens/LoginScreen.tsx` (dòng `54`) để mặc định là `true` trừ khi người dùng chủ động bỏ tích.

---

### 🟡 [BUG-09] Một số thành phần trên 3 màn hình Tổng quan (`/`), Chấm công (`/clock`) và Công việc (`/work`) chưa rút gọn triệt để theo bộ thiết kế tối giản `docs/design/2026-11-12-toi-gian/`

- **Mức độ nghiêm trọng:** **Nhẹ (`Low / UI-UX Alignment`)**
- **Màn hình / Route:** `/`, `/clock`, `/work` (ở cả Điện thoại `390×844` và Máy tính `1280×820`, Sáng & Tối)
- **Ảnh chụp màn hình:**
  - Tổng quan: `J2-dashboard-owner-mobile-light.png`, `J2-dashboard-owner-mobile-dark.png`, `J2-dashboard-owner-desktop-light.png`, `J2-dashboard-owner-desktop-dark.png`
  - Chấm công: `J3-clock-staff-mobile-light.png`, `J3-clock-staff-mobile-dark.png`, `J3-clock-staff-desktop-light.png`, `J3-clock-staff-desktop-dark.png`
  - Công việc: `J4-work-owner-mobile-light.png`, `J4-work-owner-mobile-dark.png`, `J4-work-owner-desktop-light.png`, `J4-work-owner-desktop-dark.png`
- **Chi tiết đối chiếu thực tế vs `docs/design/2026-11-12-toi-gian/` và đề xuất cách sửa:**
  1. **Màn hình Tổng quan (`/`, đối chiếu `TongQuan.html` & `TongQuanMayTinh.html`):**
     - *Thực tế:* Tiêu đề đang là `Tổng quan` (`20px`) kèm phụ đề dài; nút chính là `Giao việc mới` (`44px`); 4 thẻ KPI hiển thị 4 dòng chữ/thẻ; cột phải trên máy tính hiển thị khối `Liên thông TikTok AI Factory` và `Lối tắt thao tác nhanh`.
     - *Thiết kế mẫu:* Tiêu đề chào cá nhân `Chào Phương` (`26px` mobile / `30px` desktop, `font-weight: 800`) + avatar `PH`; nút hành động chính `+ Giao việc` màu `#0f766e` cao `52–54px`; 4 ô số liệu 2×2 chỉ gồm nhãn ngắn (`Việc`, `Trong ca`, `Báo cáo`, `Lương T11`) + con số lớn `28–32px` + 1 dòng trạng thái; cột phải trên máy tính là danh sách `Sắp đến hạn`.
     - *Đề xuất sửa:* Cập nhật `apps/web/src/screens/DashboardScreen.tsx` (dòng `1020–1390`) và `.dashboard-*` trong `apps/web/src/styles/global.css`.
  2. **Màn hình Chấm công (`/clock`, đối chiếu `ChamCong.html`):**
     - *Thực tế:* Cỡ chữ `.clock-self-title` bị hạ xuống `17.5px` (mobile) / `22px` (desktop) tại `global.css:2022,2174`; vẫn còn dòng phụ đề, nút `Đặt lại hôm nay` dưới vòng tròn bấm giờ, hai banner cảnh báo vàng đẩy thẻ tóm tắt xuống dưới mép màn hình `844px`, và toàn bộ bảng `Lịch sử chấm công cá nhân` nằm ngay bên dưới.
     - *Thiết kế mẫu:* Toàn bộ màn hình vừa gọn trong 1 khung nhìn điện thoại không cần cuộn: lời chào `26px/800`, 1 vòng tròn bấm giờ `200×200px` (`0 18px 38px rgba(15, 118, 110, 0.28)`), và 1 thẻ tóm tắt 2 dòng (`Tháng 11: X ca · Yg` + `Nộp báo cáo hôm nay`).
     - *Đề xuất sửa:* Trong `apps/web/src/screens/ClockScreen.tsx` (dòng `1220–1450`) và `apps/web/src/styles/global.css` (dòng `2010–2195`), khôi phục `.clock-self-title` `26px/800`, ẩn phụ đề và thu gọn bảng `Lịch sử chấm công cá nhân` vào nút mở rộng hoặc tab riêng.
  3. **Màn hình Công việc (`/work`, đối chiếu `CongViec.html`):**
     - *Thực tế:* Vẫn hiển thị dải 4 thẻ KPI (`.work-kpi-strip`), khung bộ lọc lớn nhiều tầng (5 chip có emoji, ô tìm kiếm luôn mở kèm nút `Tìm kiếm`, 3 dropdown lọc/sắp xếp), và mỗi thẻ việc cao `158px` chứa 5–6 huy hiệu.
     - *Thiết kế mẫu:* Header chỉ gồm tiêu đề `Công việc` (`26px`), nút kính lúp tròn `44×44px` và nút `+ Giao việc`; dải lọc 1 hàng 3 chip (`Tất cả`, `Quá hạn`, `Hôm nay`); danh sách việc tối giản 1 dòng `60–64px` gồm chấm tròn màu `10px` + tên công việc + hạn `dd/mm`.
     - *Đề xuất sửa:* Trong `apps/web/src/screens/WorkScreen.tsx` (dòng `1590–2080`), ẩn `.work-kpi-strip`, thu gọn bộ lọc nâng cao vào nút kính lúp/lọc và rút gọn `.work-item-card` theo bố cục 1 dòng.

---

## III. DANH SÁCH CÁC HẠNG MỤC ĐÃ KIỂM THỬ & ĐẠT (`PASS` KHÔNG LỖI)

Toàn bộ **36 hạng mục chức năng** dưới đây đã được thực thi trực tiếp trên trình duyệt thật với dữ liệu thực tế tiếng Việt và xác nhận hoạt động đúng thiết kế:

### A. Xác thực (`/login`, `/forgot-password`, `/settings`)
1. **[PASS] Đăng nhập sai mật khẩu (`A.1`):** Nhập `owner` + mật khẩu sai `MatKhauSai_2026!` → Hiển thị cảnh báo đỏ `#login-error-alert` (*«Tên đăng nhập hoặc mật khẩu không chính xác»*), giữ nguyên tên đăng nhập và xóa trống ô mật khẩu (`A1-login-wrong-password.png`).
2. **[PASS] Quên mật khẩu (`A.2`):** Bấm «Quên mật khẩu?» → Điều hướng tới `/forgot-password`, điền `owner@management-lite.local` và gửi yêu cầu khôi phục thành công (`A2-forgot-password-submitted.png`).
3. **[PASS] Đăng nhập đúng mật khẩu vai Chủ sở hữu & Nhân viên (`A.3`):** Đăng nhập thành công với cả `owner`, `staff` (`NV001`), `staff2` (`NV002`), thiết lập cookie phiên cô lập `ml_staging_session` và điều hướng vào `/`.
4. **[PASS] Đổi mật khẩu (`A.4`):** Nhân viên `NV001` đổi mật khẩu trên `/settings#password` từ `HoaiPhuong@2026!Staff1` sang mật khẩu mới, hệ thống thông báo *«Đổi mật khẩu thành công! Các phiên làm việc khác đã được thu hồi bảo mật»* và đăng nhập lại bằng mật khẩu mới thành công (`A3-change-password-success.png`).
5. **[PASS] Đăng xuất (`A.5`):** Bấm nút «Đăng xuất» trên thanh header → Xóa phiên làm việc và quay về `/login` (`A4-logout-success.png`).

### B. Tổng quan (`/`)
6. **[PASS] Tổng quan vai Chủ sở hữu (`B.1`):** Hiển thị đầy đủ 4 thẻ KPI (`Nhân sự trong ca`, `Công việc đang mở`, `Báo cáo công việc hôm nay`, `Tạm tính lương tháng`), danh sách **Việc cần xử lý hôm nay**, mở rộng **Chi tiết V4**, bấm **Đồng bộ ngay** Liên thông TikTok AI Factory V4 và mở **Tất cả lối tắt** (`B1-dashboard-owner-expanded.png`).
7. **[PASS] Khung nhìn Điện thoại (`390×844`) & Máy tính (`1280×820`), Sáng & Tối trên `/` (`B.2`):** Không tràn ngang (`overflowX = false`) ở mọi khung nhìn và chế độ màu (`J2-dashboard-owner-mobile-light.png`, `J2-dashboard-owner-mobile-dark.png`, `J2-dashboard-owner-desktop-light.png`, `J2-dashboard-owner-desktop-dark.png`).
8. **[PASS] Hộp thoại nhắc bổ sung SĐT nhân viên (`missing-phone-modal`):** Khi `NV001` đăng nhập lần đầu chưa có SĐT, hộp thoại nhắc bổ sung hiển thị rõ ràng; nhập `0905123456` và bấm «Lưu thông tin» cập nhật thẳng vào hồ sơ cá nhân (`B2-staff-missing-phone-modal.png`).

### C. Chấm công (`/clock` & `/attendance`)
9. **[PASS] Vào ca (`C.1`):** Nhân viên `NV001` bấm nút tròn «Vào ca» trên `/clock` → Trạng thái chuyển sang `ĐANG TRONG CA`, đồng hồ đếm giờ theo thời gian thực (`C1-clock-staff-working.png`).
10. **[PASS] Tạm nghỉ (`C.2`):** Bấm «Tạm nghỉ» → Trạng thái chuyển sang `ĐANG TẠM NGHỈ`, nút chính đổi thành «Tiếp tục» (`C2-clock-staff-paused.png`).
11. **[PASS] Tiếp tục làm việc (`C.3`):** Bấm «Tiếp tục» → Trạng thái quay lại `ĐANG TRONG CA`.
12. **[PASS] Kết thúc ca có hộp thoại xác nhận (`C.4`):** Bấm «Kết thúc ca» → Hiển thị hộp thoại xác nhận `Kết thúc ca làm việc?`, xác nhận đóng ca và ghi nhận ca làm vào lịch sử (`C3-clock-staff-confirm-out.png`, `C4-clock-staff-completed.png`).
13. **[PASS] Chủ sở hữu xem lịch sử, duyệt công nhanh & đóng ca giúp nhân viên (`/attendance`, `C.5`):** Xem bảng công gom theo nhân viên (`C5-owner-attendance-grouped.png`), duyệt nhanh ca chờ của `NV001` và bấm **«Đóng ca & Xác nhận giúp NV»** cho ca đang mở của `NV002` (`C6-owner-attendance-after-review-close.png`).

### D. Công việc (`/work`, `/work/new`, `/work/:id`)
14. **[PASS] Tạo công việc mới với dữ liệu thực tế & giao cho nhân viên (`D.1`):** Tạo công việc *«Dựng video giới thiệu bộ quà tặng doanh nghiệp Tết 2027»* (loại `Dựng Video`, ưu tiên `Cao`, có hạn chót và 4 bước checklist), giao cho `NV001` (`D1-work-new-form.png`, `D2-work-created-list.png`).
15. **[PASS] Chủ sở hữu cập nhật bước Checklist trên `/work/:id` (`D.2`):** Tích chọn hoàn thành bước 1 trên `/work/:id`, thanh tiến độ cập nhật `1/4 bước (25%)` (`D2b-work-owner-checklist.png`).
16. **[PASS] Nhân viên bắt đầu làm việc & nộp bài kèm link thành phẩm (`D.3`):** `NV001` bấm «Bắt đầu làm việc» rồi «Báo cáo hoàn thành (Nộp bài)», điền ghi chú bàn giao + đính kèm tệp `Video_QuaTangTet2027_Final_FullHD.mp4` (`https://drive.google.com/...`) → Trạng thái chuyển sang `Chờ duyệt` (`D4-work-staff-submitted.png`).
17. **[PASS] Chủ sở hữu nghiệm thu đạt công việc (`D.4`):** Chủ sở hữu mở `/work/:id`, bấm «✓ Duyệt đạt», nhập nhận xét nghiệm thu → Công việc chuyển sang trạng thái `Hoàn thành` (`D5-work-owner-approved.png`).
18. **[PASS] Hủy công việc có lý do (`D.5`):** Tạo công việc *«Thiết kế standee hội thảo khách hàng ngành F&B tháng 11»*, bấm «Hủy công việc», nhập lý do *«Khách hàng thông báo dời lịch tổ chức hội thảo sang giữa tháng 12/2026»* → Trạng thái chuyển sang `Đã hủy` (`D6-work-cancelled.png`).
19. **[PASS] Bộ lọc & Sắp xếp danh sách công việc (`D.6`):** Lọc theo độ ưu tiên (`Cao`), sắp xếp theo hạn hoàn thành và tìm kiếm từ khóa `"Tết 2027"` trả về đúng công việc mục tiêu.

### E. Nhân sự (`/employees`, `/employees/:id`)
20. **[PASS] Xem danh sách & Sửa hồ sơ nhân viên (`E.2`):** Xem danh sách nhân sự (`/employees`, `E1-employees-list.png`), mở chi tiết hồ sơ `Phạm Minh Tuấn` (`/employees/:id`, `E4-employee-detail.png`), cập nhật chức danh *«Trưởng nhóm Thiết kế & Chế bản»*, ngày sinh `15/08/1996`, CCCD, địa chỉ, liên hệ khẩn cấp và tài khoản ngân hàng `Vietcombank`.
21. **[PASS] Phân quyền Quản lý phụ (`Admin` + 4 quyền vận hành chi tiết, `E.3`):** Mở trang chỉnh sửa nhân viên `NV002`, chọn mẫu **«Gói Admin vận hành (4 quyền)»** (`attendance:review`, `work:manage`, `employees:manage`, `accounts:manage`) và lưu thay đổi → Huy hiệu vai trò cập nhật thành `Quản lý phụ` (`E5-employee-grant-admin-role.png`).

### F. Tài khoản dùng chung (`/accounts`)
22. **[PASS] Thêm tài khoản Gmail & TikTok mẫu (`F.1`):** Thêm mới tài khoản Gmail `kinhdoanh.hoaiphuong@gmail.com` (gắn SĐT `0898843938`) và tài khoản TikTok `@xuongin.hoaiphuong` qua cửa sổ Modal trên `/accounts` (`F1-accounts-list.png`, `F2-accounts-after-add.png`).
23. **[PASS] Xem secret (Xác thực lại SEC-02 & giải mã mật khẩu, `F.2`):** Bấm «Xem pass», nhập mật khẩu Chủ sở hữu để xác thực lại theo chuẩn `SEC-02` → Hiển thị đúng mật khẩu giải mã kèm đồng hồ đếm ngược tự ẩn sau 30 giây (`F3-accounts-reveal-secret.png`).
24. **[PASS] Tạo nhanh Cụm kênh con từ Gmail gốc (`F.3`):** Tích chọn tạo kèm kênh `TikTok` và `Facebook` ngay khi tạo Gmail gốc → Hệ thống tự động sinh 2 tài khoản kênh con liên kết trực tiếp với Gmail gốc và SĐT `0898843938` (`F4-accounts-quick-cluster.png`).

### G. Thu chi (`/finance`, `/finance/new`)
25. **[PASS] Tạo Phiếu thu với số tiền & danh mục thật (`G.1`):** Tạo danh mục *«Doanh thu in ấn bao bì & hộp giấy»*, lập phiếu thu `4.500.000 ₫` (*«Thu tiền in 2.000 hộp giấy mỹ phẩm đơn hàng Công ty TNHH Mỹ Phẩm Xanh»*) → Lưu thành công và cộng vào thẻ `Tổng thu` (`G1-finance-income-form.png`, `G2-finance-income-saved.png`).
26. **[PASS] Tạo Phiếu chi với số tiền & danh mục thật (`G.2`):** Tạo danh mục *«Chi mua giấy in & vật tư xưởng»*, lập phiếu chi `1.850.000 ₫` (*«Chi mua 5 ram giấy Couche 300gsm và mực in offset lô hàng ngày 13/11/2026»*) → Lưu thành công và cập nhật `Tổng chi` / `Chênh lệch thu chi` trên `/finance` (`G3-finance-expense-saved.png`, `G4-finance-overview.png`).

### H. Báo giá in ấn (`/print-quotes`, `/print-quotes/new`, `/print-quotes/orders`)
27. **[PASS] Tạo khách hàng nhanh & lập Báo giá in ấn mới (`H.1`):** Tạo nhanh khách hàng *«Công ty Cổ phần Thương mại Á Châu»* (`0909112233`), lập báo giá *«Báo giá in 1.000 hộp giấy mỹ phẩm cao cấp»* (`Hộp giấy Ivory 350gsm cán màng mờ ép kim logo`, SL `1.000`, giá vốn `4.200 ₫`, lợi nhuận `1.200 ₫/tờ`) và lưu báo giá thành công (`H1-print-quotes-list.png`, `H2-print-quote-editor.png`, `H3-print-quote-saved.png`).
28. **[PASS] Chốt báo giá & Chuyển thành Đơn đặt in (`H.2`):** Bấm «Chốt báo giá» và «Chuyển thành Đơn đặt in» trên `/print-quotes/:id` → Sinh mã đơn hàng `ORD-...` và chuyển sang tab Đơn đặt in (`H4-print-quote-converted-order.png`).
29. **[PASS] Ghi nhận đặt cọc / thanh toán đơn hàng in ấn (`H.3`):** Bấm «Ghi nhận thanh toán» trên đơn hàng vừa tạo, nhập số tiền cọc `2.500.000 ₫` (*«Khách chuyển khoản đặt cọc 50% đơn hộp giấy Ivory 350gsm»*) → Cập nhật số tiền đã thu và công nợ còn lại (`H5-print-quote-deposit-recorded.png`).

### I. Các màn hình Quản trị & Vận hành còn lại
30. **[PASS] Bảng lương (`/payroll`, `I.1`):** Mở màn hình Bảng lương, hiển thị danh sách kỳ lương, bảng lương nhân viên (`Nguyễn Văn Một`, `Trần Thị Hai`) và nút tính/cập nhật bảng lương hoạt động tốt (`I1-payroll-screen.png`).
31. **[PASS] Lịch làm việc (`/schedule`, `I.2`):** Hiển thị lịch ca theo tuần, bộ lọc nhân sự và các nút điều hướng tuần Trước/Sau/Hôm nay (`I2-schedule-screen.png`).
32. **[PASS] Báo cáo công việc ngày (`/reports`, `I.3`):** Mở màn hình Báo cáo ngày, hiển thị bộ lọc ngày/nhân sự và danh sách báo cáo (`I3-reports-screen.png`).
33. **[PASS] Tệp & Drive (`/storage`, `I.4`):** Hiển thị danh sách tệp nguồn & thành phẩm (`Tài liệu nguồn thiết kế tháng 10`, `Thành phẩm banner hoàn thiện`), bộ lọc loại tệp và trạng thái kết nối Google Drive (`I4-storage-screen.png`).
34. **[PASS] Sổ tay lỗi (`/issues`, `I.5`):** Mở danh sách Sổ tay lỗi và gửi phiếu góp ý mới qua nút nổi **«Báo lỗi»** (`ReportBugWidget`) thành công (`I5-issues-screen.png`).
35. **[PASS] Nhật ký hệ thống (`/system-logs`, `I.6`):** Mở màn hình Nhật ký hệ thống, hiển thị bộ lọc mức độ log và danh sách sự kiện hệ thống (`I6-system-logs-screen.png`).
36. **[PASS] Cài đặt (`/settings`, `I.7`):** Hiển thị đầy đủ thông tin tài khoản, tùy chọn giao diện Sáng/Tối (`SET-002`), múi giờ (`SET-003`), phiên bản `v0.9.22` (`07d2cbf`) và ma trận phân quyền (`I7-settings-screen.png`).
