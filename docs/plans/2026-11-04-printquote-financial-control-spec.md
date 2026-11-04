# CỔNG KIỂM SOÁT TÍNH TOÁN TÀI CHÍNH — PRINTQUOTE (`PHASE 0` & `PHASE 1`)

- **Dự án:** `management-lite` (`PrintQuote` — Phân hệ Báo giá & Đơn đặt in, chỉ dành cho `Owner`)
- **Nhánh DEV cô lập:** `feat/printquote-workshop-stages` (`C:\Projects\management-lite-pq-stages`)
- **Ngày lập đặc tả (trước khi code Phase 2):** `2026-11-04`
- **Nguyên tắc cốt lõi:** Số liệu chính xác đến từng đồng (`1 VND`), không trôi dấu phẩy động IEEE-754, mọi con số sau khi lưu đều truy vết được nguồn gốc, bảo toàn tuyệt đối `100%` dữ liệu & ý nghĩa của các báo giá cũ (`V1/V2`), và không tự đặt quy tắc tài chính bằng suy đoán.

---

## PHẦN I — PHASE 0: ĐẶC TẢ CÔNG THỨC & QUY TẮC KIỂM SOÁT TÀI CHÍNH

### 1. Công thức toán học riêng cho từng loại giá

Ký hiệu dòng sản phẩm thứ $i \in \{1..N\}$ có số lượng đặt in $Q_i \in \mathbb{Z}^+$ ($1 \le Q_i \le 10.000.000$). Mọi khoản thành tiền nội bộ và báo khách ở cấp tổng thành phần đều là **số nguyên đồng Việt Nam (`VND`)**.

#### 1.1. Diện tích thực tế (`actualAreaSqm`), Diện tích tính tiền (`billableAreaSqm`) và Lý do chênh lệch (`adjustmentReason`)

- **Độ phân giải kích thước & diện tích:**
  - Kích thước chiều ngang $W_i$ (m) và chiều cao $H_i$ (m): nhập tối đa **4 chữ số thập phân** (`0,1 mm`, $0 < W_i, H_i \le 1.000\text{ m}$).
  - Số tấm nhân diện tích $K_i \in \mathbb{Z}^+$ (mặc định $K_i = Q_i$).
  - Diện tích lưu chuẩn ở độ phân giải **micro-$\text{m}^2$ ($10^{-6}\text{ m}^2$)**:
    $$W_{\text{scaled}} = \text{round}(W_i \times 10.000), \quad H_{\text{scaled}} = \text{round}(H_i \times 10.000)$$
    $$\text{actualMicroSqm}_i = \left\lfloor \frac{W_{\text{scaled}} \times H_{\text{scaled}} \times K_i + 50}{100} \right\rfloor, \quad A^{\text{actual}}_i = \frac{\text{actualMicroSqm}_i}{1.000.000}$$
  - Nếu nhập trực tiếp tổng diện tích (`DIRECT_AREA`): $\text{actualMicroSqm}_i = \text{round}(A_{\text{input}} \times 1.000.000)$, $A^{\text{actual}}_i = \text{actualMicroSqm}_i / 10^6$.
- **Diện tích tính tiền ($A^{\text{bill}}\_i$):**
  - Mặc định tuyệt đối: $A^{\text{bill}}_i = A^{\text{actual}}_i$ (**không tự động cộng phần trăm hao hụt**).
  - Chỉ khi Owner chủ động bật điều chỉnh diện tích tính tiền: $A^{\text{bill}}_i = \text{normalizeAreaSqm}(A^{\text{bill,input}}_i)$.
- **Quy tắc kiểm soát chênh lệch diện tích:**
  - Khi $A^{\text{bill}}_i \neq A^{\text{actual}}_i$, hệ thống **bắt buộc** phải có `adjustmentReason` khác rỗng (ví dụ: _"Khổ bạt xưởng tính tối thiểu 1m"_, _"Chừa biên đóng khoen 5cm mỗi cạnh"_). Nếu để trống `adjustmentReason`, cả UI và API từ chối lưu (`400 VALIDATION_ERROR`).
  - `actualAreaSqm`, `billableAreaSqm` và `adjustmentReason` được lưu tách biệt trong `areaSpec` của snapshot nội bộ; `adjustmentReason` bị cấm xuất hiện trên PDF gửi khách (`FORBIDDEN_CUSTOMER_PDF_KEYS`).

#### 1.2. Giá in cơ bản của dòng sản phẩm ($C^{\text{base}}_i$)

Với đơn giá gốc $R^{\text{base}}_i \ge 0$ (`0 <= R <= 100.000.000.000 VND`):

1. **Theo sản phẩm / đơn vị (`PER_UNIT`):**
   $$C^{\text{base}}_i = \text{round\_half\_up}(R^{\text{base}}_i \times Q_i)$$
2. **Theo diện tích (`PER_SQM`):** dùng số học nguyên `BigInt` tránh sai số dấu phẩy động:
   $$\text{areaMicro} = \text{round}(A^{\text{bill}}_i \times 10^6), \quad \text{rateCents} = \text{round}(R^{\text{base}}_i \times 100)$$
   $$C^{\text{base}}_i = \left\lfloor \frac{\text{areaMicro} \times \text{rateCents} + 50.000.000}{100.000.000} \right\rfloor$$
3. **Trọn lô (`TOTAL_BATCH`):**
   $$C^{\text{base}}_i = \text{round\_half\_up}(R^{\text{base}}_i)$$
   _(Cộng đúng 1 lần cho lô của dòng đó, **không** nhân $Q_i$; chịu ràng buộc điều kiện số lượng lô ở Mục 4.5)._

#### 1.3. Công đoạn gia công ($C^{\text{stage}}_{i,j}$) và Tổng gia công dòng ($C^{\text{fin}}_i$)

Một dòng sản phẩm $i$ có $M_i \ge 0$ công đoạn gia công độc lập ($j = 1..M_i$), mỗi công đoạn có `pricingMode` và đơn giá $R^{\text{stage}}_{i,j} \ge 0$ riêng:

1. **Gia công theo đơn vị (`PER_UNIT`):**
   $$C^{\text{stage}}_{i,j} = \text{round\_half\_up}(R^{\text{stage}}_{i,j} \times Q_i)$$
2. **Gia công theo diện tích (`PER_SQM`):** với $A^{\text{stage}}_{i,j} = A^{\text{stage,override}}_{i,j} \ ?? \ A^{\text{bill}}_i$:
   $$C^{\text{stage}}_{i,j} = \text{multiplyRateByAreaSqmToVnd}(R^{\text{stage}}_{i,j}, A^{\text{stage}}_{i,j})$$
3. **Gia công trọn lô (`TOTAL_BATCH`):**
   $$C^{\text{stage}}_{i,j} = \text{round\_half\_up}(R^{\text{stage}}_{i,j})$$
4. **Tổng gia công và Tổng giá vốn xưởng của dòng $i$:**
   $$C^{\text{fin}}_i = \sum_{j=1}^{M_i} C^{\text{stage}}_{i,j}, \qquad C^{\text{vendor}}_i = C^{\text{base}}_i + C^{\text{fin}}_i$$

#### 1.4. Tiền lời dòng sản phẩm ($P_i$)

1. **Lời cố định bằng tiền (`ProfitMode.FIXED_AMOUNT`)** với giá trị nhập $V_i \ge 0$:
   - Theo đơn vị (`ProfitScope.PER_UNIT`): $P_i = \text{round\_half\_up}(V_i \times Q_i)$.
   - Theo diện tích (`ProfitScope.PER_SQM`): $P_i = \text{multiplyRateByAreaSqmToVnd}(V_i, A^{\text{bill}}_i)$.
   - Trọn lô (`ProfitScope.TOTAL_BATCH`): $P_i = \text{round\_half\_up}(V_i)$.
2. **Lời theo phần trăm (`ProfitMode.PERCENTAGE`)** với $V_i \ge 0$ (`%`, xem chi tiết mẫu số ở Mục 2):
   $$P_i = \text{round\_half\_up}\left(\frac{C^{\text{vendor}}_i \times V_i}{100}\right)$$

#### 1.5. Phí vận chuyển (`shippingFee` — $S$) và Phí phát sinh (`lineExtraCost` — $E^{\text{line}}_i$, `orderExtraCost` — $E^{\text{order}}$)

- **Phí phát sinh dòng:** $E^{\text{line}}_i = \text{round\_half\_up}(\text{extraCost}_i \ge 0)$.
- **Phí phát sinh chung toàn đơn ($E^{\text{order}} \ge 0$):** phân bổ nguyên đồng vào từng dòng bằng thuật toán **Số dư lớn nhất (`Largest Remainder` — `allocateIntegerAmount`)** theo tỷ trọng $W^{(0)}_i = C^{\text{vendor}}_i + P_i + E^{\text{line}}_i$ (nếu tổng tỷ trọng $= 0$ thì theo $Q_i$), đảm bảo $\sum_{i=1}^N E^{\text{alloc}}_i = E^{\text{order}}$.
- **Thành tiền dòng trước vận chuyển:**
  $$B_i = C^{\text{vendor}}_i + P_i + E^{\text{line}}_i + E^{\text{alloc}}_i$$
- **Phí vận chuyển toàn đơn ($S \ge 0$):** chỉ cộng **1 lần duy nhất cho toàn bộ báo giá** (tuyệt đối không nhân theo $Q_i$ hay số dòng):
  - Phân bổ nội bộ $S_i = \text{allocateIntegerAmount}(S, [B_1..B_N])$ sao cho $\sum_{i=1}^N S_i = S$.
  - Nếu `includeShippingInUnitPrice = true` (gộp phí giao hàng vào đơn giá báo khách):
    $$T_i = B_i + S_i, \qquad S_{\text{footer}} = 0$$
  - Nếu `includeShippingInUnitPrice = false` (tách dòng phí giao hàng ở chân báo giá):
    $$T_i = B_i, \qquad S_{\text{footer}} = S$$
- **Tổng thanh toán báo khách toàn đơn (`totalQuoteAmount`):**
  $$G = \sum_{i=1}^{N} C^{\text{vendor}}_i + \sum_{i=1}^{N} P_i + S + \sum_{i=1}^{N} \left(E^{\text{line}}_i + E^{\text{alloc}}_i\right) \equiv \sum_{i=1}^{N} T_i + S_{\text{footer}}$$

---

### 2. Quy định Mẫu số Tiền lời Phần trăm (`PERCENTAGE`) & Bảo toàn Báo giá cũ

1. **Báo giá cũ (`V1/V2` không có công đoạn gia công tách rời, $C^{\text{fin}}\_i = 0$):**
   - Mẫu số từ phiên bản gốc `V1` là **Giá vốn nhà in của dòng sản phẩm ($C^{\text{vendor}}\_i$)** — tức là **Markup trên giá vốn**, **không** bao gồm `shippingFee` và **không** bao gồm `extraCost`.
   - Ví dụ báo giá cũ: `5 bộ Standee trọn lô 500.000đ + lời 30% + ship 70.000đ` $\Rightarrow$ $P = 500.000 \times 30\% = 150.000\text{ đ}$ (không tính `30%` lên `70.000đ` tiền ship).
   - **Cam kết bất biến:** Không thay đổi công thức hoặc ý nghĩa phần trăm của bất kỳ báo giá cũ nào đã lưu.

2. **Báo giá mới có Công đoạn gia công ($C^{\text{fin}}\_i > 0$):**
   - Trong mã nguồn hiện hành trên nhánh DEV, mẫu số của `PERCENTAGE` là **Tổng giá vốn xưởng của dòng sản phẩm** (`profitBasis = 'LINE_TOTAL_VENDOR_COST'`):
     $$\text{Mẫu số } \% = C^{\text{vendor}}_i = C^{\text{base}}_i + C^{\text{fin}}_i \quad (\text{đã gồm Gia công; KHÔNG gồm Vận chuyển } S \text{ và Phí phát sinh } E)$$
   - **Cảnh báo nghiệp vụ trình Owner xác nhận (`Quyết định D-01`):**
     Với bài toán thực tế: In cơ bản $400.000\text{ đ}$ + Gia công cán màng $200.000\text{ đ}$ + Ship $40.000\text{ đ}$, nhập lời $20\%$:
     - **Phương án A (Hiện hành trên DEV — `%` trên Tổng vốn sản phẩm = In + Gia công, không gồm Ship):** $P = 20\% \times (400.000 + 200.000) = \mathbf{120.000\text{ đ}} \Rightarrow$ Báo khách $\mathbf{760.000\text{ đ}}$.
     - **Phương án B (`%` chỉ trên Giá in cơ bản, Gia công thu hộ ngang giá vốn):** $P = 20\% \times 400.000 = \mathbf{80.000\text{ đ}} \Rightarrow$ Báo khách $\mathbf{720.000\text{ đ}}$.
     - **Phương án C (Biên lợi nhuận gộp Margin trên giá bán trước ship: $\text{Bán} = \text{Vốn} / (1 - 20\%)$):** $P = 600.000 / 0,8 - 600.000 = \mathbf{150.000\text{ đ}} \Rightarrow$ Báo khách $\mathbf{790.000\text{ đ}}$.
   - **Cách xử lý an toàn hiện tại:** Giữ nguyên Phương án A để đồng nhất với định nghĩa `totalVendorCost` của V1, lưu tường minh `profitBasis: 'LINE_TOTAL_VENDOR_COST'` vào snapshot để không bao giờ mơ hồ về sau, hiển thị rõ dòng chú thích mẫu số ngay dưới ô nhập `%` trên giao diện, và **trình Owner chốt `D-01`** trước khi phát hành Production.

---

### 3. Số thập phân, Giới hạn nhập, Điểm làm tròn & Đối soát Khớp Tổng Báo giá / PDF

| Đại lượng                                                         | Kiểu số & Số lẻ tối đa                                                    | Giới hạn hợp lệ (`Bounds`)      | Điểm làm tròn (`Rounding Point`)                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Số lượng $Q_i$, Số tấm $K_i$                                      | Số nguyên                                                                 | $1 \le Q_i, K_i \le 10.000.000$ | Không có số lẻ (từ chối số thập phân)                                                                    |
| Kích thước $W_i, H_i$ (m)                                         | Thập phân tối đa `4` chữ số (`0,1 mm`)                                    | $0,0001 \le W_i, H_i \le 1.000$ | Quy đổi `BigInt` $\times 10.000$                                                                         |
| Diện tích $A^{\text{actual}}_i, A^{\text{bill}}_i$ ($\text{m}^2$) | Thập phân tối đa `6` chữ số (`micro-m²`)                                  | $0,000001 \le A \le 1.000.000$  | `half-up` ở bậc $10^{-6}\text{ m}^2$                                                                     |
| Đơn giá xưởng, Lời VND, Ship, Phát sinh                           | Số nguyên `VND` (cho phép lẻ xu nội bộ khi import cũ, chuẩn UI số nguyên) | $0 \le R \le 100.000.000.000$   | Mỗi thành phần $C^{\text{base}}_i, C^{\text{stage}}_{i,j}, P_i$ làm tròn `half-up` 1 lần ra nguyên `VND` |
| Tỷ lệ lời phần trăm $V_i$ (`%`)                                   | Thập phân tối đa `2` chữ số                                               | $0 \le V_i \le 10.000\%$        | $P_i = \text{round\_half\_up}(C^{\text{vendor}}_i \times V_i / 100)$ 1 lần ra nguyên `VND`               |

#### Quy tắc Bất biến Đối soát Tổng chi tiết = Tổng báo giá = Tổng PDF (Chống sai lệch làm tròn):

1. **Tuyệt đối KHÔNG lấy đơn giá hiển thị đã làm tròn nhân ngược lại số lượng để tính tổng tiền.**
2. Tổng thành tiền mục tiêu của dòng $i$ là số nguyên chính xác $T_i$ (`targetLineTotal`).
3. Đơn giá chuẩn làm tròn theo chính sách (`NEAREST`/`CEIL`/`FLOOR` với `step`, mặc định `NEAREST`, `step = 1`):
   $$u^{\text{raw}}_i = \frac{T_i}{Q_i}, \qquad u^{\text{final}}_i = \text{roundByPolicy}(u^{\text{raw}}_i)$$
   $$\text{billedSubtotal}_i = u^{\text{final}}_i \times Q_i, \qquad \Delta^{\text{round}}_i = T_i - \text{billedSubtotal}_i$$
   $$\text{reconciledLineTotal}_i = \text{billedSubtotal}_i + \Delta^{\text{round}}_i \equiv T_i$$
4. **Cách hiển thị đơn giá trên Bản gửi khách & PDF A4 (`formatCustomerUnitPriceDisplay`):**
   - Nếu $T_i \bmod Q_i = 0$ (hoặc chia hết cho $A^{\text{display}}_i$): in đơn giá nguyên chính xác (VD: `7.400 ₫` $\times 100$ = `740.000 ₫`).
   - Nếu $(T_i \times 100) \bmod Q_i = 0$ (chia hết đến 2 chữ số thập phân, VD: `76.316 ₫ / 100 tờ = 763,16 ₫`): in chính xác `763,16 ₫` $\times 100$ = `76.316 ₫`.
   - Nếu là số thập phân vô hạn tuần hoàn (VD: `68.684 ₫ / 3 tờ = 22.894,666... ₫`): in `~22.895 ₫` kèm chú thích phụ rõ nghĩa `Tính trọn gói 3 tờ` và cột **Thành tiền** giữ nguyên chính xác **`68.684 ₫`**.
   - Nhờ đó: $\sum \text{Cột Thành Tiền trên PDF} + \text{Phí giao hàng chân PDF} \equiv \text{Tổng cộng thanh toán trên PDF} \equiv \text{totalQuoteAmount}$ trong `100%` mọi trường hợp, không bao giờ lệch dù chỉ `1 ₫`.

---

### 4. Quy tắc Trạng thái Giá đặc biệt & Điều kiện Số lượng Trọn lô

1. **Giá trống (`null` / chuỗi rỗng `""`) vs Giá `0` do Owner chủ động nhập (`0` / `"0"`):**
   - `""` hoặc `null` $\rightarrow$ đánh dấu thiếu giá (`baseCostPending = true` hoặc `stage.rate === null`) $\rightarrow$ toàn bộ báo giá mang `pricing_status = 'PENDING_COST'` (`"Chờ giá xưởng"`), chỉ cho lưu nháp `DRAFT`, `pdfPayload = null`, chặn `409 QUOTE_PENDING_VENDOR_COST` tại mọi API xuất PDF / Chốt báo giá / Chuyển thành đơn hàng.
   - `"0"` hoặc `0` $\rightarrow$ giá hợp lệ bằng `0 ₫` (ví dụ khuyến mãi miễn phí khuôn / gia công tặng kèm) $\rightarrow$ `pricing_status = 'COMPLETE'`.
2. **Mục giá hết hiệu lực / đã ngừng dùng (`is_active = false`):**
   - Không hiển thị trong danh sách chọn mới; nếu gọi thẳng API tạo báo giá mới hoặc gắn mới vào báo giá cũ, Backend từ chối với **`409 PRICE_ITEM_INACTIVE`**.
   - Báo giá cũ đã lưu tham chiếu `price_item_id` đó trước khi ngừng dùng vẫn giữ nguyên snapshot và cho phép mở sửa các trường khác bình thường (`allowedInactiveCatalogIds`).
   - Mục giá đã từng xuất hiện trong bất kỳ báo giá/phiên bản nào bị khóa xóa cứng (`409 PRICE_ITEM_IN_USE`).
3. **Giá cơ bản đã bao gồm gia công (`included_stages`):**
   - Khi chọn thêm công đoạn gia công trùng tên hoặc cùng nhóm nghiệp vụ (`lamination`, `foil_stamping`, `die_cut`, `creasing_folding`, `corner_rounding`, `eyelets`, `hem_pocket`) với `included_stages` hoặc `specification` của giá cơ bản, `detectIncludedStageOverlaps` phát cảnh báo nổi bật kèm nút `Gỡ công đoạn trùng` 1 chạm.
   - Nếu chọn/nhập **hai công đoạn giống hệt nhau** trên cùng 1 dòng sản phẩm: chặn cứng (`Error` cả UI & API) để không cộng 2 lần.
4. **Quy tắc Giá Trọn lô (`TOTAL_BATCH`) & Đổi số lượng (`Không tự áp dụng giá trọn lô cho số lượng khác nếu điều kiện của mục giá chưa cho phép`):**
   - Mỗi mục bảng giá `TOTAL_BATCH` có `batch_quantity` ($Q_{\text{batch}} \ge 1$) và chính sách số lượng lô `structured_spec.batch_qty_policy` $\in \{\text{'EXACT'}, \text{'MAX'}, \text{'RANGE'}, \text{'ANY\_QTY'}\}$:
     - **Mặc định an toàn (`fail-closed`):**
       - Nếu $Q_{\text{batch}} > 1$ mà chưa khai báo `batch_qty_policy`: mặc định là **`'EXACT'`** (chỉ cho phép áp dụng tự động khi $Q_i = Q_{\text{batch}}$).
       - Nếu `item_type = 'BASE_PRINT'` và `pricing_mode = 'TOTAL_BATCH'`: mặc định khi tạo mới trên UI là **`'EXACT'`** (phải khớp đúng số lượng lô $Q_{\text{batch}}$, hoặc `'MAX'` tối đa $Q_{\text{batch}}$, trừ khi Owner chủ động chọn `'ANY_QTY'`).
     - Khi $Q_i$ trên báo giá **không thỏa điều kiện số lượng của mục bảng giá `TOTAL_BATCH`** và nguồn giá đang là `CATALOG`:
       - **Tuyệt đối không tự áp dụng giá trọn lô cũ cho số lượng mới.**
       - Backend chặn với mã lỗi **`409 BATCH_QUANTITY_MISMATCH`**; UI chặn nút Lưu hoàn chỉnh và đưa ra 3 lựa chọn tường minh cho Owner:
         1. Đặt lại $Q_i = Q_{\text{batch}}$ đúng điều kiện lô;
         2. Xác nhận dùng/sửa như **giá riêng cho báo giá này** (`costSource = 'CATALOG_OVERRIDDEN'`, lưu rõ giá gốc & SL lô gốc);
         3. Xóa giá để chuyển sang **Lưu nháp `"Chờ giá xưởng"`** (`PENDING_COST`).
   - Đối với báo giá cũ lịch sử không lưu `vendorCostMode` (`unitVendorCost * quantity === totalVendorCost` với `quantity > 1`): khi đổi số lượng, `ambiguousLegacyCost` chặn tính lại cho tới khi Owner bấm chọn rõ `Giữ trọn lô` hoặc `Tính theo 1 đơn vị`.

---

### 5. Truy vết Nguồn gốc & Lịch sử Giá (`Provenance & Immutability`)

1. **Bảng giá xưởng (`print_vendor_price_items` + `print_vendor_price_item_history`):**
   - Mỗi lần `CREATED` / `UPDATED` / `DEACTIVATED` / `RESTORED` đều tăng `version` (`v1 -> v2 -> ...`) và ghi bản ghi bất biến vào `print_vendor_price_item_history` (`before_json`, `after_json`, `changed_by`, `changed_at`, `change_note`).
2. **Snapshot dòng sản phẩm & công đoạn trên Báo giá (`PersistedQuoteLineSnapshot`):**
   - Lưu đầy đủ tại thời điểm tính giá:
     - Dòng cơ bản: `vendorPriceItemId`, `vendorPriceItemCode` (VD `GX-001`), `vendorPriceItemVersion` (VD `2`), `vendorId`, `vendorName`, `baseCostSource` (`CATALOG` | `CATALOG_OVERRIDDEN` | `MANUAL`), `catalogOriginalRate`, `catalogBatchQuantity`, `priceAppliedAt`.
     - Từng công đoạn gia công: `priceItemId`, `code` (VD `GC-001`), `priceItemVersion`, `vendorId`, `vendorName`, `costSource`, `catalogOriginalRate`, `catalogBatchQuantity`, `appliedAt`.
   - Khi sửa giá riêng trên báo giá (`CATALOG_OVERRIDDEN`): lưu đồng thời **nguồn bảng giá gốc + mức giá gốc (`catalogOriginalRate`)** và **mức giá đã sửa (`baseCostRate` / `stage.rate`)**, hiển thị rõ trong phần Bóc tách nội bộ của báo giá.
3. **Bất biến & Lịch sử sau khi lưu:**
   - Mọi thao tác sửa báo giá đã lưu (`PATCH /api/v1/print-quotes/quotes/:id`) đều khóa bản ghi `FOR UPDATE`, tăng `current_version` (`v1 -> v2 -> ...`), và chèn một dòng mới bất biến vào `print_quote_versions` kèm `integrity_hash` SHA-256 và `change_note` + `created_by` + `created_at`.
   - Sửa hoặc ngừng dùng bảng giá xưởng **không bao giờ** cập nhật ngược `print_quotes`, `print_quote_versions` hay `print_orders`.

---

### 6. Phân biệt Ba Tầng Số liệu Tài chính trên Đơn hàng (`Dự kiến` vs `Thực tế xác nhận` vs `Thực thu / Thực chi`)

Trên mỗi đơn hàng đặt in (`print_orders`) và trang Báo cáo (`/print-quotes/reports`), hệ thống tách bạch nghiêm ngặt 3 tầng:

| Tầng số liệu                                     | Cột lưu trữ DB (`print_orders`)                                                                                                                                                | Ý nghĩa & Thời điểm ghi nhận                                                                                                                                                                                   | Quy tắc trình bày                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Giá vốn & Lời dự kiến khi báo giá**         | `expected_vendor_cost`, `expected_shipping_fee`, `expected_extra_cost`, `expected_profit`                                                                                      | Sao chụp bất biến từ phiên bản báo giá tại lúc chuyển thành đơn đặt in.                                                                                                                                        | Luôn gắn nhãn rõ **`Dự kiến (theo Báo giá)`**.                                                                                                                                                       |
| **2. Chi phí & Lời thực tế đã xác nhận**         | `actual_cost_confirmed` (`boolean`), `actual_cost_confirmed_at`, `actual_cost_confirmed_by`, `actual_vendor_cost`, `actual_shipping_fee`, `actual_extra_cost`, `actual_profit` | Khi mới tạo đơn từ báo giá mà chưa nhập chi phí thực tế: **`actual_cost_confirmed = false`**. Chỉ chuyển sang **`true`** khi Owner chủ động xác nhận/cập nhật chi phí thực tế đối soát với xưởng & vận chuyển. | Khi `actual_cost_confirmed = false`: hiển thị **`Chưa đối soát xưởng`**, tuyệt đối **không** cộng `expected_vendor_cost` vào tổng chi phí/lợi nhuận thực tế đã đối soát.                             |
| **3. Tiền thực thu khách & Tiền thực chi xưởng** | Thực thu khách: `deposit_paid`, `total_paid_amount`, `remaining_debt_amount` (từ sổ giao dịch `print_order_payments`).<br>Thực chi xưởng: `vendor_paid_amount` (`>= 0`).       | Ghi nhận dòng tiền thực tế đã chuyển khoản/tiền mặt từ khách hoặc trả cho nhà in.                                                                                                                              | Tách riêng với chi phí phát sinh/đối soát (ví dụ: đã chốt hóa đơn xưởng `720.000 ₫` nhưng mới cọc xưởng `300.000 ₫` $\rightarrow$ chi phí thực tế xác nhận `720.000 ₫`, thực chi xưởng `300.000 ₫`). |

---

### 7. Danh mục Quyết định Nghiệp vụ Trình Owner Xác nhận (Không tự suy đoán)

1. **`[D-01]` Mẫu số tính Lời phần trăm (`PERCENTAGE`) khi sản phẩm có thêm Công đoạn gia công:**
   - Hiện giữ **Phương án A** (`%` tính trên `Giá in cơ bản + Gia công`, không gồm `Phí vận chuyển` — ví dụ `400k + 200k` với `20%` ra lời `120.000 ₫`), đồng thời lưu `profitBasis = 'LINE_TOTAL_VENDOR_COST'` để không mơ hồ. Owner xác nhận giữ Phương án A hay cần thêm tùy chọn Phương án B (`%` chỉ trên Giá in cơ bản = `80.000 ₫`) / Phương án C (`Margin %` trên giá bán = `150.000 ₫`).
2. **`[D-02]` Hiển thị cột Số lượng trên PDF gửi khách khi đơn vị là `m²` và `billableAreaSqm != actualAreaSqm`:**
   - Ví dụ: Khách đặt `3 tấm` kích thước `0,8m × 1,2m` (`actualAreaSqm = 2,88 m²`), xưởng tính khổ tối thiểu `billableAreaSqm = 3,00 m²` (tổng báo khách `240.000 ₫`).
   - **Lựa chọn 2A:** PDF hiển thị `2,88 m²` (đúng kích thước vật lý khách đặt, đơn giá hiển thị `~80.000 ₫ — Tính trọn gói 2,88 m²`, thành tiền `240.000 ₫`, ẩn hoàn toàn quy tắc làm tròn khổ của xưởng).
   - **Lựa chọn 2B (Hiện hành):** PDF hiển thị `3 m²` $\times$ `80.000 ₫` = `240.000 ₫` (khớp phép nhân chẵn trên bảng khách nhưng cần ghi chú điều kiện tính khổ cho khách).
   - Hiện giữ nguyên hành vi đã có + bắt buộc nhập `adjustmentReason` nội bộ để truy vết, chờ Owner chốt `2A` hay `2B`.

---

## PHẦN II — PHASE 1: BỘ ĐỐI SOÁT ĐỘC LẬP TÍNH BẰNG TAY (`TC-01` → `TC-13`)

> Mọi đáp án kỳ vọng dưới đây được tính độc lập bằng số học tay trước khi viết mã Phase 2, kiểm tra đồng thời từng thành phần (`C_base`, `C_fin`, `C_vendor`, `Profit`, `Ship_alloc`, `Rounding`) và tổng cuối (`totalQuoteAmount` = `grandTotalPayable` trên PDF).

| Mã đối soát                                                                             | Input đầu vào                                                                                                                                                                                                                                                                                                                                                                             | Phép tính bằng tay độc lập                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Kết quả kỳ vọng bắt buộc                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`TC-01A`**<br>A4 C200 + cán màng (`1 tờ`)                                             | 1 dòng: `Q = 1 tờ`, Cơ bản `4.000 đ/tờ` (`PER_UNIT`), Gia công Cán màng 1 mặt `2.000 đ/tờ` (`PER_UNIT`), Lời `1.000 đ/tờ`, Ship `0 đ`                                                                                                                                                                                                                                                     | $C^{\text{base}} = 4.000 \times 1 = 4.000$<br>$C^{\text{fin}} = 2.000 \times 1 = 2.000$<br>$C^{\text{vendor}} = 4.000 + 2.000 = 6.000$<br>$P = 1.000 \times 1 = 1.000$<br>$G = 6.000 + 1.000 = 7.000$                                                                                                                                                                                                                                                                                                                       | `baseVendorCost = 4.000`<br>`finishingVendorCost = 2.000`<br>`totalVendorCost = 6.000`<br>`totalProfit = 1.000`<br>`finalUnitPrice = 7.000`<br>`totalQuoteAmount = PDF = 7.000`                                                 |
| **`TC-01B`**<br>A4 C200 + cán màng (`100 tờ` + Ship `40k` 1 lần)                        | 1 dòng: `Q = 100 tờ`, Cơ bản `4.000 đ/tờ`, Cán màng `2.000 đ/tờ`, Lời `1.000 đ/tờ`, Ship `40.000 đ` (`includeShipping = true`)                                                                                                                                                                                                                                                            | $C^{\text{base}} = 400.000$, $C^{\text{fin}} = 200.000 \Rightarrow C^{\text{vendor}} = 600.000$<br>$P = 100 \times 1.000 = 100.000$<br>$B_1 = 700.000$, $S_1 = 40.000$ (1 lần, không $\times 100$)<br>$T_1 = 740.000$, $u^{\text{final}} = 740.000 / 100 = 7.400$                                                                                                                                                                                                                                                           | `totalVendorCost = 600.000`<br>`totalProfit = 100.000`<br>`shippingFee = 40.000`<br>`finalUnitPrice = 7.400`<br>`roundingAdjustment = 0`<br>`totalQuoteAmount = PDF = 740.000`                                                  |
| **`TC-02`**<br>Đa công đoạn: Theo tờ + Trọn lô trên cùng SP                             | 1 dòng: `Q = 100 tờ`, Cơ bản `4.000 đ/tờ` (`PER_UNIT`), GC1 Cán màng `2.000 đ/tờ` (`PER_UNIT`), GC2 Khuôn bế `150.000 đ` (`TOTAL_BATCH`), GC3 Ép kim `50.000 đ` (`TOTAL_BATCH`), Lời trọn lô `80.000 đ`, Ship `30.000 đ` (tách chân PDF: `includeShipping = false`)                                                                                                                       | $C^{\text{base}} = 400.000$<br>$C^{\text{fin}} = (2.000 \times 100) + 150.000 + 50.000 = 400.000$<br>$C^{\text{vendor}} = 400.000 + 400.000 = 800.000$<br>$P = 80.000 \Rightarrow B_1 = 880.000$, $u^{\text{final}} = 8.800$<br>Chân PDF cộng Ship $30.000 \Rightarrow G = 910.000$                                                                                                                                                                                                                                         | `baseVendorCost = 400.000`<br>`finishingVendorCost = 400.000`<br>`totalVendorCost = 800.000`<br>`lineTotal trên PDF = 880.000`<br>`shippingOnPdfFooter = 30.000`<br>`grandTotalPayable = 910.000`                               |
| **`TC-03`**<br>Đa sản phẩm, nhiều xưởng & phân bổ Ship lẻ (`Largest Remainder`)         | SP1 (`Xưởng A`, `Q = 100`): vốn `3.000/tờ`, lời `1.000/tờ` $\Rightarrow B_1 = 400.000$<br>SP2 (`Xưởng B`, `Q = 50`): vốn `8.000/cái` + GC `2.000/cái`, lời `2.000/cái` $\Rightarrow B_2 = 600.000$<br>SP3 (`Xưởng chung`, trọn lô `Q = 1`): vốn `200.000`, lời `50.000` $\Rightarrow B_3 = 250.000$<br>Ship `50.000 đ` gộp vào đơn giá (`PROPORTIONAL_BY_BASE_AMOUNT`)                    | Tổng $B = 400k + 600k + 250k = 1.250.000$<br>$S_1 = 50k \times 400 / 1250 = 16.000$ (chẵn)<br>$S_2 = 50k \times 600 / 1250 = 24.000$ (chẵn)<br>$S_3 = 50k \times 250 / 1250 = 10.000$ (chẵn)<br>$T_1 = 416.000$ ($u_1 = 4.160$), $T_2 = 624.000$ ($u_2 = 12.480$), $T_3 = 260.000$ ($u_3 = 260.000$)                                                                                                                                                                                                                        | `totalVendorCost = 1.000.000`<br>`totalProfit = 250.000`<br>`allocatedShipping = [16.000, 24.000, 10.000]`<br>`sum(allocatedShipping) = 50.000`<br>`totalQuoteAmount = PDF = 1.300.000`                                         |
| **`TC-04`**<br>Giá đã gồm gia công & chặn lặp công đoạn                                 | Giá cơ bản `Namecard C300` có `included_stages = ["Cán màng 2 mặt"]`.<br>(a) Thêm `Cán màng mờ 1 mặt` (`lamination`).<br>(b) Thêm tiếp `Cán màng mờ 1 mặt` lần 2 trên cùng dòng.                                                                                                                                                                                                          | (a) `detectIncludedStageOverlaps` khớp nhóm `lamination` $\rightarrow$ trả về cảnh báo trùng `Cán màng 2 mặt`.<br>(b) Thêm trùng cùng tên/mã công đoạn $\rightarrow$ `calculatePrintQuote` & API ném lỗi chặn cứng.                                                                                                                                                                                                                                                                                                         | (a) `warnings.length === 1`<br>(b) Bị chặn cứng không thể cộng 2 lần cùng 1 công đoạn                                                                                                                                           |
| **`TC-05A/B`**<br>Diện tích thập phân `m²` & chênh lệch `m²` tính tiền                  | **(5A)** `0,8m × 1,2m × 3 tấm`, `50.000 đ/m²`, GC đóng khoen `10.000 đ/tấm` (`PER_UNIT`, `Q=3`), Lời `25.000 đ/m²` (`PER_SQM`), Ship `0`.<br>**(5B)** Chỉnh `billableAreaSqm = 3,00 m²`: thử lưu khi trống `adjustmentReason` vs có nhập `"Khổ bạt tối thiểu 1m²/tấm"`.                                                                                                                   | **(5A)** $A^{\text{actual}} = A^{\text{bill}} = 2,88\text{ m}^2$.<br>$C^{\text{base}} = 2,88 \times 50.000 = 144.000$.<br>$C^{\text{fin}} = 3 \times 10.000 = 30.000 \Rightarrow C^{\text{vendor}} = 174.000$.<br>$P = 2,88 \times 25.000 = 72.000 \Rightarrow G = 246.000$.<br>**(5B)** $A^{\text{bill}} = 3,00$: trống lý do $\rightarrow$ chặn `400`; có lý do $\rightarrow$ $C^{\text{base}} = 150.000$, $C^{\text{fin}} = 30.000$, $P = 75.000 \Rightarrow G = 255.000$.                                               | **(5A)** `actualAreaSqm = 2.88`, `totalVendorCost = 174.000`, `totalProfit = 72.000`, `G = 246.000`<br>**(5B)** Không lý do $\rightarrow$ `400 VALIDATION_ERROR`; có lý do $\rightarrow$ `G = 255.000` + lưu `adjustmentReason` |
| **`TC-06A/B`**<br>Giá `0 đ` chủ đích vs Giá trống (`null`)                              | **(6A)** Cơ bản `4.000 đ/tờ` (`100 tờ`), GC Cắt thành phẩm nhập rõ `0 đ`, Lời `1.000 đ/tờ`.<br>**(6B)** Cơ bản `4.000 đ/tờ`, GC Ép kim để trống `null` (`""`).                                                                                                                                                                                                                            | **(6A)** $0 \neq \text{null} \Rightarrow C^{\text{base}} = 400k, C^{\text{fin}} = 0, P = 100k, G = 500k$ (`COMPLETE`).<br>**(6B)** Có hạng mục `null` $\Rightarrow$ `PENDING_COST`, không sinh tổng tiền giả, `pdfPayload = null`.                                                                                                                                                                                                                                                                                          | **(6A)** `pricing_status = 'COMPLETE'`, `G = 500.000`, xuất PDF `200 OK`<br>**(6B)** `pricing_status = 'PENDING_COST'`, gọi `/pdf`, `/finalize`, `/orders` đều bị chặn `409`                                                    |
| **`TC-07`**<br>Lời cố định vs Lời `%` (lẻ nửa đồng)                                     | `Q = 33 tờ`, Cơ bản `4.500 đ/tờ` (`148.500 đ`) + GC Cán màng `1.500 đ/tờ` (`49.500 đ`) $\Rightarrow C^{\text{vendor}} = 198.000 đ$. Lời `12,5%`, Ship `25.000 đ`.                                                                                                                                                                                                                         | Mẫu số `%` = $C^{\text{vendor}} = 198.000$ (không gồm Ship `25.000`).<br>$P = \text{round\_half\_up}(198.000 \times 12,5 / 100) = 24.750\text{ đ}$.<br>$G = 198.000 + 24.750 + 25.000 = 247.750\text{ đ}$.                                                                                                                                                                                                                                                                                                                  | `totalVendorCost = 198.000`<br>`totalProfit = 24.750`<br>`totalQuoteAmount = PDF = 247.750`<br>`profitBasis = 'LINE_TOTAL_VENDOR_COST'`                                                                                         |
| **`TC-08`**<br>Làm tròn đơn giá lẻ & Đối soát PDF tuyệt đối                             | 1 dòng: `Q = 3 cuốn` Catalogue, Cơ bản trọn lô `45.000 đ`, GC đóng kim trọn lô `8.684 đ`, Lời trọn lô `15.000 đ`, Ship `0 đ`, `rounding = NEAREST (step 1)`.                                                                                                                                                                                                                              | $C^{\text{vendor}} = 45.000 + 8.684 = 53.684$<br>$T_1 = 53.684 + 15.000 = 68.684$<br>$u^{\text{raw}} = 68.684 / 3 = 22.894,666\dots \Rightarrow u^{\text{final}} = 22.895$<br>$\text{billedSubtotal} = 22.895 \times 3 = 68.685$<br>$\Delta^{\text{round}} = 68.684 - 68.685 = -1$<br>$\text{reconciledLineTotal} = 68.684$ (`2 cuốn × 22.895 + 1 cuốn × 22.894`)                                                                                                                                                           | `finalUnitPrice = 22.895`<br>`billedLineSubtotal = 68.685`<br>`roundingAdjustment = -1`<br>`lineTotal trên PDF = 68.684`<br>`grandTotalPayable = 68.684` (không bị đội lên `68.685`)                                            |
| **`TC-09`**<br>Đổi số lượng trên mục `TOTAL_BATCH` từ Bảng giá xưởng                    | Mục bảng giá `BX-500`: `In tờ rơi A5 trọn lô`, `pricing_mode = 'TOTAL_BATCH'`, `batch_quantity = 500`, `batch_total_cost = 350.000 đ` (chính sách mặc định `EXACT`).<br>(a) Lập báo giá `v1` với `Q = 500`, lời `100.000 đ` trọn lô.<br>(b) Mở lại sửa sang `Q = 1.000` mà vẫn để `costSource = 'CATALOG'`.<br>(c) Xác nhận giá riêng `620.000 đ` (`CATALOG_OVERRIDDEN`) cho `Q = 1.000`. | (a) $Q = 500 = Q_{\text{batch}} \Rightarrow$ hợp lệ: $C^{\text{vendor}} = 350.000, G = 450.000$ (`v1`).<br>(b) $Q = 1.000 \neq 500$ với `CATALOG` $\Rightarrow$ chặn `409 BATCH_QUANTITY_MISMATCH` (không tự tính `350.000` cho `1.000` tờ!).<br>(c) Chủ động xác nhận `CATALOG_OVERRIDDEN` `620.000` $\Rightarrow$ lưu `v2`: $C^{\text{vendor}} = 620.000, G = 720.000$, lưu nguồn gốc `BX-500 (350.000 đ / lô 500)`.                                                                                                      | (a) `v1` lưu `201`, `G = 450.000`<br>(b) Bị chặn `409 BATCH_QUANTITY_MISMATCH`, `v1` giữ nguyên `450.000`<br>(c) `v2` lưu `200`, `G = 720.000`, `catalogOriginalRate = 350.000`                                                 |
| **`TC-10`**<br>Sửa/Ngừng dùng giá xưởng sau khi đã lập báo giá & Truy vết phiên bản giá | Mục `GX-01` `v1 = 4.000 đ/tờ`. Lập `BG-01` (`100 tờ` $\rightarrow$ vốn `400.000 đ`).<br>Sau đó sửa `GX-01` lên `v2 = 5.500 đ/tờ`, rồi `deactivate` (`v3`).                                                                                                                                                                                                                                | `BG-01` giữ nguyên snapshot `vendorPriceItemVersion = 1`, `total_vendor_cost = 400.000`, `integrity_hash` hợp lệ.<br>Báo giá mới chọn `GX-01` đang ngừng dùng bị chặn `409 PRICE_ITEM_INACTIVE`.                                                                                                                                                                                                                                                                                                                            | `BG-01` không đổi `1 ₫`; lịch sử `GX-01` có đủ `v1 CREATED`, `v2 UPDATED`, `v3 DEACTIVATED`; báo giá mới bị chặn `409`                                                                                                          |
| **`TC-11`**<br>Dữ liệu cũ thiếu trường mới (`Legacy V1`)                                | Bản ghi báo giá cũ `V1` chỉ có `{ id, name, unit, quantity: 100, unitVendorCost: 300, totalVendorCost: 30000, profitMode: 'FIXED_AMOUNT', profitScope: 'TOTAL_BATCH', profitInputValue: 10000, ... }` (không có `vendorCostMode`, `finishingStages`, `areaSpec`, `pricing_status`).                                                                                                       | 1. Đọc & kiểm tra `verifyQuoteSnapshotIntegrity` giữ nguyên `100%` mã băm cũ.<br>2. Mở form không đổi SL (`Q = 100`) giữ nguyên `30.000 + 10.000 = 40.000`.<br>3. Đổi sang `Q = 200` $\rightarrow$ `ambiguousLegacyCost` chặn lưu cho tới khi Owner chọn rõ `Giữ trọn lô 30.000` hay `Tính 300 đ/tờ`.                                                                                                                                                                                                                       | Không tự suy đoán làm đổi tiền báo giá cũ; `integrityHash` cũ `PASS`                                                                                                                                                            |
| **`TC-12`**<br>Idempotency, Lưu đồng thời & Rollback lỗi giữa chừng                     | (a) Gửi lặp 2 lần `POST /quotes` cùng `Idempotency-Key`.<br>(b) Bắn đồng thời 2 `PATCH /quotes/:id` (`v1 -> v2, v3`) và 5 `POST /orders` cùng `quote_id`.<br>(c) Giả lập lỗi giữa giao dịch lưu.                                                                                                                                                                                          | (a) Request 2 trả lại đúng báo giá đã tạo, DB chỉ có `1` báo giá.<br>(b) `FOR UPDATE` tuần tự hóa `PATCH` (`v2`, `v3` không đè mất phiên bản); `POST /orders` chỉ `1` thành công (`201`), `4` nhận `409`.<br>(c) DB `ROLLBACK` sạch, không sinh bản ghi dở dang.                                                                                                                                                                                                                                                            | Không nhân đôi đơn/tiền; không mất phiên bản `print_quote_versions`; `ROLLBACK` toàn vẹn                                                                                                                                        |
| **`TC-13`**<br>Tách bạch Dự kiến vs Thực tế xác nhận vs Thực thu / Thực chi             | Báo giá `G = 1.120.000 đ`, vốn dự kiến `750.000 đ`, ship dự kiến `70.000 đ`, lời dự kiến `300.000 đ`.<br>(a) Tạo đơn mới, khách cọc `500.000 đ` (chưa nhập chi phí thực tế).<br>(b) Xác nhận hóa đơn xưởng thực tế `720.000 đ`, ship thực tế `60.000 đ`, mới chuyển trả xưởng `300.000 đ`.                                                                                                | (a) Lúc mới tạo đơn: `expected_vendor_cost = 750.000`, `expected_profit = 300.000`, **`actual_cost_confirmed = false`**, thống kê `total_actual_vendor_cost = 0`, `total_actual_profit = 0` (không lấy dự kiến giả làm thực tế!), `total_paid_amount = 500.000`, `remaining_debt = 620.000`.<br>(b) Sau khi xác nhận thực tế: **`actual_cost_confirmed = true`**, `actual_vendor_cost = 720.000`, `actual_shipping_fee = 60.000`, `actual_profit = 1.120.000 - 720.000 - 60.000 = 340.000`, `vendor_paid_amount = 300.000`. | (a) `actual_cost_confirmed === false`, `stats.total_actual_profit === 0`<br>(b) `actual_cost_confirmed === true`, `actual_profit === 340.000`, `vendor_paid_amount === 300.000`, `total_paid_amount === 500.000`                |
