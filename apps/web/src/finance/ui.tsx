import React, { useEffect, useRef, useState } from 'react';
import {
  ActionIconButton,
  actionIconsRowStyle,
  AppButton,
  AppToast,
  Pagination,
  TOKENS,
  THEME_COLORS,
  PAGINATION_PAGE_SIZES,
  pageCount as sharedPageCount,
  clampPage,
  DEFAULT_PAGE_SIZE,
} from '../../../../packages/ui/src/index.js';
import {
  financeRead,
  loadPending,
  savePending,
  clearPending,
  sendPending,
  type FinanceIdentity,
  type PendingFinanceOperation,
} from './client.js';
import type {
  FinanceCategoryData,
  FinanceEntryData,
} from '../../../../packages/contracts/src/finance.js';
import type { FinancePlanItemData } from '../../../../packages/contracts/src/finance-plan.js';
export interface FinanceScreenProps {
  identity: FinanceIdentity;
  onNavigate: (path: string) => void;
}
export const financeStyle: React.CSSProperties = {
  display: 'grid',
  gap: 16,
  minWidth: 0,
  color: THEME_COLORS.text,
};
/** Top-level FIN page container: extra bottom room so the floating "Báo lỗi" widget never covers the last row/buttons. */
export const financePageStyle: React.CSSProperties = {
  ...financeStyle,
  paddingBottom: 88,
};
export const fieldStyle: React.CSSProperties = {
  minHeight: 44,
  maxWidth: '100%',
  width: '100%',
  boxSizing: 'border-box',
  background: THEME_COLORS.background,
  color: THEME_COLORS.text,
  border: `1px solid ${THEME_COLORS.border}`,
  borderRadius: 8,
  padding: 10,
};
export type FinanceIconAction = 'edit' | 'deactivate' | 'reactivate' | 'detail';
/** FIN adapter over the shared design-system ActionIconButton (`detail` maps to the eye "view" action). */
export function FinanceIconButton({
  action,
  ...rest
}: {
  action: FinanceIconAction;
  target?: string;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <ActionIconButton
      action={action === 'detail' ? 'view' : action}
      {...rest}
    />
  );
}
/** Row of icon buttons: equal 40px targets, 8px gap, never wraps or overlaps. */
export const iconActionsStyle = actionIconsRowStyle;
export const PAGE_SIZE_OPTIONS = PAGINATION_PAGE_SIZES;
export const pageCount = sharedPageCount;
export { clampPage, DEFAULT_PAGE_SIZE };
/** Numbered pager: Trước / Sau, current page, total items, optional page-size selector. */
export function FinancePager({
  testId = 'pager',
  ...props
}: {
  total: number;
  /** 0-based page index. */
  page: number;
  pageSize: number;
  loading: boolean;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  pageSizes?: readonly number[];
  testId?: string;
}) {
  return <Pagination testId={testId} {...props} />;
}
export function FinanceNav({
  onNavigate,
}: Pick<FinanceScreenProps, 'onNavigate'>) {
  const currentPath =
    typeof window !== 'undefined' ? (window.location?.pathname ?? '') : '';
  return (
    <nav
      aria-label="Thu chi cá nhân"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
    >
      {(
        [
          ['/finance', 'Tổng hợp'],
          ['/finance/history', 'Lịch sử'],
          ['/finance/categories', 'Danh mục'],
          ['/finance/plan', 'Kế hoạch thu chi cố định'],
        ] as const
      ).map(([p, l]) => {
        const isActive =
          p === '/finance'
            ? currentPath === '/finance' || currentPath === '/finance/'
            : currentPath.startsWith(p);
        return (
          <AppButton
            key={p}
            variant={isActive ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => onNavigate(p)}
          >
            {l}
          </AppButton>
        );
      })}
    </nav>
  );
}
/** True when the viewport is narrower than `max` px (always false without matchMedia, e.g. tests). */
export function useNarrow(max = 640): boolean {
  const query = `(max-width: ${max}px)`;
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return narrow;
}
/** Column count for a KPI grid from its own width: 4 columns, 2x2, or 1 column. */
export function useGridColumns(
  wide = 840,
  mid = 420,
): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pick = (w: number) => (w >= wide ? 4 : w >= mid ? 2 : 1);
    setCols(pick(el.getBoundingClientRect?.()?.width ?? wide));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setCols(pick(w));
    });
    ro.observe?.(el);
    return () => ro.disconnect?.();
  }, [wide, mid]);
  return [ref, cols];
}
/** Shared FIN page header: title, optional description and a right-aligned primary action. */
export function FinanceHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 260px' }}>
        <h1
          style={{
            margin: 0,
            fontSize: TOKENS.typography.fontSize['2xl'],
            fontWeight: TOKENS.typography.fontWeight.bold,
            color: THEME_COLORS.text,
          }}
        >
          {title}
        </h1>
        {description && (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: TOKENS.typography.fontSize.sm,
              color: THEME_COLORS.muted,
            }}
          >
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
/** Shared KPI tile (label + large amount + optional hint). */
export function FinanceStat({
  label,
  value,
  color,
  hint,
  testId,
}: {
  label: string;
  value: string;
  color: string;
  hint?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      style={{
        padding: '16px 20px',
        borderRadius: TOKENS.radii.md,
        border: `1px solid ${THEME_COLORS.border}`,
        backgroundColor: THEME_COLORS.surface,
        borderLeft: `3px solid ${color}`,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: TOKENS.typography.fontSize.xs,
          color: THEME_COLORS.muted,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: TOKENS.typography.fontWeight.semibold,
        }}
      >
        {label}
      </div>
      <div
        data-testid={testId}
        style={{
          marginTop: 8,
          fontSize: 28,
          lineHeight: 1.2,
          fontWeight: TOKENS.typography.fontWeight.bold,
          color,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            marginTop: 6,
            fontSize: TOKENS.typography.fontSize.xs,
            color: THEME_COLORS.muted,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
export function useFinanceRead<T>(identity: FinanceIdentity, path: string) {
  const binding = `${identity.userId}:${identity.workspaceId}:${path}`;
  const [state, setState] = useState<{
    path: string;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ path: binding, data: null, error: '', loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setState({ path: binding, data: null, error: '', loading: true });
    void financeRead<T>(identity, path, c.signal)
      .then((data) => {
        if (!c.signal.aborted)
          setState({ path: binding, data, error: '', loading: false });
      })
      .catch(() => {
        if (!c.signal.aborted)
          setState({
            path: binding,
            data: null,
            error: 'Không tải được dữ liệu. Hãy thử lại.',
            loading: false,
          });
      });
    return () => c.abort();
  }, [identity.userId, identity.workspaceId, path, retry]);
  return {
    ...(state.path === binding
      ? state
      : { data: null, error: '', loading: true }),
    retry: () => setRetry((v) => v + 1),
  };
}
export function ReadStatus({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  return (
    <>
      {loading && <p role="status">Đang tải…</p>}
      {error && (
        <div role="alert">
          {error}
          <AppButton onClick={retry}>Thử lại</AppButton>
        </div>
      )}
    </>
  );
}

export interface FinanceMutationResult {
  pending: PendingFinanceOperation | null;
  error: string;
  busy: boolean;
  ready: boolean;
  success: boolean;
  submit: (
    path: string,
    method: 'POST' | 'PATCH',
    payload: Record<string, unknown>,
    version?: number | null,
  ) => Promise<
    FinanceCategoryData | FinanceEntryData | FinancePlanItemData | null
  >;
}

export function useFinanceMutation(
  identity: FinanceIdentity,
  slot: string,
): FinanceMutationResult {
  const [pending, setPending] = useState<PendingFinanceOperation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [success, setSuccess] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    setReady(false);
    setPending(null);
    setError('');
    try {
      setPending(loadPending(identity, slot));
      setReady(true);
    } catch {
      setError(
        'Không đọc được yêu cầu chờ. Gửi dữ liệu bị khóa để tránh trùng.',
      );
    }
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, [identity.userId, identity.workspaceId, slot]);
  async function submit(
    path: string,
    method: 'POST' | 'PATCH',
    payload: Record<string, unknown>,
    version: number | null = null,
  ) {
    if (lock.current || !ready || !mounted.current) return null;
    lock.current = true;
    setBusy(true);
    setSuccess(false);
    setError('');
    const c = new AbortController();
    active.current = c;
    try {
      let o = loadPending(identity, slot);
      if (!o) {
        o = {
          identity: { ...identity },
          key: crypto.randomUUID(),
          path,
          method,
          payload: structuredClone(payload),
          version,
        };
        savePending(identity, slot, o);
      }
      if (mounted.current) setPending(o);
      const d = await sendPending(o, c.signal);
      // Scope cleanup to original identity and key even when this screen was unmounted.
      clearPending(o.identity, slot, o.key);
      if (!c.signal.aborted && mounted.current) {
        setPending(null);
        setSuccess(true);
        return d;
      }
      return null;
    } catch (e) {
      if (!c.signal.aborted && mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : 'Chưa xác định kết quả. Giữ yêu cầu để thử lại.',
        );
      return null;
    } finally {
      lock.current = false;
      if (!c.signal.aborted && mounted.current) setBusy(false);
    }
  }
  return { pending, error, busy, ready, success, submit };
}
export function MutationNotice({
  mutation,
}: {
  mutation: ReturnType<typeof useFinanceMutation>;
}) {
  return (
    <>
      {mutation.pending && (
        <p role="status">
          Có yêu cầu chưa đối soát. Nút gửi sẽ thử lại đúng key và nội dung đã
          lưu; không gửi nội dung mới.
        </p>
      )}
      {mutation.error && <p role="alert">{mutation.error}</p>}
      {mutation.success && (
        <AppToast message="Đã lưu thành công." variant="success" />
      )}
    </>
  );
}
