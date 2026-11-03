import React, { useMemo } from 'react';
import { StatusBadge } from '../../../../../packages/ui/src/components/index.js';
import type {
  PrintCustomerData,
  PrintQuoteData,
} from '../../../../../packages/contracts/src/printquote.js';
import {
  buildPrintQuoteA4Html,
  formatDateVn,
  formatNumberVn,
  formatVnd,
  QUOTE_STATUS_LABELS,
} from '../helpers/printquote-helpers.js';
import { cardStyle, isQuoteStatusEditable } from './types.js';

export interface QuoteDetailViewProps {
  quote: PrintQuoteData | null;
  loading: boolean;
  workspaceName: string;
  customers: PrintCustomerData[];
  onBackToList: () => void;
  onDownloadSavedPdf: (quoteId: string, quoteCode: string) => void;
  onOpenFullPreview: (quote: PrintQuoteData) => void;
  onPrintWindow: (html: string) => void;
  onEditQuote: (quote: PrintQuoteData) => void;
  onCloneQuoteAsNew: (quote: PrintQuoteData) => void;
  onFinalizeQuote: (quoteId: string) => void;
  onConvertQuoteToOrder: (quote: PrintQuoteData) => void;
}

export const QuoteDetailView: React.FC<QuoteDetailViewProps> = ({
  quote,
  loading,
  workspaceName,
  customers,
  onBackToList,
  onDownloadSavedPdf,
  onOpenFullPreview,
  onPrintWindow,
  onEditQuote,
  onCloneQuoteAsNew,
  onFinalizeQuote,
  onConvertQuoteToOrder,
}) => {
  const customer = useMemo(
    () =>
      quote ? customers.find((c) => c.id === quote.customer_id) || null : null,
    [customers, quote],
  );

  const a4Html = useMemo(() => {
    if (!quote) return '';
    return buildPrintQuoteA4Html(quote.customer_pdf_json, {
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
    });
  }, [quote, customer, workspaceName]);

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
        <h2 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 700 }}>
          Không tìm thấy báo giá
        </h2>
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
          style={{
            minHeight: '44px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-color)',
            color: 'var(--text-color)',
            fontWeight: 700,
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          ← Quay lại Danh sách báo giá
        </button>
      </div>
    );
  }

  const canEditInPlace = isQuoteStatusEditable(quote.status);

  return (
    <div
      data-testid="panel-quote-detail"
      style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
    >
      {/* Top Contextual Bar & Actions */}
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '10px',
            marginBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div>
              <button
                type="button"
                data-testid="pq-detail-back-btn"
                onClick={onBackToList}
                style={{
                  minHeight: '44px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-color)',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ← Danh sách báo giá
              </button>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                marginTop: '4px',
              }}
            >
              <strong style={{ fontSize: '17px', color: 'var(--accent-text)' }}>
                {quote.quote_code}
              </strong>
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
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                {quote.title}
              </h2>
            </div>
            <div style={{ fontSize: '12.5px', color: 'var(--muted-color)' }}>
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

          <div
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              backgroundColor: 'var(--accent-soft)',
              border: '1px solid var(--accent-text)',
              textAlign: 'right',
            }}
          >
            <div style={{ fontSize: '12px', color: 'var(--accent-text)' }}>
              Tổng báo khách
            </div>
            <div
              data-testid="pq-detail-total-quote"
              style={{
                fontSize: '18px',
                fontWeight: 800,
                color: 'var(--accent-text)',
              }}
            >
              {formatVnd(quote.total_quote_amount)}
            </div>
          </div>
        </div>

        {/* Action Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <button
            type="button"
            data-testid="pq-detail-download-pdf-btn"
            onClick={() => onDownloadSavedPdf(quote.id, quote.quote_code)}
            style={{
              minHeight: '44px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'var(--primary-color)',
              color: 'var(--inverse-text)',
              fontWeight: 800,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            ⬇️ Tải PDF ({quote.quote_code}.pdf)
          </button>

          <button
            type="button"
            data-testid="pq-detail-print-btn"
            onClick={() => onPrintWindow(a4Html)}
            style={{
              minHeight: '44px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid var(--accent-text)',
              backgroundColor: 'var(--accent-soft)',
              color: 'var(--accent-text)',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            🖨️ Mở cửa sổ In A4
          </button>

          <button
            type="button"
            data-testid="pq-detail-preview-modal-btn"
            onClick={() => onOpenFullPreview(quote)}
            style={{
              minHeight: '44px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-color)',
              color: 'var(--text-color)',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            👁️ Xem rộng PDF A4
          </button>

          {canEditInPlace ? (
            <button
              type="button"
              data-testid="pq-detail-edit-btn"
              onClick={() => onEditQuote(quote)}
              style={{
                minHeight: '44px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-color)',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              ✏️ Sửa báo giá (Tạo v{quote.current_version + 1})
            </button>
          ) : (
            <button
              type="button"
              data-testid="pq-detail-clone-btn"
              onClick={() => onCloneQuoteAsNew(quote)}
              style={{
                minHeight: '44px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid var(--accent-text)',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--accent-text)',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              📋 Tạo báo giá mới từ bản này
            </button>
          )}

          {quote.status === 'DRAFT' && (
            <button
              type="button"
              data-testid="pq-detail-finalize-btn"
              onClick={() => onFinalizeQuote(quote.id)}
              style={{
                minHeight: '44px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-color)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              🔒 Chốt báo giá
            </button>
          )}

          {quote.status !== 'CONVERTED' && quote.status !== 'CANCELLED' ? (
            <button
              type="button"
              data-testid="pq-detail-convert-btn"
              onClick={() => onConvertQuoteToOrder(quote)}
              style={{
                minHeight: '44px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--success-color)',
                color: 'var(--inverse-text)',
                fontWeight: 800,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              📦 Chuyển thành Đơn đặt in
            </button>
          ) : quote.status === 'CONVERTED' ? (
            <span
              data-testid="pq-detail-converted-badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: '44px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--success-text)',
                fontWeight: 700,
                fontSize: '12.5px',
              }}
            >
              ✓ Đã chuyển sang Đơn đặt in
            </span>
          ) : null}
        </div>
      </div>

      {/* Main Responsive Split: Customer-Safe A4 Preview + Owner Internal Breakdown */}
      <div
        className="pq-detail-split-grid"
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
          gap: '14px',
          alignItems: 'start',
        }}
      >
        {/* Customer-Safe A4 Preview */}
        <div style={cardStyle} data-testid="pq-detail-a4-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              marginBottom: '10px',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                📄 Bản xem trước PDF A4 gửi khách
              </h3>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Ẩn tuyệt đối 100% giá gốc nhà in và lợi nhuận nội bộ
              </div>
            </div>
            <StatusBadge status="success" label="An toàn gửi khách" />
          </div>

          <iframe
            title={`Bản xem trước A4 ${quote.quote_code}`}
            srcDoc={a4Html}
            style={{
              width: '100%',
              height: '580px',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              backgroundColor: '#FFFFFF',
            }}
          />
        </div>

        {/* Owner Internal Breakdown & Version History */}
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
          data-testid="pq-detail-internal-card"
        >
          <div style={cardStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '12px',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                🔒 Bóc tách nội bộ (Chỉ Chủ sở hữu thấy)
              </h3>
              <StatusBadge status="neutral" label="Nội bộ Owner" />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 135px), 1fr))',
                gap: '8px',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Giá vốn nhà in
                </div>
                <strong style={{ fontSize: '14.5px' }}>
                  {formatVnd(quote.total_vendor_cost)}
                </strong>
              </div>
              <div
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Lợi nhuận dự kiến
                </div>
                <strong
                  style={{ fontSize: '14.5px', color: 'var(--success-text)' }}
                >
                  +{formatVnd(quote.total_profit)}
                </strong>
              </div>
              <div
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Phí giao hàng (1 lần)
                </div>
                <strong style={{ fontSize: '14.5px' }}>
                  {formatVnd(quote.shipping_fee)}
                </strong>
              </div>
            </div>

            {quote.lines_json && quote.lines_json.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '12.5px',
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        color: 'var(--muted-color)',
                        textAlign: 'left',
                      }}
                    >
                      <th style={{ padding: '6px' }}>Sản phẩm</th>
                      <th style={{ padding: '6px', textAlign: 'right' }}>
                        Giá vốn
                      </th>
                      <th style={{ padding: '6px', textAlign: 'right' }}>
                        Lời
                      </th>
                      <th style={{ padding: '6px', textAlign: 'right' }}>
                        Thành tiền khách
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.lines_json.map((line) => (
                      <tr
                        key={line.id}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                        }}
                      >
                        <td style={{ padding: '6px', fontWeight: 600 }}>
                          <div>
                            {line.name} ({formatNumberVn(line.quantity)}{' '}
                            {line.unit || 'tờ'})
                          </div>
                          {line.specification && (
                            <div
                              style={{
                                fontSize: '12px',
                                color: 'var(--muted-color)',
                                fontWeight: 400,
                              }}
                            >
                              {line.specification}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '6px', textAlign: 'right' }}>
                          {formatVnd(line.totalVendorCost)}
                        </td>
                        <td
                          style={{
                            padding: '6px',
                            textAlign: 'right',
                            color: 'var(--success-text)',
                            fontWeight: 600,
                          }}
                        >
                          +{formatVnd(line.totalProfit)}
                        </td>
                        <td
                          style={{
                            padding: '6px',
                            textAlign: 'right',
                            fontWeight: 700,
                            color: 'var(--accent-text)',
                          }}
                        >
                          {formatVnd(line.reconciledLineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Version History */}
          <div style={cardStyle}>
            <h3
              style={{
                margin: '0 0 10px',
                fontSize: '14.5px',
                fontWeight: 700,
              }}
            >
              📜 Lịch sử phiên bản bất biến (
              {quote.versions?.length || quote.current_version})
            </h3>
            {quote.versions && quote.versions.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontSize: '12.5px',
                }}
              >
                {quote.versions.map((ver) => (
                  <div
                    key={ver.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <span>
                      <strong>v{ver.version_number}</strong> —{' '}
                      {ver.change_note || 'Lưu phiên bản'} (
                      {formatDateVn(ver.created_at)})
                    </span>
                    <span>
                      Vốn: {formatVnd(ver.total_vendor_cost)} | Lời: +
                      {formatVnd(ver.total_profit)} | Tổng:{' '}
                      <strong>{formatVnd(ver.total_quote_amount)}</strong>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '12.5px', color: 'var(--muted-color)' }}>
                Phiên bản hiện tại: v{quote.current_version}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
