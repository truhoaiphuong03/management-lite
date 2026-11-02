import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  assertCustomerSafePdfPayload,
  type CustomerSafePdfPayload,
} from '../../../../packages/contracts/src/printquote.js';

const execFileAsync = promisify(execFile);

export interface ServerA4PdfMeta {
  quoteCode: string;
  quoteTitle?: string | null;
  versionNo?: number | null;
  createdAt?: string | null;
  validUntil?: string | null;
  workspaceName?: string | null;
  customerName?: string | null;
  customerCompany?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  customerNotes?: string | null;
}

export function sanitizePdfFilename(quoteCode: string | null | undefined): string {
  const base = (quoteCode || 'BG-DRAFT')
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'BG-DRAFT'}.pdf`;
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

function formatNumberVn(amount: number | null | undefined): string {
  const safe =
    typeof amount === 'number' && Number.isFinite(amount)
      ? Math.round(amount)
      : 0;
  return safe.toLocaleString('vi-VN');
}

function formatVnd(amount: number | null | undefined): string {
  return `${formatNumberVn(amount)} ₫`;
}

function formatDateVn(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
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

export function numberToVietnameseWordsServer(amount: number): string {
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

/**
 * Builds print-ready Vietnamese A4 HTML strictly from CustomerSafePdfPayload.
 * Calls assertCustomerSafePdfPayload() first so vendor cost & profit can NEVER leak.
 */
export function buildServerA4Html(
  pdfPayload: CustomerSafePdfPayload,
  meta: ServerA4PdfMeta,
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
      const specText = item.specification
        ? `<div class="item-spec">Quy cách: ${escapeHtml(item.specification)}</div>`
        : '';
      const unitLabel = escapeHtml(item.unit || 'sp');
      const adjNote =
        item.roundingAdjustment !== 0
          ? `<div class="item-split-note">Đơn giá làm tròn: ${formatVnd(item.unitPrice)} × ${formatNumberVn(item.quantity)} = ${formatVnd(item.billedSubtotal)} (Hiệu chỉnh làm tròn: ${item.roundingAdjustment > 0 ? '+' : ''}${formatVnd(item.roundingAdjustment)})</div>`
          : '';

      return `
        <tr>
          <td class="col-stt">${idx + 1}</td>
          <td class="col-name">
            <div class="item-title">${escapeHtml(item.name)}</div>
            ${specText}
            ${adjNote}
          </td>
          <td class="col-unit">${unitLabel}</td>
          <td class="col-qty">${formatNumberVn(item.quantity)}</td>
          <td class="col-price">${formatVnd(item.unitPrice)}</td>
          <td class="col-total">${formatVnd(item.lineTotal)}</td>
        </tr>
      `;
    })
    .join('\n');

  const roundingSummaryRowsHtml =
    pdfPayload.totalRoundingAdjustment !== 0
      ? `
      <tr class="summary-row">
        <td colspan="5" class="summary-label">Tạm tính theo đơn giá làm tròn:</td>
        <td class="summary-val">${formatVnd(pdfPayload.subtotalFromLines)}</td>
      </tr>
      <tr class="summary-row">
        <td colspan="5" class="summary-label">Hiệu chỉnh làm tròn đơn giá:</td>
        <td class="summary-val">${pdfPayload.totalRoundingAdjustment > 0 ? '+' : ''}${formatVnd(pdfPayload.totalRoundingAdjustment)}</td>
      </tr>
    `
      : '';

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
    numberToVietnameseWordsServer(pdfPayload.grandTotalPayable),
  );

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>Báo giá ${quoteCode} - ${customerName}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 12mm 12mm 12mm;
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
      line-height: 1.48;
      width: 100%;
    }
    .page-container {
      width: 100%;
      max-width: 186mm;
      margin: 0 auto;
      padding: 2mm 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0F766E;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .brand-title {
      font-size: 18px;
      font-weight: 800;
      color: #0F766E;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      margin: 0 0 4px 0;
    }
    .brand-sub {
      font-size: 12px;
      color: #475569;
      margin: 0;
    }
    .doc-meta {
      text-align: right;
    }
    .doc-badge {
      display: inline-block;
      background: #F0FDFA;
      color: #0F766E;
      border: 1px solid #99F6E4;
      padding: 3px 10px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .doc-date {
      font-size: 12px;
      color: #475569;
    }
    .doc-heading {
      text-align: center;
      margin: 14px 0 16px 0;
    }
    .doc-heading h1 {
      font-size: 20px;
      font-weight: 800;
      color: #0F172A;
      margin: 0 0 4px 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .doc-heading p {
      font-size: 13px;
      color: #334155;
      margin: 0;
      font-weight: 600;
    }
    .customer-box {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 16px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 16px;
    }
    .customer-row {
      font-size: 12.5px;
      overflow-wrap: break-word;
    }
    .customer-label {
      color: #64748B;
      font-weight: 600;
      margin-right: 6px;
    }
    .customer-value {
      color: #0F172A;
      font-weight: 700;
    }
    table.quote-table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      margin-bottom: 14px;
    }
    table.quote-table th {
      background: #0F766E;
      color: #FFFFFF;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      padding: 8px 8px;
      border: 1px solid #0F766E;
    }
    table.quote-table td {
      padding: 8px 8px;
      border: 1px solid #CBD5E1;
      vertical-align: top;
      font-size: 12.5px;
      overflow-wrap: break-word;
      word-break: break-word;
    }
    .col-stt { width: 7%; text-align: center; font-weight: 600; }
    .col-name { width: 41%; text-align: left; }
    .col-unit { width: 10%; text-align: center; }
    .col-qty { width: 11%; text-align: right; font-weight: 600; }
    .col-price { width: 15%; text-align: right; font-weight: 600; }
    .col-total { width: 16%; text-align: right; font-weight: 700; color: #0F172A; }
    .item-title { font-weight: 700; color: #0F172A; margin-bottom: 2px; }
    .item-spec { font-size: 11.5px; color: #475569; }
    .item-split-note { font-size: 11px; color: #0F766E; margin-top: 2px; font-style: italic; }
    .summary-row td {
      background: #F8FAFC;
      font-weight: 600;
    }
    .summary-label { text-align: right; color: #334155; }
    .summary-val { text-align: right; font-weight: 700; color: #0F172A; }
    .grand-total-row td {
      background: #F0FDFA;
      border-top: 2px solid #0F766E;
      border-bottom: 2px solid #0F766E;
      font-size: 14px;
      font-weight: 800;
      color: #0F766E;
    }
    .words-box {
      background: #FFFBEB;
      border: 1px solid #FDE68A;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 12.5px;
      color: #92400E;
      margin-bottom: 14px;
    }
    .notes-box {
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 20px;
      font-size: 12px;
      color: #334155;
      white-space: pre-line;
      overflow-wrap: break-word;
    }
    .notes-title {
      font-weight: 700;
      color: #0F172A;
      margin-bottom: 4px;
      text-transform: uppercase;
      font-size: 11.5px;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      text-align: center;
      margin-top: 16px;
      page-break-inside: avoid;
    }
    .sig-title {
      font-weight: 700;
      font-size: 12.5px;
      text-transform: uppercase;
      color: #0F172A;
    }
    .sig-sub {
      font-size: 11px;
      color: #64748B;
      font-style: italic;
      margin-bottom: 54px;
    }
  </style>
</head>
<body>
  <div class="page-container">
    <div class="header">
      <div>
        <div class="brand-title">${brandName}</div>
        <p class="brand-sub">Dịch vụ Thiết kế, In ấn &amp; Sản xuất Ấn phẩm Truyền thông</p>
      </div>
      <div class="doc-meta">
        <div class="doc-badge">Mã báo giá: ${quoteCode} (v${versionNo})</div>
        <div class="doc-date">Ngày lập: ${dateDisplay}</div>
        <div class="doc-date">Hiệu lực: ${validUntilDisplay}</div>
      </div>
    </div>

    <div class="doc-heading">
      <h1>BẢNG BÁO GIÁ DỊCH VỤ IN ẤN</h1>
      <p>${quoteTitle}</p>
    </div>

    <div class="customer-box">
      <div class="customer-row">
        <span class="customer-label">Khách hàng:</span>
        <span class="customer-value">${customerName}</span>
      </div>
      <div class="customer-row">
        <span class="customer-label">Số điện thoại:</span>
        <span class="customer-value">${customerPhone || '—'}</span>
      </div>
      ${
        customerCompany
          ? `<div class="customer-row"><span class="customer-label">Đơn vị / Công ty:</span><span class="customer-value">${customerCompany}</span></div>`
          : ''
      }
      ${
        customerEmail
          ? `<div class="customer-row"><span class="customer-label">Email:</span><span class="customer-value">${customerEmail}</span></div>`
          : ''
      }
      <div class="customer-row" style="grid-column: 1 / -1;">
        <span class="customer-label">Địa chỉ giao hàng:</span>
        <span class="customer-value">${customerAddress || 'Theo yêu cầu của Quý khách'}</span>
      </div>
    </div>

    <table class="quote-table">
      <thead>
        <tr>
          <th class="col-stt">STT</th>
          <th class="col-name">Tên ấn phẩm &amp; Quy cách kỹ thuật</th>
          <th class="col-unit">ĐVT</th>
          <th class="col-qty">Số lượng</th>
          <th class="col-price">Đơn giá (VND)</th>
          <th class="col-total">Thành tiền (VND)</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        ${roundingSummaryRowsHtml}
        ${shippingRowHtml}
        <tr class="grand-total-row">
          <td colspan="5" style="text-align: right;">TỔNG CỘNG THANH TOÁN:</td>
          <td style="text-align: right;">${formatVnd(pdfPayload.grandTotalPayable)}</td>
        </tr>
      </tbody>
    </table>

    <div class="words-box">
      <strong>Số tiền viết bằng chữ:</strong> ${amountInWords}.
    </div>

    <div class="notes-box">
      <div class="notes-title">Ghi chú &amp; Điều khoản đặt in:</div>
      <div>${customerNotes}</div>
    </div>

    <div class="signatures">
      <div>
        <div class="sig-title">XÁC NHẬN CỦA KHÁCH HÀNG</div>
        <div class="sig-sub">(Ký, ghi rõ họ tên &amp; xác nhận đặt in)</div>
      </div>
      <div>
        <div class="sig-title">ĐẠI DIỆN ${brandName}</div>
        <div class="sig-sub">(Ký và ghi rõ họ tên)</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

const BROWSER_CANDIDATES = [
  process.env['CHROME_BIN'],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((p): p is string => Boolean(p && existsSync(p)));

function buildFallbackPdfBuffer(
  pdfPayload: CustomerSafePdfPayload,
  meta: ServerA4PdfMeta,
): Buffer {
  assertCustomerSafePdfPayload(pdfPayload);
  const lines: string[] = [
    `BAO GIA DICH VU IN AN - ${meta.quoteCode || pdfPayload.quoteCode}`,
    `Khach hang: ${meta.customerName || pdfPayload.customerName || 'Quy khach'}`,
    `Tong thanh toan: ${formatVnd(pdfPayload.grandTotalPayable)}`,
  ];
  for (const item of pdfPayload.lines) {
    lines.push(
      `${item.index}. ${item.name} | SL: ${item.quantity} | Don gia: ${item.unitPrice} | Thanh tien: ${item.lineTotal}`,
    );
  }
  const streamBody = [
    'BT',
    '/F1 12 Tf',
    '50 780 Td',
    ...lines.map((l, idx) => {
      const safeAscii = l
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .replace(/[()\\]/g, '');
      return `${idx === 0 ? '' : '0 -20 Td '}(${safeAscii}) Tj`;
    }),
    'ET',
  ].join('\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamBody, 'utf8')} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

export async function renderCustomerSafeA4PdfBuffer(
  pdfPayload: CustomerSafePdfPayload,
  meta: ServerA4PdfMeta,
): Promise<Buffer> {
  assertCustomerSafePdfPayload(pdfPayload);
  const html = buildServerA4Html(pdfPayload, meta);

  const browserBin = BROWSER_CANDIDATES[0];
  if (!browserBin) {
    return buildFallbackPdfBuffer(pdfPayload, meta);
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'mglite-pq-pdf-'));
  const htmlPath = join(tempDir, 'quote.html');
  const pdfPath = join(tempDir, 'quote.pdf');

  try {
    await writeFile(htmlPath, html, 'utf8');
    await execFileAsync(
      browserBin,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        `file://${htmlPath}`,
      ],
      { timeout: 15_000 },
    );
    const pdfBuf = await readFile(pdfPath);
    if (pdfBuf.length > 100 && pdfBuf.subarray(0, 5).toString('ascii') === '%PDF-') {
      return pdfBuf;
    }
    return buildFallbackPdfBuffer(pdfPayload, meta);
  } catch {
    return buildFallbackPdfBuffer(pdfPayload, meta);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
