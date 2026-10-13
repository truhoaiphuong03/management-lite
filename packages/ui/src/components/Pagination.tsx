import React from 'react';
import { TOKENS } from '../tokens.js';
import { AppButton } from './AppButton.js';

/** Management Lite pagination standard: default 20 rows/page, choices 10/20/50/100. */
export const PAGINATION_PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

/** Number of pages for `total` rows (always >= 1 so an empty list still shows "Trang 1 / 1"). */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}
/** Last valid 0-based page index; use to pull the user back after the current page became empty. */
export function clampPage(
  page: number,
  total: number,
  pageSize: number,
): number {
  return Math.min(Math.max(0, page), pageCount(total, pageSize) - 1);
}
/** 1-based inclusive row range shown on `page` (0-based); {from:0,to:0} when empty. */
export function pageRange(
  page: number,
  total: number,
  pageSize: number,
): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  return {
    from: page * pageSize + 1,
    to: Math.min(total, (page + 1) * pageSize),
  };
}

export interface PaginationProps {
  /** Total rows matching the current filters AND the caller's permissions (from the API). */
  total?: number;
  /** Cursor mode (no total from API): whether another page exists after this one. */
  hasNext?: boolean;
  /** Cursor mode: number of rows on the current page (for the "a–b" range). */
  itemCount?: number;
  /** 0-based page index. */
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  /** Provide to show the page-size selector. */
  onPageSize?: (size: number) => void;
  pageSizes?: readonly number[];
  loading?: boolean;
  /** Prefix for data-testid: `${testId}-summary|-size|-prev|-page|-next`. */
  testId?: string;
}

/** Shared numbered pager: range + total, size selector, Trước/Sau with disabled ends. */
export const Pagination: React.FC<PaginationProps> = ({
  total,
  hasNext,
  itemCount,
  page,
  pageSize,
  onPage,
  onPageSize,
  pageSizes = PAGINATION_PAGE_SIZES,
  loading = false,
  testId = 'pager',
}) => {
  const known = typeof total === 'number';
  const count = known ? total : (itemCount ?? 0);
  const pages = known ? pageCount(total, pageSize) : page + 1;
  const { from, to } = known
    ? pageRange(page, total, pageSize)
    : count > 0
      ? { from: page * pageSize + 1, to: page * pageSize + count }
      : { from: 0, to: 0 };
  const noNext = known ? page + 1 >= pages : !hasNext;
  const sizes = pageSizes.includes(pageSize)
    ? pageSizes
    : [...pageSizes, pageSize].sort((a, b) => a - b);
  return (
    <nav
      aria-label="Phân trang"
      data-testid={testId}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        color: TOKENS.colors.textSecondary,
        fontSize: TOKENS.typography.fontSize.sm,
      }}
    >
      <span data-testid={`${testId}-summary`}>
        {count === 0
          ? 'Không có mục nào'
          : known
            ? `Hiển thị ${from}–${to} / ${total} mục`
            : `Hiển thị ${from}–${to} mục`}
      </span>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {onPageSize && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Mỗi trang
            <select
              aria-label="Số mục mỗi trang"
              data-testid={`${testId}-size`}
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              style={{
                minHeight: 36,
                padding: '4px 8px',
                boxSizing: 'border-box',
                background: TOKENS.colors.background,
                color: TOKENS.colors.text,
                border: `1px solid ${TOKENS.colors.border}`,
                borderRadius: 8,
              }}
            >
              {sizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <AppButton
          variant="secondary"
          size="sm"
          data-testid={`${testId}-prev`}
          disabled={loading || page <= 0}
          onClick={() => onPage(page - 1)}
        >
          Trước
        </AppButton>
        <span data-testid={`${testId}-page`} aria-live="polite">
          Trang {page + 1}
          {known ? ` / ${pages}` : ''}
        </span>
        <AppButton
          variant="secondary"
          size="sm"
          data-testid={`${testId}-next`}
          disabled={loading || noNext}
          onClick={() => onPage(page + 1)}
        >
          Sau
        </AppButton>
      </div>
    </nav>
  );
};
