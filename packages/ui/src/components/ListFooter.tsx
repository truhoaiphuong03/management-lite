import React from 'react';
import { AppButton } from './AppButton.js';

export interface ListFooterProps {
  /** Number of items currently rendered in the list */
  itemCount: number;

  /** Total count of items if returned by server (exact count known) */
  totalCount?: number | undefined;

  /** Current page index (1-indexed) for page-replacement pagination */
  currentPage?: number | undefined;

  /** Items per page for page-replacement pagination */
  pageSize?: number | undefined;

  /** Whether a previous page exists */
  hasPrevPage?: boolean | undefined;

  /** Whether a next page or more items exist */
  hasNextPage?: boolean | undefined;

  /** Handler for navigating to previous page */
  onPrevPage?: (() => void) | undefined;

  /** Handler for navigating to next page */
  onNextPage?: (() => void) | undefined;

  /** Handler for loading more items (cursor append) */
  onLoadMore?: (() => void) | undefined;

  /** Loading state for append action */
  isLoadingMore?: boolean | undefined;

  /** General loading state */
  loading?: boolean | undefined;

  /** Inline error message if pagination or load-more failed */
  error?: string | null | undefined;

  /** Retry handler */
  onRetry?: (() => void) | undefined;

  /** Custom label for load-more button, default "Tải thêm" */
  loadMoreLabel?: string | undefined;

  /** Optional data-testid attributes for testing compatibility */
  testId?: string | undefined;
  prevTestId?: string | undefined;
  nextTestId?: string | undefined;
  infoTestId?: string | undefined;
  loadMoreTestId?: string | undefined;
  /** Optional title / tooltip for next page button */
  nextTitle?: string | undefined;
}

export const ListFooter: React.FC<ListFooterProps> = ({
  itemCount,
  totalCount,
  currentPage = 1,
  pageSize = 10,
  hasPrevPage = false,
  hasNextPage = false,
  onPrevPage,
  onNextPage,
  onLoadMore,
  isLoadingMore = false,
  loading = false,
  error = null,
  onRetry,
  loadMoreLabel = 'Tải thêm',
  testId,
  prevTestId,
  nextTestId,
  infoTestId,
  loadMoreTestId = 'btn-load-more',
  nextTitle,
}) => {
  // Empty state handling: Never show negative or inverted ranges like "1-0 / 0"
  const isEmpty =
    itemCount === 0 && (totalCount === undefined || totalCount === 0);

  // Exact total known: "1–10 / 2.653"
  const hasExactTotal = typeof totalCount === 'number' && totalCount > 0;
  let counterText = '';

  if (isEmpty) {
    counterText = '0 mục';
  } else if (hasExactTotal) {
    const start = Math.min((currentPage - 1) * pageSize + 1, totalCount);
    const end = Math.min((currentPage - 1) * pageSize + itemCount, totalCount);
    const formattedTotal = totalCount.toLocaleString('vi-VN');
    counterText = `${start}–${end} / ${formattedTotal}`;
  } else {
    counterText = `Đang hiển thị ${itemCount} mục`;
  }

  return (
    <footer
      data-testid={testId}
      aria-label="Điều hướng danh sách"
      style={{
        marginTop: '16px',
        marginBottom: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
      {/* Inline Error with Retry (if any) */}
      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '10px 14px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            color: 'var(--danger-text)',
            fontSize: '13px',
          }}
        >
          <span>{error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-text)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: '4px 8px',
                minHeight: '44px',
                minWidth: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              Thử lại
            </button>
          )}
        </div>
      )}

      {/* Main presentation bar */}
      <div
        className="list-footer-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '8px 4px',
        }}
      >
        {/* Count display: "1–10 / 2.653" or "Đang hiển thị N mục" or "0 mục" */}
        <span
          data-testid={infoTestId}
          className="list-footer-info"
          style={{
            fontSize: '13px',
            color: 'var(--muted-color)',
            fontWeight: 500,
            userSelect: 'none',
          }}
        >
          {counterText}
        </span>

        {/* Controls */}
        <div
          className="list-footer-controls"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {/* Case 1: Page-replacement (Trước / Sau) */}
          {(onPrevPage || onNextPage) && (
            <>
              <button
                type="button"
                data-testid={prevTestId}
                onClick={onPrevPage}
                disabled={!hasPrevPage || loading}
                aria-label="Trang trước"
                style={{
                  boxSizing: 'border-box',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  minHeight: '44px',
                  minWidth: '44px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-hover)',
                  color: !hasPrevPage || loading ? 'var(--muted-color)' : 'var(--text-color)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: !hasPrevPage || loading ? 'not-allowed' : 'pointer',
                  opacity: !hasPrevPage || loading ? 0.6 : 1,
                  transition:
                    'background-color 0.15s ease, border-color 0.15s ease',
                }}
              >
                ‹ Trước
              </button>

              <button
                type="button"
                data-testid={nextTestId}
                onClick={onNextPage}
                disabled={!hasNextPage || loading}
                title={nextTitle}
                aria-label={nextTitle || 'Trang sau'}
                style={{
                  boxSizing: 'border-box',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  minHeight: '44px',
                  minWidth: '44px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-hover)',
                  color: !hasNextPage || loading ? 'var(--muted-color)' : 'var(--text-color)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: !hasNextPage || loading ? 'not-allowed' : 'pointer',
                  opacity: !hasNextPage || loading ? 0.6 : 1,
                  transition:
                    'background-color 0.15s ease, border-color 0.15s ease',
                }}
              >
                Sau ›
              </button>
            </>
          )}

          {/* Case 2: Cursor append (Single Tải thêm button) */}
          {onLoadMore && hasNextPage && (
            <AppButton
              variant="secondary"
              onClick={onLoadMore}
              disabled={isLoadingMore || loading}
              isLoading={isLoadingMore}
              data-testid={loadMoreTestId}
              style={{
                minHeight: '44px',
                minWidth: '140px',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              {isLoadingMore ? 'Đang tải thêm...' : loadMoreLabel}
            </AppButton>
          )}
        </div>
      </div>

      {/* Shared responsive style: Q65-04 mobile safe clearance away from fixed bottom-right floating widgets */}
      <style>{`
        @media (max-width: 768px) {
          .list-footer-bar {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 10px !important;
          }
          .list-footer-controls {
            width: 100% !important;
            justify-content: flex-start !important;
            max-width: calc(100% - 110px) !important;
          }
        }
      `}</style>
    </footer>
  );
};
