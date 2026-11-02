import React, { useState, useMemo } from 'react';
import { StatusBadge } from '../../../../../packages/ui/src/components/index.js';
import type { PrintQuoteData } from '../../../../../packages/contracts/src/printquote.js';
import {
  formatVnd,
  formatDateVn,
  QUOTE_STATUS_LABELS,
} from '../helpers/printquote-helpers.js';
import { cardStyle, inputStyle } from './types.js';

export interface QuotesListTabProps {
  quotes: PrintQuoteData[];
  expandedQuoteHistoryId: string | null;
  setExpandedQuoteHistoryId: (id: string | null) => void;
  onStartNewQuote: () => void;
  onDownloadSavedQuotePdfFile: (quoteId: string, quoteCode: string) => void;
  onOpenSavedQuotePdf: (quote: PrintQuoteData) => void;
  onLoadQuoteForEdit: (quote: PrintQuoteData) => void;
  onFinalizeQuote: (quoteId: string) => void;
  onConvertQuoteToOrder: (quote: PrintQuoteData) => void;
}

export const QuotesListTab: React.FC<QuotesListTabProps> = ({
  quotes,
  expandedQuoteHistoryId,
  setExpandedQuoteHistoryId,
  onStartNewQuote,
  onDownloadSavedQuotePdfFile,
  onOpenSavedQuotePdf,
  onLoadQuoteForEdit,
  onFinalizeQuote,
  onConvertQuoteToOrder,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const filteredQuotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return quotes.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (!q) return true;
      return (
        item.quote_code.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        (item.customer_name || '').toLowerCase().includes(q) ||
        (item.customer_phone || '').toLowerCase().includes(q)
      );
    });
  }, [quotes, searchQuery, statusFilter]);

  const statusTabs: Array<{ id: string; label: string }> = [
    { id: 'ALL', label: `Tất cả (${quotes.length})` },
    {
      id: 'DRAFT',
      label: `Bản nháp (${quotes.filter((x) => x.status === 'DRAFT').length})`,
    },
    {
      id: 'FINALIZED',
      label: `Đã chốt (${quotes.filter((x) => x.status === 'FINALIZED').length})`,
    },
    {
      id: 'CONVERTED',
      label: `Đã lên đơn (${quotes.filter((x) => x.status === 'CONVERTED').length})`,
    },
  ];

  return (
    <div style={cardStyle} data-testid="panel-quotes-list">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
            Danh sách Báo giá & Lịch sử Phiên bản ({quotes.length})
          </h2>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            Tra cứu nhanh theo mã báo giá, tên khách hàng hoặc trạng thái chốt
            đơn
          </div>
        </div>
        <button
          type="button"
          onClick={onStartNewQuote}
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: 'var(--accent-text)',
            color: '#0F172A',
            fontWeight: 700,
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          + Tạo báo giá mới
        </button>
      </div>

      {/* Search & Quick Filter Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          alignItems: 'center',
          marginBottom: '14px',
        }}
      >
        <input
          type="search"
          aria-label="Tìm kiếm báo giá"
          style={{ ...inputStyle, flex: '1 1 220px', maxWidth: '340px' }}
          placeholder="Tìm mã BG, tên báo giá, tên hoặc SĐT khách…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div
          style={{
            display: 'flex',
            gap: '6px',
            flexWrap: 'wrap',
          }}
        >
          {statusTabs.map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                style={{
                  minHeight: '38px',
                  padding: '6px 12px',
                  borderRadius: '999px',
                  border: active
                    ? '1px solid var(--accent-text)'
                    : '1px solid var(--border-color)',
                  backgroundColor: active
                    ? 'var(--accent-soft)'
                    : 'var(--bg-color)',
                  color: active ? 'var(--accent-text)' : 'var(--muted-color)',
                  fontWeight: active ? 700 : 600,
                  fontSize: '12px',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {filteredQuotes.length === 0 ? (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            color: 'var(--muted-color)',
            fontSize: '13.5px',
          }}
        >
          {quotes.length === 0 ? (
            <>
              Chưa có báo giá nào. Hãy bấm <strong>1. Tạo báo giá</strong> để
              tính giá và xuất PDF A4 đầu tiên.
            </>
          ) : (
            'Không tìm thấy báo giá phù hợp với bộ lọc hiện tại.'
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredQuotes.map((q) => {
            const isHistoryOpen = expandedQuoteHistoryId === q.id;
            return (
              <div
                key={q.id}
                data-testid={`quote-row-${q.quote_code}`}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '14px',
                  backgroundColor: 'var(--bg-color)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <strong
                        style={{
                          fontSize: '14.5px',
                          color: 'var(--accent-text)',
                        }}
                      >
                        {q.quote_code}
                      </strong>
                      <StatusBadge
                        status="neutral"
                        label={`v${q.current_version}`}
                      />
                      <StatusBadge
                        status={
                          q.status === 'CONVERTED'
                            ? 'success'
                            : q.status === 'FINALIZED'
                              ? 'warning'
                              : 'muted'
                        }
                        label={QUOTE_STATUS_LABELS[q.status] || q.status}
                      />
                      <span style={{ fontWeight: 700, fontSize: '14px' }}>
                        {q.title}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '12.5px',
                        color: 'var(--muted-color)',
                        marginTop: '4px',
                      }}
                    >
                      Khách hàng:{' '}
                      <strong>{q.customer_name || 'Khách lẻ'}</strong> • Ngày
                      tạo: {formatDateVn(q.created_at)}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: '14px',
                      flexWrap: 'wrap',
                      fontSize: '12.5px',
                    }}
                  >
                    <div>
                      <div style={{ color: 'var(--muted-color)' }}>Giá vốn</div>
                      <strong>{formatVnd(q.total_vendor_cost)}</strong>
                    </div>
                    <div>
                      <div style={{ color: 'var(--muted-color)' }}>
                        Lợi nhuận
                      </div>
                      <strong style={{ color: 'var(--success-text)' }}>
                        +{formatVnd(q.total_profit)}
                      </strong>
                    </div>
                    <div>
                      <div style={{ color: 'var(--muted-color)' }}>
                        Ship (1 lần)
                      </div>
                      <strong>{formatVnd(q.shipping_fee)}</strong>
                    </div>
                    <div>
                      <div style={{ color: 'var(--muted-color)' }}>
                        Tổng báo khách
                      </div>
                      <strong
                        style={{
                          fontSize: '14px',
                          color: 'var(--accent-text)',
                        }}
                      >
                        {formatVnd(q.total_quote_amount)}
                      </strong>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginTop: '12px',
                    paddingTop: '10px',
                    borderTop: '1px solid var(--border-color)',
                  }}
                >
                  <button
                    type="button"
                    data-testid={`pq-quote-download-pdf-${q.quote_code}`}
                    onClick={() =>
                      onDownloadSavedQuotePdfFile(q.id, q.quote_code)
                    }
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--accent-text)',
                      backgroundColor: 'var(--accent-soft)',
                      color: 'var(--accent-text)',
                      fontWeight: 700,
                      fontSize: '12.5px',
                      cursor: 'pointer',
                    }}
                  >
                    ⬇️ Tải PDF ({q.quote_code}.pdf)
                  </button>

                  <button
                    type="button"
                    data-testid={`pq-quote-preview-pdf-${q.quote_code}`}
                    onClick={() => onOpenSavedQuotePdf(q)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--surface-color)',
                      color: 'var(--text-color)',
                      fontWeight: 600,
                      fontSize: '12.5px',
                      cursor: 'pointer',
                    }}
                  >
                    👁️ Xem PDF A4
                  </button>

                  {q.status === 'DRAFT' && (
                    <>
                      <button
                        type="button"
                        onClick={() => onLoadQuoteForEdit(q)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--surface-color)',
                          color: 'var(--text-color)',
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        ✏️ Sửa / Tạo phiên bản v{q.current_version + 1}
                      </button>
                      <button
                        type="button"
                        onClick={() => onFinalizeQuote(q.id)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--surface-color)',
                          color: 'var(--text-color)',
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        🔒 Chốt báo giá
                      </button>
                    </>
                  )}

                  {q.status !== 'CONVERTED' && q.status !== 'CANCELLED' ? (
                    <button
                      type="button"
                      data-testid={`pq-convert-order-btn-${q.quote_code}`}
                      onClick={() => onConvertQuoteToOrder(q)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: 'var(--accent-text)',
                        color: '#0F172A',
                        fontWeight: 700,
                        fontSize: '12.5px',
                        cursor: 'pointer',
                      }}
                    >
                      📦 Chuyển thành Đơn đặt in
                    </button>
                  ) : q.status === 'CONVERTED' ? (
                    <span
                      data-testid={`pq-quote-converted-badge-${q.quote_code}`}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--surface-color)',
                        color: 'var(--success-text)',
                        fontWeight: 700,
                        fontSize: '12px',
                      }}
                    >
                      ✓ Đã chuyển đơn in
                    </span>
                  ) : null}

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedQuoteHistoryId(isHistoryOpen ? null : q.id)
                    }
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'transparent',
                      color: 'var(--muted-color)',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    📜 Lịch sử phiên bản (
                    {q.versions?.length || q.current_version})
                  </button>
                </div>

                {isHistoryOpen && q.versions && q.versions.length > 0 && (
                  <div
                    style={{
                      marginTop: '10px',
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--surface-color)',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: '6px' }}>
                      Nhật ký các phiên bản báo giá (Lưu trữ bất biến):
                    </div>
                    {q.versions.map((ver) => (
                      <div
                        key={ver.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '8px',
                          padding: '6px 0',
                          borderBottom: '1px dashed var(--border-color)',
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
