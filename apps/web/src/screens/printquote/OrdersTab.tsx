import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { StatusBadge } from '../../../../../packages/ui/src/components/index.js';
import {
  PrintProductionStatus,
  PrintDeliveryStatus,
  OrderCostReconciliationStatus,
  type PrintProductionStatusType,
  type PrintDeliveryStatusType,
  type PrintOrderData,
  type PrintVendorData,
} from '../../../../../packages/contracts/src/printquote.js';
import {
  formatVnd,
  PRODUCTION_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from '../helpers/printquote-helpers.js';
import { tabularNumStyle } from './types.js';
import {
  PqPackageIcon,
  PqSearchIcon,
  PqWalletIcon,
} from './PrintQuoteIcons.js';

const LazyOrdersTabModals = React.lazy(() =>
  import('./OrdersTabModals.js').then((m) => ({
    default: m.OrdersTabModals,
  })),
);

export const INITIAL_VISIBLE_ORDERS_LIMIT = 50;
export const VISIBLE_ORDERS_STEP = 50;

export type OrderFilterMode =
  | 'ALL'
  | 'IN_PROD'
  | 'PENDING_DELIVERY'
  | 'HAS_DEBT'
  | 'NEEDS_COST_REVIEW'
  | 'CANCELLED_OBLIGATIONS';

export type OrderPrimaryActionType =
  | 'SETTLE_CANCEL'
  | 'CONFIRM_COST'
  | 'RECORD_PAYMENT'
  | null;

export interface OrderStatusCounts {
  all: number;
  inProd: number;
  pendingDelivery: number;
  hasDebt: number;
  needsCostReview: number;
  cancelledObligations: number;
}

export interface OrdersTabProps {
  orders: PrintOrderData[];
  vendors?: PrintVendorData[] | undefined;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  authBlocked?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  onEnsureVendors?: (() => void | Promise<void>) | undefined;
  initialVisibleLimit?: number | undefined;
  onMutateLedger?:
    | ((
        endpoint: string,
        body: Record<string, unknown>,
        method?: 'POST' | 'PATCH',
      ) => Promise<{ ok: boolean; error?: string; code?: string }>)
    | undefined;
  onUpdateOrderField: (
    orderId: string,
    patch: Record<string, unknown>,
  ) => void | Promise<boolean>;
  paymentOrderTarget: PrintOrderData | null;
  setPaymentOrderTarget: (ord: PrintOrderData | null) => void;
  paymentAmount: number;
  setPaymentAmount: (v: number) => void;
  paymentType: 'DEPOSIT' | 'INSTALLMENT' | 'FINAL' | 'REFUND';
  setPaymentType: (v: 'DEPOSIT' | 'INSTALLMENT' | 'FINAL' | 'REFUND') => void;
  paymentMethod: string;
  setPaymentMethod: (v: string) => void;
  paymentNote: string;
  setPaymentNote: (v: string) => void;
  onRecordPayment: (e: React.FormEvent) => void;
  paymentSubmitting?: boolean | undefined;
}

export function hasCancelledObligation(ord: PrintOrderData): boolean {
  if (ord.production_status !== 'CANCELLED') return false;
  const enteredSum =
    (ord.entered_vendor_cost ?? 0) +
    (ord.entered_shipping_fee ?? 0) +
    (ord.entered_extra_cost ?? 0);
  const confirmedSum = ord.actual_cost_confirmed
    ? (ord.actual_vendor_cost ?? 0) +
      (ord.actual_shipping_fee ?? 0) +
      (ord.actual_extra_cost ?? 0)
    : 0;
  return (
    ord.total_paid_amount > 0 ||
    (ord.vendor_paid_amount ?? 0) > 0 ||
    confirmedSum > 0 ||
    enteredSum > 0
  );
}

export function isNeedsCostReview(ord: PrintOrderData): boolean {
  return (
    !ord.actual_cost_confirmed &&
    (ord.cost_reconciliation_status ===
      OrderCostReconciliationStatus.NEEDS_REVIEW ||
      ord.cost_reconciliation_status ===
        OrderCostReconciliationStatus.PARTIAL_ENTERED ||
      ord.cost_reconciliation_status ===
        OrderCostReconciliationStatus.ENTERED_UNCONFIRMED)
  );
}

export function isPendingDelivery(ord: PrintOrderData): boolean {
  return (
    ord.production_status !== 'CANCELLED' &&
    ord.delivery_status !== 'DELIVERED' &&
    ord.delivery_status !== 'RETURNED'
  );
}

export function isInProduction(ord: PrintOrderData): boolean {
  return (
    ord.production_status !== 'COMPLETED' &&
    ord.production_status !== 'CANCELLED'
  );
}

export function hasRemainingDebt(ord: PrintOrderData): boolean {
  return ord.production_status !== 'CANCELLED' && ord.remaining_debt_amount > 0;
}

export function computeOrderStatusCounts(
  orders: readonly PrintOrderData[],
): OrderStatusCounts {
  let inProd = 0;
  let pendingDelivery = 0;
  let hasDebt = 0;
  let needsCostReview = 0;
  let cancelledObligations = 0;

  for (let i = 0; i < orders.length; i += 1) {
    const ord = orders[i];
    if (!ord) continue;
    if (isInProduction(ord)) inProd += 1;
    if (isPendingDelivery(ord)) pendingDelivery += 1;
    if (hasRemainingDebt(ord)) hasDebt += 1;
    if (isNeedsCostReview(ord)) needsCostReview += 1;
    if (hasCancelledObligation(ord)) cancelledObligations += 1;
  }

  return {
    all: orders.length,
    inProd,
    pendingDelivery,
    hasDebt,
    needsCostReview,
    cancelledObligations,
  };
}

export function filterPrintOrders(
  orders: readonly PrintOrderData[],
  filterMode: OrderFilterMode,
  searchQuery: string,
): PrintOrderData[] {
  const q = searchQuery.trim().toLowerCase();
  const result: PrintOrderData[] = [];

  for (let i = 0; i < orders.length; i += 1) {
    const ord = orders[i];
    if (!ord) continue;
    if (filterMode === 'IN_PROD' && !isInProduction(ord)) continue;
    if (filterMode === 'PENDING_DELIVERY' && !isPendingDelivery(ord)) continue;
    if (filterMode === 'HAS_DEBT' && !hasRemainingDebt(ord)) continue;
    if (filterMode === 'NEEDS_COST_REVIEW' && !isNeedsCostReview(ord)) continue;
    if (
      filterMode === 'CANCELLED_OBLIGATIONS' &&
      !hasCancelledObligation(ord)
    ) {
      continue;
    }
    if (q) {
      const codeMatch = ord.order_code.toLowerCase().includes(q);
      const custMatch = (ord.customer_name || '').toLowerCase().includes(q);
      const quoteMatch = (ord.quote_code || '').toLowerCase().includes(q);
      if (!codeMatch && !custMatch && !quoteMatch) continue;
    }
    result.push(ord);
  }

  return result;
}

export function resolveOrderPrimaryAction(
  ord: PrintOrderData,
  hasLedgerMutation: boolean,
): OrderPrimaryActionType {
  const isCancelled = ord.production_status === 'CANCELLED';
  // Priority 1: Cancellation settlement when allowed
  if (hasLedgerMutation && isCancelled && ord.total_paid_amount > 0) {
    return 'SETTLE_CANCEL';
  }
  // Priority 2: Actual cost confirmation when unconfirmed
  if (!ord.actual_cost_confirmed) {
    return 'CONFIRM_COST';
  }
  // Priority 3: Payment / Refund when remaining debt or refundable deposit exists
  if (
    (!isCancelled && ord.remaining_debt_amount > 0) ||
    (isCancelled && ord.total_paid_amount > 0)
  ) {
    return 'RECORD_PAYMENT';
  }
  return null;
}

export const OrdersTab: React.FC<OrdersTabProps> = ({
  orders,
  vendors = [],
  loading = false,
  error = null,
  authBlocked = false,
  onRetry,
  onEnsureVendors,
  initialVisibleLimit = INITIAL_VISIBLE_ORDERS_LIMIT,
  onMutateLedger,
  onUpdateOrderField,
  paymentOrderTarget,
  setPaymentOrderTarget,
  paymentAmount,
  setPaymentAmount,
  paymentType,
  setPaymentType,
  paymentMethod,
  setPaymentMethod,
  paymentNote,
  setPaymentNote,
  onRecordPayment,
  paymentSubmitting = false,
}) => {
  const pageSize = Math.max(1, initialVisibleLimit);
  const safeOrders = useMemo(
    () => (authBlocked ? [] : orders),
    [authBlocked, orders],
  );
  const [filterMode, setFilterMode] = useState<OrderFilterMode>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [openOverflowOrderId, setOpenOverflowOrderId] = useState<string | null>(
    null,
  );
  const [costOrderTarget, setCostOrderTarget] = useState<PrintOrderData | null>(
    null,
  );
  const [jobOrderTarget, setJobOrderTarget] = useState<PrintOrderData | null>(
    null,
  );
  const [settleCancelTarget, setSettleCancelTarget] =
    useState<PrintOrderData | null>(null);

  const overflowTriggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const modalTriggerFocusRef = useRef<HTMLElement | null>(null);
  const prevHadOpenModalRef = useRef<boolean>(false);

  const captureModalTriggerFocus = useCallback(() => {
    if (
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
    ) {
      modalTriggerFocusRef.current = document.activeElement;
    }
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterMode, searchQuery, pageSize]);

  useEffect(() => {
    if (authBlocked) {
      setDetailOrderId(null);
      setOpenOverflowOrderId(null);
      setCostOrderTarget(null);
      setJobOrderTarget(null);
      setSettleCancelTarget(null);
      setPaymentOrderTarget(null);
    }
  }, [authBlocked, setPaymentOrderTarget]);

  const closeOverflowAndRestoreFocus = useCallback(
    (orderIdToRestore: string) => {
      setOpenOverflowOrderId(null);
      const triggerEl = overflowTriggerRefs.current.get(orderIdToRestore);
      if (triggerEl && typeof triggerEl.focus === 'function') {
        try {
          triggerEl.focus();
        } catch {
          // Ignore focus errors in headless tests
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!openOverflowOrderId || typeof document === 'undefined') {
      return undefined;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('[data-pq-order-overflow-root="true"]')) {
        return;
      }
      setOpenOverflowOrderId(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeOverflowAndRestoreFocus(openOverflowOrderId);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [openOverflowOrderId, closeOverflowAndRestoreFocus]);

  const handleOverflowMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, orderId: string) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeOverflowAndRestoreFocus(orderId);
        return;
      }
      if (
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'Home' ||
        e.key === 'End'
      ) {
        const items = Array.from(
          e.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button:not([disabled])',
          ),
        );
        if (items.length === 0) return;
        e.preventDefault();
        const activeIdx = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        let nextIdx = 0;
        if (e.key === 'Home') {
          nextIdx = 0;
        } else if (e.key === 'End') {
          nextIdx = items.length - 1;
        } else if (e.key === 'ArrowDown') {
          nextIdx = activeIdx < 0 ? 0 : (activeIdx + 1) % items.length;
        } else {
          nextIdx =
            activeIdx <= 0 ? items.length - 1 : (activeIdx - 1) % items.length;
        }
        items[nextIdx]?.focus();
      }
    },
    [closeOverflowAndRestoreFocus],
  );

  const openConfirmActualCostModal = useCallback(
    (ord: PrintOrderData) => {
      if (authBlocked) return;
      captureModalTriggerFocus();
      setOpenOverflowOrderId(null);
      setCostOrderTarget(ord);
    },
    [authBlocked, captureModalTriggerFocus],
  );

  const openPaymentModalForOrder = useCallback(
    (ord: PrintOrderData) => {
      if (authBlocked) return;
      captureModalTriggerFocus();
      setOpenOverflowOrderId(null);
      setPaymentOrderTarget(ord);
      if (ord.production_status === 'CANCELLED') {
        setPaymentAmount(ord.total_paid_amount || 0);
        setPaymentType('REFUND');
      } else {
        setPaymentAmount(ord.remaining_debt_amount || 0);
        setPaymentType(ord.total_paid_amount === 0 ? 'DEPOSIT' : 'FINAL');
      }
    },
    [
      authBlocked,
      captureModalTriggerFocus,
      setPaymentAmount,
      setPaymentOrderTarget,
      setPaymentType,
    ],
  );

  const openWorkshopJobModalForOrder = useCallback(
    (ord: PrintOrderData) => {
      if (authBlocked) return;
      captureModalTriggerFocus();
      setOpenOverflowOrderId(null);
      if (onEnsureVendors) {
        void onEnsureVendors();
      }
      setJobOrderTarget(ord);
    },
    [authBlocked, captureModalTriggerFocus, onEnsureVendors],
  );

  const openSettleCancelModalForOrder = useCallback(
    (ord: PrintOrderData) => {
      if (authBlocked) return;
      captureModalTriggerFocus();
      setOpenOverflowOrderId(null);
      setSettleCancelTarget(ord);
    },
    [authBlocked, captureModalTriggerFocus],
  );

  const statusCounts = useMemo(
    () => computeOrderStatusCounts(safeOrders),
    [safeOrders],
  );

  const filteredOrders = useMemo(
    () => filterPrintOrders(safeOrders, filterMode, searchQuery),
    [safeOrders, filterMode, searchQuery],
  );

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const pageStartIndex = (effectivePage - 1) * pageSize;

  const visibleOrders = useMemo(
    () => filteredOrders.slice(pageStartIndex, pageStartIndex + pageSize),
    [filteredOrders, pageStartIndex, pageSize],
  );

  const detailOrder = useMemo(
    () =>
      detailOrderId && !authBlocked
        ? (safeOrders.find((o) => o.id === detailOrderId) ?? null)
        : null,
    [safeOrders, detailOrderId, authBlocked],
  );

  const hasAnyOpenModal = Boolean(
    detailOrder ||
      paymentOrderTarget ||
      costOrderTarget ||
      jobOrderTarget ||
      settleCancelTarget,
  );

  useEffect(() => {
    if (prevHadOpenModalRef.current && !hasAnyOpenModal) {
      const prev = modalTriggerFocusRef.current;
      modalTriggerFocusRef.current = null;
      if (
        prev &&
        typeof prev.focus === 'function' &&
        typeof document !== 'undefined' &&
        document.contains(prev)
      ) {
        try {
          prev.focus();
        } catch {
          // Ignore focus restoration error
        }
      }
    }
    prevHadOpenModalRef.current = hasAnyOpenModal;
  }, [hasAnyOpenModal]);

  const underlineTabs: Array<{
    id: OrderFilterMode;
    label: string;
    count: number;
  }> = [
    { id: 'ALL', label: 'Tất cả', count: statusCounts.all },
    { id: 'IN_PROD', label: 'Đang in', count: statusCounts.inProd },
    {
      id: 'PENDING_DELIVERY',
      label: 'Chờ giao',
      count: statusCounts.pendingDelivery,
    },
    { id: 'HAS_DEBT', label: 'Còn nợ', count: statusCounts.hasDebt },
  ];

  const todoShortcuts: Array<{
    id: OrderFilterMode;
    testId: string;
    label: string;
    count: number;
    tone: 'accent' | 'warning' | 'danger';
  }> = [
    {
      id: 'PENDING_DELIVERY',
      testId: 'pq-orders-todo-pending-delivery',
      label: 'Chờ giao',
      count: statusCounts.pendingDelivery,
      tone: 'accent',
    },
    {
      id: 'NEEDS_COST_REVIEW',
      testId: 'pq-orders-todo-needs-cost-review',
      label: 'Cần kiểm tra chi phí',
      count: statusCounts.needsCostReview,
      tone: 'warning',
    },
    {
      id: 'CANCELLED_OBLIGATIONS',
      testId: 'pq-orders-todo-cancelled-obligations',
      label: 'Đơn hủy cần quyết toán',
      count: statusCounts.cancelledObligations,
      tone: 'danger',
    },
  ];

  const guardedUpdateOrderField = useCallback(
    (orderId: string, patch: Record<string, unknown>) => {
      if (authBlocked) return Promise.resolve(false);
      return onUpdateOrderField(orderId, patch);
    },
    [authBlocked, onUpdateOrderField],
  );

  return (
    <div
      data-testid="panel-orders"
      style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">
            Đơn hàng đặt in ({statusCounts.all})
          </h1>
          <p className="pq-page-subtitle">
            Theo dõi tiến độ xưởng in, giao hàng, thu tiền khách và đối soát chi
            phí thực tế
          </p>
        </div>
      </div>

      {/* Compact "Cần xử lý" Shortcuts (TikTok Seller Center style) */}
      <section
        className="pq-orders-todo-strip"
        aria-label="Việc cần xử lý trên đơn hàng"
        data-testid="pq-orders-todo-strip"
      >
        <div className="pq-orders-todo-header">
          <span className="pq-orders-todo-title">Cần xử lý</span>
        </div>
        <div
          className="pq-orders-todo-grid"
          role="group"
          aria-label="Lối tắt việc cần xử lý"
        >
          {todoShortcuts.map((shortcut) => {
            const isActive = filterMode === shortcut.id;
            const hasItems = shortcut.count > 0;
            return (
              <button
                key={shortcut.id}
                type="button"
                data-testid={shortcut.testId}
                aria-pressed={isActive}
                className={`pq-orders-todo-item tone-${shortcut.tone}${isActive ? ' active' : ''}${hasItems ? ' has-items' : ''}`}
                onClick={() =>
                  setFilterMode((prev) =>
                    prev === shortcut.id ? 'ALL' : shortcut.id,
                  )
                }
              >
                <span className="pq-orders-todo-label">{shortcut.label}</span>
                <span className="pq-orders-todo-count">{shortcut.count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Orders Workspace Card: Underline Filter Buttons + Search + Compact Table */}
      <div className="pq-orders-workspace-card">
        <div className="pq-orders-toolbar">
          <div
            className="pq-orders-tabs"
            role="group"
            aria-label="Lọc trạng thái đơn hàng"
          >
            {underlineTabs.map((tab) => {
              const active = filterMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={active}
                  data-testid={`pq-orders-tab-${tab.id.toLowerCase()}`}
                  className={`pq-orders-tab${active ? ' active' : ''}`}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => setFilterMode(tab.id)}
                >
                  <span>{tab.label}</span>
                  <span className="pq-orders-tab-badge">{tab.count}</span>
                </button>
              );
            })}
          </div>

          <div className="pq-orders-search-bar">
            <div className="pq-search-wrap">
              <PqSearchIcon size={15} className="pq-search-icon" />
              <input
                type="search"
                aria-label="Tìm kiếm đơn hàng"
                className="pq-input pq-search-input"
                placeholder="Tìm mã đơn, tên khách hoặc mã báo giá…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery.length > 0 && (
                <button
                  type="button"
                  aria-label="Xóa tìm kiếm đơn hàng"
                  data-testid="pq-orders-search-clear"
                  className="pq-orders-search-clear"
                  onClick={() => setSearchQuery('')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {(filterMode === 'NEEDS_COST_REVIEW' ||
          filterMode === 'CANCELLED_OBLIGATIONS') && (
          <div
            className="pq-orders-active-filter-banner"
            data-testid="pq-orders-active-shortcut-banner"
          >
            <span>
              Đang lọc nhanh:{' '}
              <strong style={{ color: 'var(--text-primary)' }}>
                {filterMode === 'NEEDS_COST_REVIEW'
                  ? `Cần kiểm tra chi phí (${statusCounts.needsCostReview})`
                  : `Đơn hủy cần quyết toán (${statusCounts.cancelledObligations})`}
              </strong>
            </span>
            <button
              type="button"
              className="pq-btn pq-btn-ghost pq-btn-sm"
              onClick={() => setFilterMode('ALL')}
            >
              Xem tất cả đơn
            </button>
          </div>
        )}

        {error && safeOrders.length > 0 && (
          <div
            role="alert"
            data-testid="pq-orders-inline-error"
            className="pq-orders-active-filter-banner"
            style={{ color: 'var(--danger)' }}
          >
            <span>Không thể làm mới danh sách đơn hàng: {error}</span>
            {onRetry && (
              <button
                type="button"
                data-testid="pq-orders-retry-btn"
                className="pq-btn pq-btn-secondary pq-btn-sm"
                onClick={onRetry}
              >
                Thử tải lại
              </button>
            )}
          </div>
        )}

        {loading && safeOrders.length === 0 ? (
          <div
            data-testid="pq-orders-loading"
            style={{
              padding: '44px 24px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '13.5px',
            }}
          >
            Đang tải danh sách đơn hàng đặt in…
          </div>
        ) : error && safeOrders.length === 0 ? (
          <div
            role="alert"
            data-testid="pq-orders-error"
            style={{
              padding: '40px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: '14.5px',
                color: 'var(--danger)',
              }}
            >
              {authBlocked
                ? 'Phiên làm việc hoặc quyền truy cập đơn hàng không hợp lệ'
                : 'Không tải được danh sách đơn hàng'}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              {error}
            </div>
            {onRetry && (
              <button
                type="button"
                data-testid="pq-orders-retry-btn"
                className="pq-btn pq-btn-primary pq-btn-sm"
                onClick={onRetry}
              >
                Thử tải lại
              </button>
            )}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div
            style={{
              padding: '40px 24px',
              textAlign: 'center',
            }}
          >
            {safeOrders.length === 0 ? (
              <div
                data-testid="pq-orders-empty"
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
                  <PqPackageIcon size={24} />
                </div>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>
                  Chưa có đơn hàng đặt in
                </div>
                <div style={{ color: 'var(--muted-color)', fontSize: '13px' }}>
                  Khi khách chốt báo giá, hãy nhấn{' '}
                  <strong>Chuyển thành Đơn đặt in</strong> từ danh sách hoặc chi
                  tiết báo giá.
                </div>
              </div>
            ) : (
              <div
                data-testid="pq-orders-filter-empty"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <div
                  style={{ color: 'var(--muted-color)', fontSize: '13.5px' }}
                >
                  Không có đơn hàng nào khớp bộ lọc hiện tại.
                </div>
                <button
                  type="button"
                  data-testid="pq-orders-reset-filter-btn"
                  className="pq-btn pq-btn-secondary pq-btn-sm"
                  onClick={() => {
                    setFilterMode('ALL');
                    setSearchQuery('');
                  }}
                >
                  Xóa bộ lọc
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="pq-table-wrap pq-orders-table-wrap">
              <table
                data-testid="pq-orders-table"
                className="pq-table pq-directory-table pq-orders-table rt-cards"
                aria-label="Danh sách đơn hàng đặt in"
              >
                <thead>
                  <tr>
                    <th scope="col">Đơn hàng</th>
                    <th scope="col">Khách hàng</th>
                    <th scope="col">Sản xuất</th>
                    <th scope="col">Giao hàng</th>
                    <th scope="col" className="right">
                      Tổng đơn
                    </th>
                    <th scope="col" className="right">
                      Còn nợ
                    </th>
                    <th scope="col" className="right">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map((ord) => {
                    const isCancelled = ord.production_status === 'CANCELLED';
                    const cancelledHasObligation = hasCancelledObligation(ord);
                    const primaryAction = resolveOrderPrimaryAction(
                      ord,
                      Boolean(onMutateLedger) && !authBlocked,
                    );
                    const isOverflowOpen = openOverflowOrderId === ord.id;
                    const canSettleCancel =
                      Boolean(onMutateLedger) &&
                      !authBlocked &&
                      isCancelled &&
                      ord.total_paid_amount > 0;
                    const canAddWorkshopJob =
                      Boolean(onMutateLedger) && !authBlocked && !isCancelled;
                    const menuDomId = `pq-order-overflow-menu-${ord.order_code}`;

                    return (
                      <tr
                        key={ord.id}
                        data-testid={`order-card-${ord.order_code}`}
                      >
                        <td data-label="Đơn hàng">
                          <div>
                            <button
                              type="button"
                              data-testid={`pq-order-open-detail-${ord.order_code}`}
                              className="pq-order-code-btn"
                              aria-label={`Xem chi tiết đơn hàng ${ord.order_code}`}
                              onClick={() => {
                                captureModalTriggerFocus();
                                setOpenOverflowOrderId(null);
                                setDetailOrderId(ord.id);
                              }}
                            >
                              <span className="pq-code-pill">
                                {ord.order_code}
                              </span>
                            </button>
                            <div className="pq-order-subtext">
                              BG: {ord.quote_code || '—'} (v{ord.quote_version})
                              {ord.print_ordered_at
                                ? ` • Đặt in: ${ord.print_ordered_at}`
                                : ''}
                            </div>
                            {cancelledHasObligation ? (
                              <div
                                data-testid={`pq-order-cancelled-obligation-${ord.order_code}`}
                                className="pq-order-alert-tag danger"
                              >
                                Đơn hủy còn nghĩa vụ
                              </div>
                            ) : !ord.actual_cost_confirmed ? (
                              <div className="pq-order-alert-tag warning">
                                {isNeedsCostReview(ord)
                                  ? 'Cần kiểm tra chi phí'
                                  : 'Chưa xác nhận chi phí'}
                              </div>
                            ) : (
                              <div className="pq-order-alert-tag success">
                                CP thực tế:{' '}
                                {formatVnd(
                                  (ord.actual_vendor_cost ?? 0) +
                                    (ord.actual_shipping_fee ?? 0) +
                                    (ord.actual_extra_cost ?? 0),
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        <td data-label="Khách hàng">
                          <div>
                            <strong style={{ color: 'var(--text-primary)' }}>
                              {ord.customer_name || 'Khách lẻ'}
                            </strong>
                            <div className="pq-order-subtext">
                              {ord.workshop_jobs && ord.workshop_jobs.length > 0
                                ? `${ord.workshop_jobs.length} phiếu đặt xưởng`
                                : `Vốn DK: ${formatVnd(ord.expected_vendor_cost)}`}
                            </div>
                          </div>
                        </td>

                        <td data-label="Sản xuất">
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '5px',
                              alignItems: 'flex-start',
                            }}
                          >
                            <StatusBadge
                              status={
                                ord.production_status === 'COMPLETED'
                                  ? 'success'
                                  : ord.production_status === 'CANCELLED'
                                    ? 'error'
                                    : 'neutral'
                              }
                              label={`SX: ${PRODUCTION_STATUS_LABELS[ord.production_status]}`}
                            />
                            <select
                              aria-label={`Trạng thái sản xuất ${ord.order_code}`}
                              className="pq-order-inline-select"
                              disabled={authBlocked}
                              value={ord.production_status}
                              onChange={(e) =>
                                void guardedUpdateOrderField(ord.id, {
                                  production_status: e.target
                                    .value as PrintProductionStatusType,
                                })
                              }
                            >
                              {Object.entries(PrintProductionStatus).map(
                                ([, val]) => (
                                  <option key={val} value={val}>
                                    {PRODUCTION_STATUS_LABELS[val]}
                                  </option>
                                ),
                              )}
                            </select>
                          </div>
                        </td>

                        <td data-label="Giao hàng">
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '5px',
                              alignItems: 'flex-start',
                            }}
                          >
                            <StatusBadge
                              status={
                                ord.delivery_status === 'DELIVERED'
                                  ? 'success'
                                  : 'warning'
                              }
                              label={`Giao: ${DELIVERY_STATUS_LABELS[ord.delivery_status]}`}
                            />
                            <select
                              aria-label={`Trạng thái giao hàng ${ord.order_code}`}
                              className="pq-order-inline-select"
                              disabled={authBlocked}
                              value={ord.delivery_status}
                              onChange={(e) =>
                                void guardedUpdateOrderField(ord.id, {
                                  delivery_status: e.target
                                    .value as PrintDeliveryStatusType,
                                })
                              }
                            >
                              {Object.entries(PrintDeliveryStatus).map(
                                ([, val]) => (
                                  <option key={val} value={val}>
                                    {DELIVERY_STATUS_LABELS[val]}
                                  </option>
                                ),
                              )}
                            </select>
                          </div>
                        </td>

                        <td
                          data-label="Tổng đơn"
                          className="right mono"
                          style={tabularNumStyle}
                        >
                          <div>
                            <strong style={{ color: 'var(--text-primary)' }}>
                              {formatVnd(ord.total_quote_amount)}
                            </strong>
                            <div className="pq-order-subtext">
                              Đã thu: {formatVnd(ord.total_paid_amount)}
                            </div>
                          </div>
                        </td>

                        <td
                          data-label="Còn nợ"
                          className="right mono"
                          style={tabularNumStyle}
                        >
                          <div>
                            <strong
                              style={{
                                color: isCancelled
                                  ? 'var(--muted-color)'
                                  : ord.remaining_debt_amount > 0
                                    ? 'var(--danger-text)'
                                    : 'var(--success-text)',
                              }}
                            >
                              {isCancelled
                                ? 'Đơn đã hủy'
                                : formatVnd(ord.remaining_debt_amount)}
                            </strong>
                            <div style={{ marginTop: '3px' }}>
                              <StatusBadge
                                status={
                                  ord.payment_status === 'PAID'
                                    ? 'success'
                                    : ord.remaining_debt_amount > 0 &&
                                        !isCancelled
                                      ? 'error'
                                      : 'muted'
                                }
                                label={
                                  PAYMENT_STATUS_LABELS[ord.payment_status]
                                }
                              />
                            </div>
                          </div>
                        </td>

                        <td data-label="Thao tác" className="right">
                          <div
                            className="pq-order-actions-wrap"
                            data-pq-order-overflow-root="true"
                          >
                            {primaryAction === 'SETTLE_CANCEL' ? (
                              <button
                                type="button"
                                data-testid={`pq-order-settle-cancel-${ord.order_code}`}
                                className="pq-btn pq-btn-secondary pq-btn-sm"
                                onClick={() =>
                                  openSettleCancelModalForOrder(ord)
                                }
                              >
                                Quyết toán hủy đơn
                              </button>
                            ) : primaryAction === 'CONFIRM_COST' ? (
                              <button
                                type="button"
                                data-testid={`pq-order-confirm-cost-${ord.order_code}`}
                                className="pq-btn pq-btn-secondary pq-btn-sm"
                                onClick={() => openConfirmActualCostModal(ord)}
                              >
                                Xác nhận chi phí thực tế
                              </button>
                            ) : primaryAction === 'RECORD_PAYMENT' ? (
                              <button
                                type="button"
                                data-testid={`pq-order-record-payment-${ord.order_code}`}
                                className="pq-btn pq-btn-primary pq-btn-sm"
                                onClick={() => openPaymentModalForOrder(ord)}
                              >
                                <PqWalletIcon size={14} />
                                <span>
                                  {isCancelled
                                    ? 'Hoàn tiền khách (Đơn hủy)'
                                    : 'Ghi nhận thanh toán'}
                                </span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-testid={`pq-order-detail-cta-${ord.order_code}`}
                                className="pq-btn pq-btn-ghost pq-btn-sm"
                                onClick={() => {
                                  captureModalTriggerFocus();
                                  setOpenOverflowOrderId(null);
                                  setDetailOrderId(ord.id);
                                }}
                              >
                                Chi tiết đơn
                              </button>
                            )}

                            <button
                              type="button"
                              ref={(el) => {
                                if (el) {
                                  overflowTriggerRefs.current.set(ord.id, el);
                                } else {
                                  overflowTriggerRefs.current.delete(ord.id);
                                }
                              }}
                              aria-label={`Thao tác khác cho đơn ${ord.order_code}`}
                              aria-expanded={isOverflowOpen}
                              aria-controls={
                                isOverflowOpen ? menuDomId : undefined
                              }
                              data-testid={`pq-order-overflow-btn-${ord.order_code}`}
                              className="pq-order-overflow-btn"
                              onClick={() =>
                                setOpenOverflowOrderId((prev) =>
                                  prev === ord.id ? null : ord.id,
                                )
                              }
                            >
                              ⋯
                            </button>

                            {isOverflowOpen && (
                              <div
                                id={menuDomId}
                                role="group"
                                aria-label={`Các thao tác khác cho đơn ${ord.order_code}`}
                                data-testid={`pq-order-overflow-menu-${ord.order_code}`}
                                className="pq-order-overflow-menu"
                                onKeyDown={(e) =>
                                  handleOverflowMenuKeyDown(e, ord.id)
                                }
                              >
                                <button
                                  type="button"
                                  data-testid={`pq-order-overflow-detail-${ord.order_code}`}
                                  className="pq-order-overflow-item"
                                  onClick={() => {
                                    captureModalTriggerFocus();
                                    setOpenOverflowOrderId(null);
                                    setDetailOrderId(ord.id);
                                  }}
                                >
                                  <span>Chi tiết & đối soát đơn</span>
                                </button>

                                {primaryAction !== 'RECORD_PAYMENT' && (
                                  <button
                                    type="button"
                                    data-testid={`pq-order-record-payment-${ord.order_code}`}
                                    className="pq-order-overflow-item"
                                    onClick={() =>
                                      openPaymentModalForOrder(ord)
                                    }
                                  >
                                    <span>
                                      {isCancelled
                                        ? 'Hoàn tiền khách (Đơn hủy)'
                                        : 'Ghi nhận thanh toán'}
                                    </span>
                                  </button>
                                )}

                                {primaryAction !== 'CONFIRM_COST' && (
                                  <button
                                    type="button"
                                    data-testid={`pq-order-confirm-cost-${ord.order_code}`}
                                    className="pq-order-overflow-item warning"
                                    onClick={() =>
                                      openConfirmActualCostModal(ord)
                                    }
                                  >
                                    <span>
                                      {ord.actual_cost_confirmed
                                        ? 'Điều chỉnh / Bỏ xác nhận'
                                        : 'Xác nhận chi phí thực tế'}
                                    </span>
                                  </button>
                                )}

                                {canAddWorkshopJob && (
                                  <button
                                    type="button"
                                    data-testid={`pq-order-add-job-${ord.order_code}`}
                                    className="pq-order-overflow-item"
                                    onClick={() =>
                                      openWorkshopJobModalForOrder(ord)
                                    }
                                  >
                                    <span>+ Đặt xưởng / Tách công đoạn</span>
                                  </button>
                                )}

                                {canSettleCancel &&
                                  primaryAction !== 'SETTLE_CANCEL' && (
                                    <button
                                      type="button"
                                      data-testid={`pq-order-settle-cancel-${ord.order_code}`}
                                      className="pq-order-overflow-item danger"
                                      onClick={() =>
                                        openSettleCancelModalForOrder(ord)
                                      }
                                    >
                                      <span>Quyết toán hủy đơn</span>
                                    </button>
                                  )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredOrders.length > pageSize && (
              <nav
                aria-label="Phân trang danh sách đơn hàng"
                data-testid="pq-orders-pagination-bar"
                className="pq-orders-pagination-bar"
              >
                <span>
                  Hiển thị <strong>{pageStartIndex + 1}</strong>–
                  <strong>
                    {Math.min(
                      filteredOrders.length,
                      pageStartIndex + visibleOrders.length,
                    )}
                  </strong>{' '}
                  / <strong>{filteredOrders.length}</strong> đơn hàng (Trang{' '}
                  <strong>{effectivePage}</strong>/{totalPages})
                </span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    data-testid="pq-orders-prev-page-btn"
                    className="pq-btn pq-btn-secondary pq-btn-sm"
                    disabled={effectivePage <= 1}
                    onClick={() =>
                      setCurrentPage((prev) => Math.max(1, prev - 1))
                    }
                  >
                    ← Trang trước
                  </button>
                  <button
                    type="button"
                    data-testid="pq-orders-next-page-btn"
                    className="pq-btn pq-btn-secondary pq-btn-sm"
                    disabled={effectivePage >= totalPages}
                    onClick={() =>
                      setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                    }
                  >
                    Trang sau →
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
      </div>

      {hasAnyOpenModal && (
        <React.Suspense fallback={null}>
          <LazyOrdersTabModals
            detailOrder={detailOrder}
            onCloseDetailOrder={() => setDetailOrderId(null)}
            paymentOrderTarget={paymentOrderTarget}
            setPaymentOrderTarget={setPaymentOrderTarget}
            paymentAmount={paymentAmount}
            setPaymentAmount={setPaymentAmount}
            paymentType={paymentType}
            setPaymentType={setPaymentType}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            paymentNote={paymentNote}
            setPaymentNote={setPaymentNote}
            onRecordPayment={onRecordPayment}
            paymentSubmitting={paymentSubmitting}
            costOrderTarget={costOrderTarget}
            setCostOrderTarget={setCostOrderTarget}
            onOpenConfirmActualCostModal={openConfirmActualCostModal}
            jobOrderTarget={jobOrderTarget}
            setJobOrderTarget={setJobOrderTarget}
            onOpenWorkshopJobModal={openWorkshopJobModalForOrder}
            settleCancelTarget={settleCancelTarget}
            setSettleCancelTarget={setSettleCancelTarget}
            onOpenSettleCancelModal={openSettleCancelModalForOrder}
            onOpenPaymentModal={openPaymentModalForOrder}
            vendors={vendors}
            onMutateLedger={onMutateLedger}
            onUpdateOrderField={guardedUpdateOrderField}
          />
        </React.Suspense>
      )}
    </div>
  );
};
