import React, { useState, useMemo } from 'react';
import { StatusBadge } from '../../../../../packages/ui/src/components/index.js';
import type { PrintQuoteData } from '../../../../../packages/contracts/src/printquote.js';
import {
  formatVnd,
  formatDateVn,
  QUOTE_STATUS_LABELS,
} from '../helpers/printquote-helpers.js';
import {
  cardStyle,
  inputStyle,
  isQuoteStatusEditable,
  tabularNumStyle,
} from './types.js';
import {
  PqCheckIcon,
  PqCopyIcon,
  PqDownloadIcon,
  PqEditIcon,
  PqEyeIcon,
  PqFileTextIcon,
  PqHistoryIcon,
  PqLockIcon,
  PqPackageIcon,
  PqPlusIcon,
  PqSearchIcon,
} from './PrintQuoteIcons.js';

export interface QuotesListTabProps {
  quotes: PrintQuoteData[];
  expandedQuoteHistoryId: string | null;
  setExpandedQuoteHistoryId: (id: string | null) => void;
  onStartNewQuote: () => void;
  onOpenQuoteDetail: (q: PrintQuoteData) => void;
  onDownloadSavedQuotePdfFile: (quoteId: string, quoteCode: string) => void;
  onOpenSavedQuotePdf: (q: PrintQuoteData) => void;
  onLoadQuoteForEdit: (q: PrintQuoteData) => void;
  onCloneQuoteAsNew: (q: PrintQuoteData) => void;
  onFinalizeQuote: (quoteId: string) => void;
  onConvertQuoteToOrder: (q: PrintQuoteData) => void;
}

export const QuotesListTab: React.FC<QuotesListTabProps> = ({
  quotes,
  expandedQuoteHistoryId,
  setExpandedQuoteHistoryId,
  onStartNewQuote,
  onOpenQuoteDetail,
  onDownloadSavedQuotePdfFile,
  onOpenSavedQuotePdf,
  onLoadQuoteForEdit,
  onCloneQuoteAsNew,
  onFinalizeQuote,
  onConvertQuoteToOrder,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'DRAFT' | 'FINALIZED' | 'CONVERTED'
  >('ALL');

  const filteredQuotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return quotes.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.quote_code.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        (item.customer_name || '').toLowerCase().includes(q) ||
        (item.customer_phone || '').toLowerCase().includes(q)
      );
    });
  }, [quotes, searchQuery, statusFilter]);

  const filterTabs: Array<{
    id: 'ALL' | 'DRAFT' | 'FINALIZED' | 'CONVERTED';
    label: string;
    count: number;
  }> = [
    { id: 'ALL', label: 'Tất cả', count: quotes.length },
    {
      id: 'DRAFT',
      label: 'Nháp',
      count: quotes.filter((q) => q.status === 'DRAFT').length,
    },
    {
      id: 'FINALIZED',
      label: 'Đã chốt',
      count: quotes.filter((q) => q.status === 'FINALIZED').length,
    },
    {
      id: 'CONVERTED',
      label: 'Đã chuyển đơn',
      count: quotes.filter((q) => q.status === 'CONVERTED').length,
    },
  ];

  return (
    <div
      data-testid="panel-quotes-list"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      {/* Clean Page Header + Primary CTA */}
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">Báo giá in ấn</h1>
          <p className="pq-page-subtitle">
            Quản lý báo giá, xuất PDF A4 ẩn giá gốc nhà in và chuyển đơn đặt in
          </p>
        </div>

        <button
          type="button"
          data-testid="pq-new-quote-cta"
          onClick={onStartNewQuote}
          className="pq-btn pq-btn-primary pq-btn-cta"
        >
          <span>+ Tạo báo giá mới</span>
        </button>
      </div>

      {/* Unified Search & Segmented Status Filter Bar */}
      <div className="pq-toolbar-card">
        <div className="pq-search-wrap">
          <PqSearchIcon size={15} className="pq-search-icon" />
          <input
            id="pq-quotes-search-input"
            type="search"
            aria-label="Tìm kiếm báo giá"
            style={{
              ...inputStyle,
              paddingLeft: '36px',
              minHeight: '40px',
            }}
            placeholder="Tìm mã BG, tiêu đề, tên khách hoặc SĐT…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div
          className="pq-filter-pills"
          role="group"
          aria-label="Lọc trạng thái báo giá"
        >
          {filterTabs.map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                className="pq-filter-pill"
                data-active={active ? 'true' : 'false'}
                onClick={() => setStatusFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="pq-filter-pill-count">{tab.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filteredQuotes.length === 0 ? (
        <div
          style={{
            ...cardStyle,
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          {quotes.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                maxWidth: '420px',
                margin: '0 auto',
              }}
            >
              <div className="pq-empty-icon-ring">
                <PqFileTextIcon size={24} />
              </div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>
                Chưa có báo giá nào được lưu
              </div>
              <div
                style={{
                  color: 'var(--muted-color)',
                  fontSize: '13px',
                  lineHeight: 1.5,
                }}
              >
                Bấm <strong>+ Tạo báo giá mới</strong> để tính giá vốn, lợi
                nhuận và xuất báo giá PDF A4 chuyên nghiệp gửi khách hàng.
              </div>
              <button
                type="button"
                onClick={onStartNewQuote}
                className="pq-btn pq-btn-primary"
                style={{ marginTop: '4px' }}
              >
                <PqPlusIcon size={15} />
                <span>Tạo báo giá đầu tiên</span>
              </button>
            </div>
          ) : (
            <div style={{ color: 'var(--muted-color)', fontSize: '13.5px' }}>
              Không tìm thấy báo giá phù hợp với từ khóa hoặc bộ lọc đang chọn.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredQuotes.map((q) => {
            const isHistoryOpen = expandedQuoteHistoryId === q.id;
            const editable = isQuoteStatusEditable(q.status);
            return (
              <article
                key={q.id}
                data-testid={`quote-row-${q.quote_code}`}
                className="pq-quote-card"
              >
                <div className="pq-quote-card-top">
                  <div style={{ minWidth: 0, flex: '1 1 280px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenQuoteDetail(q)}
                        className="pq-code-link"
                      >
                        {q.quote_code}
                      </button>
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
                      <span className="pq-version-pill">
                        v{q.current_version}
                      </span>
                    </div>

                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: '15px',
                        marginTop: '6px',
                        color: 'var(--text-color)',
                        lineHeight: 1.35,
                      }}
                    >
                      {q.title}
                    </div>

                    <div
                      style={{
                        fontSize: '12.5px',
                        color: 'var(--muted-color)',
                        marginTop: '4px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px',
                        alignItems: 'center',
                      }}
                    >
                      <span>
                        Khách hàng:{' '}
                        <strong style={{ color: 'var(--text-color)' }}>
                          {q.customer_name || 'Khách lẻ'}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>Ngày lập: {formatDateVn(q.created_at)}</span>
                      {q.valid_until && (
                        <>
                          <span>•</span>
                          <span>Hiệu lực: {formatDateVn(q.valid_until)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Financial KPI Strip */}
                  <div className="pq-quote-metrics">
                    <div className="pq-metric-cell">
                      <span className="pq-metric-label">Giá vốn</span>
                      <strong className="pq-metric-val" style={tabularNumStyle}>
                        {formatVnd(q.total_vendor_cost)}
                      </strong>
                    </div>
                    <div className="pq-metric-cell">
                      <span className="pq-metric-label">Lợi nhuận</span>
                      <strong
                        className="pq-metric-val"
                        style={{
                          ...tabularNumStyle,
                          color: 'var(--success-text)',
                        }}
                      >
                        +{formatVnd(q.total_profit)}
                      </strong>
                    </div>
                    <div className="pq-metric-cell">
                      <span className="pq-metric-label">Giao hàng</span>
                      <strong className="pq-metric-val" style={tabularNumStyle}>
                        {formatVnd(q.shipping_fee)}
                      </strong>
                    </div>
                    <div className="pq-metric-cell pq-metric-cell-total">
                      <span className="pq-metric-label">Tổng báo khách</span>
                      <strong
                        className="pq-metric-total-val"
                        style={tabularNumStyle}
                      >
                        {formatVnd(q.total_quote_amount)}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Structured Action Footer */}
                <div className="pq-quote-card-actions">
                  <div className="pq-action-group-left">
                    <button
                      type="button"
                      data-testid={`pq-quote-open-detail-${q.quote_code}`}
                      onClick={() => onOpenQuoteDetail(q)}
                      className="pq-btn pq-btn-secondary"
                    >
                      <PqFileTextIcon size={14} />
                      <span>Chi tiết</span>
                    </button>

                    <button
                      type="button"
                      data-testid={`pq-quote-download-pdf-${q.quote_code}`}
                      onClick={() =>
                        onDownloadSavedQuotePdfFile(q.id, q.quote_code)
                      }
                      className="pq-btn pq-btn-accent"
                    >
                      <PqDownloadIcon size={14} />
                      <span>Tải PDF</span>
                    </button>

                    <button
                      type="button"
                      data-testid={`pq-quote-preview-pdf-${q.quote_code}`}
                      onClick={() => onOpenSavedQuotePdf(q)}
                      className="pq-btn pq-btn-ghost"
                    >
                      <PqEyeIcon size={14} />
                      <span>Xem A4</span>
                    </button>

                    {editable ? (
                      <button
                        type="button"
                        data-testid={`pq-quote-edit-${q.quote_code}`}
                        onClick={() => onLoadQuoteForEdit(q)}
                        className="pq-btn pq-btn-secondary"
                      >
                        <PqEditIcon size={14} />
                        <span>
                          Sửa / Tạo phiên bản (v{q.current_version + 1})
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid={`pq-quote-clone-${q.quote_code}`}
                        onClick={() => onCloneQuoteAsNew(q)}
                        className="pq-btn pq-btn-secondary"
                      >
                        <PqCopyIcon size={14} />
                        <span>Tạo bản mới</span>
                      </button>
                    )}

                    {q.status === 'DRAFT' && (
                      <button
                        type="button"
                        onClick={() => onFinalizeQuote(q.id)}
                        className="pq-btn pq-btn-ghost"
                      >
                        <PqLockIcon size={14} />
                        <span>Chốt</span>
                      </button>
                    )}

                    <button
                      type="button"
                      aria-expanded={isHistoryOpen}
                      onClick={() =>
                        setExpandedQuoteHistoryId(isHistoryOpen ? null : q.id)
                      }
                      className="pq-btn pq-btn-ghost"
                    >
                      <PqHistoryIcon size={14} />
                      <span>
                        Lịch sử ({q.versions?.length || q.current_version})
                      </span>
                    </button>
                  </div>

                  <div className="pq-action-group-right">
                    {q.status !== 'CONVERTED' && q.status !== 'CANCELLED' ? (
                      <button
                        type="button"
                        data-testid={`pq-convert-order-btn-${q.quote_code}`}
                        onClick={() => onConvertQuoteToOrder(q)}
                        className="pq-btn pq-btn-primary"
                      >
                        <PqPackageIcon size={14} />
                        <span>Chuyển thành Đơn đặt in</span>
                      </button>
                    ) : q.status === 'CONVERTED' ? (
                      <span
                        data-testid={`pq-quote-converted-badge-${q.quote_code}`}
                        className="pq-converted-pill"
                      >
                        <PqCheckIcon size={14} />
                        <span>Đã chuyển đơn in</span>
                      </span>
                    ) : null}
                  </div>
                </div>

                {isHistoryOpen && q.versions && q.versions.length > 0 && (
                  <div className="pq-version-drawer">
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: '12px',
                        color: 'var(--muted-color)',
                        marginBottom: '6px',
                      }}
                    >
                      Nhật ký phiên bản bất biến
                    </div>
                    {q.versions.map((ver) => (
                      <div key={ver.id} className="pq-version-row">
                        <span>
                          <strong>v{ver.version_number}</strong> —{' '}
                          {ver.change_note || 'Lưu phiên bản'} (
                          {formatDateVn(ver.created_at)})
                        </span>
                        <span style={tabularNumStyle}>
                          Vốn: {formatVnd(ver.total_vendor_cost)} • Lời:{' '}
                          <span style={{ color: 'var(--success-text)' }}>
                            +{formatVnd(ver.total_profit)}
                          </span>{' '}
                          • Tổng:{' '}
                          <strong style={{ color: 'var(--accent-text)' }}>
                            {formatVnd(ver.total_quote_amount)}
                          </strong>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
