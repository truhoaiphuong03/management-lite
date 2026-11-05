# Thiết kế Kỹ thuật: PrintQuote — Giá Xưởng, Công Đoạn Gia Công, Tính m² & Nháp Chờ Giá

- **Dự án:** `management-lite`
- **Nhánh DEV:** `feat/printquote-workshop-stages` (Worktree: `C:\Projects\management-lite-pq-stages`)
- **Phạm vi:** Phân hệ Báo giá & Đơn đặt in (`PrintQuote` — Owner-only). Không sửa Sổ thu chi chung (`/finance`), không tác động Production.

---

## 1. Kết quả Khảo sát Hiện trạng & Phân tích Rủi ro (Step 1)

### 1.1. Những gì đã có sẵn (`0033_printquote_v1` + `v0.8.4`)

- **CSDL (`0033_printquote_v1.sql`):** Đã có `print_vendors`, `print_vendor_price_items`, `print_customers`, `print_quotes`, `print_quote_versions`, `print_orders`, `print_order_payments`.
- **Pricing Engine (`packages/contracts/src/printquote.ts`):** Đã hỗ trợ `PER_UNIT` và `TOTAL_BATCH`, lợi nhuận `FIXED_AMOUNT` / `PERCENTAGE`, phí ship toàn đơn cộng 1 lần, phân bổ ship Largest Remainder, làm tròn đơn giá (`CEIL`/`NEAREST`/`FLOOR`), kiểm tra rò rỉ PDF (`assertCustomerSafePdfPayload`) và `integrityHash` SHA-256.
- **Giao diện (`PrintQuoteScreen.tsx` + `CreateQuoteTab.tsx`):** Đã có cầu nối nháp thuần RAM (`printquote-draft-bridge.ts`), bố cục 2 cột Desktop / 1 cột điện thoại, xem/xuất PDF A4 và khóa chỉnh sửa trực tiếp báo giá `FINALIZED` / `CONVERTED`.

### 1.2. Những điểm còn thiếu so với yêu cầu nghiệp vụ mới

1. **Bảng giá xưởng (`print_vendor_price_items`):**
   - `vendor_id` đang `NOT NULL` + `ON DELETE CASCADE` → chưa cho phép tạo giá xưởng chung không gắn xưởng cụ thể, và xóa xưởng có nguy cơ xóa dây chuyền mục giá.
   - Chưa tách loại mục giá `BASE_PRINT` (Giá cơ bản) và `FINISHING` (Giá gia công).
   - `pricing_mode` và `default_profit_scope` mới chỉ cho `PER_UNIT | TOTAL_BATCH`, chưa có `PER_SQM` (`Theo m²`).
   - Chưa có `included_stages` (danh sách công đoạn đã gộp sẵn trong giá cơ bản), `structured_spec` (chất liệu/định lượng/khổ/in màu/cán màng), `conditions_note` (điều kiện áp dụng), cơ chế sửa/ngừng dùng/khôi phục và bảng lịch sử thay đổi giá `print_vendor_price_item_history`.
2. **Dòng sản phẩm báo giá (`QuoteLineInput` / `CalculatedQuoteLine`):**
   - Mới chỉ có 1 khoản giá vốn đơn lẻ, chưa có mảng `finishingStages` (`0..N` công đoạn với đơn giá và cách tính riêng từng công đoạn).
   - Chưa có cấu trúc diện tích `areaSpec` (`Ngang × Cao × Số tấm` hoặc nhập trực tiếp tổng `m²`, tách `actualAreaSqm` và `billableAreaSqm`).
3. **Trạng thái nháp `"Chờ giá xưởng"` (`PENDING_COST`):**
   - Hiện tại UI và API bắt buộc mọi dòng phải có giá vốn số `>= 0` mới cho lưu; chưa phân biệt **giá trống (`null` — Chờ giá)** với **giá `0` chủ động nhập (`0`)**.
   - `print_quotes.customer_pdf_json` đang `NOT NULL`, chưa có cột `pricing_status` (`COMPLETE` | `PENDING_COST`) để lưu nháp chờ giá mà không sinh tổng tiền/PDF giả.
4. **Xóa nháp báo giá (`DELETE /quotes/:id`):**
   - Chưa có endpoint xóa báo giá nháp (`DRAFT`) kèm chặn xóa báo giá đã gửi/chốt/chuyển đơn.

### 1.3. Các điểm dễ cộng trùng / sai số đã phát hiện khi đọc code

1. **Cộng trùng công đoạn đã gộp trong giá cơ bản:** Nếu mục giá cơ bản đã bao gồm cán màng (ví dụ `A4 C200, in màu 2 mặt, cán màng 1 mặt`) mà người dùng chọn thêm công đoạn `Cán màng 1 mặt`, hệ thống cần hiển thị rõ các công đoạn đã gộp và cảnh báo ngay trên dòng sản phẩm (không âm thầm tự cộng ẩn hoặc tự xóa).
2. **Chọn lặp cùng một công đoạn trên cùng sản phẩm:** Phải chặn thêm trùng cùng `priceItemId` hoặc cùng mã công đoạn chuẩn hóa trên cùng 1 dòng sản phẩm (`DUPLICATE_FINISHING_STAGE`).
3. **Nhân nhầm phí ship theo số lượng:** Giữ bất biến phí giao hàng toàn đơn chỉ cộng 1 lần ở cấp báo giá (`700.000 + 40.000 = 740.000đ`, tuyệt đối không nhân `100 tờ`).
4. **Làm tròn sai số lượng `m²` trên PDF:** Trong `apps/api/src/printquote/pdf-renderer.ts:78` và `apps/web/src/screens/helpers/printquote-helpers.ts:394,425`, hàm hiển thị đang `Math.round(quantity)` → nếu dòng tính trực tiếp theo `2,88 m²` sẽ bị làm tròn sai thành `3`. Giải pháp: giữ `quantity` là số nguyên dương (`số tấm / số bộ`, bằng `1` khi nhập tổng `m²` trực tiếp), đồng thời lưu `areaSpec` chính xác và truyền `displayAreaSqm` sang trình kết xuất PDF để hiển thị đúng `2,88 m²` và đơn giá `/m²` mà không phá vỡ bất biến số nguyên của `buildExactSplitSchedule` và báo giá cũ.
5. **Sai số dấu phẩy động IEEE-754 (`0.8 * 1.2 * 3 = 2.8800000000000003`):** Toàn bộ phép nhân diện tích và nhân `đơn giá/m² × diện tích tính tiền` dùng số nguyên tỷ lệ `BigInt` (`1 m = 10.000` đơn vị `0,1mm`; `1 m² = 1.000.000 micro-m²`), chỉ làm tròn `half-up` đúng 1 lần sang đồng chẵn (`VND`) ở kết quả thành tiền của từng khoản.

---

## 2. Thiết kế Dữ liệu, Migration `0034` & Kế hoạch Rollback (Step 2 & 3)

### 2.1. Lý do bắt buộc cần Migration `0034_printquote_workshop_stages_v2.sql`

- Cho phép `print_vendor_price_items.vendor_id` nhận `NULL` và đổi FK sang `ON DELETE SET NULL` (bảo toàn mục giá khi không chọn xưởng hoặc khi xưởng thay đổi).
- Mở rộng `CHECK` của `pricing_mode` và `default_profit_scope` thêm `'PER_SQM'`.
- Thêm các cột phân loại và chống cộng trùng trên `print_vendor_price_items`: `item_type` (`'BASE_PRINT' | 'FINISHING'`), `included_stages jsonb`, `structured_spec jsonb`, `conditions_note text`, `updated_by uuid`.
- Tạo bảng lịch sử giá `print_vendor_price_item_history` (`ON DELETE RESTRICT` tới `print_vendor_price_items`) lưu người sửa, thời gian, hành động (`CREATED | UPDATED | DEACTIVATED | RESTORED`) và snapshot trước/sau.
- Bổ sung `pricing_status` (`'COMPLETE' | 'PENDING_COST'`) và `pending_cost_summary jsonb` trên `print_quotes` & `print_quote_versions`; cho phép `customer_pdf_json` nhận `NULL` **chỉ khi** `pricing_status = 'PENDING_COST' AND status = 'DRAFT'` bằng ràng buộc `CHECK` cấp DB.

### 2.2. Bảo toàn dữ liệu cũ & Rollback

- **Tương thích dữ liệu cũ 100%:** Toàn bộ cột mới có `DEFAULT` an toàn (`item_type = 'BASE_PRINT'`, `included_stages = '[]'`, `pricing_status = 'COMPLETE'`). Báo giá cũ không có `finishingStages` hay `areaSpec` đi qua nhánh tính toán cũ với kết quả và `integrityHash` giữ nguyên tuyệt đối.
- **Không nạp dữ liệu mẫu:** Migration chỉ định nghĩa cấu trúc bảng/ràng buộc, không `INSERT` bất kỳ bảng giá mẫu nào vào workspace thật.
- **Kịch bản Rollback (`scripts/db/rollback-0034-printquote-workshop-stages.sql`):** Kiểm tra trước điều kiện không có bản ghi đang dùng tính năng mới (`pricing_status = 'PENDING_COST'`, `pricing_mode = 'PER_SQM'`, `vendor_id IS NULL`), sau đó gỡ bảng `print_vendor_price_item_history`, khôi phục các `CHECK` constraint và cột về trạng thái `0033_printquote_v1`, xóa dòng `0034` khỏi `schema_migrations`. Được diễn tập trực tiếp trên PostgreSQL cô lập `:55433` (`forward -> rollback -> re-apply`).

---

## 3. Thiết kế Pricing Engine & Trạng thái Chờ Giá (`packages/contracts/src/printquote.ts`)

### 3.1. Công thức tính vốn & giá bán

- **Diện tích (`areaSpec`):**
  - `DIMENSIONS`: `actualAreaSqm = (widthScaled * heightScaled * sheetsCount) / 10^8` (làm tròn tối đa 6 chữ số thập phân không sai số float). `billableAreaSqm` mặc định bằng `actualAreaSqm`; chỉ khác khi Owner chủ động nhập điều chỉnh.
  - `DIRECT_AREA`: Owner nhập trực tiếp `actualAreaSqm` (và `billableAreaSqm` nếu điều chỉnh).
- **Vốn cơ bản (`baseVendorCost`):**
  - `PER_UNIT`: `Math.round(baseRate * quantity)`
  - `PER_SQM`: `roundHalfUpBigInt(baseRate * billableAreaSqm)`
  - `TOTAL_BATCH`: `Math.round(baseBatchCost)`
- **Vốn từng công đoạn gia công (`stage[k].vendorCost`):**
  - `PER_UNIT`: `Math.round(stage.rate * quantity)`
  - `PER_SQM`: `roundHalfUpBigInt(stage.rate * (stage.billableAreaSqm ?? lineBillableAreaSqm))`
  - `TOTAL_BATCH`: `Math.round(stage.rate)`
- **Tổng vốn dòng sản phẩm:**
  `totalVendorCost = baseVendorCost + sum(stage.vendorCost)` (cộng thêm `extraCost` chỉ khi đọc báo giá legacy cũ).
- **Lợi nhuận dòng sản phẩm (`totalProfit`):**
  - `FIXED_AMOUNT` + `PER_UNIT`: `Math.round(profit.value * quantity)`
  - `FIXED_AMOUNT` + `PER_SQM`: `roundHalfUpBigInt(profit.value * billableAreaSqm)`
  - `FIXED_AMOUNT` + `TOTAL_BATCH`: `Math.round(profit.value)`
  - `PERCENTAGE`: `Math.round((totalVendorCost * profit.value) / 100)`
- **Giá báo khách:** `baseSellingAmount = totalVendorCost + totalProfit`; phí ship toàn đơn cộng **đúng 1 lần** (gộp phân bổ vào đơn giá hoặc tách dòng cuối PDF theo cấu hình).

### 3.2. Phân biệt Giá trống (`null`) vs Giá `0` chủ động (`0`)

- Trong `DraftLineState` và API payload:
  - Ô giá để trống (`""` / `null`) → `isPendingCost = true` (`"Chờ giá xưởng"`).
  - Ô giá nhập `"0"` (`0`) → `isPendingCost = false`, khoản đó có vốn `0 ₫` hợp lệ.
- Khi bất kỳ dòng nào có vốn cơ bản hoặc công đoạn gia công `rate === null`:
  - Báo giá mang `pricing_status = 'PENDING_COST'`, chỉ được lưu ở trạng thái `DRAFT`, không sinh tổng vốn/lời/giá bán hoàn chỉnh và `customer_pdf_json = null`.

---

## 4. Thiết kế API & Bảo mật Phân quyền (`apps/api/src/printquote/`)

- **Phân quyền:** Toàn bộ endpoint `/api/v1/print-quotes/*` kiểm tra cứng `ctx.workspace.role === 'owner'` ở backend (`403 FORBIDDEN` cho mọi role khác).
- **Danh mục Giá xưởng (`/price-items`):**
  - `GET /price-items?include_inactive=1&item_type=BASE_PRINT|FINISHING`
  - `POST /price-items`: tạo giá cơ bản hoặc gia công (`vendor_id` tùy chọn), ghi lịch sử `CREATED` (`v1`).
  - `PATCH /price-items/:id`: cập nhật mục giá, tăng `version`, ghi lịch sử `UPDATED` (báo giá cũ giữ nguyên snapshot).
  - `POST /price-items/:id/deactivate` & `POST /price-items/:id/restore`: ngừng dùng / khôi phục, ghi lịch sử `DEACTIVATED` / `RESTORED`.
  - `DELETE /price-items/:id`: nếu mục giá đã từng xuất hiện trong bất kỳ báo giá/phiên bản báo giá nào → chặn xóa vật lý (`409 PRICE_ITEM_IN_USE`), hướng dẫn ngừng dùng; nếu chưa từng dùng → cho xóa sạch trong transaction.
  - `GET /price-items/:id/history`: trả danh sách lịch sử thay đổi giá kèm tên người thực hiện và thời gian.
- **Báo giá & Chặn cứng khi thiếu giá (`PENDING_COST`):**
  - `POST /quotes` & `PATCH /quotes/:id`: cho phép lưu nháp `PENDING_COST` khi `status = 'DRAFT'`; trả `409 QUOTE_PENDING_VENDOR_COST` nếu yêu cầu trạng thái khác `DRAFT` khi còn mục thiếu giá.
  - `DELETE /quotes/:id`: chỉ cho xóa khi `status = 'DRAFT'` và chưa có đơn hàng; trả `409` cho `SENT / APPROVED / FINALIZED / CONVERTED`.
  - `POST /quotes/:id/finalize`, `GET /quotes/:id/pdf`, `GET /quotes/:id/pdf-file`, `POST /orders`: kiểm tra cứng `quote.pricing_status === 'COMPLETE' && quote.customer_pdf_json !== null`; nếu `PENDING_COST` trả `409 QUOTE_PENDING_VENDOR_COST`.
- **Chống lộ dữ liệu nội bộ trên PDF:** Mở rộng `FORBIDDEN_CUSTOMER_PDF_KEYS` chặn thêm `baseVendorCost`, `finishingVendorCost`, `finishingStages`, `stageVendorCost`, `includedStages`, `conditionsNote`, `internalNote`, `costSource`, `pricingStatus`, `pendingCostSummary`.

---

## 5. Thiết kế Giao diện gọn nhẹ Desktop & Điện thoại (`apps/web/src/screens/printquote/`)

1. **Trang Bảng giá xưởng (`/print-quotes/catalog/prices`):**
   - Thanh lọc nhanh 1 dòng: `Tất cả` · `Giá in cơ bản` · `Giá gia công` · `Đã ngừng dùng`.
   - Form Modal gọn: chọn loại (`Giá cơ bản` / `Giá gia công`), Tên hạng mục, Xưởng (không bắt buộc), Gợi ý chất liệu/quy cách nhanh (`Giấy Couche C100–C300`, `Giấy Fort 60–100`, `Decal giấy/sữa/trong/dán kính/nhựa`, `Bạt`, `Khác` tự nhập), Đơn vị, Cách tính (`Theo đơn vị` / `Theo m²` / `Trọn lô`), Giá xưởng, Công đoạn đã gộp sẵn (cho Giá cơ bản), Ghi chú điều kiện áp dụng.
   - Thao tác trên từng thẻ: `Báo giá`, `Sửa`, `Lịch sử`, `Ngừng dùng` / `Khôi phục` (hoặc `Xóa` nếu chưa dùng).
2. **Trình tạo/sửa sản phẩm trong báo giá (`/print-quotes/new`, `/print-quotes/:id/edit`):**
   - Bố cục đúng thứ tự 6 bước gọn trong thẻ sản phẩm:
     1. **Tên sản phẩm** + chip tóm tắt ngắn gọn sau khi chọn (`"A4 C200 · In màu 2 mặt · Cán màng 1 mặt"`).
     2. **Giá cơ bản:** chọn từ danh mục `Giá cơ bản` đã lưu hoặc nhập thủ công; cho để trống (`Chờ giá xưởng`) hoặc nhập `0` chủ động; nếu sửa giá đã chọn từ danh mục thì hiện nhãn _"Giá riêng báo giá này"_ + nút **`Lưu vào bảng giá…`** (mở hộp thoại xác nhận riêng).
     3. **Quy cách:** gợi ý theo nhóm chất liệu (`Giấy` / `Decal` / `Bạt` / `Khác`) chỉ mở đúng trường liên quan, cho sửa tự do, không bung bảng lớn.
     4. **Công đoạn gia công:** nút `+ Thêm gia công` (chọn mục `Giá gia công` đã lưu hoặc nhập tay); hỗ trợ nhiều công đoạn, mỗi công đoạn có cách tính (`Đơn vị` / `m²` / `Trọn lô`) và giá riêng (hoặc để trống `Chờ giá`), nút xóa từng công đoạn; cảnh báo rõ nếu trùng công đoạn đã bao gồm trong giá cơ bản.
     5. **Số lượng & Đơn vị / Khung tính `m²`:** tự động mở khung nhập `Ngang (m) × Cao (m) × Số tấm` hoặc `Nhập tổng m²` khi đơn vị là `m²` hoặc có khoản tính `Theo m²`, tách rõ `Diện tích thực tế` và `Diện tích tính tiền (nếu điều chỉnh)`.
     6. **Tổng hợp dòng:** hiển thị rõ `Vốn cơ bản + Vốn gia công = Giá vốn tổng hợp`, `Tiền lời` và `Giá báo khách` (hoặc nhãn `Chờ giá xưởng` khi còn khoản trống).
   - Khi thu gọn dòng sản phẩm: hiển thị gọn 1 dòng kèm nút `Sửa / Nhân đôi / Xóa`.
