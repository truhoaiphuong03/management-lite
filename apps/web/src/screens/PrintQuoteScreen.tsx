import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  validateQuoteDraftInputs,
  type DraftLineValidationError,
} from './helpers/printquote-helpers.js';
import type { UserRole } from '../types.js';
import {
  DEFAULT_DRAFT_LINE,
  cardStyle,
  type PrintQuoteTabId,
  type DraftLineState,
} from './printquote/types.js';
import { PrintQuoteNavHeader } from './printquote/PrintQuoteNavHeader.js';
import { CreateQuoteTab } from './printquote/CreateQuoteTab.js';
import { QuotesListTab } from './printquote/QuotesListTab.js';
import { VendorsCatalogTab } from './printquote/VendorsCatalogTab.js';
import { CustomersTab } from './printquote/CustomersTab.js';
import { OrdersTab } from './printquote/OrdersTab.js';
import { AnalyticsTab } from './printquote/AnalyticsTab.js';
import { PdfPreviewModal } from './printquote/PdfPreviewModal.js';

export type { PrintQuoteTabId } from './printquote/types.js';

export interface PrintQuoteScreenProps {
  role: UserRole;
  workspaceName?: string | undefined;
  onNavigate?: (path: string) => void;
  initialTab?: PrintQuoteTabId | undefined;
  initialVendors?: PrintVendorData[] | undefined;
  initialPriceItems?: PrintVendorPriceItemData[] | undefined;
  initialCustomers?: PrintCustomerData[] | undefined;
  initialQuotes?: PrintQuoteData[] | undefined;
  initialOrders?: PrintOrderData[] | undefined;
  initialStats?: PrintQuoteDashboardStats | undefined;
}

export const PrintQuoteScreen: React.FC<PrintQuoteScreenProps> = ({
  role,
  workspaceName = 'Hoài Phương Media',
  initialTab = 'create',
  initialVendors = [],
  initialPriceItems = [],
  initialCustomers = [],
  initialQuotes = [],
  initialOrders = [],
  initialStats = null,
}) => {
  const [activeTab, setActiveTab] = useState<PrintQuoteTabId>(initialTab);
  const [loading, setLoading] = useState<boolean>(false);
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

  // Tab 1: Create / Edit Quote State
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [editingQuoteCode, setEditingQuoteCode] = useState<string | null>(null);
  const [editingQuoteVersion, setEditingQuoteVersion] = useState<number>(1);
  const [quoteTitle, setQuoteTitle] = useState<string>(
    'Báo giá in ấn ấn phẩm truyền thông',
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [validUntil, setValidUntil] = useState<string>('');
  const [shippingFee, setShippingFee] = useState<number>(50000);
  const [shippingFeeInput, setShippingFeeInput] = useState<string>('50000');
  const [includeShippingInUnitPrice, setIncludeShippingInUnitPrice] =
    useState<boolean>(true);
  const [shippingAllocation, setShippingAllocation] =
    useState<ShippingAllocationStrategyType>(
      ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT,
    );
  const [roundingMode, setRoundingMode] = useState<RoundingModeType>(
    RoundingMode.CEIL,
  );
  const [roundingStep, setRoundingStep] = useState<number>(1);
  const [customerNotes, setCustomerNotes] = useState<string>(
    '1. Đơn giá trên đã tính theo đúng quy cách và số lượng đặt in.\n2. Thời gian giao hàng dự kiến: 2–4 ngày làm việc kể từ khi chốt file in và đặt cọc.',
  );
  const [internalNotes, setInternalNotes] = useState<string>('');
  const [versionChangeNote, setVersionChangeNote] = useState<string>('');
  const [draftLines, setDraftLines] = useState<DraftLineState[]>([
    DEFAULT_DRAFT_LINE(1),
  ]);

  // A4 PDF Preview Modal State
  const [pdfPreviewState, setPdfPreviewState] = useState<{
    title: string;
    html: string;
    quoteId?: string | null;
    quoteCode: string;
  } | null>(null);

  // Expanded Quote Version History ID
  const [expandedQuoteHistoryId, setExpandedQuoteHistoryId] = useState<
    string | null
  >(null);

  // Tab 3: New Vendor & Price Item Forms
  const [vendorName, setVendorName] = useState<string>('');
  const [vendorPhone, setVendorPhone] = useState<string>('');
  const [vendorBankName, setVendorBankName] = useState<string>('');
  const [vendorBankAccount, setVendorBankAccount] = useState<string>('');

  const [priceVendorId, setPriceVendorId] = useState<string>('');
  const [priceItemName, setPriceItemName] = useState<string>('');
  const [priceSpec, setPriceSpec] = useState<string>('');
  const [priceCostMode, setPriceCostMode] = useState<VendorCostModeType>(
    VendorCostMode.PER_UNIT,
  );
  const [priceUnitCost, setPriceUnitCost] = useState<number>(300);
  const [priceBatchCost, setPriceBatchCost] = useState<number>(300000);
  const [priceDefaultProfitVal, setPriceDefaultProfitVal] =
    useState<number>(200);

  // Tab 4: New Customer Form
  const [custName, setCustName] = useState<string>('');
  const [custCompany, setCustCompany] = useState<string>('');
  const [custPhone, setCustPhone] = useState<string>('');
  const [custAddress, setCustAddress] = useState<string>('');

  // Tab 5: Payment Modal / Inline Form
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

  // Live Pricing Engine Calculation (Strict validation: no fake totals when required inputs are empty/invalid)
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
          vendorCostMode: found.pricing_mode,
          vendorCostValue: resolvedCost,
          vendorCostInput: String(resolvedCost),
          profitMode: found.default_profit_mode,
          profitScope: found.default_profit_scope,
          profitValue: found.default_profit_value,
          profitInput: String(found.default_profit_value),
        };
      }),
    );
  };

  const handleOpenLiveA4Preview = () => {
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
      quoteTitle,
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
    if (editingQuoteId && editingQuoteCode) {
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
            quoteTitle,
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

    const csrf = await getCsrfToken();
    const payload = {
      customer_id: selectedCustomerId || null,
      title: quoteTitle.trim() || 'Báo giá in ấn',
      shipping_fee: validation.shippingFee,
      include_shipping_in_unit_price: includeShippingInUnitPrice,
      shipping_allocation_strategy: shippingAllocation,
      rounding_mode: roundingMode,
      rounding_step: Math.max(1, Math.round(Number(roundingStep) || 1)),
      valid_until: validUntil || null,
      notes: customerNotes || null,
      internal_notes: internalNotes || null,
      change_note:
        versionChangeNote.trim() ||
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
        return {
          id: line.id || `ITEM-${i + 1}`,
          vendor_price_item_id: line.vendorPriceItemId || undefined,
          name: line.name.trim() || `Ấn phẩm #${i + 1}`,
          specification: line.specification.trim() || undefined,
          unit: line.unit.trim() || 'tờ',
          quantity: validLine.quantity,
          unitVendorCost:
            line.vendorCostMode === VendorCostMode.PER_UNIT
              ? costVal
              : undefined,
          totalVendorCost:
            line.vendorCostMode === VendorCostMode.TOTAL_BATCH
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
        ? `/api/v1/print-quotes/quotes/${editingQuoteId}`
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
      const json = await res.json();
      if (!res.ok) {
        setBannerMessage({
          type: 'error',
          text: json?.error?.message || 'Không thể lưu báo giá.',
        });
        return;
      }
      const saved: PrintQuoteData = json.data;
      setEditingQuoteId(saved.id);
      setEditingQuoteCode(saved.quote_code);
      setEditingQuoteVersion(saved.current_version);
      setBannerMessage({
        type: 'success',
        text: `Đã lưu thành công báo giá ${saved.quote_code} (Phiên bản v${saved.current_version})!`,
      });
      await loadAllData();
    } catch {
      setBannerMessage({
        type: 'error',
        text: 'Lỗi kết nối máy chủ khi lưu báo giá.',
      });
    }
  };

  const handleLoadQuoteForEdit = (quote: PrintQuoteData) => {
    setEditingQuoteId(quote.id);
    setEditingQuoteCode(quote.quote_code);
    setEditingQuoteVersion(quote.current_version);
    setQuoteTitle(quote.title);
    setSelectedCustomerId(quote.customer_id || '');
    setValidUntil(quote.valid_until || '');
    setShippingFee(quote.shipping_fee);
    setShippingFeeInput(String(quote.shipping_fee));
    setIncludeShippingInUnitPrice(quote.include_shipping_in_unit_price);
    setShippingAllocation(quote.shipping_allocation_strategy);
    setRoundingMode(quote.rounding_mode);
    setRoundingStep(quote.rounding_step);
    setCustomerNotes(quote.notes || '');
    setVersionChangeNote('');

    if (quote.lines_json && quote.lines_json.length > 0) {
      setDraftLines(
        quote.lines_json.map((item, idx) => {
          const isExactPerUnit =
            Number.isInteger(item.unitVendorCost) &&
            Math.round(item.unitVendorCost * item.quantity) ===
              Math.round(item.totalVendorCost);
          const resolvedCostMode = isExactPerUnit
            ? VendorCostMode.PER_UNIT
            : VendorCostMode.TOTAL_BATCH;
          const resolvedCostValue = isExactPerUnit
            ? item.unitVendorCost
            : item.totalVendorCost;

          return {
            id: item.id || `ITEM-${idx + 1}`,
            vendorPriceItemId: item.vendorPriceItemId || '',
            name: item.name,
            specification: item.specification || '',
            unit: item.unit || 'sp',
            quantity: item.quantity,
            quantityInput: String(item.quantity),
            vendorCostMode: resolvedCostMode,
            vendorCostValue: resolvedCostValue,
            vendorCostInput: String(resolvedCostValue),
            profitMode: item.profitMode,
            profitScope: item.profitScope,
            profitValue: item.profitInputValue,
            profitInput: String(item.profitInputValue),
          };
        }),
      );
    }
    setActiveTab('create');
  };

  const handleResetNewQuote = () => {
    setEditingQuoteId(null);
    setEditingQuoteCode(null);
    setEditingQuoteVersion(1);
    setQuoteTitle('Báo giá in ấn ấn phẩm truyền thông');
    setSelectedCustomerId('');
    setValidUntil('');
    setShippingFee(50000);
    setShippingFeeInput('50000');
    setIncludeShippingInUnitPrice(true);
    setDraftLines([DEFAULT_DRAFT_LINE(1)]);
    setVersionChangeNote('');
    setBannerMessage(null);
  };

  const handleFinalizeQuote = async (quoteId: string) => {
    const csrf = await getCsrfToken();
    const res = await fetch(`/api/v1/print-quotes/quotes/${quoteId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      credentials: 'include',
      body: JSON.stringify({}),
    });
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
    const json = await res.json();
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
    setActiveTab('orders');
  };

  const handleCreateVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorName.trim()) return;
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
    if (res.ok) {
      setVendorName('');
      setVendorPhone('');
      setVendorBankName('');
      setVendorBankAccount('');
      setBannerMessage({
        type: 'success',
        text: 'Đã thêm Nhà in mới thành công!',
      });
      await loadAllData();
    }
  };

  const handleCreatePriceItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVendorId = priceVendorId || vendors[0]?.id;
    if (!targetVendorId || !priceItemName.trim()) return;
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
        unit: 'tờ',
        pricing_mode: priceCostMode,
        unit_cost: priceUnitCost,
        batch_total_cost: priceBatchCost,
        default_profit_mode: ProfitMode.FIXED_AMOUNT,
        default_profit_scope: ProfitScope.PER_UNIT,
        default_profit_value: priceDefaultProfitVal,
      }),
    });
    if (res.ok) {
      setPriceItemName('');
      setPriceSpec('');
      setBannerMessage({
        type: 'success',
        text: 'Đã thêm hạng mục vào Bảng giá nhà in!',
      });
      await loadAllData();
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName.trim()) return;
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
    if (res.ok) {
      setCustName('');
      setCustCompany('');
      setCustPhone('');
      setCustAddress('');
      setBannerMessage({
        type: 'success',
        text: 'Đã lưu hồ sơ Khách hàng mới!',
      });
      await loadAllData();
    }
  };

  // Requirement 4: Inline quick-add customer directly inside Create Quote
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
        text: 'Đã cập nhật tiến độ / chi phí đơn hàng!',
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
        text: 'Đã ghi nhận thanh toán & cập nhật công nợ đơn hàng!',
      });
    }
  };

  if (role !== 'owner') {
    return (
      <div style={{ padding: '24px' }} data-testid="printquote-forbidden">
        <PageHeader
          title="Báo giá in ấn"
          subtitle="Phân hệ quản lý giá vốn nhà in, lợi nhuận và công nợ dành riêng cho Chủ sở hữu."
        />
        <div style={cardStyle}>
          Chỉ Chủ sở hữu (Owner) mới được phép truy cập dữ liệu giá nhà in và
          lợi nhuận báo giá.
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="printquote-screen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        width: '100%',
        maxWidth: '100%',
        paddingBottom: '96px',
        boxSizing: 'border-box',
      }}
    >
      <PageHeader
        title="Báo giá in ấn & Quản lý đơn in"
        subtitle="Tạo báo giá nhanh cho khách, tự tính lời trên từng sản phẩm, xuất file PDF A4 ẩn giá vốn và theo dõi công nợ."
      />

      <PrintQuoteNavHeader
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        quotesCount={quotes.length}
        priceItemsCount={priceItems.length}
        customersCount={customers.length}
        ordersCount={orders.length}
      />

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
          }}
        >
          <span>{bannerMessage.text}</span>
          <button
            type="button"
            aria-label="Đóng thông báo"
            onClick={() => setBannerMessage(null)}
            style={{
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

      {/* TAB 1: TẠO BÁO GIÁ (4 NHÓM THU GỌN TRÊN 1 MÀN HÌNH) */}
      {activeTab === 'create' && (
        <CreateQuoteTab
          editingQuoteId={editingQuoteId}
          editingQuoteCode={editingQuoteCode}
          editingQuoteVersion={editingQuoteVersion}
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
          onResetNewQuote={handleResetNewQuote}
          onSaveQuote={handleSaveQuote}
          onDownloadLivePdf={handleDownloadLivePdfFile}
          onOpenLivePreview={handleOpenLiveA4Preview}
          onQuickCreateCustomer={handleInlineCreateCustomer}
        />
      )}

      {/* TAB 2: DANH SÁCH BÁO GIÁ */}
      {activeTab === 'quotes' && (
        <QuotesListTab
          quotes={quotes}
          expandedQuoteHistoryId={expandedQuoteHistoryId}
          setExpandedQuoteHistoryId={setExpandedQuoteHistoryId}
          onStartNewQuote={() => {
            handleResetNewQuote();
            setActiveTab('create');
          }}
          onDownloadSavedQuotePdfFile={handleDownloadSavedQuotePdfFile}
          onOpenSavedQuotePdf={handleOpenSavedQuotePdf}
          onLoadQuoteForEdit={handleLoadQuoteForEdit}
          onFinalizeQuote={handleFinalizeQuote}
          onConvertQuoteToOrder={handleConvertQuoteToOrder}
        />
      )}

      {/* TAB 3: NHÀ IN & BẢNG GIÁ */}
      {activeTab === 'vendors' && (
        <VendorsCatalogTab
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
          priceCostMode={priceCostMode}
          setPriceCostMode={setPriceCostMode}
          priceUnitCost={priceUnitCost}
          setPriceUnitCost={setPriceUnitCost}
          priceBatchCost={priceBatchCost}
          setPriceBatchCost={setPriceBatchCost}
          priceDefaultProfitVal={priceDefaultProfitVal}
          setPriceDefaultProfitVal={setPriceDefaultProfitVal}
          onCreatePriceItem={handleCreatePriceItem}
          onQuickQuotePriceItem={(item) => {
            const resolvedCost =
              item.pricing_mode === VendorCostMode.TOTAL_BATCH
                ? item.batch_total_cost
                : item.unit_cost;
            setDraftLines([
              {
                id: 'ITEM-1',
                vendorPriceItemId: item.id,
                name: item.name,
                specification: item.specification || '',
                unit: item.unit || 'tờ',
                quantity: 100,
                quantityInput: '100',
                vendorCostMode: item.pricing_mode,
                vendorCostValue: resolvedCost,
                vendorCostInput: String(resolvedCost),
                profitMode: item.default_profit_mode,
                profitScope: item.default_profit_scope,
                profitValue: item.default_profit_value,
                profitInput: String(item.default_profit_value),
              },
            ]);
            setActiveTab('create');
          }}
        />
      )}

      {/* TAB 4: KHÁCH HÀNG */}
      {activeTab === 'customers' && (
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
            setSelectedCustomerId(customerId);
            setActiveTab('create');
          }}
        />
      )}

      {/* TAB 5: ĐƠN HÀNG */}
      {activeTab === 'orders' && (
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

      {/* TAB 6: LỢI NHUẬN & CÔNG NỢ */}
      {activeTab === 'analytics' && (
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

      {loading && (
        <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
          Đang đồng bộ dữ liệu báo giá…
        </div>
      )}

      {/* Ngăn iOS Safari tự phóng to (auto-zoom) khi chạm vào ô nhập số/chữ trên iPhone */}
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
