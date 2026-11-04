import {
  AreaInputMode,
  assertCustomerSafePdfPayload,
  computeExactAreaSqm,
  evaluateCatalogBatchQuantityCondition,
  MAX_PRINTQUOTE_PERCENT,
  MAX_PRINTQUOTE_QUANTITY,
  MAX_PRINTQUOTE_RATE_VND,
  normalizeAreaSqm,
  normalizeStageKey,
  ProfitMode,
  ProfitScope,
  VendorCostMode,
  type AreaInputModeType,
  type LineCostSourceType,
  type PendingCostLineSummary,
  type PrintVendorPriceItemData,
  type ProfitModeType,
  type ProfitScopeType,
  type QuoteAreaSpec,
  type VendorCostModeType,
  type CustomerSafePdfPayload,
  type QuoteOrderStatusType,
  type PrintProductionStatusType,
  type PrintDeliveryStatusType,
  type PrintPaymentStatusType,
} from '../../../../../packages/contracts/src/printquote.js';

/**
 * Sanitizes raw text entered/pasted into a numeric draft input WITHOUT forcing
 * empty strings to "0" or "1" and WITHOUT stripping leading zeros mid-typing
 * (so cursor offsets never jump while editing digits in the middle of a number).
 */
export function sanitizeNumericDraftInput(
  raw: string | null | undefined,
  allowDecimal = false,
): string {
  if (raw === null || raw === undefined || raw === '') return '';
  const str = String(raw);
  if (!allowDecimal) {
    return str.replace(/[^0-9]/g, '');
  }
  const normalizedSep = str.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const dotIdx = normalizedSep.indexOf('.');
  if (dotIdx === -1) return normalizedSep;
  const beforeDot = normalizedSep.slice(0, dotIdx);
  const afterDot = normalizedSep.slice(dotIdx + 1).replace(/\./g, '');
  return `${beforeDot}.${afterDot}`;
}

/**
 * Normalizes a numeric draft string AFTER completion (onBlur / before save):
 * - Preserves empty string "" as "" (never turns unentered fields into "0" or "1").
 * - Normalizes "05000" -> "5000", "0500" -> "500", "000" -> "0", "0" -> "0".
 * - In decimal mode: "012,50" -> "12.5", ".5" -> "0.5", "50." -> "50".
 */
export function normalizeNumericDraftOnBlur(
  raw: string | null | undefined,
  allowDecimal = false,
): string {
  const sanitized = sanitizeNumericDraftInput(raw, allowDecimal);
  if (sanitized === '' || sanitized === '.') return '';

  if (!allowDecimal) {
    return sanitized.replace(/^0+(?=\d)/, '');
  }

  const withLeadingZero = sanitized.startsWith('.')
    ? `0${sanitized}`
    : sanitized;
  const [rawInt = '0', rawDec] = withLeadingZero.split('.');
  const cleanInt = (rawInt || '0').replace(/^0+(?=\d)/, '');
  if (rawDec === undefined) return cleanInt;
  const cleanDec = rawDec.replace(/0+$/, '');
  return cleanDec.length > 0 ? `${cleanInt}.${cleanDec}` : cleanInt;
}

export interface ParsedDraftNumberResult {
  isEmpty: boolean;
  isValid: boolean;
  value: number | null;
}

export function parseNumericDraftValue(
  raw: string | null | undefined,
  options: { allowDecimal?: boolean; min?: number; integerOnly?: boolean } = {},
): ParsedDraftNumberResult {
  const allowDecimal = Boolean(options.allowDecimal);
  const min = options.min ?? 0;
  const integerOnly = options.integerOnly ?? !allowDecimal;

  const trimmed = raw === null || raw === undefined ? '' : String(raw).trim();
  if (trimmed === '') {
    return { isEmpty: true, isValid: false, value: null };
  }

  const normalized = normalizeNumericDraftOnBlur(trimmed, allowDecimal);
  if (normalized === '') {
    return { isEmpty: false, isValid: false, value: null };
  }

  const num = Number(normalized);
  if (!Number.isFinite(num) || num < min) {
    return { isEmpty: false, isValid: false, value: null };
  }
  if (integerOnly && !Number.isInteger(num)) {
    return { isEmpty: false, isValid: false, value: null };
  }
  return { isEmpty: false, isValid: true, value: num };
}

export interface AmbiguousLegacyCostState {
  originalQuantity: number;
  unitVendorCost: number;
  totalVendorCost: number;
}

export interface SavedQuoteLineForEdit {
  quantity: number;
  unitVendorCost: number;
  totalVendorCost: number;
  vendorCostMode?: VendorCostModeType | undefined;
  baseCostRate?: number | null | undefined;
  baseCostPending?: boolean | undefined;
  isPendingCost?: boolean | undefined;
}

export interface ResolvedSavedLineCostState {
  vendorCostMode: VendorCostModeType;
  vendorCostValue: number;
  vendorCostInput: string;
  ambiguousLegacyCost: AmbiguousLegacyCostState | null;
}

/**
 * Resolves the vendor cost mode and input value when loading a saved quote for editing,
 * strictly WITHOUT guessing when legacy persisted data is ambiguous:
 * 1. Explicit `baseCostPending` / `baseCostRate === null` -> empty pending cost input ("").
 * 2. Explicit `baseCostRate` number -> deterministic rate.
 * 3. Explicit `vendorCostMode` ('TOTAL_BATCH' | 'PER_UNIT' | 'PER_SQM') -> deterministic.
 * 4. Legacy row without `vendorCostMode`:
 *    - Both costs === 0 -> deterministic 0.
 *    - `unitVendorCost` deviates from `totalVendorCost / quantity` -> deterministic PER_UNIT.
 *    - `unitVendorCost` has repeating decimals (> 4 decimal places) -> deterministic TOTAL_BATCH.
 *    - Otherwise (e.g. 30.000đ / 100 tờ where unitVendorCost = 300) -> marks `ambiguousLegacyCost`
 *      so changing quantity refuses to guess until the user explicitly confirms PER_UNIT vs TOTAL_BATCH.
 */
export function resolveSavedQuoteLineCostState(
  item: SavedQuoteLineForEdit,
): ResolvedSavedLineCostState {
  if (item.baseCostPending === true || item.baseCostRate === null) {
    return {
      vendorCostMode: item.vendorCostMode ?? VendorCostMode.PER_UNIT,
      vendorCostValue: 0,
      vendorCostInput: '',
      ambiguousLegacyCost: null,
    };
  }
  if (
    typeof item.baseCostRate === 'number' &&
    Number.isFinite(item.baseCostRate)
  ) {
    return {
      vendorCostMode: item.vendorCostMode ?? VendorCostMode.PER_UNIT,
      vendorCostValue: item.baseCostRate,
      vendorCostInput: String(item.baseCostRate),
      ambiguousLegacyCost: null,
    };
  }
  if (item.vendorCostMode === VendorCostMode.TOTAL_BATCH) {
    return {
      vendorCostMode: VendorCostMode.TOTAL_BATCH,
      vendorCostValue: item.totalVendorCost,
      vendorCostInput: String(item.totalVendorCost),
      ambiguousLegacyCost: null,
    };
  }
  if (item.vendorCostMode === VendorCostMode.PER_SQM) {
    return {
      vendorCostMode: VendorCostMode.PER_SQM,
      vendorCostValue: item.unitVendorCost,
      vendorCostInput: String(item.unitVendorCost),
      ambiguousLegacyCost: null,
    };
  }
  if (item.vendorCostMode === VendorCostMode.PER_UNIT) {
    return {
      vendorCostMode: VendorCostMode.PER_UNIT,
      vendorCostValue: item.unitVendorCost,
      vendorCostInput: String(item.unitVendorCost),
      ambiguousLegacyCost: null,
    };
  }

  if (item.totalVendorCost === 0 && item.unitVendorCost === 0) {
    return {
      vendorCostMode: VendorCostMode.PER_UNIT,
      vendorCostValue: 0,
      vendorCostInput: '0',
      ambiguousLegacyCost: null,
    };
  }

  if (
    item.quantity > 0 &&
    Math.abs(item.unitVendorCost - item.totalVendorCost / item.quantity) > 1e-6
  ) {
    return {
      vendorCostMode: VendorCostMode.PER_UNIT,
      vendorCostValue: item.unitVendorCost,
      vendorCostInput: String(item.unitVendorCost),
      ambiguousLegacyCost: null,
    };
  }

  if (
    Math.abs(
      Math.round(item.unitVendorCost * 10000) - item.unitVendorCost * 10000,
    ) > 1e-6
  ) {
    return {
      vendorCostMode: VendorCostMode.TOTAL_BATCH,
      vendorCostValue: item.totalVendorCost,
      vendorCostInput: String(item.totalVendorCost),
      ambiguousLegacyCost: null,
    };
  }

  return {
    vendorCostMode: VendorCostMode.TOTAL_BATCH,
    vendorCostValue: item.totalVendorCost,
    vendorCostInput: String(item.totalVendorCost),
    ambiguousLegacyCost: {
      originalQuantity: item.quantity,
      unitVendorCost: item.unitVendorCost,
      totalVendorCost: item.totalVendorCost,
    },
  };
}

export interface ValidatableFinishingStage {
  id: string;
  priceItemId?: string | undefined;
  code?: string | null | undefined;
  name: string;
  pricingMode: VendorCostModeType;
  rateValue: number;
  rateInput: string;
  unit?: string | undefined;
  costSource?: LineCostSourceType | undefined;
  note?: string | null | undefined;
}

export interface ValidatableDraftLine {
  id: string;
  vendorPriceItemId?: string | undefined;
  baseCostSource?: LineCostSourceType | undefined;
  name: string;
  specification?: string | undefined;
  unit: string;
  quantity: number;
  quantityInput?: string | undefined;
  vendorCostMode: VendorCostModeType;
  vendorCostValue: number;
  vendorCostInput?: string | undefined;
  areaMode?: AreaInputModeType | undefined;
  widthMInput?: string | undefined;
  heightMInput?: string | undefined;
  sheetsCountInput?: string | undefined;
  actualAreaInput?: string | undefined;
  billableAreaInput?: string | undefined;
  adjustBillableArea?: boolean | undefined;
  areaAdjustmentReason?: string | undefined;
  finishingStages?: readonly ValidatableFinishingStage[] | undefined;
  ambiguousLegacyCost?: AmbiguousLegacyCostState | null | undefined;
  profitMode: ProfitModeType;
  profitScope: ProfitScopeType;
  profitValue: number;
  profitInput?: string | undefined;
}

export interface ValidatedFinishingStageNumbers {
  id: string;
  rate: number | null;
}

export interface ValidatedQuoteLineNumbers {
  quantity: number;
  vendorCostValue: number;
  baseCostRate: number | null;
  profitValue: number;
  areaSpec: QuoteAreaSpec | null;
  stages: ValidatedFinishingStageNumbers[];
}

export interface DraftLineValidationError {
  quantity?: string | undefined;
  vendorCost?: string | undefined;
  costMode?: string | undefined;
  area?: string | undefined;
  stages?: string | undefined;
  profit?: string | undefined;
}

export interface QuoteDraftValidationResult {
  isValid: boolean;
  canSavePendingDraft: boolean;
  isPendingCost: boolean;
  pendingSummary: PendingCostLineSummary[];
  structuralErrors: string[];
  errors: string[];
  lineErrors: Record<string, DraftLineValidationError>;
  shippingError: string | null;
  shippingFee: number;
  lines: ValidatedQuoteLineNumbers[];
}

/**
 * Strictly validates all required numeric inputs in CreateQuoteTab so that:
 * - Empty ("") fields are distinguished from explicit "0".
 * - Complete quotes (`isValid === true`) require every base & stage cost and profit to be valid numbers.
 * - Incomplete vendor cost drafts (`canSavePendingDraft === true && isPendingCost === true`) allow
 *   saving a "Chờ giá xưởng" (`PENDING_COST`) draft when structural fields (quantity >= 1, valid m²
 *   dimensions if PER_SQM, non-duplicate stage names) are valid while at least one base/stage cost is empty.
 */
export function validateQuoteDraftInputs(
  draftLines: ValidatableDraftLine[],
  shippingFeeInput?: string | number | null,
  catalogPriceItems?: readonly PrintVendorPriceItemData[],
): QuoteDraftValidationResult {
  const errors: string[] = [];
  const structuralErrors: string[] = [];
  const pendingSummary: PendingCostLineSummary[] = [];
  const lineErrors: QuoteDraftValidationResult['lineErrors'] = {};
  const validatedLines: ValidatedQuoteLineNumbers[] = [];
  const catalogById = new Map<string, PrintVendorPriceItemData>();
  if (catalogPriceItems) {
    for (const item of catalogPriceItems) {
      catalogById.set(item.id, item);
    }
  }

  if (!draftLines || draftLines.length === 0) {
    const emptyMsg = 'Cần ít nhất 1 sản phẩm đặt in trong báo giá.';
    errors.push(emptyMsg);
    structuralErrors.push(emptyMsg);
  }

  draftLines.forEach((line, idx) => {
    const labelPrefix = `Sản phẩm #${idx + 1}`;
    const lineDisplayName = line.name?.trim() || labelPrefix;
    const currentLineErr: DraftLineValidationError = {};

    const rawQty =
      line.quantityInput !== undefined
        ? line.quantityInput
        : String(line.quantity);
    const qtyRes = parseNumericDraftValue(rawQty, {
      allowDecimal: false,
      min: 1,
      integerOnly: true,
    });
    if (!qtyRes.isValid || qtyRes.value === null) {
      const msg = qtyRes.isEmpty
        ? `${labelPrefix}: Chưa nhập Số lượng.`
        : `${labelPrefix}: Số lượng phải từ 1 trở lên.`;
      currentLineErr.quantity = msg;
      errors.push(msg);
      structuralErrors.push(msg);
    } else if (qtyRes.value > MAX_PRINTQUOTE_QUANTITY) {
      const msg = `${labelPrefix}: Số lượng vượt giới hạn cho phép (${MAX_PRINTQUOTE_QUANTITY.toLocaleString('vi-VN')}).`;
      currentLineErr.quantity = msg;
      errors.push(msg);
      structuralErrors.push(msg);
    } else if (
      line.ambiguousLegacyCost &&
      qtyRes.value !== line.ambiguousLegacyCost.originalQuantity
    ) {
      const unitLabel = line.unit?.trim() || 'sp';
      const msg = `${labelPrefix}: Báo giá cũ chưa lưu rõ kiểu giá vốn — vui lòng chọn xác nhận 'Từng ${unitLabel}' hoặc 'Trọn lô' khi đổi số lượng.`;
      currentLineErr.costMode = msg;
      errors.push(msg);
      structuralErrors.push(msg);
    } else if (
      line.vendorPriceItemId &&
      line.vendorPriceItemId.trim() !== '' &&
      (line.baseCostSource ?? 'CATALOG') === 'CATALOG' &&
      line.vendorCostMode === VendorCostMode.TOTAL_BATCH
    ) {
      const catItem = catalogById.get(line.vendorPriceItemId.trim());
      if (catItem) {
        const batchCheck = evaluateCatalogBatchQuantityCondition({
          itemName: catItem.name,
          itemCode: catItem.code,
          itemType: catItem.item_type,
          pricingMode: catItem.pricing_mode,
          batchQuantity: catItem.batch_quantity,
          structuredSpec: catItem.structured_spec,
          costSource: line.baseCostSource,
          lineQuantity: qtyRes.value,
          unit: line.unit || catItem.unit,
        });
        if (!batchCheck.allowed && batchCheck.reason) {
          const msg = `${labelPrefix}: ${batchCheck.reason}`;
          currentLineErr.costMode = msg;
          errors.push(msg);
          structuralErrors.push(msg);
        }
      }
    }

    // Area (m²) validation when PER_SQM is used or explicit m² inputs are filled
    const stages = line.finishingStages ?? [];
    const usesPerSqm =
      line.vendorCostMode === VendorCostMode.PER_SQM ||
      (line.profitMode === ProfitMode.FIXED_AMOUNT &&
        line.profitScope === ProfitScope.PER_SQM) ||
      stages.some((s) => s.pricingMode === VendorCostMode.PER_SQM);
    const hasAreaInputs = Boolean(
      (line.widthMInput && line.widthMInput.trim() !== '') ||
      (line.heightMInput && line.heightMInput.trim() !== '') ||
      (line.actualAreaInput && line.actualAreaInput.trim() !== ''),
    );

    let resolvedArea: QuoteAreaSpec | null = null;
    if (usesPerSqm || hasAreaInputs) {
      const mode = line.areaMode ?? AreaInputMode.DIMENSIONS;
      if (mode === AreaInputMode.DIRECT_AREA) {
        const directRes = parseNumericDraftValue(line.actualAreaInput ?? '', {
          allowDecimal: true,
          min: 0.0001,
          integerOnly: false,
        });
        if (!directRes.isValid || directRes.value === null) {
          const msg = directRes.isEmpty
            ? `${labelPrefix}: Chưa nhập Tổng diện tích (m²).`
            : `${labelPrefix}: Tổng diện tích (m²) phải lớn hơn 0.`;
          currentLineErr.area = msg;
          errors.push(msg);
          structuralErrors.push(msg);
        } else {
          try {
            const actualSqm = normalizeAreaSqm(directRes.value);
            let billableSqm = actualSqm;
            if (
              line.adjustBillableArea &&
              line.billableAreaInput &&
              line.billableAreaInput.trim() !== ''
            ) {
              const billRes = parseNumericDraftValue(line.billableAreaInput, {
                allowDecimal: true,
                min: 0.0001,
                integerOnly: false,
              });
              if (!billRes.isValid || billRes.value === null) {
                throw new Error(
                  `${labelPrefix}: Diện tích tính tiền (m²) không hợp lệ.`,
                );
              }
              billableSqm = normalizeAreaSqm(billRes.value);
            }
            resolvedArea = {
              mode: AreaInputMode.DIRECT_AREA,
              widthM: null,
              heightM: null,
              sheetsCount: qtyRes.value ?? 1,
              actualAreaSqm: actualSqm,
              billableAreaSqm: billableSqm,
            };
          } catch (areaErr) {
            const msg =
              areaErr instanceof Error
                ? areaErr.message
                : `${labelPrefix}: Diện tích (m²) không hợp lệ.`;
            currentLineErr.area = msg;
            errors.push(msg);
            structuralErrors.push(msg);
          }
        }
      } else {
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
            : String(qtyRes.value ?? 1);
        const sheetsRes = parseNumericDraftValue(rawSheets, {
          allowDecimal: false,
          min: 1,
          integerOnly: true,
        });

        if (!wRes.isValid || wRes.value === null) {
          const msg = wRes.isEmpty
            ? `${labelPrefix}: Chưa nhập Chiều ngang (m).`
            : `${labelPrefix}: Chiều ngang (m) phải lớn hơn 0.`;
          currentLineErr.area = msg;
          errors.push(msg);
          structuralErrors.push(msg);
        } else if (!hRes.isValid || hRes.value === null) {
          const msg = hRes.isEmpty
            ? `${labelPrefix}: Chưa nhập Chiều cao (m).`
            : `${labelPrefix}: Chiều cao (m) phải lớn hơn 0.`;
          currentLineErr.area = msg;
          errors.push(msg);
          structuralErrors.push(msg);
        } else if (!sheetsRes.isValid || sheetsRes.value === null) {
          const msg = `${labelPrefix}: Số tấm tính m² phải từ 1 trở lên.`;
          currentLineErr.area = msg;
          errors.push(msg);
          structuralErrors.push(msg);
        } else {
          try {
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
                min: 0.0001,
                integerOnly: false,
              });
              if (!billRes.isValid || billRes.value === null) {
                throw new Error(
                  `${labelPrefix}: Diện tích tính tiền (m²) không hợp lệ.`,
                );
              }
              billableSqm = normalizeAreaSqm(billRes.value);
            }
            resolvedArea = {
              mode: AreaInputMode.DIMENSIONS,
              widthM: Math.round(wRes.value * 10_000) / 10_000,
              heightM: Math.round(hRes.value * 10_000) / 10_000,
              sheetsCount: sheetsRes.value,
              actualAreaSqm: actualSqm,
              billableAreaSqm: billableSqm,
            };
          } catch (areaErr) {
            const msg =
              areaErr instanceof Error
                ? areaErr.message
                : `${labelPrefix}: Kích thước tính m² không hợp lệ.`;
            currentLineErr.area = msg;
            errors.push(msg);
            structuralErrors.push(msg);
          }
        }
      }
      if (resolvedArea) {
        const trimmedReason = line.areaAdjustmentReason?.trim() ?? '';
        if (
          Math.abs(resolvedArea.billableAreaSqm - resolvedArea.actualAreaSqm) >
          1e-9
        ) {
          if (!trimmedReason) {
            const msg = `${labelPrefix}: Khi sửa Diện tích tính tiền khác Diện tích thực tế, bắt buộc nhập lý do điều chỉnh.`;
            currentLineErr.area = msg;
            errors.push(msg);
            structuralErrors.push(msg);
          } else {
            resolvedArea.adjustmentReason = trimmedReason;
          }
        } else if (trimmedReason) {
          resolvedArea.adjustmentReason = trimmedReason;
        }
      }
    }

    // Base vendor cost validation ("" = pending cost vs "0" = 0đ explicit)
    const rawCost =
      line.vendorCostInput !== undefined
        ? line.vendorCostInput
        : String(line.vendorCostValue);
    const costAllowDecimal = !Number.isInteger(line.vendorCostValue);
    const costRes = parseNumericDraftValue(rawCost, {
      allowDecimal: costAllowDecimal,
      min: 0,
      integerOnly: !costAllowDecimal,
    });
    let missingBaseCost = false;
    if (!costRes.isValid || costRes.value === null) {
      if (costRes.isEmpty) {
        missingBaseCost = true;
        const msg = `${labelPrefix}: Chưa nhập Giá nhà in (nhập 0 nếu miễn phí).`;
        currentLineErr.vendorCost = msg;
        errors.push(msg);
      } else {
        const msg = `${labelPrefix}: Giá nhà in không hợp lệ.`;
        currentLineErr.vendorCost = msg;
        errors.push(msg);
        structuralErrors.push(msg);
      }
    } else if (costRes.value > MAX_PRINTQUOTE_RATE_VND) {
      const msg = `${labelPrefix}: Giá nhà in vượt giới hạn cho phép.`;
      currentLineErr.vendorCost = msg;
      errors.push(msg);
      structuralErrors.push(msg);
    }

    // Finishing stages validation (0..N stages, duplicate check, "" = pending stage cost)
    const missingStageNames: string[] = [];
    const validatedStageNums: ValidatedFinishingStageNumbers[] = [];
    const seenStageIds = new Set<string>();
    const seenStageKeys = new Set<string>();

    stages.forEach((stg, sIdx) => {
      const sName = String(stg.name || '').trim();
      if (!sName) {
        const msg = `${labelPrefix}: Công đoạn gia công #${sIdx + 1} chưa nhập tên.`;
        if (!currentLineErr.stages) currentLineErr.stages = msg;
        errors.push(msg);
        structuralErrors.push(msg);
        validatedStageNums.push({ id: stg.id, rate: null });
        return;
      }
      if (stg.priceItemId && stg.priceItemId.trim() !== '') {
        if (seenStageIds.has(stg.priceItemId.trim())) {
          const msg = `${labelPrefix}: Công đoạn "${sName}" bị chọn trùng trên cùng sản phẩm.`;
          if (!currentLineErr.stages) currentLineErr.stages = msg;
          errors.push(msg);
          structuralErrors.push(msg);
        }
        seenStageIds.add(stg.priceItemId.trim());
        if (
          qtyRes.isValid &&
          qtyRes.value !== null &&
          (stg.costSource ?? 'CATALOG') === 'CATALOG' &&
          stg.pricingMode === VendorCostMode.TOTAL_BATCH
        ) {
          const stgCatItem = catalogById.get(stg.priceItemId.trim());
          if (stgCatItem) {
            const stgBatchCheck = evaluateCatalogBatchQuantityCondition({
              itemName: stgCatItem.name,
              itemCode: stgCatItem.code,
              itemType: stgCatItem.item_type,
              pricingMode: stgCatItem.pricing_mode,
              batchQuantity: stgCatItem.batch_quantity,
              structuredSpec: stgCatItem.structured_spec,
              costSource: stg.costSource,
              lineQuantity: qtyRes.value,
              unit: stg.unit || stgCatItem.unit,
            });
            if (!stgBatchCheck.allowed && stgBatchCheck.reason) {
              const msg = `${labelPrefix}: ${stgBatchCheck.reason}`;
              if (!currentLineErr.stages) currentLineErr.stages = msg;
              errors.push(msg);
              structuralErrors.push(msg);
            }
          }
        }
      }
      const normKey = normalizeStageKey(sName);
      if (normKey) {
        if (seenStageKeys.has(normKey)) {
          const msg = `${labelPrefix}: Công đoạn "${sName}" bị nhập trùng trên cùng sản phẩm.`;
          if (!currentLineErr.stages) currentLineErr.stages = msg;
          errors.push(msg);
          structuralErrors.push(msg);
        }
        seenStageKeys.add(normKey);
      }

      const stgAllowDec = !Number.isInteger(stg.rateValue);
      const stgRes = parseNumericDraftValue(stg.rateInput ?? '', {
        allowDecimal: stgAllowDec,
        min: 0,
        integerOnly: !stgAllowDec,
      });
      if (!stgRes.isValid || stgRes.value === null) {
        if (stgRes.isEmpty) {
          missingStageNames.push(sName);
          const msg = `${labelPrefix}: Công đoạn "${sName}" đang để trống giá (Chờ giá xưởng).`;
          if (!currentLineErr.stages) currentLineErr.stages = msg;
          errors.push(msg);
          validatedStageNums.push({ id: stg.id, rate: null });
        } else {
          const msg = `${labelPrefix}: Giá công đoạn "${sName}" không hợp lệ.`;
          if (!currentLineErr.stages) currentLineErr.stages = msg;
          errors.push(msg);
          structuralErrors.push(msg);
          validatedStageNums.push({ id: stg.id, rate: null });
        }
      } else if (stgRes.value > MAX_PRINTQUOTE_RATE_VND) {
        const msg = `${labelPrefix}: Giá công đoạn "${sName}" vượt giới hạn cho phép.`;
        if (!currentLineErr.stages) currentLineErr.stages = msg;
        errors.push(msg);
        structuralErrors.push(msg);
        validatedStageNums.push({ id: stg.id, rate: null });
      } else {
        validatedStageNums.push({ id: stg.id, rate: stgRes.value });
      }
    });

    if (missingBaseCost || missingStageNames.length > 0) {
      pendingSummary.push({
        lineId: line.id,
        lineName: lineDisplayName,
        missingBaseCost,
        missingStageNames,
      });
    }

    const rawProfit =
      line.profitInput !== undefined
        ? line.profitInput
        : String(line.profitValue);
    const profitAllowDecimal = line.profitMode === ProfitMode.PERCENTAGE;
    const profitRes = parseNumericDraftValue(rawProfit, {
      allowDecimal: profitAllowDecimal,
      min: 0,
      integerOnly: !profitAllowDecimal,
    });
    if (!profitRes.isValid || profitRes.value === null) {
      if (profitRes.isEmpty) {
        const msg = `${labelPrefix}: Chưa nhập Tiền lời (nhập 0 nếu không tính lời).`;
        currentLineErr.profit = msg;
        errors.push(msg);
      } else {
        const msg = `${labelPrefix}: Tiền lời không hợp lệ.`;
        currentLineErr.profit = msg;
        errors.push(msg);
        structuralErrors.push(msg);
      }
    } else if (
      line.profitMode === ProfitMode.PERCENTAGE &&
      profitRes.value > MAX_PRINTQUOTE_PERCENT
    ) {
      const msg = `${labelPrefix}: Phần trăm lợi nhuận vượt giới hạn (${MAX_PRINTQUOTE_PERCENT}%).`;
      currentLineErr.profit = msg;
      errors.push(msg);
      structuralErrors.push(msg);
    } else if (
      line.profitMode !== ProfitMode.PERCENTAGE &&
      profitRes.value > MAX_PRINTQUOTE_RATE_VND
    ) {
      const msg = `${labelPrefix}: Tiền lời vượt giới hạn cho phép.`;
      currentLineErr.profit = msg;
      errors.push(msg);
      structuralErrors.push(msg);
    }

    if (
      currentLineErr.quantity ||
      currentLineErr.vendorCost ||
      currentLineErr.costMode ||
      currentLineErr.area ||
      currentLineErr.stages ||
      currentLineErr.profit
    ) {
      lineErrors[line.id] = currentLineErr;
    }

    validatedLines.push({
      quantity: qtyRes.value ?? 0,
      vendorCostValue: costRes.value ?? 0,
      baseCostRate: missingBaseCost ? null : (costRes.value ?? 0),
      profitValue: profitRes.value ?? 0,
      areaSpec: resolvedArea,
      stages: validatedStageNums,
    });
  });

  const rawShip =
    shippingFeeInput === undefined || shippingFeeInput === null
      ? '0'
      : String(shippingFeeInput);
  const shipRes = parseNumericDraftValue(rawShip, {
    allowDecimal: false,
    min: 0,
    integerOnly: true,
  });
  let shippingError: string | null = null;
  if (!shipRes.isValid || shipRes.value === null) {
    shippingError = shipRes.isEmpty
      ? 'Chưa nhập Phí giao hàng toàn đơn (nhập 0 nếu miễn phí giao hàng).'
      : 'Phí giao hàng không hợp lệ.';
    errors.push(shippingError);
    structuralErrors.push(shippingError);
  } else if (shipRes.value > MAX_PRINTQUOTE_RATE_VND) {
    shippingError = 'Phí giao hàng vượt giới hạn cho phép.';
    errors.push(shippingError);
    structuralErrors.push(shippingError);
  }

  const isPendingCost = pendingSummary.length > 0;
  const canSavePendingDraft = isPendingCost && structuralErrors.length === 0;

  return {
    isValid: errors.length === 0,
    canSavePendingDraft,
    isPendingCost,
    pendingSummary,
    structuralErrors,
    errors,
    lineErrors,
    shippingError,
    shippingFee: shipRes.value ?? 0,
    lines: validatedLines,
  };
}

export function formatAreaSqmVn(area: number | null | undefined): string {
  const safe = typeof area === 'number' && Number.isFinite(area) ? area : 0;
  const rounded4 = Math.round(safe * 10_000) / 10_000;
  return rounded4.toLocaleString('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function formatVnd(amount: number | null | undefined): string {
  const safe =
    typeof amount === 'number' && Number.isFinite(amount)
      ? Math.round(amount)
      : 0;
  return `${safe.toLocaleString('vi-VN')} ₫`;
}

export function formatExactVnd(amount: number | null | undefined): string {
  const safe =
    typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const rounded2 = Math.round(safe * 100) / 100;
  return `${rounded2.toLocaleString('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ₫`;
}

export interface CustomerLinePriceDisplay {
  unitPriceDisplay: string;
  priceSubNote: string | null;
  isExact: boolean;
}

/**
 * Formats unit price on customer-facing A4 PDF and Customer Summary view so that:
 * 1. Exact integer unit price (e.g. 100.000 ÷ 100 = 1.000 ₫ or 144.000 ÷ 2,88m² = 50.000 ₫) -> exact VND
 * 2. Exact finite 2-decimal unit price (e.g. 76.316 ÷ 100 = 763,16 ₫) -> "763,16 ₫"
 * 3. Non-terminating decimal unit price -> "~..." + "Tính trọn gói ..."
 * Never exposes technical accounting jargon like "Hiệu chỉnh làm tròn" to customers.
 */
export function formatCustomerLinePriceDisplay(
  lineTotal: number,
  quantity: number,
  unitLabel?: string | null,
  displayAreaSqm?: number | null,
): CustomerLinePriceDisplay {
  const total = Math.round(lineTotal || 0);
  const unit = (unitLabel || 'sp').trim() || 'sp';

  if (
    typeof displayAreaSqm === 'number' &&
    Number.isFinite(displayAreaSqm) &&
    displayAreaSqm > 0
  ) {
    const areaMicro = Math.round(displayAreaSqm * 1_000_000);
    if (areaMicro > 0) {
      const totalBig = BigInt(total);
      const areaBig = BigInt(areaMicro);
      if ((totalBig * 1_000_000n) % areaBig === 0n) {
        const exactRate = Number((totalBig * 1_000_000n) / areaBig);
        return {
          unitPriceDisplay: formatVnd(exactRate),
          priceSubNote: null,
          isExact: true,
        };
      }
      if ((totalBig * 100_000_000n) % areaBig === 0n) {
        return {
          unitPriceDisplay: formatExactVnd(total / displayAreaSqm),
          priceSubNote: null,
          isExact: true,
        };
      }
      return {
        unitPriceDisplay: `~${formatVnd(Math.round(total / displayAreaSqm))}`,
        priceSubNote: `Tính trọn gói ${formatAreaSqmVn(displayAreaSqm)} ${unit}`,
        isExact: false,
      };
    }
  }

  const qty = Math.max(1, Math.round(quantity || 1));

  if (total % qty === 0) {
    return {
      unitPriceDisplay: formatVnd(total / qty),
      priceSubNote: null,
      isExact: true,
    };
  }

  if ((total * 100) % qty === 0) {
    return {
      unitPriceDisplay: formatExactVnd(total / qty),
      priceSubNote: null,
      isExact: true,
    };
  }

  return {
    unitPriceDisplay: `~${formatVnd(Math.round(total / qty))}`,
    priceSubNote: `Tính trọn gói ${formatNumberVn(qty)} ${unit}`,
    isExact: false,
  };
}

export function formatNumberVn(amount: number | null | undefined): string {
  const safe =
    typeof amount === 'number' && Number.isFinite(amount)
      ? Math.round(amount)
      : 0;
  return safe.toLocaleString('vi-VN');
}

export function formatDateVn(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    return String(dateStr);
  }
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

const DIGITS_VN = [
  'không',
  'một',
  'hai',
  'ba',
  'bốn',
  'năm',
  'sáu',
  'bảy',
  'tám',
  'chín',
];

function readThreeDigitsVn(num: number, showZeroHundred: boolean): string {
  const hundred = Math.floor(num / 100);
  const ten = Math.floor((num % 100) / 10);
  const unit = num % 10;
  const parts: string[] = [];

  if (hundred > 0 || showZeroHundred) {
    parts.push(`${DIGITS_VN[hundred]} trăm`);
  }

  if (ten > 1) {
    parts.push(`${DIGITS_VN[ten]} mươi`);
    if (unit === 1) parts.push('mốt');
    else if (unit === 4) parts.push('tư');
    else if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(DIGITS_VN[unit]!);
  } else if (ten === 1) {
    parts.push('mười');
    if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(DIGITS_VN[unit]!);
  } else if (ten === 0 && unit > 0) {
    if (hundred > 0 || showZeroHundred) {
      parts.push('lẻ');
    }
    parts.push(DIGITS_VN[unit]!);
  }

  return parts.join(' ');
}

export function numberToVietnameseWords(amount: number): string {
  const n = Math.round(Math.abs(amount));
  if (!Number.isFinite(n) || n === 0) return 'Không đồng';

  const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ'];
  const groups: number[] = [];
  let temp = n;
  while (temp > 0) {
    groups.push(temp % 1000);
    temp = Math.floor(temp / 1000);
  }

  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const grp = groups[i]!;
    if (grp > 0) {
      const showZeroHundred = i < groups.length - 1;
      const grpWords = readThreeDigitsVn(grp, showZeroHundred);
      const unitLabel = units[i] || '';
      words.push(unitLabel ? `${grpWords} ${unitLabel}` : grpWords);
    }
  }

  const sentence = words.join(' ').trim();
  if (!sentence) return 'Không đồng';
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} đồng chẵn`;
}

export const QUOTE_STATUS_LABELS: Record<QuoteOrderStatusType, string> = {
  DRAFT: 'Bản nháp',
  SENT: 'Đã gửi khách',
  APPROVED: 'Khách đã duyệt',
  FINALIZED: 'Đã chốt báo giá',
  CONVERTED: 'Đã chuyển đơn in',
  CANCELLED: 'Đã hủy',
};

export const PRODUCTION_STATUS_LABELS: Record<
  PrintProductionStatusType,
  string
> = {
  PENDING: 'Chờ bình file',
  PREPRESS: 'Đang chế bản',
  PRINTING: 'Đang in ấn',
  FINISHING: 'Gia công sau in',
  COMPLETED: 'Hoàn tất sản xuất',
  CANCELLED: 'Đã hủy in',
};

export const DELIVERY_STATUS_LABELS: Record<PrintDeliveryStatusType, string> = {
  NOT_SHIPPED: 'Chưa giao hàng',
  PACKING: 'Đang đóng gói',
  SHIPPING: 'Đang vận chuyển',
  DELIVERED: 'Đã giao thành công',
  RETURNED: 'Hoàn trả',
};

export const PAYMENT_STATUS_LABELS: Record<PrintPaymentStatusType, string> = {
  UNPAID: 'Chưa thanh toán',
  DEPOSIT_PAID: 'Đã đặt cọc',
  PARTIALLY_PAID: 'Thanh toán 1 phần',
  PAID: 'Đã tất toán',
};

export interface PrintQuoteA4Metadata {
  quoteCode: string;
  quoteTitle: string;
  versionNo?: number | undefined;
  createdAt?: string | undefined;
  validUntil?: string | null | undefined;
  workspaceName?: string | undefined;
  customerName?: string | null | undefined;
  customerCompany?: string | null | undefined;
  customerPhone?: string | null | undefined;
  customerEmail?: string | null | undefined;
  customerAddress?: string | null | undefined;
  customerNotes?: string | null | undefined;
  itemSpecifications?: Record<
    string,
    { specification?: string | undefined; unit?: string | undefined }
  >;
}

function escapeHtml(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a print-ready Vietnamese A4 Quotation HTML document.
 * SECURITY GUARANTEE: Calls assertCustomerSafePdfPayload() first to ensure
 * ZERO vendor cost, profit margin, or internal pricing data can ever appear.
 */
export function buildPrintQuoteA4Html(
  pdfPayload: CustomerSafePdfPayload,
  meta: PrintQuoteA4Metadata,
): string {
  assertCustomerSafePdfPayload(pdfPayload);

  const brandName = escapeHtml(meta.workspaceName || 'HOÀI PHƯƠNG MEDIA');
  const quoteCode = escapeHtml(
    meta.quoteCode || pdfPayload.quoteCode || 'BG-DRAFT',
  );
  const quoteTitle = escapeHtml(meta.quoteTitle || 'Báo giá dịch vụ in ấn');
  const versionNo = meta.versionNo ?? 1;
  const dateDisplay = formatDateVn(
    meta.createdAt || pdfPayload.generatedAt || new Date().toISOString(),
  );
  const validUntilDisplay = meta.validUntil
    ? formatDateVn(meta.validUntil)
    : '07 ngày kể từ ngày báo giá';

  const customerName = escapeHtml(
    meta.customerName || pdfPayload.customerName || 'Quý khách hàng',
  );
  const customerCompany = escapeHtml(meta.customerCompany || '');
  const customerPhone = escapeHtml(
    meta.customerPhone || pdfPayload.customerPhone || '',
  );
  const customerEmail = escapeHtml(meta.customerEmail || '');
  const customerAddress = escapeHtml(
    meta.customerAddress || pdfPayload.customerAddress || '',
  );
  const customerNotes = escapeHtml(
    meta.customerNotes ||
      pdfPayload.notes ||
      '1. Báo giá trên đã được tính toán chính xác theo số lượng đặt in.\n2. Thời gian sản xuất dự kiến từ 2–4 ngày làm việc sau khi duyệt file thiết kế và xác nhận đặt cọc.',
  );

  const rowsHtml = pdfPayload.lines
    .map((item, idx) => {
      const extra = meta.itemSpecifications?.[item.id];
      const specRaw = extra?.specification || item.specification || '';
      const specText = specRaw
        ? `<div class="item-spec">Quy cách: ${escapeHtml(specRaw)}</div>`
        : '';
      const rawUnit = extra?.unit || item.unit || 'sp';
      const unitLabel = escapeHtml(rawUnit);
      const hasAreaQty =
        typeof item.displayAreaSqm === 'number' &&
        Number.isFinite(item.displayAreaSqm) &&
        item.displayAreaSqm > 0;
      const pricePresentation = formatCustomerLinePriceDisplay(
        item.lineTotal,
        item.quantity,
        rawUnit,
        item.displayAreaSqm,
      );
      const priceNoteHtml = pricePresentation.priceSubNote
        ? `<div class="item-split-note">(${escapeHtml(pricePresentation.priceSubNote)})</div>`
        : '';

      return `
        <tr>
          <td class="col-stt">${idx + 1}</td>
          <td class="col-name">
            <div class="item-title">${escapeHtml(item.name)}</div>
            ${specText}
          </td>
          <td class="col-unit">${unitLabel}</td>
          <td class="col-qty">${hasAreaQty ? formatAreaSqmVn(item.displayAreaSqm) : formatNumberVn(item.quantity)}</td>
          <td class="col-price">
            <div>${escapeHtml(pricePresentation.unitPriceDisplay)}</div>
            ${priceNoteHtml}
          </td>
          <td class="col-total">${formatVnd(item.lineTotal)}</td>
        </tr>
      `;
    })
    .join('\n');

  const reconciledLinesSubtotal = pdfPayload.lines.reduce(
    (sum, item) => sum + item.lineTotal,
    0,
  );

  const shippingRowHtml = pdfPayload.includeShippingInUnitPrice
    ? `
      <tr class="summary-row">
        <td colspan="5" class="summary-label">Cước vận chuyển / Giao hàng:</td>
        <td class="summary-val">Đã gộp trong đơn giá</td>
      </tr>
    `
    : pdfPayload.shippingAmountToAddOnPdfFooter > 0
      ? `
      <tr class="summary-row">
        <td colspan="5" class="summary-label">Cước vận chuyển / Giao hàng (tính 1 lần toàn đơn):</td>
        <td class="summary-val">${formatVnd(pdfPayload.shippingAmountToAddOnPdfFooter)}</td>
      </tr>
    `
      : '';

  const amountInWords = escapeHtml(
    numberToVietnameseWords(pdfPayload.grandTotalPayable),
  );

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>Báo giá ${quoteCode} - ${customerName}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm 14mm 14mm 14mm;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0F172A;
      background: #FFFFFF;
      margin: 0;
      padding: 0;
      font-size: 13px;
      line-height: 1.5;
    }
    .page-container {
      max-width: 210mm;
      margin: 0 auto;
      padding: 8mm 4mm;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0F766E;
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .brand-name {
      font-size: 18px;
      font-weight: 800;
      color: #0F766E;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .brand-sub {
      font-size: 12px;
      color: #475569;
      margin-top: 4px;
    }
    .doc-meta {
      text-align: right;
      font-size: 12px;
      color: #334155;
    }
    .doc-meta strong {
      color: #0F172A;
    }
    .doc-title-block {
      text-align: center;
      margin: 18px 0 20px;
    }
    .doc-title {
      font-size: 22px;
      font-weight: 800;
      color: #0F172A;
      margin: 0;
      letter-spacing: 0.03em;
    }
    .doc-subtitle {
      font-size: 14px;
      font-weight: 600;
      color: #0F766E;
      margin-top: 4px;
    }
    .customer-box {
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 18px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;
      font-size: 12.5px;
    }
    .customer-box .full-row {
      grid-column: 1 / -1;
    }
    table.quote-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    table.quote-table th {
      background: #0F766E;
      color: #FFFFFF;
      font-weight: 700;
      font-size: 12px;
      padding: 9px 10px;
      border: 1px solid #0F766E;
      text-transform: uppercase;
    }
    table.quote-table td {
      padding: 9px 10px;
      border: 1px solid #CBD5E1;
      vertical-align: top;
      font-size: 12.5px;
    }
    .col-stt { width: 42px; text-align: center; }
    .col-name { text-align: left; }
    .col-unit { width: 64px; text-align: center; }
    .col-qty { width: 86px; text-align: right; font-weight: 600; }
    .col-price { width: 120px; text-align: right; font-weight: 600; }
    .col-total { width: 135px; text-align: right; font-weight: 700; color: #0F172A; }
    .item-title { font-weight: 700; color: #0F172A; }
    .item-spec { font-size: 11.5px; color: #475569; margin-top: 2px; }
    .item-split-note { font-size: 11px; color: #0F766E; margin-top: 3px; font-style: italic; }
    .summary-row td {
      background: #F8FAFC;
      font-weight: 600;
    }
    .summary-label { text-align: right; color: #334155; }
    .summary-val { text-align: right; color: #0F172A; }
    .grand-total-row td {
      background: #F0FDFA;
      border-top: 2px solid #0F766E;
      font-size: 14px;
      font-weight: 800;
      color: #0F766E;
    }
    .amount-words {
      margin: 8px 0 16px;
      font-size: 12.5px;
      font-style: italic;
      color: #1E293B;
    }
    .notes-box {
      border: 1px dashed #94A3B8;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 12px;
      color: #334155;
      white-space: pre-line;
      margin-bottom: 26px;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      text-align: center;
      margin-top: 24px;
      page-break-inside: avoid;
    }
    .sig-title {
      font-weight: 700;
      font-size: 13px;
      text-transform: uppercase;
      color: #0F172A;
    }
    .sig-sub {
      font-size: 11.5px;
      color: #64748B;
      margin-bottom: 65px;
    }
    @media print {
      .no-print { display: none !important; }
      .page-container { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="page-container">
    <div class="no-print" style="margin-bottom: 16px; display: flex; justify-content: flex-end; gap: 8px;">
      <button onclick="window.print()" style="background:#0F766E;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-weight:700;cursor:pointer;">
        🖨️ In / Lưu PDF A4
      </button>
    </div>

    <div class="header">
      <div>
        <div class="brand-name">${brandName}</div>
        <div class="brand-sub">Giải pháp Thiết kế, In ấn &amp; Sản xuất Ấn phẩm Chuyên nghiệp</div>
      </div>
      <div class="doc-meta">
        <div>Mã báo giá: <strong>${quoteCode}</strong> (v${versionNo})</div>
        <div>Ngày báo giá: <strong>${dateDisplay}</strong></div>
        <div>Hiệu lực: <strong>${escapeHtml(validUntilDisplay)}</strong></div>
      </div>
    </div>

    <div class="doc-title-block">
      <h1 class="doc-title">BẢNG BÁO GIÁ IN ẤN</h1>
      <div class="doc-subtitle">${quoteTitle}</div>
    </div>

    <div class="customer-box">
      <div><strong>Kính gửi:</strong> ${customerName}</div>
      <div><strong>Điện thoại:</strong> ${customerPhone || '—'}</div>
      ${customerCompany ? `<div><strong>Đơn vị / Công ty:</strong> ${customerCompany}</div>` : ''}
      ${customerEmail ? `<div><strong>Email:</strong> ${customerEmail}</div>` : ''}
      ${customerAddress ? `<div class="full-row"><strong>Địa chỉ nhận hàng:</strong> ${customerAddress}</div>` : ''}
    </div>

    <table class="quote-table">
      <thead>
        <tr>
          <th class="col-stt">STT</th>
          <th class="col-name">Hạng mục / Quy cách in ấn</th>
          <th class="col-unit">ĐVT</th>
          <th class="col-qty">Số lượng</th>
          <th class="col-price">Đơn giá (VNĐ)</th>
          <th class="col-total">Thành tiền (VNĐ)</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr class="summary-row">
          <td colspan="5" class="summary-label">Cộng tiền hàng:</td>
          <td class="summary-val">${formatVnd(reconciledLinesSubtotal)}</td>
        </tr>
        ${shippingRowHtml}
        <tr class="grand-total-row">
          <td colspan="5" class="summary-label">TỔNG CỘNG THANH TOÁN:</td>
          <td class="summary-val">${formatVnd(pdfPayload.grandTotalPayable)}</td>
        </tr>
      </tbody>
    </table>

    <div class="amount-words">
      <strong>Số tiền bằng chữ:</strong> ${amountInWords}.
    </div>

    <div class="notes-box"><strong>Ghi chú &amp; Điều khoản báo giá:</strong>
${customerNotes}</div>

    <div class="signatures">
      <div>
        <div class="sig-title">XÁC NHẬN CỦA KHÁCH HÀNG</div>
        <div class="sig-sub">(Ký, ghi rõ họ tên)</div>
      </div>
      <div>
        <div class="sig-title">ĐẠI DIỆN ĐƠN VỊ BÁO GIÁ</div>
        <div class="sig-sub">(Ký, ghi rõ họ tên)</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
