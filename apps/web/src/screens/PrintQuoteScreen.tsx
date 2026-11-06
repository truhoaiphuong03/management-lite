import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { PageHeader } from '../../../../packages/ui/src/components/index.js';
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
  resolveSavedQuoteLineCostState,
  validateQuoteDraftInputs,
  type DraftLineValidationError,
} from './helpers/printquote-helpers.js';
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
import { PdfPreviewModal } from './printquote/PdfPreviewModal.js';
import { CatalogModalDialog } from './printquote/CatalogModalDialog.js';
import { PqFileTextIcon } from './printquote/PrintQuoteIcons.js';
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
  workspaceName = 'Hoài Phương Media',
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

  const loadAllData = useCallback(async () => {
    if (typeof window === 'undefined') return;
    setLoading(true);
    try {
      const [vRes, pRes, cRes, qRes, oRes, sRes] = await Promise.all([
        fetch('/api/v1/print-quotes/vendors', { credentials: 'include' }),
        fetch('/api/v1/print-quotes/price-items', { credentials: 'include' }),
        fetch('/api/v1/print-quotes/customers', { credentials: 'include' }),
        fetch('/api/v1/print-quotes/quotes', { credentials: 'include' }),
        fetch('/api/v1/print-quotes/orders', { credentials: 'include' }),
        fetch('/api/v1/print-quotes/stats', { credentials: 'include' }),
      ]);

      if (vRes.ok) {
        const j = await vRes.json();
        setVendors(j?.data?.items || []);
      }
      if (pRes.ok) {
        const j = await pRes.json();
        setPriceItems(j?.data?.items || []);
      }
      if (cRes.ok) {
        const j = await cRes.json();
        setCustomers(j?.data?.items || []);
      }
      if (qRes.ok) {
        const j = await qRes.json();
        setQuotes(j?.data?.items || []);
      }
      if (oRes.ok) {
        const j = await oRes.json();
        setOrders(j?.data?.items || []);
      }
      if (sRes.ok) {
        const j = await sRes.json();
        setStats(j?.data || null);
      }

      const [arRes, apRes, txRes, frRes, imRes] = await Promise.all([
        fetch('/api/v1/print-quotes/receivables', {
          credentials: 'include',
        }),
        fetch('/api/v1/print-quotes/payables', {
          credentials: 'include',
        }),
        fetch('/api/v1/print-quotes/transactions', { credentials: 'include' }),
        fetch('/api/v1/print-quotes/financial-report', {
          credentials: 'include',
        }),
        fetch('/api/v1/print-quotes/import-history/batches', {
          credentials: 'include',
        }),
      ]);
      if (arRes.ok) {
        const j = await arRes.json();
        setReceivablesSummary(
          j?.data && Array.isArray(j.data.summaries) ? j.data : null,
        );
      }
      if (apRes.ok) {
        const j = await apRes.json();
        setPayablesSummary(
          j?.data && Array.isArray(j.data.summaries) ? j.data : null,
        );
      }
      if (txRes.ok) {
        const j = await txRes.json();
        setUnifiedTransactions(
          Array.isArray(j?.data?.items) ? j.data.items : [],
        );
      }
      if (frRes.ok) {
        const j = await frRes.json();
        setFinancialReport(
          j?.data && j.data.reconciled && j.data.cashflow_and_debt
            ? j.data
            : null,
        );
      }
      if (imRes.ok) {
        const j = await imRes.json();
        setImportBatches(Array.isArray(j?.data?.items) ? j.data.items : []);
      }
    } catch {
      // Ignore fetch errors in offline/SSR test environments
    } finally {
      setLoading(false);
    }
  }, []);

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
    void loadAllData();
  }, [loadAllData]);

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
      setDraftLines(mapQuoteLinesToDraftLines(quote));
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
      applyQuoteIntoEditor(quote, true);
      setBannerMessage({
        type: 'success',
        text: `Đã sao chép dữ liệu từ ${quote.quote_code} sang bản báo giá mới.`,
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
        <PdfPreviewModal
          previewState={pdfPreviewState}
          onClose={() => setPdfPreviewState(null)}
          onDownloadSavedPdf={handleDownloadSavedQuotePdfFile}
          onDownloadLivePdf={handleDownloadLivePdfFile}
          onPrintWindow={handlePrintA4Window}
        />
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
      <style>{`
        [data-testid="printquote-screen"] {
          --accent-soft: rgba(20, 184, 166, 0.1);
          --pq-hero-bg: linear-gradient(135deg, rgba(20, 184, 166, 0.14) 0%, rgba(15, 23, 42, 0.88) 100%);
          --pq-hero-border: rgba(20, 184, 166, 0.36);
          --pq-profit-panel-bg: rgba(16, 185, 129, 0.07);
          --pq-profit-panel-border: rgba(16, 185, 129, 0.28);
        }

        :root[data-theme="light"] [data-testid="printquote-screen"],
        [data-theme="light"] [data-testid="printquote-screen"] {
          --accent-soft: rgba(15, 118, 110, 0.08);
          --pq-hero-bg: linear-gradient(135deg, rgba(15, 118, 110, 0.09) 0%, rgba(241, 245, 249, 0.96) 100%);
          --pq-hero-border: rgba(15, 118, 110, 0.28);
          --pq-profit-panel-bg: rgba(4, 120, 87, 0.05);
          --pq-profit-panel-border: rgba(4, 120, 87, 0.24);
        }

        @media (prefers-color-scheme: light) {
          :root[data-theme="system"] [data-testid="printquote-screen"],
          [data-theme="system"] [data-testid="printquote-screen"] {
            --accent-soft: rgba(15, 118, 110, 0.08);
            --pq-hero-bg: linear-gradient(135deg, rgba(15, 118, 110, 0.09) 0%, rgba(241, 245, 249, 0.96) 100%);
            --pq-hero-border: rgba(15, 118, 110, 0.28);
            --pq-profit-panel-bg: rgba(4, 120, 87, 0.05);
            --pq-profit-panel-border: rgba(4, 120, 87, 0.24);
          }
        }

        /* Module Sub-Navigation (unified to /work .app-subnav-bar standard) */
        .pq-module-nav {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          max-width: 100%;
          padding: 0 0 8px 0;
          margin: 0;
          border-radius: 0;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--border-subtle);
          box-shadow: none;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .pq-module-nav::-webkit-scrollbar {
          display: none;
        }
        .pq-module-nav-item {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 6px 12px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--muted-color);
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          flex-shrink: 0;
          cursor: pointer;
          transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }
        .pq-module-nav-item:hover {
          color: var(--text-color);
          background: rgba(148, 163, 184, 0.08);
        }
        .pq-module-nav-item[data-active="true"] {
          background: var(--primary-subtle);
          color: var(--accent-text);
          border-color: transparent;
          font-weight: 600;
          box-shadow: none;
        }
        .pq-nav-count-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          padding: 0 6px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
          font-variant-numeric: tabular-nums;
          background: var(--surface-subtle);
          color: var(--muted-color);
          border: 1px solid var(--border-subtle);
        }
        .pq-nav-count-pill[data-active="true"] {
          background: rgba(20, 184, 166, 0.18);
          color: var(--accent-text);
          border-color: transparent;
        }

        /* Catalog Secondary Filter Chips (harmonized with /work focus chips) */
        .pq-catalog-subnav {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: nowrap;
          overflow-x: auto;
          scrollbar-width: none;
          padding-bottom: 2px;
        }
        .pq-catalog-subnav::-webkit-scrollbar {
          display: none;
        }
        .pq-catalog-subnav-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 34px;
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid var(--border-subtle);
          background: var(--surface-subtle);
          color: var(--muted-color);
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          flex-shrink: 0;
          cursor: pointer;
          transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }
        .pq-catalog-subnav-item:hover {
          color: var(--text-color);
          border-color: var(--border-hover);
        }
        .pq-catalog-subnav-item[data-active="true"] {
          background: var(--primary-subtle);
          color: var(--accent-text);
          border-color: #14B8A6;
          font-weight: 600;
        }

        /* Clean Page Head (unified to /work PageHeader standard) */
        .pq-page-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 4px;
        }
        .pq-page-head > div:first-child {
          min-width: 0;
          flex: 1 1 180px;
        }
        .pq-page-title {
          margin: 0;
          font-family: var(--font-sans);
          font-size: var(--heading-page-size, 22px);
          font-weight: var(--heading-page-weight, 700);
          letter-spacing: var(--heading-tracking, -0.015em);
          line-height: var(--heading-page-lh, 1.3);
          color: var(--text-color);
          overflow-wrap: break-word;
        }
        .pq-page-subtitle {
          margin: 4px 0 0;
          font-family: var(--font-sans);
          font-size: var(--subtitle-size, 13.5px);
          line-height: var(--subtitle-lh, 1.45);
          color: var(--muted-color);
        }

        /* Unified Button Hierarchy */
        .pq-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 40px;
          padding: 8px 14px;
          border-radius: 10px;
          border: 1px solid transparent;
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.2;
          white-space: nowrap;
          cursor: pointer;
          text-decoration: none;
          transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
        }
        .pq-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .pq-btn:focus-visible,
        .pq-module-nav-item:focus-visible,
        .pq-catalog-subnav-item:focus-visible,
        .pq-filter-pill:focus-visible,
        .pq-segmented-btn:focus-visible,
        .pq-code-link:focus-visible,
        .pq-picker-row:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 2px;
        }
        .pq-btn-sm {
          min-height: 36px;
          padding: 6px 11px;
          border-radius: 8px;
          font-size: 12.5px;
        }
        .pq-btn-lg {
          min-height: 44px;
          padding: 10px 18px;
          border-radius: 11px;
          font-size: 13.5px;
          font-weight: 700;
        }
        .pq-btn-cta {
          min-height: 44px;
          padding: 0 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
        }
        .pq-btn-primary {
          background: var(--primary-color);
          color: var(--inverse-text);
          border-color: var(--primary-color);
          font-weight: 700;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
        }
        .pq-btn-primary:hover:not(:disabled) {
          background: var(--primary-hover);
          border-color: var(--primary-hover);
        }
        .pq-btn-secondary {
          background: var(--surface-color);
          color: var(--text-color);
          border-color: var(--border-color);
        }
        .pq-btn-secondary:hover:not(:disabled) {
          background: var(--surface-hover);
          border-color: var(--border-hover);
        }
        .pq-btn-accent {
          background: var(--accent-soft);
          color: var(--accent-text);
          border-color: var(--accent-text);
          font-weight: 700;
        }
        .pq-btn-accent:hover:not(:disabled) {
          background: var(--primary-subtle);
        }
        .pq-btn-success {
          background: var(--success-color);
          color: var(--inverse-text);
          border-color: var(--success-color);
          font-weight: 700;
        }
        .pq-btn-success:hover:not(:disabled) {
          background: var(--success-hover);
          border-color: var(--success-hover);
        }
        .pq-btn-ghost {
          background: transparent;
          color: var(--muted-color);
          border-color: var(--border-color);
        }
        .pq-btn-ghost:hover:not(:disabled) {
          background: var(--surface-subtle);
          color: var(--text-color);
        }
        .pq-btn-danger-ghost {
          background: transparent;
          color: var(--danger-text);
          border-color: rgba(239, 68, 68, 0.35);
        }
        .pq-btn-danger-ghost:hover:not(:disabled) {
          background: var(--danger-subtle);
        }

        /* Unified Search & Filter Toolbar */
        .pq-toolbar-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          padding: 12px 14px;
          border-radius: 13px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          box-shadow: var(--shadow-sm);
        }
        .pq-search-wrap {
          position: relative;
          flex: 1 1 260px;
          min-width: 0;
        }
        .pq-search-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--muted-color);
          pointer-events: none;
        }
        .pq-filter-pills {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .pq-filter-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 36px;
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid var(--border-color);
          background: var(--surface-subtle);
          color: var(--muted-color);
          font-size: 12.5px;
          font-weight: 600;
          white-space: nowrap;
          cursor: pointer;
          transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }
        .pq-filter-pill:hover {
          color: var(--text-color);
          border-color: var(--border-hover);
        }
        .pq-filter-pill[data-active="true"] {
          background: var(--accent-soft);
          color: var(--accent-text);
          border-color: var(--accent-text);
          font-weight: 700;
        }
        .pq-filter-pill-count {
          font-size: 12px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          opacity: 0.9;
        }

        /* Executive Quote & Order Cards */
        .pq-quote-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 18px 20px;
          border-radius: 14px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          box-shadow: var(--shadow-sm);
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .pq-quote-card:hover {
          border-color: var(--border-hover);
        }
        .pq-quote-card-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 14px;
        }
        .pq-code-link {
          display: inline-flex;
          align-items: center;
          padding: 3px 9px;
          border-radius: 7px;
          border: 1px solid var(--accent-text);
          background: var(--accent-soft);
          color: var(--accent-text);
          font-size: 12.5px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          cursor: pointer;
        }
        .pq-code-pill,
        .pq-version-pill {
          display: inline-flex;
          align-items: center;
          padding: 3px 8px;
          border-radius: 7px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .pq-quote-metrics {
          display: flex;
          align-items: stretch;
          gap: 10px;
          flex-wrap: wrap;
        }
        .pq-metric-cell {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 8px 12px;
          border-radius: 10px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          min-width: 112px;
        }
        .pq-metric-cell-total {
          background: var(--pq-hero-bg);
          border-color: var(--pq-hero-border);
          min-width: 140px;
        }
        .pq-metric-label {
          font-size: 12px;
          color: var(--muted-color);
          font-weight: 600;
          margin-bottom: 2px;
        }
        .pq-metric-val {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-color);
        }
        .pq-metric-total-val {
          font-size: 17px;
          font-weight: 800;
          color: var(--text-color);
        }
        .pq-quote-card-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          padding-top: 12px;
          border-top: 1px solid var(--border-subtle);
        }
        .pq-action-group-left,
        .pq-action-group-right {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }
        .pq-converted-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 36px;
          padding: 6px 12px;
          border-radius: 999px;
          background: var(--success-subtle);
          border: 1px solid var(--success-text);
          color: var(--success-text);
          font-size: 12.5px;
          font-weight: 700;
        }

        /* Empty States */
        .pq-empty-icon-ring {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--accent-soft);
          color: var(--accent-text);
          border: 1px solid var(--pq-hero-border);
        }

        /* Editor Workspace (Create / Edit Quote) */
        .pq-editor-topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          padding-bottom: 4px;
        }
        .pq-editor-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.55fr) minmax(320px, 1fr);
          gap: 18px;
          align-items: start;
        }
        .pq-editor-summary-col {
          position: sticky;
          top: 14px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-width: 0;
        }
        .pq-step-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 14px;
        }
        .pq-step-title-group {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .pq-step-badge {
          width: 26px;
          height: 26px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--accent-soft);
          border: 1px solid var(--accent-text);
          color: var(--accent-text);
          font-size: 12.5px;
          font-weight: 800;
          flex-shrink: 0;
        }
        .pq-step-heading {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--text-color);
        }
        .pq-customer-grid,
        .pq-two-col-fields {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        /* Product Line Card */
        .pq-product-card {
          padding: 16px;
          border-radius: 13px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          transition: border-color 0.15s ease;
        }
        .pq-product-card:focus-within {
          border-color: var(--accent-text);
        }
        .pq-product-card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }
        .pq-catalog-quickbar {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          margin-bottom: 12px;
        }
        [data-testid="printquote-screen"] input:not([type="checkbox"]):not([type="radio"]):not([aria-invalid="true"]):focus-visible,
        [data-testid="printquote-screen"] select:not([aria-invalid="true"]):focus-visible,
        [data-testid="printquote-screen"] textarea:not([aria-invalid="true"]):focus-visible {
          border-color: var(--accent-text) !important;
          outline: 2px solid var(--focus-ring) !important;
          outline-offset: 0px !important;
        }
        .pq-field-label-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          min-height: 20px;
          margin-bottom: 6px;
          white-space: nowrap;
        }
        .pq-field-label-row label {
          margin-bottom: 0 !important;
          white-space: nowrap;
        }
        .pq-inline-label-action {
          background: transparent;
          border: none;
          padding: 0 2px;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.2;
          color: var(--accent-text);
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .pq-product-info-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(176px, 1.2fr) minmax(196px, 1.25fr);
          gap: 10px;
          align-items: end;
          margin-bottom: 12px;
        }
        .pq-qty-unit-pair {
          display: grid;
          grid-template-columns: minmax(108px, 1.45fr) minmax(74px, 0.85fr);
          gap: 8px;
          align-items: end;
        }
        .pq-pricing-pair-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .pq-internal-subpanel {
          padding: 12px;
          border-radius: 11px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
        }
        .pq-internal-subpanel-profit {
          background: var(--pq-profit-panel-bg);
          border-color: var(--pq-profit-panel-border);
        }
        .pq-internal-subpanel-title {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 7px;
          font-size: 12.5px;
          font-weight: 700;
          color: var(--text-color);
          margin-bottom: 10px;
        }
        .pq-subpanel-stack {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .pq-numeric-input {
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }
        .pq-checkbox-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          font-size: 13px;
          cursor: pointer;
        }
        .pq-advanced-box {
          padding: 14px;
          border-radius: 11px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        /* Executive Summary Right Column */
        .pq-summary-hero,
        .pq-hero-total-box {
          padding: 16px 18px;
          border-radius: 13px;
          background: var(--pq-hero-bg);
          border: 1px solid var(--pq-hero-border);
        }
        .pq-summary-hero-label,
        .pq-hero-total-label {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--accent-text);
          margin-bottom: 4px;
        }
        .pq-summary-hero-value,
        .pq-hero-total-amount {
          font-size: 26px;
          font-weight: 800;
          line-height: 1.2;
          letter-spacing: -0.02em;
          color: var(--text-color);
        }
        .pq-summary-hero-words {
          margin-top: 6px;
          font-size: 12.5px;
          line-height: 1.45;
          color: var(--muted-color);
        }
        .pq-internal-kpi-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .pq-kpi-mini-card {
          padding: 10px;
          border-radius: 10px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          min-width: 0;
        }
        .pq-kpi-mini-label {
          font-size: 12px;
          color: var(--muted-color);
          margin-bottom: 3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pq-kpi-mini-val {
          display: block;
          font-size: 13.5px;
          font-weight: 800;
          color: var(--text-color);
          overflow-wrap: anywhere;
        }
        .pq-summary-preview-box {
          padding: 12px;
          border-radius: 12px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
        }
        .pq-segmented-switch {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 3px;
          border-radius: 9px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
        }
        .pq-segmented-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 32px;
          padding: 4px 10px;
          border-radius: 7px;
          border: none;
          background: transparent;
          color: var(--muted-color);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .pq-segmented-btn[data-active="true"] {
          background: var(--primary-color);
          color: var(--inverse-text);
          font-weight: 700;
        }
        .pq-safe-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--success-subtle);
          color: var(--success-text);
          font-size: 12px;
          font-weight: 700;
        }
        .pq-empty-summary-box {
          padding: 20px 16px;
          border-radius: 12px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          text-align: center;
          color: var(--muted-color);
          font-size: 13px;
          line-height: 1.5;
        }
        .pq-action-card {
          padding: 14px;
          border-radius: 14px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          box-shadow: var(--shadow-sm);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        /* Catalog Picker Row */
        .pq-picker-row {
          width: 100%;
          text-align: left;
          padding: 12px 14px;
          border-radius: 11px;
          border: 1px solid var(--border-color);
          background: var(--surface-subtle);
          color: var(--text-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          transition: border-color 0.15s ease, background-color 0.15s ease;
        }
        .pq-picker-row:hover {
          border-color: var(--accent-text);
          background: var(--accent-soft);
        }

        /* Quote Detail View & Realistic A4 Paper Stage */
        .pq-detail-split-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.95fr);
          gap: 18px;
          align-items: start;
        }
        .pq-a4-stage {
          padding: 18px;
          border-radius: 12px;
          background: #1e293b;
          border: 1px solid var(--border-color);
          display: flex;
          justify-content: center;
        }
        :root[data-theme="light"] .pq-a4-stage,
        [data-theme="light"] .pq-a4-stage {
          background: #e2e8f0;
        }
        .pq-a4-iframe {
          width: 100%;
          max-width: 794px;
          height: 680px;
          border: none;
          border-radius: 6px;
          background: #FFFFFF;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.28);
        }
        .pq-version-drawer,
        .pq-version-card {
          padding: 12px 14px;
          border-radius: 11px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
        }
        .pq-version-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 0;
          border-bottom: 1px solid var(--border-subtle);
          font-size: 12.5px;
        }
        .pq-version-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

        /* Analytics Stat Cards & Tables */
        .pq-stat-card {
          padding: 16px 18px;
          border-radius: 14px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          box-shadow: var(--shadow-sm);
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .pq-stat-label {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--muted-color);
        }
        .pq-stat-value {
          font-size: 22px;
          font-weight: 800;
          line-height: 1.2;
          letter-spacing: -0.02em;
          color: var(--text-color);
          font-variant-numeric: tabular-nums;
        }
        .pq-stat-sub {
          font-size: 12px;
          color: var(--muted-color);
        }
        .pq-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .pq-table th {
          text-align: left;
          padding: 9px 10px;
          font-size: 12px;
          font-weight: 700;
          color: var(--muted-color);
          border-bottom: 1px solid var(--border-color);
          white-space: nowrap;
        }
        .pq-table td {
          padding: 10px;
          border-bottom: 1px solid var(--border-subtle);
          vertical-align: top;
        }
        .pq-table tbody tr:last-child td {
          border-bottom: none;
        }
        .pq-table-compact th,
        .pq-table-compact td {
          padding: 7px 8px;
          font-size: 12.5px;
        }

        /* Directory List Table (Customers & Vendors) */
        .pq-directory-card {
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          border-radius: 14px;
          box-shadow: var(--shadow-sm);
          overflow-x: auto;
        }
        .pq-directory-table th {
          background: var(--surface-subtle);
          padding: 11px 16px;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border-color);
          white-space: nowrap;
        }
        .pq-directory-table td {
          padding: 12px 16px;
          vertical-align: middle;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-color);
          font-size: 13.5px;
        }
        .pq-directory-table tbody tr {
          transition: background-color 0.14s ease;
        }
        .pq-directory-table tbody tr:hover {
          background: var(--surface-subtle);
        }
        .pq-directory-cell-primary {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .pq-directory-cell-primary .pq-code-pill {
          min-width: 56px;
          justify-content: center;
          flex-shrink: 0;
        }
        .pq-directory-name {
          font-weight: 700;
          font-size: 14px;
          color: var(--text-color);
          overflow-wrap: anywhere;
        }
        .pq-directory-muted {
          color: var(--muted-color);
          font-size: 13px;
        }

        /* Tablet & Mobile Responsive Adaptations */
        @media (max-width: 1180px) {
          .pq-product-info-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .pq-product-info-grid > div:first-child {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 1080px) {
          .pq-editor-grid,
          .pq-detail-split-layout {
            grid-template-columns: minmax(0, 1fr);
          }
          .pq-editor-summary-col {
            position: static;
          }
        }

        @media (max-width: 768px) {
          [data-testid="printquote-screen"] input:not([type="checkbox"]):not([type="radio"]),
          [data-testid="printquote-screen"] select,
          [data-testid="printquote-screen"] textarea {
            font-size: 16px !important;
            min-width: 0;
          }
          .pq-page-head {
            gap: 8px;
            margin-bottom: 0;
          }
          .pq-page-title {
            font-size: 17.5px;
          }
          .pq-page-subtitle {
            display: none !important;
          }
          .pq-module-nav {
            width: 100%;
            max-width: 100%;
            display: flex;
            flex-wrap: wrap;
            overflow-x: hidden;
            gap: 4px;
            margin-bottom: 12px;
            padding: 0 0 8px 0;
          }
          .pq-module-nav .pq-nav-count-pill {
            display: none;
          }
          .pq-module-nav-item {
            padding: 5px 9px;
            gap: 5px;
            font-size: 12px;
            border-radius: 8px;
            max-width: 100%;
          }
          .pq-customer-grid,
          .pq-two-col-fields,
          .pq-product-info-grid,
          .pq-pricing-pair-grid {
            grid-template-columns: minmax(0, 1fr);
          }
          .pq-internal-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .pq-internal-kpi-grid > div:last-child {
            grid-column: 1 / -1;
          }
          .pq-quote-card {
            padding: 14px;
          }
          .pq-quote-metrics {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }
          .pq-metric-cell,
          .pq-metric-cell-total {
            min-width: 0;
          }
          .pq-hero-total-box {
            width: 100%;
          }
          .pq-a4-stage {
            padding: 8px;
          }
          .pq-a4-iframe {
            height: 480px;
          }
          table.pq-table.rt-cards tfoot,
          table.pq-table.rt-cards tfoot tr {
            display: block;
            width: 100%;
          }
          table.pq-table.rt-cards tfoot td {
            display: inline-block;
            padding: 8px 6px !important;
          }
          .pq-directory-card {
            background: transparent;
            border: 0;
            border-radius: 0;
            box-shadow: none;
            overflow: visible;
          }
          .pq-directory-table tbody tr:hover {
            background: var(--surface-color);
          }
          .pq-directory-table .pq-btn-sm {
            min-height: 40px;
            padding: 8px 14px;
          }
        }

        @media (max-width: 400px) {
          .pq-module-nav-item {
            flex: 0 0 auto;
            padding: 5px 8px;
            font-size: 12px;
          }
          .pq-module-nav-item svg {
            display: none;
          }
          .pq-qty-unit-pair {
            grid-template-columns: minmax(0, 1fr);
          }
          .pq-filter-pills {
            width: 100%;
            overflow-x: auto;
            flex-wrap: nowrap;
            scrollbar-width: none;
          }
          .pq-filter-pills::-webkit-scrollbar {
            display: none;
          }
          .pq-action-group-left,
          .pq-action-group-right {
            width: 100%;
          }
          .pq-action-group-right .pq-btn {
            width: 100%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .pq-btn,
          .pq-module-nav-item,
          .pq-catalog-subnav-item,
          .pq-filter-pill,
          .pq-quote-card,
          .pq-product-card,
          .pq-picker-row {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
};
