import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import {
  PageHeader,
  useAutoDismiss,
} from '../../../../packages/ui/src/components/index.js';
import {
  AreaInputMode,
  LineCostSource,
  ProfitMode,
  ProfitScope,
  QuotePricingStatus,
  VendorCostMode,
  ShippingAllocationStrategy,
  RoundingMode,
  calculatePrintQuote,
  buildCustomerSafePdfPayload,
  enrichCustomerSafePdfWithAreaBounds,
  type PendingCostLineSummary,
  type VendorCostModeType,
  type ShippingAllocationStrategyType,
  type RoundingModeType,
  type PrintVendorData,
  type PrintVendorPriceItemData,
  type PrintVendorPriceItemHistoryData,
  type PrintCustomerData,
  type PrintQuoteData,
  type PrintOrderData,
  type PrintQuoteDashboardStats,
  type QuoteFinishingStageInput,
  type QuoteLineInput,
} from '../../../../packages/contracts/src/printquote.js';
import {
  buildPrintQuoteA4Html,
  QUOTE_STATUS_LABELS,
  refreshClonedLinesFromCatalog,
  resolveSavedQuoteLineCostState,
  validateQuoteDraftInputs,
  type DraftLineValidationError,
} from './helpers/printquote-helpers.js';
import type { OwnerPaymentBankInfo } from '../../../../packages/contracts/src/vietqr.js';
import type { UserRole } from '../types.js';
import {
  clearPrintQuoteRamDraft,
  getPrintQuoteRamDraft,
  registerPrintQuoteLeaveInterceptor,
  setPrintQuoteRamDraft,
  subscribePrintQuoteDraft,
} from '../printquote-draft-bridge.js';
import {
  EMPTY_DRAFT_LINE,
  cardStyle,
  isQuoteStatusEditable,
  type DraftFinishingStageState,
  type PrintQuoteTabId,
  type PrintQuoteViewMode,
  type DraftLineState,
} from './printquote/types.js';
import { PrintQuoteNavHeader } from './printquote/PrintQuoteNavHeader.js';
import {
  CreateQuoteTab,
  type SaveOverrideBackToCatalogPatch,
} from './printquote/CreateQuoteTab.js';
import { QuotesListTab } from './printquote/QuotesListTab.js';
import { QuoteDetailView } from './printquote/QuoteDetailView.js';
import {
  VendorsCatalogTab,
  type SaveCatalogPriceItemPayload,
} from './printquote/VendorsCatalogTab.js';
import { CustomersTab } from './printquote/CustomersTab.js';
import { OrdersTab } from './printquote/OrdersTab.js';
import { AnalyticsTab } from './printquote/AnalyticsTab.js';
import type { ReceivablesLedgerPayload } from './printquote/ReceivablesTab.js';
import type { PayablesLedgerPayload } from './printquote/PayablesTab.js';
import { CatalogModalDialog } from './printquote/CatalogModalDialog.js';
import { PqFileTextIcon } from './printquote/PrintQuoteIcons.js';
import { PRINTQUOTE_STYLES } from './printquote/printquote-styles.js';
import type {
  UnifiedPrintLedgerItem,
  PrintFinancialReportData,
  PrintHistoricalImportBatchData,
} from '../../../../packages/contracts/src/printquote-finance.js';

const LazyReceivablesTab = React.lazy(() =>
  import('./printquote/ReceivablesTab.js').then((m) => ({
    default: m.ReceivablesTab,
  })),
);
const LazyPayablesTab = React.lazy(() =>
  import('./printquote/PayablesTab.js').then((m) => ({
    default: m.PayablesTab,
  })),
);
const LazyTransactionsTab = React.lazy(() =>
  import('./printquote/TransactionsTab.js').then((m) => ({
    default: m.TransactionsTab,
  })),
);
const LazyHistoricalImportTab = React.lazy(() =>
  import('./printquote/HistoricalImportTab.js').then((m) => ({
    default: m.HistoricalImportTab,
  })),
);
const LazyConvertOrderCustomerModal = React.lazy(() =>
  import('./printquote/ConvertOrderCustomerModal.js').then((m) => ({
    default: m.ConvertOrderCustomerModal,
  })),
);
const LazyPdfPreviewModal = React.lazy(() =>
  import('./printquote/PdfPreviewModal.js').then((m) => ({
    default: m.PdfPreviewModal,
  })),
);

export type {
  PrintQuoteTabId,
  PrintQuoteViewMode,
} from './printquote/types.js';

const DEFAULT_CUSTOMER_NOTES =
  '1. Đơn giá trên đã tính theo đúng quy cách và số lượng đặt in.\n2. Thời gian giao hàng dự kiến: 2–4 ngày làm việc kể từ khi chốt file in và đặt cọc.';

function mapLegacyTabToPath(tab?: PrintQuoteTabId | undefined): string {
  switch (tab) {
    case 'create':
      return '/print-quotes/new';
    case 'vendors':
      return '/print-quotes/catalog/prices';
    case 'customers':
      return '/print-quotes/catalog/customers';
    case 'orders':
      return '/print-quotes/orders';
    case 'analytics':
      return '/print-quotes/reports';
    case 'quotes':
    default:
      return '/print-quotes';
  }
}

function resolveViewAndQuoteId(
  path: string,
  routePattern?: string | undefined,
  routeParams?: Record<string, string> | undefined,
): { viewMode: PrintQuoteViewMode; quoteId: string | null } {
  const clean =
    (path.split(/[?#]/, 1)[0] || '/print-quotes').replace(/\/+$/, '') ||
    '/print-quotes';

  if (clean === '/print-quotes') {
    return { viewMode: 'quotes', quoteId: null };
  }
  if (clean === '/print-quotes/new') {
    return { viewMode: 'new', quoteId: null };
  }
  if (clean === '/print-quotes/orders') {
    return { viewMode: 'orders', quoteId: null };
  }
  if (clean === '/print-quotes/receivables') {
    return { viewMode: 'receivables', quoteId: null };
  }
  if (clean === '/print-quotes/payables') {
    return { viewMode: 'payables', quoteId: null };
  }
  if (clean === '/print-quotes/transactions') {
    return { viewMode: 'transactions', quoteId: null };
  }
  if (clean === '/print-quotes/import-history') {
    return { viewMode: 'import-history', quoteId: null };
  }
  if (
    clean === '/print-quotes/catalog' ||
    clean === '/print-quotes/catalog/prices'
  ) {
    return { viewMode: 'catalog-prices', quoteId: null };
  }
  if (clean === '/print-quotes/catalog/customers') {
    return { viewMode: 'catalog-customers', quoteId: null };
  }
  if (clean === '/print-quotes/catalog/vendors') {
    return { viewMode: 'catalog-vendors', quoteId: null };
  }
  if (clean === '/print-quotes/reports') {
    return { viewMode: 'reports', quoteId: null };
  }

  if (routePattern === '/print-quotes/:id/edit' && routeParams?.['id']) {
    return {
      viewMode: 'edit',
      quoteId: decodeURIComponent(routeParams['id']),
    };
  }
  if (routePattern === '/print-quotes/:id' && routeParams?.['id']) {
    return {
      viewMode: 'detail',
      quoteId: decodeURIComponent(routeParams['id']),
    };
  }

  const editMatch = /^\/print-quotes\/([^/]+)\/edit$/.exec(clean);
  if (editMatch?.[1]) {
    return { viewMode: 'edit', quoteId: decodeURIComponent(editMatch[1]) };
  }
  const detailMatch = /^\/print-quotes\/([^/]+)$/.exec(clean);
  if (detailMatch?.[1]) {
    return { viewMode: 'detail', quoteId: decodeURIComponent(detailMatch[1]) };
  }

  return { viewMode: 'quotes', quoteId: null };
}

function mapQuoteLinesToDraftLines(quote: PrintQuoteData): DraftLineState[] {
  if (!quote.lines_json || quote.lines_json.length === 0) {
    return [EMPTY_DRAFT_LINE(1)];
  }
  return quote.lines_json.map((item, idx) => {
    const resolvedCost = resolveSavedQuoteLineCostState({
      quantity: item.quantity,
      unitVendorCost: item.unitVendorCost,
      totalVendorCost: item.totalVendorCost,
      vendorCostMode: item.vendorCostMode,
      baseCostRate: item.baseCostRate,
      baseCostPending: item.baseCostPending,
      isPendingCost: item.isPendingCost,
    });

    const mappedStages: DraftFinishingStageState[] | undefined =
      item.finishingStages && item.finishingStages.length > 0
        ? item.finishingStages.map((s, sIdx) => ({
            id: s.id || `STG-${idx + 1}-${sIdx + 1}`,
            priceItemId: s.priceItemId || '',
            code: s.code ?? null,
            priceItemVersion: s.priceItemVersion ?? null,
            vendorId: s.vendorId ?? null,
            vendorName: s.vendorName ?? null,
            name: s.name,
            pricingMode: s.pricingMode,
            rateValue: s.rate ?? 0,
            rateInput:
              s.rate === null || s.rate === undefined ? '' : String(s.rate),
            unit: s.unit || item.unit || 'tờ',
            costSource:
              s.costSource ??
              (s.priceItemId ? LineCostSource.CATALOG : LineCostSource.MANUAL),
            catalogOriginalRate:
              s.catalogOriginalRate ??
              (s.priceItemId ? (s.rate ?? null) : null),
            catalogBatchQuantity: s.catalogBatchQuantity ?? null,
            appliedAt: s.appliedAt ?? null,
            note: s.note ?? null,
          }))
        : undefined;

    const area = item.areaSpec ?? null;
    const hasCustomBillable = Boolean(
      area &&
      area.billableAreaSqm &&
      area.actualAreaSqm &&
      Math.abs(area.billableAreaSqm - area.actualAreaSqm) > 1e-6,
    );

    return {
      id: item.id || `ITEM-${idx + 1}`,
      vendorPriceItemId: item.vendorPriceItemId || '',
      vendorPriceItemCode: item.vendorPriceItemCode ?? null,
      vendorPriceItemVersion: item.vendorPriceItemVersion ?? null,
      name: item.name,
      specification: item.specification || '',
      unit: item.unit || 'sp',
      quantity: item.quantity,
      quantityInput: String(item.quantity),
      vendorCostMode: resolvedCost.vendorCostMode,
      vendorCostValue: resolvedCost.vendorCostValue,
      vendorCostInput: resolvedCost.vendorCostInput,
      baseCostSource: item.baseCostSource,
      baseCatalogOriginalRate:
        item.catalogOriginalRate ??
        (item.vendorPriceItemId && typeof item.baseCostRate === 'number'
          ? item.baseCostRate
          : null),
      baseCatalogBatchQuantity: item.catalogBatchQuantity ?? null,
      priceAppliedAt: item.priceAppliedAt ?? null,
      baseIncludedStages: item.baseIncludedStages
        ? [...item.baseIncludedStages]
        : undefined,
      ...(area
        ? {
            areaMode: area.mode,
            widthMInput:
              area.widthM !== null && area.widthM !== undefined
                ? String(area.widthM)
                : '',
            heightMInput:
              area.heightM !== null && area.heightM !== undefined
                ? String(area.heightM)
                : '',
            sheetsCountInput: String(area.sheetsCount || item.quantity || 1),
            actualAreaInput: String(area.actualAreaSqm),
            billableAreaInput: hasCustomBillable
              ? String(area.billableAreaSqm)
              : '',
            adjustBillableArea: hasCustomBillable,
            areaAdjustmentReason: area.adjustmentReason ?? '',
            customerAreaNote: area.customerAreaNote ?? '',
          }
        : {}),
      ...(mappedStages ? { finishingStages: mappedStages } : {}),
      ambiguousLegacyCost: resolvedCost.ambiguousLegacyCost,
      profitMode: item.profitMode,
      profitScope: item.profitScope,
      profitValue: item.profitInputValue,
      profitInput: String(item.profitInputValue),
    };
  });
}

const PRINTQUOTE_CLIENT_CACHE_TTL_MS = 15_000;

interface PrintQuoteClientCacheEntry {
  fetchRef: typeof fetch;
  coreFetchedAt: number;
  vendors: PrintVendorData[];
  priceItems: PrintVendorPriceItemData[];
  customers: PrintCustomerData[];
  quotes: PrintQuoteData[];
  orders: PrintOrderData[];
  stats: PrintQuoteDashboardStats | null;
  ownerBank: OwnerPaymentBankInfo | null;
  receivablesFetchedAt: number;
  receivablesSummary: ReceivablesLedgerPayload | null;
  payablesFetchedAt: number;
  payablesSummary: PayablesLedgerPayload | null;
  transactionsFetchedAt: number;
  unifiedTransactions: UnifiedPrintLedgerItem[];
  reportsFetchedAt: number;
  financialReport: PrintFinancialReportData | null;
  importBatchesFetchedAt: number;
  importBatches: PrintHistoricalImportBatchData[];
}

const printQuoteClientCache = new Map<string, PrintQuoteClientCacheEntry>();

export function invalidatePrintQuoteClientCache(workspaceKey?: string): void {
  if (!workspaceKey) {
    printQuoteClientCache.clear();
    return;
  }
  printQuoteClientCache.delete(workspaceKey);
}

export interface PrintQuoteScreenProps {
  role: UserRole;
  isOwnerVerified?: boolean | undefined;
  workspaceName?: string | undefined;
  currentPath?: string | undefined;
  routePattern?: string | undefined;
  routeParams?: Record<string, string> | undefined;
  onNavigate?: ((path: string) => void) | undefined;
  initialTab?: PrintQuoteTabId | undefined;
  initialVendors?: PrintVendorData[] | undefined;
  initialPriceItems?: PrintVendorPriceItemData[] | undefined;
  initialCustomers?: PrintCustomerData[] | undefined;
  initialQuotes?: PrintQuoteData[] | undefined;
  initialOrders?: PrintOrderData[] | undefined;
  initialStats?: PrintQuoteDashboardStats | null | undefined;
}

export const PrintQuoteScreen: React.FC<PrintQuoteScreenProps> = ({
  role,
  isOwnerVerified = true,
  workspaceName = 'THIẾT KẾ IN ẤN TOÀN GIA PHÁT',
  currentPath,
  routePattern,
  routeParams,
  onNavigate,
  initialTab,
  initialVendors = [],
  initialPriceItems = [],
  initialCustomers = [],
  initialQuotes = [],
  initialOrders = [],
  initialStats = null,
}) => {
  const [fallbackPath, setFallbackPath] = useState<string>(
    () => currentPath || mapLegacyTabToPath(initialTab),
  );
  const effectivePath = currentPath || fallbackPath;

  const navigateInternal = useCallback(
    (targetPath: string, replace = false) => {
      if (replace && typeof window !== 'undefined') {
        window.history.replaceState(null, '', targetPath);
      }
      if (onNavigate) {
        onNavigate(targetPath);
      } else {
        setFallbackPath(targetPath);
      }
    },
    [onNavigate],
  );

  // Redirect alias /print-quotes/catalog -> /print-quotes/catalog/prices cleanly
  useEffect(() => {
    const clean = effectivePath.split(/[?#]/, 1)[0];
    if (clean === '/print-quotes/catalog') {
      navigateInternal('/print-quotes/catalog/prices', true);
    }
  }, [effectivePath, navigateInternal]);

  const { viewMode, quoteId: activeQuoteId } = useMemo(
    () =>
      resolveViewAndQuoteId(
        effectivePath,
        currentPath ? routePattern : undefined,
        currentPath ? routeParams : undefined,
      ),
    [effectivePath, currentPath, routePattern, routeParams],
  );

  const [loading, setLoading] = useState<boolean>(false);
  const [singleQuoteLoading, setSingleQuoteLoading] = useState<boolean>(false);
  const [savingQuote, setSavingQuote] = useState<boolean>(false);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  useAutoDismiss(
    bannerMessage,
    () => setBannerMessage(null),
    bannerMessage?.type === 'error' ? 5000 : 4000,
  );

  // Data collections
  const [vendors, setVendors] = useState<PrintVendorData[]>(initialVendors);
  const [priceItems, setPriceItems] =
    useState<PrintVendorPriceItemData[]>(initialPriceItems);
  const [customers, setCustomers] =
    useState<PrintCustomerData[]>(initialCustomers);
  const [quotes, setQuotes] = useState<PrintQuoteData[]>(initialQuotes);
  const [orders, setOrders] = useState<PrintOrderData[]>(initialOrders);
  const [stats, setStats] = useState<PrintQuoteDashboardStats | null>(
    initialStats,
  );
  const [ownerBank, setOwnerBank] = useState<OwnerPaymentBankInfo | null>(null);
  const priceItemsRef = useRef<PrintVendorPriceItemData[]>(priceItems);
  priceItemsRef.current = priceItems;
  const [receivablesSummary, setReceivablesSummary] =
    useState<ReceivablesLedgerPayload | null>(null);
  const [payablesSummary, setPayablesSummary] =
    useState<PayablesLedgerPayload | null>(null);
  const [unifiedTransactions, setUnifiedTransactions] = useState<
    UnifiedPrintLedgerItem[]
  >([]);
  const [financialReport, setFinancialReport] =
    useState<PrintFinancialReportData | null>(null);
  const [importBatches, setImportBatches] = useState<
    PrintHistoricalImportBatchData[]
  >([]);

  // Hydrate initial editor state from RAM draft bridge if present, or initial edit quote on SSR/first mount, otherwise clean empty UX V2 state
  const initialDraft = useMemo(() => getPrintQuoteRamDraft(), []);
  const initialEditableQuote = useMemo(() => {
    if (initialDraft || viewMode !== 'edit' || !activeQuoteId) return null;
    const found = initialQuotes.find(
      (q) => q.id === activeQuoteId || q.quote_code === activeQuoteId,
    );
    return found && isQuoteStatusEditable(found.status) ? found : null;
  }, [initialDraft, viewMode, activeQuoteId, initialQuotes]);

  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(
    initialDraft?.editingQuoteId ?? initialEditableQuote?.id ?? null,
  );
  const [editingQuoteCode, setEditingQuoteCode] = useState<string | null>(
    initialDraft?.editingQuoteCode ?? initialEditableQuote?.quote_code ?? null,
  );
  const [editingQuoteVersion, setEditingQuoteVersion] = useState<number>(
    initialDraft?.editingQuoteVersion ??
      initialEditableQuote?.current_version ??
      1,
  );
  const [editorPath, setEditorPath] = useState<string>(
    initialDraft?.editorPath ??
      (initialEditableQuote
        ? `/print-quotes/${encodeURIComponent(initialEditableQuote.id)}/edit`
        : '/print-quotes/new'),
  );
  const [quoteTitle, setQuoteTitle] = useState<string>(
    initialDraft?.quoteTitle ?? initialEditableQuote?.title ?? '',
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    initialDraft?.selectedCustomerId ??
      (initialEditableQuote?.customer_id || ''),
  );
  const [validUntil, setValidUntil] = useState<string>(
    initialDraft?.validUntil ?? (initialEditableQuote?.valid_until || ''),
  );
  const [shippingFee, setShippingFee] = useState<number>(
    initialDraft?.shippingFee ?? initialEditableQuote?.shipping_fee ?? 0,
  );
  const [shippingFeeInput, setShippingFeeInput] = useState<string>(
    initialDraft?.shippingFeeInput ??
      (initialEditableQuote ? String(initialEditableQuote.shipping_fee) : '0'),
  );
  const [includeShippingInUnitPrice, setIncludeShippingInUnitPrice] =
    useState<boolean>(
      initialDraft?.includeShippingInUnitPrice ??
        initialEditableQuote?.include_shipping_in_unit_price ??
        true,
    );
  const [shippingAllocation, setShippingAllocation] =
    useState<ShippingAllocationStrategyType>(
      initialDraft?.shippingAllocation ??
        initialEditableQuote?.shipping_allocation_strategy ??
        ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT,
    );
  const [roundingMode, setRoundingMode] = useState<RoundingModeType>(
    initialDraft?.roundingMode ??
      initialEditableQuote?.rounding_mode ??
      RoundingMode.CEIL,
  );
  const [roundingStep, setRoundingStep] = useState<number>(
    initialDraft?.roundingStep ?? initialEditableQuote?.rounding_step ?? 1,
  );
  const [customerNotes, setCustomerNotes] = useState<string>(
    initialDraft?.customerNotes ??
      (initialEditableQuote?.notes || DEFAULT_CUSTOMER_NOTES),
  );
  const [internalNotes, setInternalNotes] = useState<string>(
    initialDraft?.internalNotes ?? '',
  );
  const [versionChangeNote, setVersionChangeNote] = useState<string>(
    initialDraft?.versionChangeNote ?? '',
  );
  const [draftLines, setDraftLines] = useState<DraftLineState[]>(
    () =>
      initialDraft?.draftLines ??
      (initialEditableQuote
        ? mapQuoteLinesToDraftLines(initialEditableQuote)
        : [EMPTY_DRAFT_LINE(1)]),
  );
  const [hasTouchedFields, setHasTouchedFields] = useState<boolean>(
    initialDraft?.hasTouchedFields ?? Boolean(initialEditableQuote),
  );
  const [isDraftDirty, setIsDraftDirty] = useState<boolean>(
    initialDraft?.isDirty ?? false,
  );

  // Confirmation dialogs for unsaved RAM draft
  const [pendingLeaveAction, setPendingLeaveAction] = useState<
    (() => void) | null
  >(null);
  const [pendingReplaceDraftAction, setPendingReplaceDraftAction] = useState<
    (() => void) | null
  >(null);

  const hydratedEditIdRef = useRef<string | null>(
    initialDraft?.editingQuoteId ?? initialEditableQuote?.id ?? null,
  );
  const internalClearingRef = useRef<boolean>(false);

  const markEditorDirty = useCallback(() => {
    setHasTouchedFields(true);
    setIsDraftDirty(true);
  }, []);

  // Keep pure-RAM draft bridge synchronized (0 storage writes)
  useEffect(() => {
    if (!isDraftDirty && !editingQuoteId && !hasTouchedFields) {
      internalClearingRef.current = true;
      clearPrintQuoteRamDraft();
      internalClearingRef.current = false;
      return;
    }
    setPrintQuoteRamDraft({
      mode: editingQuoteId ? 'edit' : 'new',
      editingQuoteId,
      editingQuoteCode,
      editingQuoteVersion,
      editorPath,
      quoteTitle,
      selectedCustomerId,
      validUntil,
      shippingFee,
      shippingFeeInput,
      includeShippingInUnitPrice,
      shippingAllocation,
      roundingMode,
      roundingStep,
      customerNotes,
      internalNotes,
      versionChangeNote,
      draftLines,
      hasTouchedFields,
      isDirty: isDraftDirty,
    });
  }, [
    isDraftDirty,
    editingQuoteId,
    editingQuoteCode,
    editingQuoteVersion,
    editorPath,
    quoteTitle,
    selectedCustomerId,
    validUntil,
    shippingFee,
    shippingFeeInput,
    includeShippingInUnitPrice,
    shippingAllocation,
    roundingMode,
    roundingStep,
    customerNotes,
    internalNotes,
    versionChangeNote,
    draftLines,
    hasTouchedFields,
  ]);

  // Register cross-module leave interceptor (beforeunload is managed globally in printquote-draft-bridge)
  useEffect(() => {
    registerPrintQuoteLeaveInterceptor((proceed) => {
      setPendingLeaveAction(() => proceed);
    });
    return () => {
      registerPrintQuoteLeaveInterceptor(null);
    };
  }, []);

  // A4 PDF Preview Modal State
  const [pdfPreviewState, setPdfPreviewState] = useState<{
    title: string;
    html: string;
    quoteId?: string | null | undefined;
    quoteCode: string;
  } | null>(null);

  // Expanded Quote Version History ID
  const [expandedQuoteHistoryId, setExpandedQuoteHistoryId] = useState<
    string | null
  >(null);

  // Catalog Dialog Form States
  const [vendorName, setVendorName] = useState<string>('');
  const [vendorPhone, setVendorPhone] = useState<string>('');
  const [vendorBankName, setVendorBankName] = useState<string>('');
  const [vendorBankAccount, setVendorBankAccount] = useState<string>('');

  const [priceVendorId, setPriceVendorId] = useState<string>('');
  const [priceItemName, setPriceItemName] = useState<string>('');
  const [priceSpec, setPriceSpec] = useState<string>('');
  const [priceUnit, setPriceUnit] = useState<string>('tờ');
  const [priceCostMode, setPriceCostMode] = useState<VendorCostModeType>(
    VendorCostMode.PER_UNIT,
  );
  const [priceUnitCost, setPriceUnitCost] = useState<number>(0);
  const [priceBatchCost, setPriceBatchCost] = useState<number>(0);
  const [priceDefaultProfitVal, setPriceDefaultProfitVal] = useState<number>(0);

  const [custName, setCustName] = useState<string>('');
  const [custCompany, setCustCompany] = useState<string>('');
  const [custPhone, setCustPhone] = useState<string>('');
  const [custAddress, setCustAddress] = useState<string>('');

  // Orders Payment Modal State
  const [paymentOrderTarget, setPaymentOrderTarget] =
    useState<PrintOrderData | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentType, setPaymentType] = useState<
    'DEPOSIT' | 'INSTALLMENT' | 'FINAL' | 'REFUND'
  >('INSTALLMENT');
  const [paymentMethod, setPaymentMethod] = useState<string>('BANK_TRANSFER');
  const [paymentNote, setPaymentNote] = useState<string>('');

  const getCsrfToken = useCallback(async (): Promise<string> => {
    try {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (!res.ok) return '';
      const json = await res.json();
      return json?.data?.csrf_token || '';
    } catch {
      return '';
    }
  }, []);

  const cacheKey = workspaceName || 'default';
  const viewModeRef = useRef<PrintQuoteViewMode>(viewMode);
  viewModeRef.current = viewMode;

  const loadDataForView = useCallback(
    async (targetView: PrintQuoteViewMode, force = false) => {
      if (typeof window === 'undefined' || typeof fetch !== 'function') return;
      const currentFetch = fetch;
      const now = Date.now();
      let entry = printQuoteClientCache.get(cacheKey);
      if (entry && entry.fetchRef !== currentFetch) {
        entry = undefined;
      }

      const needCore =
        force ||
        !entry ||
        entry.coreFetchedAt === 0 ||
        now - entry.coreFetchedAt > PRINTQUOTE_CLIENT_CACHE_TTL_MS;
      const needReceivables =
        targetView === 'receivables' &&
        (force ||
          !entry ||
          entry.receivablesFetchedAt === 0 ||
          now - entry.receivablesFetchedAt > PRINTQUOTE_CLIENT_CACHE_TTL_MS);
      const needPayables =
        targetView === 'payables' &&
        (force ||
          !entry ||
          entry.payablesFetchedAt === 0 ||
          now - entry.payablesFetchedAt > PRINTQUOTE_CLIENT_CACHE_TTL_MS);
      const needTransactions =
        targetView === 'transactions' &&
        (force ||
          !entry ||
          entry.transactionsFetchedAt === 0 ||
          now - entry.transactionsFetchedAt > PRINTQUOTE_CLIENT_CACHE_TTL_MS);
      const needReports =
        targetView === 'reports' &&
        (force ||
          !entry ||
          entry.reportsFetchedAt === 0 ||
          now - entry.reportsFetchedAt > PRINTQUOTE_CLIENT_CACHE_TTL_MS);
      const needImportBatches =
        targetView === 'import-history' &&
        (force ||
          !entry ||
          entry.importBatchesFetchedAt === 0 ||
          now - entry.importBatchesFetchedAt > PRINTQUOTE_CLIENT_CACHE_TTL_MS);

      if (entry && !force) {
        if (entry.coreFetchedAt > 0) {
          setVendors(entry.vendors);
          setPriceItems(entry.priceItems);
          setCustomers(entry.customers);
          setQuotes(entry.quotes);
          setOrders(entry.orders);
          setStats(entry.stats);
          setOwnerBank(entry.ownerBank);
        }
        if (entry.receivablesFetchedAt > 0) {
          setReceivablesSummary(entry.receivablesSummary);
        }
        if (entry.payablesFetchedAt > 0) {
          setPayablesSummary(entry.payablesSummary);
        }
        if (entry.transactionsFetchedAt > 0) {
          setUnifiedTransactions(entry.unifiedTransactions);
        }
        if (entry.reportsFetchedAt > 0) {
          setFinancialReport(entry.financialReport);
        }
        if (entry.importBatchesFetchedAt > 0) {
          setImportBatches(entry.importBatches);
        }
      }

      if (
        !needCore &&
        !needReceivables &&
        !needPayables &&
        !needTransactions &&
        !needReports &&
        !needImportBatches
      ) {
        return;
      }

      setLoading(true);
      try {
        const nextEntry: PrintQuoteClientCacheEntry = entry ?? {
          fetchRef: currentFetch,
          coreFetchedAt: 0,
          vendors: [],
          priceItems: [],
          customers: [],
          quotes: [],
          orders: [],
          stats: null,
          ownerBank: null,
          receivablesFetchedAt: 0,
          receivablesSummary: null,
          payablesFetchedAt: 0,
          payablesSummary: null,
          transactionsFetchedAt: 0,
          unifiedTransactions: [],
          reportsFetchedAt: 0,
          financialReport: null,
          importBatchesFetchedAt: 0,
          importBatches: [],
        };

        const tasks: Promise<void>[] = [];

        if (needCore) {
          tasks.push(
            (async () => {
              const [vRes, pRes, cRes, qRes, oRes, sRes, meRes] =
                await Promise.all([
                  currentFetch('/api/v1/print-quotes/vendors', {
                    credentials: 'include',
                  }),
                  currentFetch('/api/v1/print-quotes/price-items', {
                    credentials: 'include',
                  }),
                  currentFetch('/api/v1/print-quotes/customers', {
                    credentials: 'include',
                  }),
                  currentFetch('/api/v1/print-quotes/quotes', {
                    credentials: 'include',
                  }),
                  currentFetch('/api/v1/print-quotes/orders', {
                    credentials: 'include',
                  }),
                  currentFetch('/api/v1/print-quotes/stats', {
                    credentials: 'include',
                  }),
                  currentFetch('/api/v1/employees/me', {
                    credentials: 'include',
                  }).catch(() => null),
                ]);

              if (vRes.ok) {
                const j = await vRes.json();
                const items = j?.data?.items || [];
                nextEntry.vendors = items;
                setVendors(items);
              }
              if (pRes.ok) {
                const j = await pRes.json();
                const items = j?.data?.items || [];
                nextEntry.priceItems = items;
                setPriceItems(items);
              }
              if (cRes.ok) {
                const j = await cRes.json();
                const items = j?.data?.items || [];
                nextEntry.customers = items;
                setCustomers(items);
              }
              if (qRes.ok) {
                const j = await qRes.json();
                const items = j?.data?.items || [];
                nextEntry.quotes = items;
                setQuotes(items);
              }
              if (oRes.ok) {
                const j = await oRes.json();
                const items = j?.data?.items || [];
                nextEntry.orders = items;
                setOrders(items);
              }
              if (sRes.ok) {
                const j = await sRes.json();
                const data = j?.data || null;
                nextEntry.stats = data;
                setStats(data);
              }
              if (meRes && meRes.ok) {
                const j = await meRes.json().catch(() => null);
                const emp = j?.data;
                const bName =
                  typeof emp?.bank_name === 'string'
                    ? emp.bank_name.trim()
                    : '';
                const bAcc =
                  typeof emp?.bank_account_number === 'string'
                    ? emp.bank_account_number.trim()
                    : '';
                const bHolder =
                  typeof emp?.bank_account_holder === 'string' &&
                  emp.bank_account_holder.trim()
                    ? emp.bank_account_holder.trim()
                    : typeof emp?.full_name === 'string'
                      ? emp.full_name.trim()
                      : null;
                const resolvedBank =
                  bName && bAcc
                    ? {
                        bankName: bName,
                        bankAccountNumber: bAcc,
                        bankAccountHolder: bHolder,
                      }
                    : null;
                nextEntry.ownerBank = resolvedBank;
                setOwnerBank(resolvedBank);
              }
              nextEntry.coreFetchedAt = Date.now();
            })(),
          );
        }

        if (needReceivables) {
          tasks.push(
            (async () => {
              const arRes = await currentFetch(
                '/api/v1/print-quotes/receivables',
                { credentials: 'include' },
              );
              if (arRes.ok) {
                const j = await arRes.json();
                const val =
                  j?.data && Array.isArray(j.data.summaries) ? j.data : null;
                nextEntry.receivablesSummary = val;
                nextEntry.receivablesFetchedAt = Date.now();
                setReceivablesSummary(val);
              }
            })(),
          );
        }

        if (needPayables) {
          tasks.push(
            (async () => {
              const apRes = await currentFetch(
                '/api/v1/print-quotes/payables',
                { credentials: 'include' },
              );
              if (apRes.ok) {
                const j = await apRes.json();
                const val =
                  j?.data && Array.isArray(j.data.summaries) ? j.data : null;
                nextEntry.payablesSummary = val;
                nextEntry.payablesFetchedAt = Date.now();
                setPayablesSummary(val);
              }
            })(),
          );
        }

        if (needTransactions) {
          tasks.push(
            (async () => {
              const txRes = await currentFetch(
                '/api/v1/print-quotes/transactions',
                { credentials: 'include' },
              );
              if (txRes.ok) {
                const j = await txRes.json();
                const val = Array.isArray(j?.data?.items) ? j.data.items : [];
                nextEntry.unifiedTransactions = val;
                nextEntry.transactionsFetchedAt = Date.now();
                setUnifiedTransactions(val);
              }
            })(),
          );
        }

        if (needReports) {
          tasks.push(
            (async () => {
              const frRes = await currentFetch(
                '/api/v1/print-quotes/financial-report',
                { credentials: 'include' },
              );
              if (frRes.ok) {
                const j = await frRes.json();
                const val =
                  j?.data && j.data.reconciled && j.data.cashflow_and_debt
                    ? j.data
                    : null;
                nextEntry.financialReport = val;
                nextEntry.reportsFetchedAt = Date.now();
                setFinancialReport(val);
              }
            })(),
          );
        }

        if (needImportBatches) {
          tasks.push(
            (async () => {
              const imRes = await currentFetch(
                '/api/v1/print-quotes/import-history/batches',
                { credentials: 'include' },
              );
              if (imRes.ok) {
                const j = await imRes.json();
                const val = Array.isArray(j?.data?.items) ? j.data.items : [];
                nextEntry.importBatches = val;
                nextEntry.importBatchesFetchedAt = Date.now();
                setImportBatches(val);
              }
            })(),
          );
        }

        await Promise.all(tasks);
        printQuoteClientCache.set(cacheKey, nextEntry);
      } catch {
        // Ignore fetch errors in offline/SSR test environments
      } finally {
        setLoading(false);
      }
    },
    [cacheKey],
  );

  const loadAllData = useCallback(async () => {
    invalidatePrintQuoteClientCache(cacheKey);
    await loadDataForView(viewModeRef.current, true);
  }, [cacheKey, loadDataForView]);

  const handleMutateLedger = useCallback(
    async (
      endpoint: string,
      body: Record<string, unknown>,
      method: 'POST' | 'PATCH' = 'POST',
    ): Promise<{
      ok: boolean;
      error?: string;
      code?: string;
      data?: unknown;
    }> => {
      try {
        const csrf = await getCsrfToken();
        const idemKey = `pq-fin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const res = await fetch(endpoint, {
          method,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
            'Idempotency-Key': idemKey,
          },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            ok: false,
            error: json?.error?.message || 'Thao tác sổ công nợ thất bại.',
            code: json?.error?.code,
          };
        }
        setBannerMessage({
          type: 'success',
          text: 'Đã cập nhật sổ công nợ & tài chính in ấn.',
        });
        await loadAllData();
        return { ok: true, data: json?.data };
      } catch {
        return { ok: false, error: 'Lỗi kết nối máy chủ.' };
      }
    },
    [getCsrfToken, loadAllData],
  );

  useEffect(() => {
    void loadDataForView(viewMode, false);
  }, [viewMode, loadDataForView]);

  const activeQuote = useMemo(() => {
    if (!activeQuoteId) return null;
    return (
      quotes.find(
        (q) => q.id === activeQuoteId || q.quote_code === activeQuoteId,
      ) || null
    );
  }, [quotes, activeQuoteId]);

  // Direct URL / F5 refresh single-quote fetch fallback
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      (viewMode !== 'detail' && viewMode !== 'edit') ||
      !activeQuoteId ||
      activeQuote
    ) {
      return;
    }
    let cancelled = false;
    const fetchSingleQuote = async () => {
      setSingleQuoteLoading(true);
      try {
        const res = await fetch(
          `/api/v1/print-quotes/quotes/${encodeURIComponent(activeQuoteId)}`,
          { credentials: 'include' },
        );
        if (!res.ok || cancelled) return;
        const json = await res.json().catch(() => null);
        const item: PrintQuoteData | undefined = json?.data;
        if (item && item.id && !cancelled) {
          setQuotes((prev) =>
            prev.some((q) => q.id === item.id) ? prev : [item, ...prev],
          );
        }
      } catch {
        // Ignore single fetch error
      } finally {
        if (!cancelled) {
          setSingleQuoteLoading(false);
        }
      }
    };
    void fetchSingleQuote();
    return () => {
      cancelled = true;
    };
  }, [viewMode, activeQuoteId, activeQuote]);

  const applyQuoteIntoEditor = useCallback(
    (quote: PrintQuoteData, asClone: boolean) => {
      if (asClone) {
        hydratedEditIdRef.current = null;
        setEditingQuoteId(null);
        setEditingQuoteCode(null);
        setEditingQuoteVersion(1);
        setEditorPath('/print-quotes/new');
        setQuoteTitle(quote.title ? `${quote.title} (Bản mới)` : '');
        setIsDraftDirty(true);
        setHasTouchedFields(true);
      } else {
        hydratedEditIdRef.current = quote.id;
        setEditingQuoteId(quote.id);
        setEditingQuoteCode(quote.quote_code);
        setEditingQuoteVersion(quote.current_version);
        setEditorPath(`/print-quotes/${encodeURIComponent(quote.id)}/edit`);
        setQuoteTitle(quote.title);
        setIsDraftDirty(false);
        setHasTouchedFields(true);
      }
      setSelectedCustomerId(quote.customer_id || '');
      setValidUntil(quote.valid_until || '');
      setShippingFee(quote.shipping_fee);
      setShippingFeeInput(String(quote.shipping_fee));
      setIncludeShippingInUnitPrice(quote.include_shipping_in_unit_price);
      setShippingAllocation(quote.shipping_allocation_strategy);
      setRoundingMode(quote.rounding_mode);
      setRoundingStep(quote.rounding_step);
      setCustomerNotes(quote.notes || DEFAULT_CUSTOMER_NOTES);
      setInternalNotes('');
      setVersionChangeNote('');
      const mappedLines = mapQuoteLinesToDraftLines(quote);
      if (asClone) {
        const { lines: refreshedLines, updatedCount } =
          refreshClonedLinesFromCatalog(mappedLines, priceItemsRef.current);
        setDraftLines(refreshedLines);
        return updatedCount;
      }
      setDraftLines(mappedLines);
      return 0;
    },
    [],
  );

  // Hydrate /print-quotes/:id/edit automatically when navigating directly via URL
  useEffect(() => {
    if (viewMode !== 'edit' || !activeQuote) return;
    if (!isQuoteStatusEditable(activeQuote.status)) return;
    if (
      hydratedEditIdRef.current === activeQuote.id &&
      editingQuoteId === activeQuote.id
    ) {
      return;
    }
    if (isDraftDirty && editingQuoteId !== activeQuote.id) {
      return;
    }
    applyQuoteIntoEditor(activeQuote, false);
  }, [
    viewMode,
    activeQuote,
    editingQuoteId,
    isDraftDirty,
    applyQuoteIntoEditor,
  ]);

  const resetCleanNewDraft = useCallback(() => {
    hydratedEditIdRef.current = null;
    setEditingQuoteId(null);
    setEditingQuoteCode(null);
    setEditingQuoteVersion(1);
    setEditorPath('/print-quotes/new');
    setQuoteTitle('');
    setSelectedCustomerId('');
    setValidUntil('');
    setShippingFee(0);
    setShippingFeeInput('0');
    setIncludeShippingInUnitPrice(true);
    setShippingAllocation(
      ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT,
    );
    setRoundingMode(RoundingMode.CEIL);
    setRoundingStep(1);
    setCustomerNotes(DEFAULT_CUSTOMER_NOTES);
    setInternalNotes('');
    setVersionChangeNote('');
    setDraftLines([EMPTY_DRAFT_LINE(1)]);
    setHasTouchedFields(false);
    setIsDraftDirty(false);
    internalClearingRef.current = true;
    clearPrintQuoteRamDraft();
    internalClearingRef.current = false;
  }, []);

  // Sync local draft state if RAM draft is cleared externally (e.g. root fallback guard or session expiry)
  useEffect(() => {
    return subscribePrintQuoteDraft(() => {
      if (internalClearingRef.current) return;
      if (getPrintQuoteRamDraft() === null) {
        resetCleanNewDraft();
      }
    });
  }, [resetCleanNewDraft]);

  const runWithDraftReplaceGuard = useCallback(
    (shouldGuard: boolean, action: () => void) => {
      if (shouldGuard && isDraftDirty) {
        setPendingReplaceDraftAction(() => action);
        return;
      }
      action();
    },
    [isDraftDirty],
  );

  // When entering /print-quotes/new while editor was previously holding a clean (non-dirty) edit state, reset cleanly
  useEffect(() => {
    if (viewMode === 'new' && editingQuoteId && !isDraftDirty) {
      resetCleanNewDraft();
    }
  }, [viewMode, editingQuoteId, isDraftDirty, resetCleanNewDraft]);

  // Live Pricing Engine Calculation
  const livePricingResult = useMemo<{
    calc: ReturnType<typeof calculatePrintQuote> | null;
    customerPdf: ReturnType<typeof buildCustomerSafePdfPayload> | null;
    error: string | null;
    canSavePendingDraft: boolean;
    isPendingCost: boolean;
    pendingSummary: PendingCostLineSummary[];
    structuralErrors: string[];
    validationErrors: string[];
    lineErrors: Record<string, DraftLineValidationError>;
    shippingError: string | null;
  }>(() => {
    const validation = validateQuoteDraftInputs(
      draftLines,
      shippingFeeInput,
      priceItems,
    );
    if (!validation.isValid) {
      return {
        calc: null,
        customerPdf: null,
        error:
          validation.errors[0] ||
          'Vui lòng nhập đầy đủ số lượng và đơn giá hợp lệ.',
        canSavePendingDraft: validation.canSavePendingDraft,
        isPendingCost: validation.isPendingCost,
        pendingSummary: validation.pendingSummary,
        structuralErrors: validation.structuralErrors,
        validationErrors: validation.errors,
        lineErrors: validation.lineErrors,
        shippingError: validation.shippingError,
      };
    }

    try {
      const itemsInput: QuoteLineInput[] = draftLines.map((line, idx) => {
        const validLine = validation.lines[idx] ?? {
          quantity: line.quantity,
          vendorCostValue: line.vendorCostValue,
          baseCostRate: line.vendorCostValue,
          profitValue: line.profitValue,
          areaSpec: null,
          stages: [],
        };
        const costVal = validLine.vendorCostValue;
        const stages = line.finishingStages ?? [];
        const hasExtendedFeatures =
          stages.length > 0 ||
          validLine.areaSpec !== null ||
          line.vendorCostMode === VendorCostMode.PER_SQM ||
          (line.profitMode === ProfitMode.FIXED_AMOUNT &&
            line.profitScope === ProfitScope.PER_SQM) ||
          (line.baseIncludedStages?.length ?? 0) > 0 ||
          Boolean(line.baseCostSource);

        const baseLine: QuoteLineInput = {
          id: line.id || `ITEM-${idx + 1}`,
          name: line.name.trim() || `Sản phẩm #${idx + 1}`,
          specification: line.specification.trim(),
          vendorPriceItemId: line.vendorPriceItemId || undefined,
          vendorPriceItemCode: line.vendorPriceItemCode ?? undefined,
          vendorPriceItemVersion: line.vendorPriceItemVersion ?? undefined,
          catalogOriginalRate: line.baseCatalogOriginalRate ?? undefined,
          catalogBatchQuantity: line.baseCatalogBatchQuantity ?? undefined,
          priceAppliedAt: line.priceAppliedAt ?? undefined,
          unit: line.unit.trim() || 'tờ',
          quantity: validLine.quantity,
          profit: {
            mode: line.profitMode,
            scope: line.profitScope,
            value: validLine.profitValue,
          },
        };

        if (hasExtendedFeatures) {
          const mappedStages: QuoteFinishingStageInput[] = stages.map(
            (s, sIdx) => ({
              id: s.id || `STG-${idx + 1}-${sIdx + 1}`,
              priceItemId: s.priceItemId || null,
              code: s.code ?? null,
              priceItemVersion: s.priceItemVersion ?? null,
              vendorId: s.vendorId ?? null,
              vendorName: s.vendorName ?? null,
              name: s.name.trim() || `Gia công #${sIdx + 1}`,
              pricingMode: s.pricingMode,
              rate: validLine.stages[sIdx]?.rate ?? s.rateValue,
              unit: s.unit || line.unit || 'tờ',
              costSource: s.costSource,
              catalogOriginalRate: s.catalogOriginalRate ?? null,
              catalogBatchQuantity: s.catalogBatchQuantity ?? null,
              appliedAt: s.appliedAt ?? null,
              note: s.note ?? null,
            }),
          );
          baseLine.vendorCostMode = line.vendorCostMode;
          baseLine.baseCostRate = costVal;
          baseLine.baseCostSource = line.baseCostSource;
          baseLine.baseIncludedStages = line.baseIncludedStages;
          baseLine.areaSpec = validLine.areaSpec;
          baseLine.finishingStages = mappedStages;
        } else if (line.vendorCostMode === VendorCostMode.TOTAL_BATCH) {
          baseLine.totalVendorCost = costVal;
        } else {
          baseLine.unitVendorCost = costVal;
        }
        return baseLine;
      });

      const calc = calculatePrintQuote({
        items: itemsInput,
        shippingFee: validation.shippingFee,
        includeShippingInUnitPrice,
        shippingAllocationStrategy: shippingAllocation,
        roundingPolicy: {
          mode: roundingMode,
          step: Math.max(1, Math.round(Number(roundingStep) || 1)),
        },
        requireAreaAdjustmentReason: true,
      });
      const customerPdf = buildCustomerSafePdfPayload(calc);
      return {
        calc,
        customerPdf,
        error: null,
        canSavePendingDraft: false,
        isPendingCost: false,
        pendingSummary: [],
        structuralErrors: [],
        validationErrors: [],
        lineErrors: {},
        shippingError: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi tính toán báo giá';
      return {
        calc: null,
        customerPdf: null,
        error: msg,
        canSavePendingDraft: false,
        isPendingCost: false,
        pendingSummary: [],
        structuralErrors: [msg],
        validationErrors: [msg],
        lineErrors: {},
        shippingError: null,
      };
    }
  }, [
    draftLines,
    shippingFeeInput,
    priceItems,
    includeShippingInUnitPrice,
    shippingAllocation,
    roundingMode,
    roundingStep,
  ]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId],
  );

  const handleSelectCatalogItem = (
    lineIndex: number,
    catalogItemId: string,
  ) => {
    markEditorDirty();
    const found = priceItems.find((p) => p.id === catalogItemId);
    setDraftLines((prev) =>
      prev.map((line, idx) => {
        if (idx !== lineIndex) return line;
        if (!found) {
          return {
            ...line,
            vendorPriceItemId: '',
            vendorPriceItemCode: null,
            vendorPriceItemVersion: null,
            baseCostSource: LineCostSource.MANUAL,
            baseCatalogOriginalRate: null,
            baseCatalogBatchQuantity: null,
            priceAppliedAt: null,
            baseIncludedStages: undefined,
          };
        }
        const resolvedCost =
          found.pricing_mode === VendorCostMode.TOTAL_BATCH
            ? found.batch_total_cost
            : found.unit_cost;
        return {
          ...line,
          vendorPriceItemId: found.id,
          vendorPriceItemCode: found.code,
          vendorPriceItemVersion: found.version,
          name: found.name,
          specification: found.specification || '',
          unit: found.unit || 'tờ',
          // Preserve user's typed quantity or keep empty "" so user enters real order quantity
          quantityInput:
            line.quantityInput !== undefined ? line.quantityInput : '',
          vendorCostMode: found.pricing_mode,
          vendorCostValue: resolvedCost,
          vendorCostInput: String(resolvedCost),
          baseCostSource: LineCostSource.CATALOG,
          baseCatalogOriginalRate: resolvedCost,
          baseCatalogBatchQuantity: found.batch_quantity ?? 1,
          priceAppliedAt: new Date().toISOString(),
          baseIncludedStages: found.included_stages?.length
            ? [...found.included_stages]
            : undefined,
          ...(found.pricing_mode === VendorCostMode.PER_SQM
            ? { areaMode: line.areaMode ?? AreaInputMode.DIMENSIONS }
            : {}),
          ambiguousLegacyCost: null,
          profitMode: found.default_profit_mode,
          profitScope: found.default_profit_scope,
          profitValue: found.default_profit_value,
          profitInput: String(found.default_profit_value),
        };
      }),
    );
  };

  const handleOpenLiveA4Preview = () => {
    setHasTouchedFields(true);
    const validation = validateQuoteDraftInputs(
      draftLines,
      shippingFeeInput,
      priceItems,
    );
    if (!validation.isValid || !livePricingResult.customerPdf) {
      setBannerMessage({
        type: 'error',
        text:
          validation.errors[0] ||
          livePricingResult.error ||
          'Vui lòng nhập đầy đủ số lượng và đơn giá hợp lệ trước khi xem trước PDF.',
      });
      return;
    }
    const itemSpecs: Record<
      string,
      { specification?: string | undefined; unit?: string | undefined }
    > = {};
    for (const line of draftLines) {
      itemSpecs[line.id] = {
        specification: line.specification,
        unit: line.unit,
      };
    }

    const html = buildPrintQuoteA4Html(livePricingResult.customerPdf, {
      quoteCode: editingQuoteCode || 'BG-PREVIEW',
      quoteTitle: quoteTitle.trim() || 'Báo giá in ấn',
      versionNo: editingQuoteVersion,
      createdAt: new Date().toISOString(),
      validUntil: validUntil || null,
      workspaceName,
      customerName: selectedCustomer?.name || 'Quý khách hàng',
      customerCompany: selectedCustomer?.company_name || null,
      customerPhone: selectedCustomer?.phone || null,
      customerEmail: selectedCustomer?.email || null,
      customerAddress: selectedCustomer?.address || null,
      customerNotes,
      itemSpecifications: itemSpecs,
      paymentBank: ownerBank,
    });

    setPdfPreviewState({
      title: `Xem trước PDF A4 — ${editingQuoteCode || 'Bản xem trước'}`,
      html,
      quoteId: editingQuoteId,
      quoteCode: editingQuoteCode || 'BG-PREVIEW',
    });
  };

  const handleOpenSavedQuotePdf = (quote: PrintQuoteData) => {
    const rawPdf = quote.customer_pdf_json;
    if (!rawPdf || quote.pricing_status === QuotePricingStatus.PENDING_COST) {
      setBannerMessage({
        type: 'error',
        text: 'Báo giá đang ở trạng thái "Chờ giá xưởng" — vui lòng nhập đủ giá vốn trước khi xem/xuất PDF gửi khách.',
      });
      return;
    }
    const safePdf = enrichCustomerSafePdfWithAreaBounds(
      rawPdf,
      quote.lines_json,
    );
    const cust = customers.find((c) => c.id === quote.customer_id);

    const html = buildPrintQuoteA4Html(safePdf, {
      quoteCode: quote.quote_code,
      quoteTitle: quote.title,
      versionNo: quote.current_version,
      createdAt: quote.created_at,
      validUntil: quote.valid_until,
      workspaceName,
      customerName: quote.customer_name || cust?.name || 'Quý khách hàng',
      customerCompany: cust?.company_name || null,
      customerPhone: quote.customer_phone || cust?.phone || null,
      customerEmail: cust?.email || null,
      customerAddress: quote.customer_address || cust?.address || null,
      customerNotes: quote.notes,
      paymentBank: ownerBank,
    });

    setPdfPreviewState({
      title: `Báo giá PDF A4 — ${quote.quote_code} (v${quote.current_version})`,
      html,
      quoteId: quote.id,
      quoteCode: quote.quote_code,
    });
  };

  const triggerBrowserPdfDownload = (blob: Blob, quoteCode: string) => {
    if (typeof window === 'undefined') return;
    const safeName = `${(quoteCode || 'BG-DRAFT').replace(/[^A-Za-z0-9_.-]/g, '-')}.pdf`;
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 3000);
  };

  const handleDownloadSavedQuotePdfFile = async (
    quoteId: string,
    quoteCode: string,
  ) => {
    try {
      const res = await fetch(
        `/api/v1/print-quotes/quotes/${encodeURIComponent(quoteId)}/pdf-file`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        setBannerMessage({
          type: 'error',
          text: 'Không thể tải file PDF báo giá.',
        });
        return;
      }
      const blob = await res.blob();
      triggerBrowserPdfDownload(blob, quoteCode);
      setBannerMessage({
        type: 'success',
        text: `Đã tải xuống file báo giá ${quoteCode}.pdf!`,
      });
    } catch {
      setBannerMessage({
        type: 'error',
        text: 'Lỗi kết nối khi tải file PDF.',
      });
    }
  };

  const handleDownloadLivePdfFile = async () => {
    setHasTouchedFields(true);
    const validation = validateQuoteDraftInputs(
      draftLines,
      shippingFeeInput,
      priceItems,
    );
    if (!validation.isValid || !livePricingResult.customerPdf) {
      setBannerMessage({
        type: 'error',
        text:
          validation.errors[0] ||
          livePricingResult.error ||
          'Vui lòng nhập đầy đủ số lượng và đơn giá hợp lệ trước khi tải PDF.',
      });
      return;
    }
    if (editingQuoteId && editingQuoteCode && !isDraftDirty) {
      await handleDownloadSavedQuotePdfFile(editingQuoteId, editingQuoteCode);
      return;
    }
    try {
      const csrf = await getCsrfToken();
      const code = editingQuoteCode || 'BG-DRAFT';
      const res = await fetch('/api/v1/print-quotes/pdf-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
        },
        credentials: 'include',
        body: JSON.stringify({
          customer_pdf: livePricingResult.customerPdf,
          meta: {
            quoteCode: code,
            quoteTitle: quoteTitle.trim() || 'Báo giá in ấn',
            versionNo: editingQuoteVersion,
            createdAt: new Date().toISOString(),
            validUntil: validUntil || null,
            workspaceName,
            customerName: selectedCustomer?.name || 'Quý khách hàng',
            customerCompany: selectedCustomer?.company_name || null,
            customerPhone: selectedCustomer?.phone || null,
            customerEmail: selectedCustomer?.email || null,
            customerAddress: selectedCustomer?.address || null,
            customerNotes,
          },
        }),
      });
      if (!res.ok) {
        setBannerMessage({
          type: 'error',
          text: 'Không thể tạo file PDF báo giá.',
        });
        return;
      }
      const blob = await res.blob();
      triggerBrowserPdfDownload(blob, code);
      setBannerMessage({
        type: 'success',
        text: `Đã tải xuống file báo giá ${code}.pdf!`,
      });
    } catch {
      setBannerMessage({
        type: 'error',
        text: 'Lỗi kết nối khi tạo file PDF.',
      });
    }
  };

  const handlePrintA4Window = (html: string) => {
    if (typeof window === 'undefined') return;
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) {
      setBannerMessage({
        type: 'error',
        text: 'Trình duyệt đã chặn cửa sổ bật lên (Pop-up). Vui lòng cho phép mở cửa sổ để in PDF A4.',
      });
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  const performSaveQuote = async (allowPendingCost: boolean) => {
    setHasTouchedFields(true);
    const validation = validateQuoteDraftInputs(
      draftLines,
      shippingFeeInput,
      priceItems,
    );
    const isPendingSave = Boolean(
      allowPendingCost &&
      !validation.isValid &&
      validation.canSavePendingDraft &&
      validation.isPendingCost,
    );

    if (!isPendingSave && (!validation.isValid || !livePricingResult.calc)) {
      setBannerMessage({
        type: 'error',
        text:
          validation.errors[0] ||
          livePricingResult.error ||
          'Vui lòng nhập đầy đủ số lượng và đơn giá hợp lệ trước khi lưu báo giá.',
      });
      return;
    }

    setSavingQuote(true);
    setBannerMessage(null);
    setShippingFee(validation.shippingFee);
    setShippingFeeInput(String(validation.shippingFee));
    setDraftLines((prev) =>
      prev.map((line, i) => {
        const validLine = validation.lines[i];
        if (!validLine) return line;
        return {
          ...line,
          quantity: validLine.quantity,
          quantityInput: String(validLine.quantity),
          vendorCostValue: validLine.vendorCostValue,
          vendorCostInput:
            validLine.baseCostRate === null
              ? ''
              : String(validLine.vendorCostValue),
          profitValue: validLine.profitValue,
          profitInput:
            line.profitInput !== undefined && line.profitInput.trim() === ''
              ? ''
              : String(validLine.profitValue),
        };
      }),
    );

    const firstProductName = draftLines[0]?.name.trim() || '';
    const resolvedTitle =
      quoteTitle.trim() ||
      (firstProductName ? `Báo giá ${firstProductName}` : 'Báo giá in ấn');

    const csrf = await getCsrfToken();
    const payload = {
      customer_id: selectedCustomerId || null,
      title: resolvedTitle,
      ...(isPendingSave
        ? { pricing_status: QuotePricingStatus.PENDING_COST }
        : {}),
      shipping_fee: validation.shippingFee,
      include_shipping_in_unit_price: includeShippingInUnitPrice,
      shipping_allocation_strategy: shippingAllocation,
      rounding_mode: roundingMode,
      rounding_step: Math.max(1, Math.round(Number(roundingStep) || 1)),
      valid_until: validUntil || null,
      notes: customerNotes || null,
      change_note:
        versionChangeNote.trim() ||
        internalNotes.trim() ||
        (editingQuoteId
          ? `Cập nhật phiên bản v${editingQuoteVersion + 1}`
          : isPendingSave
            ? 'Lưu nháp chờ giá xưởng'
            : 'Khởi tạo báo giá v1'),
      items: draftLines.map((line, i) => {
        const validLine = validation.lines[i] ?? {
          quantity: line.quantity,
          vendorCostValue: line.vendorCostValue,
          baseCostRate: line.vendorCostValue,
          profitValue: line.profitValue,
          areaSpec: null,
          stages: [],
        };
        const costVal = validLine.vendorCostValue;
        const legacyAmbiguous = line.ambiguousLegacyCost;
        const stages = line.finishingStages ?? [];
        const hasExtendedFeatures =
          isPendingSave ||
          stages.length > 0 ||
          validLine.areaSpec !== null ||
          line.vendorCostMode === VendorCostMode.PER_SQM ||
          (line.profitMode === ProfitMode.FIXED_AMOUNT &&
            line.profitScope === ProfitScope.PER_SQM) ||
          (line.baseIncludedStages?.length ?? 0) > 0 ||
          line.baseCostSource === LineCostSource.CATALOG_OVERRIDDEN;

        if (hasExtendedFeatures) {
          return {
            id: line.id || `ITEM-${i + 1}`,
            vendor_price_item_id: line.vendorPriceItemId || undefined,
            vendorPriceItemCode: line.vendorPriceItemCode ?? undefined,
            vendorPriceItemVersion: line.vendorPriceItemVersion ?? undefined,
            catalogOriginalRate: line.baseCatalogOriginalRate ?? undefined,
            catalogBatchQuantity: line.baseCatalogBatchQuantity ?? undefined,
            priceAppliedAt: line.priceAppliedAt ?? undefined,
            name: line.name.trim() || `Ấn phẩm #${i + 1}`,
            specification: line.specification.trim() || undefined,
            unit: line.unit.trim() || 'tờ',
            quantity: validLine.quantity,
            vendorCostMode: line.vendorCostMode,
            baseCostRate: validLine.baseCostRate,
            baseCostPending: validLine.baseCostRate === null,
            baseCostSource: line.baseCostSource,
            baseIncludedStages: line.baseIncludedStages,
            areaSpec: validLine.areaSpec,
            finishingStages: stages.map((s, sIdx) => {
              const stageRate = validLine.stages[sIdx]?.rate ?? null;
              return {
                id: s.id || `STG-${i + 1}-${sIdx + 1}`,
                priceItemId: s.priceItemId || null,
                code: s.code ?? null,
                priceItemVersion: s.priceItemVersion ?? null,
                vendorId: s.vendorId ?? null,
                vendorName: s.vendorName ?? null,
                name: s.name.trim() || `Gia công #${sIdx + 1}`,
                pricingMode: s.pricingMode,
                rate: stageRate,
                ratePending: stageRate === null,
                unit: s.unit || line.unit || 'tờ',
                costSource: s.costSource,
                catalogOriginalRate: s.catalogOriginalRate ?? null,
                catalogBatchQuantity: s.catalogBatchQuantity ?? null,
                appliedAt: s.appliedAt ?? null,
                note: s.note ?? null,
              };
            }),
            profitMode: line.profitMode,
            profitScope: line.profitScope,
            profitValue: validLine.profitValue,
          };
        }

        return {
          id: line.id || `ITEM-${i + 1}`,
          vendor_price_item_id: line.vendorPriceItemId || undefined,
          name: line.name.trim() || `Ấn phẩm #${i + 1}`,
          specification: line.specification.trim() || undefined,
          unit: line.unit.trim() || 'tờ',
          quantity: validLine.quantity,
          vendorCostMode: legacyAmbiguous ? undefined : line.vendorCostMode,
          unitVendorCost: legacyAmbiguous
            ? legacyAmbiguous.unitVendorCost
            : line.vendorCostMode === VendorCostMode.PER_UNIT
              ? costVal
              : undefined,
          totalVendorCost: legacyAmbiguous
            ? legacyAmbiguous.totalVendorCost
            : line.vendorCostMode === VendorCostMode.TOTAL_BATCH
              ? costVal
              : undefined,
          profitMode: line.profitMode,
          profitScope: line.profitScope,
          profitValue: validLine.profitValue,
        };
      }),
    };

    try {
      const url = editingQuoteId
        ? `/api/v1/print-quotes/quotes/${encodeURIComponent(editingQuoteId)}`
        : '/api/v1/print-quotes/quotes';
      const method = editingQuoteId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
          'Idempotency-Key': `quote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        clearPrintQuoteRamDraft();
        setIsDraftDirty(false);
        setBannerMessage({
          type: 'error',
          text: 'Phiên làm việc đã hết hạn — bản nháp trong bộ nhớ tạm đã được xóa để bảo mật. Vui lòng đăng nhập lại.',
        });
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data) {
        setBannerMessage({
          type: 'error',
          text: json?.error?.message || 'Không thể lưu báo giá.',
        });
        return;
      }
      const saved: PrintQuoteData = json.data;
      setQuotes((prev) => {
        const exists = prev.some((q) => q.id === saved.id);
        return exists
          ? prev.map((q) => (q.id === saved.id ? saved : q))
          : [saved, ...prev];
      });
      resetCleanNewDraft();
      setBannerMessage({
        type: 'success',
        text:
          saved.pricing_status === QuotePricingStatus.PENDING_COST
            ? `Đã lưu nháp Chờ giá xưởng ${saved.quote_code} (v${saved.current_version})!`
            : `Đã lưu thành công báo giá ${saved.quote_code} (Phiên bản v${saved.current_version})!`,
      });
      navigateInternal(`/print-quotes/${encodeURIComponent(saved.id)}`);
      void loadAllData();
    } catch {
      setBannerMessage({
        type: 'error',
        text: 'Lỗi kết nối máy chủ khi lưu báo giá.',
      });
    } finally {
      setSavingQuote(false);
    }
  };

  const handleSaveQuote = async () => {
    await performSaveQuote(false);
  };

  const handleSavePendingDraftQuote = async () => {
    await performSaveQuote(true);
  };

  const handleStartNewQuote = () => {
    // If user already has an unsaved 'new' draft, resume it directly
    if (isDraftDirty && !editingQuoteId) {
      setEditorPath('/print-quotes/new');
      navigateInternal('/print-quotes/new');
      return;
    }
    runWithDraftReplaceGuard(Boolean(editingQuoteId), () => {
      resetCleanNewDraft();
      setBannerMessage(null);
      navigateInternal('/print-quotes/new');
    });
  };

  const handleLoadQuoteForEdit = (quote: PrintQuoteData) => {
    if (!isQuoteStatusEditable(quote.status)) {
      handleCloneQuoteAsNew(quote);
      return;
    }
    runWithDraftReplaceGuard(editingQuoteId !== quote.id, () => {
      applyQuoteIntoEditor(quote, false);
      setBannerMessage(null);
      navigateInternal(`/print-quotes/${encodeURIComponent(quote.id)}/edit`);
    });
  };

  const handleCloneQuoteAsNew = (quote: PrintQuoteData) => {
    runWithDraftReplaceGuard(true, () => {
      const updatedCount = applyQuoteIntoEditor(quote, true);
      setBannerMessage({
        type: 'success',
        text:
          updatedCount > 0
            ? `Đã nhân bản từ ${quote.quote_code} và làm mới ${updatedCount} mức giá xưởng theo bảng giá mới nhất.`
            : `Đã sao chép dữ liệu từ ${quote.quote_code} sang bản báo giá mới.`,
      });
      navigateInternal('/print-quotes/new');
    });
  };

  const handleFinalizeQuote = async (quoteId: string) => {
    const csrf = await getCsrfToken();
    const res = await fetch(
      `/api/v1/print-quotes/quotes/${encodeURIComponent(quoteId)}/finalize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        credentials: 'include',
        body: JSON.stringify({}),
      },
    );
    if (res.ok) {
      setBannerMessage({
        type: 'success',
        text: 'Đã chốt khóa báo giá thành công!',
      });
      await loadAllData();
    }
  };

  const [pendingConvertQuote, setPendingConvertQuote] =
    useState<PrintQuoteData | null>(null);
  const [convertingOrder, setConvertingOrder] = useState<boolean>(false);
  const [convertOrderError, setConvertOrderError] = useState<string>('');
  useAutoDismiss(convertOrderError, () => setConvertOrderError(''), 5000);

  const submitConvertQuoteToOrder = async (
    quote: PrintQuoteData,
    customerOpts: {
      customer_id?: string | undefined;
      quick_customer?:
        | {
            name: string;
            phone?: string | null | undefined;
            address?: string | null | undefined;
          }
        | undefined;
    },
  ): Promise<boolean> => {
    setConvertingOrder(true);
    setConvertOrderError('');
    try {
      const csrf = await getCsrfToken();
      const depositDefault = Math.round(quote.total_quote_amount * 0.5);
      const res = await fetch('/api/v1/print-quotes/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
          'Idempotency-Key': `ord-from-${quote.id}-${customerOpts.customer_id || 'quick'}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          quote_id: quote.id,
          ...(customerOpts.customer_id
            ? { customer_id: customerOpts.customer_id }
            : {}),
          ...(customerOpts.quick_customer
            ? { quick_customer: customerOpts.quick_customer }
            : {}),
          print_ordered_at: new Date().toISOString().slice(0, 10),
          deposit_required: depositDefault,
          deposit_paid: 0,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          json?.error?.message || 'Không thể chuyển báo giá thành đơn hàng.';
        setConvertOrderError(msg);
        setBannerMessage({ type: 'error', text: msg });
        return false;
      }
      setPendingConvertQuote(null);
      setBannerMessage({
        type: 'success',
        text: `Đã tạo đơn đặt in ${json.data.order_code} từ báo giá ${quote.quote_code}!`,
      });
      await loadAllData();
      navigateInternal('/print-quotes/orders');
      return true;
    } finally {
      setConvertingOrder(false);
    }
  };

  const handleConvertQuoteToOrder = async (quote: PrintQuoteData) => {
    const validActiveCust =
      quote.customer_id &&
      customers.some(
        (c) => c.id === quote.customer_id && c.is_active !== false,
      );
    if (!validActiveCust) {
      setConvertOrderError('');
      setPendingConvertQuote(quote);
      return;
    }
    await submitConvertQuoteToOrder(quote, { customer_id: quote.customer_id! });
  };

  const handleCreateVendor = async (e: React.FormEvent): Promise<boolean> => {
    e.preventDefault();
    if (!vendorName.trim()) return false;
    const csrf = await getCsrfToken();
    const res = await fetch('/api/v1/print-quotes/vendors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        'Idempotency-Key': `vendor-${Date.now()}`,
      },
      credentials: 'include',
      body: JSON.stringify({
        name: vendorName.trim(),
        phone: vendorPhone.trim() || null,
        bank_name: vendorBankName.trim() || null,
        bank_account_number: vendorBankAccount.trim() || null,
      }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setBannerMessage({
        type: 'error',
        text: json?.error?.message || 'Không thể thêm nhà in mới.',
      });
      return false;
    }
    setVendorName('');
    setVendorPhone('');
    setVendorBankName('');
    setVendorBankAccount('');
    setBannerMessage({
      type: 'success',
      text: 'Đã thêm Nhà in đối tác mới thành công!',
    });
    await loadAllData();
    return true;
  };

  const handleCreatePriceItem = async (
    e: React.FormEvent,
  ): Promise<boolean> => {
    e.preventDefault();
    const targetVendorId = priceVendorId || vendors[0]?.id;
    if (!targetVendorId || !priceItemName.trim()) return false;
    const csrf = await getCsrfToken();
    const res = await fetch('/api/v1/print-quotes/price-items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        'Idempotency-Key': `price-${Date.now()}`,
      },
      credentials: 'include',
      body: JSON.stringify({
        vendor_id: targetVendorId,
        name: priceItemName.trim(),
        category: 'Ấn phẩm in',
        specification: priceSpec.trim() || null,
        unit: priceUnit.trim() || 'tờ',
        pricing_mode: priceCostMode,
        unit_cost: priceUnitCost,
        batch_total_cost: priceBatchCost,
        default_profit_mode: ProfitMode.FIXED_AMOUNT,
        default_profit_scope: ProfitScope.PER_UNIT,
        default_profit_value: priceDefaultProfitVal,
      }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setBannerMessage({
        type: 'error',
        text: json?.error?.message || 'Không thể lưu hạng mục bảng giá.',
      });
      return false;
    }
    setPriceItemName('');
    setPriceSpec('');
    setPriceUnit('tờ');
    setPriceUnitCost(0);
    setPriceBatchCost(0);
    setPriceDefaultProfitVal(0);
    setBannerMessage({
      type: 'success',
      text: 'Đã thêm hạng mục vào Bảng giá nhà in!',
    });
    await loadAllData();
    return true;
  };

  const handleSaveCatalogPriceItem = async (
    payload: SaveCatalogPriceItemPayload,
    editingId: string | null,
  ): Promise<boolean> => {
    const csrf = await getCsrfToken();
    const url = editingId
      ? `/api/v1/print-quotes/price-items/${encodeURIComponent(editingId)}`
      : '/api/v1/print-quotes/price-items';
    const method = editingId ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        'Idempotency-Key': `price-save-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setBannerMessage({
        type: 'error',
        text: json?.error?.message || 'Không thể lưu hạng mục Bảng giá xưởng.',
      });
      return false;
    }
    setBannerMessage({
      type: 'success',
      text: editingId
        ? 'Đã cập nhật hạng mục Bảng giá xưởng (các báo giá cũ giữ nguyên)!'
        : 'Đã thêm hạng mục mới vào Bảng giá xưởng!',
    });
    await loadAllData();
    return true;
  };

  const handleDeactivatePriceItem = async (itemId: string): Promise<void> => {
    const csrf = await getCsrfToken();
    const res = await fetch(
      `/api/v1/print-quotes/price-items/${encodeURIComponent(itemId)}/deactivate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        credentials: 'include',
        body: JSON.stringify({}),
      },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setBannerMessage({
        type: 'error',
        text: json?.error?.message || 'Không thể ngừng dùng hạng mục giá.',
      });
      return;
    }
    setBannerMessage({
      type: 'success',
      text: 'Đã chuyển hạng mục sang trạng thái Ngừng dùng.',
    });
    await loadAllData();
  };

  const handleRestorePriceItem = async (itemId: string): Promise<void> => {
    const csrf = await getCsrfToken();
    const res = await fetch(
      `/api/v1/print-quotes/price-items/${encodeURIComponent(itemId)}/restore`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        credentials: 'include',
        body: JSON.stringify({}),
      },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setBannerMessage({
        type: 'error',
        text: json?.error?.message || 'Không thể khôi phục hạng mục giá.',
      });
      return;
    }
    setBannerMessage({
      type: 'success',
      text: 'Đã khôi phục hạng mục Bảng giá xưởng!',
    });
    await loadAllData();
  };

  const handleDeletePriceItem = async (itemId: string): Promise<void> => {
    const csrf = await getCsrfToken();
    const res = await fetch(
      `/api/v1/print-quotes/price-items/${encodeURIComponent(itemId)}`,
      {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrf },
        credentials: 'include',
      },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setBannerMessage({
        type: 'error',
        text:
          json?.error?.message ||
          'Không thể xóa hạng mục đã dùng trong báo giá — hãy chọn Ngừng dùng.',
      });
      return;
    }
    setBannerMessage({
      type: 'success',
      text: 'Đã xóa vĩnh viễn hạng mục chưa từng dùng trong báo giá.',
    });
    await loadAllData();
  };

  const handleFetchPriceItemHistory = async (
    itemId: string,
  ): Promise<PrintVendorPriceItemHistoryData[]> => {
    try {
      const res = await fetch(
        `/api/v1/print-quotes/price-items/${encodeURIComponent(itemId)}/history`,
        { credentials: 'include' },
      );
      if (!res.ok) return [];
      const json = await res.json().catch(() => null);
      return json?.data?.items || [];
    } catch {
      return [];
    }
  };

  const handleSaveOverrideBackToCatalog = async (
    priceItemId: string,
    patch: SaveOverrideBackToCatalogPatch,
  ): Promise<boolean> => {
    const csrf = await getCsrfToken();
    const isBatch = patch.pricing_mode === VendorCostMode.TOTAL_BATCH;
    const res = await fetch(
      `/api/v1/print-quotes/price-items/${encodeURIComponent(priceItemId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
        },
        credentials: 'include',
        body: JSON.stringify({
          pricing_mode: patch.pricing_mode,
          unit_cost: isBatch ? 0 : patch.rate,
          batch_total_cost: isBatch ? patch.rate : 0,
          unit: patch.unit,
          ...(patch.specification !== undefined
            ? { specification: patch.specification || null }
            : {}),
          change_note: patch.change_note || 'Cập nhật giá từ báo giá',
        }),
      },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setBannerMessage({
        type: 'error',
        text: json?.error?.message || 'Không thể cập nhật Bảng giá xưởng.',
      });
      return false;
    }
    setBannerMessage({
      type: 'success',
      text: 'Đã cập nhật giá mới vào Bảng giá xưởng (lịch sử báo giá cũ giữ nguyên)!',
    });
    await loadAllData();
    return true;
  };

  const handleDeleteDraftQuote = async (
    quote: PrintQuoteData,
  ): Promise<void> => {
    const csrf = await getCsrfToken();
    const res = await fetch(
      `/api/v1/print-quotes/quotes/${encodeURIComponent(quote.id)}`,
      {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrf },
        credentials: 'include',
      },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setBannerMessage({
        type: 'error',
        text:
          json?.error?.message || 'Chỉ có thể xóa báo giá ở trạng thái Nháp.',
      });
      return;
    }
    setQuotes((prev) => prev.filter((q) => q.id !== quote.id));
    if (editingQuoteId === quote.id) {
      resetCleanNewDraft();
    }
    setBannerMessage({
      type: 'success',
      text: `Đã xóa bản nháp ${quote.quote_code}.`,
    });
    if (activeQuoteId === quote.id || activeQuoteId === quote.quote_code) {
      navigateInternal('/print-quotes');
    }
    await loadAllData();
  };

  const handleCreateCustomer = async (e: React.FormEvent): Promise<boolean> => {
    e.preventDefault();
    if (!custName.trim()) return false;
    const csrf = await getCsrfToken();
    const res = await fetch('/api/v1/print-quotes/customers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        'Idempotency-Key': `cust-${Date.now()}`,
      },
      credentials: 'include',
      body: JSON.stringify({
        name: custName.trim(),
        company_name: custCompany.trim() || null,
        phone: custPhone.trim() || null,
        address: custAddress.trim() || null,
      }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setBannerMessage({
        type: 'error',
        text: json?.error?.message || 'Không thể lưu khách hàng mới.',
      });
      return false;
    }
    setCustName('');
    setCustCompany('');
    setCustPhone('');
    setCustAddress('');
    setBannerMessage({
      type: 'success',
      text: 'Đã lưu hồ sơ Khách hàng mới!',
    });
    await loadAllData();
    return true;
  };

  const handleInlineCreateCustomer = async (input: {
    name: string;
    phone: string;
    company: string;
  }): Promise<PrintCustomerData | null> => {
    try {
      const csrf = await getCsrfToken();
      const res = await fetch('/api/v1/print-quotes/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
          'Idempotency-Key': `cust-inline-${Date.now()}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          name: input.name.trim(),
          phone: input.phone.trim() || null,
          company_name: input.company.trim() || null,
          address: null,
        }),
      });
      if (!res.ok) {
        setBannerMessage({
          type: 'error',
          text: 'Không thể tạo khách hàng mới.',
        });
        return null;
      }
      const json = await res.json();
      const created: PrintCustomerData | null = json?.data || null;
      if (created) {
        setCustomers((prev) => [created, ...prev]);
        setSelectedCustomerId(created.id);
        setBannerMessage({
          type: 'success',
          text: `Đã tạo và chọn khách hàng ${created.name}!`,
        });
      }
      return created;
    } catch {
      setBannerMessage({
        type: 'error',
        text: 'Lỗi kết nối khi tạo khách hàng mới.',
      });
      return null;
    }
  };

  const handleUpdateOrderField = async (
    orderId: string,
    patch: Record<string, unknown>,
  ): Promise<boolean> => {
    const csrf = await getCsrfToken();
    const res = await fetch(`/api/v1/print-quotes/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      credentials: 'include',
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setBannerMessage({
        type: 'error',
        text:
          json?.error?.message ||
          'Không thể cập nhật thông tin đơn hàng đặt in.',
      });
      return false;
    }
    setBannerMessage({
      type: 'success',
      text: 'Đã cập nhật tiến độ & đối soát đơn hàng!',
    });
    await loadAllData();
    return true;
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentOrderTarget || paymentAmount <= 0) return;
    const csrf = await getCsrfToken();
    const res = await fetch(
      `/api/v1/print-quotes/orders/${paymentOrderTarget.id}/payments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
          'Idempotency-Key': `pay-${paymentOrderTarget.id}-${Date.now()}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          payment_type: paymentType,
          amount: Math.round(Number(paymentAmount)),
          payment_method: paymentMethod,
          note: paymentNote.trim() || null,
        }),
      },
    );
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setBannerMessage({
        type: 'error',
        text:
          json?.error?.message || 'Không thể ghi nhận giao dịch thanh toán.',
      });
      return;
    }
    await loadAllData();
    setPaymentOrderTarget(null);
    setPaymentAmount(0);
    setPaymentNote('');
    setBannerMessage({
      type: 'success',
      text: 'Đã ghi nhận thanh toán đơn hàng!',
    });
  };

  if (role !== 'owner' || isOwnerVerified === false) {
    return (
      <div style={{ padding: '24px' }} data-testid="printquote-forbidden">
        <PageHeader
          title="Báo giá in ấn"
          subtitle="Phân hệ quản lý giá vốn nhà in, lợi nhuận và đơn đặt in dành riêng cho Chủ sở hữu."
        />
        <div style={cardStyle}>
          Chỉ Chủ sở hữu (Owner) với phiên làm việc xác thực mới được phép truy
          cập dữ liệu giá nhà in và lợi nhuận báo giá.
        </div>
      </div>
    );
  }

  const isEditorView = viewMode === 'new' || viewMode === 'edit';

  return (
    <div
      data-testid="printquote-screen"
      className="pq-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: '100%',
        maxWidth: '100%',
        paddingBottom: isEditorView ? '36px' : '96px',
        boxSizing: 'border-box',
      }}
    >
      <PrintQuoteNavHeader
        viewMode={viewMode}
        onNavigatePath={(path) => navigateInternal(path)}
        quotesCount={quotes.length}
        ordersCount={orders.length}
        priceItemsCount={priceItems.length}
        customersCount={customers.length}
        vendorsCount={vendors.length}
      />

      {/* RAM Draft Reminder Banner on non-editor views */}
      {isDraftDirty && !isEditorView && (
        <div
          role="status"
          data-testid="pq-ram-draft-banner"
          style={{
            padding: '12px 16px',
            borderRadius: '12px',
            backgroundColor: 'var(--accent-soft)',
            border: '1px solid var(--accent-text)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            fontSize: '13px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                color: 'var(--accent-text)',
                flexShrink: 0,
              }}
            >
              <PqFileTextIcon size={16} />
            </span>
            <strong style={{ color: 'var(--accent-text)' }}>
              Đang có bản nháp chưa lưu trong bộ nhớ tạm:
            </strong>
            <span style={{ fontWeight: 600 }}>
              {editingQuoteCode
                ? `Đang sửa ${editingQuoteCode}`
                : quoteTitle.trim() ||
                  draftLines[0]?.name.trim() ||
                  'Báo giá mới'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="pq-resume-draft-btn"
              onClick={() => navigateInternal(editorPath)}
              className="pq-btn pq-btn-primary"
            >
              <span>Tiếp tục nhập →</span>
            </button>
            <button
              type="button"
              data-testid="pq-discard-draft-btn"
              onClick={() => {
                resetCleanNewDraft();
                setBannerMessage(null);
              }}
              className="pq-btn pq-btn-secondary"
            >
              <span>Bỏ nháp</span>
            </button>
          </div>
        </div>
      )}

      {bannerMessage && (
        <div
          role="status"
          data-testid="printquote-banner"
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            backgroundColor:
              bannerMessage.type === 'success'
                ? 'rgba(16, 185, 129, 0.14)'
                : 'rgba(239, 68, 68, 0.14)',
            border:
              bannerMessage.type === 'success'
                ? '1px solid var(--success-text)'
                : '1px solid var(--danger-text)',
            color:
              bannerMessage.type === 'success'
                ? 'var(--success-text)'
                : 'var(--danger-text)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>{bannerMessage.text}</span>
          <button
            type="button"
            aria-label="Đóng thông báo"
            onClick={() => setBannerMessage(null)}
            style={{
              minWidth: '44px',
              minHeight: '44px',
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* DEFAULT VIEW: /print-quotes -> QUOTES LIST */}
      {viewMode === 'quotes' && (
        <QuotesListTab
          quotes={quotes}
          expandedQuoteHistoryId={expandedQuoteHistoryId}
          setExpandedQuoteHistoryId={setExpandedQuoteHistoryId}
          onStartNewQuote={handleStartNewQuote}
          onOpenQuoteDetail={(q) =>
            navigateInternal(`/print-quotes/${encodeURIComponent(q.id)}`)
          }
          onDownloadSavedQuotePdfFile={handleDownloadSavedQuotePdfFile}
          onOpenSavedQuotePdf={handleOpenSavedQuotePdf}
          onLoadQuoteForEdit={handleLoadQuoteForEdit}
          onCloneQuoteAsNew={handleCloneQuoteAsNew}
          onFinalizeQuote={handleFinalizeQuote}
          onConvertQuoteToOrder={handleConvertQuoteToOrder}
          onDeleteDraftQuote={handleDeleteDraftQuote}
        />
      )}

      {/* FOCUSED EDITOR: /print-quotes/new & /print-quotes/:id/edit */}
      {isEditorView &&
        (viewMode === 'edit' && !activeQuote ? (
          loading || singleQuoteLoading ? (
            <div style={cardStyle} data-testid="panel-quote-edit-loading">
              <div style={{ fontSize: '13.5px', color: 'var(--muted-color)' }}>
                Đang tải dữ liệu báo giá để chỉnh sửa…
              </div>
            </div>
          ) : (
            <div style={cardStyle} data-testid="pq-quote-not-found">
              <h2
                style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 700 }}
              >
                Không tìm thấy báo giá cần sửa
              </h2>
              <button
                type="button"
                data-testid="pq-editor-back-btn"
                onClick={() => navigateInternal('/print-quotes')}
                style={{
                  minHeight: '44px',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-color)',
                  color: 'var(--text-color)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ← Quay lại Danh sách báo giá
              </button>
            </div>
          )
        ) : (
          <CreateQuoteTab
            editingQuoteId={viewMode === 'edit' ? editingQuoteId : null}
            editingQuoteCode={viewMode === 'edit' ? editingQuoteCode : null}
            editingQuoteVersion={viewMode === 'edit' ? editingQuoteVersion : 1}
            isLockedQuoteForEdit={Boolean(
              viewMode === 'edit' &&
              activeQuote &&
              !isQuoteStatusEditable(activeQuote.status),
            )}
            lockedQuoteStatusLabel={
              activeQuote
                ? QUOTE_STATUS_LABELS[activeQuote.status] || activeQuote.status
                : undefined
            }
            onCloneLockedQuote={
              activeQuote ? () => handleCloneQuoteAsNew(activeQuote) : undefined
            }
            onBackToQuotes={() => {
              if (viewMode === 'edit' && activeQuote) {
                navigateInternal(
                  `/print-quotes/${encodeURIComponent(activeQuote.id)}`,
                );
              } else {
                navigateInternal('/print-quotes');
              }
            }}
            hasTouchedFields={hasTouchedFields}
            onMarkTouched={markEditorDirty}
            savingQuote={savingQuote}
            quoteTitle={quoteTitle}
            onChangeQuoteTitle={setQuoteTitle}
            selectedCustomerId={selectedCustomerId}
            onChangeSelectedCustomerId={setSelectedCustomerId}
            validUntil={validUntil}
            onChangeValidUntil={setValidUntil}
            shippingFee={shippingFee}
            onChangeShippingFee={(val) => {
              setShippingFee(val);
              setShippingFeeInput(String(val));
            }}
            shippingFeeInput={shippingFeeInput}
            onChangeShippingFeeInput={(nextRaw) => {
              setShippingFeeInput(nextRaw);
              if (
                nextRaw !== '' &&
                Number.isFinite(Number(nextRaw)) &&
                Number(nextRaw) >= 0
              ) {
                setShippingFee(Math.round(Number(nextRaw)));
              }
            }}
            includeShippingInUnitPrice={includeShippingInUnitPrice}
            onChangeIncludeShippingInUnitPrice={setIncludeShippingInUnitPrice}
            shippingAllocation={shippingAllocation}
            onChangeShippingAllocation={setShippingAllocation}
            roundingMode={roundingMode}
            onChangeRoundingMode={setRoundingMode}
            roundingStep={roundingStep}
            onChangeRoundingStep={setRoundingStep}
            customerNotes={customerNotes}
            onChangeCustomerNotes={setCustomerNotes}
            internalNotes={internalNotes}
            onChangeInternalNotes={setInternalNotes}
            versionChangeNote={versionChangeNote}
            onChangeVersionChangeNote={setVersionChangeNote}
            draftLines={draftLines}
            setDraftLines={setDraftLines}
            customers={customers}
            priceItems={priceItems}
            livePricingResult={livePricingResult}
            onSelectCatalogItem={handleSelectCatalogItem}
            onResetNewQuote={() => {
              resetCleanNewDraft();
              setBannerMessage(null);
              if (viewMode === 'edit') {
                navigateInternal('/print-quotes/new');
              }
            }}
            onSaveQuote={handleSaveQuote}
            onSavePendingDraftQuote={handleSavePendingDraftQuote}
            onSaveOverrideBackToCatalog={handleSaveOverrideBackToCatalog}
            onDownloadLivePdf={handleDownloadLivePdfFile}
            onOpenLivePreview={handleOpenLiveA4Preview}
            onQuickCreateCustomer={handleInlineCreateCustomer}
          />
        ))}

      {/* DEDICATED QUOTE DETAIL VIEW: /print-quotes/:id */}
      {viewMode === 'detail' && (
        <QuoteDetailView
          quote={activeQuote}
          loading={loading || singleQuoteLoading}
          workspaceName={workspaceName}
          customers={customers}
          ownerBank={ownerBank}
          onBackToList={() => navigateInternal('/print-quotes')}
          onDownloadSavedPdf={handleDownloadSavedQuotePdfFile}
          onOpenFullPreview={handleOpenSavedQuotePdf}
          onPrintWindow={handlePrintA4Window}
          onEditQuote={handleLoadQuoteForEdit}
          onCloneQuoteAsNew={handleCloneQuoteAsNew}
          onFinalizeQuote={handleFinalizeQuote}
          onConvertQuoteToOrder={handleConvertQuoteToOrder}
          onDeleteDraftQuote={handleDeleteDraftQuote}
        />
      )}

      {/* SEPARATED CATALOG SUB-PAGES: /catalog/prices & /catalog/vendors */}
      {(viewMode === 'catalog-prices' || viewMode === 'catalog-vendors') && (
        <VendorsCatalogTab
          mode={viewMode === 'catalog-vendors' ? 'vendors' : 'prices'}
          vendors={vendors}
          priceItems={priceItems}
          vendorName={vendorName}
          setVendorName={setVendorName}
          vendorPhone={vendorPhone}
          setVendorPhone={setVendorPhone}
          vendorBankName={vendorBankName}
          setVendorBankName={setVendorBankName}
          vendorBankAccount={vendorBankAccount}
          setVendorBankAccount={setVendorBankAccount}
          onCreateVendor={handleCreateVendor}
          priceVendorId={priceVendorId}
          setPriceVendorId={setPriceVendorId}
          priceItemName={priceItemName}
          setPriceItemName={setPriceItemName}
          priceSpec={priceSpec}
          setPriceSpec={setPriceSpec}
          priceUnit={priceUnit}
          setPriceUnit={setPriceUnit}
          priceCostMode={priceCostMode}
          setPriceCostMode={setPriceCostMode}
          priceUnitCost={priceUnitCost}
          setPriceUnitCost={setPriceUnitCost}
          priceBatchCost={priceBatchCost}
          setPriceBatchCost={setPriceBatchCost}
          priceDefaultProfitVal={priceDefaultProfitVal}
          setPriceDefaultProfitVal={setPriceDefaultProfitVal}
          onCreatePriceItem={handleCreatePriceItem}
          onSaveCatalogPriceItem={handleSaveCatalogPriceItem}
          onDeactivatePriceItem={handleDeactivatePriceItem}
          onRestorePriceItem={handleRestorePriceItem}
          onDeletePriceItem={handleDeletePriceItem}
          onFetchPriceItemHistory={handleFetchPriceItemHistory}
          onNavigateCatalogSubPage={(sub) =>
            navigateInternal(`/print-quotes/catalog/${sub}`)
          }
          onQuickQuotePriceItem={(item) => {
            runWithDraftReplaceGuard(true, () => {
              const resolvedCost =
                item.pricing_mode === VendorCostMode.TOTAL_BATCH
                  ? item.batch_total_cost
                  : item.unit_cost;
              hydratedEditIdRef.current = null;
              setEditingQuoteId(null);
              setEditingQuoteCode(null);
              setEditingQuoteVersion(1);
              setEditorPath('/print-quotes/new');
              setQuoteTitle(`Báo giá ${item.name}`);
              if (item.item_type === 'FINISHING') {
                setDraftLines([
                  {
                    ...EMPTY_DRAFT_LINE(1),
                    id: 'ITEM-1',
                    unit: item.unit || 'tờ',
                    ...(item.pricing_mode === VendorCostMode.PER_SQM
                      ? { areaMode: AreaInputMode.DIMENSIONS }
                      : {}),
                    finishingStages: [
                      {
                        id: 'STG-1',
                        priceItemId: item.id,
                        code: item.code,
                        name: item.name,
                        pricingMode: item.pricing_mode,
                        rateValue: resolvedCost,
                        rateInput: String(resolvedCost),
                        unit: item.unit || 'tờ',
                        costSource: LineCostSource.CATALOG,
                        catalogOriginalRate: resolvedCost,
                        note: item.conditions_note || item.note || null,
                      },
                    ],
                  },
                ]);
              } else {
                setDraftLines([
                  {
                    id: 'ITEM-1',
                    vendorPriceItemId: item.id,
                    name: item.name,
                    specification: item.specification || '',
                    unit: item.unit || 'tờ',
                    quantity: 0,
                    quantityInput: '',
                    vendorCostMode: item.pricing_mode,
                    vendorCostValue: resolvedCost,
                    vendorCostInput: String(resolvedCost),
                    baseCostSource: LineCostSource.CATALOG,
                    baseCatalogOriginalRate: resolvedCost,
                    baseIncludedStages: item.included_stages?.length
                      ? [...item.included_stages]
                      : undefined,
                    ...(item.pricing_mode === VendorCostMode.PER_SQM
                      ? { areaMode: AreaInputMode.DIMENSIONS }
                      : {}),
                    ambiguousLegacyCost: null,
                    profitMode: item.default_profit_mode,
                    profitScope: item.default_profit_scope,
                    profitValue: item.default_profit_value,
                    profitInput: String(item.default_profit_value),
                  },
                ]);
              }
              setHasTouchedFields(false);
              setIsDraftDirty(true);
              navigateInternal('/print-quotes/new');
            });
          }}
        />
      )}

      {/* SEPARATED CATALOG SUB-PAGE: /catalog/customers */}
      {viewMode === 'catalog-customers' && (
        <CustomersTab
          customers={customers}
          custName={custName}
          setCustName={setCustName}
          custCompany={custCompany}
          setCustCompany={setCustCompany}
          custPhone={custPhone}
          setCustPhone={setCustPhone}
          custAddress={custAddress}
          setCustAddress={setCustAddress}
          onCreateCustomer={handleCreateCustomer}
          onSelectCustomerForQuote={(customerId) => {
            if (!editingQuoteId) {
              setSelectedCustomerId(customerId);
              setEditorPath('/print-quotes/new');
              setIsDraftDirty(true);
              navigateInternal('/print-quotes/new');
              return;
            }
            runWithDraftReplaceGuard(true, () => {
              resetCleanNewDraft();
              setSelectedCustomerId(customerId);
              setIsDraftDirty(true);
              navigateInternal('/print-quotes/new');
            });
          }}
        />
      )}

      {/* ORDERS VIEW: /print-quotes/orders */}
      {viewMode === 'orders' && (
        <OrdersTab
          orders={orders}
          vendors={vendors}
          onMutateLedger={handleMutateLedger}
          onUpdateOrderField={handleUpdateOrderField}
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
          onRecordPayment={handleRecordPayment}
        />
      )}

      {/* CUSTOMER RECEIVABLES VIEW: /print-quotes/receivables */}
      {viewMode === 'receivables' && (
        <React.Suspense
          fallback={
            <div style={{ padding: '20px', color: 'var(--muted-color)' }}>
              Đang tải sổ công nợ khách hàng…
            </div>
          }
        >
          <LazyReceivablesTab
            data={receivablesSummary}
            customers={customers}
            orders={orders}
            ownerBank={ownerBank}
            onMutateLedger={handleMutateLedger}
            onRefresh={() => void loadAllData()}
          />
        </React.Suspense>
      )}

      {/* VENDOR PAYABLES VIEW: /print-quotes/payables */}
      {viewMode === 'payables' && (
        <React.Suspense
          fallback={
            <div style={{ padding: '20px', color: 'var(--muted-color)' }}>
              Đang tải sổ công nợ xưởng…
            </div>
          }
        >
          <LazyPayablesTab
            data={payablesSummary}
            vendors={vendors}
            orders={orders}
            onMutateLedger={handleMutateLedger}
          />
        </React.Suspense>
      )}

      {/* UNIFIED PRINT TRANSACTIONS VIEW: /print-quotes/transactions */}
      {viewMode === 'transactions' && (
        <React.Suspense
          fallback={
            <div style={{ padding: '20px', color: 'var(--muted-color)' }}>
              Đang tải sổ giao dịch…
            </div>
          }
        >
          <LazyTransactionsTab items={unifiedTransactions} />
        </React.Suspense>
      )}

      {/* HISTORICAL DATA IMPORT VIEW: /print-quotes/import-history */}
      {viewMode === 'import-history' && (
        <React.Suspense
          fallback={
            <div style={{ padding: '20px', color: 'var(--muted-color)' }}>
              Đang tải công cụ đối soát Sheet…
            </div>
          }
        >
          <LazyHistoricalImportTab
            batches={importBatches}
            onMutateLedger={handleMutateLedger}
            onRefresh={() => void loadAllData()}
          />
        </React.Suspense>
      )}

      {/* HONEST REPORTS VIEW: /print-quotes/reports */}
      {viewMode === 'reports' && (
        <AnalyticsTab
          stats={stats}
          orders={orders}
          quotes={quotes}
          financialReport={financialReport}
          onNavigatePath={navigateInternal}
        />
      )}

      {/* A4 PDF Preview & Print Modal */}
      {pdfPreviewState && (
        <React.Suspense fallback={null}>
          <LazyPdfPreviewModal
            previewState={pdfPreviewState}
            onClose={() => setPdfPreviewState(null)}
            onDownloadSavedPdf={handleDownloadSavedQuotePdfFile}
            onDownloadLivePdf={handleDownloadLivePdfFile}
            onPrintWindow={handlePrintA4Window}
          />
        </React.Suspense>
      )}

      {/* 2-Button Leave PrintQuote Module Confirmation Dialog */}
      <CatalogModalDialog
        open={pendingLeaveAction !== null}
        title="Rời phân hệ Báo giá in ấn?"
        subtitle="Bản nháp báo giá chưa lưu chỉ nằm trong bộ nhớ tạm (RAM) để bảo mật giá vốn và sẽ bị xóa khi rời sang phân hệ khác."
        testId="pq-leave-draft-dialog"
        maxWidth="460px"
        onClose={() => setPendingLeaveAction(null)}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            flexWrap: 'wrap',
            marginTop: '8px',
          }}
        >
          <button
            type="button"
            data-testid="pq-leave-stay-btn"
            onClick={() => setPendingLeaveAction(null)}
            className="pq-btn pq-btn-accent"
          >
            <span>Ở lại tiếp tục nhập</span>
          </button>
          <button
            type="button"
            data-testid="pq-leave-discard-btn"
            onClick={() => {
              const proceed = pendingLeaveAction;
              setPendingLeaveAction(null);
              resetCleanNewDraft();
              proceed?.();
            }}
            style={{
              minHeight: '44px',
              padding: '8px 16px',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: 'var(--danger-color)',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Rời trang & xóa nháp
          </button>
        </div>
      </CatalogModalDialog>

      {/* Replace Dirty Draft Confirmation Dialog */}
      <CatalogModalDialog
        open={pendingReplaceDraftAction !== null}
        title="Thay thế bản nháp đang nhập?"
        subtitle="Bạn đang có một bản nháp báo giá chưa lưu trong bộ nhớ tạm. Mở báo giá khác sẽ xóa bản nháp hiện tại."
        testId="pq-replace-draft-dialog"
        maxWidth="460px"
        onClose={() => setPendingReplaceDraftAction(null)}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            flexWrap: 'wrap',
            marginTop: '8px',
          }}
        >
          <button
            type="button"
            data-testid="pq-replace-keep-btn"
            onClick={() => setPendingReplaceDraftAction(null)}
            className="pq-btn pq-btn-secondary"
          >
            <span>Giữ bản nháp đang nhập</span>
          </button>
          <button
            type="button"
            data-testid="pq-replace-confirm-btn"
            onClick={() => {
              const act = pendingReplaceDraftAction;
              setPendingReplaceDraftAction(null);
              act?.();
            }}
            className="pq-btn pq-btn-primary"
          >
            <span>Bỏ nháp cũ & mở mới</span>
          </button>
        </div>
      </CatalogModalDialog>

      {pendingConvertQuote && (
        <React.Suspense fallback={null}>
          <LazyConvertOrderCustomerModal
            quote={pendingConvertQuote}
            customers={customers}
            submitting={convertingOrder}
            errorMessage={convertOrderError}
            onClose={() => {
              if (!convertingOrder) {
                setPendingConvertQuote(null);
                setConvertOrderError('');
              }
            }}
            onSubmit={async (payload) => {
              await submitConvertQuoteToOrder(pendingConvertQuote, payload);
            }}
          />
        </React.Suspense>
      )}

      {loading && (
        <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
          Đang đồng bộ dữ liệu báo giá…
        </div>
      )}

      {/* Scoped Executive Design System & Responsive Styles for PrintQuote */}
      <style>{PRINTQUOTE_STYLES}</style>
    </div>
  );
};
