import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  PageHeader,
  StatusBadge,
} from '../../../../packages/ui/src/components/index.js';
import {
  ProfitMode,
  ProfitScope,
  VendorCostMode,
  ShippingAllocationStrategy,
  RoundingMode,
  PrintProductionStatus,
  PrintDeliveryStatus,
  calculatePrintQuote,
  buildCustomerSafePdfPayload,
  type ProfitModeType,
  type ProfitScopeType,
  type VendorCostModeType,
  type ShippingAllocationStrategyType,
  type RoundingModeType,
  type PrintProductionStatusType,
  type PrintDeliveryStatusType,
  type PrintVendorData,
  type PrintVendorPriceItemData,
  type PrintCustomerData,
  type PrintQuoteData,
  type PrintOrderData,
  type PrintQuoteDashboardStats,
  type QuoteLineInput,
} from '../../../../packages/contracts/src/printquote.js';
import {
  formatVnd,
  formatNumberVn,
  formatDateVn,
  numberToVietnameseWords,
  QUOTE_STATUS_LABELS,
  PRODUCTION_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  buildPrintQuoteA4Html,
} from './helpers/printquote-helpers.js';
import type { UserRole } from '../types.js';

export type PrintQuoteTabId =
  | 'create'
  | 'quotes'
  | 'vendors'
  | 'customers'
  | 'orders'
  | 'analytics';

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

interface DraftLineState {
  id: string;
  vendorPriceItemId: string;
  name: string;
  specification: string;
  unit: string;
  quantity: number;
  vendorCostMode: VendorCostModeType;
  vendorCostValue: number;
  profitMode: ProfitModeType;
  profitScope: ProfitScopeType;
  profitValue: number;
}

const DEFAULT_DRAFT_LINE = (index: number): DraftLineState => ({
  id: `ITEM-${index}`,
  vendorPriceItemId: '',
  name:
    index === 1 ? 'Tờ rơi A5 Couche 150gsm (In 2 mặt)' : `Ấn phẩm #${index}`,
  specification:
    index === 1 ? 'In Offset 4 màu, cán bóng 2 mặt, cắt thành phẩm' : '',
  unit: 'tờ',
  quantity: 100,
  vendorCostMode: VendorCostMode.PER_UNIT,
  vendorCostValue: 300,
  profitMode: ProfitMode.FIXED_AMOUNT,
  profitScope: ProfitScope.PER_UNIT,
  profitValue: 200,
});

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '38px',
  padding: '7px 10px',
  borderRadius: '8px',
  border: '1px solid var(--border-color)',
  backgroundColor: 'var(--bg-color)',
  color: 'var(--text-color)',
  fontSize: '13px',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--muted-color)',
  marginBottom: '4px',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface-color)',
  border: '1px solid var(--border-color)',
  borderRadius: '12px',
  padding: '16px',
  boxSizing: 'border-box',
};

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
    'DEPOSIT' | 'INSTALLMENT' | 'FINAL'
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

  // Live Pricing Engine Calculation
  const livePricingResult = useMemo(() => {
    try {
      const itemsInput: QuoteLineInput[] = draftLines.map((line, idx) => {
        const costVal = Math.max(0, Number(line.vendorCostValue) || 0);
        const baseLine: QuoteLineInput = {
          id: line.id || `ITEM-${idx + 1}`,
          name: line.name.trim() || `Sản phẩm #${idx + 1}`,
          specification: line.specification.trim(),
          unit: line.unit.trim() || 'tờ',
          quantity: Math.max(1, Math.round(Number(line.quantity) || 1)),
          profit: {
            mode: line.profitMode,
            scope: line.profitScope,
            value: Math.max(0, Number(line.profitValue) || 0),
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
        shippingFee: Math.max(0, Math.round(Number(shippingFee) || 0)),
        includeShippingInUnitPrice,
        shippingAllocationStrategy: shippingAllocation,
        roundingPolicy: {
          mode: roundingMode,
          step: Math.max(1, Math.round(Number(roundingStep) || 1)),
        },
      });
      const customerPdf = buildCustomerSafePdfPayload(calc);
      return { calc, customerPdf, error: null };
    } catch (err) {
      return {
        calc: null,
        customerPdf: null,
        error: err instanceof Error ? err.message : 'Lỗi tính toán báo giá',
      };
    }
  }, [
    draftLines,
    shippingFee,
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
        return {
          ...line,
          vendorPriceItemId: found.id,
          name: found.name,
          specification: found.specification || '',
          unit: found.unit || 'tờ',
          vendorCostMode: found.pricing_mode,
          vendorCostValue:
            found.pricing_mode === VendorCostMode.TOTAL_BATCH
              ? found.batch_total_cost
              : found.unit_cost,
          profitMode: found.default_profit_mode,
          profitScope: found.default_profit_scope,
          profitValue: found.default_profit_value,
        };
      }),
    );
  };

  const handleOpenLiveA4Preview = () => {
    if (!livePricingResult.customerPdf) return;
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
    });
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
    setBannerMessage(null);
    const csrf = await getCsrfToken();
    const payload = {
      customer_id: selectedCustomerId || null,
      title: quoteTitle.trim() || 'Báo giá in ấn',
      shipping_fee: Math.max(0, Math.round(Number(shippingFee) || 0)),
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
        const costVal = Math.max(0, Number(line.vendorCostValue) || 0);
        return {
          id: line.id || `ITEM-${i + 1}`,
          vendor_price_item_id: line.vendorPriceItemId || undefined,
          name: line.name.trim() || `Ấn phẩm #${i + 1}`,
          specification: line.specification.trim() || undefined,
          unit: line.unit.trim() || 'tờ',
          quantity: Math.max(1, Math.round(Number(line.quantity) || 1)),
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
          profitValue: Math.max(0, Number(line.profitValue) || 0),
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
    setIncludeShippingInUnitPrice(quote.include_shipping_in_unit_price);
    setShippingAllocation(quote.shipping_allocation_strategy);
    setRoundingMode(quote.rounding_mode);
    setRoundingStep(quote.rounding_step);
    setCustomerNotes(quote.notes || '');
    setVersionChangeNote('');

    if (quote.lines_json && quote.lines_json.length > 0) {
      setDraftLines(
        quote.lines_json.map((item, idx) => ({
          id: item.id || `ITEM-${idx + 1}`,
          vendorPriceItemId: item.vendorPriceItemId || '',
          name: item.name,
          specification: item.specification || '',
          unit: item.unit || 'sp',
          quantity: item.quantity,
          vendorCostMode: VendorCostMode.PER_UNIT,
          vendorCostValue: item.unitVendorCost,
          profitMode: item.profitMode,
          profitScope: item.profitScope,
          profitValue: item.profitInputValue,
        })),
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
        text: json?.error?.message || 'Không thể chuyển báo giá thành đơn hàng.',
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
      setPaymentOrderTarget(null);
      setPaymentAmount(0);
      setPaymentNote('');
      setBannerMessage({
        type: 'success',
        text: 'Đã ghi nhận thanh toán & cập nhật công nợ đơn hàng!',
      });
      await loadAllData();
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

  const tabs: Array<{ id: PrintQuoteTabId; label: string; testId: string }> = [
    { id: 'create', label: '1. Tạo báo giá', testId: 'tab-create-quote' },
    {
      id: 'quotes',
      label: `2. Danh sách báo giá (${quotes.length})`,
      testId: 'tab-quotes-list',
    },
    {
      id: 'vendors',
      label: `3. Nhà in & Bảng giá (${priceItems.length})`,
      testId: 'tab-vendors-catalog',
    },
    {
      id: 'customers',
      label: `4. Khách hàng (${customers.length})`,
      testId: 'tab-customers',
    },
    {
      id: 'orders',
      label: `5. Đơn hàng (${orders.length})`,
      testId: 'tab-orders',
    },
    {
      id: 'analytics',
      label: '6. Lợi nhuận & Công nợ',
      testId: 'tab-profit-debt',
    },
  ];

  const ordersInProdCount = stats?.orders_by_production_status
    ? (stats.orders_by_production_status.PENDING || 0) +
      (stats.orders_by_production_status.PREPRESS || 0) +
      (stats.orders_by_production_status.PRINTING || 0) +
      (stats.orders_by_production_status.FINISHING || 0)
    : 0;
  const ordersPendingDeliveryCount = stats?.orders_by_delivery_status
    ? (stats.orders_by_delivery_status.NOT_SHIPPED || 0) +
      (stats.orders_by_delivery_status.PACKING || 0) +
      (stats.orders_by_delivery_status.SHIPPING || 0)
    : 0;

  return (
    <div
      data-testid="printquote-screen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      <PageHeader
        title="Báo giá in ấn & Quản lý đơn in"
        subtitle="Tính giá in tự động (đơn vị/lô, lợi nhuận VNĐ/%, phân bổ ship 1 lần), lưu lịch sử phiên bản, xuất PDF A4 tiếng Việt ẩn giá vốn và theo dõi công nợ."
      />

      {/* 6-Tab Sub-Navigation Bar */}
      <div
        role="tablist"
        aria-label="Chức năng Báo giá in ấn"
        style={{
          display: 'flex',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '4px',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={tab.testId}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '9px 14px',
                borderRadius: '8px',
                border: active
                  ? '1px solid var(--accent-text)'
                  : '1px solid transparent',
                backgroundColor: active
                  ? 'var(--accent-soft)'
                  : 'var(--surface-color)',
                color: active ? 'var(--accent-text)' : 'var(--text-color)',
                fontWeight: active ? 700 : 500,
                fontSize: '13px',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

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

      {/* TAB 1: TẠO BÁO GIÁ */}
      {activeTab === 'create' && (
        <div
          data-testid="panel-create-quote"
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          {/* Quote General Info & Shipping Config */}
          <div style={cardStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '12px',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                {editingQuoteId
                  ? `Đang chỉnh sửa Báo giá ${editingQuoteCode} (Lưu sẽ tạo Phiên bản v${editingQuoteVersion + 1})`
                  : '1. Thông tin chung & Cấu hình vận chuyển'}
              </h2>
              {editingQuoteId && (
                <button
                  type="button"
                  onClick={handleResetNewQuote}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'transparent',
                    color: 'var(--text-color)',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  + Tạo báo giá mới tinh
                </button>
              )}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '12px',
              }}
            >
              <div>
                <label style={labelStyle} htmlFor="pq-title-input">
                  Tiêu đề báo giá *
                </label>
                <input
                  id="pq-title-input"
                  data-testid="pq-title-input"
                  style={inputStyle}
                  value={quoteTitle}
                  onChange={(e) => setQuoteTitle(e.target.value)}
                  placeholder="VD: Báo giá in tờ rơi & hộp giấy"
                />
              </div>

              <div>
                <label style={labelStyle} htmlFor="pq-customer-select">
                  Khách hàng nhận báo giá
                </label>
                <select
                  id="pq-customer-select"
                  data-testid="pq-customer-select"
                  style={inputStyle}
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                >
                  <option value="">-- Khách lẻ / Chọn khách hàng --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}{' '}
                      {c.company_name ? `(${c.company_name})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle} htmlFor="pq-shipping-input">
                  Cước vận chuyển toàn đơn (VNĐ — tính 1 lần)
                </label>
                <input
                  id="pq-shipping-input"
                  data-testid="pq-shipping-input"
                  type="number"
                  min={0}
                  step={1000}
                  style={inputStyle}
                  value={shippingFee}
                  onChange={(e) =>
                    setShippingFee(Math.max(0, Number(e.target.value) || 0))
                  }
                />
              </div>

              <div>
                <label style={labelStyle} htmlFor="pq-valid-until">
                  Hiệu lực báo giá đến ngày
                </label>
                <input
                  id="pq-valid-until"
                  type="date"
                  style={inputStyle}
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '12px',
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: '1px solid var(--border-color)',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <input
                  id="pq-merge-ship-checkbox"
                  data-testid="pq-merge-ship-checkbox"
                  type="checkbox"
                  checked={includeShippingInUnitPrice}
                  onChange={(e) =>
                    setIncludeShippingInUnitPrice(e.target.checked)
                  }
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label
                  htmlFor="pq-merge-ship-checkbox"
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    cursor: 'pointer',
                  }}
                >
                  Gộp cước vận chuyển vào đơn giá khách (Ẩn dòng ship trên PDF)
                </label>
              </div>

              <div>
                <label style={labelStyle} htmlFor="pq-ship-alloc-select">
                  Chiến lược phân bổ ship (khi có nhiều sản phẩm)
                </label>
                <select
                  id="pq-ship-alloc-select"
                  style={inputStyle}
                  value={shippingAllocation}
                  onChange={(e) =>
                    setShippingAllocation(
                      e.target.value as ShippingAllocationStrategyType,
                    )
                  }
                >
                  <option
                    value={
                      ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT
                    }
                  >
                    Theo tỷ trọng (Giá vốn + Lợi nhuận)
                  </option>
                  <option
                    value={ShippingAllocationStrategy.PROPORTIONAL_BY_QUANTITY}
                  >
                    Theo tỷ lệ Số lượng đặt in
                  </option>
                  <option value={ShippingAllocationStrategy.EQUAL_SPLIT}>
                    Chia đều cho từng dòng sản phẩm
                  </option>
                </select>
              </div>

              <div>
                <label style={labelStyle} htmlFor="pq-rounding-step-select">
                  Chính sách làm tròn đơn giá khách
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <select
                    id="pq-rounding-step-select"
                    aria-label="Kiểu làm tròn đơn giá"
                    style={inputStyle}
                    value={roundingMode}
                    onChange={(e) =>
                      setRoundingMode(e.target.value as RoundingModeType)
                    }
                  >
                    <option value={RoundingMode.CEIL}>
                      Làm tròn lên (Bảo vệ lợi nhuận)
                    </option>
                    <option value={RoundingMode.NEAREST}>
                      Làm tròn chuẩn (Nearest)
                    </option>
                    <option value={RoundingMode.FLOOR}>Làm tròn xuống</option>
                  </select>
                  <select
                    aria-label="Bước làm tròn VNĐ"
                    style={{ ...inputStyle, maxWidth: '115px' }}
                    value={roundingStep}
                    onChange={(e) =>
                      setRoundingStep(Number(e.target.value) || 1)
                    }
                  >
                    <option value={1}>1 ₫ (Chính xác)</option>
                    <option value={100}>100 ₫</option>
                    <option value={1000}>1.000 ₫</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Product Lines Editor */}
          <div style={cardStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '12px',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                2. Danh mục sản phẩm đặt in ({draftLines.length} hạng mục)
              </h2>
              <button
                type="button"
                data-testid="pq-add-line-btn"
                onClick={() =>
                  setDraftLines((prev) => [
                    ...prev,
                    DEFAULT_DRAFT_LINE(prev.length + 1),
                  ])
                }
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--accent-text)',
                  backgroundColor: 'var(--accent-soft)',
                  color: 'var(--accent-text)',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                + Thêm sản phẩm in
              </button>
            </div>

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              {draftLines.map((line, idx) => (
                <div
                  key={line.id}
                  data-testid={`pq-line-card-${idx}`}
                  style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    padding: '12px',
                    backgroundColor: 'var(--bg-color)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '10px',
                      gap: '8px',
                    }}
                  >
                    <strong
                      style={{ fontSize: '13.5px', color: 'var(--accent-text)' }}
                    >
                      Sản phẩm #{idx + 1}
                    </strong>
                    {draftLines.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setDraftLines((prev) =>
                            prev.filter((_, i) => i !== idx),
                          )
                        }
                        style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          border: '1px solid var(--danger-text)',
                          backgroundColor: 'transparent',
                          color: 'var(--danger-text)',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Xóa dòng
                      </button>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                      gap: '10px',
                    }}
                  >
                    <div>
                      <label style={labelStyle}>
                        Nạp nhanh từ Bảng giá Nhà in
                      </label>
                      <select
                        aria-label={`Chọn bảng giá nhà in dòng ${idx + 1}`}
                        style={inputStyle}
                        value={line.vendorPriceItemId}
                        onChange={(e) =>
                          handleSelectCatalogItem(idx, e.target.value)
                        }
                      >
                        <option value="">
                          -- Tự nhập thông số bên dưới --
                        </option>
                        {priceItems.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} — {p.name} (
                            {p.pricing_mode === 'TOTAL_BATCH'
                              ? `Lô: ${formatVnd(p.batch_total_cost)}`
                              : `${formatVnd(p.unit_cost)}/${p.unit}`}
                            )
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={labelStyle}>Tên sản phẩm in *</label>
                      <input
                        aria-label={`Tên sản phẩm dòng ${idx + 1}`}
                        style={inputStyle}
                        value={line.name}
                        onChange={(e) =>
                          setDraftLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, name: e.target.value } : l,
                            ),
                          )
                        }
                      />
                    </div>

                    <div>
                      <label style={labelStyle}>Quy cách / Chất liệu</label>
                      <input
                        aria-label={`Quy cách dòng ${idx + 1}`}
                        style={inputStyle}
                        value={line.specification}
                        onChange={(e) =>
                          setDraftLines((prev) =>
                            prev.map((l, i) =>
                              i === idx
                                ? { ...l, specification: e.target.value }
                                : l,
                            ),
                          )
                        }
                        placeholder="VD: C150, in 2 mặt, cán mờ"
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <div style={{ flex: 2 }}>
                        <label style={labelStyle}>Số lượng *</label>
                        <input
                          aria-label={`Số lượng dòng ${idx + 1}`}
                          type="number"
                          min={1}
                          style={inputStyle}
                          value={line.quantity}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((l, i) =>
                                i === idx
                                  ? {
                                      ...l,
                                      quantity: Math.max(
                                        1,
                                        Math.round(Number(e.target.value) || 1),
                                      ),
                                    }
                                  : l,
                              ),
                            )
                          }
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={labelStyle}>ĐVT</label>
                        <input
                          aria-label={`Đơn vị tính dòng ${idx + 1}`}
                          style={inputStyle}
                          value={line.unit}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((l, i) =>
                                i === idx ? { ...l, unit: e.target.value } : l,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {/* Vendor Cost & Profit Row */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                      gap: '10px',
                      marginTop: '10px',
                      paddingTop: '10px',
                      borderTop: '1px dashed var(--border-color)',
                    }}
                  >
                    <div>
                      <label style={labelStyle}>Kiểu tính Giá vốn Nhà in</label>
                      <select
                        aria-label={`Kiểu giá vốn dòng ${idx + 1}`}
                        style={inputStyle}
                        value={line.vendorCostMode}
                        onChange={(e) =>
                          setDraftLines((prev) =>
                            prev.map((l, i) =>
                              i === idx
                                ? {
                                    ...l,
                                    vendorCostMode: e.target
                                      .value as VendorCostModeType,
                                  }
                                : l,
                            ),
                          )
                        }
                      >
                        <option value={VendorCostMode.PER_UNIT}>
                          Theo 1 đơn vị ({line.unit || 'sp'})
                        </option>
                        <option value={VendorCostMode.TOTAL_BATCH}>
                          Trọn gói cả lô ({line.quantity} {line.unit || 'sp'})
                        </option>
                      </select>
                    </div>

                    <div>
                      <label style={labelStyle}>
                        {line.vendorCostMode === VendorCostMode.PER_UNIT
                          ? `Giá nhà in / 1 ${line.unit || 'sp'} (VNĐ)`
                          : 'Tổng giá nhà in cả lô (VNĐ)'}
                      </label>
                      <input
                        aria-label={`Giá trị giá vốn dòng ${idx + 1}`}
                        type="number"
                        min={0}
                        style={inputStyle}
                        value={line.vendorCostValue}
                        onChange={(e) =>
                          setDraftLines((prev) =>
                            prev.map((l, i) =>
                              i === idx
                                ? {
                                    ...l,
                                    vendorCostValue: Math.max(
                                      0,
                                      Number(e.target.value) || 0,
                                    ),
                                  }
                                : l,
                            ),
                          )
                        }
                      />
                    </div>

                    <div>
                      <label style={labelStyle}>Cách tính Lợi nhuận</label>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <select
                          aria-label={`Kiểu lợi nhuận dòng ${idx + 1}`}
                          style={inputStyle}
                          value={line.profitMode}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((l, i) =>
                                i === idx
                                  ? {
                                      ...l,
                                      profitMode: e.target
                                        .value as ProfitModeType,
                                    }
                                  : l,
                              ),
                            )
                          }
                        >
                          <option value={ProfitMode.FIXED_AMOUNT}>
                            Số tiền (VNĐ)
                          </option>
                          <option value={ProfitMode.PERCENTAGE}>
                            Phần trăm (%)
                          </option>
                        </select>
                        {line.profitMode === ProfitMode.FIXED_AMOUNT && (
                          <select
                            aria-label={`Phạm vi lợi nhuận dòng ${idx + 1}`}
                            style={inputStyle}
                            value={line.profitScope}
                            onChange={(e) =>
                              setDraftLines((prev) =>
                                prev.map((l, i) =>
                                  i === idx
                                    ? {
                                        ...l,
                                        profitScope: e.target
                                          .value as ProfitScopeType,
                                      }
                                    : l,
                                ),
                              )
                            }
                          >
                            <option value={ProfitScope.PER_UNIT}>
                              / 1 {line.unit || 'sp'}
                            </option>
                            <option value={ProfitScope.TOTAL_BATCH}>
                              Trọn lô
                            </option>
                          </select>
                        )}
                      </div>
                    </div>

                    <div>
                      <label style={labelStyle}>
                        {line.profitMode === ProfitMode.PERCENTAGE
                          ? 'Mức lợi nhuận (% trên giá vốn)'
                          : line.profitScope === ProfitScope.PER_UNIT
                            ? `Lợi nhuận / 1 ${line.unit || 'sp'} (VNĐ)`
                            : 'Tổng lợi nhuận cả lô (VNĐ)'}
                      </label>
                      <input
                        aria-label={`Giá trị lợi nhuận dòng ${idx + 1}`}
                        type="number"
                        min={0}
                        style={inputStyle}
                        value={line.profitValue}
                        onChange={(e) =>
                          setDraftLines((prev) =>
                            prev.map((l, i) =>
                              i === idx
                                ? {
                                    ...l,
                                    profitValue: Math.max(
                                      0,
                                      Number(e.target.value) || 0,
                                    ),
                                  }
                                : l,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live Calculation Breakdown: Internal vs Customer PDF */}
          {livePricingResult.calc && livePricingResult.customerPdf && (
            <div
              data-testid="pq-live-breakdown"
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
                gap: '16px',
              }}
            >
              {/* Internal Breakdown Card (Owner Only) */}
              <div
                style={{
                  ...cardStyle,
                  border: '1px solid var(--accent-text)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                    🔒 Bóc tách Nội bộ (Giá vốn & Lợi nhuận — Chỉ Owner thấy)
                  </h3>
                  <StatusBadge status="neutral" label="Nội bộ" />
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
                    gap: '10px',
                    marginBottom: '12px',
                  }}
                >
                  <div
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-color)',
                    }}
                  >
                    <div
                      style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                    >
                      Tổng giá vốn nhà in
                    </div>
                    <div
                      data-testid="pq-summary-vendor-cost"
                      style={{ fontSize: '16px', fontWeight: 700 }}
                    >
                      {formatVnd(livePricingResult.calc.totalVendorCost)}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-color)',
                    }}
                  >
                    <div
                      style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                    >
                      Tổng lợi nhuận ròng
                    </div>
                    <div
                      data-testid="pq-summary-profit"
                      style={{
                        fontSize: '16px',
                        fontWeight: 700,
                        color: 'var(--success-text)',
                      }}
                    >
                      +{formatVnd(livePricingResult.calc.totalProfit)}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-color)',
                    }}
                  >
                    <div
                      style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                    >
                      Cước ship (1 lần)
                    </div>
                    <div
                      data-testid="pq-summary-shipping"
                      style={{ fontSize: '16px', fontWeight: 700 }}
                    >
                      {formatVnd(livePricingResult.calc.shippingFee)}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--accent-soft)',
                    }}
                  >
                    <div
                      style={{ fontSize: '12px', color: 'var(--accent-text)' }}
                    >
                      Tổng báo giá khách
                    </div>
                    <div
                      data-testid="pq-summary-total"
                      style={{
                        fontSize: '17px',
                        fontWeight: 800,
                        color: 'var(--accent-text)',
                      }}
                    >
                      {formatVnd(livePricingResult.calc.totalQuoteAmount)}
                    </div>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '12.5px',
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          color: 'var(--muted-color)',
                          textAlign: 'left',
                        }}
                      >
                        <th style={{ padding: '6px' }}>Sản phẩm</th>
                        <th style={{ padding: '6px', textAlign: 'right' }}>
                          Vốn
                        </th>
                        <th style={{ padding: '6px', textAlign: 'right' }}>
                          Lời
                        </th>
                        <th style={{ padding: '6px', textAlign: 'right' }}>
                          Ship phân bổ
                        </th>
                        <th style={{ padding: '6px', textAlign: 'right' }}>
                          Đơn giá khách
                        </th>
                        <th style={{ padding: '6px', textAlign: 'right' }}>
                          Thành tiền
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {livePricingResult.calc.lines.map((item) => (
                        <tr
                          key={item.id}
                          style={{
                            borderBottom: '1px solid var(--border-color)',
                          }}
                        >
                          <td style={{ padding: '6px', fontWeight: 600 }}>
                            {item.name} ({formatNumberVn(item.quantity)})
                          </td>
                          <td style={{ padding: '6px', textAlign: 'right' }}>
                            {formatVnd(item.totalVendorCost)}
                          </td>
                          <td
                            style={{
                              padding: '6px',
                              textAlign: 'right',
                              color: 'var(--success-text)',
                            }}
                          >
                            +{formatVnd(item.totalProfit)}
                          </td>
                          <td style={{ padding: '6px', textAlign: 'right' }}>
                            {formatVnd(item.allocatedShippingFee)}
                          </td>
                          <td
                            style={{
                              padding: '6px',
                              textAlign: 'right',
                              fontWeight: 700,
                            }}
                          >
                            {formatVnd(item.finalUnitPrice)}
                          </td>
                          <td
                            style={{
                              padding: '6px',
                              textAlign: 'right',
                              fontWeight: 700,
                              color: 'var(--accent-text)',
                            }}
                          >
                            {formatVnd(item.reconciledLineTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Customer-Safe PDF Preview Card */}
              <div style={cardStyle} data-testid="pq-customer-safe-card">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                    📄 Chế độ Hiển thị PDF A4 Khách hàng (Ẩn 100% giá vốn & lời)
                  </h3>
                  <StatusBadge status="success" label="An toàn gửi khách" />
                </div>

                <div style={{ overflowX: 'auto', marginBottom: '12px' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '12.5px',
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          color: 'var(--muted-color)',
                          textAlign: 'left',
                        }}
                      >
                        <th style={{ padding: '6px' }}>Hạng mục in</th>
                        <th style={{ padding: '6px', textAlign: 'right' }}>
                          SL
                        </th>
                        <th style={{ padding: '6px', textAlign: 'right' }}>
                          Đơn giá bán
                        </th>
                        <th style={{ padding: '6px', textAlign: 'right' }}>
                          Thành tiền
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {livePricingResult.customerPdf.lines.map((item) => (
                        <tr
                          key={item.id}
                          style={{
                            borderBottom: '1px solid var(--border-color)',
                          }}
                        >
                          <td style={{ padding: '6px', fontWeight: 600 }}>
                            {item.name}
                          </td>
                          <td style={{ padding: '6px', textAlign: 'right' }}>
                            {formatNumberVn(item.quantity)}
                          </td>
                          <td style={{ padding: '6px', textAlign: 'right' }}>
                            {formatVnd(item.unitPrice)}
                          </td>
                          <td
                            style={{
                              padding: '6px',
                              textAlign: 'right',
                              fontWeight: 700,
                            }}
                          >
                            {formatVnd(item.lineTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div
                  style={{
                    fontSize: '13px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-color)',
                    marginBottom: '12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                    }}
                  >
                    <span>Cước vận chuyển hiển thị trên PDF:</span>
                    <strong>
                      {livePricingResult.customerPdf.includeShippingInUnitPrice
                        ? 'Đã gộp vào đơn giá (0 ₫ phụ thu)'
                        : formatVnd(
                            livePricingResult.customerPdf
                              .shippingAmountToAddOnPdfFooter,
                          )}
                    </strong>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '15px',
                      fontWeight: 800,
                      color: 'var(--accent-text)',
                    }}
                  >
                    <span>TỔNG THANH TOÁN:</span>
                    <span>
                      {formatVnd(
                        livePricingResult.customerPdf.grandTotalPayable,
                      )}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '4px',
                      fontStyle: 'italic',
                    }}
                  >
                    Bằng chữ:{' '}
                    {numberToVietnameseWords(
                      livePricingResult.customerPdf.grandTotalPayable,
                    )}
                    .
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                    gap: '10px',
                    marginBottom: '12px',
                  }}
                >
                  <div>
                    <label style={labelStyle} htmlFor="pq-customer-notes">
                      Ghi chú in trên PDF gửi khách
                    </label>
                    <textarea
                      id="pq-customer-notes"
                      rows={2}
                      style={inputStyle}
                      value={customerNotes}
                      onChange={(e) => setCustomerNotes(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={labelStyle} htmlFor="pq-internal-notes">
                      Ghi chú nội bộ (Không in lên PDF)
                    </label>
                    <textarea
                      id="pq-internal-notes"
                      rows={2}
                      style={inputStyle}
                      value={internalNotes}
                      onChange={(e) => setInternalNotes(e.target.value)}
                      placeholder="VD: Đặt nhà in Sài Gòn, cọc trước 50%"
                    />
                  </div>
                </div>

                {editingQuoteId && (
                  <div style={{ marginBottom: '12px' }}>
                    <label style={labelStyle} htmlFor="pq-version-note">
                      Lý do cập nhật phiên bản mới (v{editingQuoteVersion + 1})
                    </label>
                    <input
                      id="pq-version-note"
                      style={inputStyle}
                      value={versionChangeNote}
                      onChange={(e) => setVersionChangeNote(e.target.value)}
                      placeholder="VD: Khách tăng số lượng lên 500 tờ"
                    />
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  <button
                    type="button"
                    data-testid="pq-save-quote-btn"
                    onClick={handleSaveQuote}
                    style={{
                      flex: 1,
                      minWidth: '180px',
                      padding: '10px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: 'var(--accent-text)',
                      color: '#0F172A',
                      fontWeight: 800,
                      fontSize: '13.5px',
                      cursor: 'pointer',
                    }}
                  >
                    {editingQuoteId
                      ? `💾 Lưu Phiên bản v${editingQuoteVersion + 1}`
                      : '💾 Lưu Báo giá (v1)'}
                  </button>

                  <button
                    type="button"
                    data-testid="pq-preview-pdf-btn"
                    onClick={handleOpenLiveA4Preview}
                    style={{
                      flex: 1,
                      minWidth: '180px',
                      padding: '10px 16px',
                      borderRadius: '8px',
                      border: '1px solid var(--accent-text)',
                      backgroundColor: 'var(--accent-soft)',
                      color: 'var(--accent-text)',
                      fontWeight: 700,
                      fontSize: '13.5px',
                      cursor: 'pointer',
                    }}
                  >
                    🖨️ Xem & Xuất PDF A4 Tiếng Việt
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: DANH SÁCH BÁO GIÁ & LỊCH SỬ PHIÊN BẢN */}
      {activeTab === 'quotes' && (
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
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
              Danh sách Báo giá & Lịch sử Phiên bản ({quotes.length})
            </h2>
            <button
              type="button"
              onClick={() => {
                handleResetNewQuote();
                setActiveTab('create');
              }}
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

          {quotes.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                color: 'var(--muted-color)',
                fontSize: '13.5px',
              }}
            >
              Chưa có báo giá nào. Hãy bấm <strong>1. Tạo báo giá</strong> để
              tính giá và xuất PDF A4 đầu tiên.
            </div>
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              {quotes.map((q) => {
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
                          <strong>{q.customer_name || 'Khách lẻ'}</strong> •
                          Ngày tạo: {formatDateVn(q.created_at)}
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
                          <div style={{ color: 'var(--muted-color)' }}>
                            Giá vốn
                          </div>
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
                        onClick={() => handleOpenSavedQuotePdf(q)}
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
                        🖨️ Xuất PDF A4 Khách hàng
                      </button>

                      {q.status === 'DRAFT' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleLoadQuoteForEdit(q)}
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
                            onClick={() => handleFinalizeQuote(q.id)}
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

                      {q.status !== 'CONVERTED' && q.status !== 'CANCELLED' && (
                        <button
                          type="button"
                          onClick={() => handleConvertQuoteToOrder(q)}
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
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedQuoteHistoryId(
                            isHistoryOpen ? null : q.id,
                          )
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
                          Nhật ký các phiên bản báo giá (Bất biến theo SHA-256):
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
                              <strong>
                                {formatVnd(ver.total_quote_amount)}
                              </strong>{' '}
                              <code style={{ color: 'var(--muted-color)' }}>
                                #{ver.integrity_hash.slice(0, 10)}
                              </code>
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
      )}

      {/* TAB 3: NHÀ IN & BẢNG GIÁ */}
      {activeTab === 'vendors' && (
        <div
          data-testid="panel-vendors-catalog"
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
            gap: '16px',
          }}
        >
          {/* Vendors Management */}
          <div style={cardStyle}>
            <h2
              style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 700 }}
            >
              Danh sách Nhà in đối tác ({vendors.length})
            </h2>
            <form
              onSubmit={handleCreateVendor}
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
                gap: '8px',
                marginBottom: '14px',
              }}
            >
              <input
                aria-label="Tên nhà in"
                style={inputStyle}
                placeholder="Tên nhà in *"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                required
              />
              <input
                aria-label="Số điện thoại nhà in"
                style={inputStyle}
                placeholder="Số điện thoại"
                value={vendorPhone}
                onChange={(e) => setVendorPhone(e.target.value)}
              />
              <input
                aria-label="Ngân hàng nhà in"
                style={inputStyle}
                placeholder="Ngân hàng (VD: VCB)"
                value={vendorBankName}
                onChange={(e) => setVendorBankName(e.target.value)}
              />
              <input
                aria-label="Số tài khoản nhà in"
                style={inputStyle}
                placeholder="Số tài khoản"
                value={vendorBankAccount}
                onChange={(e) => setVendorBankAccount(e.target.value)}
              />
              <button
                type="submit"
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: 'var(--accent-text)',
                  color: '#0F172A',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Thêm Nhà in
              </button>
            </form>

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              {vendors.map((v) => (
                <div
                  key={v.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    fontSize: '13px',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    <span style={{ color: 'var(--accent-text)' }}>
                      {v.code}
                    </span>{' '}
                    — {v.name}
                  </div>
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    SĐT: {v.phone || '—'} • NH: {v.bank_name || '—'}{' '}
                    {v.bank_account_number ? `(${v.bank_account_number})` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Vendor Price Catalog Management */}
          <div style={cardStyle}>
            <h2
              style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700 }}
            >
              Bảng giá gốc Nhà in ({priceItems.length})
            </h2>
            <p
              style={{
                margin: '0 0 12px',
                fontSize: '12px',
                color: 'var(--muted-color)',
              }}
            >
              🔒 Bảo vệ lịch sử: Khi cập nhật bảng giá nhà in tại đây, toàn bộ
              báo giá và đơn hàng cũ đã tạo trước đó được giữ nguyên 100%, không
              tự động bị đổi giá.
            </p>

            <form
              onSubmit={handleCreatePriceItem}
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
                gap: '8px',
                marginBottom: '14px',
              }}
            >
              <select
                aria-label="Chọn nhà in cho bảng giá"
                style={inputStyle}
                value={priceVendorId}
                onChange={(e) => setPriceVendorId(e.target.value)}
              >
                <option value="">-- Chọn Nhà in --</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.code} — {v.name}
                  </option>
                ))}
              </select>

              <input
                aria-label="Tên hạng mục bảng giá"
                style={inputStyle}
                placeholder="Tên ấn phẩm (VD: Tờ rơi A5) *"
                value={priceItemName}
                onChange={(e) => setPriceItemName(e.target.value)}
                required
              />

              <input
                aria-label="Quy cách in bảng giá"
                style={inputStyle}
                placeholder="Quy cách (VD: C150 2 mặt)"
                value={priceSpec}
                onChange={(e) => setPriceSpec(e.target.value)}
              />

              <select
                aria-label="Kiểu tính giá nhà in"
                style={inputStyle}
                value={priceCostMode}
                onChange={(e) =>
                  setPriceCostMode(e.target.value as VendorCostModeType)
                }
              >
                <option value={VendorCostMode.PER_UNIT}>
                  Giá theo 1 đơn vị
                </option>
                <option value={VendorCostMode.TOTAL_BATCH}>Giá trọn lô</option>
              </select>

              {priceCostMode === VendorCostMode.PER_UNIT ? (
                <input
                  aria-label="Đơn giá vốn nhà in"
                  type="number"
                  min={0}
                  style={inputStyle}
                  placeholder="Giá vốn / 1 ĐVT"
                  value={priceUnitCost}
                  onChange={(e) =>
                    setPriceUnitCost(Math.max(0, Number(e.target.value) || 0))
                  }
                />
              ) : (
                <input
                  aria-label="Giá vốn trọn lô nhà in"
                  type="number"
                  min={0}
                  style={inputStyle}
                  placeholder="Giá vốn trọn lô"
                  value={priceBatchCost}
                  onChange={(e) =>
                    setPriceBatchCost(Math.max(0, Number(e.target.value) || 0))
                  }
                />
              )}

              <input
                aria-label="Lợi nhuận mặc định"
                type="number"
                min={0}
                style={inputStyle}
                placeholder="Lợi nhuận mặc định"
                value={priceDefaultProfitVal}
                onChange={(e) =>
                  setPriceDefaultProfitVal(
                    Math.max(0, Number(e.target.value) || 0),
                  )
                }
              />

              <button
                type="submit"
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: 'var(--accent-text)',
                  color: '#0F172A',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Lưu vào Bảng giá
              </button>
            </form>

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              {priceItems.map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    fontSize: '12.5px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div>
                    <strong>
                      {p.code} — {p.name}
                    </strong>{' '}
                    <span style={{ color: 'var(--muted-color)' }}>
                      ({p.vendor_name || 'Nhà in'}) • v{p.version}
                    </span>
                    {p.specification && (
                      <div style={{ color: 'var(--muted-color)' }}>
                        Quy cách: {p.specification}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div>
                      Giá vốn:{' '}
                      <strong>
                        {p.pricing_mode === 'TOTAL_BATCH'
                          ? `${formatVnd(p.batch_total_cost)} / lô`
                          : `${formatVnd(p.unit_cost)} / ${p.unit}`}
                      </strong>
                    </div>
                    <div style={{ color: 'var(--success-text)' }}>
                      Lời mặc định:{' '}
                      {p.default_profit_mode === 'PERCENTAGE'
                        ? `${p.default_profit_value}%`
                        : `${formatVnd(p.default_profit_value)}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: KHÁCH HÀNG */}
      {activeTab === 'customers' && (
        <div style={cardStyle} data-testid="panel-customers">
          <h2 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 700 }}>
            Danh bạ Khách hàng đặt in ({customers.length})
          </h2>

          <form
            onSubmit={handleCreateCustomer}
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
              gap: '8px',
              marginBottom: '16px',
            }}
          >
            <input
              aria-label="Tên khách hàng"
              style={inputStyle}
              placeholder="Tên khách hàng *"
              value={custName}
              onChange={(e) => setCustName(e.target.value)}
              required
            />
            <input
              aria-label="Tên công ty khách hàng"
              style={inputStyle}
              placeholder="Công ty / Thương hiệu"
              value={custCompany}
              onChange={(e) => setCustCompany(e.target.value)}
            />
            <input
              aria-label="Số điện thoại khách hàng"
              style={inputStyle}
              placeholder="Số điện thoại"
              value={custPhone}
              onChange={(e) => setCustPhone(e.target.value)}
            />
            <input
              aria-label="Địa chỉ giao hàng"
              style={inputStyle}
              placeholder="Địa chỉ nhận hàng"
              value={custAddress}
              onChange={(e) => setCustAddress(e.target.value)}
            />
            <button
              type="submit"
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--accent-text)',
                color: '#0F172A',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              + Thêm Khách hàng
            </button>
          </form>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
              gap: '10px',
            }}
          >
            {customers.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13.5px' }}>
                    <span style={{ color: 'var(--accent-text)' }}>
                      {c.code}
                    </span>{' '}
                    — {c.name}
                  </div>
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    {c.company_name ? `${c.company_name} • ` : ''}SĐT:{' '}
                    {c.phone || '—'}
                  </div>
                  {c.address && (
                    <div
                      style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                    >
                      Đ/c: {c.address}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomerId(c.id);
                    setActiveTab('create');
                  }}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--accent-text)',
                    backgroundColor: 'var(--accent-soft)',
                    color: 'var(--accent-text)',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  + Báo giá
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: ĐƠN HÀNG (NGÀY ĐẶT IN, SẢN XUẤT & GIAO HÀNG ĐỘC LẬP, CỌC & THANH TOÁN) */}
      {activeTab === 'orders' && (
        <div style={cardStyle} data-testid="panel-orders">
          <h2 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 700 }}>
            Quản lý Đơn hàng In ấn, Tiến độ Sản xuất / Giao hàng & Thanh toán (
            {orders.length})
          </h2>

          {orders.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                color: 'var(--muted-color)',
              }}
            >
              Chưa có đơn hàng đặt in nào. Hãy chuyển từ mục{' '}
              <strong>2. Danh sách báo giá</strong> sang Đơn đặt in.
            </div>
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              {orders.map((ord) => (
                <div
                  key={ord.id}
                  data-testid={`order-card-${ord.order_code}`}
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
                      marginBottom: '12px',
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
                            fontSize: '15px',
                            color: 'var(--accent-text)',
                          }}
                        >
                          {ord.order_code}
                        </strong>
                        <StatusBadge
                          status={
                            ord.production_status === 'COMPLETED'
                              ? 'success'
                              : 'neutral'
                          }
                          label={`SX: ${PRODUCTION_STATUS_LABELS[ord.production_status]}`}
                        />
                        <StatusBadge
                          status={
                            ord.delivery_status === 'DELIVERED'
                              ? 'success'
                              : 'warning'
                          }
                          label={`Giao: ${DELIVERY_STATUS_LABELS[ord.delivery_status]}`}
                        />
                        <StatusBadge
                          status={
                            ord.payment_status === 'PAID'
                              ? 'success'
                              : ord.remaining_debt_amount > 0
                                ? 'error'
                                : 'muted'
                          }
                          label={PAYMENT_STATUS_LABELS[ord.payment_status]}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: '12.5px',
                          color: 'var(--muted-color)',
                          marginTop: '4px',
                        }}
                      >
                        Khách hàng:{' '}
                        <strong>{ord.customer_name || 'Khách lẻ'}</strong> • Mã
                        báo giá gốc: {ord.quote_code || '—'} (v
                        {ord.quote_version})
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
                        <div style={{ color: 'var(--muted-color)' }}>
                          Tổng tiền đơn
                        </div>
                        <strong>{formatVnd(ord.total_quote_amount)}</strong>
                      </div>
                      <div>
                        <div style={{ color: 'var(--muted-color)' }}>
                          Đã thanh toán
                        </div>
                        <strong style={{ color: 'var(--success-text)' }}>
                          {formatVnd(ord.total_paid_amount)}
                        </strong>
                      </div>
                      <div>
                        <div style={{ color: 'var(--muted-color)' }}>
                          Công nợ còn lại
                        </div>
                        <strong
                          style={{
                            color:
                              ord.remaining_debt_amount > 0
                                ? 'var(--danger-text)'
                                : 'var(--success-text)',
                          }}
                        >
                          {formatVnd(ord.remaining_debt_amount)}
                        </strong>
                      </div>
                      <div>
                        <div style={{ color: 'var(--muted-color)' }}>
                          Lời dự kiến / Thực tế
                        </div>
                        <strong>
                          {formatVnd(ord.expected_profit)} /{' '}
                          <span style={{ color: 'var(--accent-text)' }}>
                            {formatVnd(ord.actual_profit)}
                          </span>
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Independent Production & Delivery Status Controls + Dates */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                      gap: '10px',
                      paddingTop: '10px',
                      borderTop: '1px solid var(--border-color)',
                    }}
                  >
                    <div>
                      <label style={labelStyle}>Ngày đặt in nhà in</label>
                      <input
                        aria-label={`Ngày đặt in ${ord.order_code}`}
                        type="date"
                        style={inputStyle}
                        value={ord.print_ordered_at || ''}
                        onChange={(e) =>
                          handleUpdateOrderField(ord.id, {
                            print_ordered_at: e.target.value || null,
                          })
                        }
                      />
                    </div>

                    <div>
                      <label style={labelStyle}>
                        Trạng thái Sản xuất (Độc lập)
                      </label>
                      <select
                        aria-label={`Trạng thái sản xuất ${ord.order_code}`}
                        style={inputStyle}
                        value={ord.production_status}
                        onChange={(e) =>
                          handleUpdateOrderField(ord.id, {
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

                    <div>
                      <label style={labelStyle}>
                        Trạng thái Giao hàng (Độc lập)
                      </label>
                      <select
                        aria-label={`Trạng thái giao hàng ${ord.order_code}`}
                        style={inputStyle}
                        value={ord.delivery_status}
                        onChange={(e) =>
                          handleUpdateOrderField(ord.id, {
                            delivery_status: e.target
                              .value as PrintDeliveryStatusType,
                          })
                        }
                      >
                        {Object.entries(PrintDeliveryStatus).map(([, val]) => (
                          <option key={val} value={val}>
                            {DELIVERY_STATUS_LABELS[val]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentOrderTarget(ord);
                          setPaymentAmount(ord.remaining_debt_amount || 0);
                          setPaymentType(
                            ord.total_paid_amount === 0 ? 'DEPOSIT' : 'FINAL',
                          );
                        }}
                        style={{
                          width: '100%',
                          minHeight: '38px',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: 'var(--accent-text)',
                          color: '#0F172A',
                          fontWeight: 700,
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        💰 Ghi nhận Cọc / Thanh toán
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Record Payment Modal */}
          {paymentOrderTarget && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Ghi nhận thanh toán đơn hàng"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1100,
                backgroundColor: 'rgba(2, 6, 23, 0.75)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
              }}
            >
              <form
                onSubmit={handleRecordPayment}
                style={{
                  ...cardStyle,
                  width: '100%',
                  maxWidth: '440px',
                }}
              >
                <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>
                  Thu tiền / Đặt cọc — Đơn {paymentOrderTarget.order_code}
                </h3>
                <div style={{ marginBottom: '10px' }}>
                  <label style={labelStyle}>Loại thanh toán</label>
                  <select
                    aria-label="Loại thanh toán"
                    style={inputStyle}
                    value={paymentType}
                    onChange={(e) =>
                      setPaymentType(
                        e.target.value as 'DEPOSIT' | 'INSTALLMENT' | 'FINAL',
                      )
                    }
                  >
                    <option value="DEPOSIT">Tiền đặt cọc (Deposit)</option>
                    <option value="INSTALLMENT">Thanh toán đợt</option>
                    <option value="FINAL">Tất toán công nợ cuối</option>
                  </select>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <label style={labelStyle}>Số tiền thu (VNĐ) *</label>
                  <input
                    aria-label="Số tiền thanh toán"
                    type="number"
                    min={1}
                    style={inputStyle}
                    value={paymentAmount}
                    onChange={(e) =>
                      setPaymentAmount(Math.max(0, Number(e.target.value) || 0))
                    }
                    required
                  />
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <label style={labelStyle}>Phương thức</label>
                  <select
                    aria-label="Phương thức thanh toán"
                    style={inputStyle}
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="BANK_TRANSFER">
                      Chuyển khoản Ngân hàng
                    </option>
                    <option value="QR_VIETQR">Quét mã VietQR</option>
                    <option value="CASH">Tiền mặt</option>
                  </select>
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelStyle}>Ghi chú giao dịch</label>
                  <input
                    aria-label="Ghi chú thanh toán"
                    style={inputStyle}
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    placeholder="VD: Khách CK cọc 50% đơn in"
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '8px',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setPaymentOrderTarget(null)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'transparent',
                      color: 'var(--text-color)',
                      cursor: 'pointer',
                    }}
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: 'var(--accent-text)',
                      color: '#0F172A',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Xác nhận thu tiền
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* TAB 6: LỢI NHUẬN & CÔNG NỢ (DASHBOARD THỐNG KÊ) */}
      {activeTab === 'analytics' && (
        <div
          data-testid="panel-profit-debt"
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
              gap: '12px',
            }}
          >
            <div style={cardStyle}>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Tổng doanh thu đơn in
              </div>
              <div
                style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}
              >
                {formatVnd(stats?.total_order_revenue ?? 0)}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                {stats?.total_orders ?? orders.length} đơn hàng /{' '}
                {stats?.total_quotes ?? quotes.length} báo giá
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Lợi nhuận Dự kiến vs Thực tế
              </div>
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: 800,
                  color: 'var(--success-text)',
                  marginTop: '4px',
                }}
              >
                {formatVnd(stats?.total_expected_profit ?? 0)} /{' '}
                {formatVnd(stats?.total_actual_profit ?? 0)}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Tự động đối soát chênh lệch giá nhà in
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Tổng tiền đã thu (Cọc + Đợt)
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 800,
                  color: 'var(--accent-text)',
                  marginTop: '4px',
                }}
              >
                {formatVnd(stats?.total_paid_amount ?? 0)}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Đã đối soát phiếu thu
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Tổng Công nợ Khách hàng còn nợ
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 800,
                  color: 'var(--danger-text)',
                  marginTop: '4px',
                }}
              >
                {formatVnd(stats?.total_remaining_debt ?? 0)}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                {ordersInProdCount} đơn đang SX • {ordersPendingDeliveryCount}{' '}
                đơn chờ giao
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <h3
              style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700 }}
            >
              Sổ theo dõi Lợi nhuận & Công nợ chi tiết theo Đơn hàng
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '12.5px',
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      color: 'var(--muted-color)',
                      textAlign: 'left',
                    }}
                  >
                    <th style={{ padding: '8px' }}>Mã đơn</th>
                    <th style={{ padding: '8px' }}>Khách hàng</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>
                      Doanh thu
                    </th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>
                      Lời dự kiến
                    </th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>
                      Lời thực tế
                    </th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>
                      Đã thu
                    </th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>
                      Còn nợ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr
                      key={o.id}
                      style={{ borderBottom: '1px solid var(--border-color)' }}
                    >
                      <td style={{ padding: '8px', fontWeight: 700 }}>
                        {o.order_code}
                      </td>
                      <td style={{ padding: '8px' }}>
                        {o.customer_name || 'Khách lẻ'}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {formatVnd(o.total_quote_amount)}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {formatVnd(o.expected_profit)}
                      </td>
                      <td
                        style={{
                          padding: '8px',
                          textAlign: 'right',
                          fontWeight: 700,
                          color: 'var(--success-text)',
                        }}
                      >
                        {formatVnd(o.actual_profit)}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {formatVnd(o.total_paid_amount)}
                      </td>
                      <td
                        style={{
                          padding: '8px',
                          textAlign: 'right',
                          fontWeight: 700,
                          color:
                            o.remaining_debt_amount > 0
                              ? 'var(--danger-text)'
                              : 'var(--success-text)',
                        }}
                      >
                        {formatVnd(o.remaining_debt_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* A4 PDF Preview & Print Modal */}
      {pdfPreviewState && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={pdfPreviewState.title}
          data-testid="pq-pdf-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            backgroundColor: 'rgba(2, 6, 23, 0.82)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '900px',
              maxHeight: 'calc(100dvh - 24px)',
              backgroundColor: 'var(--surface-color)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <strong style={{ fontSize: '14px' }}>
                {pdfPreviewState.title} (Chỉ hiển thị giá bán — Ẩn 100% giá nhà
                in & lợi nhuận)
              </strong>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => handlePrintA4Window(pdfPreviewState.html)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: 'var(--accent-text)',
                    color: '#0F172A',
                    fontWeight: 700,
                    fontSize: '12.5px',
                    cursor: 'pointer',
                  }}
                >
                  🖨️ Mở cửa sổ In / Lưu PDF A4
                </button>
                <button
                  type="button"
                  onClick={() => setPdfPreviewState(null)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'transparent',
                    color: 'var(--text-color)',
                    fontSize: '12.5px',
                    cursor: 'pointer',
                  }}
                >
                  Đóng
                </button>
              </div>
            </div>

            <iframe
              title="Xem trước PDF A4 Báo giá in ấn"
              srcDoc={pdfPreviewState.html}
              style={{
                width: '100%',
                height: '75vh',
                border: 'none',
                backgroundColor: '#FFFFFF',
              }}
            />
          </div>
        </div>
      )}

      {loading && (
        <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
          Đang đồng bộ dữ liệu báo giá…
        </div>
      )}
    </div>
  );
};
