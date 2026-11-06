import React, { useState, useMemo } from 'react';
import { StatusBadge } from '../../../../../packages/ui/src/components/index.js';
import {
  AreaInputMode,
  buildCompactProductSummary,
  computeExactAreaSqm,
  detectIncludedStageOverlaps,
  formatCustomerAreaDisclosure,
  LineCostSource,
  multiplyRateByAreaSqmToVnd,
  normalizeAreaSqm,
  normalizeStageKey,
  PriceItemType,
  ProfitMode,
  ProfitScope,
  RoundingMode,
  ShippingAllocationStrategy,
  VendorCostMode,
  WORKSHOP_FINISHING_SUGGESTIONS,
  WORKSHOP_MATERIAL_GROUPS,
  type AreaInputModeType,
  type CustomerSafePdfPayload,
  type PendingCostLineSummary,
  type PrintCustomerData,
  type PrintVendorPriceItemData,
  type ProfitModeType,
  type ProfitScopeType,
  type QuoteCalculationResult,
  type RoundingModeType,
  type ShippingAllocationStrategyType,
  type VendorCostModeType,
} from '../../../../../packages/contracts/src/printquote.js';
import {
  formatAreaSqmVn,
  formatCustomerLinePriceDisplay,
  formatExactVnd,
  formatNumberVn,
  formatVnd,
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
  type DraftFinishingStageState,
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

export interface SaveOverrideBackToCatalogPatch {
  pricing_mode: VendorCostModeType;
  rate: number;
  unit: string;
  specification?: string | undefined;
  change_note?: string | undefined;
}

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
    canSavePendingDraft?: boolean | undefined;
    isPendingCost?: boolean | undefined;
    pendingSummary?: PendingCostLineSummary[] | undefined;
    structuralErrors?: string[] | undefined;
    validationErrors?: string[] | undefined;
    lineErrors?: Record<string, DraftLineValidationError> | undefined;
    shippingError?: string | null | undefined;
  };
  onResetNewQuote: () => void;
  onSaveQuote: () => void;
  onSavePendingDraftQuote?: (() => void) | undefined;
  onSaveOverrideBackToCatalog?:
    | ((
        priceItemId: string,
        patch: SaveOverrideBackToCatalogPatch,
      ) => Promise<boolean>)
    | undefined;
  onDownloadLivePdf: () => void;
  onOpenLivePreview: () => void;
  onQuickCreateCustomer: (input: {
    name: string;
    phone: string;
    company: string;
  }) => Promise<PrintCustomerData | null>;
}

function computeLineLiveAreaPreview(line: DraftLineState): {
  actualSqm: number | null;
  billableSqm: number | null;
} {
  const mode = line.areaMode ?? AreaInputMode.DIMENSIONS;
  try {
    if (mode === AreaInputMode.DIRECT_AREA) {
      const directRes = parseNumericDraftValue(line.actualAreaInput ?? '', {
        allowDecimal: true,
        min: 0.000001,
        integerOnly: false,
      });
      if (!directRes.isValid || directRes.value === null) {
        return { actualSqm: null, billableSqm: null };
      }
      const actualSqm = normalizeAreaSqm(directRes.value);
      let billableSqm = actualSqm;
      if (
        line.adjustBillableArea &&
        line.billableAreaInput &&
        line.billableAreaInput.trim() !== ''
      ) {
        const billRes = parseNumericDraftValue(line.billableAreaInput, {
          allowDecimal: true,
          min: 0.000001,
          integerOnly: false,
        });
        if (billRes.isValid && billRes.value !== null) {
          billableSqm = normalizeAreaSqm(billRes.value);
        }
      }
      return { actualSqm, billableSqm };
    }

    const wRes = parseNumericDraftValue(line.widthMInput ?? '', {
      allowDecimal: true,
      min: 0.0001,
      integerOnly: false,
    });
    const hRes = parseNumericDraftValue(line.heightMInput ?? '', {
      allowDecimal: true,
      min: 0.0001,
      integerOnly: false,
    });
    const rawSheets =
      line.sheetsCountInput && line.sheetsCountInput.trim() !== ''
        ? line.sheetsCountInput
        : String(line.quantity > 0 ? line.quantity : 1);
    const sheetsRes = parseNumericDraftValue(rawSheets, {
      allowDecimal: false,
      min: 1,
      integerOnly: true,
    });
    if (
      !wRes.isValid ||
      wRes.value === null ||
      !hRes.isValid ||
      hRes.value === null ||
      !sheetsRes.isValid ||
      sheetsRes.value === null
    ) {
      return { actualSqm: null, billableSqm: null };
    }
    const actualSqm = computeExactAreaSqm(
      wRes.value,
      hRes.value,
      sheetsRes.value,
    );
    let billableSqm = actualSqm;
    if (
      line.adjustBillableArea &&
      line.billableAreaInput &&
      line.billableAreaInput.trim() !== ''
    ) {
      const billRes = parseNumericDraftValue(line.billableAreaInput, {
        allowDecimal: true,
        min: 0.000001,
        integerOnly: false,
      });
      if (billRes.isValid && billRes.value !== null) {
        billableSqm = normalizeAreaSqm(billRes.value);
      }
    }
    return { actualSqm, billableSqm };
  } catch {
    return { actualSqm: null, billableSqm: null };
  }
}

function computeStageLivePreviewCost(
  stage: DraftFinishingStageState,
  lineQty: number,
  billableSqm: number | null,
): number | null {
  const parsed = parseNumericDraftValue(stage.rateInput, {
    allowDecimal: !Number.isInteger(stage.rateValue),
    min: 0,
    integerOnly: false,
  });
  if (!parsed.isValid || parsed.value === null) return null;
  if (stage.pricingMode === VendorCostMode.TOTAL_BATCH) {
    return Math.round(parsed.value);
  }
  if (stage.pricingMode === VendorCostMode.PER_SQM) {
    if (!billableSqm || billableSqm <= 0) return null;
    try {
      return multiplyRateByAreaSqmToVnd(parsed.value, billableSqm);
    } catch {
      return null;
    }
  }
  if (lineQty <= 0) return null;
  return Math.round(parsed.value * lineQty);
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
  onSavePendingDraftQuote,
  onSaveOverrideBackToCatalog,
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

  // Per-line contextual UI toggles (kept compact by default)
  const [openSpecHelperLineId, setOpenSpecHelperLineId] = useState<
    string | null
  >(null);
  const [selectedMaterialSubtypeByLine, setSelectedMaterialSubtypeByLine] =
    useState<Record<string, string>>({});
  const [openAreaPanelByLineId, setOpenAreaPanelByLineId] = useState<
    Record<string, boolean>
  >({});
  const [stageNoticeByLineId, setStageNoticeByLineId] = useState<
    Record<string, string>
  >({});

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

  // Explicit confirmation modal to save an overridden quote price back to catalog
  const [overrideConfirmState, setOverrideConfirmState] = useState<{
    lineIdx: number;
    priceItemId: string;
    priceItemName: string;
    oldRate: number | null;
    newRate: number;
    pricingMode: VendorCostModeType;
    unit: string;
    specification: string;
  } | null>(null);
  const [savingOverrideToCatalog, setSavingOverrideToCatalog] =
    useState<boolean>(false);

  const activeBasePriceItems = useMemo(
    () =>
      priceItems.filter(
        (p) => p.is_active !== false && p.item_type !== PriceItemType.FINISHING,
      ),
    [priceItems],
  );

  const activeFinishingPriceItems = useMemo(
    () =>
      priceItems.filter(
        (p) => p.is_active !== false && p.item_type === PriceItemType.FINISHING,
      ),
    [priceItems],
  );

  const filteredCatalogItems = useMemo(() => {
    const q = catalogSearchQuery.trim().toLowerCase();
    if (!q) return activeBasePriceItems;
    return activeBasePriceItems.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.specification || '').toLowerCase().includes(q) ||
        (p.vendor_name || '').toLowerCase().includes(q),
    );
  }, [activeBasePriceItems, catalogSearchQuery]);

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
      const clonedStages = source.finishingStages
        ? source.finishingStages.map((s, sIdx) => ({
            ...s,
            id: `${clonedId}-STG-${sIdx + 1}`,
          }))
        : undefined;
      const cloned: DraftLineState = {
        ...source,
        id: clonedId,
        name: source.name ? `${source.name} (Bản sao)` : '',
        ...(clonedStages ? { finishingStages: clonedStages } : {}),
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
      if (prev.length <= 1) {
        setCollapsedLineIds({});
        return [EMPTY_DRAFT_LINE(1)];
      }
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 1 && next[0]) {
        setCollapsedLineIds({});
      }
      return next;
    });
  };

  const appendSpecificationChip = (lineIdx: number, token: string) => {
    const cleanToken = token.trim();
    if (!cleanToken) return;
    if (cleanToken === 'Khác') {
      if (typeof document !== 'undefined') {
        const specInput = document.getElementById(
          `pq-line-spec-${lineIdx}`,
        ) as HTMLInputElement | null;
        specInput?.focus();
      }
      return;
    }
    onMarkTouched?.();
    setDraftLines((prev) =>
      prev.map((l, i) => {
        if (i !== lineIdx) return l;
        const existingParts = (l.specification || '')
          .split(/[·•,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const tokenKey = normalizeStageKey(cleanToken);
        const alreadyHas = existingParts.some(
          (p) => normalizeStageKey(p) === tokenKey,
        );
        const nextParts = alreadyHas
          ? existingParts.filter((p) => normalizeStageKey(p) !== tokenKey)
          : [...existingParts, cleanToken];
        const autoSqm =
          cleanToken === 'Theo m²' || cleanToken === 'Tính theo m²';
        return {
          ...l,
          specification: nextParts.join(', '),
          ...(autoSqm
            ? {
                unit: 'm²',
                vendorCostMode: VendorCostMode.PER_SQM,
                areaMode: l.areaMode ?? AreaInputMode.DIMENSIONS,
              }
            : {}),
        };
      }),
    );
  };

  const handleAddCatalogFinishingStage = (
    lineIdx: number,
    finishingItemId: string,
  ) => {
    if (!finishingItemId) return;
    const item = activeFinishingPriceItems.find(
      (p) => p.id === finishingItemId,
    );
    if (!item) return;
    const line = draftLines[lineIdx];
    if (!line) return;

    const existingStages = line.finishingStages ?? [];
    const newKey = normalizeStageKey(item.name);
    if (
      newKey &&
      existingStages.some((s) => normalizeStageKey(s.name) === newKey)
    ) {
      setStageNoticeByLineId((prev) => ({
        ...prev,
        [line.id]: `Công đoạn "${item.name}" đã có trên sản phẩm này — không cộng trùng lần 2.`,
      }));
      return;
    }

    setStageNoticeByLineId((prev) => ({ ...prev, [line.id]: '' }));
    onMarkTouched?.();
    const resolvedRate =
      item.pricing_mode === VendorCostMode.TOTAL_BATCH
        ? item.batch_total_cost
        : item.unit_cost;

    const newStage: DraftFinishingStageState = {
      id: `STG-${Date.now()}-${existingStages.length + 1}`,
      priceItemId: item.id,
      code: item.code,
      priceItemVersion: item.version,
      vendorId: item.vendor_id,
      vendorName: item.vendor_name ?? null,
      name: item.name,
      pricingMode: item.pricing_mode,
      rateValue: resolvedRate,
      rateInput: String(resolvedRate),
      unit: item.unit || line.unit || 'tờ',
      costSource: LineCostSource.CATALOG,
      catalogOriginalRate: resolvedRate,
      catalogBatchQuantity: item.batch_quantity ?? 1,
      appliedAt: new Date().toISOString(),
      note: item.conditions_note || item.note || null,
    };

    if (item.pricing_mode === VendorCostMode.PER_SQM) {
      setOpenAreaPanelByLineId((prev) => ({ ...prev, [line.id]: true }));
    }

    setDraftLines((prev) =>
      prev.map((l, i) =>
        i === lineIdx
          ? {
              ...l,
              areaMode:
                item.pricing_mode === VendorCostMode.PER_SQM
                  ? (l.areaMode ?? AreaInputMode.DIMENSIONS)
                  : l.areaMode,
              finishingStages: [...(l.finishingStages ?? []), newStage],
            }
          : l,
      ),
    );
  };

  const handleAddManualOrSuggestedFinishingStage = (
    lineIdx: number,
    preset?: {
      name: string;
      defaultUnit: string;
      defaultMode: VendorCostModeType;
    },
  ) => {
    const line = draftLines[lineIdx];
    if (!line) return;
    const existingStages = line.finishingStages ?? [];

    if (preset) {
      const presetKey = normalizeStageKey(preset.name);
      if (
        presetKey &&
        existingStages.some((s) => normalizeStageKey(s.name) === presetKey)
      ) {
        setStageNoticeByLineId((prev) => ({
          ...prev,
          [line.id]: `Công đoạn "${preset.name}" đã có trên sản phẩm này.`,
        }));
        return;
      }
    }

    setStageNoticeByLineId((prev) => ({ ...prev, [line.id]: '' }));
    onMarkTouched?.();
    const mode = preset?.defaultMode ?? VendorCostMode.PER_UNIT;
    const newStage: DraftFinishingStageState = {
      id: `STG-${Date.now()}-${existingStages.length + 1}`,
      priceItemId: '',
      code: null,
      name: preset?.name ?? '',
      pricingMode: mode,
      rateValue: 0,
      rateInput: '',
      unit: preset?.defaultUnit || line.unit || 'tờ',
      costSource: LineCostSource.MANUAL,
      catalogOriginalRate: null,
      note: null,
    };

    if (mode === VendorCostMode.PER_SQM) {
      setOpenAreaPanelByLineId((prev) => ({ ...prev, [line.id]: true }));
    }

    setDraftLines((prev) =>
      prev.map((l, i) =>
        i === lineIdx
          ? {
              ...l,
              areaMode:
                mode === VendorCostMode.PER_SQM
                  ? (l.areaMode ?? AreaInputMode.DIMENSIONS)
                  : l.areaMode,
              finishingStages: [...(l.finishingStages ?? []), newStage],
            }
          : l,
      ),
    );
  };

  const handleRemoveFinishingStage = (lineIdx: number, stageId: string) => {
    onMarkTouched?.();
    setDraftLines((prev) =>
      prev.map((l, i) => {
        if (i !== lineIdx) return l;
        const nextStages = (l.finishingStages ?? []).filter(
          (s) => s.id !== stageId,
        );
        return {
          ...l,
          finishingStages: nextStages,
        };
      }),
    );
  };

  const handleConfirmSaveOverrideToCatalog = async () => {
    if (!overrideConfirmState || !onSaveOverrideBackToCatalog) return;
    setSavingOverrideToCatalog(true);
    try {
      const ok = await onSaveOverrideBackToCatalog(
        overrideConfirmState.priceItemId,
        {
          pricing_mode: overrideConfirmState.pricingMode,
          rate: overrideConfirmState.newRate,
          unit: overrideConfirmState.unit,
          specification: overrideConfirmState.specification,
          change_note: `Cập nhật từ màn hình lập báo giá (${formatVnd(overrideConfirmState.newRate)})`,
        },
      );
      if (ok) {
        const targetLineIdx = overrideConfirmState.lineIdx;
        const savedRate = overrideConfirmState.newRate;
        setDraftLines((prev) =>
          prev.map((l, i) =>
            i === targetLineIdx
              ? {
                  ...l,
                  baseCostSource: LineCostSource.CATALOG,
                  baseCatalogOriginalRate: savedRate,
                }
              : l,
          ),
        );
        setOverrideConfirmState(null);
      }
    } finally {
      setSavingOverrideToCatalog(false);
    }
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
  const canSaveAsPendingCostDraft = Boolean(
    isQuoteIncomplete &&
    livePricingResult.canSavePendingDraft &&
    livePricingResult.isPendingCost,
  );
  const showValidationState = Boolean(editingQuoteId || hasTouchedFields);
  const [touchedQtyByLineId, setTouchedQtyByLineId] = useState<
    Record<string, boolean>
  >({});

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
                : 'Chọn giá xưởng hoặc nhập tay — Giá vốn & gia công được ẩn tuyệt đối trên PDF gửi khách'}
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
                const canCollapseThisLine =
                  draftLines.length > 1 ||
                  Boolean(
                    line.name.trim() ||
                    (line.quantityInput && line.quantityInput.trim() !== ''),
                  );
                const isCollapsed =
                  canCollapseThisLine && Boolean(collapsedLineIds[line.id]);
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

                const stages = line.finishingStages ?? [];
                const selectedBaseCatalog = line.vendorPriceItemId
                  ? priceItems.find((p) => p.id === line.vendorPriceItemId) ||
                    null
                  : null;

                const areaPreview = computeLineLiveAreaPreview(line);
                const usesPerSqm =
                  line.vendorCostMode === VendorCostMode.PER_SQM ||
                  (line.profitMode === ProfitMode.FIXED_AMOUNT &&
                    line.profitScope === ProfitScope.PER_SQM) ||
                  stages.some(
                    (s) => s.pricingMode === VendorCostMode.PER_SQM,
                  ) ||
                  line.unit.trim().toLowerCase() === 'm²' ||
                  line.unit.trim().toLowerCase() === 'm2';
                const hasTypedArea = Boolean(
                  (line.widthMInput && line.widthMInput.trim() !== '') ||
                  (line.heightMInput && line.heightMInput.trim() !== '') ||
                  (line.actualAreaInput && line.actualAreaInput.trim() !== ''),
                );
                const isAreaPanelOpen = Boolean(
                  usesPerSqm || hasTypedArea || openAreaPanelByLineId[line.id],
                );

                const compactSummary = buildCompactProductSummary({
                  specification: line.specification,
                  finishingStageNames: stages
                    .map((s) => s.name)
                    .filter(Boolean),
                  areaSpec:
                    areaPreview.actualSqm !== null
                      ? {
                          mode: line.areaMode ?? AreaInputMode.DIMENSIONS,
                          widthM:
                            line.widthMInput && line.widthMInput.trim() !== ''
                              ? Number(line.widthMInput.replace(',', '.'))
                              : null,
                          heightM:
                            line.heightMInput && line.heightMInput.trim() !== ''
                              ? Number(line.heightMInput.replace(',', '.'))
                              : null,
                          sheetsCount:
                            line.sheetsCountInput &&
                            line.sheetsCountInput.trim() !== ''
                              ? Number(line.sheetsCountInput)
                              : line.quantity || 1,
                          actualAreaSqm: areaPreview.actualSqm,
                          billableAreaSqm:
                            areaPreview.billableSqm ?? areaPreview.actualSqm,
                        }
                      : null,
                });

                const stageOverlapWarnings = detectIncludedStageOverlaps({
                  baseIncludedStages:
                    line.baseIncludedStages ??
                    selectedBaseCatalog?.included_stages,
                  baseCatalogSpecification:
                    selectedBaseCatalog?.specification ?? null,
                  finishingStages: stages.map((s) => ({
                    id: s.id,
                    name: s.name,
                  })),
                });

                const isLineCostPending =
                  rawCostInput.trim() === '' ||
                  stages.some((s) => s.rateInput.trim() === '');

                const isCatalogPriceOverridden = Boolean(
                  line.vendorPriceItemId &&
                  line.baseCostSource === LineCostSource.CATALOG_OVERRIDDEN &&
                  rawCostInput.trim() !== '',
                );

                const activeMatGroupId = line.materialGroup || 'GIAY';
                const activeMatGroup =
                  WORKSHOP_MATERIAL_GROUPS.find(
                    (g) => g.id === activeMatGroupId,
                  ) ?? WORKSHOP_MATERIAL_GROUPS[0];
                const activeMatSubtype =
                  selectedMaterialSubtypeByLine[line.id] ||
                  activeMatGroup.subtypes[0] ||
                  '';
                const activeGsmChips =
                  (
                    activeMatGroup.gsmBySubtype as Record<
                      string,
                      readonly string[] | undefined
                    >
                  )[activeMatSubtype] ??
                  activeMatGroup.gsmBySubtype.default ??
                  [];

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
                          {compactSummary && (
                            <span
                              data-testid={`pq-line-summary-pill-${idx}`}
                              style={{
                                fontSize: '12px',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                backgroundColor: 'var(--surface-subtle)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-color)',
                              }}
                            >
                              {compactSummary}
                            </span>
                          )}
                          {calcLine ? (
                            <>
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
                            </>
                          ) : (
                            isLineCostPending &&
                            rawQtyInput.trim() !== '' && (
                              <StatusBadge
                                status="warning"
                                label="Chờ giá xưởng"
                              />
                            )
                          )}
                        </div>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flexWrap: 'wrap',
                            minWidth: 0,
                          }}
                        >
                          <span className="pq-code-pill">
                            Sản phẩm #{idx + 1}
                          </span>
                          {compactSummary && (
                            <span
                              data-testid={`pq-line-summary-pill-${idx}`}
                              style={{
                                fontSize: '12px',
                                fontWeight: 600,
                                padding: '2px 9px',
                                borderRadius: '999px',
                                backgroundColor: 'var(--accent-soft)',
                                color: 'var(--accent-text)',
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {compactSummary}
                            </span>
                          )}
                          {calcLine ? (
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
                          ) : (
                            isLineCostPending &&
                            rawQtyInput.trim() !== '' && (
                              <StatusBadge
                                status="warning"
                                label="Chờ giá xưởng"
                              />
                            )
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
                        {canCollapseThisLine && (
                          <button
                            type="button"
                            data-testid={`pq-line-toggle-${idx}`}
                            onClick={() =>
                              setCollapsedLineIds((prev) => {
                                const willExpand = Boolean(prev[line.id]);
                                if (willExpand) {
                                  if (draftLines.length > 1) {
                                    const next: Record<string, boolean> = {};
                                    draftLines.forEach((l) => {
                                      next[l.id] = l.id !== line.id;
                                    });
                                    return next;
                                  }
                                  return { ...prev, [line.id]: false };
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

                        {(draftLines.length > 1 || isCollapsed) && (
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
                        {/* 1) Base Workshop Catalog Quick-Pick Bar */}
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
                              Giá cơ bản đã lưu:
                            </label>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              gap: '8px',
                              flex: '1 1 220px',
                              minWidth: 0,
                              flexWrap: 'wrap',
                            }}
                          >
                            <select
                              id={`pq-line-catalog-${idx}`}
                              aria-label={`Chọn bảng giá nhà in dòng ${idx + 1}`}
                              style={{
                                ...inputStyle,
                                flex: '1 1 200px',
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
                                -- Nhập thủ công hoặc chọn giá cơ bản --
                              </option>
                              {activeBasePriceItems.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.code} — {p.name} (
                                  {p.pricing_mode === VendorCostMode.TOTAL_BATCH
                                    ? `Lô: ${formatVnd(p.batch_total_cost)}`
                                    : p.pricing_mode === VendorCostMode.PER_SQM
                                      ? `${formatVnd(p.unit_cost)}/m²`
                                      : `${formatVnd(p.unit_cost)}/${p.unit}`}
                                  )
                                </option>
                              ))}
                            </select>

                            {activeBasePriceItems.length > 0 && (
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

                        {selectedBaseCatalog?.conditions_note && (
                          <div
                            style={{
                              fontSize: '12px',
                              color: 'var(--muted-color)',
                              padding: '6px 10px',
                              borderRadius: '8px',
                              backgroundColor: 'var(--surface-subtle)',
                              border: '1px solid var(--border-color)',
                            }}
                          >
                            Điều kiện áp dụng giá gốc:{' '}
                            <strong style={{ color: 'var(--text-color)' }}>
                              {selectedBaseCatalog.conditions_note}
                            </strong>
                          </div>
                        )}

                        {/* 2) Product Name, Specification + Contextual Helper, Quantity & Unit */}
                        <div className="pq-product-info-grid">
                          <div>
                            <div className="pq-field-label-row">
                              <label
                                htmlFor={`pq-line-name-${idx}`}
                                style={{ ...labelStyle, marginBottom: 0 }}
                              >
                                Tên sản phẩm in *
                              </label>
                            </div>
                            <input
                              id={`pq-line-name-${idx}`}
                              aria-label={`Tên sản phẩm dòng ${idx + 1}`}
                              style={inputStyle}
                              placeholder="VD: Tờ rơi A4 Couche 200gsm…"
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
                            <div className="pq-field-label-row">
                              <label
                                htmlFor={`pq-line-spec-${idx}`}
                                style={{ ...labelStyle, marginBottom: 0 }}
                              >
                                Quy cách / Chất liệu
                              </label>
                              <button
                                type="button"
                                data-testid={`pq-toggle-spec-helper-${idx}`}
                                title="Gợi ý chất liệu & quy cách"
                                aria-label={
                                  openSpecHelperLineId === line.id
                                    ? 'Ẩn gợi ý chất liệu'
                                    : 'Gợi ý chất liệu'
                                }
                                onClick={() =>
                                  setOpenSpecHelperLineId((prev) =>
                                    prev === line.id ? null : line.id,
                                  )
                                }
                                className="pq-inline-label-action"
                              >
                                {openSpecHelperLineId === line.id
                                  ? 'Ẩn ▲'
                                  : '+ Gợi ý'}
                              </button>
                            </div>
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
                              placeholder="VD: A4, C200, in màu 2 mặt…"
                            />
                          </div>

                          <div className="pq-qty-unit-pair">
                            <div style={{ minWidth: 0 }}>
                              <div className="pq-field-label-row">
                                <label
                                  htmlFor={`pq-line-qty-${idx}`}
                                  style={{ ...labelStyle, marginBottom: 0 }}
                                >
                                  Số lượng *
                                </label>
                              </div>
                              <NumericDraftInput
                                id={`pq-line-qty-${idx}`}
                                ariaLabel={`Số lượng dòng ${idx + 1}`}
                                allowDecimal={false}
                                placeholder="VD: 100"
                                style={{ ...inputStyle, ...tabularNumStyle }}
                                invalid={Boolean(
                                  (editingQuoteId ||
                                    touchedQtyByLineId[line.id]) &&
                                  lineErr?.quantity,
                                )}
                                value={rawQtyInput}
                                onBlurField={() =>
                                  setTouchedQtyByLineId((prev) =>
                                    prev[line.id]
                                      ? prev
                                      : { ...prev, [line.id]: true },
                                  )
                                }
                                onValueChange={(nextRaw) => {
                                  onMarkTouched?.();
                                  setTouchedQtyByLineId((prev) =>
                                    prev[line.id]
                                      ? prev
                                      : { ...prev, [line.id]: true },
                                  );
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

                            <div style={{ minWidth: 0 }}>
                              <div className="pq-field-label-row">
                                <label
                                  htmlFor={`pq-line-unit-${idx}`}
                                  style={{ ...labelStyle, marginBottom: 0 }}
                                >
                                  Đơn vị
                                </label>
                                {!usesPerSqm && (
                                  <button
                                    type="button"
                                    data-testid={`pq-toggle-area-${idx}`}
                                    onClick={() =>
                                      setOpenAreaPanelByLineId((prev) => ({
                                        ...prev,
                                        [line.id]: !prev[line.id],
                                      }))
                                    }
                                    className="pq-inline-label-action"
                                  >
                                    {isAreaPanelOpen ? 'Ẩn m²' : '+ m²'}
                                  </button>
                                )}
                              </div>
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

                        {/* Contextual Material & Spec Picker (Only opens on demand, only shows fields for chosen material group) */}
                        {openSpecHelperLineId === line.id && (
                          <div
                            data-testid={`pq-spec-helper-panel-${idx}`}
                            style={{
                              padding: '10px 12px',
                              borderRadius: '10px',
                              backgroundColor: 'var(--surface-subtle)',
                              border: '1px solid var(--border-color)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '6px',
                                alignItems: 'center',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  color: 'var(--muted-color)',
                                }}
                              >
                                Nhóm chất liệu:
                              </span>
                              {WORKSHOP_MATERIAL_GROUPS.map((grp) => {
                                const active = activeMatGroup.id === grp.id;
                                return (
                                  <button
                                    key={grp.id}
                                    type="button"
                                    data-testid={`pq-mat-group-${idx}-${grp.id}`}
                                    onClick={() => {
                                      onMarkTouched?.();
                                      setSelectedMaterialSubtypeByLine(
                                        (prev) => ({
                                          ...prev,
                                          [line.id]: grp.subtypes[0] || '',
                                        }),
                                      );
                                      setDraftLines((prev) =>
                                        prev.map((l, i) =>
                                          i === idx
                                            ? {
                                                ...l,
                                                materialGroup: grp.id,
                                                unit: l.unit || grp.defaultUnit,
                                              }
                                            : l,
                                        ),
                                      );
                                      if (grp.id === 'KHAC') {
                                        appendSpecificationChip(idx, 'Khác');
                                      }
                                    }}
                                    className={
                                      active
                                        ? 'pq-btn pq-btn-primary pq-btn-sm'
                                        : 'pq-btn pq-btn-secondary pq-btn-sm'
                                    }
                                    style={{
                                      minHeight: '32px',
                                      padding: '4px 10px',
                                    }}
                                  >
                                    {grp.label}
                                  </button>
                                );
                              })}
                            </div>

                            {activeMatGroup.id !== 'KHAC' && (
                              <>
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '6px',
                                    alignItems: 'center',
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: '12px',
                                      color: 'var(--muted-color)',
                                    }}
                                  >
                                    Loại:
                                  </span>
                                  {activeMatGroup.subtypes.map((sub) => (
                                    <button
                                      key={sub}
                                      type="button"
                                      onClick={() => {
                                        setSelectedMaterialSubtypeByLine(
                                          (prev) => ({
                                            ...prev,
                                            [line.id]: sub,
                                          }),
                                        );
                                        appendSpecificationChip(idx, sub);
                                      }}
                                      className="pq-btn pq-btn-ghost pq-btn-sm"
                                      style={{
                                        minHeight: '30px',
                                        padding: '3px 9px',
                                        border:
                                          activeMatSubtype === sub
                                            ? '1px solid var(--accent-text)'
                                            : '1px solid var(--border-color)',
                                      }}
                                    >
                                      {sub}
                                    </button>
                                  ))}
                                </div>

                                {activeGsmChips.length > 0 && (
                                  <div
                                    style={{
                                      display: 'flex',
                                      flexWrap: 'wrap',
                                      gap: '6px',
                                      alignItems: 'center',
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: '12px',
                                        color: 'var(--muted-color)',
                                      }}
                                    >
                                      Định lượng:
                                    </span>
                                    {activeGsmChips.map((gsm) => (
                                      <button
                                        key={gsm}
                                        type="button"
                                        onClick={() =>
                                          appendSpecificationChip(idx, gsm)
                                        }
                                        className="pq-btn pq-btn-ghost pq-btn-sm"
                                        style={{
                                          minHeight: '30px',
                                          padding: '3px 9px',
                                          border:
                                            '1px solid var(--border-color)',
                                        }}
                                      >
                                        {gsm}
                                      </button>
                                    ))}
                                  </div>
                                )}

                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '6px',
                                    alignItems: 'center',
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: '12px',
                                      color: 'var(--muted-color)',
                                    }}
                                  >
                                    Khổ & In:
                                  </span>
                                  {[
                                    ...activeMatGroup.sizes.filter(
                                      (s) => s !== 'Khác',
                                    ),
                                    ...activeMatGroup.printColors,
                                  ].map((tok) => (
                                    <button
                                      key={tok}
                                      type="button"
                                      onClick={() =>
                                        appendSpecificationChip(idx, tok)
                                      }
                                      className="pq-btn pq-btn-ghost pq-btn-sm"
                                      style={{
                                        minHeight: '30px',
                                        padding: '3px 9px',
                                        border: '1px solid var(--border-color)',
                                      }}
                                    >
                                      {tok}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {/* 3) Area (m²) Subpanel — Contextual when PER_SQM or toggled */}
                        {isAreaPanelOpen && (
                          <div
                            data-testid={`pq-area-panel-${idx}`}
                            style={{
                              padding: '10px 12px',
                              borderRadius: '10px',
                              backgroundColor: 'var(--surface-subtle)',
                              border:
                                showValidationState && lineErr?.area
                                  ? '1px solid var(--danger-text)'
                                  : '1px solid var(--border-color)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '10px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '8px',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <strong style={{ fontSize: '12.5px' }}>
                                  Kích thước / Diện tích (m²)
                                </strong>
                                <div
                                  role="group"
                                  aria-label={`Chế độ nhập diện tích dòng ${idx + 1}`}
                                  className="pq-segmented-switch"
                                >
                                  <button
                                    type="button"
                                    data-testid={`pq-area-mode-dim-${idx}`}
                                    className="pq-segmented-btn"
                                    data-active={
                                      (line.areaMode ??
                                        AreaInputMode.DIMENSIONS) ===
                                      AreaInputMode.DIMENSIONS
                                        ? 'true'
                                        : 'false'
                                    }
                                    onClick={() => {
                                      onMarkTouched?.();
                                      setDraftLines((prev) =>
                                        prev.map((l, i) =>
                                          i === idx
                                            ? {
                                                ...l,
                                                areaMode:
                                                  AreaInputMode.DIMENSIONS as AreaInputModeType,
                                              }
                                            : l,
                                        ),
                                      );
                                    }}
                                  >
                                    Ngang × Cao × Tấm
                                  </button>
                                  <button
                                    type="button"
                                    data-testid={`pq-area-mode-direct-${idx}`}
                                    className="pq-segmented-btn"
                                    data-active={
                                      line.areaMode ===
                                      AreaInputMode.DIRECT_AREA
                                        ? 'true'
                                        : 'false'
                                    }
                                    onClick={() => {
                                      onMarkTouched?.();
                                      setDraftLines((prev) =>
                                        prev.map((l, i) =>
                                          i === idx
                                            ? {
                                                ...l,
                                                areaMode:
                                                  AreaInputMode.DIRECT_AREA as AreaInputModeType,
                                              }
                                            : l,
                                        ),
                                      );
                                    }}
                                  >
                                    Nhập tổng m²
                                  </button>
                                </div>
                              </div>

                              {areaPreview.actualSqm !== null && (
                                <span
                                  data-testid={`pq-area-live-badge-${idx}`}
                                  style={{
                                    fontSize: '12.5px',
                                    fontWeight: 700,
                                    color: 'var(--accent-text)',
                                    ...tabularNumStyle,
                                  }}
                                >
                                  Thực tế:{' '}
                                  {formatAreaSqmVn(areaPreview.actualSqm)} m²
                                  {areaPreview.billableSqm !== null &&
                                    areaPreview.billableSqm !==
                                      areaPreview.actualSqm &&
                                    ` • Tính tiền: ${formatAreaSqmVn(areaPreview.billableSqm)} m²`}
                                </span>
                              )}
                            </div>

                            {line.areaMode === AreaInputMode.DIRECT_AREA ? (
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns:
                                    'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
                                  gap: '10px',
                                }}
                              >
                                <div>
                                  <label
                                    htmlFor={`pq-line-direct-area-${idx}`}
                                    style={labelStyle}
                                  >
                                    Tổng diện tích thực tế (m²) *
                                  </label>
                                  <NumericDraftInput
                                    id={`pq-line-direct-area-${idx}`}
                                    dataTestId={`pq-line-direct-area-${idx}`}
                                    ariaLabel={`Tổng diện tích m2 dòng ${idx + 1}`}
                                    allowDecimal={true}
                                    placeholder="VD: 2.88"
                                    style={{
                                      ...inputStyle,
                                      ...tabularNumStyle,
                                    }}
                                    value={line.actualAreaInput ?? ''}
                                    onValueChange={(nextRaw) => {
                                      onMarkTouched?.();
                                      setDraftLines((prev) =>
                                        prev.map((l, i) =>
                                          i === idx
                                            ? { ...l, actualAreaInput: nextRaw }
                                            : l,
                                        ),
                                      );
                                    }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns:
                                    'repeat(auto-fit, minmax(min(100%, 135px), 1fr))',
                                  gap: '10px',
                                }}
                              >
                                <div>
                                  <label
                                    htmlFor={`pq-line-width-${idx}`}
                                    style={labelStyle}
                                  >
                                    Chiều ngang (m) *
                                  </label>
                                  <NumericDraftInput
                                    id={`pq-line-width-${idx}`}
                                    dataTestId={`pq-line-width-${idx}`}
                                    ariaLabel={`Chiều ngang mét dòng ${idx + 1}`}
                                    allowDecimal={true}
                                    placeholder="VD: 0.8"
                                    style={{
                                      ...inputStyle,
                                      ...tabularNumStyle,
                                    }}
                                    value={line.widthMInput ?? ''}
                                    onValueChange={(nextRaw) => {
                                      onMarkTouched?.();
                                      setDraftLines((prev) =>
                                        prev.map((l, i) =>
                                          i === idx
                                            ? { ...l, widthMInput: nextRaw }
                                            : l,
                                        ),
                                      );
                                    }}
                                  />
                                </div>

                                <div>
                                  <label
                                    htmlFor={`pq-line-height-${idx}`}
                                    style={labelStyle}
                                  >
                                    Chiều cao (m) *
                                  </label>
                                  <NumericDraftInput
                                    id={`pq-line-height-${idx}`}
                                    dataTestId={`pq-line-height-${idx}`}
                                    ariaLabel={`Chiều cao mét dòng ${idx + 1}`}
                                    allowDecimal={true}
                                    placeholder="VD: 1.2"
                                    style={{
                                      ...inputStyle,
                                      ...tabularNumStyle,
                                    }}
                                    value={line.heightMInput ?? ''}
                                    onValueChange={(nextRaw) => {
                                      onMarkTouched?.();
                                      setDraftLines((prev) =>
                                        prev.map((l, i) =>
                                          i === idx
                                            ? { ...l, heightMInput: nextRaw }
                                            : l,
                                        ),
                                      );
                                    }}
                                  />
                                </div>

                                <div>
                                  <label
                                    htmlFor={`pq-line-sheets-${idx}`}
                                    style={labelStyle}
                                  >
                                    Số tấm nhân m²
                                  </label>
                                  <NumericDraftInput
                                    id={`pq-line-sheets-${idx}`}
                                    dataTestId={`pq-line-sheets-${idx}`}
                                    ariaLabel={`Số tấm diện tích dòng ${idx + 1}`}
                                    allowDecimal={false}
                                    placeholder={
                                      rawQtyInput !== '' ? rawQtyInput : '1'
                                    }
                                    style={{
                                      ...inputStyle,
                                      ...tabularNumStyle,
                                    }}
                                    value={line.sheetsCountInput ?? ''}
                                    onValueChange={(nextRaw) => {
                                      onMarkTouched?.();
                                      setDraftLines((prev) =>
                                        prev.map((l, i) =>
                                          i === idx
                                            ? {
                                                ...l,
                                                sheetsCountInput: nextRaw,
                                              }
                                            : l,
                                        ),
                                      );
                                    }}
                                  />
                                </div>
                              </div>
                            )}

                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <label
                                htmlFor={`pq-line-adjust-area-${idx}`}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  id={`pq-line-adjust-area-${idx}`}
                                  data-testid={`pq-line-adjust-area-toggle-${idx}`}
                                  type="checkbox"
                                  checked={Boolean(line.adjustBillableArea)}
                                  onChange={(e) => {
                                    onMarkTouched?.();
                                    const checked = e.target.checked;
                                    setDraftLines((prev) =>
                                      prev.map((l, i) =>
                                        i === idx
                                          ? {
                                              ...l,
                                              adjustBillableArea: checked,
                                              ...(checked
                                                ? {}
                                                : {
                                                    billableAreaInput: '',
                                                    areaAdjustmentReason: '',
                                                    customerAreaNote: '',
                                                  }),
                                            }
                                          : l,
                                      ),
                                    );
                                  }}
                                />
                                <span>
                                  Điều chỉnh m² tính tiền riêng (không tự cộng
                                  hao hụt)
                                </span>
                              </label>

                              {line.adjustBillableArea && (
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    flexWrap: 'wrap',
                                    flex: '1 1 320px',
                                  }}
                                >
                                  <div style={{ width: '150px' }}>
                                    <NumericDraftInput
                                      id={`pq-line-billable-area-${idx}`}
                                      dataTestId={`pq-line-billable-area-${idx}`}
                                      ariaLabel={`Diện tích tính tiền m2 dòng ${idx + 1}`}
                                      allowDecimal={true}
                                      placeholder="m² tính tiền"
                                      style={{
                                        ...inputStyle,
                                        ...tabularNumStyle,
                                        minHeight: '36px',
                                      }}
                                      value={line.billableAreaInput ?? ''}
                                      onValueChange={(nextRaw) => {
                                        onMarkTouched?.();
                                        setDraftLines((prev) =>
                                          prev.map((l, i) =>
                                            i === idx
                                              ? {
                                                  ...l,
                                                  billableAreaInput: nextRaw,
                                                }
                                              : l,
                                          ),
                                        );
                                      }}
                                    />
                                  </div>
                                  <div style={{ flex: '1 1 200px' }}>
                                    <input
                                      id={`pq-line-area-reason-${idx}`}
                                      data-testid={`pq-line-area-reason-${idx}`}
                                      aria-label={`Lý do điều chỉnh diện tích nội bộ dòng ${idx + 1}`}
                                      style={{
                                        ...inputStyle,
                                        minHeight: '36px',
                                        fontSize: '12.5px',
                                      }}
                                      placeholder="Lý do nội bộ * (không xuất PDF — VD: Xưởng tính tối thiểu 1m²)"
                                      value={line.areaAdjustmentReason ?? ''}
                                      onChange={(e) => {
                                        const reasonVal = e.target.value;
                                        onMarkTouched?.();
                                        setDraftLines((prev) =>
                                          prev.map((l, i) =>
                                            i === idx
                                              ? {
                                                  ...l,
                                                  areaAdjustmentReason:
                                                    reasonVal,
                                                }
                                              : l,
                                          ),
                                        );
                                      }}
                                    />
                                  </div>
                                  <div style={{ flex: '1 1 220px' }}>
                                    <input
                                      id={`pq-line-customer-area-note-${idx}`}
                                      data-testid={`pq-line-customer-area-note-${idx}`}
                                      aria-label={`Giải thích diện tích gửi khách dòng ${idx + 1}`}
                                      style={{
                                        ...inputStyle,
                                        minHeight: '36px',
                                        fontSize: '12.5px',
                                      }}
                                      placeholder="Giải thích gửi khách (tùy chọn — để trống hiện trung tính)"
                                      value={line.customerAreaNote ?? ''}
                                      onChange={(e) => {
                                        const noteVal = e.target.value;
                                        onMarkTouched?.();
                                        setDraftLines((prev) =>
                                          prev.map((l, i) =>
                                            i === idx
                                              ? {
                                                  ...l,
                                                  customerAreaNote: noteVal,
                                                }
                                              : l,
                                          ),
                                        );
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                            {showValidationState && lineErr?.area && (
                              <div
                                role="alert"
                                data-testid={`pq-line-area-error-${idx}`}
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  color: 'var(--danger-text)',
                                }}
                              >
                                {lineErr.area}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 4) Multi-Stage Finishing Builder (0..N stages per product) */}
                        <div
                          data-testid={`pq-finishing-section-${idx}`}
                          style={{
                            padding: '10px 12px',
                            borderRadius: '10px',
                            backgroundColor: 'var(--surface-subtle)',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '8px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <strong style={{ fontSize: '12.5px' }}>
                                Công đoạn gia công ({stages.length})
                              </strong>
                              {(line.baseIncludedStages?.length ?? 0) > 0 && (
                                <span
                                  style={{
                                    fontSize: '12px',
                                    color: 'var(--muted-color)',
                                  }}
                                >
                                  • Giá cơ bản đã gồm:{' '}
                                  {line.baseIncludedStages?.join(', ')}
                                </span>
                              )}
                            </div>

                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                flexWrap: 'wrap',
                              }}
                            >
                              {activeFinishingPriceItems.length > 0 && (
                                <select
                                  data-testid={`pq-stage-catalog-select-${idx}`}
                                  aria-label={`Chọn gia công đã lưu cho dòng ${idx + 1}`}
                                  style={{
                                    ...inputStyle,
                                    minHeight: '34px',
                                    padding: '4px 10px',
                                    fontSize: '12.5px',
                                    width: 'auto',
                                    maxWidth: '240px',
                                  }}
                                  value=""
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleAddCatalogFinishingStage(
                                        idx,
                                        e.target.value,
                                      );
                                    }
                                  }}
                                >
                                  <option value="">
                                    + Chọn gia công đã lưu…
                                  </option>
                                  {activeFinishingPriceItems.map((fp) => (
                                    <option key={fp.id} value={fp.id}>
                                      {fp.name} (
                                      {fp.pricing_mode ===
                                      VendorCostMode.TOTAL_BATCH
                                        ? `${formatVnd(fp.batch_total_cost)}/lô`
                                        : fp.pricing_mode ===
                                            VendorCostMode.PER_SQM
                                          ? `${formatVnd(fp.unit_cost)}/m²`
                                          : `${formatVnd(fp.unit_cost)}/${fp.unit}`}
                                      )
                                    </option>
                                  ))}
                                </select>
                              )}

                              <select
                                data-testid={`pq-stage-preset-select-${idx}`}
                                aria-label={`Gợi ý công đoạn gia công dòng ${idx + 1}`}
                                style={{
                                  ...inputStyle,
                                  minHeight: '34px',
                                  padding: '4px 10px',
                                  fontSize: '12.5px',
                                  width: 'auto',
                                  maxWidth: '205px',
                                }}
                                value=""
                                onChange={(e) => {
                                  const chosenName = e.target.value;
                                  if (!chosenName) return;
                                  if (chosenName === '__MANUAL__') {
                                    handleAddManualOrSuggestedFinishingStage(
                                      idx,
                                    );
                                    return;
                                  }
                                  const preset =
                                    WORKSHOP_FINISHING_SUGGESTIONS.find(
                                      (s) => s.name === chosenName,
                                    );
                                  handleAddManualOrSuggestedFinishingStage(
                                    idx,
                                    preset,
                                  );
                                }}
                              >
                                <option value="">+ Thêm gia công nhanh…</option>
                                {WORKSHOP_FINISHING_SUGGESTIONS.map((s) => (
                                  <option key={s.name} value={s.name}>
                                    {s.name}
                                  </option>
                                ))}
                                <option value="__MANUAL__">
                                  Khác (Tự nhập gia công)…
                                </option>
                              </select>

                              <button
                                type="button"
                                data-testid={`pq-add-manual-stage-${idx}`}
                                onClick={() =>
                                  handleAddManualOrSuggestedFinishingStage(idx)
                                }
                                className="pq-btn pq-btn-ghost pq-btn-sm"
                                style={{ minHeight: '34px' }}
                              >
                                <PqPlusIcon size={13} />
                                <span>Nhập tay</span>
                              </button>
                            </div>
                          </div>

                          {stageNoticeByLineId[line.id] && (
                            <div
                              role="status"
                              data-testid={`pq-stage-dup-notice-${idx}`}
                              style={{
                                fontSize: '12px',
                                fontWeight: 600,
                                color: 'var(--danger-text)',
                              }}
                            >
                              {stageNoticeByLineId[line.id]}
                            </div>
                          )}

                          {stageOverlapWarnings.length > 0 && (
                            <div
                              role="alert"
                              data-testid={`pq-stage-overlap-warning-${idx}`}
                              style={{
                                padding: '8px 10px',
                                borderRadius: '8px',
                                border: '1px solid #d97706',
                                backgroundColor: 'rgba(245, 158, 11, 0.12)',
                                fontSize: '12px',
                                lineHeight: 1.45,
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '8px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <span>
                                <strong>Cảnh báo cộng trùng:</strong> Giá cơ bản
                                đã ghi gồm{' '}
                                <strong>
                                  {stageOverlapWarnings
                                    .map((w) => w.matchedIncludedLabel)
                                    .join(', ')}
                                </strong>
                                , đang trùng với công đoạn{' '}
                                <strong>
                                  {stageOverlapWarnings
                                    .map((w) => w.stageName)
                                    .join(', ')}
                                </strong>
                                . Kiểm tra lại để tránh tính 2 lần.
                              </span>
                              <button
                                type="button"
                                data-testid={`pq-remove-overlapping-stages-${idx}`}
                                onClick={() => {
                                  const overlapIds = new Set(
                                    stageOverlapWarnings.map((w) => w.stageId),
                                  );
                                  onMarkTouched?.();
                                  setDraftLines((prev) =>
                                    prev.map((l, i) =>
                                      i === idx
                                        ? {
                                            ...l,
                                            finishingStages: (
                                              l.finishingStages ?? []
                                            ).filter(
                                              (s) => !overlapIds.has(s.id),
                                            ),
                                          }
                                        : l,
                                    ),
                                  );
                                }}
                                className="pq-btn pq-btn-secondary pq-btn-sm"
                              >
                                Gỡ công đoạn trùng
                              </button>
                            </div>
                          )}

                          {stages.length > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                              }}
                            >
                              {stages.map((stage, sIdx) => {
                                const stageCostPreview =
                                  computeStageLivePreviewCost(
                                    stage,
                                    line.quantity,
                                    areaPreview.billableSqm,
                                  );
                                return (
                                  <div
                                    key={stage.id}
                                    data-testid={`pq-stage-row-${idx}-${sIdx}`}
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns:
                                        'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
                                      gap: '8px',
                                      alignItems: 'center',
                                      padding: '8px',
                                      borderRadius: '8px',
                                      backgroundColor: 'var(--surface-color)',
                                      border: '1px solid var(--border-color)',
                                    }}
                                  >
                                    <div>
                                      <input
                                        data-testid={`pq-stage-name-${idx}-${sIdx}`}
                                        aria-label={`Tên gia công ${sIdx + 1} dòng ${idx + 1}`}
                                        style={{
                                          ...inputStyle,
                                          minHeight: '38px',
                                          fontSize: '13px',
                                        }}
                                        placeholder="VD: Cán màng 1 mặt…"
                                        value={stage.name}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          onMarkTouched?.();
                                          setDraftLines((prev) =>
                                            prev.map((l, i) =>
                                              i === idx
                                                ? {
                                                    ...l,
                                                    finishingStages: (
                                                      l.finishingStages ?? []
                                                    ).map((s) =>
                                                      s.id === stage.id
                                                        ? { ...s, name: val }
                                                        : s,
                                                    ),
                                                  }
                                                : l,
                                            ),
                                          );
                                        }}
                                      />
                                    </div>

                                    <div>
                                      <select
                                        data-testid={`pq-stage-mode-${idx}-${sIdx}`}
                                        aria-label={`Cách tính gia công ${sIdx + 1} dòng ${idx + 1}`}
                                        style={{
                                          ...inputStyle,
                                          minHeight: '38px',
                                          fontSize: '13px',
                                        }}
                                        value={stage.pricingMode}
                                        onChange={(e) => {
                                          const nextMode = e.target
                                            .value as VendorCostModeType;
                                          onMarkTouched?.();
                                          if (
                                            nextMode === VendorCostMode.PER_SQM
                                          ) {
                                            setOpenAreaPanelByLineId(
                                              (prev) => ({
                                                ...prev,
                                                [line.id]: true,
                                              }),
                                            );
                                          }
                                          setDraftLines((prev) =>
                                            prev.map((l, i) =>
                                              i === idx
                                                ? {
                                                    ...l,
                                                    areaMode:
                                                      nextMode ===
                                                      VendorCostMode.PER_SQM
                                                        ? (l.areaMode ??
                                                          AreaInputMode.DIMENSIONS)
                                                        : l.areaMode,
                                                    finishingStages: (
                                                      l.finishingStages ?? []
                                                    ).map((s) =>
                                                      s.id === stage.id
                                                        ? {
                                                            ...s,
                                                            pricingMode:
                                                              nextMode,
                                                          }
                                                        : s,
                                                    ),
                                                  }
                                                : l,
                                            ),
                                          );
                                        }}
                                      >
                                        <option value={VendorCostMode.PER_UNIT}>
                                          Theo {line.unit || 'tờ'} (1 đv)
                                        </option>
                                        <option value={VendorCostMode.PER_SQM}>
                                          Theo m²
                                        </option>
                                        <option
                                          value={VendorCostMode.TOTAL_BATCH}
                                        >
                                          Trọn lô
                                        </option>
                                      </select>
                                    </div>

                                    <div>
                                      <NumericDraftInput
                                        id={`pq-stage-rate-${idx}-${sIdx}`}
                                        dataTestId={`pq-stage-rate-${idx}-${sIdx}`}
                                        ariaLabel={`Giá gia công ${sIdx + 1} dòng ${idx + 1}`}
                                        allowDecimal={false}
                                        placeholder="Trống = Chờ giá, 0 = 0đ"
                                        style={{
                                          ...inputStyle,
                                          ...tabularNumStyle,
                                          minHeight: '38px',
                                          fontSize: '13px',
                                        }}
                                        value={stage.rateInput}
                                        onValueChange={(nextRaw) => {
                                          onMarkTouched?.();
                                          const parsed = parseNumericDraftValue(
                                            nextRaw,
                                            {
                                              allowDecimal: false,
                                              min: 0,
                                              integerOnly: true,
                                            },
                                          );
                                          setDraftLines((prev) =>
                                            prev.map((l, i) =>
                                              i === idx
                                                ? {
                                                    ...l,
                                                    finishingStages: (
                                                      l.finishingStages ?? []
                                                    ).map((s) => {
                                                      if (s.id !== stage.id) {
                                                        return s;
                                                      }
                                                      const nextVal =
                                                        parsed.isValid &&
                                                        parsed.value !== null
                                                          ? parsed.value
                                                          : s.rateValue;
                                                      const overridden =
                                                        s.priceItemId &&
                                                        s.catalogOriginalRate !==
                                                          null &&
                                                        s.catalogOriginalRate !==
                                                          undefined &&
                                                        parsed.isValid &&
                                                        parsed.value !==
                                                          s.catalogOriginalRate;
                                                      return {
                                                        ...s,
                                                        rateInput: nextRaw,
                                                        rateValue: nextVal,
                                                        costSource:
                                                          s.priceItemId
                                                            ? overridden
                                                              ? LineCostSource.CATALOG_OVERRIDDEN
                                                              : LineCostSource.CATALOG
                                                            : LineCostSource.MANUAL,
                                                      };
                                                    }),
                                                  }
                                                : l,
                                            ),
                                          );
                                        }}
                                      />
                                    </div>

                                    <div
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: '6px',
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: '12.5px',
                                          fontWeight: 700,
                                          color:
                                            stage.rateInput.trim() === ''
                                              ? 'var(--warning-text)'
                                              : 'var(--text-color)',
                                          ...tabularNumStyle,
                                        }}
                                      >
                                        {stage.rateInput.trim() === ''
                                          ? 'Chờ giá'
                                          : stageCostPreview !== null
                                            ? formatVnd(stageCostPreview)
                                            : '—'}
                                      </span>
                                      <button
                                        type="button"
                                        data-testid={`pq-remove-stage-${idx}-${sIdx}`}
                                        aria-label={`Xóa gia công ${stage.name || sIdx + 1}`}
                                        onClick={() =>
                                          handleRemoveFinishingStage(
                                            idx,
                                            stage.id,
                                          )
                                        }
                                        className="pq-btn pq-btn-danger-ghost pq-btn-sm"
                                        style={{
                                          minHeight: '36px',
                                          padding: '4px 8px',
                                        }}
                                      >
                                        <PqTrashIcon size={13} />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* 5) Two Clean Side-by-Side Internal Pricing Panels: Base/Total Cost & Profit */}
                        <div className="pq-pricing-pair-grid">
                          {/* Vendor Cost Soft Panel */}
                          <div className="pq-internal-subpanel">
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '6px',
                              }}
                              className="pq-internal-subpanel-title"
                            >
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                }}
                              >
                                <PqLockIcon size={13} />
                                <span>Giá vốn xưởng (Ẩn trên PDF)</span>
                              </span>
                              {rawCostInput.trim() === '' && (
                                <span
                                  style={{
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    color: 'var(--warning-text)',
                                  }}
                                >
                                  Chờ giá cơ bản
                                </span>
                              )}
                            </div>

                            <div className="pq-subpanel-stack">
                              <div>
                                <label
                                  htmlFor={`pq-line-cost-mode-${idx}`}
                                  style={labelStyle}
                                >
                                  Kiểu tính giá cơ bản
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
                                    if (nextMode === VendorCostMode.PER_SQM) {
                                      setOpenAreaPanelByLineId((prev) => ({
                                        ...prev,
                                        [line.id]: true,
                                      }));
                                    }
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
                                          baseCostSource: l.vendorPriceItemId
                                            ? selectedBaseCatalog &&
                                              nextMode ===
                                                selectedBaseCatalog.pricing_mode &&
                                              l.vendorCostValue ===
                                                l.baseCatalogOriginalRate
                                              ? LineCostSource.CATALOG
                                              : LineCostSource.CATALOG_OVERRIDDEN
                                            : LineCostSource.MANUAL,
                                          areaMode:
                                            nextMode === VendorCostMode.PER_SQM
                                              ? (l.areaMode ??
                                                AreaInputMode.DIMENSIONS)
                                              : l.areaMode,
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
                                  <option value={VendorCostMode.PER_SQM}>
                                    Theo m² (Diện tích)
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
                                      ? `Giá cơ bản / 1 ${line.unit || 'cái'} (đ)`
                                      : line.vendorCostMode ===
                                          VendorCostMode.PER_SQM
                                        ? 'Giá cơ bản / 1 m² (đ)'
                                        : 'Tổng giá cơ bản cả lô (đ)'}
                                </label>
                                <NumericDraftInput
                                  id={`pq-line-cost-val-${idx}`}
                                  ariaLabel={`Giá trị giá vốn dòng ${idx + 1}`}
                                  allowDecimal={costAllowDecimal}
                                  placeholder="Để trống = Chờ giá, 0 = miễn phí"
                                  style={{ ...inputStyle, ...tabularNumStyle }}
                                  invalid={Boolean(
                                    showValidationState &&
                                    lineErr?.vendorCost &&
                                    !canSaveAsPendingCostDraft,
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
                                      prev.map((l, i) => {
                                        if (i !== idx) return l;
                                        const nextCostSource =
                                          l.vendorPriceItemId
                                            ? parsed.isValid &&
                                              l.baseCatalogOriginalRate !==
                                                null &&
                                              l.baseCatalogOriginalRate !==
                                                undefined &&
                                              parsed.value !==
                                                l.baseCatalogOriginalRate
                                              ? LineCostSource.CATALOG_OVERRIDDEN
                                              : LineCostSource.CATALOG
                                            : LineCostSource.MANUAL;
                                        return {
                                          ...l,
                                          vendorCostInput: nextRaw,
                                          baseCostSource: nextCostSource,
                                          ...(parsed.isValid &&
                                          parsed.value !== null
                                            ? {
                                                vendorCostValue: parsed.value,
                                              }
                                            : {}),
                                        };
                                      }),
                                    );
                                  }}
                                />
                              </div>
                            </div>

                            {/* Strict TOTAL_BATCH Catalog Quantity Condition Guard */}
                            {lineErr?.costMode &&
                              !line.ambiguousLegacyCost &&
                              selectedBaseCatalog &&
                              line.vendorCostMode ===
                                VendorCostMode.TOTAL_BATCH && (
                                <div
                                  role="alert"
                                  data-testid={`pq-batch-mismatch-guard-${idx}`}
                                  style={{
                                    marginTop: '8px',
                                    padding: '8px 10px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--danger-text)',
                                    backgroundColor: 'var(--bg-color)',
                                    fontSize: '12px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                  }}
                                >
                                  <span style={{ color: 'var(--danger-text)' }}>
                                    {lineErr.costMode}
                                  </span>
                                  <div
                                    style={{
                                      display: 'flex',
                                      gap: '6px',
                                      flexWrap: 'wrap',
                                    }}
                                  >
                                    <button
                                      type="button"
                                      data-testid={`pq-batch-reset-qty-${idx}`}
                                      onClick={() => {
                                        const targetQty = Math.max(
                                          1,
                                          selectedBaseCatalog.batch_quantity ??
                                            1,
                                        );
                                        onMarkTouched?.();
                                        setDraftLines((prev) =>
                                          prev.map((l, i) =>
                                            i === idx
                                              ? {
                                                  ...l,
                                                  quantity: targetQty,
                                                  quantityInput:
                                                    String(targetQty),
                                                }
                                              : l,
                                          ),
                                        );
                                      }}
                                      className="pq-btn pq-btn-secondary pq-btn-sm"
                                    >
                                      Đặt SL ={' '}
                                      {selectedBaseCatalog.batch_quantity ?? 1}
                                    </button>
                                    <button
                                      type="button"
                                      data-testid={`pq-batch-confirm-override-${idx}`}
                                      onClick={() => {
                                        onMarkTouched?.();
                                        setDraftLines((prev) =>
                                          prev.map((l, i) =>
                                            i === idx
                                              ? {
                                                  ...l,
                                                  baseCostSource:
                                                    LineCostSource.CATALOG_OVERRIDDEN,
                                                }
                                              : l,
                                          ),
                                        );
                                      }}
                                      className="pq-btn pq-btn-accent pq-btn-sm"
                                    >
                                      Xác nhận dùng làm giá riêng báo giá này
                                    </button>
                                  </div>
                                </div>
                              )}

                            {/* One-off override indicator + explicit Save Back to Catalog action */}
                            {isCatalogPriceOverridden && (
                              <div
                                data-testid={`pq-override-notice-${idx}`}
                                style={{
                                  marginTop: '8px',
                                  padding: '8px 10px',
                                  borderRadius: '8px',
                                  backgroundColor: 'var(--bg-color)',
                                  border: '1px solid var(--border-color)',
                                  fontSize: '12px',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: '8px',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <span style={{ color: 'var(--muted-color)' }}>
                                  Giá sửa riêng trên báo giá (bảng giá gốc giữ
                                  nguyên{' '}
                                  {line.baseCatalogOriginalRate !== null &&
                                  line.baseCatalogOriginalRate !== undefined
                                    ? formatVnd(line.baseCatalogOriginalRate)
                                    : ''}
                                  ).
                                </span>
                                {onSaveOverrideBackToCatalog &&
                                  selectedBaseCatalog && (
                                    <button
                                      type="button"
                                      data-testid={`pq-save-override-to-catalog-${idx}`}
                                      onClick={() =>
                                        setOverrideConfirmState({
                                          lineIdx: idx,
                                          priceItemId: selectedBaseCatalog.id,
                                          priceItemName:
                                            selectedBaseCatalog.name,
                                          oldRate:
                                            line.baseCatalogOriginalRate ??
                                            null,
                                          newRate: line.vendorCostValue,
                                          pricingMode: line.vendorCostMode,
                                          unit: line.unit || 'tờ',
                                          specification: line.specification,
                                        })
                                      }
                                      className="pq-btn pq-btn-secondary pq-btn-sm"
                                    >
                                      Lưu vào bảng giá gốc…
                                    </button>
                                  )}
                              </div>
                            )}

                            {/* Aggregated Base + Finishing Vendor Cost Strip */}
                            {calcLine && stages.length > 0 && (
                              <div
                                data-testid={`pq-line-cost-breakdown-${idx}`}
                                style={{
                                  marginTop: '8px',
                                  padding: '7px 10px',
                                  borderRadius: '8px',
                                  backgroundColor: 'var(--bg-color)',
                                  border: '1px solid var(--border-color)',
                                  fontSize: '12px',
                                  ...tabularNumStyle,
                                }}
                              >
                                Vốn cơ bản:{' '}
                                <strong>
                                  {formatVnd(
                                    calcLine.baseVendorCost ??
                                      calcLine.totalVendorCost,
                                  )}
                                </strong>{' '}
                                + Gia công ({stages.length}):{' '}
                                <strong>
                                  {formatVnd(calcLine.finishingVendorCost ?? 0)}
                                </strong>{' '}
                                = Tổng vốn dòng:{' '}
                                <strong style={{ color: 'var(--accent-text)' }}>
                                  {formatVnd(calcLine.totalVendorCost)}
                                </strong>
                              </div>
                            )}

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
                                        const nextScope = e.target
                                          .value as ProfitScopeType;
                                        onMarkTouched?.();
                                        if (nextScope === ProfitScope.PER_SQM) {
                                          setOpenAreaPanelByLineId((prev) => ({
                                            ...prev,
                                            [line.id]: true,
                                          }));
                                        }
                                        setDraftLines((prev) =>
                                          prev.map((l, i) =>
                                            i === idx
                                              ? {
                                                  ...l,
                                                  profitScope: nextScope,
                                                  areaMode:
                                                    nextScope ===
                                                    ProfitScope.PER_SQM
                                                      ? (l.areaMode ??
                                                        AreaInputMode.DIMENSIONS)
                                                      : l.areaMode,
                                                }
                                              : l,
                                          ),
                                        );
                                      }}
                                    >
                                      <option value={ProfitScope.PER_UNIT}>
                                        Mỗi {line.unit || 'cái'}
                                      </option>
                                      <option value={ProfitScope.PER_SQM}>
                                        Theo m²
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
                                      : line.profitScope === ProfitScope.PER_SQM
                                        ? 'Lời / 1 m² (đ) *'
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
                                    showValidationState &&
                                    lineErr?.profit &&
                                    !canSaveAsPendingCostDraft,
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
                                {line.profitMode === ProfitMode.PERCENTAGE && (
                                  <div
                                    data-testid={`pq-profit-basis-note-${idx}`}
                                    style={{
                                      marginTop: '6px',
                                      fontSize: '12px',
                                      color: 'var(--muted-color)',
                                      lineHeight: 1.4,
                                    }}
                                  >
                                    Mẫu số %: tính trên Tổng vốn SP (In cơ bản +
                                    Gia công), không gồm phí giao hàng.
                                  </div>
                                )}
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
                              const hasAreaQty =
                                typeof item.displayAreaSqm === 'number' &&
                                Number.isFinite(item.displayAreaSqm) &&
                                item.displayAreaSqm > 0;
                              const areaDisclosure =
                                formatCustomerAreaDisclosure({
                                  actualAreaSqm: item.actualAreaSqm,
                                  billableAreaSqm: item.billableAreaSqm,
                                  customerAreaNote: item.customerAreaNote,
                                });
                              const priceDisplay =
                                formatCustomerLinePriceDisplay(
                                  item.lineTotal,
                                  item.quantity,
                                  rawUnit,
                                  item.displayAreaSqm,
                                );
                              return (
                                <tr key={item.id}>
                                  <td style={{ fontWeight: 600 }}>
                                    <div>{item.name}</div>
                                    {areaDisclosure ? (
                                      <div
                                        style={{
                                          fontSize: '12px',
                                          color: 'var(--accent-text)',
                                          fontWeight: 500,
                                        }}
                                      >
                                        {hasAreaQty && item.quantity > 1
                                          ? `${formatNumberVn(item.quantity)} tấm • `
                                          : ''}
                                        {areaDisclosure}
                                      </div>
                                    ) : hasAreaQty ? (
                                      <div
                                        style={{
                                          fontSize: '12px',
                                          color: 'var(--muted-color)',
                                          fontWeight: 400,
                                        }}
                                      >
                                        {item.quantity > 1
                                          ? `${formatNumberVn(item.quantity)} tấm • `
                                          : ''}
                                        {formatAreaSqmVn(item.displayAreaSqm)}{' '}
                                        m²
                                      </div>
                                    ) : null}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: 'right',
                                      ...tabularNumStyle,
                                    }}
                                  >
                                    {hasAreaQty
                                      ? `${formatAreaSqmVn(item.displayAreaSqm)} ${rawUnit}`
                                      : formatNumberVn(item.quantity)}
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
                                <div>
                                  {item.name} ({formatNumberVn(item.quantity)})
                                </div>
                                {(item.finishingStages?.length ?? 0) > 0 && (
                                  <div
                                    style={{
                                      fontSize: '12px',
                                      color: 'var(--muted-color)',
                                      fontWeight: 400,
                                    }}
                                  >
                                    Cơ bản{' '}
                                    {formatVnd(
                                      item.baseVendorCost ??
                                        item.totalVendorCost,
                                    )}{' '}
                                    + Gia công{' '}
                                    {formatVnd(item.finishingVendorCost ?? 0)}
                                  </div>
                                )}
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
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '6px',
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>Tổng thanh toán:</span>
                    <strong
                      style={{
                        color: 'var(--accent-text)',
                        fontSize: '14px',
                        ...tabularNumStyle,
                      }}
                    >
                      {formatVnd(
                        livePricingResult.customerPdf.grandTotalPayable,
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
            ) : canSaveAsPendingCostDraft ? (
              <div
                data-testid="pq-pending-cost-summary-card"
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  border: '1px solid #d97706',
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <strong style={{ fontSize: '14px' }}>
                    Bản nháp Chờ giá xưởng
                  </strong>
                  <StatusBadge status="warning" label="Chờ giá xưởng" />
                </div>
                <div
                  style={{
                    fontSize: '12.5px',
                    color: 'var(--muted-color)',
                    lineHeight: 1.5,
                  }}
                >
                  Có thể lưu nháp để chờ báo giá từ xưởng. Hệ thống không tự
                  tính tổng vốn, tiền lời hay xuất PDF gửi khách khi còn hạng
                  mục trống giá:
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: '18px',
                    fontSize: '12.5px',
                    lineHeight: 1.5,
                  }}
                >
                  {(livePricingResult.pendingSummary ?? []).map((item) => {
                    const missingParts: string[] = [];
                    if (item.missingBaseCost) missingParts.push('Giá cơ bản');
                    if (item.missingStageNames.length > 0) {
                      missingParts.push(
                        `Gia công (${item.missingStageNames.join(', ')})`,
                      );
                    }
                    return (
                      <li key={item.lineId}>
                        <strong>{item.lineName}:</strong> thiếu{' '}
                        {missingParts.join(' & ')}
                      </li>
                    );
                  })}
                </ul>
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
                  Chọn ấn phẩm từ <strong>Bảng giá xưởng</strong> hoặc điền đủ
                  thông số bên trái để xem tổng tiền & PDF A4:
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
                  <span className="pq-version-pill">2. Giá xưởng</span>
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

            {canSaveAsPendingCostDraft && (
              <button
                type="button"
                data-testid="pq-save-pending-draft-btn"
                disabled={savingQuote}
                onClick={onSavePendingDraftQuote || onSaveQuote}
                className="pq-btn pq-btn-accent pq-btn-lg"
                style={{ width: '100%' }}
              >
                <PqSaveIcon size={16} />
                <span>
                  {savingQuote ? 'Đang lưu nháp…' : 'Lưu nháp "Chờ giá xưởng"'}
                </span>
              </button>
            )}

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

      {/* Searchable Catalog Base Price Item Picker Dialog */}
      <CatalogModalDialog
        open={catalogPickerLineIdx !== null}
        title={`Chọn giá cơ bản từ Bảng giá Xưởng (Dòng #${(catalogPickerLineIdx ?? 0) + 1})`}
        subtitle="Tự động điền tên ấn phẩm, quy cách, giá cơ bản và lời mặc định."
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
              Không tìm thấy giá cơ bản phù hợp.
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
                      {item.vendor_name || 'Giá xưởng chung'}
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
                      {item.pricing_mode === VendorCostMode.TOTAL_BATCH
                        ? `${formatVnd(item.batch_total_cost)} / lô`
                        : item.pricing_mode === VendorCostMode.PER_SQM
                          ? `${formatVnd(item.unit_cost)} / m²`
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

      {/* Explicit Confirmation Dialog to Save Overridden Quote Price Back to Catalog */}
      <CatalogModalDialog
        open={overrideConfirmState !== null}
        title="Lưu giá mới vào Bảng giá xưởng?"
        subtitle="Các báo giá đã lưu trước đây vẫn giữ nguyên lịch sử giá cũ (bất biến)."
        testId="pq-confirm-save-override-dialog"
        maxWidth="460px"
        onClose={() => setOverrideConfirmState(null)}
      >
        {overrideConfirmState && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                fontSize: '13px',
                lineHeight: 1.55,
              }}
            >
              <div>
                Hạng mục: <strong>{overrideConfirmState.priceItemName}</strong>
              </div>
              {overrideConfirmState.oldRate !== null && (
                <div>
                  Giá gốc hiện tại:{' '}
                  <strong>{formatVnd(overrideConfirmState.oldRate)}</strong>
                </div>
              )}
              <div>
                Giá mới cập nhật:{' '}
                <strong style={{ color: 'var(--accent-text)' }}>
                  {formatVnd(overrideConfirmState.newRate)}
                </strong>{' '}
                (
                {overrideConfirmState.pricingMode === VendorCostMode.TOTAL_BATCH
                  ? 'trọn lô'
                  : overrideConfirmState.pricingMode === VendorCostMode.PER_SQM
                    ? 'theo m²'
                    : `theo ${overrideConfirmState.unit}`}
                )
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={() => setOverrideConfirmState(null)}
                className="pq-btn pq-btn-secondary"
              >
                Chỉ dùng cho báo giá này
              </button>
              <button
                type="button"
                data-testid="pq-confirm-save-override-submit"
                disabled={savingOverrideToCatalog}
                onClick={() => {
                  void handleConfirmSaveOverrideToCatalog();
                }}
                className="pq-btn pq-btn-primary"
              >
                <PqCheckIcon size={15} />
                <span>
                  {savingOverrideToCatalog
                    ? 'Đang cập nhật…'
                    : 'Xác nhận cập nhật Bảng giá'}
                </span>
              </button>
            </div>
          </div>
        )}
      </CatalogModalDialog>
    </div>
  );
};
