import {
  assertCustomerSafePdfPayload,
  type CustomerSafePdfPayload,
  type QuoteOrderStatusType,
  type PrintProductionStatusType,
  type PrintDeliveryStatusType,
  type PrintPaymentStatusType,
} from '../../../../../packages/contracts/src/printquote.js';

export function formatVnd(amount: number | null | undefined): string {
  const safe =
    typeof amount === 'number' && Number.isFinite(amount)
      ? Math.round(amount)
      : 0;
  return `${safe.toLocaleString('vi-VN')} ₫`;
}

export function formatExactVnd(amount: number | null | undefined): string {
  const safe =
    typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const rounded2 = Math.round(safe * 100) / 100;
  return `${rounded2.toLocaleString('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ₫`;
}

export interface CustomerLinePriceDisplay {
  unitPriceDisplay: string;
  priceSubNote: string | null;
  isExact: boolean;
}

/**
 * Formats unit price on customer-facing A4 PDF and Customer Summary view so that:
 * 1. Exact integer unit price (e.g. 100.000 ÷ 100 = 1.000 ₫) -> "1.000 ₫"
 * 2. Exact finite 2-decimal unit price (e.g. 76.316 ÷ 100 = 763,16 ₫) -> "763,16 ₫" (763,16 × 100 = 76.316 ₫ exact)
 * 3. Non-terminating decimal unit price (e.g. 68.684 ÷ 3 = 22.894,666... ₫) -> "~22.895 ₫" + "Tính trọn gói 3 tờ"
 * Never exposes technical accounting jargon like "Hiệu chỉnh làm tròn" to customers.
 */
export function formatCustomerLinePriceDisplay(
  lineTotal: number,
  quantity: number,
  unitLabel?: string | null,
): CustomerLinePriceDisplay {
  const qty = Math.max(1, Math.round(quantity || 1));
  const total = Math.round(lineTotal || 0);
  const unit = (unitLabel || 'sp').trim() || 'sp';

  if (total % qty === 0) {
    return {
      unitPriceDisplay: formatVnd(total / qty),
      priceSubNote: null,
      isExact: true,
    };
  }

  if ((total * 100) % qty === 0) {
    return {
      unitPriceDisplay: formatExactVnd(total / qty),
      priceSubNote: null,
      isExact: true,
    };
  }

  return {
    unitPriceDisplay: `~${formatVnd(Math.round(total / qty))}`,
    priceSubNote: `Tính trọn gói ${formatNumberVn(qty)} ${unit}`,
    isExact: false,
  };
}

export function formatNumberVn(amount: number | null | undefined): string {
  const safe =
    typeof amount === 'number' && Number.isFinite(amount)
      ? Math.round(amount)
      : 0;
  return safe.toLocaleString('vi-VN');
}

export function formatDateVn(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    return String(dateStr);
  }
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

const DIGITS_VN = [
  'không',
  'một',
  'hai',
  'ba',
  'bốn',
  'năm',
  'sáu',
  'bảy',
  'tám',
  'chín',
];

function readThreeDigitsVn(num: number, showZeroHundred: boolean): string {
  const hundred = Math.floor(num / 100);
  const ten = Math.floor((num % 100) / 10);
  const unit = num % 10;
  const parts: string[] = [];

  if (hundred > 0 || showZeroHundred) {
    parts.push(`${DIGITS_VN[hundred]} trăm`);
  }

  if (ten > 1) {
    parts.push(`${DIGITS_VN[ten]} mươi`);
    if (unit === 1) parts.push('mốt');
    else if (unit === 4) parts.push('tư');
    else if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(DIGITS_VN[unit]!);
  } else if (ten === 1) {
    parts.push('mười');
    if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(DIGITS_VN[unit]!);
  } else if (ten === 0 && unit > 0) {
    if (hundred > 0 || showZeroHundred) {
      parts.push('lẻ');
    }
    parts.push(DIGITS_VN[unit]!);
  }

  return parts.join(' ');
}

export function numberToVietnameseWords(amount: number): string {
  const n = Math.round(Math.abs(amount));
  if (!Number.isFinite(n) || n === 0) return 'Không đồng';

  const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ'];
  const groups: number[] = [];
  let temp = n;
  while (temp > 0) {
    groups.push(temp % 1000);
    temp = Math.floor(temp / 1000);
  }

  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const grp = groups[i]!;
    if (grp > 0) {
      const showZeroHundred = i < groups.length - 1;
      const grpWords = readThreeDigitsVn(grp, showZeroHundred);
      const unitLabel = units[i] || '';
      words.push(unitLabel ? `${grpWords} ${unitLabel}` : grpWords);
    }
  }

  const sentence = words.join(' ').trim();
  if (!sentence) return 'Không đồng';
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} đồng chẵn`;
}

export const QUOTE_STATUS_LABELS: Record<QuoteOrderStatusType, string> = {
  DRAFT: 'Bản nháp',
  SENT: 'Đã gửi khách',
  APPROVED: 'Khách đã duyệt',
  FINALIZED: 'Đã chốt báo giá',
  CONVERTED: 'Đã chuyển đơn in',
  CANCELLED: 'Đã hủy',
};

export const PRODUCTION_STATUS_LABELS: Record<
  PrintProductionStatusType,
  string
> = {
  PENDING: 'Chờ bình file',
  PREPRESS: 'Đang chế bản',
  PRINTING: 'Đang in ấn',
  FINISHING: 'Gia công sau in',
  COMPLETED: 'Hoàn tất sản xuất',
  CANCELLED: 'Đã hủy in',
};

export const DELIVERY_STATUS_LABELS: Record<PrintDeliveryStatusType, string> = {
  NOT_SHIPPED: 'Chưa giao hàng',
  PACKING: 'Đang đóng gói',
  SHIPPING: 'Đang vận chuyển',
  DELIVERED: 'Đã giao thành công',
  RETURNED: 'Hoàn trả',
};

export const PAYMENT_STATUS_LABELS: Record<PrintPaymentStatusType, string> = {
  UNPAID: 'Chưa thanh toán',
  DEPOSIT_PAID: 'Đã đặt cọc',
  PARTIALLY_PAID: 'Thanh toán 1 phần',
  PAID: 'Đã tất toán',
};

export interface PrintQuoteA4Metadata {
  quoteCode: string;
  quoteTitle: string;
  versionNo?: number | undefined;
  createdAt?: string | undefined;
  validUntil?: string | null | undefined;
  workspaceName?: string | undefined;
  customerName?: string | null | undefined;
  customerCompany?: string | null | undefined;
  customerPhone?: string | null | undefined;
  customerEmail?: string | null | undefined;
  customerAddress?: string | null | undefined;
  customerNotes?: string | null | undefined;
  itemSpecifications?: Record<
    string,
    { specification?: string | undefined; unit?: string | undefined }
  >;
}

function escapeHtml(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a print-ready Vietnamese A4 Quotation HTML document.
 * SECURITY GUARANTEE: Calls assertCustomerSafePdfPayload() first to ensure
 * ZERO vendor cost, profit margin, or internal pricing data can ever appear.
 */
export function buildPrintQuoteA4Html(
  pdfPayload: CustomerSafePdfPayload,
  meta: PrintQuoteA4Metadata,
): string {
  assertCustomerSafePdfPayload(pdfPayload);

  const brandName = escapeHtml(meta.workspaceName || 'HOÀI PHƯƠNG MEDIA');
  const quoteCode = escapeHtml(
    meta.quoteCode || pdfPayload.quoteCode || 'BG-DRAFT',
  );
  const quoteTitle = escapeHtml(meta.quoteTitle || 'Báo giá dịch vụ in ấn');
  const versionNo = meta.versionNo ?? 1;
  const dateDisplay = formatDateVn(
    meta.createdAt || pdfPayload.generatedAt || new Date().toISOString(),
  );
  const validUntilDisplay = meta.validUntil
    ? formatDateVn(meta.validUntil)
    : '07 ngày kể từ ngày báo giá';

  const customerName = escapeHtml(
    meta.customerName || pdfPayload.customerName || 'Quý khách hàng',
  );
  const customerCompany = escapeHtml(meta.customerCompany || '');
  const customerPhone = escapeHtml(
    meta.customerPhone || pdfPayload.customerPhone || '',
  );
  const customerEmail = escapeHtml(meta.customerEmail || '');
  const customerAddress = escapeHtml(
    meta.customerAddress || pdfPayload.customerAddress || '',
  );
  const customerNotes = escapeHtml(
    meta.customerNotes ||
      pdfPayload.notes ||
      '1. Báo giá trên đã được tính toán chính xác theo số lượng đặt in.\n2. Thời gian sản xuất dự kiến từ 2–4 ngày làm việc sau khi duyệt file thiết kế và xác nhận đặt cọc.',
  );

  const rowsHtml = pdfPayload.lines
    .map((item, idx) => {
      const extra = meta.itemSpecifications?.[item.id];
      const specRaw = extra?.specification || item.specification || '';
      const specText = specRaw
        ? `<div class="item-spec">Quy cách: ${escapeHtml(specRaw)}</div>`
        : '';
      const rawUnit = extra?.unit || item.unit || 'sp';
      const unitLabel = escapeHtml(rawUnit);
      const pricePresentation = formatCustomerLinePriceDisplay(
        item.lineTotal,
        item.quantity,
        rawUnit,
      );
      const priceNoteHtml = pricePresentation.priceSubNote
        ? `<div class="item-split-note">(${escapeHtml(pricePresentation.priceSubNote)})</div>`
        : '';

      return `
        <tr>
          <td class="col-stt">${idx + 1}</td>
          <td class="col-name">
            <div class="item-title">${escapeHtml(item.name)}</div>
            ${specText}
          </td>
          <td class="col-unit">${unitLabel}</td>
          <td class="col-qty">${formatNumberVn(item.quantity)}</td>
          <td class="col-price">
            <div>${escapeHtml(pricePresentation.unitPriceDisplay)}</div>
            ${priceNoteHtml}
          </td>
          <td class="col-total">${formatVnd(item.lineTotal)}</td>
        </tr>
      `;
    })
    .join('\n');

  const reconciledLinesSubtotal = pdfPayload.lines.reduce(
    (sum, item) => sum + item.lineTotal,
    0,
  );

  const shippingRowHtml = pdfPayload.includeShippingInUnitPrice
    ? `
      <tr class="summary-row">
        <td colspan="5" class="summary-label">Cước vận chuyển / Giao hàng:</td>
        <td class="summary-val">Đã gộp trong đơn giá</td>
      </tr>
    `
    : pdfPayload.shippingAmountToAddOnPdfFooter > 0
      ? `
      <tr class="summary-row">
        <td colspan="5" class="summary-label">Cước vận chuyển / Giao hàng (tính 1 lần toàn đơn):</td>
        <td class="summary-val">${formatVnd(pdfPayload.shippingAmountToAddOnPdfFooter)}</td>
      </tr>
    `
      : '';

  const amountInWords = escapeHtml(
    numberToVietnameseWords(pdfPayload.grandTotalPayable),
  );

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>Báo giá ${quoteCode} - ${customerName}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm 14mm 14mm 14mm;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0F172A;
      background: #FFFFFF;
      margin: 0;
      padding: 0;
      font-size: 13px;
      line-height: 1.5;
    }
    .page-container {
      max-width: 210mm;
      margin: 0 auto;
      padding: 8mm 4mm;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0F766E;
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .brand-name {
      font-size: 18px;
      font-weight: 800;
      color: #0F766E;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .brand-sub {
      font-size: 12px;
      color: #475569;
      margin-top: 4px;
    }
    .doc-meta {
      text-align: right;
      font-size: 12px;
      color: #334155;
    }
    .doc-meta strong {
      color: #0F172A;
    }
    .doc-title-block {
      text-align: center;
      margin: 18px 0 20px;
    }
    .doc-title {
      font-size: 22px;
      font-weight: 800;
      color: #0F172A;
      margin: 0;
      letter-spacing: 0.03em;
    }
    .doc-subtitle {
      font-size: 14px;
      font-weight: 600;
      color: #0F766E;
      margin-top: 4px;
    }
    .customer-box {
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 18px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;
      font-size: 12.5px;
    }
    .customer-box .full-row {
      grid-column: 1 / -1;
    }
    table.quote-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    table.quote-table th {
      background: #0F766E;
      color: #FFFFFF;
      font-weight: 700;
      font-size: 12px;
      padding: 9px 10px;
      border: 1px solid #0F766E;
      text-transform: uppercase;
    }
    table.quote-table td {
      padding: 9px 10px;
      border: 1px solid #CBD5E1;
      vertical-align: top;
      font-size: 12.5px;
    }
    .col-stt { width: 42px; text-align: center; }
    .col-name { text-align: left; }
    .col-unit { width: 64px; text-align: center; }
    .col-qty { width: 86px; text-align: right; font-weight: 600; }
    .col-price { width: 120px; text-align: right; font-weight: 600; }
    .col-total { width: 135px; text-align: right; font-weight: 700; color: #0F172A; }
    .item-title { font-weight: 700; color: #0F172A; }
    .item-spec { font-size: 11.5px; color: #475569; margin-top: 2px; }
    .item-split-note { font-size: 11px; color: #0F766E; margin-top: 3px; font-style: italic; }
    .summary-row td {
      background: #F8FAFC;
      font-weight: 600;
    }
    .summary-label { text-align: right; color: #334155; }
    .summary-val { text-align: right; color: #0F172A; }
    .grand-total-row td {
      background: #F0FDFA;
      border-top: 2px solid #0F766E;
      font-size: 14px;
      font-weight: 800;
      color: #0F766E;
    }
    .amount-words {
      margin: 8px 0 16px;
      font-size: 12.5px;
      font-style: italic;
      color: #1E293B;
    }
    .notes-box {
      border: 1px dashed #94A3B8;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 12px;
      color: #334155;
      white-space: pre-line;
      margin-bottom: 26px;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      text-align: center;
      margin-top: 24px;
      page-break-inside: avoid;
    }
    .sig-title {
      font-weight: 700;
      font-size: 13px;
      text-transform: uppercase;
      color: #0F172A;
    }
    .sig-sub {
      font-size: 11.5px;
      color: #64748B;
      margin-bottom: 65px;
    }
    @media print {
      .no-print { display: none !important; }
      .page-container { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="page-container">
    <div class="no-print" style="margin-bottom: 16px; display: flex; justify-content: flex-end; gap: 8px;">
      <button onclick="window.print()" style="background:#0F766E;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-weight:700;cursor:pointer;">
        🖨️ In / Lưu PDF A4
      </button>
    </div>

    <div class="header">
      <div>
        <div class="brand-name">${brandName}</div>
        <div class="brand-sub">Giải pháp Thiết kế, In ấn &amp; Sản xuất Ấn phẩm Chuyên nghiệp</div>
      </div>
      <div class="doc-meta">
        <div>Mã báo giá: <strong>${quoteCode}</strong> (v${versionNo})</div>
        <div>Ngày báo giá: <strong>${dateDisplay}</strong></div>
        <div>Hiệu lực: <strong>${escapeHtml(validUntilDisplay)}</strong></div>
      </div>
    </div>

    <div class="doc-title-block">
      <h1 class="doc-title">BẢNG BÁO GIÁ IN ẤN</h1>
      <div class="doc-subtitle">${quoteTitle}</div>
    </div>

    <div class="customer-box">
      <div><strong>Kính gửi:</strong> ${customerName}</div>
      <div><strong>Điện thoại:</strong> ${customerPhone || '—'}</div>
      ${customerCompany ? `<div><strong>Đơn vị / Công ty:</strong> ${customerCompany}</div>` : ''}
      ${customerEmail ? `<div><strong>Email:</strong> ${customerEmail}</div>` : ''}
      ${customerAddress ? `<div class="full-row"><strong>Địa chỉ nhận hàng:</strong> ${customerAddress}</div>` : ''}
    </div>

    <table class="quote-table">
      <thead>
        <tr>
          <th class="col-stt">STT</th>
          <th class="col-name">Hạng mục / Quy cách in ấn</th>
          <th class="col-unit">ĐVT</th>
          <th class="col-qty">Số lượng</th>
          <th class="col-price">Đơn giá (VNĐ)</th>
          <th class="col-total">Thành tiền (VNĐ)</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr class="summary-row">
          <td colspan="5" class="summary-label">Cộng tiền hàng:</td>
          <td class="summary-val">${formatVnd(reconciledLinesSubtotal)}</td>
        </tr>
        ${shippingRowHtml}
        <tr class="grand-total-row">
          <td colspan="5" class="summary-label">TỔNG CỘNG THANH TOÁN:</td>
          <td class="summary-val">${formatVnd(pdfPayload.grandTotalPayable)}</td>
        </tr>
      </tbody>
    </table>

    <div class="amount-words">
      <strong>Số tiền bằng chữ:</strong> ${amountInWords}.
    </div>

    <div class="notes-box"><strong>Ghi chú &amp; Điều khoản báo giá:</strong>
${customerNotes}</div>

    <div class="signatures">
      <div>
        <div class="sig-title">XÁC NHẬN CỦA KHÁCH HÀNG</div>
        <div class="sig-sub">(Ký, ghi rõ họ tên)</div>
      </div>
      <div>
        <div class="sig-title">ĐẠI DIỆN ĐƠN VỊ BÁO GIÁ</div>
        <div class="sig-sub">(Ký, ghi rõ họ tên)</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
