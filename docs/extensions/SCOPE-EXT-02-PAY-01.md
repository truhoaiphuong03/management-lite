# SCOPE-EXT-02 — PAY-01 POLICY-01 SPECIFICATION (V0.2 EXTENSION)

**Tài liệu:** Quyết định phê duyệt phạm vi & Quy cách kỹ thuật Module PAY (Tiền lương & Thanh toán)  
**Thẩm quyền:** Phê duyệt chính sách `PAY-01 POLICY-01` từ Chủ sở hữu (Owner) & Chỉ thị Hiệu chỉnh `REVIEW CORRECTION-01`  
**Phiên bản:** `0.2.0-ext.02-approved`  
**Baseline tham chiếu:** `feat/v0.2-schedule-01` (`3d29c9904e794620e5238236fb0259645e2a9c1e`)  
**Nhánh triển khai:** `feat/v0.2-pay-01`  
**Trạng thái:** Phase A Checkpoint PASS (Governance Exception Approved) — Mở khóa triển khai Phase B

---

## 1. Tuyên bố Quyền hạn, Phạm vi & Ngoại lệ Quản trị (Governance Exception)

1. **Phê duyệt của Chủ sở hữu (Owner Approval):** Owner đã chính thức phê duyệt **`GOVERNANCE-EXCEPTION PAY-024/V0.2`** và ủy quyền triển khai `PAY-01` (V0.2) theo `POLICY-01`.
2. **Thứ bậc áp dụng (Governance Precedence Rule):**
   - Ngoại lệ do Owner phê duyệt **CHỈ ÁP DỤNG THAY THẾ QUY TẮC LÀM TRÒN CỦA `PAY-024` CHO PHẠM VI MODULE PAY-01 TRÊN NHÁNH V0.2 (`feat/v0.2-pay-01`)**.
   - **Bảo toàn Canonical V0.1:** Toàn bộ 59 tài liệu canonical của V0.1 (`0.1.0-doc.21`) và SHA-256 manifest được giữ nguyên vẹn 100%, không sửa đổi hoặc xóa bỏ quy định cũ.
   - **Không hồi tố:** Không thay đổi dữ liệu hoặc hồi tố bất kỳ logic nào thuộc V0.1.
3. **Phạm vi khóa cứng:** Không mở rộng sang các loại thưởng, phụ cấp, giảm trừ chung nếu chưa có Owner approval riêng; chỉ có **`paid_leave` (nghỉ có lương)** là khoản ngoại lệ duy nhất được phê duyệt hạch toán kèm lý do bắt buộc.
4. **Cơ sở nhánh (Branching Strategy):** Nhánh `feat/v0.2-pay-01` được tạo từ `feat/v0.2-schedule-01` (`3d29c9904e794620e5238236fb0259645e2a9c1e`), kế thừa trọn vẹn FAST MVP và SCHEDULE-01 R09. PAY chỉ đọc dữ liệu chấm công ATT, tuyệt đối không mutate ATT.
5. **Trạng thái:** **PHASE A CHECKPOINT PASS** — Đã hoàn thành thẩm định, không còn xung đột, chính thức mở Phase B Implementation.

---

## 2. Các Khóa Chính sách Nghiệp vụ & Hiệu chỉnh Thiết kế (Review Correction-01)

### 2.1. Phân Tách 3 Tầng Thu Nhập (Income Classification Tiers)

Hệ thống phân định rạch ròi 3 tầng thu nhập trong giao diện và API, tuyệt đối không gộp chung vào tiền đã xác nhận và không làm sai lệch ý nghĩa pháp lý của dữ liệu:

```
[Attendance Data]
       │
       ├── Ca Completed + Approved ──────> [1. CONFIRMED PAY] (Duy nhất được chốt & chi trả)
       │
       ├── Ca Completed + Unreviewed ────> [2. PENDING-REVIEW PAY] (Dự kiến chờ duyệt, tách biệt)
       │
       └── Ca Working / Paused ──────────> [3. LIVE PROVISIONAL PAY] (Chiếu thời gian thực as_of)
```

1. **Tầng 1: Lương đã xác nhận (Confirmed Pay)**
   - **Điều kiện:** Ca làm việc đã hoàn thành (`run_state = 'completed'`) VÀ đã được Owner phê duyệt chính thức (`review_state = 'approved'`).
   - Lấy từ phiên bản bất biến hiện tại (`attendance_shift_versions` qua `current_version_id`), đã trừ toàn bộ thời gian nghỉ không lương (`attendance_breaks`).
   - **Ý nghĩa:** Đây là nguồn dữ liệu duy nhất có giá trị pháp lý để tính lương thực nhận, đưa vào bảng lương chốt (`finalization`) và chi trả (`disbursement`).

2. **Tầng 2: Lương dự kiến chờ duyệt (Pending-Review Pay)**
   - **Điều kiện:** Ca làm việc đã hoàn thành (`run_state = 'completed'`) nhưng đang ở trạng thái chờ duyệt (`review_state = 'unreviewed'` hoặc `needs_review`).
   - **Ý nghĩa:** Nhân viên đã tan ca nhưng Owner chưa thực hiện thao tác duyệt. Hệ thống tính toán và hiển thị ở một mục riêng biệt: _"Dự kiến (Chờ duyệt)"_ kèm số phút và số tiền tương ứng.
   - **Ràng buộc:** Tuyệt đối không gộp vào Confirmed Pay. Khi Owner thực hiện chốt bảng lương kỳ (`finalization`), nếu vẫn còn ca pending-review trong kỳ, hệ thống sẽ cảnh báo rõ số ca còn chờ duyệt; ca chưa duyệt sẽ không được tính vào kỳ chốt này (chờ duyệt để kết chuyển sang kỳ sau hoặc yêu cầu Owner xử lý dứt điểm trước khi chốt).

3. **Tầng 3: Lương tạm tính thời gian thực ca đang mở (Live Provisional Pay)**
   - **Điều kiện:** Ca làm việc đang diễn ra (`run_state = 'working'` hoặc `run_state = 'paused'`).
   - **Công thức tính:** Tính từ thời điểm `clock_in_at` đến thời điểm máy chủ tiếp nhận request (`server_as_of`), trừ đi:
     - Các khoảng nghỉ `attendance_breaks` đã kết thúc (`ended_at - started_at`).
     - Nếu ca đang ở trạng thái `paused`: trừ tiếp khoảng nghỉ hiện tại từ `break.started_at` đến `server_as_of`.
   - **Ràng buộc an toàn:** Đây là phép chiếu đọc thuần túy (read-only in-memory projection). **TUYỆT ĐỐI KHÔNG MUTATE ATT**, không ghi cập nhật thời gian tạm này vào bảng `attendance_shifts`. Không thể dùng tầng này để chốt lương hay chi trả.

### 2.2. Bảo Toàn Độ Chính Xác Thời Gian & Không "Floor" Từng Phân Đoạn (Precision Across Boundaries)

1. **Vấn đề phân tách đoạn (Interval Splitting):**
   Một ca làm việc có thể bị chia thành nhiều phân đoạn $[start, end)$ do:
   - Ca làm việc xuyên nửa đêm: phân tách tại ranh giới ngày `00:00:00` theo múi giờ `Asia/Ho_Chi_Minh` (tuân thủ `PAY-021`).
   - Mức lương thay đổi theo mốc hiệu lực: phân tách tại `effective_from` / `effective_to` của mức lương (tuân thủ `PAY-022`).
   - Khoảng nghỉ không lương (`attendance_breaks`).

2. **Nguyên tắc bảo toàn giây tuyệt đối (No Floor per Segment):**
   - **CẤM:** Tuyệt đối không làm tròn xuống phút $\lfloor \text{worked\_seconds} / 60 \rfloor$ tại từng phân đoạn con. Nếu làm tròn xuống ở từng đoạn nhỏ, việc chia ca sẽ làm thất thoát thời gian của nhân viên (ví dụ: đoạn 1 có 14 phút 50 giây bị floor thành 14 phút; đoạn 2 có 15 phút 10 giây bị floor thành 15 phút $\rightarrow$ tổng 30 phút bị mất 1 phút).
   - **CHUẨN KỸ THUẬT:** Mọi phân đoạn thời gian đều giữ nguyên độ chính xác đến **từng giây nguyên (exact integer seconds)**:
     $$\text{segment\_seconds} = \text{EXTRACT(EPOCH FROM (segment\_end\_at - segment\_start\_at))}$$
   - Tiền công thô của từng phân đoạn được tính toán bằng số học chính xác cao (rational arithmetic / `NUMERIC(18, 4)`):
     $$\text{segment\_raw\_wage} = \frac{\text{hourly\_rate\_vnd}}{3600} \times \text{segment\_seconds}$$

3. **Tổng hợp cấp ngày & Quy đổi phút:**
   - Trong cùng một ngày làm việc (theo lịch địa phương `Asia/Ho_Chi_Minh`):
     - Tổng số giây làm việc hợp lệ trong ngày: $\text{daily\_worked\_seconds} = \sum \text{segment\_seconds}$.
     - Số phút làm việc tương đương hiển thị trên giao diện:
       $$\text{daily\_display\_minutes} = \lfloor \text{daily\_worked\_seconds} / 60 \rfloor \quad (\text{kèm số giây dư: } \text{daily\_worked\_seconds} \pmod{60})$$
     - Tổng tiền công thô của ngày:
       $$\text{daily\_raw\_wage} = \sum_{\text{segments in day}} \text{segment\_raw\_wage} = \sum \left( \frac{\text{hourly\_rate}}{3600} \times \text{segment\_seconds} \right)$$
     - Tiền công làm tròn của ngày theo quy tắc bán chẵn/bán lên chuẩn quốc tế (**`ROUND_HALF_UP`**) đến đúng 1 VNĐ:
       $$\text{daily\_rounded\_wage} = \text{ROUND\_HALF\_UP}(\text{daily\_raw\_wage})$$

### 2.3. Đối Chiếu PAY-024 và POLICY-01 — Ngoại Lệ Quản Trị Đã Được Phê Duyệt (`GOVERNANCE-EXCEPTION PAY-024/V0.2`)

Chủ sở hữu (Owner) đã chính thức phê duyệt **`GOVERNANCE-EXCEPTION PAY-024/V0.2`** với các quy định và thứ bậc quản trị rõ ràng:

| Tiêu chí               | Canonical V0.1 (`PAY-024` — Doc 07 & 20)                                                                                                                                  | Ngoại lệ Phê duyệt V0.2 (`PAY-01 POLICY-01`)                                                                                                               |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quy tắc làm tròn**   | **Monthly-level Rounding:** Tính tổng số hữu tỉ tiền công toàn bộ kỳ lương của nhân viên, sau đó làm tròn bán chẵn/bán lên (half-up) **DUY NHẤT MỘT LẦN** ở cấp kỳ lương. | **Daily-level Rounding:** Làm tròn bán chẵn/bán lên (**`ROUND_HALF_UP`**) đến **1 VNĐ TRÊN TỔNG TIỀN CÔNG TỪNG NGÀY**, sau đó cộng dồn các ngày vào tháng. |
| **Công thức**          | $\text{base\_pay} = \text{ROUND\_HALF\_UP}\left(\sum_{\text{month}} \text{segment\_raw\_wage}\right)$                                                                     | $\text{base\_pay} = \sum_{\text{days in month}} \text{ROUND\_HALF\_UP}\left(\sum_{\text{day}} \text{segment\_raw\_wage}\right)$                            |
| **Tính minh bạch**     | Minh bạch kỳ lương nhưng tiền công ngày lẻ có phần thập phân hoặc tổng ngày lệch $\pm 1$ VNĐ.                                                                             | Minh bạch tuyệt đối trên phiếu lương từng ngày (mỗi ngày là số nguyên VNĐ tròn trĩnh), chuẩn hóa cho Staff & Owner.                                        |
| **Thẩm quyền pháp lý** | Giữ nguyên vẹn 100% trong 59 Canonical Docs V0.1 (`0.1.0-doc.21`).                                                                                                        | Được Owner phê chuẩn ngoại lệ thứ bậc: **CHỈ THAY THẾ CHO MODULE PAY-01 TRÊN V0.2**.                                                                       |

> [!NOTE]
> **THỨ BẬC QUẢN TRỊ & NGUYÊN TẮC ÁP DỤNG:**
>
> 1. Ngoại lệ Owner phê duyệt **chỉ thay thế quy tắc làm tròn của `PAY-024` cho phạm vi Module PAY-01 V0.2**.
> 2. Giữ nguyên 59 tài liệu canonical V0.1 hiện hành; không sửa hoặc xóa quy định gốc.
> 3. Tuyệt đối không hồi tố hay làm thay đổi bất kỳ cấu trúc, dữ liệu lịch sử nào của V0.1.
> 4. Không mở rộng sang bonus, allowance, deduction chung nếu chưa có Owner approval; `paid_leave` là ngoại lệ duy nhất được phê duyệt.
> 5. Trạng thái: **GOVERNANCE EXCEPTION PASS** — Không còn xung đột cản trở. Sẵn sàng cho triển khai Phase B.

### 2.4. Mức Lương theo Giờ & Xử Lý Thiếu Mức Lương (Pay Rates & Missing Rate Guard)

- **Mức lương theo giờ (VND/Hour):** Lưu trong `employee_hourly_rates` kèm mốc hiệu lực `effective_from` (timestamptz) và `effective_to` (timestamptz nullable).
- **RÀNG BUỘC CHẶN THIẾU MỨC LƯƠNG (`PAY-028`):**
  - Mức lương thiếu **TUYỆT ĐỐI KHÔNG ĐƯỢC COI LÀ 0 VNĐ**.
  - Nếu một nhân viên có ca làm việc hoàn thành đã duyệt nhưng tại thời điểm đó chưa có bản ghi `employee_hourly_rates` có hiệu lực:
    - Thao tác tính toán/chốt bảng lương kỳ (`finalize`) bị **CHẶN NGAY LẬP TỨC** với mã lỗi `422 MISSING_HOURLY_RATE`.
    - Trả về chi tiết ID nhân viên và khoảng thời gian thiếu mức lương.
    - Owner bắt buộc phải bổ sung cấu hình mức lương cho nhân viên trước khi có thể chốt bảng lương.

### 2.5. Nghỉ có Lương là Khoản Phụ Cấp Riêng Biệt (Paid Leave Policy)

- Ngày nghỉ có lương (phép năm, lễ, tết có lương) **KHÔNG ĐƯỢC CỘNG VÀO SỐ GIÂY/PHÚT QUẸT THẺ CHẤM CÔNG THỰC TẾ** của module ATT.
- Ghi nhận độc lập dưới dạng một khoản phụ cấp chuyên biệt (`adjustment_type = 'paid_leave'`) trong bảng `payroll_adjustments`.
- **Ràng buộc bắt buộc:**
  - `attributable_date`: Ngày nghỉ có lương tương ứng (bắt buộc).
  - `amount_vnd`: Số tiền trợ cấp nghỉ có lương (số nguyên dương $> 0$).
  - `reason`: Lý do cụ thể bắt buộc (ví dụ: "Nghỉ phép năm theo quy định", "Nghỉ lễ Quốc khánh 02/09").

### 2.6. Chặn Nghiêm Ngặt Lương Thực Nhận Âm (Negative Net Pay Block — Canonical C04)

- **Công thức tính lương thực nhận:**
  $$\text{net\_pay\_vnd} = \text{base\_pay\_vnd} + \text{paid\_leave\_pay\_vnd} + \text{allowances\_vnd} + \text{bonuses\_vnd} - \text{deductions\_vnd}$$
- **Quy tắc chặn tuyệt đối:** Nếu bất kỳ nhân viên nào trong kỳ lương có $\text{net\_pay\_vnd} < 0$:
  - Thao tác chốt lương kỳ (`finalization`) bị **TỪ CHỐI TOÀN BỘ (FAIL-CLOSED)**.
  - Toàn bộ transaction bị rollback, trả về mã lỗi `422 NEGATIVE_NET_PAY` kèm danh sách ID nhân viên bị âm.
  - Không cho phép chốt kỳ lương dở dang, không tự ý gán lương âm về 0, không âm thầm chuyển nợ sang tháng sau.

### 2.7. Tính Bất Biến của Bảng Lương Đã Chốt (Finalized Payroll Immutability — PAY-027)

- Khi kỳ lương chuyển sang `status = 'finalized'`:
  - Toàn bộ dữ liệu kỳ lương, bảng lương nhân viên, phân rã ngày và các khoản điều chỉnh trở thành **BẤT BIẾN (IMMUTABLE)**.
  - Được bảo vệ bằng database trigger ngăn chặn mọi hành vi `UPDATE` hoặc `DELETE`.
  - Nghiêm cấm mọi hành vi sửa ngầm (no silent mutation) sau khi đã chốt. Mọi điều chỉnh phát sinh sau khi chốt bắt buộc phải đi qua quy trình bút toán bù trừ có lưu vết (append-only settlement ledger) ở kỳ lương tiếp theo.

### 2.8. Thanh Toán Nhiều Đợt & Bảo Vệ Chống Trả Thừa (Disbursements & Overpayment Guard)

- Cho phép Owner ghi nhận chi trả lương thành nhiều đợt (tạm ứng, thanh toán đợt 1, đợt 2...).
- Mỗi đợt ghi nhận vào bảng `payroll_disbursements` (append-only, cấm UPDATE/DELETE).
- **Ràng buộc kiểm soát trả thừa:**
  $$\sum \text{disbursements.amount\_vnd} \le \text{employee\_item.net\_pay\_vnd}$$
  Bất kỳ yêu cầu chi trả nào vượt quá số tiền thực nhận còn lại sẽ bị từ chối với lỗi `422 OVERPAYMENT_BLOCKED`.
- **Theo dõi thủ công:** Chỉ quản lý trạng thái thanh toán (`unpaid`, `partially_paid`, `paid`), **TUYỆT ĐỐI KHÔNG TỰ ĐỘNG CHUYỂN TIỀN** qua ngân hàng.

### 2.9. Phân Quyền Nghiêm Ngặt & Loại Trừ Chủ Sở Hữu (RBAC & PAY-025)

- **Owner không có lương (`PAY-025`):** Chủ sở hữu (Owner) có thể chấm công quẹt thẻ để kiểm thử hệ thống nhưng **KHÔNG ĐƯỢC ĐƯA VÀO BẢNG TÍNH LƯƠNG**. Tuyệt đối không sinh bản ghi `payroll_employee_items` cho Owner.
- **Bảo mật thông tin lương Staff:** Nhân viên (Staff) chỉ được xem phiếu lương và chi tiết của chính mình (`/api/v1/payroll/periods/:month/me`). Mọi hành vi cố tình truy cập xem lương của nhân viên khác đều bị từ chối ngay lập tức với mã lỗi `403 FORBIDDEN`.

---

## 3. Ranh Giới Module & Nguyên Tắc Không Gây Đột Biến (Module Boundaries & Immutability)

| Module  | Sở hữu (Owns)                                                                                                                                             | Chỉ đọc (May Read)                                                                                                                   | Tuyệt đối không làm (Forbidden)                                                              |
| :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| **PAY** | `employee_hourly_rates`, `payroll_periods`, `payroll_employee_items`, `payroll_daily_breakdowns`, `payroll_adjustments`, `payroll_disbursements`          | `ATT` (`attendance_shifts`, `attendance_shift_versions`, `attendance_approvals`), `HR` (`employees`), `AUTH` (`workspaces`, `users`) | **Tuyệt đối không sửa đổi (mutate) dữ liệu chấm công ATT**, không can thiệp vào ca đang chạy |
| **ATT** | `attendance_shifts`, `attendance_breaks`, `attendance_shift_versions`, `attendance_approvals`, `attendance_correction_requests`, `attendance_adjustments` | `HR`, `AUTH`                                                                                                                         | Không can thiệp vào công thức lương hay trạng thái thanh toán                                |
| **HR**  | `employees`                                                                                                                                               | `AUTH`                                                                                                                               | Không sửa bảng lương                                                                         |

---

## 4. Từ Điển Dữ Liệu Cơ Sở Dữ Liệu (Schema V0.2 Dự Kiến — Migration 0009_m07_payroll.sql)

_(Lưu ý: Schema được thiết kế chuẩn bị cho Phase B, CHƯA ĐƯỢC TẠO FILE MIGRATION trong Phase A)_

### 4.1. Bảng `employee_hourly_rates` (Mức lương theo giờ của nhân viên)

| Tên cột           | Kiểu dữ liệu  | Ràng buộc                                                            | Mô tả                                     |
| :---------------- | :------------ | :------------------------------------------------------------------- | :---------------------------------------- |
| `id`              | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                              | Khóa chính                                |
| `workspace_id`    | `uuid`        | `NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT`              | Tenant container                          |
| `employee_id`     | `uuid`        | `NOT NULL`                                                           | Nhân viên được áp dụng                    |
| `hourly_rate_vnd` | `bigint`      | `NOT NULL CHECK (hourly_rate_vnd >= 0)`                              | Mức lương VNĐ/giờ                         |
| `effective_from`  | `timestamptz` | `NOT NULL`                                                           | Thời điểm bắt đầu có hiệu lực             |
| `effective_to`    | `timestamptz` | `NULL CHECK (effective_to IS NULL OR effective_to > effective_from)` | Thời điểm hết hiệu lực (NULL = hiện hành) |
| `created_by`      | `uuid`        | `NOT NULL REFERENCES users(id) ON DELETE RESTRICT`                   | Người thiết lập                           |
| `created_at`      | `timestamptz` | `NOT NULL DEFAULT now()`                                             | Thời gian tạo                             |

- **Ràng buộc duy nhất:** `UNIQUE (workspace_id, id)`
- **Khóa ngoại composite:** `FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) ON DELETE RESTRICT`
- **Chỉ mục:** `CREATE INDEX ix_employee_hourly_rates_lookup ON employee_hourly_rates (workspace_id, employee_id, effective_from DESC)`

### 4.2. Bảng `payroll_periods` (Kỳ lương theo tháng)

| Tên cột                   | Kiểu dữ liệu  | Ràng buộc                                                           | Mô tả                              |
| :------------------------ | :------------ | :------------------------------------------------------------------ | :--------------------------------- |
| `id`                      | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                             | Khóa chính                         |
| `workspace_id`            | `uuid`        | `NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT`             | Tenant container                   |
| `period_month`            | `text`        | `NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]\|1[0-2])$')`     | Tháng kỳ lương (`YYYY-MM`)         |
| `starts_on`               | `date`        | `NOT NULL`                                                          | Ngày bắt đầu tháng (`YYYY-MM-01`)  |
| `ends_on`                 | `date`        | `NOT NULL CHECK (ends_on >= starts_on)`                             | Ngày kết thúc tháng (`YYYY-MM-DD`) |
| `timezone`                | `text`        | `NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'`                               | Múi giờ chuẩn tính toán            |
| `status`                  | `text`        | `NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized'))` | Trạng thái kỳ lương                |
| `calculation_revision`    | `integer`     | `NOT NULL DEFAULT 1 CHECK (calculation_revision > 0)`               | Phiên bản tính toán                |
| `finalized_at`            | `timestamptz` | `NULL`                                                              | Thời điểm chốt bảng lương          |
| `finalized_by`            | `uuid`        | `NULL REFERENCES users(id) ON DELETE RESTRICT`                      | Người thực hiện chốt lương         |
| `finalized_snapshot_hash` | `text`        | `NULL`                                                              | Mã băm toàn vẹn snapshot khi chốt  |
| `version`                 | `integer`     | `NOT NULL DEFAULT 1 CHECK (version > 0)`                            | Version guard phục vụ If-Match     |
| `created_at`              | `timestamptz` | `NOT NULL DEFAULT now()`                                            | Thời gian tạo                      |
| `updated_at`              | `timestamptz` | `NOT NULL DEFAULT now()`                                            | Thời gian cập nhật                 |

- **Ràng buộc duy nhất:** `UNIQUE (workspace_id, period_month)`, `UNIQUE (workspace_id, id)`

### 4.3. Bảng `payroll_employee_items` (Bảng lương tổng hợp từng nhân viên)

| Tên cột                   | Kiểu dữ liệu  | Ràng buộc                                                                                  | Mô tả                                   |
| :------------------------ | :------------ | :----------------------------------------------------------------------------------------- | :-------------------------------------- |
| `id`                      | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                                                    | Khóa chính                              |
| `workspace_id`            | `uuid`        | `NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT`                                    | Tenant container                        |
| `period_id`               | `uuid`        | `NOT NULL`                                                                                 | Kỳ lương                                |
| `employee_id`             | `uuid`        | `NOT NULL`                                                                                 | Nhân viên nhận lương (không chứa Owner) |
| `approved_worked_seconds` | `bigint`      | `NOT NULL DEFAULT 0 CHECK (approved_worked_seconds >= 0)`                                  | Tổng số giây làm việc đã duyệt          |
| `approved_worked_minutes` | `integer`     | `NOT NULL DEFAULT 0 CHECK (approved_worked_minutes >= 0)`                                  | Số phút tương đương hiển thị            |
| `base_pay_vnd`            | `bigint`      | `NOT NULL DEFAULT 0 CHECK (base_pay_vnd >= 0)`                                             | Lương cơ bản                            |
| `paid_leave_pay_vnd`      | `bigint`      | `NOT NULL DEFAULT 0 CHECK (paid_leave_pay_vnd >= 0)`                                       | Tiền phụ cấp nghỉ có lương              |
| `allowance_vnd`           | `bigint`      | `NOT NULL DEFAULT 0 CHECK (allowance_vnd >= 0)`                                            | Tổng phụ cấp khác                       |
| `bonus_vnd`               | `bigint`      | `NOT NULL DEFAULT 0 CHECK (bonus_vnd >= 0)`                                                | Tổng tiền thưởng                        |
| `deduction_vnd`           | `bigint`      | `NOT NULL DEFAULT 0 CHECK (deduction_vnd >= 0)`                                            | Tổng tiền phạt / giảm trừ               |
| `net_pay_vnd`             | `bigint`      | `NOT NULL`                                                                                 | Lương thực nhận (khi chốt phải $\ge 0$) |
| `paid_amount_vnd`         | `bigint`      | `NOT NULL DEFAULT 0 CHECK (paid_amount_vnd >= 0)`                                          | Tổng tiền đã chi trả thực tế            |
| `payment_status`          | `text`        | `NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid'))` | Trạng thái thanh toán                   |
| `version`                 | `integer`     | `NOT NULL DEFAULT 1 CHECK (version > 0)`                                                   | Version guard If-Match                  |
| `created_at`              | `timestamptz` | `NOT NULL DEFAULT now()`                                                                   | Thời gian tạo                           |
| `updated_at`              | `timestamptz` | `NOT NULL DEFAULT now()`                                                                   | Thời gian cập nhật                      |

- **Ràng buộc duy nhất:** `UNIQUE (workspace_id, period_id, employee_id)`, `UNIQUE (workspace_id, id)`
- **Khóa ngoại composite:**
  - `FOREIGN KEY (workspace_id, period_id) REFERENCES payroll_periods(workspace_id, id) ON DELETE RESTRICT`
  - `FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) ON DELETE RESTRICT`

### 4.4. Bảng `payroll_daily_breakdowns` (Chi tiết & Làm tròn từng ngày)

| Tên cột                    | Kiểu dữ liệu     | Ràng buộc                                               | Mô tả                                      |
| :------------------------- | :--------------- | :------------------------------------------------------ | :----------------------------------------- |
| `id`                       | `uuid`           | `PRIMARY KEY DEFAULT gen_random_uuid()`                 | Khóa chính                                 |
| `workspace_id`             | `uuid`           | `NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT` | Tenant container                           |
| `payroll_item_id`          | `uuid`           | `NOT NULL`                                              | Bảng lương nhân viên                       |
| `work_date`                | `date`           | `NOT NULL`                                              | Ngày làm việc cụ thể                       |
| `shift_count`              | `integer`        | `NOT NULL DEFAULT 0 CHECK (shift_count >= 0)`           | Số ca làm việc trong ngày                  |
| `worked_seconds`           | `bigint`         | `NOT NULL DEFAULT 0 CHECK (worked_seconds >= 0)`        | Tổng số giây thực tế trong ngày            |
| `worked_minutes`           | `integer`        | `NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0)`        | Số phút tương đương hiển thị               |
| `hourly_rate_vnd_snapshot` | `bigint`         | `NOT NULL CHECK (hourly_rate_vnd_snapshot >= 0)`        | Mức lương/giờ áp dụng                      |
| `raw_wage_vnd`             | `numeric(18, 4)` | `NOT NULL CHECK (raw_wage_vnd >= 0)`                    | Tiền công thô chính xác                    |
| `rounded_wage_vnd`         | `bigint`         | `NOT NULL CHECK (rounded_wage_vnd >= 0)`                | Tiền công làm tròn 1 VNĐ (`ROUND_HALF_UP`) |
| `created_at`               | `timestamptz`    | `NOT NULL DEFAULT now()`                                | Thời gian tạo                              |

- **Ràng buộc duy nhất:** `UNIQUE (workspace_id, payroll_item_id, work_date)`, `UNIQUE (workspace_id, id)`
- **Khóa ngoại composite:** `FOREIGN KEY (workspace_id, payroll_item_id) REFERENCES payroll_employee_items(workspace_id, id) ON DELETE CASCADE`

### 4.5. Bảng `payroll_adjustments` (Thưởng, Phụ cấp, Giảm trừ, Nghỉ có lương)

| Tên cột             | Kiểu dữ liệu  | Ràng buộc                                                                               | Mô tả                                      |
| :------------------ | :------------ | :-------------------------------------------------------------------------------------- | :----------------------------------------- |
| `id`                | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                                                 | Khóa chính                                 |
| `workspace_id`      | `uuid`        | `NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT`                                 | Tenant container                           |
| `payroll_item_id`   | `uuid`        | `NOT NULL`                                                                              | Bảng lương nhân viên                       |
| `adjustment_type`   | `text`        | `NOT NULL CHECK (adjustment_type IN ('bonus', 'allowance', 'deduction', 'paid_leave'))` | Loại điều chỉnh                            |
| `amount_vnd`        | `bigint`      | `NOT NULL CHECK (amount_vnd > 0)`                                                       | Số tiền điều chỉnh VNĐ                     |
| `attributable_date` | `date`        | `NULL`                                                                                  | Ngày phát sinh (bắt buộc với `paid_leave`) |
| `reason`            | `text`        | `NOT NULL`                                                                              | Lý do phát sinh                            |
| `created_by`        | `uuid`        | `NOT NULL REFERENCES users(id) ON DELETE RESTRICT`                                      | Người tạo                                  |
| `created_at`        | `timestamptz` | `NOT NULL DEFAULT now()`                                                                | Thời gian tạo                              |

- **Ràng buộc duy nhất:** `UNIQUE (workspace_id, id)`
- **Khóa ngoại composite:** `FOREIGN KEY (workspace_id, payroll_item_id) REFERENCES payroll_employee_items(workspace_id, id) ON DELETE RESTRICT`

### 4.6. Bảng `payroll_disbursements` (Chi trả Lương Thực tế — Append-only)

| Tên cột              | Kiểu dữ liệu  | Ràng buộc                                                                                       | Mô tả                     |
| :------------------- | :------------ | :---------------------------------------------------------------------------------------------- | :------------------------ |
| `id`                 | `uuid`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                                                         | Khóa chính                |
| `workspace_id`       | `uuid`        | `NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT`                                         | Tenant container          |
| `payroll_item_id`    | `uuid`        | `NOT NULL`                                                                                      | Bảng lương nhân viên      |
| `disbursement_order` | `integer`     | `NOT NULL CHECK (disbursement_order > 0)`                                                       | Đợt chi trả (1, 2, 3...)  |
| `amount_vnd`         | `bigint`      | `NOT NULL CHECK (amount_vnd > 0)`                                                               | Số tiền chi trả đợt này   |
| `payment_method`     | `text`        | `NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('bank_transfer', 'cash', 'other'))` | Phương thức thanh toán    |
| `payment_date`       | `date`        | `NOT NULL`                                                                                      | Ngày thực hiện thanh toán |
| `reference_note`     | `text`        | `NULL`                                                                                          | Mã giao dịch hoặc ghi chú |
| `paid_by`            | `uuid`        | `NOT NULL REFERENCES users(id) ON DELETE RESTRICT`                                              | Người ghi nhận            |
| `created_at`         | `timestamptz` | `NOT NULL DEFAULT now()`                                                                        | Thời gian ghi nhận        |

- **Ràng buộc duy nhất:** `UNIQUE (workspace_id, payroll_item_id, disbursement_order)`, `UNIQUE (workspace_id, id)`
- **Khóa ngoại composite:** `FOREIGN KEY (workspace_id, payroll_item_id) REFERENCES payroll_employee_items(workspace_id, id) ON DELETE RESTRICT`

### 4.7. Triggers Bảo Vệ Tính Toàn Vẹn & Bất Biến (Immutability Guards)

1. **Trigger `prevent_finalized_payroll_mutation`:** Khi `payroll_periods.status = 'finalized'`, chặn mọi thao tác `UPDATE` và `DELETE` trên bảng `payroll_periods`.
2. **Trigger `prevent_finalized_item_mutation`:** Chặn mọi thao tác `UPDATE` hoặc `DELETE` trên bảng `payroll_employee_items`, `payroll_daily_breakdowns`, và `payroll_adjustments` nếu kỳ lương cha đã ở trạng thái `finalized`.
3. **Trigger `prevent_payroll_disbursements_mutation`:** Bảng `payroll_disbursements` là append-only, nghiêm cấm `UPDATE` và `DELETE`.

---

## 5. Danh Mục Hợp Đồng API (API Contracts: API-PAY-01 đến API-PAY-08)

_Lưu ý: Không tái sử dụng mã hợp đồng V0.1 canonical (`API-R01..R13`). Sử dụng định danh chuẩn hóa `API-PAY-`._

### `API-PAY-01`: `GET /api/v1/payroll/rates`

- **Mục đích:** Owner xem danh sách mức lương hiện hành & lịch sử của nhân viên.
- **Phân quyền:** Owner-only (Staff bị từ chối `403 FORBIDDEN`).
- **Phản hồi (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "uuid",
        "employee_id": "uuid",
        "employee_code": "NV-01",
        "full_name": "Nguyen Van A",
        "hourly_rate_vnd": 30000,
        "effective_from": "2026-10-01T00:00:00.000Z",
        "effective_to": null
      }
    ]
  }
  ```

### `API-PAY-02`: `POST /api/v1/payroll/rates`

- **Mục đích:** Owner cấu hình hoặc điều chỉnh mức lương theo giờ (kèm `effective_from`).
- **Phân quyền:** Owner-only.
- **Headers:** `X-CSRF-Token`, `Idempotency-Key` (tùy chọn).
- **Body:**
  ```json
  {
    "employee_id": "uuid",
    "hourly_rate_vnd": 35000,
    "effective_from": "2026-10-15T00:00:00.000Z"
  }
  ```
- **Xử lý:** Cập nhật `effective_to` của rate trước đó và tạo bản ghi rate mới. Ghi audit log.

### `API-PAY-03`: `GET /api/v1/payroll/periods`

- **Mục đích:** Xem danh sách các kỳ lương theo tháng.
- **Phân quyền:** Owner (xem tất cả); Staff (chỉ xem các kỳ mà mình có phiếu lương).

### `API-PAY-04`: `GET /api/v1/payroll/periods/:month`

- **Mục đích:** Owner xem bảng lương tổng hợp toàn bộ nhân viên trong tháng, phân tách rõ 3 tầng thu nhập.
- **Phân quyền:** Owner-only (Staff bị từ chối `403 FORBIDDEN`).
- **Phản hồi (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "period": {
        "id": "uuid",
        "period_month": "2026-10",
        "status": "draft",
        "server_as_of": "2026-10-09T16:15:00.000Z"
      },
      "items": [
        {
          "employee_id": "uuid",
          "employee_code": "NV-01",
          "full_name": "Nguyen Van A",
          "confirmed": {
            "approved_worked_seconds": 576000,
            "approved_worked_minutes": 9600,
            "base_pay_vnd": 4800000,
            "paid_leave_pay_vnd": 200000,
            "allowance_vnd": 100000,
            "bonus_vnd": 500000,
            "deduction_vnd": 0,
            "net_pay_vnd": 5600000,
            "paid_amount_vnd": 2000000,
            "payment_status": "partially_paid"
          },
          "pending_review": {
            "shift_count": 2,
            "pending_seconds": 28800,
            "pending_minutes": 480,
            "estimated_pay_vnd": 240000
          },
          "live_provisional": {
            "has_open_shift": true,
            "current_shift_id": "uuid",
            "working_state": "working",
            "live_seconds": 10800,
            "live_minutes": 180,
            "live_pay_vnd": 90000
          }
        }
      ]
    }
  }
  ```

### `API-PAY-05`: `GET /api/v1/payroll/periods/:month/me`

- **Mục đích:** Nhân viên xem phiếu lương cá nhân, phân tách 3 tầng thu nhập, chi tiết từng ngày và lịch sử thanh toán.
- **Phân quyền:** Staff (hoặc User liên kết Employee).
- **Phản hồi (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "period_month": "2026-10",
      "status": "draft",
      "server_as_of": "2026-10-09T16:15:00.000Z",
      "employee": {
        "id": "uuid",
        "employee_code": "NV-01",
        "full_name": "Nguyen Van A"
      },
      "confirmed": {
        "approved_worked_seconds": 576000,
        "approved_worked_minutes": 9600,
        "base_pay_vnd": 4800000,
        "paid_leave_pay_vnd": 200000,
        "allowance_vnd": 100000,
        "bonus_vnd": 500000,
        "deduction_vnd": 0,
        "net_pay_vnd": 5600000,
        "paid_amount_vnd": 2000000,
        "payment_status": "partially_paid"
      },
      "pending_review": {
        "shift_count": 2,
        "pending_seconds": 28800,
        "pending_minutes": 480,
        "estimated_pay_vnd": 240000
      },
      "live_provisional": {
        "has_open_shift": false,
        "live_seconds": 0,
        "live_minutes": 0,
        "live_pay_vnd": 0
      },
      "daily_breakdowns": [
        {
          "work_date": "2026-10-01",
          "shift_count": 1,
          "worked_seconds": 28800,
          "worked_minutes": 480,
          "hourly_rate_vnd": 30000,
          "rounded_wage_vnd": 240000
        }
      ],
      "adjustments": [
        {
          "adjustment_type": "paid_leave",
          "amount_vnd": 200000,
          "attributable_date": "2026-10-05",
          "reason": "Nghỉ phép năm theo quy định"
        }
      ],
      "disbursements": [
        {
          "disbursement_order": 1,
          "amount_vnd": 2000000,
          "payment_date": "2026-10-15",
          "payment_method": "bank_transfer"
        }
      ]
    }
  }
  ```

### `API-PAY-06`: `POST /api/v1/payroll/periods/:month/adjustments`

- **Mục đích:** Owner thêm thưởng, phụ cấp, giảm trừ, hoặc nghỉ có lương.
- **Phân quyền:** Owner-only.

### `API-PAY-07`: `POST /api/v1/payroll/periods/:month/finalize`

- **Mục đích:** Owner chốt kỳ lương (chỉ chốt từ tầng Confirmed Pay).
- **Phân quyền:** Owner-only.
- **Headers:** `X-CSRF-Token`, `If-Match: "<version>"`, `Idempotency-Key`.
- **Ràng buộc kiểm tra trước khi chốt:**
  1. Kiểm tra thiếu mức lương: Nếu có ca hoàn thành đã duyệt bị thiếu rate $\rightarrow$ trả về `422 MISSING_HOURLY_RATE`.
  2. Kiểm tra lương âm: Nếu có bất kỳ nhân viên nào có $\text{net\_pay\_vnd} < 0$ $\rightarrow$ trả về `422 NEGATIVE_NET_PAY`.
  3. Cảnh báo ca pending-review (nếu có): Thông báo số ca chưa duyệt không được đưa vào kỳ chốt này.

### `API-PAY-08`: `POST /api/v1/payroll/items/:id/disbursements`

- **Mục đích:** Owner ghi nhận đợt chi trả thực tế.
- **Phân quyền:** Owner-only.
- **Kiểm soát bảo vệ chống trả thừa:** Nếu $\text{already\_paid} + \text{amount\_vnd} > \text{item.net\_pay\_vnd}$ $\rightarrow$ trả về `422 OVERPAYMENT_BLOCKED`.

---

## 6. Ma Trận Phân Quyền & Bảo Mật (RBAC Matrix)

| Quyền hạn / Endpoint                           | Chủ sở hữu (Owner) | Nhân viên chính mình (Self Staff) | Nhân viên khác (Other Staff) |
| :--------------------------------------------- | :----------------: | :-------------------------------: | :--------------------------: |
| Cấu hình mức lương (`API-PAY-01/02`)           |    **Cho phép**    |           403 Forbidden           |        403 Forbidden         |
| Xem bảng lương tổng hợp (`API-PAY-04`)         |    **Cho phép**    |           403 Forbidden           |        403 Forbidden         |
| Xem phiếu lương cá nhân (`API-PAY-05`)         | Cho phép (nếu có)  |           **Cho phép**            |        403 Forbidden         |
| Thêm điều chỉnh / Nghỉ có lương (`API-PAY-06`) |    **Cho phép**    |           403 Forbidden           |        403 Forbidden         |
| Chốt bảng lương (`API-PAY-07`)                 |    **Cho phép**    |           403 Forbidden           |        403 Forbidden         |
| Ghi nhận chi trả (`API-PAY-08`)                |    **Cho phép**    |           403 Forbidden           |        403 Forbidden         |

---

## 7. Kế Hoạch Kiểm Thử & Tiêu Chí Nghiệm Thu Thiết Kế (Test Design Matrix)

1. **Kiểm thử 3 Tầng Thu Nhập:**
   - Tạo ca completed + approved $\rightarrow$ xuất hiện trong Confirmed Pay.
   - Tạo ca completed + unreviewed $\rightarrow$ xuất hiện trong Pending-Review Pay, không cộng vào Confirmed Pay.
   - Tạo ca working với 1 break đang mở $\rightarrow$ tính chính xác Live Provisional Pay đến `server_as_of` trừ thời gian break; kiểm tra DB bảng `attendance_shifts` không bị sửa đổi.
2. **Kiểm thử Độ Chính Xác Giây & Ranh Giới:**
   - Ca xuyên nửa đêm (23:45 đến 00:15) $\rightarrow$ phân tách 2 đoạn: đoạn 1 (900 giây), đoạn 2 (900 giây). Tổng giây 1800 giây = 30 phút nguyên. Không bị mất giây nào.
   - Đổi rate giữa ca (08:00–12:00 rate 30k, 12:00–16:00 rate 35k) $\rightarrow$ tính chính xác theo từng đoạn, không floor từng đoạn.
3. **Kiểm thử Ràng Buộc Thiếu Rate & Lương Âm:**
   - Nhân viên thiếu rate $\rightarrow$ finalize trả về `422 MISSING_HOURLY_RATE`.
   - Nhân viên có net pay âm do deduction $\rightarrow$ finalize trả về `422 NEGATIVE_NET_PAY`.
4. **Kiểm thử Chống Trả Thừa:**
   - Chi trả lần 1: hợp lệ.
   - Chi trả lần 2 vượt quá net pay $\rightarrow$ trả về `422 OVERPAYMENT_BLOCKED`.
5. **Kiểm thử RBAC:**
   - Staff A gọi API xem lương Staff B $\rightarrow$ trả về `403 FORBIDDEN`.
   - Owner không sinh bảng lương (`PAY-025`).

---

## 8. Trạng Thái Tổng Kết & Phê Duyệt Triển Khai (Phase Transition)

1. **Trạng thái:** **PHASE A CHECKPOINT PASS — MỞ KHÓA GIAI ĐOẠN PHASE B (IMPLEMENTATION)**.
2. **Ngoại lệ Governance đã hoàn tất phê duyệt:**
   - Owner đã phê duyệt `GOVERNANCE-EXCEPTION PAY-024/V0.2` áp dụng làm tròn 1 VNĐ cấp ngày (`PAY-01 POLICY-01`) cho V0.2.
   - Không còn điểm nghẽn hay xung đột chính sách nào cản trở.
3. **Kế hoạch triển khai Phase B:**
   - Tạo migration `0009_m07_payroll.sql` và cập nhật migration catalog.
   - Xây dựng tầng dịch vụ `PayrollService` trong API.
   - Cài đặt 8 endpoints `API-PAY-01` đến `API-PAY-08`.
   - Xây dựng giao diện web Payroll cho Owner và Staff (dark theme, mobile-first).
   - Kiểm thử toàn diện Phase C và bảo đảm zero regression.
4. **Cam kết an toàn và bảo toàn:**
   - Không sửa 59 canonical documents V0.1.
   - Không merge PR #9 hoặc bất kỳ nhánh nào.
   - Không reset hay xóa cơ sở dữ liệu.
   - Không tự ý triển khai TASK/ACC/FILE trong gói PAY.
