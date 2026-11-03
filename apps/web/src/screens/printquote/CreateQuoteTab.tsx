import React, { useState, useEffect } from 'react';
import { StatusBadge } from '../../../../../packages/ui/src/components/index.js';
import {
  ProfitMode,
  ProfitScope,
  VendorCostMode,
  ShippingAllocationStrategy,
  RoundingMode,
  type ProfitModeType,
  type ProfitScopeType,
  type VendorCostModeType,
  type ShippingAllocationStrategyType,
  type RoundingModeType,
  type PrintVendorPriceItemData,
  type PrintCustomerData,
  type QuoteCalculationResult,
  type CustomerSafePdfPayload,
} from '../../../../../packages/contracts/src/printquote.js';
import {
  formatVnd,
  formatExactVnd,
  formatCustomerLinePriceDisplay,
  formatNumberVn,
  numberToVietnameseWords,
  parseNumericDraftValue,
  type DraftLineValidationError,
} from '../helpers/printquote-helpers.js';
import {
  DEFAULT_DRAFT_LINE,
  cardStyle,
  inputStyle,
  labelStyle,
  type CreateQuoteSectionId,
  type DraftLineState,
  type SummaryViewMode,
} from './types.js';
import { NumericDraftInput } from './NumericDraftInput.js';

export interface CreateQuoteTabProps {
  editingQuoteId: string | null;
  editingQuoteCode: string | null;
  editingQuoteVersion: number;
  quoteTitle: string;
  onChangeQuoteTitle: (val: string) => void;
  selectedCustomerId: string;
  onChangeSelectedCustomerId: (val: string) => void;
  customers: PrintCustomerData[];
  priceItems: PrintVendorPriceItemData[];
  validUntil: string;
  onChangeValidUntil: (val: string) => void;
  shippingFee: number;
  onChangeShippingFee: (val: number) => void;
  shippingFeeInput?: string | undefined;
  onChangeShippingFeeInput?: ((val: string) => void) | undefined;
  includeShippingInUnitPrice: boolean;
  onChangeIncludeShippingInUnitPrice: (val: boolean) => void;
  shippingAllocation: ShippingAllocationStrategyType;
  onChangeShippingAllocation: (val: ShippingAllocationStrategyType) => void;
  roundingMode: RoundingModeType;
  onChangeRoundingMode: (val: RoundingModeType) => void;
  roundingStep: number;
  onChangeRoundingStep: (val: number) => void;
  customerNotes: string;
  onChangeCustomerNotes: (val: string) => void;
  internalNotes: string;
  onChangeInternalNotes: (val: string) => void;
  versionChangeNote: string;
  onChangeVersionChangeNote: (val: string) => void;
  draftLines: DraftLineState[];
  setDraftLines: React.Dispatch<React.SetStateAction<DraftLineState[]>>;
  onSelectCatalogItem: (lineIndex: number, catalogItemId: string) => void;
  livePricingResult: {
    calc: QuoteCalculationResult | null;
    customerPdf: CustomerSafePdfPayload | null;
    error: string | null;
    validationErrors?: string[] | undefined;
    lineErrors?: Record<string, DraftLineValidationError> | undefined;
    shippingError?: string | null | undefined;
  };
  onResetNewQuote: () => void;
  onSaveQuote: () => void;
  onDownloadLivePdf: () => void;
  onOpenLivePreview: () => void;
  onQuickCreateCustomer: (input: {
    name: string;
    phone: string;
    company: string;
  }) => Promise<PrintCustomerData | null>;
}

export const CreateQuoteTab: React.FC<CreateQuoteTabProps> = ({
  editingQuoteId,
  editingQuoteCode,
  editingQuoteVersion,
  quoteTitle,
  onChangeQuoteTitle,
  selectedCustomerId,
  onChangeSelectedCustomerId,
  customers,
  priceItems,
  validUntil,
  onChangeValidUntil,
  shippingFee,
  onChangeShippingFee,
  shippingFeeInput,
  onChangeShippingFeeInput,
  includeShippingInUnitPrice,
  onChangeIncludeShippingInUnitPrice,
  shippingAllocation,
  onChangeShippingAllocation,
  roundingMode,
  onChangeRoundingMode,
  roundingStep,
  onChangeRoundingStep,
  customerNotes,
  onChangeCustomerNotes,
  internalNotes,
  onChangeInternalNotes,
  versionChangeNote,
  onChangeVersionChangeNote,
  draftLines,
  setDraftLines,
  onSelectCatalogItem,
  livePricingResult,
  onResetNewQuote,
  onSaveQuote,
  onDownloadLivePdf,
  onOpenLivePreview,
  onQuickCreateCustomer,
}) => {
  // 4 nhóm thông tin có thể thu gọn/mở rộng tự do (mặc định mở để tạo báo giá 1 sản phẩm ngay)
  const [openSections, setOpenSections] = useState<
    Record<CreateQuoteSectionId, boolean>
  >({
    customer: true,
    products: true,
    summary: true,
    actions: true,
  });

  // Quản lý thu gọn từng dòng sản phẩm (khi thêm dòng mới sẽ tự thu gọn các dòng đã nhập xong)
  const [collapsedLineIds, setCollapsedLineIds] = useState<
    Record<string, boolean>
  >({});

  // Chế độ xem bảng tổng kết duy nhất: 'customer' (Bản gửi khách) | 'internal' (Bóc tách nội bộ)
  const [summaryViewMode, setSummaryViewMode] =
    useState<SummaryViewMode>('customer');

  // Tùy chọn nâng cao mặc định thu gọn
  const [showAdvancedOptions, setShowAdvancedOptions] =
    useState<boolean>(false);

  // Thêm khách hàng mới ngay trong màn hình Tạo báo giá
  const [showQuickCustomerForm, setShowQuickCustomerForm] =
    useState<boolean>(false);
  const [quickCustName, setQuickCustName] = useState<string>('');
  const [quickCustPhone, setQuickCustPhone] = useState<string>('');
  const [quickCustCompany, setQuickCustCompany] = useState<string>('');
  const [quickCustSaving, setQuickCustSaving] = useState<boolean>(false);

  // Nếu chỉ còn 1 dòng sản phẩm thì luôn tự mở rộng dòng đó để sửa nhanh
  useEffect(() => {
    if (draftLines.length === 1 && draftLines[0]) {
      const onlyId = draftLines[0].id;
      if (collapsedLineIds[onlyId]) {
        setCollapsedLineIds({});
      }
    }
  }, [draftLines, collapsedLineIds]);

  const toggleSection = (secId: CreateQuoteSectionId) => {
    setOpenSections((prev) => ({ ...prev, [secId]: !prev[secId] }));
  };

  const focusAndOpenSection = (secId: CreateQuoteSectionId, domId: string) => {
    setOpenSections((prev) => ({ ...prev, [secId]: true }));
    if (typeof document !== 'undefined') {
      const el = document.getElementById(domId);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const handleAddProductLine = () => {
    setOpenSections((prev) => ({ ...prev, products: true }));
    const nextCollapsed: Record<string, boolean> = {};
    for (const existing of draftLines) {
      nextCollapsed[existing.id] = true;
    }
    setCollapsedLineIds(nextCollapsed);
    setDraftLines((prev) => {
      const nextIdx = prev.length + 1;
      const newLine = {
        ...DEFAULT_DRAFT_LINE(nextIdx),
        id: `ITEM-${Date.now()}-${nextIdx}`,
      };
      return [...prev, newLine];
    });
  };

  const handleDuplicateProductLine = (idx: number) => {
    setDraftLines((prev) => {
      const source = prev[idx];
      if (!source) return prev;
      const clonedId = `ITEM-${Date.now()}-${prev.length + 1}`;
      const cloned: DraftLineState = {
        ...source,
        id: clonedId,
        name: `${source.name} (Bản sao)`,
      };
      const nextCollapsed: Record<string, boolean> = { ...collapsedLineIds };
      nextCollapsed[source.id] = true;
      nextCollapsed[clonedId] = false;
      setCollapsedLineIds(nextCollapsed);
      const copy = [...prev];
      copy.splice(idx + 1, 0, cloned);
      return copy;
    });
  };

  const handleRemoveProductLine = (idx: number) => {
    setDraftLines((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 1 && next[0]) {
        setCollapsedLineIds({});
      }
      return next;
    });
  };

  const handleQuickSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickCustName.trim() || quickCustSaving) return;
    setQuickCustSaving(true);
    try {
      const created = await onQuickCreateCustomer({
        name: quickCustName.trim(),
        phone: quickCustPhone.trim(),
        company: quickCustCompany.trim(),
      });
      if (created) {
        onChangeSelectedCustomerId(created.id);
        setQuickCustName('');
        setQuickCustPhone('');
        setQuickCustCompany('');
        setShowQuickCustomerForm(false);
      }
    } finally {
      setQuickCustSaving(false);
    }
  };

  const selectedCustomerObj =
    customers.find((c) => c.id === selectedCustomerId) || null;
  const resolvedShippingFeeInput =
    shippingFeeInput !== undefined ? shippingFeeInput : String(shippingFee);
  const isQuoteIncomplete = Boolean(
    livePricingResult.error ||
    !livePricingResult.calc ||
    !livePricingResult.customerPdf,
  );

  return (
    <div
      data-testid="panel-create-quote"
      style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      {/* Thanh nhảy nhanh gọn nhẹ cho 4 mục trong Tạo báo giá (Không trùng lặp với thanh menu phân hệ) */}
      <div
        data-testid="pq-section-jump-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '6px',
          padding: '6px 10px',
          borderRadius: '10px',
          backgroundColor: 'var(--surface-color)',
          border: '1px solid var(--border-color)',
        }}
      >
        <span
          style={{
            fontSize: '12px',
            fontWeight: 700,
            color: 'var(--muted-color)',
            marginRight: '2px',
          }}
        >
          Mở nhanh:
        </span>
        {[
          {
            id: 'customer' as const,
            domId: 'pq-sec-customer',
            label: '1. Khách hàng',
          },
          {
            id: 'products' as const,
            domId: 'pq-sec-products',
            label: `2. Sản phẩm (${draftLines.length})`,
          },
          {
            id: 'summary' as const,
            domId: 'pq-sec-summary',
            label: '3. Tổng kết',
          },
          {
            id: 'actions' as const,
            domId: 'pq-sec-actions',
            label: '4. Lưu & Xuất PDF',
          },
        ].map((step) => {
          const isOpen = openSections[step.id];
          return (
            <button
              key={step.id}
              type="button"
              data-testid={`pq-jump-${step.id}`}
              onClick={() => focusAndOpenSection(step.id, step.domId)}
              style={{
                minHeight: '38px',
                padding: '6px 10px',
                borderRadius: '999px',
                border: isOpen
                  ? '1px solid var(--accent-text)'
                  : '1px solid var(--border-color)',
                backgroundColor: isOpen
                  ? 'var(--accent-soft)'
                  : 'var(--bg-color)',
                color: isOpen ? 'var(--accent-text)' : 'var(--text-color)',
                fontSize: '12px',
                fontWeight: isOpen ? 700 : 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {step.label}
            </button>
          );
        })}
      </div>

      {/* NHÓM 1: KHÁCH HÀNG & TIÊU ĐỀ BÁO GIÁ */}
      <div id="pq-sec-customer" style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: openSections.customer ? '12px' : 0,
          }}
        >
          <button
            type="button"
            data-testid="pq-toggle-sec-customer"
            onClick={() => toggleSection('customer')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              color: 'var(--text-color)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                fontSize: '14px',
                fontWeight: 800,
                color: 'var(--accent-text)',
              }}
            >
              {openSections.customer ? '▾' : '▸'} 1. Khách hàng & Tên báo giá
            </span>
            {!openSections.customer && (
              <span style={{ fontSize: '12.5px', color: 'var(--muted-color)' }}>
                ({selectedCustomerObj?.name || 'Khách lẻ'} • {quoteTitle})
              </span>
            )}
          </button>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="pq-inline-new-customer-btn"
              onClick={() => {
                setOpenSections((prev) => ({ ...prev, customer: true }));
                setShowQuickCustomerForm((v) => !v);
              }}
              style={{
                minHeight: '40px',
                padding: '7px 12px',
                borderRadius: '8px',
                border: '1px solid var(--accent-text)',
                backgroundColor: 'var(--accent-soft)',
                color: 'var(--accent-text)',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {showQuickCustomerForm ? '✕ Đóng thêm khách' : '+ Khách hàng mới'}
            </button>

            {editingQuoteId && (
              <button
                type="button"
                onClick={onResetNewQuote}
                style={{
                  minHeight: '40px',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-color)',
                  fontSize: '12.5px',
                  cursor: 'pointer',
                }}
              >
                + Tạo báo giá mới
              </button>
            )}
          </div>
        </div>

        {openSections.customer && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            {editingQuoteId && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--accent-soft)',
                  color: 'var(--accent-text)',
                  fontSize: '12.5px',
                  fontWeight: 700,
                }}
              >
                Đang sửa Báo giá {editingQuoteCode} (Lưu sẽ tạo Phiên bản v
                {editingQuoteVersion + 1})
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '12px',
              }}
            >
              <div>
                <label style={labelStyle} htmlFor="pq-customer-select">
                  Khách hàng nhận báo giá
                </label>
                <select
                  id="pq-customer-select"
                  data-testid="pq-customer-select"
                  style={inputStyle}
                  value={selectedCustomerId}
                  onChange={(e) => onChangeSelectedCustomerId(e.target.value)}
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
                <label style={labelStyle} htmlFor="pq-title-input">
                  Tên báo giá *
                </label>
                <input
                  id="pq-title-input"
                  data-testid="pq-title-input"
                  style={inputStyle}
                  value={quoteTitle}
                  onChange={(e) => onChangeQuoteTitle(e.target.value)}
                  placeholder="VD: Báo giá in tờ rơi & hộp giấy"
                />
              </div>
            </div>

            {/* Khung thêm nhanh khách hàng ngay tại chỗ */}
            {showQuickCustomerForm && (
              <form
                onSubmit={handleQuickSaveCustomer}
                data-testid="pq-inline-customer-form"
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1px dashed var(--accent-text)',
                  backgroundColor: 'var(--bg-color)',
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
                  gap: '8px',
                  alignItems: 'end',
                }}
              >
                <div>
                  <label style={labelStyle}>Tên khách hàng mới *</label>
                  <input
                    aria-label="Tên khách hàng thêm nhanh"
                    data-testid="pq-quick-cust-name"
                    style={inputStyle}
                    placeholder="VD: Chị Lan"
                    value={quickCustName}
                    onChange={(e) => setQuickCustName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={labelStyle}>Số điện thoại</label>
                  <input
                    aria-label="Số điện thoại khách thêm nhanh"
                    data-testid="pq-quick-cust-phone"
                    style={inputStyle}
                    placeholder="VD: 0909123456"
                    value={quickCustPhone}
                    onChange={(e) => setQuickCustPhone(e.target.value)}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Công ty / Thương hiệu</label>
                  <input
                    aria-label="Công ty khách thêm nhanh"
                    data-testid="pq-quick-cust-company"
                    style={inputStyle}
                    placeholder="VD: Spa Hoa Hồng"
                    value={quickCustCompany}
                    onChange={(e) => setQuickCustCompany(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="submit"
                    data-testid="pq-quick-cust-submit"
                    disabled={quickCustSaving}
                    style={{
                      flex: 1,
                      minHeight: '38px',
                      padding: '7px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: 'var(--accent-text)',
                      color: '#0F172A',
                      fontWeight: 700,
                      fontSize: '12.5px',
                      cursor: 'pointer',
                    }}
                  >
                    {quickCustSaving ? 'Đang lưu…' : 'Lưu & Chọn ngay'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {/* NHÓM 2: SẢN PHẨM ĐẶT IN (Tự động thu gọn sản phẩm đã xong, hỗ trợ Sửa, Nhân đôi, Xóa) */}
      <div id="pq-sec-products" style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: openSections.products ? '12px' : 0,
          }}
        >
          <button
            type="button"
            data-testid="pq-toggle-sec-products"
            onClick={() => toggleSection('products')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              color: 'var(--text-color)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                fontSize: '14px',
                fontWeight: 800,
                color: 'var(--accent-text)',
              }}
            >
              {openSections.products ? '▾' : '▸'} 2. Sản phẩm đặt in (
              {draftLines.length} món)
            </span>
          </button>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {draftLines.length > 1 && openSections.products && (
              <button
                type="button"
                data-testid="pq-collapse-all-lines-btn"
                onClick={() => {
                  const allCollapsed = draftLines.every(
                    (l) => collapsedLineIds[l.id],
                  );
                  if (allCollapsed) {
                    setCollapsedLineIds({});
                  } else {
                    const next: Record<string, boolean> = {};
                    draftLines.forEach((l) => {
                      next[l.id] = true;
                    });
                    setCollapsedLineIds(next);
                  }
                }}
                style={{
                  minHeight: '40px',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'transparent',
                  color: 'var(--muted-color)',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {draftLines.every((l) => collapsedLineIds[l.id])
                  ? '▾ Mở rộng tất cả'
                  : '▴ Thu gọn tất cả'}
              </button>
            )}

            <button
              type="button"
              data-testid="pq-add-line-btn"
              onClick={handleAddProductLine}
              style={{
                minHeight: '40px',
                padding: '7px 12px',
                borderRadius: '8px',
                border: '1px solid var(--accent-text)',
                backgroundColor: 'var(--accent-soft)',
                color: 'var(--accent-text)',
                fontWeight: 700,
                fontSize: '12.5px',
                cursor: 'pointer',
              }}
            >
              + Thêm sản phẩm in
            </button>
          </div>
        </div>

        {openSections.products && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            {draftLines.map((line, idx) => {
              const isCollapsed =
                draftLines.length > 1 && Boolean(collapsedLineIds[line.id]);
              const calcLine = livePricingResult.calc?.lines[idx];
              const rawQtyInput =
                line.quantityInput !== undefined
                  ? line.quantityInput
                  : String(line.quantity);
              const rawCostInput =
                line.vendorCostInput !== undefined
                  ? line.vendorCostInput
                  : String(line.vendorCostValue);
              const rawProfitInput =
                line.profitInput !== undefined
                  ? line.profitInput
                  : String(line.profitValue);
              const costAllowDecimal = !Number.isInteger(line.vendorCostValue);
              const profitAllowDecimal =
                line.profitMode === ProfitMode.PERCENTAGE;
              const lineErr = livePricingResult.lineErrors?.[line.id];

              return (
                <div
                  key={line.id}
                  data-testid={`pq-line-card-${idx}`}
                  data-collapsed={isCollapsed ? 'true' : 'false'}
                  style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    padding: '12px',
                    backgroundColor: 'var(--bg-color)',
                  }}
                >
                  {/* Thanh tiêu đề & tóm tắt gọn cho từng sản phẩm (Không lặp thông tin khi đang mở chỉnh sửa) */}
                  <div
                    data-testid={
                      isCollapsed
                        ? `pq-line-collapsed-${idx}`
                        : `pq-line-header-${idx}`
                    }
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '8px',
                      marginBottom: isCollapsed ? 0 : '10px',
                    }}
                  >
                    {isCollapsed ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          flexWrap: 'wrap',
                          flex: 1,
                          minWidth: '180px',
                        }}
                      >
                        <strong
                          style={{
                            fontSize: '13px',
                            color: 'var(--accent-text)',
                          }}
                        >
                          #{idx + 1}. {line.name || `Sản phẩm #${idx + 1}`}
                        </strong>
                        <span
                          style={{
                            fontSize: '12px',
                            color: 'var(--muted-color)',
                          }}
                        >
                          (
                          {rawQtyInput === ''
                            ? 'Chưa nhập SL'
                            : `${formatNumberVn(line.quantity)} ${line.unit || 'tờ'}`}
                          )
                        </span>
                        {calcLine && (
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 700,
                              color: 'var(--text-color)',
                            }}
                          >
                            {calcLine.roundingAdjustment !== 0 ? (
                              <>
                                • Đơn giá gộp ship:{' '}
                                {formatExactVnd(calcLine.rawFinalUnitPrice)}/
                                {line.unit || 'tờ'} (làm tròn{' '}
                                {formatVnd(calcLine.finalUnitPrice)}) • Thành
                                tiền: {formatVnd(calcLine.reconciledLineTotal)}
                              </>
                            ) : (
                              <>
                                • Báo khách:{' '}
                                {formatVnd(calcLine.finalUnitPrice)}/
                                {line.unit || 'tờ'} (Thành tiền:{' '}
                                {formatVnd(calcLine.reconciledLineTotal)})
                              </>
                            )}
                          </span>
                        )}
                        {calcLine && (
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: 'var(--success-text)',
                            }}
                          >
                            | 🔒 Lời: +{formatVnd(calcLine.totalProfit)}
                          </span>
                        )}
                      </div>
                    ) : (
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
                            fontSize: '13px',
                            color: 'var(--accent-text)',
                          }}
                        >
                          Sản phẩm #{idx + 1}
                        </strong>
                        {calcLine && (
                          <span
                            style={{
                              fontSize: '12px',
                              color: 'var(--muted-color)',
                            }}
                          >
                            • Thành tiền dòng này:{' '}
                            <strong style={{ color: 'var(--text-color)' }}>
                              {formatVnd(calcLine.reconciledLineTotal)}
                            </strong>{' '}
                            (🔒 Lời:{' '}
                            <strong style={{ color: 'var(--success-text)' }}>
                              +{formatVnd(calcLine.totalProfit)}
                            </strong>
                            )
                          </span>
                        )}
                      </div>
                    )}

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap',
                      }}
                    >
                      {draftLines.length > 1 && (
                        <button
                          type="button"
                          data-testid={`pq-line-toggle-${idx}`}
                          onClick={() =>
                            setCollapsedLineIds((prev) => ({
                              ...prev,
                              [line.id]: !prev[line.id],
                            }))
                          }
                          style={{
                            minHeight: '38px',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--accent-text)',
                            backgroundColor: isCollapsed
                              ? 'var(--accent-soft)'
                              : 'transparent',
                            color: 'var(--accent-text)',
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {isCollapsed ? '✏️ Sửa' : '✓ Thu gọn'}
                        </button>
                      )}

                      <button
                        type="button"
                        data-testid={`pq-line-duplicate-${idx}`}
                        onClick={() => handleDuplicateProductLine(idx)}
                        style={{
                          minHeight: '38px',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--surface-color)',
                          color: 'var(--text-color)',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        📋 Nhân đôi
                      </button>

                      {draftLines.length > 1 && (
                        <button
                          type="button"
                          data-testid={`pq-line-delete-${idx}`}
                          onClick={() => handleRemoveProductLine(idx)}
                          style={{
                            minHeight: '38px',
                            padding: '6px 12px',
                            borderRadius: '8px',
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
                  </div>

                  {/* Nội dung chỉnh sửa sản phẩm (ẩn gọn khi isCollapsed === true) */}
                  {!isCollapsed && (
                    <div>
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
                            Chọn nhanh từ Bảng giá Nhà in
                          </label>
                          <select
                            aria-label={`Chọn bảng giá nhà in dòng ${idx + 1}`}
                            style={inputStyle}
                            value={line.vendorPriceItemId}
                            onChange={(e) =>
                              onSelectCatalogItem(idx, e.target.value)
                            }
                          >
                            <option value="">
                              -- Tự nhập thông tin bên dưới --
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
                                  i === idx
                                    ? { ...l, name: e.target.value }
                                    : l,
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
                            <NumericDraftInput
                              ariaLabel={`Số lượng dòng ${idx + 1}`}
                              allowDecimal={false}
                              placeholder="VD: 500"
                              style={inputStyle}
                              invalid={Boolean(lineErr?.quantity)}
                              value={rawQtyInput}
                              onValueChange={(nextRaw) => {
                                const parsed = parseNumericDraftValue(nextRaw, {
                                  allowDecimal: false,
                                  min: 1,
                                  integerOnly: true,
                                });
                                setDraftLines((prev) =>
                                  prev.map((l, i) =>
                                    i === idx
                                      ? {
                                          ...l,
                                          quantityInput: nextRaw,
                                          ...(parsed.isValid &&
                                          parsed.value !== null
                                            ? { quantity: parsed.value }
                                            : {}),
                                        }
                                      : l,
                                  ),
                                );
                              }}
                            />
                          </div>
                          <div style={{ flex: 1 }}>
                            <label style={labelStyle}>Đơn vị</label>
                            <input
                              aria-label={`Đơn vị tính dòng ${idx + 1}`}
                              style={inputStyle}
                              value={line.unit}
                              onChange={(e) =>
                                setDraftLines((prev) =>
                                  prev.map((l, i) =>
                                    i === idx
                                      ? { ...l, unit: e.target.value }
                                      : l,
                                  ),
                                )
                              }
                            />
                          </div>
                        </div>
                      </div>

                      {/* Khung Giá gốc Nhà in & Tiền lời (Nội bộ) */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                          gap: '10px',
                          marginTop: '10px',
                          padding: '10px',
                          borderRadius: '8px',
                          border: '1px dashed var(--border-color)',
                          backgroundColor: 'var(--surface-color)',
                        }}
                      >
                        <div>
                          <label style={labelStyle}>
                            🔒 Giá gốc nhà in tính theo
                          </label>
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
                              Từng {line.unit || 'cái'} (1 đơn vị)
                            </option>
                            <option value={VendorCostMode.TOTAL_BATCH}>
                              Trọn lô (
                              {rawQtyInput === '' ? '?' : line.quantity}{' '}
                              {line.unit || 'cái'})
                            </option>
                          </select>
                        </div>

                        <div>
                          <label style={labelStyle}>
                            {line.vendorCostMode === VendorCostMode.PER_UNIT
                              ? `Giá nhà in / 1 ${line.unit || 'cái'} (đ)`
                              : 'Tổng giá nhà in cả lô (đ)'}
                          </label>
                          <NumericDraftInput
                            ariaLabel={`Giá trị giá vốn dòng ${idx + 1}`}
                            allowDecimal={costAllowDecimal}
                            placeholder="Nhập 0 nếu miễn phí"
                            style={inputStyle}
                            invalid={Boolean(lineErr?.vendorCost)}
                            value={rawCostInput}
                            onValueChange={(nextRaw) => {
                              const parsed = parseNumericDraftValue(nextRaw, {
                                allowDecimal: costAllowDecimal,
                                min: 0,
                                integerOnly: !costAllowDecimal,
                              });
                              setDraftLines((prev) =>
                                prev.map((l, i) =>
                                  i === idx
                                    ? {
                                        ...l,
                                        vendorCostInput: nextRaw,
                                        ...(parsed.isValid &&
                                        parsed.value !== null
                                          ? { vendorCostValue: parsed.value }
                                          : {}),
                                      }
                                    : l,
                                ),
                              );
                            }}
                          />
                        </div>

                        <div>
                          <label style={labelStyle}>
                            🔒 Tiền lời tính theo
                          </label>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <select
                              aria-label={`Kiểu lợi nhuận dòng ${idx + 1}`}
                              style={inputStyle}
                              value={line.profitMode}
                              onChange={(e) => {
                                const nextMode = e.target
                                  .value as ProfitModeType;
                                setDraftLines((prev) =>
                                  prev.map((l, i) => {
                                    if (i !== idx) return l;
                                    let nextProfitInput = l.profitInput;
                                    let nextProfitValue = l.profitValue;
                                    if (
                                      nextMode === ProfitMode.FIXED_AMOUNT &&
                                      nextProfitInput !== undefined &&
                                      nextProfitInput.includes('.')
                                    ) {
                                      const rounded = Math.max(
                                        0,
                                        Math.round(
                                          Number(nextProfitInput) || 0,
                                        ),
                                      );
                                      nextProfitValue = rounded;
                                      nextProfitInput = String(rounded);
                                    }
                                    return {
                                      ...l,
                                      profitMode: nextMode,
                                      profitValue: nextProfitValue,
                                      profitInput: nextProfitInput,
                                    };
                                  }),
                                );
                              }}
                            >
                              <option value={ProfitMode.FIXED_AMOUNT}>
                                Số tiền (đ)
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
                                  Mỗi {line.unit || 'cái'}
                                </option>
                                <option value={ProfitScope.TOTAL_BATCH}>
                                  Cả lô
                                </option>
                              </select>
                            )}
                          </div>
                        </div>

                        <div>
                          <label style={labelStyle}>
                            {line.profitMode === ProfitMode.PERCENTAGE
                              ? 'Mức lời (% trên giá gốc)'
                              : line.profitScope === ProfitScope.PER_UNIT
                                ? `Tiền lời / 1 ${line.unit || 'cái'} (đ)`
                                : 'Tổng tiền lời cả lô (đ)'}
                          </label>
                          <NumericDraftInput
                            ariaLabel={`Giá trị lợi nhuận dòng ${idx + 1}`}
                            allowDecimal={profitAllowDecimal}
                            placeholder={
                              profitAllowDecimal
                                ? 'VD: 15 hoặc 12.5'
                                : 'Nhập 0 nếu không lời'
                            }
                            style={inputStyle}
                            invalid={Boolean(lineErr?.profit)}
                            value={rawProfitInput}
                            onValueChange={(nextRaw) => {
                              const parsed = parseNumericDraftValue(nextRaw, {
                                allowDecimal: profitAllowDecimal,
                                min: 0,
                                integerOnly: !profitAllowDecimal,
                              });
                              setDraftLines((prev) =>
                                prev.map((l, i) =>
                                  i === idx
                                    ? {
                                        ...l,
                                        profitInput: nextRaw,
                                        ...(parsed.isValid &&
                                        parsed.value !== null
                                          ? { profitValue: parsed.value }
                                          : {}),
                                      }
                                    : l,
                                ),
                              );
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* NHÓM 3: PHÍ GIAO HÀNG & BẢNG TỔNG KẾT DUY NHẤT (CHUYỂN ĐỔI BẢN GỬI KHÁCH / NỘI BỘ) */}
      <div id="pq-sec-summary" style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: openSections.summary ? '12px' : 0,
          }}
        >
          <button
            type="button"
            data-testid="pq-toggle-sec-summary"
            onClick={() => toggleSection('summary')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              color: 'var(--text-color)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                fontSize: '14px',
                fontWeight: 800,
                color: 'var(--accent-text)',
              }}
            >
              {openSections.summary ? '▾' : '▸'} 3. Phí giao hàng & Tổng kết báo
              giá
            </span>
          </button>

          <button
            type="button"
            data-testid="pq-advanced-options-toggle"
            onClick={() => {
              setOpenSections((prev) => ({ ...prev, summary: true }));
              setShowAdvancedOptions((v) => !v);
            }}
            style={{
              minHeight: '38px',
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: showAdvancedOptions
                ? 'var(--accent-soft)'
                : 'transparent',
              color: showAdvancedOptions
                ? 'var(--accent-text)'
                : 'var(--muted-color)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ⚙️ Tùy chọn nâng cao {showAdvancedOptions ? '▴' : '▾'}
          </button>
        </div>

        {openSections.summary && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            {/* Phí vận chuyển (nhập 1 lần cho toàn đơn) + Gộp vào đơn giá */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '12px',
                alignItems: 'end',
              }}
            >
              <div>
                <label style={labelStyle} htmlFor="pq-shipping-input">
                  Phí giao hàng toàn đơn (đ — tính 1 lần)
                </label>
                <NumericDraftInput
                  id="pq-shipping-input"
                  dataTestId="pq-shipping-input"
                  allowDecimal={false}
                  placeholder="Nhập 0 nếu miễn phí giao hàng"
                  style={inputStyle}
                  invalid={Boolean(livePricingResult.shippingError)}
                  value={resolvedShippingFeeInput}
                  onValueChange={(nextRaw) => {
                    onChangeShippingFeeInput?.(nextRaw);
                    const parsed = parseNumericDraftValue(nextRaw, {
                      allowDecimal: false,
                      min: 0,
                      integerOnly: true,
                    });
                    if (parsed.isValid && parsed.value !== null) {
                      onChangeShippingFee(parsed.value);
                    }
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  minHeight: '38px',
                }}
              >
                <input
                  id="pq-merge-ship-checkbox"
                  data-testid="pq-merge-ship-checkbox"
                  type="checkbox"
                  checked={includeShippingInUnitPrice}
                  onChange={(e) =>
                    onChangeIncludeShippingInUnitPrice(e.target.checked)
                  }
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label
                  htmlFor="pq-merge-ship-checkbox"
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    cursor: 'pointer',
                  }}
                >
                  Cộng gộp phí giao hàng vào đơn giá khách (Ẩn dòng ship trên
                  PDF)
                </label>
              </div>
            </div>

            {/* Khung Tùy chọn nâng cao (mặc định thu gọn) */}
            {showAdvancedOptions && (
              <div
                data-testid="pq-advanced-options-panel"
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1px dashed var(--border-color)',
                  backgroundColor: 'var(--bg-color)',
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                  gap: '10px',
                }}
              >
                <div>
                  <label style={labelStyle} htmlFor="pq-valid-until">
                    Hiệu lực báo giá đến ngày
                  </label>
                  <input
                    id="pq-valid-until"
                    type="date"
                    style={inputStyle}
                    value={validUntil}
                    onChange={(e) => onChangeValidUntil(e.target.value)}
                  />
                </div>

                <div>
                  <label style={labelStyle} htmlFor="pq-ship-alloc-select">
                    Cách chia phí giao hàng (khi nhiều món)
                  </label>
                  <select
                    id="pq-ship-alloc-select"
                    style={inputStyle}
                    value={shippingAllocation}
                    onChange={(e) =>
                      onChangeShippingAllocation(
                        e.target.value as ShippingAllocationStrategyType,
                      )
                    }
                  >
                    <option
                      value={
                        ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT
                      }
                    >
                      Theo tỷ trọng giá trị sản phẩm
                    </option>
                    <option
                      value={
                        ShippingAllocationStrategy.PROPORTIONAL_BY_QUANTITY
                      }
                    >
                      Theo tỷ lệ số lượng đặt in
                    </option>
                    <option value={ShippingAllocationStrategy.EQUAL_SPLIT}>
                      Chia đều cho từng dòng sản phẩm
                    </option>
                  </select>
                </div>

                <div>
                  <label style={labelStyle} htmlFor="pq-rounding-step-select">
                    Làm tròn đơn giá báo khách
                  </label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <select
                      id="pq-rounding-step-select"
                      aria-label="Kiểu làm tròn đơn giá"
                      style={inputStyle}
                      value={roundingMode}
                      onChange={(e) =>
                        onChangeRoundingMode(e.target.value as RoundingModeType)
                      }
                    >
                      <option value={RoundingMode.CEIL}>
                        Làm tròn lên (Giữ nguyên lời)
                      </option>
                      <option value={RoundingMode.NEAREST}>
                        Làm tròn gần nhất
                      </option>
                      <option value={RoundingMode.FLOOR}>Làm tròn xuống</option>
                    </select>
                    <select
                      aria-label="Bước làm tròn VNĐ"
                      style={{ ...inputStyle, maxWidth: '110px' }}
                      value={roundingStep}
                      onChange={(e) =>
                        onChangeRoundingStep(Number(e.target.value) || 1)
                      }
                    >
                      <option value={1}>1 ₫</option>
                      <option value={100}>100 ₫</option>
                      <option value={1000}>1.000 ₫</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={labelStyle} htmlFor="pq-internal-notes">
                    🔒 Ghi chú nội bộ (Không in lên PDF)
                  </label>
                  <input
                    id="pq-internal-notes"
                    style={inputStyle}
                    value={internalNotes}
                    onChange={(e) => onChangeInternalNotes(e.target.value)}
                    placeholder="VD: Đặt xưởng Sài Gòn, cọc 50%"
                  />
                </div>
              </div>
            )}

            {/* 4 thẻ số liệu tổng hợp (Luôn hiển thị rõ ràng cho Owner khi dữ liệu hợp lệ) */}
            {livePricingResult.calc && livePricingResult.customerPdf ? (
              <div
                data-testid="pq-live-breakdown"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div
                      style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                    >
                      🔒 Tổng giá gốc nhà in
                    </div>
                    <div
                      data-testid="pq-summary-vendor-cost"
                      style={{ fontSize: '15px', fontWeight: 700 }}
                    >
                      {formatVnd(livePricingResult.calc.totalVendorCost)}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div
                      style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                    >
                      🔒 Tổng tiền lời ròng
                    </div>
                    <div
                      data-testid="pq-summary-profit"
                      style={{
                        fontSize: '15px',
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
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div
                      style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                    >
                      Phí giao hàng (1 lần)
                    </div>
                    <div
                      data-testid="pq-summary-shipping"
                      style={{ fontSize: '15px', fontWeight: 700 }}
                    >
                      {formatVnd(livePricingResult.calc.shippingFee)}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--accent-soft)',
                      border: '1px solid var(--accent-text)',
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
                        fontSize: '16px',
                        fontWeight: 800,
                        color: 'var(--accent-text)',
                      }}
                    >
                      {formatVnd(livePricingResult.calc.totalQuoteAmount)}
                    </div>
                  </div>
                </div>

                {/* BẢNG TỔNG KẾT DUY NHẤT: Chuyển đổi giữa Bản gửi khách & Bóc tách nội bộ */}
                <div
                  data-testid="pq-customer-safe-card"
                  style={{
                    border:
                      summaryViewMode === 'customer'
                        ? '1px solid var(--success-text)'
                        : '1px solid var(--accent-text)',
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
                      flexWrap: 'wrap',
                      gap: '8px',
                      marginBottom: '10px',
                    }}
                  >
                    <div
                      role="group"
                      aria-label="Chế độ xem bảng tổng kết"
                      style={{
                        display: 'flex',
                        gap: '6px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        type="button"
                        data-testid="pq-view-mode-customer"
                        onClick={() => setSummaryViewMode('customer')}
                        style={{
                          minHeight: '40px',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border:
                            summaryViewMode === 'customer'
                              ? '1px solid var(--success-text)'
                              : '1px solid var(--border-color)',
                          backgroundColor:
                            summaryViewMode === 'customer'
                              ? 'rgba(16, 185, 129, 0.14)'
                              : 'var(--surface-color)',
                          color:
                            summaryViewMode === 'customer'
                              ? 'var(--success-text)'
                              : 'var(--text-color)',
                          fontWeight: 700,
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        📄 Bản gửi khách (Ẩn giá vốn)
                      </button>

                      <button
                        type="button"
                        data-testid="pq-view-mode-internal"
                        onClick={() => setSummaryViewMode('internal')}
                        style={{
                          minHeight: '40px',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border:
                            summaryViewMode === 'internal'
                              ? '1px solid var(--accent-text)'
                              : '1px solid var(--border-color)',
                          backgroundColor:
                            summaryViewMode === 'internal'
                              ? 'var(--accent-soft)'
                              : 'var(--surface-color)',
                          color:
                            summaryViewMode === 'internal'
                              ? 'var(--accent-text)'
                              : 'var(--text-color)',
                          fontWeight: 700,
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        🔒 Bóc tách nội bộ (Giá vốn & Lời)
                      </button>
                    </div>

                    <StatusBadge
                      status={
                        summaryViewMode === 'customer' ? 'success' : 'neutral'
                      }
                      label={
                        summaryViewMode === 'customer'
                          ? 'An toàn gửi khách'
                          : 'Nội bộ Owner'
                      }
                    />
                  </div>

                  {summaryViewMode === 'customer' ? (
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
                            <th style={{ padding: '6px' }}>Sản phẩm in</th>
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
                          {livePricingResult.customerPdf.lines.map(
                            (item, lineIdx) => {
                              const rawUnit =
                                draftLines[lineIdx]?.unit || item.unit || 'tờ';
                              const priceDisplay =
                                formatCustomerLinePriceDisplay(
                                  item.lineTotal,
                                  item.quantity,
                                  rawUnit,
                                );
                              return (
                                <tr
                                  key={item.id}
                                  style={{
                                    borderBottom:
                                      '1px solid var(--border-color)',
                                  }}
                                >
                                  <td
                                    style={{ padding: '6px', fontWeight: 600 }}
                                  >
                                    {item.name}
                                  </td>
                                  <td
                                    style={{
                                      padding: '6px',
                                      textAlign: 'right',
                                    }}
                                  >
                                    {formatNumberVn(item.quantity)}
                                  </td>
                                  <td
                                    style={{
                                      padding: '6px',
                                      textAlign: 'right',
                                    }}
                                  >
                                    <div>{priceDisplay.unitPriceDisplay}</div>
                                    {priceDisplay.priceSubNote && (
                                      <div
                                        style={{
                                          fontSize: '12px',
                                          color: 'var(--muted-color)',
                                          fontWeight: 400,
                                        }}
                                      >
                                        ({priceDisplay.priceSubNote})
                                      </div>
                                    )}
                                  </td>
                                  <td
                                    style={{
                                      padding: '6px',
                                      textAlign: 'right',
                                      fontWeight: 700,
                                    }}
                                  >
                                    <div>{formatVnd(item.lineTotal)}</div>
                                  </td>
                                </tr>
                              );
                            },
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
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
                              Giá vốn
                            </th>
                            <th style={{ padding: '6px', textAlign: 'right' }}>
                              Tiền lời
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
                              <td
                                style={{ padding: '6px', textAlign: 'right' }}
                              >
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
                              <td
                                style={{ padding: '6px', textAlign: 'right' }}
                              >
                                {formatVnd(item.allocatedShippingFee)}
                              </td>
                              <td
                                style={{
                                  padding: '6px',
                                  textAlign: 'right',
                                  fontWeight: 700,
                                }}
                              >
                                <div>{formatVnd(item.finalUnitPrice)}</div>
                                {item.roundingAdjustment !== 0 && (
                                  <div
                                    style={{
                                      fontSize: '12px',
                                      color: 'var(--muted-color)',
                                      fontWeight: 400,
                                    }}
                                  >
                                    (Chuẩn:{' '}
                                    {formatExactVnd(item.rawFinalUnitPrice)} |
                                    Cân đối:{' '}
                                    {formatVnd(item.roundingAdjustment)})
                                  </div>
                                )}
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
                  )}

                  {/* Dòng tổng cộng & số tiền bằng chữ */}
                  <div
                    style={{
                      fontSize: '12.5px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--surface-color)',
                      marginTop: '10px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '4px',
                        flexWrap: 'wrap',
                        gap: '4px',
                      }}
                    >
                      <span>Phí giao hàng trên PDF:</span>
                      <strong>
                        {livePricingResult.customerPdf
                          .includeShippingInUnitPrice
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
                        fontSize: '14.5px',
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
                        marginTop: '2px',
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
                </div>

                {/* Ghi chú in trên PDF gửi khách */}
                <div>
                  <label style={labelStyle} htmlFor="pq-customer-notes">
                    Ghi chú in trên PDF gửi khách
                  </label>
                  <textarea
                    id="pq-customer-notes"
                    rows={2}
                    style={inputStyle}
                    value={customerNotes}
                    onChange={(e) => onChangeCustomerNotes(e.target.value)}
                  />
                </div>

                {editingQuoteId && (
                  <div>
                    <label style={labelStyle} htmlFor="pq-version-note">
                      Nội dung cập nhật phiên bản mới (v
                      {editingQuoteVersion + 1})
                    </label>
                    <input
                      id="pq-version-note"
                      style={inputStyle}
                      value={versionChangeNote}
                      onChange={(e) =>
                        onChangeVersionChangeNote(e.target.value)
                      }
                      placeholder="VD: Khách tăng số lượng lên 500 tờ"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div
                role="alert"
                data-testid="pq-incomplete-pricing-notice"
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--danger-text)',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: 'var(--text-color)',
                  fontSize: '12.5px',
                  lineHeight: 1.5,
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: 'var(--danger-text)',
                    marginBottom: '4px',
                  }}
                >
                  Chưa đủ dữ liệu hợp lệ để tính tổng tiền báo giá:
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  {(livePricingResult.validationErrors &&
                  livePricingResult.validationErrors.length > 0
                    ? livePricingResult.validationErrors
                    : [
                        livePricingResult.error ||
                          'Vui lòng nhập đầy đủ số lượng (từ 1 trở lên) và đơn giá hợp lệ.',
                      ]
                  ).map((errText, errIdx) => (
                    <li key={errIdx}>{errText}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* NHÓM 4: THANH HÀNH ĐỘNG CHÍNH (LƯU BÁO GIÁ / XUẤT PDF A4 — KHÔNG CHE NỘI DUNG MOBILE & TRÁNH NÚT BÁO LỖI NỔI) */}
      <div
        id="pq-sec-actions"
        data-testid="pq-action-bar"
        style={{
          ...cardStyle,
          border: '1px solid var(--accent-text)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ fontSize: '13.5px', fontWeight: 800 }}>
            4. Hoàn tất & Xuất báo giá PDF A4
          </div>
          <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            {isQuoteIncomplete
              ? '(Nhập đủ Số lượng, Giá nhà in và Tiền lời hợp lệ để mở khóa Lưu & Xuất PDF)'
              : '(Lưu vào hệ thống hoặc tải file PDF A4 gửi khách ngay)'}
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button
            type="button"
            data-testid="pq-save-quote-btn"
            disabled={isQuoteIncomplete}
            onClick={onSaveQuote}
            style={{
              flex: '1 1 170px',
              minHeight: '44px',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'var(--accent-text)',
              color: '#0F172A',
              fontWeight: 800,
              fontSize: '13.5px',
              opacity: isQuoteIncomplete ? 0.55 : 1,
              cursor: isQuoteIncomplete ? 'not-allowed' : 'pointer',
            }}
          >
            {editingQuoteId
              ? `💾 Lưu Phiên bản v${editingQuoteVersion + 1}`
              : '💾 Lưu Báo giá (v1)'}
          </button>

          <button
            type="button"
            data-testid="pq-download-pdf-btn"
            disabled={isQuoteIncomplete}
            onClick={onDownloadLivePdf}
            style={{
              flex: '1 1 170px',
              minHeight: '44px',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid var(--accent-text)',
              backgroundColor: 'var(--accent-soft)',
              color: 'var(--accent-text)',
              fontWeight: 700,
              fontSize: '13.5px',
              opacity: isQuoteIncomplete ? 0.55 : 1,
              cursor: isQuoteIncomplete ? 'not-allowed' : 'pointer',
            }}
          >
            ⬇️ Tải PDF A4 ({editingQuoteCode || 'BG-DRAFT'}.pdf)
          </button>

          <button
            type="button"
            data-testid="pq-preview-pdf-btn"
            disabled={isQuoteIncomplete}
            onClick={onOpenLivePreview}
            style={{
              flex: '1 1 150px',
              minHeight: '44px',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--surface-color)',
              color: 'var(--text-color)',
              fontWeight: 700,
              fontSize: '13.5px',
              opacity: isQuoteIncomplete ? 0.55 : 1,
              cursor: isQuoteIncomplete ? 'not-allowed' : 'pointer',
            }}
          >
            👁️ Xem trước PDF A4
          </button>

          {/* Vùng đệm tự động tránh nút Báo lỗi nổi ở góc phải dưới trên màn hình rộng */}
          <div
            aria-hidden="true"
            style={{ flex: '0 0 110px', height: '1px' }}
          />
        </div>
      </div>
    </div>
  );
};
