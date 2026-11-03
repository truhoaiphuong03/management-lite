import React, { useState, useEffect, useMemo } from 'react';
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
  EMPTY_DRAFT_LINE,
  cardStyle,
  inputStyle,
  labelStyle,
  type DraftLineState,
  type SummaryViewMode,
} from './types.js';
import { NumericDraftInput } from './NumericDraftInput.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';

export interface CreateQuoteTabProps {
  editingQuoteId: string | null;
  editingQuoteCode: string | null;
  editingQuoteVersion: number;
  isLockedQuoteForEdit?: boolean | undefined;
  lockedQuoteStatusLabel?: string | undefined;
  onCloneLockedQuote?: (() => void) | undefined;
  onBackToQuotes: () => void;
  hasTouchedFields?: boolean | undefined;
  onMarkTouched?: (() => void) | undefined;
  savingQuote?: boolean | undefined;
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
  isLockedQuoteForEdit = false,
  lockedQuoteStatusLabel,
  onCloneLockedQuote,
  onBackToQuotes,
  hasTouchedFields = false,
  onMarkTouched,
  savingQuote = false,
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
  const [collapsedLineIds, setCollapsedLineIds] = useState<
    Record<string, boolean>
  >({});
  const [summaryViewMode, setSummaryViewMode] =
    useState<SummaryViewMode>('customer');
  const [showAdvancedOptions, setShowAdvancedOptions] =
    useState<boolean>(false);

  // Quick customer modal dialog
  const [showQuickCustomerModal, setShowQuickCustomerModal] =
    useState<boolean>(false);
  const [quickCustName, setQuickCustName] = useState<string>('');
  const [quickCustPhone, setQuickCustPhone] = useState<string>('');
  const [quickCustCompany, setQuickCustCompany] = useState<string>('');
  const [quickCustSaving, setQuickCustSaving] = useState<boolean>(false);

  // Catalog picker modal dialog for a specific product line
  const [catalogPickerLineIdx, setCatalogPickerLineIdx] = useState<
    number | null
  >(null);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState<string>('');

  useEffect(() => {
    if (draftLines.length === 1 && draftLines[0]) {
      const onlyId = draftLines[0].id;
      if (collapsedLineIds[onlyId]) {
        setCollapsedLineIds({});
      }
    }
  }, [draftLines, collapsedLineIds]);

  const filteredCatalogItems = useMemo(() => {
    const q = catalogSearchQuery.trim().toLowerCase();
    if (!q) return priceItems;
    return priceItems.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.specification || '').toLowerCase().includes(q) ||
        (p.vendor_name || '').toLowerCase().includes(q),
    );
  }, [priceItems, catalogSearchQuery]);

  const focusQuantityForLine = (idx: number) => {
    if (typeof document === 'undefined') return;
    setTimeout(() => {
      const el = document.getElementById(
        `pq-line-qty-${idx}`,
      ) as HTMLInputElement | null;
      el?.focus();
    }, 30);
  };

  const handleAddProductLine = () => {
    onMarkTouched?.();
    const nextCollapsed: Record<string, boolean> = {};
    for (const existing of draftLines) {
      nextCollapsed[existing.id] = true;
    }
    setCollapsedLineIds(nextCollapsed);
    setDraftLines((prev) => {
      const nextIdx = prev.length + 1;
      const newLine: DraftLineState = {
        ...EMPTY_DRAFT_LINE(nextIdx),
        id: `ITEM-${Date.now()}-${nextIdx}`,
      };
      return [...prev, newLine];
    });
  };

  const handleDuplicateProductLine = (idx: number) => {
    onMarkTouched?.();
    setDraftLines((prev) => {
      const source = prev[idx];
      if (!source) return prev;
      const clonedId = `ITEM-${Date.now()}-${prev.length + 1}`;
      const cloned: DraftLineState = {
        ...source,
        id: clonedId,
        name: source.name ? `${source.name} (Bản sao)` : '',
      };
      const nextCollapsed: Record<string, boolean> = {};
      for (const existing of prev) {
        nextCollapsed[existing.id] = true;
      }
      nextCollapsed[clonedId] = false;
      setCollapsedLineIds(nextCollapsed);
      const copy = [...prev];
      copy.splice(idx + 1, 0, cloned);
      return copy;
    });
  };

  const handleRemoveProductLine = (idx: number) => {
    onMarkTouched?.();
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
        onMarkTouched?.();
        onChangeSelectedCustomerId(created.id);
        setQuickCustName('');
        setQuickCustPhone('');
        setQuickCustCompany('');
        setShowQuickCustomerModal(false);
      }
    } finally {
      setQuickCustSaving(false);
    }
  };

  const resolvedShippingFeeInput =
    shippingFeeInput !== undefined ? shippingFeeInput : String(shippingFee);
  const isQuoteIncomplete = Boolean(
    livePricingResult.error ||
    !livePricingResult.calc ||
    !livePricingResult.customerPdf,
  );
  const showValidationState = Boolean(editingQuoteId || hasTouchedFields);

  if (isLockedQuoteForEdit) {
    return (
      <div style={cardStyle} data-testid="pq-locked-quote-edit-card">
        <h2 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 700 }}>
          Báo giá {editingQuoteCode || ''} đã khóa chỉnh sửa trực tiếp
        </h2>
        <p
          style={{
            margin: '0 0 14px',
            fontSize: '13px',
            color: 'var(--muted-color)',
            lineHeight: 1.5,
          }}
        >
          Báo giá đang ở trạng thái{' '}
          <strong>{lockedQuoteStatusLabel || 'Đã chốt'}</strong> để đảm bảo tính
          bất biến lịch sử giá. Bạn có thể tạo một báo giá mới sao chép toàn bộ
          sản phẩm từ bản này.
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {onCloneLockedQuote && (
            <button
              type="button"
              data-testid="pq-clone-locked-quote-btn"
              onClick={onCloneLockedQuote}
              style={{
                minHeight: '44px',
                padding: '10px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--primary-color)',
                color: 'var(--inverse-text)',
                fontWeight: 800,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              📋 Tạo báo giá mới từ bản này
            </button>
          )}
          <button
            type="button"
            data-testid="pq-editor-back-btn"
            onClick={onBackToQuotes}
            style={{
              minHeight: '44px',
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'transparent',
              color: 'var(--text-color)',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            ← Quay lại chi tiết báo giá
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="panel-create-quote"
      style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
    >
      {/* Focused Editor Header Bar */}
      <div
        style={{
          ...cardStyle,
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            data-testid="pq-editor-back-btn"
            onClick={onBackToQuotes}
            style={{
              minHeight: '44px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-color)',
              color: 'var(--text-color)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {editingQuoteId ? '← Chi tiết báo giá' : '← Báo giá'}
          </button>

          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>
              {editingQuoteId
                ? `Sửa Báo giá ${editingQuoteCode || ''}`
                : 'Tạo báo giá mới'}
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
              {editingQuoteId
                ? `Lưu thay đổi sẽ tạo Phiên bản v${editingQuoteVersion + 1} và mở ngay trang Chi tiết báo giá`
                : 'Sau khi lưu sẽ tự chuyển sang trang Chi tiết báo giá để kiểm tra A4 và tải PDF'}
            </div>
          </div>
        </div>

        <button
          type="button"
          data-testid="pq-reset-draft-btn"
          onClick={onResetNewQuote}
          style={{
            minHeight: '44px',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            backgroundColor: 'transparent',
            color: 'var(--muted-color)',
            fontSize: '12.5px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {editingQuoteId ? '+ Chuyển sang Tạo mới' : '↺ Làm mới ô nhập'}
        </button>
      </div>

      {/* Desktop 2-Column / Mobile 1-Column Responsive Grid */}
      <div className="pq-editor-grid">
        {/* LEFT COLUMN: Customer + Product Lines + Shipping/Notes */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            minWidth: 0,
          }}
        >
          {/* 1. Customer & Quote Title */}
          <div id="pq-sec-customer" style={cardStyle}>
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
              <strong
                style={{
                  fontSize: '14px',
                  fontWeight: 800,
                  color: 'var(--accent-text)',
                }}
              >
                1. Khách hàng & Tên báo giá
              </strong>

              <button
                type="button"
                data-testid="pq-inline-new-customer-btn"
                onClick={() => setShowQuickCustomerModal(true)}
                style={{
                  minHeight: '44px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--accent-text)',
                  backgroundColor: 'var(--accent-soft)',
                  color: 'var(--accent-text)',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Khách hàng mới
              </button>
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
                <label style={labelStyle} htmlFor="pq-customer-select">
                  Khách hàng nhận báo giá
                </label>
                <select
                  id="pq-customer-select"
                  data-testid="pq-customer-select"
                  style={inputStyle}
                  value={selectedCustomerId}
                  onChange={(e) => {
                    onMarkTouched?.();
                    onChangeSelectedCustomerId(e.target.value);
                  }}
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
                  Tên báo giá
                </label>
                <input
                  id="pq-title-input"
                  data-testid="pq-title-input"
                  style={inputStyle}
                  value={quoteTitle}
                  onChange={(e) => {
                    onMarkTouched?.();
                    onChangeQuoteTitle(e.target.value);
                  }}
                  placeholder="VD: Báo giá in tờ rơi & hộp giấy"
                />
              </div>
            </div>
          </div>

          {/* 2. Product Lines */}
          <div id="pq-sec-products" style={cardStyle}>
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
              <strong
                style={{
                  fontSize: '14px',
                  fontWeight: 800,
                  color: 'var(--accent-text)',
                }}
              >
                2. Sản phẩm đặt in ({draftLines.length} món)
              </strong>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {draftLines.length > 1 && (
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
                      minHeight: '44px',
                      padding: '8px 12px',
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
                    minHeight: '44px',
                    padding: '8px 12px',
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
                const costAllowDecimal = !Number.isInteger(
                  line.vendorCostValue,
                );
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
                                  tiền:{' '}
                                  {formatVnd(calcLine.reconciledLineTotal)}
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
                              • Thành tiền:{' '}
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
                              setCollapsedLineIds((prev) => {
                                const willExpand = Boolean(prev[line.id]);
                                if (willExpand) {
                                  const next: Record<string, boolean> = {};
                                  draftLines.forEach((l) => {
                                    next[l.id] = l.id !== line.id;
                                  });
                                  return next;
                                }
                                return { ...prev, [line.id]: true };
                              })
                            }
                            style={{
                              minHeight: '44px',
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
                            minHeight: '44px',
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
                              minHeight: '44px',
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
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '4px',
                              }}
                            >
                              <label
                                htmlFor={`pq-line-catalog-${idx}`}
                                style={{ ...labelStyle, marginBottom: 0 }}
                              >
                                Chọn từ Bảng giá Nhà in
                              </label>
                              {priceItems.length > 0 && (
                                <button
                                  type="button"
                                  data-testid={`pq-open-catalog-picker-${idx}`}
                                  onClick={() => {
                                    setCatalogSearchQuery('');
                                    setCatalogPickerLineIdx(idx);
                                  }}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    padding: '2px 4px',
                                    color: 'var(--accent-text)',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  🔍 Tìm nhanh
                                </button>
                              )}
                            </div>
                            <select
                              id={`pq-line-catalog-${idx}`}
                              aria-label={`Chọn bảng giá nhà in dòng ${idx + 1}`}
                              style={inputStyle}
                              value={line.vendorPriceItemId}
                              onChange={(e) => {
                                onMarkTouched?.();
                                onSelectCatalogItem(idx, e.target.value);
                                if (e.target.value) {
                                  focusQuantityForLine(idx);
                                }
                              }}
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
                            <label
                              htmlFor={`pq-line-name-${idx}`}
                              style={labelStyle}
                            >
                              Tên sản phẩm in *
                            </label>
                            <input
                              id={`pq-line-name-${idx}`}
                              aria-label={`Tên sản phẩm dòng ${idx + 1}`}
                              style={inputStyle}
                              placeholder="VD: Tờ rơi A5 Couche 150gsm"
                              value={line.name}
                              onChange={(e) => {
                                onMarkTouched?.();
                                setDraftLines((prev) =>
                                  prev.map((l, i) =>
                                    i === idx
                                      ? { ...l, name: e.target.value }
                                      : l,
                                  ),
                                );
                              }}
                            />
                          </div>

                          <div>
                            <label
                              htmlFor={`pq-line-spec-${idx}`}
                              style={labelStyle}
                            >
                              Quy cách / Chất liệu
                            </label>
                            <input
                              id={`pq-line-spec-${idx}`}
                              aria-label={`Quy cách dòng ${idx + 1}`}
                              style={inputStyle}
                              value={line.specification}
                              onChange={(e) => {
                                onMarkTouched?.();
                                setDraftLines((prev) =>
                                  prev.map((l, i) =>
                                    i === idx
                                      ? { ...l, specification: e.target.value }
                                      : l,
                                  ),
                                );
                              }}
                              placeholder="VD: C150, in 2 mặt, cán mờ"
                            />
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <div style={{ flex: 2 }}>
                              <label
                                htmlFor={`pq-line-qty-${idx}`}
                                style={labelStyle}
                              >
                                Số lượng *
                              </label>
                              <NumericDraftInput
                                id={`pq-line-qty-${idx}`}
                                ariaLabel={`Số lượng dòng ${idx + 1}`}
                                allowDecimal={false}
                                placeholder="VD: 500"
                                style={inputStyle}
                                invalid={Boolean(
                                  showValidationState && lineErr?.quantity,
                                )}
                                value={rawQtyInput}
                                onValueChange={(nextRaw) => {
                                  onMarkTouched?.();
                                  const parsed = parseNumericDraftValue(
                                    nextRaw,
                                    {
                                      allowDecimal: false,
                                      min: 1,
                                      integerOnly: true,
                                    },
                                  );
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
                              <label
                                htmlFor={`pq-line-unit-${idx}`}
                                style={labelStyle}
                              >
                                Đơn vị
                              </label>
                              <input
                                id={`pq-line-unit-${idx}`}
                                aria-label={`Đơn vị tính dòng ${idx + 1}`}
                                style={inputStyle}
                                value={line.unit}
                                onChange={(e) => {
                                  onMarkTouched?.();
                                  setDraftLines((prev) =>
                                    prev.map((l, i) =>
                                      i === idx
                                        ? { ...l, unit: e.target.value }
                                        : l,
                                    ),
                                  );
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Internal Vendor Cost & Profit Controls */}
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
                            <label
                              htmlFor={`pq-line-cost-mode-${idx}`}
                              style={labelStyle}
                            >
                              🔒 Giá gốc nhà in tính theo
                            </label>
                            <select
                              id={`pq-line-cost-mode-${idx}`}
                              key={
                                line.ambiguousLegacyCost
                                  ? 'ambiguous'
                                  : 'confirmed'
                              }
                              aria-label={`Kiểu giá vốn dòng ${idx + 1}`}
                              style={{
                                ...inputStyle,
                                ...(lineErr?.costMode
                                  ? {
                                      borderColor: 'var(--danger-text)',
                                      boxShadow:
                                        '0 0 0 1px var(--danger-text) inset',
                                    }
                                  : {}),
                              }}
                              value={
                                line.ambiguousLegacyCost
                                  ? ''
                                  : line.vendorCostMode
                              }
                              onChange={(e) => {
                                const nextMode = e.target
                                  .value as VendorCostModeType;
                                if (!nextMode) return;
                                onMarkTouched?.();
                                setDraftLines((prev) =>
                                  prev.map((l, i) => {
                                    if (i !== idx) return l;
                                    if (l.ambiguousLegacyCost) {
                                      const editedManually =
                                        l.vendorCostInput !== undefined &&
                                        l.vendorCostInput !==
                                          String(
                                            l.ambiguousLegacyCost
                                              .totalVendorCost,
                                          );
                                      const resolvedVal = editedManually
                                        ? l.vendorCostValue
                                        : nextMode === VendorCostMode.PER_UNIT
                                          ? l.ambiguousLegacyCost.unitVendorCost
                                          : l.ambiguousLegacyCost
                                              .totalVendorCost;
                                      return {
                                        ...l,
                                        vendorCostMode: nextMode,
                                        vendorCostValue: resolvedVal,
                                        vendorCostInput: editedManually
                                          ? l.vendorCostInput
                                          : String(resolvedVal),
                                        ambiguousLegacyCost: null,
                                      };
                                    }
                                    return {
                                      ...l,
                                      vendorCostMode: nextMode,
                                      ambiguousLegacyCost: null,
                                    };
                                  }),
                                );
                              }}
                            >
                              {line.ambiguousLegacyCost && (
                                <option value="" disabled>
                                  -- Chưa rõ (Chọn kiểu giá vốn) --
                                </option>
                              )}
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
                            <label
                              htmlFor={`pq-line-cost-val-${idx}`}
                              style={labelStyle}
                            >
                              {line.ambiguousLegacyCost
                                ? `Giá vốn đã lưu (${line.ambiguousLegacyCost.originalQuantity} ${line.unit || 'cái'})`
                                : line.vendorCostMode ===
                                    VendorCostMode.PER_UNIT
                                  ? `Giá nhà in / 1 ${line.unit || 'cái'} (đ) *`
                                  : 'Tổng giá nhà in cả lô (đ) *'}
                            </label>
                            <NumericDraftInput
                              id={`pq-line-cost-val-${idx}`}
                              ariaLabel={`Giá trị giá vốn dòng ${idx + 1}`}
                              allowDecimal={costAllowDecimal}
                              placeholder="Nhập 0 nếu miễn phí"
                              style={inputStyle}
                              invalid={Boolean(
                                showValidationState && lineErr?.vendorCost,
                              )}
                              value={rawCostInput}
                              onValueChange={(nextRaw) => {
                                onMarkTouched?.();
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

                          {line.ambiguousLegacyCost && (
                            <div
                              data-testid={`pq-legacy-cost-confirm-${idx}`}
                              style={{
                                gridColumn: '1 / -1',
                                padding: '10px 12px',
                                borderRadius: '8px',
                                border: lineErr?.costMode
                                  ? '1px solid var(--danger-text)'
                                  : '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-color)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                              }}
                            >
                              <div
                                style={{
                                  fontSize: '12.5px',
                                  fontWeight: 600,
                                  color: lineErr?.costMode
                                    ? 'var(--danger-text)'
                                    : 'var(--text-color)',
                                }}
                              >
                                Báo giá cũ lưu giá vốn{' '}
                                {formatVnd(
                                  line.ambiguousLegacyCost.totalVendorCost,
                                )}{' '}
                                cho {line.ambiguousLegacyCost.originalQuantity}{' '}
                                {line.unit || 'tờ'} (chưa ghi rõ kiểu tính).
                                Chọn xác nhận để tính đúng khi đổi số lượng:
                              </div>
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: '8px',
                                }}
                              >
                                <button
                                  type="button"
                                  data-testid={`pq-confirm-legacy-batch-${idx}`}
                                  onClick={() => {
                                    onMarkTouched?.();
                                    setDraftLines((prev) =>
                                      prev.map((l, i) => {
                                        if (i !== idx || !l.ambiguousLegacyCost)
                                          return l;
                                        const val =
                                          l.ambiguousLegacyCost.totalVendorCost;
                                        return {
                                          ...l,
                                          vendorCostMode:
                                            VendorCostMode.TOTAL_BATCH,
                                          vendorCostValue: val,
                                          vendorCostInput: String(val),
                                          ambiguousLegacyCost: null,
                                        };
                                      }),
                                    );
                                  }}
                                  style={{
                                    minHeight: '44px',
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--accent-text)',
                                    backgroundColor: 'var(--accent-soft)',
                                    color: 'var(--accent-text)',
                                    fontSize: '12.5px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Giữ trọn lô:{' '}
                                  {formatVnd(
                                    line.ambiguousLegacyCost.totalVendorCost,
                                  )}
                                </button>
                                <button
                                  type="button"
                                  data-testid={`pq-confirm-legacy-per-unit-${idx}`}
                                  onClick={() => {
                                    onMarkTouched?.();
                                    setDraftLines((prev) =>
                                      prev.map((l, i) => {
                                        if (i !== idx || !l.ambiguousLegacyCost)
                                          return l;
                                        const val =
                                          l.ambiguousLegacyCost.unitVendorCost;
                                        return {
                                          ...l,
                                          vendorCostMode:
                                            VendorCostMode.PER_UNIT,
                                          vendorCostValue: val,
                                          vendorCostInput: String(val),
                                          ambiguousLegacyCost: null,
                                        };
                                      }),
                                    );
                                  }}
                                  style={{
                                    minHeight: '44px',
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--border-color)',
                                    backgroundColor: 'var(--surface-color)',
                                    color: 'var(--text-color)',
                                    fontSize: '12.5px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Tính theo 1 {line.unit || 'tờ'}:{' '}
                                  {formatExactVnd(
                                    line.ambiguousLegacyCost.unitVendorCost,
                                  )}
                                </button>
                              </div>
                            </div>
                          )}

                          <div>
                            <label
                              htmlFor={`pq-line-profit-mode-${idx}`}
                              style={labelStyle}
                            >
                              🔒 Tiền lời tính theo
                            </label>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <select
                                id={`pq-line-profit-mode-${idx}`}
                                aria-label={`Kiểu lợi nhuận dòng ${idx + 1}`}
                                style={inputStyle}
                                value={line.profitMode}
                                onChange={(e) => {
                                  onMarkTouched?.();
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
                                  onChange={(e) => {
                                    onMarkTouched?.();
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
                                    );
                                  }}
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
                            <label
                              htmlFor={`pq-line-profit-val-${idx}`}
                              style={labelStyle}
                            >
                              {line.profitMode === ProfitMode.PERCENTAGE
                                ? 'Mức lời (% trên giá gốc) *'
                                : line.profitScope === ProfitScope.PER_UNIT
                                  ? `Tiền lời / 1 ${line.unit || 'cái'} (đ) *`
                                  : 'Tổng tiền lời cả lô (đ) *'}
                            </label>
                            <NumericDraftInput
                              id={`pq-line-profit-val-${idx}`}
                              ariaLabel={`Giá trị lợi nhuận dòng ${idx + 1}`}
                              allowDecimal={profitAllowDecimal}
                              placeholder={
                                profitAllowDecimal
                                  ? 'VD: 15 hoặc 12.5'
                                  : 'Nhập 0 nếu không lời'
                              }
                              style={inputStyle}
                              invalid={Boolean(
                                showValidationState && lineErr?.profit,
                              )}
                              value={rawProfitInput}
                              onValueChange={(nextRaw) => {
                                onMarkTouched?.();
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
          </div>

          {/* 3. Shipping, Notes & Advanced Options */}
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
              <strong
                style={{
                  fontSize: '14px',
                  fontWeight: 800,
                  color: 'var(--accent-text)',
                }}
              >
                3. Phí giao hàng & Ghi chú báo giá
              </strong>

              <button
                type="button"
                data-testid="pq-advanced-options-toggle"
                onClick={() => setShowAdvancedOptions((v) => !v)}
                style={{
                  minHeight: '44px',
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

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
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
                    invalid={Boolean(
                      showValidationState && livePricingResult.shippingError,
                    )}
                    value={resolvedShippingFeeInput}
                    onValueChange={(nextRaw) => {
                      onMarkTouched?.();
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
                    minHeight: '44px',
                  }}
                >
                  <input
                    id="pq-merge-ship-checkbox"
                    data-testid="pq-merge-ship-checkbox"
                    type="checkbox"
                    checked={includeShippingInUnitPrice}
                    onChange={(e) => {
                      onMarkTouched?.();
                      onChangeIncludeShippingInUnitPrice(e.target.checked);
                    }}
                    style={{ width: '20px', height: '20px', cursor: 'pointer' }}
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
                      onChange={(e) => {
                        onMarkTouched?.();
                        onChangeValidUntil(e.target.value);
                      }}
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
                      onChange={(e) => {
                        onMarkTouched?.();
                        onChangeShippingAllocation(
                          e.target.value as ShippingAllocationStrategyType,
                        );
                      }}
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
                        onChange={(e) => {
                          onMarkTouched?.();
                          onChangeRoundingMode(
                            e.target.value as RoundingModeType,
                          );
                        }}
                      >
                        <option value={RoundingMode.CEIL}>
                          Làm tròn lên (Giữ nguyên lời)
                        </option>
                        <option value={RoundingMode.NEAREST}>
                          Làm tròn gần nhất
                        </option>
                        <option value={RoundingMode.FLOOR}>
                          Làm tròn xuống
                        </option>
                      </select>
                      <select
                        aria-label="Bước làm tròn VNĐ"
                        style={{ ...inputStyle, maxWidth: '110px' }}
                        value={roundingStep}
                        onChange={(e) => {
                          onMarkTouched?.();
                          onChangeRoundingStep(Number(e.target.value) || 1);
                        }}
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
                      onChange={(e) => {
                        onMarkTouched?.();
                        onChangeInternalNotes(e.target.value);
                      }}
                      placeholder="VD: Đặt xưởng Sài Gòn, cọc 50%"
                    />
                  </div>
                </div>
              )}

              <div>
                <label style={labelStyle} htmlFor="pq-customer-notes">
                  Ghi chú in trên PDF gửi khách
                </label>
                <textarea
                  id="pq-customer-notes"
                  rows={2}
                  style={inputStyle}
                  value={customerNotes}
                  onChange={(e) => {
                    onMarkTouched?.();
                    onChangeCustomerNotes(e.target.value);
                  }}
                />
              </div>

              {editingQuoteId && (
                <div>
                  <label style={labelStyle} htmlFor="pq-version-note">
                    Nội dung cập nhật phiên bản mới (v{editingQuoteVersion + 1})
                  </label>
                  <input
                    id="pq-version-note"
                    style={inputStyle}
                    value={versionChangeNote}
                    onChange={(e) => {
                      onMarkTouched?.();
                      onChangeVersionChangeNote(e.target.value);
                    }}
                    placeholder="VD: Khách tăng số lượng lên 500 tờ"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT STICKY COLUMN: Live Summary + Primary Save CTA */}
        <div
          id="pq-sec-summary"
          className="pq-editor-summary-col"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            minWidth: 0,
          }}
        >
          <div style={cardStyle}>
            <strong
              style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: 800,
                color: 'var(--accent-text)',
                marginBottom: '12px',
              }}
            >
              Tổng kết & Tạm tính báo giá
            </strong>

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
                      'repeat(auto-fit, minmax(min(100%, 135px), 1fr))',
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

                {/* Single Summary Switcher: Customer-Safe vs Internal */}
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
                          minHeight: '44px',
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
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        📄 Bản gửi khách
                      </button>

                      <button
                        type="button"
                        data-testid="pq-view-mode-internal"
                        onClick={() => setSummaryViewMode('internal')}
                        style={{
                          minHeight: '44px',
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
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        🔒 Bóc tách nội bộ
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
                                    {formatVnd(item.lineTotal)}
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
                          fontSize: '12px',
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
                              Lời
                            </th>
                            <th style={{ padding: '6px', textAlign: 'right' }}>
                              Ship
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
              </div>
            ) : !showValidationState ? (
              <div
                data-testid="pq-empty-guidance-notice"
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-color)',
                  color: 'var(--muted-color)',
                  fontSize: '12.5px',
                  lineHeight: 1.5,
                }}
              >
                Nhập tên sản phẩm (hoặc chọn từ <strong>Bảng giá Nhà in</strong>
                ), số lượng, giá gốc nhà in và tiền lời để xem ngay tổng tiền
                báo giá.
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

          {/* Primary Save Action Bar */}
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
            <button
              type="button"
              data-testid="pq-save-quote-btn"
              disabled={isQuoteIncomplete || savingQuote}
              onClick={onSaveQuote}
              style={{
                width: '100%',
                minHeight: '46px',
                padding: '10px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--primary-color)',
                color: 'var(--inverse-text)',
                fontWeight: 800,
                fontSize: '14px',
                opacity: isQuoteIncomplete || savingQuote ? 0.55 : 1,
                cursor:
                  isQuoteIncomplete || savingQuote ? 'not-allowed' : 'pointer',
              }}
            >
              {savingQuote
                ? 'Đang lưu báo giá…'
                : editingQuoteId
                  ? `💾 Lưu Phiên bản v${editingQuoteVersion + 1}`
                  : '💾 Lưu báo giá'}
            </button>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                type="button"
                data-testid="pq-preview-pdf-btn"
                disabled={isQuoteIncomplete}
                onClick={onOpenLivePreview}
                style={{
                  flex: '1 1 135px',
                  minHeight: '44px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-color)',
                  color: 'var(--text-color)',
                  fontWeight: 600,
                  fontSize: '12.5px',
                  opacity: isQuoteIncomplete ? 0.55 : 1,
                  cursor: isQuoteIncomplete ? 'not-allowed' : 'pointer',
                }}
              >
                👁️ Xem nháp A4
              </button>

              <button
                type="button"
                data-testid="pq-download-pdf-btn"
                disabled={isQuoteIncomplete}
                onClick={onDownloadLivePdf}
                style={{
                  flex: '1 1 135px',
                  minHeight: '44px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-color)',
                  color: 'var(--text-color)',
                  fontWeight: 600,
                  fontSize: '12.5px',
                  opacity: isQuoteIncomplete ? 0.55 : 1,
                  cursor: isQuoteIncomplete ? 'not-allowed' : 'pointer',
                }}
              >
                ⬇️ Tải PDF nháp
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Customer Creation Dialog */}
      <CatalogModalDialog
        open={showQuickCustomerModal}
        title="Thêm nhanh khách hàng mới"
        subtitle="Lưu và tự động chọn khách hàng cho báo giá đang lập."
        testId="pq-quick-customer-dialog"
        onClose={() => setShowQuickCustomerModal(false)}
      >
        <form
          onSubmit={handleQuickSaveCustomer}
          data-testid="pq-inline-customer-form"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div>
            <label htmlFor="pq-quick-cust-name-input" style={labelStyle}>
              Tên khách hàng mới *
            </label>
            <input
              id="pq-quick-cust-name-input"
              aria-label="Tên khách hàng thêm nhanh"
              data-testid="pq-quick-cust-name"
              style={inputStyle}
              placeholder="VD: Chị Lan"
              value={quickCustName}
              onChange={(e) => setQuickCustName(e.target.value)}
              required
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
              gap: '10px',
            }}
          >
            <div>
              <label htmlFor="pq-quick-cust-phone-input" style={labelStyle}>
                Số điện thoại
              </label>
              <input
                id="pq-quick-cust-phone-input"
                aria-label="Số điện thoại khách thêm nhanh"
                data-testid="pq-quick-cust-phone"
                type="tel"
                inputMode="tel"
                style={inputStyle}
                placeholder="VD: 0909123456"
                value={quickCustPhone}
                onChange={(e) => setQuickCustPhone(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="pq-quick-cust-company-input" style={labelStyle}>
                Công ty / Thương hiệu
              </label>
              <input
                id="pq-quick-cust-company-input"
                aria-label="Công ty khách thêm nhanh"
                data-testid="pq-quick-cust-company"
                style={inputStyle}
                placeholder="VD: Spa Hoa Hồng"
                value={quickCustCompany}
                onChange={(e) => setQuickCustCompany(e.target.value)}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              marginTop: '4px',
            }}
          >
            <button
              type="button"
              onClick={() => setShowQuickCustomerModal(false)}
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
              Hủy
            </button>
            <button
              type="submit"
              data-testid="pq-quick-cust-submit"
              disabled={quickCustSaving}
              style={{
                minHeight: '44px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--primary-color)',
                color: 'var(--inverse-text)',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {quickCustSaving ? 'Đang lưu…' : 'Lưu & Chọn ngay'}
            </button>
          </div>
        </form>
      </CatalogModalDialog>

      {/* Searchable Catalog Price Item Picker Dialog */}
      <CatalogModalDialog
        open={catalogPickerLineIdx !== null}
        title={`Chọn sản phẩm từ Bảng giá Nhà in (Dòng #${(catalogPickerLineIdx ?? 0) + 1})`}
        subtitle="Tự động điền tên ấn phẩm, quy cách, giá vốn và lời mặc định."
        testId="pq-catalog-picker-dialog"
        maxWidth="620px"
        onClose={() => setCatalogPickerLineIdx(null)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label htmlFor="pq-picker-search-input" style={labelStyle}>
              Tìm kiếm ấn phẩm trong bảng giá
            </label>
            <input
              id="pq-picker-search-input"
              type="search"
              style={inputStyle}
              placeholder="Gõ tên ấn phẩm, quy cách hoặc nhà in…"
              value={catalogSearchQuery}
              onChange={(e) => setCatalogSearchQuery(e.target.value)}
            />
          </div>

          {filteredCatalogItems.length === 0 ? (
            <div
              style={{
                padding: '16px',
                textAlign: 'center',
                color: 'var(--muted-color)',
                fontSize: '13px',
              }}
            >
              Không tìm thấy hạng mục bảng giá phù hợp.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxHeight: '340px',
                overflowY: 'auto',
              }}
            >
              {filteredCatalogItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (catalogPickerLineIdx === null) return;
                    const targetIdx = catalogPickerLineIdx;
                    onMarkTouched?.();
                    onSelectCatalogItem(targetIdx, item.id);
                    setCatalogPickerLineIdx(null);
                    focusQuantityForLine(targetIdx);
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px' }}>
                      <span style={{ color: 'var(--accent-text)' }}>
                        {item.code}
                      </span>{' '}
                      — {item.name}
                    </div>
                    <div
                      style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                    >
                      {item.vendor_name || 'Nhà in'}
                      {item.specification ? ` • ${item.specification}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '12px' }}>
                    <strong>
                      {item.pricing_mode === 'TOTAL_BATCH'
                        ? `${formatVnd(item.batch_total_cost)} / lô`
                        : `${formatVnd(item.unit_cost)} / ${item.unit}`}
                    </strong>
                    <div style={{ color: 'var(--success-text)' }}>
                      +Lời:{' '}
                      {item.default_profit_mode === 'PERCENTAGE'
                        ? `${item.default_profit_value}%`
                        : formatVnd(item.default_profit_value)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </CatalogModalDialog>

      <style>{`
        .pq-editor-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 14px;
          align-items: start;
        }
        @media (min-width: 1024px) {
          .pq-editor-grid {
            grid-template-columns: minmax(0, 1.38fr) minmax(330px, 0.92fr);
          }
          .pq-editor-summary-col {
            position: sticky;
            top: 60px;
          }
        }
      `}</style>
    </div>
  );
};
