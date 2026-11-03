import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { PageHeader } from '../../../../packages/ui/src/components/index.js';
import {
  ProfitMode,
  ProfitScope,
  VendorCostMode,
  ShippingAllocationStrategy,
  RoundingMode,
  calculatePrintQuote,
  buildCustomerSafePdfPayload,
  type VendorCostModeType,
  type ShippingAllocationStrategyType,
  type RoundingModeType,
  type PrintVendorData,
  type PrintVendorPriceItemData,
  type PrintCustomerData,
  type PrintQuoteData,
  type PrintOrderData,
  type PrintQuoteDashboardStats,
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
  type PrintQuoteTabId,
  type PrintQuoteViewMode,
  type DraftLineState,
} from './printquote/types.js';
import { PrintQuoteNavHeader } from './printquote/PrintQuoteNavHeader.js';
import { CreateQuoteTab } from './printquote/CreateQuoteTab.js';
import { QuotesListTab } from './printquote/QuotesListTab.js';
import { QuoteDetailView } from './printquote/QuoteDetailView.js';
import { VendorsCatalogTab } from './printquote/VendorsCatalogTab.js';
import { CustomersTab } from './printquote/CustomersTab.js';
import { OrdersTab } from './printquote/OrdersTab.js';
import { AnalyticsTab } from './printquote/AnalyticsTab.js';
import { PdfPreviewModal } from './printquote/PdfPreviewModal.js';
import { CatalogModalDialog } from './printquote/CatalogModalDialog.js';

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
    const explicitMode = (
      item as typeof item & {
        vendorCostMode?: VendorCostModeType | undefined;
      }
    ).vendorCostMode;
    const resolvedCost = resolveSavedQuoteLineCostState({
      quantity: item.quantity,
      unitVendorCost: item.unitVendorCost,
      totalVendorCost: item.totalVendorCost,
      vendorCostMode: explicitMode,
    });

    return {
      id: item.id || `ITEM-${idx + 1}`,
      vendorPriceItemId: item.vendorPriceItemId || '',
      name: item.name,
      specification: item.specification || '',
      unit: item.unit || 'sp',
      quantity: item.quantity,
      quantityInput: String(item.quantity),
      vendorCostMode: resolvedCost.vendorCostMode,
      vendorCostValue: resolvedCost.vendorCostValue,
      vendorCostInput: resolvedCost.vendorCostInput,
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
    } catch {
      // Ignore fetch errors in offline/SSR test environments
    } finally {
      setLoading(false);
    }
  }, []);

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
    validationErrors: string[];
    lineErrors: Record<string, DraftLineValidationError>;
    shippingError: string | null;
  }>(() => {
    const validation = validateQuoteDraftInputs(draftLines, shippingFeeInput);
    if (!validation.isValid) {
      return {
        calc: null,
        customerPdf: null,
        error:
          validation.errors[0] ||
          'Vui lòng nhập đầy đủ số lượng và đơn giá hợp lệ.',
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
          profitValue: line.profitValue,
        };
        const costVal = validLine.vendorCostValue;
        const baseLine: QuoteLineInput = {
          id: line.id || `ITEM-${idx + 1}`,
          name: line.name.trim() || `Sản phẩm #${idx + 1}`,
          specification: line.specification.trim(),
          unit: line.unit.trim() || 'tờ',
          quantity: validLine.quantity,
          profit: {
            mode: line.profitMode,
            scope: line.profitScope,
            value: validLine.profitValue,
          },
        };
        if (line.vendorCostMode === VendorCostMode.TOTAL_BATCH) {
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
      });
      const customerPdf = buildCustomerSafePdfPayload(calc);
      return {
        calc,
        customerPdf,
        error: null,
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
        validationErrors: [msg],
        lineErrors: {},
        shippingError: null,
      };
    }
  }, [
    draftLines,
    shippingFeeInput,
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
          return { ...line, vendorPriceItemId: '' };
        }
        const resolvedCost =
          found.pricing_mode === VendorCostMode.TOTAL_BATCH
            ? found.batch_total_cost
            : found.unit_cost;
        return {
          ...line,
          vendorPriceItemId: found.id,
          name: found.name,
          specification: found.specification || '',
          unit: found.unit || 'tờ',
          // Preserve user's typed quantity or keep empty "" so user enters real order quantity
          quantityInput:
            line.quantityInput !== undefined ? line.quantityInput : '',
          vendorCostMode: found.pricing_mode,
          vendorCostValue: resolvedCost,
          vendorCostInput: String(resolvedCost),
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
    const validation = validateQuoteDraftInputs(draftLines, shippingFeeInput);
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
    const safePdf = quote.customer_pdf_json;
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
    const validation = validateQuoteDraftInputs(draftLines, shippingFeeInput);
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

  const handleSaveQuote = async () => {
    setHasTouchedFields(true);
    const validation = validateQuoteDraftInputs(draftLines, shippingFeeInput);
    if (!validation.isValid || !livePricingResult.calc) {
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
          vendorCostInput: String(validLine.vendorCostValue),
          profitValue: validLine.profitValue,
          profitInput: String(validLine.profitValue),
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
          : 'Khởi tạo báo giá v1'),
      items: draftLines.map((line, i) => {
        const validLine = validation.lines[i] ?? {
          quantity: line.quantity,
          vendorCostValue: line.vendorCostValue,
          profitValue: line.profitValue,
        };
        const costVal = validLine.vendorCostValue;
        const legacyAmbiguous = line.ambiguousLegacyCost;
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
        text: `Đã lưu thành công báo giá ${saved.quote_code} (Phiên bản v${saved.current_version})!`,
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

  const handleConvertQuoteToOrder = async (quote: PrintQuoteData) => {
    const csrf = await getCsrfToken();
    const depositDefault = Math.round(quote.total_quote_amount * 0.5);
    const res = await fetch('/api/v1/print-quotes/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        'Idempotency-Key': `ord-from-${quote.id}`,
      },
      credentials: 'include',
      body: JSON.stringify({
        quote_id: quote.id,
        print_ordered_at: new Date().toISOString().slice(0, 10),
        deposit_required: depositDefault,
        deposit_paid: 0,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setBannerMessage({
        type: 'error',
        text:
          json?.error?.message || 'Không thể chuyển báo giá thành đơn hàng.',
      });
      return;
    }
    setBannerMessage({
      type: 'success',
      text: `Đã tạo đơn đặt in ${json.data.order_code} từ báo giá ${quote.quote_code}!`,
    });
    await loadAllData();
    navigateInternal('/print-quotes/orders');
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
  ) => {
    const csrf = await getCsrfToken();
    const res = await fetch(`/api/v1/print-quotes/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      credentials: 'include',
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setBannerMessage({
        type: 'success',
        text: 'Đã cập nhật tiến độ đơn hàng!',
      });
      await loadAllData();
    }
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
    if (res.ok) {
      await loadAllData();
      setPaymentOrderTarget(null);
      setPaymentAmount(0);
      setPaymentNote('');
      setBannerMessage({
        type: 'success',
        text: 'Đã ghi nhận thanh toán đơn hàng!',
      });
    }
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
  const showHeaderOnCurrentView = !isEditorView && viewMode !== 'detail';

  return (
    <div
      data-testid="printquote-screen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        width: '100%',
        maxWidth: '100%',
        paddingBottom: isEditorView ? '32px' : '96px',
        boxSizing: 'border-box',
      }}
    >
      {showHeaderOnCurrentView && (
        <PageHeader
          title="Báo giá in ấn & Quản lý đơn in"
          subtitle="Quản lý danh sách báo giá, lập báo giá mới ẩn giá vốn trên PDF A4, tra cứu bảng giá nhà in và theo dõi đơn hàng."
        />
      )}

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
            padding: '10px 14px',
            borderRadius: '10px',
            backgroundColor: 'var(--accent-soft)',
            border: '1px solid var(--accent-text)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            fontSize: '13px',
          }}
        >
          <div>
            <strong style={{ color: 'var(--accent-text)' }}>
              📝 Đang có bản nháp chưa lưu trong bộ nhớ tạm:
            </strong>{' '}
            <span>
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
              style={{
                minHeight: '44px',
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--primary-color)',
                color: 'var(--inverse-text)',
                fontWeight: 800,
                fontSize: '12.5px',
                cursor: 'pointer',
              }}
            >
              Tiếp tục nhập →
            </button>
            <button
              type="button"
              data-testid="pq-discard-draft-btn"
              onClick={() => {
                resetCleanNewDraft();
                setBannerMessage(null);
              }}
              style={{
                minHeight: '44px',
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--surface-color)',
                color: 'var(--text-color)',
                fontWeight: 600,
                fontSize: '12.5px',
                cursor: 'pointer',
              }}
            >
              Bỏ nháp
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
                  ambiguousLegacyCost: null,
                  profitMode: item.default_profit_mode,
                  profitScope: item.default_profit_scope,
                  profitValue: item.default_profit_value,
                  profitInput: String(item.default_profit_value),
                },
              ]);
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

      {/* HONEST REPORTS VIEW: /print-quotes/reports */}
      {viewMode === 'reports' && (
        <AnalyticsTab stats={stats} orders={orders} quotes={quotes} />
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
            style={{
              minHeight: '44px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid var(--accent-text)',
              backgroundColor: 'var(--accent-soft)',
              color: 'var(--accent-text)',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Ở lại tiếp tục nhập
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
              padding: '8px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'var(--danger-color)',
              color: '#FFFFFF',
              fontWeight: 800,
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
            style={{
              minHeight: '44px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'transparent',
              color: 'var(--text-color)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Giữ bản nháp đang nhập
          </button>
          <button
            type="button"
            data-testid="pq-replace-confirm-btn"
            onClick={() => {
              const act = pendingReplaceDraftAction;
              setPendingReplaceDraftAction(null);
              act?.();
            }}
            style={{
              minHeight: '44px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'var(--primary-color)',
              color: 'var(--inverse-text)',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Bỏ nháp cũ & mở mới
          </button>
        </div>
      </CatalogModalDialog>

      {loading && (
        <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
          Đang đồng bộ dữ liệu báo giá…
        </div>
      )}

      {/* Prevent iOS Safari auto-zoom on mobile inputs */}
      <style>{`
        @media (max-width: 768px) {
          [data-testid="printquote-screen"] input:not([type="checkbox"]):not([type="radio"]),
          [data-testid="printquote-screen"] select,
          [data-testid="printquote-screen"] textarea {
            font-size: 16px !important;
            min-width: 0;
          }
        }
      `}</style>
    </div>
  );
};
