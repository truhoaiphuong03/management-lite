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
  tabularNumStyle,
  type DraftLineState,
  type SummaryViewMode,
} from './types.js';
import { NumericDraftInput } from './NumericDraftInput.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';
import {
  PqArrowLeftIcon,
  PqCheckIcon,
  PqChevronIcon,
  PqCopyIcon,
  PqDownloadIcon,
  PqEditIcon,
  PqEyeIcon,
  PqFileTextIcon,
  PqLockIcon,
  PqPlusIcon,
  PqSaveIcon,
  PqSearchIcon,
  PqShieldIcon,
  PqSlidersIcon,
  PqTagIcon,
  PqTrashIcon,
  PqTruckIcon,
  PqUsersIcon,
} from './PrintQuoteIcons.js';

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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px',
          }}
        >
          <PqLockIcon size={18} style={{ color: 'var(--accent-text)' }} />
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>
            Báo giá {editingQuoteCode || ''} đã khóa chỉnh sửa trực tiếp
          </h1>
        </div>
        <p
          style={{
            margin: '0 0 16px',
            fontSize: '13.5px',
            color: 'var(--muted-color)',
            lineHeight: 1.55,
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
              className="pq-btn pq-btn-primary"
            >
              <PqCopyIcon size={15} />
              <span>Tạo báo giá mới từ bản này</span>
            </button>
          )}
          <button
            type="button"
            data-testid="pq-editor-back-btn"
            onClick={onBackToQuotes}
            className="pq-btn pq-btn-secondary"
          >
            <PqArrowLeftIcon size={15} />
            <span>Quay lại chi tiết báo giá</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="panel-create-quote"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      {/* Clean Contextual Top Bar */}
      <div className="pq-editor-topbar">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            minWidth: 0,
          }}
        >
          <button
            type="button"
            data-testid="pq-editor-back-btn"
            onClick={onBackToQuotes}
            className="pq-btn pq-btn-secondary"
          >
            <PqArrowLeftIcon size={15} />
            <span>{editingQuoteId ? 'Chi tiết báo giá' : 'Danh sách'}</span>
          </button>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <h1 className="pq-page-title" style={{ fontSize: '19px' }}>
                {editingQuoteId
                  ? `Chỉnh sửa ${editingQuoteCode || ''}`
                  : 'Tạo báo giá mới'}
              </h1>
              {editingQuoteId && (
                <span className="pq-version-pill">
                  Lên v{editingQuoteVersion + 1}
                </span>
              )}
            </div>
            <p className="pq-page-subtitle">
              {editingQuoteId
                ? `Lưu thay đổi sẽ tạo phiên bản v${editingQuoteVersion + 1} và chuyển sang trang Chi tiết`
                : 'Điền thông tin ấn phẩm bên dưới — Giá vốn & lợi nhuận được ẩn tuyệt đối trên PDF gửi khách'}
            </p>
          </div>
        </div>

        <button
          type="button"
          data-testid="pq-reset-draft-btn"
          onClick={onResetNewQuote}
          className="pq-btn pq-btn-ghost"
        >
          {editingQuoteId ? '+ Chuyển sang Tạo mới' : 'Làm mới ô nhập'}
        </button>
      </div>

      {/* Desktop 2-Column / Mobile 1-Column Responsive Grid */}
      <div className="pq-editor-grid">
        {/* LEFT COLUMN: 3 Clean Numbered Cards */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            minWidth: 0,
          }}
        >
          {/* 1. Customer & Quote Title */}
          <section id="pq-sec-customer" style={cardStyle}>
            <div className="pq-step-header">
              <div className="pq-step-title-group">
                <span className="pq-step-badge">1</span>
                <h2 className="pq-step-heading">Khách hàng & Tên báo giá</h2>
              </div>

              <button
                type="button"
                data-testid="pq-inline-new-customer-btn"
                onClick={() => setShowQuickCustomerModal(true)}
                className="pq-btn pq-btn-accent"
              >
                <PqUsersIcon size={14} />
                <span>Thêm khách mới</span>
              </button>
            </div>

            <div className="pq-customer-grid">
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
                  placeholder="VD: Báo giá in tờ rơi & hộp giấy…"
                />
              </div>
            </div>
          </section>

          {/* 2. Product Lines */}
          <section id="pq-sec-products" style={cardStyle}>
            <div className="pq-step-header">
              <div className="pq-step-title-group">
                <span className="pq-step-badge">2</span>
                <h2 className="pq-step-heading">
                  Sản phẩm đặt in ({draftLines.length} món)
                </h2>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
                    className="pq-btn pq-btn-ghost"
                  >
                    <PqChevronIcon
                      size={14}
                      up={!draftLines.every((l) => collapsedLineIds[l.id])}
                    />
                    <span>
                      {draftLines.every((l) => collapsedLineIds[l.id])
                        ? 'Mở rộng tất cả'
                        : 'Thu gọn tất cả'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  data-testid="pq-add-line-btn"
                  onClick={handleAddProductLine}
                  className="pq-btn pq-btn-accent"
                >
                  <PqPlusIcon size={14} />
                  <span>Thêm sản phẩm</span>
                </button>
              </div>
            </div>

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
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
                    className="pq-product-card"
                  >
                    <div
                      data-testid={
                        isCollapsed
                          ? `pq-line-collapsed-${idx}`
                          : `pq-line-header-${idx}`
                      }
                      className="pq-product-card-head"
                      style={{ marginBottom: isCollapsed ? 0 : '12px' }}
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
                          <span className="pq-code-pill">#{idx + 1}</span>
                          <strong style={{ fontSize: '13.5px' }}>
                            {line.name || `Sản phẩm #${idx + 1}`}
                          </strong>
                          <span
                            style={{
                              fontSize: '12px',
                              color: 'var(--muted-color)',
                              ...tabularNumStyle,
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
                                fontSize: '12.5px',
                                fontWeight: 700,
                                color: 'var(--accent-text)',
                                ...tabularNumStyle,
                              }}
                            >
                              • {formatVnd(calcLine.reconciledLineTotal)}
                            </span>
                          )}
                          {calcLine && (
                            <span
                              style={{
                                fontSize: '12px',
                                fontWeight: 600,
                                color: 'var(--success-text)',
                                ...tabularNumStyle,
                              }}
                            >
                              (Lời: +{formatVnd(calcLine.totalProfit)})
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
                          <span className="pq-code-pill">
                            Sản phẩm #{idx + 1}
                          </span>
                          {calcLine && (
                            <span
                              style={{
                                fontSize: '12.5px',
                                color: 'var(--muted-color)',
                                ...tabularNumStyle,
                              }}
                            >
                              Thành tiền:{' '}
                              <strong style={{ color: 'var(--accent-text)' }}>
                                {formatVnd(calcLine.reconciledLineTotal)}
                              </strong>{' '}
                              • Lời:{' '}
                              <strong style={{ color: 'var(--success-text)' }}>
                                +{formatVnd(calcLine.totalProfit)}
                              </strong>
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
                            className={
                              isCollapsed
                                ? 'pq-btn pq-btn-accent pq-btn-sm'
                                : 'pq-btn pq-btn-ghost pq-btn-sm'
                            }
                          >
                            {isCollapsed ? (
                              <>
                                <PqEditIcon size={13} />
                                <span>Sửa</span>
                              </>
                            ) : (
                              <>
                                <PqChevronIcon size={13} up />
                                <span>Thu gọn</span>
                              </>
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          data-testid={`pq-line-duplicate-${idx}`}
                          onClick={() => handleDuplicateProductLine(idx)}
                          className="pq-btn pq-btn-ghost pq-btn-sm"
                        >
                          <PqCopyIcon size={13} />
                          <span>Nhân đôi</span>
                        </button>

                        {draftLines.length > 1 && (
                          <button
                            type="button"
                            data-testid={`pq-line-delete-${idx}`}
                            onClick={() => handleRemoveProductLine(idx)}
                            className="pq-btn pq-btn-danger-ghost pq-btn-sm"
                          >
                            <PqTrashIcon size={13} />
                            <span>Xóa dòng</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                        }}
                      >
                        {/* Dedicated Catalog Quick-Pick Bar (Never squeezes manual fields) */}
                        <div className="pq-catalog-quickbar">
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontSize: '12px',
                              fontWeight: 600,
                              color: 'var(--muted-color)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <PqTagIcon
                              size={14}
                              style={{ color: 'var(--accent-text)' }}
                            />
                            <label htmlFor={`pq-line-catalog-${idx}`}>
                              Bảng giá nhà in:
                            </label>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              gap: '8px',
                              flex: '1 1 220px',
                              minWidth: 0,
                            }}
                          >
                            <select
                              id={`pq-line-catalog-${idx}`}
                              aria-label={`Chọn bảng giá nhà in dòng ${idx + 1}`}
                              style={{
                                ...inputStyle,
                                minHeight: '38px',
                                padding: '6px 10px',
                                fontSize: '13px',
                              }}
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
                                -- Tự nhập thông tin ấn phẩm bên dưới --
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

                            {priceItems.length > 0 && (
                              <button
                                type="button"
                                data-testid={`pq-open-catalog-picker-${idx}`}
                                onClick={() => {
                                  setCatalogSearchQuery('');
                                  setCatalogPickerLineIdx(idx);
                                }}
                                className="pq-btn pq-btn-secondary pq-btn-sm"
                                style={{ flexShrink: 0 }}
                              >
                                <PqSearchIcon size={13} />
                                <span>Tìm nhanh</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Row 1: Customer-Facing Product Details (Balanced 4-Column Grid) */}
                        <div className="pq-product-info-grid">
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
                              placeholder="VD: Tờ rơi A5 Couche 150gsm…"
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
                              placeholder="VD: C150, in 2 mặt, cán mờ…"
                            />
                          </div>

                          <div className="pq-qty-unit-pair">
                            <div style={{ flex: '1.35 1 0', minWidth: 0 }}>
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
                                style={{ ...inputStyle, ...tabularNumStyle }}
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

                            <div style={{ flex: '0.85 1 0', minWidth: 0 }}>
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

                        {/* Row 2: Two Clean Side-by-Side Internal Pricing Panels (No Dashed Borders) */}
                        <div className="pq-pricing-pair-grid">
                          {/* Vendor Cost Soft Panel */}
                          <div className="pq-internal-subpanel">
                            <div className="pq-internal-subpanel-title">
                              <PqLockIcon size={13} />
                              <span>Giá gốc nhà in (Ẩn trên PDF)</span>
                            </div>

                            <div className="pq-subpanel-stack">
                              <div>
                                <label
                                  htmlFor={`pq-line-cost-mode-${idx}`}
                                  style={labelStyle}
                                >
                                  Kiểu tính giá vốn
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
                                            : nextMode ===
                                                VendorCostMode.PER_UNIT
                                              ? l.ambiguousLegacyCost
                                                  .unitVendorCost
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
                                    Từng {line.unit || 'cái'} (1 đv)
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
                                    ? `Giá vốn lưu (${line.ambiguousLegacyCost.originalQuantity} ${line.unit || 'cái'})`
                                    : line.vendorCostMode ===
                                        VendorCostMode.PER_UNIT
                                      ? `Đơn giá / 1 ${line.unit || 'cái'} (đ) *`
                                      : 'Tổng giá cả lô (đ) *'}
                                </label>
                                <NumericDraftInput
                                  id={`pq-line-cost-val-${idx}`}
                                  ariaLabel={`Giá trị giá vốn dòng ${idx + 1}`}
                                  allowDecimal={costAllowDecimal}
                                  placeholder="Nhập 0 nếu miễn phí"
                                  style={{ ...inputStyle, ...tabularNumStyle }}
                                  invalid={Boolean(
                                    showValidationState && lineErr?.vendorCost,
                                  )}
                                  value={rawCostInput}
                                  onValueChange={(nextRaw) => {
                                    onMarkTouched?.();
                                    const parsed = parseNumericDraftValue(
                                      nextRaw,
                                      {
                                        allowDecimal: costAllowDecimal,
                                        min: 0,
                                        integerOnly: !costAllowDecimal,
                                      },
                                    );
                                    setDraftLines((prev) =>
                                      prev.map((l, i) =>
                                        i === idx
                                          ? {
                                              ...l,
                                              vendorCostInput: nextRaw,
                                              ...(parsed.isValid &&
                                              parsed.value !== null
                                                ? {
                                                    vendorCostValue:
                                                      parsed.value,
                                                  }
                                                : {}),
                                            }
                                          : l,
                                      ),
                                    );
                                  }}
                                />
                              </div>
                            </div>

                            {line.ambiguousLegacyCost && (
                              <div
                                data-testid={`pq-legacy-cost-confirm-${idx}`}
                                style={{
                                  marginTop: '10px',
                                  padding: '10px 12px',
                                  borderRadius: '10px',
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
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: lineErr?.costMode
                                      ? 'var(--danger-text)'
                                      : 'var(--text-color)',
                                    lineHeight: 1.45,
                                  }}
                                >
                                  Báo giá cũ lưu giá vốn{' '}
                                  {formatVnd(
                                    line.ambiguousLegacyCost.totalVendorCost,
                                  )}{' '}
                                  cho{' '}
                                  {line.ambiguousLegacyCost.originalQuantity}{' '}
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
                                          if (
                                            i !== idx ||
                                            !l.ambiguousLegacyCost
                                          )
                                            return l;
                                          const val =
                                            l.ambiguousLegacyCost
                                              .totalVendorCost;
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
                                    className="pq-btn pq-btn-accent pq-btn-sm"
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
                                          if (
                                            i !== idx ||
                                            !l.ambiguousLegacyCost
                                          )
                                            return l;
                                          const val =
                                            l.ambiguousLegacyCost
                                              .unitVendorCost;
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
                                    className="pq-btn pq-btn-secondary pq-btn-sm"
                                  >
                                    Tính theo 1 {line.unit || 'tờ'}:{' '}
                                    {formatExactVnd(
                                      line.ambiguousLegacyCost.unitVendorCost,
                                    )}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Profit Soft Panel */}
                          <div className="pq-internal-subpanel pq-internal-subpanel-profit">
                            <div className="pq-internal-subpanel-title">
                              <PqLockIcon size={13} />
                              <span>Lợi nhuận cộng thêm (Ẩn trên PDF)</span>
                            </div>

                            <div className="pq-subpanel-stack">
                              <div>
                                <label
                                  htmlFor={`pq-line-profit-mode-${idx}`}
                                  style={labelStyle}
                                >
                                  Tính lời theo
                                </label>
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns:
                                      line.profitMode ===
                                      ProfitMode.FIXED_AMOUNT
                                        ? 'repeat(2, minmax(0, 1fr))'
                                        : 'minmax(0, 1fr)',
                                    gap: '8px',
                                  }}
                                >
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
                                            nextMode ===
                                              ProfitMode.FIXED_AMOUNT &&
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
                                  {line.profitMode ===
                                    ProfitMode.FIXED_AMOUNT && (
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
                                    ? 'Mức lời (% vốn) *'
                                    : line.profitScope === ProfitScope.PER_UNIT
                                      ? `Lời / 1 ${line.unit || 'cái'} (đ) *`
                                      : 'Lời cả lô (đ) *'}
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
                                  style={{ ...inputStyle, ...tabularNumStyle }}
                                  invalid={Boolean(
                                    showValidationState && lineErr?.profit,
                                  )}
                                  value={rawProfitInput}
                                  onValueChange={(nextRaw) => {
                                    onMarkTouched?.();
                                    const parsed = parseNumericDraftValue(
                                      nextRaw,
                                      {
                                        allowDecimal: profitAllowDecimal,
                                        min: 0,
                                        integerOnly: !profitAllowDecimal,
                                      },
                                    );
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
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 3. Shipping, Notes & Advanced Options */}
          <section style={cardStyle}>
            <div className="pq-step-header">
              <div className="pq-step-title-group">
                <span className="pq-step-badge">3</span>
                <h2 className="pq-step-heading">Giao hàng & Ghi chú báo giá</h2>
              </div>

              <button
                type="button"
                data-testid="pq-advanced-options-toggle"
                aria-expanded={showAdvancedOptions}
                onClick={() => setShowAdvancedOptions((v) => !v)}
                className={
                  showAdvancedOptions
                    ? 'pq-btn pq-btn-accent pq-btn-sm'
                    : 'pq-btn pq-btn-ghost pq-btn-sm'
                }
              >
                <PqSlidersIcon size={14} />
                <span>Tùy chọn nâng cao</span>
                <PqChevronIcon size={13} up={showAdvancedOptions} />
              </button>
            </div>

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              <div className="pq-customer-grid">
                <div>
                  <label style={labelStyle} htmlFor="pq-shipping-input">
                    Phí giao hàng toàn đơn (đ — cộng 1 lần)
                  </label>
                  <NumericDraftInput
                    id="pq-shipping-input"
                    dataTestId="pq-shipping-input"
                    allowDecimal={false}
                    placeholder="Nhập 0 nếu miễn phí giao hàng"
                    style={{ ...inputStyle, ...tabularNumStyle }}
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

                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <label
                    htmlFor="pq-merge-ship-checkbox"
                    className="pq-checkbox-card"
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
                      style={{
                        width: '18px',
                        height: '18px',
                        cursor: 'pointer',
                        flexShrink: 0,
                        accentColor: 'var(--primary-color)',
                      }}
                    />
                    <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
                      Gộp phí giao hàng vào đơn giá khách (Ẩn dòng ship trên
                      PDF)
                    </span>
                  </label>
                </div>
              </div>

              {showAdvancedOptions && (
                <div
                  data-testid="pq-advanced-options-panel"
                  className="pq-advanced-box"
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
                        style={{ ...inputStyle, maxWidth: '108px' }}
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
                      Ghi chú nội bộ Owner (Không in lên PDF)
                    </label>
                    <input
                      id="pq-internal-notes"
                      style={inputStyle}
                      value={internalNotes}
                      onChange={(e) => {
                        onMarkTouched?.();
                        onChangeInternalNotes(e.target.value);
                      }}
                      placeholder="VD: Đặt xưởng Sài Gòn, cọc 50%…"
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
                  placeholder="VD: Thời gian giao hàng 2–3 ngày làm việc sau khi duyệt file in…"
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
                    placeholder="VD: Khách tăng số lượng lên 500 tờ…"
                  />
                </div>
              )}
            </div>
          </section>
        </div>

        {/* RIGHT STICKY COLUMN: Executive Summary + Primary Save CTA */}
        <aside
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
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '12px',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 800 }}>
                Tổng kết báo giá
              </h2>
              <span className="pq-safe-pill">
                <PqShieldIcon size={12} />
                <span>Tự động ẩn giá vốn</span>
              </span>
            </div>

            {livePricingResult.calc && livePricingResult.customerPdf ? (
              <div
                data-testid="pq-live-breakdown"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                {/* Hero Customer Total Banner */}
                <div className="pq-summary-hero">
                  <div className="pq-summary-hero-label">
                    Tổng thanh toán báo khách
                  </div>
                  <div
                    data-testid="pq-summary-total"
                    className="pq-summary-hero-value"
                    style={tabularNumStyle}
                  >
                    {formatVnd(livePricingResult.calc.totalQuoteAmount)}
                  </div>
                </div>

                {/* Compact 3-Metric Internal Breakdown */}
                <div className="pq-internal-kpi-grid">
                  <div className="pq-kpi-mini-card">
                    <div className="pq-kpi-mini-label">Giá gốc nhà in</div>
                    <strong
                      data-testid="pq-summary-vendor-cost"
                      className="pq-kpi-mini-val"
                      style={tabularNumStyle}
                    >
                      {formatVnd(livePricingResult.calc.totalVendorCost)}
                    </strong>
                  </div>

                  <div className="pq-kpi-mini-card">
                    <div className="pq-kpi-mini-label">Tiền lời ròng</div>
                    <strong
                      data-testid="pq-summary-profit"
                      className="pq-kpi-mini-val"
                      style={{
                        ...tabularNumStyle,
                        color: 'var(--success-text)',
                      }}
                    >
                      +{formatVnd(livePricingResult.calc.totalProfit)}
                    </strong>
                  </div>

                  <div className="pq-kpi-mini-card">
                    <div className="pq-kpi-mini-label">Giao hàng (1 lần)</div>
                    <strong
                      data-testid="pq-summary-shipping"
                      className="pq-kpi-mini-val"
                      style={tabularNumStyle}
                    >
                      {formatVnd(livePricingResult.calc.shippingFee)}
                    </strong>
                  </div>
                </div>

                {/* Segmented Preview Switcher: Customer-Safe vs Internal */}
                <div
                  data-testid="pq-customer-safe-card"
                  className="pq-summary-preview-box"
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
                      className="pq-segmented-switch"
                    >
                      <button
                        type="button"
                        data-testid="pq-view-mode-customer"
                        aria-pressed={summaryViewMode === 'customer'}
                        className="pq-segmented-btn"
                        data-active={
                          summaryViewMode === 'customer' ? 'true' : 'false'
                        }
                        onClick={() => setSummaryViewMode('customer')}
                      >
                        <PqFileTextIcon size={13} />
                        <span>Bản gửi khách</span>
                      </button>

                      <button
                        type="button"
                        data-testid="pq-view-mode-internal"
                        aria-pressed={summaryViewMode === 'internal'}
                        className="pq-segmented-btn"
                        data-active={
                          summaryViewMode === 'internal' ? 'true' : 'false'
                        }
                        onClick={() => setSummaryViewMode('internal')}
                      >
                        <PqLockIcon size={13} />
                        <span>Bóc tách nội bộ</span>
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
                      <table className="pq-table pq-table-compact">
                        <thead>
                          <tr>
                            <th>Sản phẩm in</th>
                            <th style={{ textAlign: 'right' }}>SL</th>
                            <th style={{ textAlign: 'right' }}>Đơn giá</th>
                            <th style={{ textAlign: 'right' }}>Thành tiền</th>
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
                                <tr key={item.id}>
                                  <td style={{ fontWeight: 600 }}>
                                    {item.name}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: 'right',
                                      ...tabularNumStyle,
                                    }}
                                  >
                                    {formatNumberVn(item.quantity)}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: 'right',
                                      ...tabularNumStyle,
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
                                      textAlign: 'right',
                                      fontWeight: 700,
                                      ...tabularNumStyle,
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
                      <table className="pq-table pq-table-compact">
                        <thead>
                          <tr>
                            <th>Sản phẩm</th>
                            <th style={{ textAlign: 'right' }}>Vốn</th>
                            <th style={{ textAlign: 'right' }}>Lời</th>
                            <th style={{ textAlign: 'right' }}>Ship</th>
                            <th style={{ textAlign: 'right' }}>Tổng</th>
                          </tr>
                        </thead>
                        <tbody>
                          {livePricingResult.calc.lines.map((item) => (
                            <tr key={item.id}>
                              <td style={{ fontWeight: 600 }}>
                                {item.name} ({formatNumberVn(item.quantity)})
                              </td>
                              <td
                                style={{
                                  textAlign: 'right',
                                  ...tabularNumStyle,
                                }}
                              >
                                {formatVnd(item.totalVendorCost)}
                              </td>
                              <td
                                style={{
                                  textAlign: 'right',
                                  color: 'var(--success-text)',
                                  ...tabularNumStyle,
                                }}
                              >
                                +{formatVnd(item.totalProfit)}
                              </td>
                              <td
                                style={{
                                  textAlign: 'right',
                                  ...tabularNumStyle,
                                }}
                              >
                                {formatVnd(item.allocatedShippingFee)}
                              </td>
                              <td
                                style={{
                                  textAlign: 'right',
                                  fontWeight: 700,
                                  color: 'var(--accent-text)',
                                  ...tabularNumStyle,
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
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap',
                      marginTop: '10px',
                      paddingTop: '8px',
                      borderTop: '1px solid var(--border-color)',
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <PqTruckIcon size={13} />
                      <span>Hiển thị ship trên PDF:</span>
                    </span>
                    <strong style={{ color: 'var(--text-color)' }}>
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
                      marginTop: '6px',
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      lineHeight: 1.45,
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
            ) : !showValidationState ? (
              <div
                data-testid="pq-empty-guidance-notice"
                className="pq-empty-summary-box"
              >
                <div className="pq-empty-icon-ring">
                  <PqFileTextIcon size={20} />
                </div>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>
                  Sẵn sàng tính giá tức thì
                </div>
                <div
                  style={{
                    color: 'var(--muted-color)',
                    fontSize: '12.5px',
                    lineHeight: 1.5,
                  }}
                >
                  Chọn ấn phẩm từ <strong>Bảng giá nhà in</strong> hoặc điền đủ
                  3 thông số bên trái để xem tổng tiền & PDF A4:
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: '6px',
                    marginTop: '2px',
                  }}
                >
                  <span className="pq-version-pill">1. Số lượng &gt; 0</span>
                  <span className="pq-version-pill">2. Giá nhà in</span>
                  <span className="pq-version-pill">3. Tiền lời</span>
                </div>
              </div>
            ) : (
              <div
                role="alert"
                data-testid="pq-incomplete-pricing-notice"
                style={{
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid var(--danger-text)',
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
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
                  Cần bổ sung để tính tổng tiền báo giá:
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

          {/* Primary Save & Preview Action Card */}
          <div
            id="pq-sec-actions"
            data-testid="pq-action-bar"
            className="pq-action-card"
          >
            <button
              type="button"
              data-testid="pq-save-quote-btn"
              disabled={isQuoteIncomplete || savingQuote}
              onClick={onSaveQuote}
              className="pq-btn pq-btn-primary pq-btn-lg"
              style={{ width: '100%' }}
            >
              <PqSaveIcon size={16} />
              <span>
                {savingQuote
                  ? 'Đang lưu báo giá…'
                  : editingQuoteId
                    ? `Lưu Phiên bản v${editingQuoteVersion + 1}`
                    : 'Lưu báo giá'}
              </span>
            </button>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
              }}
            >
              <button
                type="button"
                data-testid="pq-preview-pdf-btn"
                disabled={isQuoteIncomplete}
                onClick={onOpenLivePreview}
                className="pq-btn pq-btn-secondary"
                style={{ width: '100%' }}
              >
                <PqEyeIcon size={15} />
                <span>Xem nháp A4</span>
              </button>

              <button
                type="button"
                data-testid="pq-download-pdf-btn"
                disabled={isQuoteIncomplete}
                onClick={onDownloadLivePdf}
                className="pq-btn pq-btn-accent"
                style={{ width: '100%' }}
              >
                <PqDownloadIcon size={15} />
                <span>Tải PDF nháp</span>
              </button>
            </div>
          </div>
        </aside>
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
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
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
              placeholder="VD: Chị Lan…"
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
              gap: '12px',
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
                placeholder="VD: 0909123456…"
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
                placeholder="VD: Spa Hoa Hồng…"
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
              className="pq-btn pq-btn-secondary"
            >
              Hủy
            </button>
            <button
              type="submit"
              data-testid="pq-quick-cust-submit"
              disabled={quickCustSaving}
              className="pq-btn pq-btn-primary"
            >
              <PqCheckIcon size={15} />
              <span>{quickCustSaving ? 'Đang lưu…' : 'Lưu & Chọn ngay'}</span>
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
          <div className="pq-search-wrap" style={{ maxWidth: '100%' }}>
            <PqSearchIcon size={15} className="pq-search-icon" />
            <input
              id="pq-picker-search-input"
              type="search"
              aria-label="Tìm kiếm ấn phẩm trong bảng giá"
              style={{ ...inputStyle, paddingLeft: '36px' }}
              placeholder="Gõ tên ấn phẩm, quy cách hoặc nhà in…"
              value={catalogSearchQuery}
              onChange={(e) => setCatalogSearchQuery(e.target.value)}
            />
          </div>

          {filteredCatalogItems.length === 0 ? (
            <div
              style={{
                padding: '20px',
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
                maxHeight: '360px',
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
                  className="pq-picker-row"
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13.5px' }}>
                      <span style={{ color: 'var(--accent-text)' }}>
                        {item.code}
                      </span>{' '}
                      — {item.name}
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: 'var(--muted-color)',
                        marginTop: '2px',
                      }}
                    >
                      {item.vendor_name || 'Nhà in'}
                      {item.specification ? ` • ${item.specification}` : ''}
                    </div>
                  </div>
                  <div
                    style={{
                      textAlign: 'right',
                      fontSize: '12.5px',
                      ...tabularNumStyle,
                    }}
                  >
                    <strong>
                      {item.pricing_mode === 'TOTAL_BATCH'
                        ? `${formatVnd(item.batch_total_cost)} / lô`
                        : `${formatVnd(item.unit_cost)} / ${item.unit}`}
                    </strong>
                    <div
                      style={{
                        color: 'var(--success-text)',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
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
    </div>
  );
};
