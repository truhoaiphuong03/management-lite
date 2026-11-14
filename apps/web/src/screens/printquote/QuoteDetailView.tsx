import React, { useMemo, useState } from 'react';
import { StatusBadge } from '../../../../../packages/ui/src/components/index.js';
import {
  enrichCustomerSafePdfWithAreaBounds,
  type PrintCustomerData,
  type PrintQuoteData,
} from '../../../../../packages/contracts/src/printquote.js';
import {
  buildPrintQuoteA4Html,
  formatAreaSqmVn,
  formatDateVn,
  formatNumberVn,
  formatVnd,
  QUOTE_STATUS_LABELS,
} from '../helpers/printquote-helpers.js';
import { cardStyle, isQuoteStatusEditable, tabularNumStyle } from './types.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';
import {
  PqArrowLeftIcon,
  PqCheckIcon,
  PqCopyIcon,
  PqDownloadIcon,
  PqEditIcon,
  PqEyeIcon,
  PqFileTextIcon,
  PqHistoryIcon,
  PqLockIcon,
  PqPackageIcon,
  PqPrinterIcon,
  PqShieldIcon,
  PqTrashIcon,
} from './PrintQuoteIcons.js';

import type { OwnerPaymentBankInfo } from '../../../../../packages/contracts/src/vietqr.js';

export interface QuoteDetailViewProps {
  quote: PrintQuoteData | null;
  loading: boolean;
  workspaceName: string;
  customers: PrintCustomerData[];
  ownerBank?: OwnerPaymentBankInfo | null | undefined;
  onBackToList: () => void;
  onDownloadSavedPdf: (quoteId: string, quoteCode: string) => void;
  onOpenFullPreview: (quote: PrintQuoteData) => void;
  onPrintWindow: (html: string) => void;
  onEditQuote: (quote: PrintQuoteData) => void;
  onCloneQuoteAsNew: (quote: PrintQuoteData) => void;
  onFinalizeQuote: (quoteId: string) => void;
  onConvertQuoteToOrder: (quote: PrintQuoteData) => void;
  onDeleteDraftQuote?:
    ((quote: PrintQuoteData) => Promise<void> | void) | undefined;
}

export const QuoteDetailView: React.FC<QuoteDetailViewProps> = ({
  quote,
  loading,
  workspaceName,
  customers,
  ownerBank,
  onBackToList,
  onDownloadSavedPdf,
  onOpenFullPreview,
  onPrintWindow,
  onEditQuote,
  onCloneQuoteAsNew,
  onFinalizeQuote,
  onConvertQuoteToOrder,
  onDeleteDraftQuote,
}) => {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState<boolean>(false);

  const customer = useMemo(
    () =>
      quote ? customers.find((c) => c.id === quote.customer_id) || null : null,
    [customers, quote],
  );

  const isPendingCost = Boolean(
    quote &&
    (quote.pricing_status === 'PENDING_COST' ||
      quote.customer_pdf_json === null),
  );

  const a4Html = useMemo(() => {
    if (!quote || !quote.customer_pdf_json || isPendingCost) return '';
    const enrichedPdf = enrichCustomerSafePdfWithAreaBounds(
      quote.customer_pdf_json,
      quote.lines_json,
    );
    return buildPrintQuoteA4Html(enrichedPdf, {
      quoteCode: quote.quote_code,
      quoteTitle: quote.title,
      versionNo: quote.current_version,
      createdAt: quote.created_at,
      validUntil: quote.valid_until,
      workspaceName,
      customerName: quote.customer_name || customer?.name || 'Quý khách hàng',
      customerCompany: customer?.company_name || null,
      customerPhone: quote.customer_phone || customer?.phone || null,
      customerEmail: customer?.email || null,
      customerAddress: quote.customer_address || customer?.address || null,
      customerNotes: quote.notes,
      paymentBank: ownerBank ?? null,
    });
  }, [quote, customer, workspaceName, isPendingCost, ownerBank]);

  if (loading && !quote) {
    return (
      <div style={cardStyle} data-testid="panel-quote-detail-loading">
        <div style={{ fontSize: '13.5px', color: 'var(--muted-color)' }}>
          Đang tải chi tiết báo giá…
        </div>
      </div>
    );
  }

  if (!quote) {
    return (
      <div style={cardStyle} data-testid="pq-quote-not-found">
        <h1 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700 }}>
          Không tìm thấy báo giá
        </h1>
        <p
          style={{
            margin: '0 0 14px',
            fontSize: '13px',
            color: 'var(--muted-color)',
          }}
        >
          Mã báo giá không tồn tại hoặc không thuộc không gian làm việc hiện
          tại.
        </p>
        <button
          type="button"
          data-testid="pq-detail-back-btn"
          onClick={onBackToList}
          className="pq-btn pq-btn-secondary"
        >
          <PqArrowLeftIcon size={15} />
          <span>Quay lại Danh sách báo giá</span>
        </button>
      </div>
    );
  }

  const canEditInPlace = isQuoteStatusEditable(quote.status);

  return (
    <div
      data-testid="panel-quote-detail"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      {/* Top Contextual Navigation */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <button
          type="button"
          data-testid="pq-detail-back-btn"
          onClick={onBackToList}
          className="pq-btn pq-btn-secondary"
        >
          <PqArrowLeftIcon size={15} />
          <span>Danh sách báo giá</span>
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <StatusBadge
            status="neutral"
            label={`Phiên bản v${quote.current_version}`}
          />
          <StatusBadge
            status={
              quote.status === 'CONVERTED'
                ? 'success'
                : quote.status === 'FINALIZED'
                  ? 'warning'
                  : 'muted'
            }
            label={QUOTE_STATUS_LABELS[quote.status] || quote.status}
          />
          {isPendingCost && (
            <StatusBadge status="warning" label="Chờ giá xưởng" />
          )}
        </div>
      </div>

      {/* Executive Summary & Action Card */}
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '16px',
            marginBottom: '16px',
          }}
        >
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div
              style={{
                fontSize: '12.5px',
                fontWeight: 700,
                color: 'var(--accent-text)',
                letterSpacing: '0.03em',
                marginBottom: '4px',
              }}
            >
              {quote.quote_code}
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: '20px',
                fontWeight: 800,
                lineHeight: 1.3,
              }}
            >
              {quote.title}
            </h1>
            <div
              style={{
                fontSize: '13px',
                color: 'var(--muted-color)',
                marginTop: '6px',
                lineHeight: 1.5,
              }}
            >
              Khách hàng:{' '}
              <strong style={{ color: 'var(--text-color)' }}>
                {quote.customer_name || customer?.name || 'Khách lẻ'}
              </strong>
              {quote.customer_phone || customer?.phone
                ? ` (${quote.customer_phone || customer?.phone})`
                : ''}{' '}
              • Ngày tạo: {formatDateVn(quote.created_at)}
              {quote.valid_until
                ? ` • Hiệu lực đến: ${formatDateVn(quote.valid_until)}`
                : ''}
            </div>
          </div>

          <div className="pq-hero-total-box">
            <div className="pq-hero-total-label">Tổng thanh toán báo khách</div>
            <div
              data-testid="pq-detail-total-quote"
              className="pq-hero-total-amount"
              style={tabularNumStyle}
            >
              {isPendingCost
                ? 'Chờ giá xưởng'
                : formatVnd(quote.total_quote_amount)}
            </div>
          </div>
        </div>

        {/* Structured Action Toolbar */}
        <div className="pq-quote-card-actions">
          <div className="pq-action-group-left">
            <button
              type="button"
              data-testid="pq-detail-download-pdf-btn"
              disabled={isPendingCost}
              onClick={() => onDownloadSavedPdf(quote.id, quote.quote_code)}
              className={
                isPendingCost
                  ? 'pq-btn pq-btn-secondary'
                  : 'pq-btn pq-btn-primary'
              }
            >
              <PqDownloadIcon size={15} />
              <span>Tải PDF ({quote.quote_code}.pdf)</span>
            </button>

            <button
              type="button"
              data-testid="pq-detail-print-btn"
              disabled={isPendingCost}
              onClick={() => onPrintWindow(a4Html)}
              className="pq-btn pq-btn-accent"
            >
              <PqPrinterIcon size={15} />
              <span>In A4</span>
            </button>

            <button
              type="button"
              data-testid="pq-detail-preview-modal-btn"
              disabled={isPendingCost}
              onClick={() => onOpenFullPreview(quote)}
              className="pq-btn pq-btn-secondary"
            >
              <PqEyeIcon size={15} />
              <span>Xem rộng A4</span>
            </button>

            {canEditInPlace && (
              <button
                type="button"
                data-testid="pq-detail-edit-btn"
                onClick={() => onEditQuote(quote)}
                className={
                  isPendingCost
                    ? 'pq-btn pq-btn-primary'
                    : 'pq-btn pq-btn-secondary'
                }
              >
                <PqEditIcon size={15} />
                <span>
                  {isPendingCost
                    ? `Nhập giá xưởng (v${quote.current_version + 1})`
                    : `Sửa báo giá (v${quote.current_version + 1})`}
                </span>
              </button>
            )}

            <button
              type="button"
              data-testid="pq-detail-clone-btn"
              onClick={() => onCloneQuoteAsNew(quote)}
              className="pq-btn pq-btn-secondary"
              title="Nhân bản nhanh sang báo giá mới (tự áp bảng giá xưởng mới nhất)"
            >
              <PqCopyIcon size={15} />
              <span>
                {canEditInPlace
                  ? 'Nhân bản báo giá'
                  : 'Tạo báo giá mới từ bản này'}
              </span>
            </button>

            {quote.status === 'DRAFT' && !isPendingCost && (
              <button
                type="button"
                data-testid="pq-detail-finalize-btn"
                onClick={() => onFinalizeQuote(quote.id)}
                className="pq-btn pq-btn-ghost"
              >
                <PqLockIcon size={15} />
                <span>Chốt báo giá</span>
              </button>
            )}

            {quote.status === 'DRAFT' && onDeleteDraftQuote && (
              <button
                type="button"
                data-testid="pq-detail-delete-draft-btn"
                onClick={() => setConfirmDeleteOpen(true)}
                className="pq-btn pq-btn-danger-ghost"
              >
                <PqTrashIcon size={15} />
                <span>Xóa nháp</span>
              </button>
            )}
          </div>

          <div className="pq-action-group-right">
            {quote.status !== 'CONVERTED' && quote.status !== 'CANCELLED' ? (
              <button
                type="button"
                data-testid="pq-detail-convert-btn"
                disabled={isPendingCost}
                onClick={() => onConvertQuoteToOrder(quote)}
                className="pq-btn pq-btn-success"
              >
                <PqPackageIcon size={15} />
                <span>Chuyển thành Đơn đặt in</span>
              </button>
            ) : quote.status === 'CONVERTED' ? (
              <span
                data-testid="pq-detail-converted-badge"
                className="pq-converted-pill"
              >
                <PqCheckIcon size={14} />
                <span>Đã chuyển sang Đơn đặt in</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Main Split: Elevated A4 Paper Preview + Owner Internal Breakdown */}
      <div className="pq-detail-split-layout">
        {/* Customer-Safe A4 Preview Stage (or Pending Cost Guard Notice) */}
        <div style={cardStyle} data-testid="pq-detail-a4-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              marginBottom: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PqFileTextIcon
                size={18}
                style={{ color: 'var(--accent-text)' }}
              />
              <div>
                <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                  Bản xem trước PDF A4 gửi khách
                </h2>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Ẩn tuyệt đối 100% giá gốc nhà in và lợi nhuận nội bộ
                </div>
              </div>
            </div>
            <span className="pq-safe-pill">
              <PqShieldIcon size={13} />
              <span>An toàn gửi khách</span>
            </span>
          </div>

          {isPendingCost ? (
            <div
              data-testid="pq-detail-pending-cost-notice"
              style={{
                padding: '24px 20px',
                borderRadius: '12px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '15px' }}>
                Đang tạm khóa xuất PDF A4 & Chốt đơn vì còn mục chờ giá xưởng
              </div>
              <div
                style={{
                  fontSize: '13px',
                  color: 'var(--muted-color)',
                  lineHeight: 1.5,
                }}
              >
                Hệ thống không tự tính tổng tiền báo khách khi giá cơ bản hoặc
                công đoạn gia công đang để trống. Vui lòng bấm{' '}
                <strong>Nhập giá xưởng</strong> để bổ sung các khoản sau:
              </div>
              {quote.pending_cost_summary &&
                quote.pending_cost_summary.length > 0 && (
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: '18px',
                      fontSize: '13px',
                      lineHeight: 1.6,
                    }}
                  >
                    {quote.pending_cost_summary.map((item) => (
                      <li key={item.lineId}>
                        <strong>{item.lineName}:</strong>{' '}
                        {[
                          item.missingBaseCost ? 'Chưa có giá in cơ bản' : null,
                          item.missingStageNames.length > 0
                            ? `Chưa có giá gia công (${item.missingStageNames.join(', ')})`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' • ')}
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          ) : (
            <div className="pq-a4-stage">
              <iframe
                title={`Bản xem trước A4 ${quote.quote_code}`}
                srcDoc={a4Html}
                className="pq-a4-iframe"
              />
            </div>
          )}
        </div>

        {/* Owner Internal Breakdown & Version History */}
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
          data-testid="pq-detail-internal-card"
        >
          <div style={cardStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '14px',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
              >
                <PqLockIcon size={16} style={{ color: 'var(--muted-color)' }} />
                <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                  Bóc tách nội bộ
                </h2>
              </div>
              <StatusBadge status="neutral" label="Chỉ Chủ sở hữu" />
            </div>

            <div className="pq-internal-kpi-grid">
              <div className="pq-kpi-mini-card">
                <div className="pq-kpi-mini-label">Giá vốn nhà in</div>
                <strong className="pq-kpi-mini-val" style={tabularNumStyle}>
                  {isPendingCost
                    ? 'Chờ giá xưởng'
                    : formatVnd(quote.total_vendor_cost)}
                </strong>
              </div>
              <div className="pq-kpi-mini-card">
                <div className="pq-kpi-mini-label">Lợi nhuận dự kiến</div>
                <strong
                  className="pq-kpi-mini-val"
                  style={{
                    ...tabularNumStyle,
                    color: isPendingCost
                      ? 'var(--muted-color)'
                      : 'var(--success-text)',
                  }}
                >
                  {isPendingCost
                    ? 'Chưa tính'
                    : `+${formatVnd(quote.total_profit)}`}
                </strong>
              </div>
              <div className="pq-kpi-mini-card">
                <div className="pq-kpi-mini-label">Phí giao hàng</div>
                <strong className="pq-kpi-mini-val" style={tabularNumStyle}>
                  {formatVnd(quote.shipping_fee)}
                </strong>
              </div>
            </div>

            {quote.lines_json && quote.lines_json.length > 0 && (
              <div style={{ overflowX: 'auto', marginTop: '14px' }}>
                <table className="pq-table">
                  <thead>
                    <tr>
                      <th>Sản phẩm</th>
                      <th style={{ textAlign: 'right' }}>Giá vốn</th>
                      <th style={{ textAlign: 'right' }}>Tiền lời</th>
                      <th style={{ textAlign: 'right' }}>Báo khách</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.lines_json.map((line) => {
                      const linePending =
                        line.isPendingCost === true || isPendingCost;
                      return (
                        <tr key={line.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {line.name}{' '}
                              <span
                                style={{
                                  color: 'var(--muted-color)',
                                  fontWeight: 500,
                                }}
                              >
                                ({formatNumberVn(line.quantity)}{' '}
                                {line.unit || 'tờ'}
                                {line.areaSpec
                                  ? ` • ${formatAreaSqmVn(line.areaSpec.billableAreaSqm)} m²`
                                  : ''}
                                )
                              </span>
                            </div>
                            {line.specification && (
                              <div
                                style={{
                                  fontSize: '12px',
                                  color: 'var(--muted-color)',
                                  marginTop: '2px',
                                }}
                              >
                                {line.specification}
                              </div>
                            )}
                            {(line.vendorPriceItemCode ||
                              line.baseCostSource === 'CATALOG_OVERRIDDEN' ||
                              line.profitMode === 'PERCENTAGE') && (
                              <div
                                style={{
                                  fontSize: '12px',
                                  color: 'var(--muted-color)',
                                  marginTop: '3px',
                                }}
                              >
                                {line.vendorPriceItemCode && (
                                  <span>
                                    Nguồn giá: {line.vendorPriceItemCode}
                                    {line.vendorPriceItemVersion
                                      ? ` (v${line.vendorPriceItemVersion})`
                                      : ''}
                                  </span>
                                )}
                                {line.baseCostSource ===
                                  'CATALOG_OVERRIDDEN' && (
                                  <span>
                                    {line.vendorPriceItemCode ? ' • ' : ''}
                                    Giá sửa riêng trên báo giá
                                    {typeof line.catalogOriginalRate ===
                                    'number'
                                      ? ` (gốc: ${formatVnd(line.catalogOriginalRate)})`
                                      : ''}
                                  </span>
                                )}
                                {line.profitMode === 'PERCENTAGE' && (
                                  <span>
                                    {line.vendorPriceItemCode ||
                                    line.baseCostSource === 'CATALOG_OVERRIDDEN'
                                      ? ' • '
                                      : ''}
                                    Lời {line.profitInputValue}% trên tổng vốn
                                    SP (In + Gia công)
                                  </span>
                                )}
                              </div>
                            )}
                            {line.areaSpec &&
                              line.areaSpec.adjustmentReason && (
                                <div
                                  style={{
                                    fontSize: '12px',
                                    color: 'var(--muted-color)',
                                    marginTop: '3px',
                                  }}
                                >
                                  Điều chỉnh m² (
                                  {formatAreaSqmVn(line.areaSpec.actualAreaSqm)}{' '}
                                  →{' '}
                                  {formatAreaSqmVn(
                                    line.areaSpec.billableAreaSqm,
                                  )}{' '}
                                  m²): {line.areaSpec.adjustmentReason}
                                </div>
                              )}
                            {line.finishingStages &&
                              line.finishingStages.length > 0 && (
                                <div
                                  style={{
                                    fontSize: '12px',
                                    color: 'var(--muted-color)',
                                    marginTop: '3px',
                                  }}
                                >
                                  Gia công:{' '}
                                  {line.finishingStages
                                    .map((s) =>
                                      s.rate === null
                                        ? `${s.name} (Chờ giá)`
                                        : `${s.name}${s.code ? ` [${s.code}${s.priceItemVersion ? ` v${s.priceItemVersion}` : ''}]` : ''} (${formatVnd('vendorCost' in s ? s.vendorCost : s.rate)}${s.costSource === 'CATALOG_OVERRIDDEN' && typeof s.catalogOriginalRate === 'number' ? ` — gốc ${formatVnd(s.catalogOriginalRate)}` : ''})`,
                                    )
                                    .join(' • ')}
                                </div>
                              )}
                          </td>
                          <td
                            style={{ textAlign: 'right', ...tabularNumStyle }}
                          >
                            {line.isPendingCost
                              ? 'Chờ giá'
                              : formatVnd(line.totalVendorCost)}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              color: linePending
                                ? 'var(--muted-color)'
                                : 'var(--success-text)',
                              fontWeight: 600,
                              ...tabularNumStyle,
                            }}
                          >
                            {linePending
                              ? '—'
                              : `+${formatVnd(line.totalProfit)}`}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              fontWeight: 700,
                              color: linePending
                                ? 'var(--muted-color)'
                                : 'var(--accent-text)',
                              ...tabularNumStyle,
                            }}
                          >
                            {linePending
                              ? 'Chờ giá'
                              : formatVnd(line.reconciledLineTotal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Immutable Version History */}
          <div style={cardStyle}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                marginBottom: '12px',
              }}
            >
              <PqHistoryIcon
                size={16}
                style={{ color: 'var(--muted-color)' }}
              />
              <h2 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700 }}>
                Lịch sử phiên bản bất biến (
                {quote.versions?.length || quote.current_version})
              </h2>
            </div>

            {quote.versions && quote.versions.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {quote.versions.map((ver) => {
                  const verPending =
                    ver.pricing_status === 'PENDING_COST' ||
                    ver.customer_pdf_json === null;
                  return (
                    <div key={ver.id} className="pq-version-card">
                      <div>
                        <strong>v{ver.version_number}</strong> —{' '}
                        {ver.change_note || 'Lưu phiên bản'}{' '}
                        <span style={{ color: 'var(--muted-color)' }}>
                          ({formatDateVn(ver.created_at)})
                        </span>
                      </div>
                      <div style={{ ...tabularNumStyle, fontSize: '12px' }}>
                        {verPending ? (
                          <strong>Nháp chờ giá xưởng</strong>
                        ) : (
                          <>
                            Vốn: {formatVnd(ver.total_vendor_cost)} • Lời:{' '}
                            <span style={{ color: 'var(--success-text)' }}>
                              +{formatVnd(ver.total_profit)}
                            </span>{' '}
                            • Tổng:{' '}
                            <strong style={{ color: 'var(--accent-text)' }}>
                              {formatVnd(ver.total_quote_amount)}
                            </strong>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '12.5px', color: 'var(--muted-color)' }}>
                Phiên bản hiện tại: v{quote.current_version}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Draft Confirmation Modal */}
      <CatalogModalDialog
        open={confirmDeleteOpen}
        title="Xóa bản nháp báo giá?"
        subtitle={`Xóa vĩnh viễn bản nháp ${quote.quote_code}? Báo giá đã chốt hoặc chuyển đơn sẽ không bao giờ bị ảnh hưởng.`}
        testId="pq-detail-delete-draft-dialog"
        maxWidth="440px"
        onClose={() => setConfirmDeleteOpen(false)}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            marginTop: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(false)}
            className="pq-btn pq-btn-secondary"
          >
            Hủy
          </button>
          <button
            type="button"
            data-testid="pq-detail-confirm-delete-draft-btn"
            onClick={async () => {
              setConfirmDeleteOpen(false);
              if (onDeleteDraftQuote) {
                await onDeleteDraftQuote(quote);
              }
            }}
            className="pq-btn pq-btn-danger-ghost"
          >
            Xác nhận xóa nháp
          </button>
        </div>
      </CatalogModalDialog>
    </div>
  );
};
