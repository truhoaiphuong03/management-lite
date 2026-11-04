/**
 * MGL-PRINTQUOTE V1 — PRICING ENGINE & DOMAIN CONTRACTS
 * Shared across @management-lite/contracts, @management-lite/api, and @management-lite/web.
 */

export const ProfitMode = {
  FIXED_AMOUNT: 'FIXED_AMOUNT',
  PERCENTAGE: 'PERCENTAGE',
} as const;

export type ProfitModeType = (typeof ProfitMode)[keyof typeof ProfitMode];

export const ProfitScope = {
  PER_UNIT: 'PER_UNIT',
  PER_SQM: 'PER_SQM',
  TOTAL_BATCH: 'TOTAL_BATCH',
} as const;

export type ProfitScopeType = (typeof ProfitScope)[keyof typeof ProfitScope];

export const VendorCostMode = {
  PER_UNIT: 'PER_UNIT',
  PER_SQM: 'PER_SQM',
  TOTAL_BATCH: 'TOTAL_BATCH',
} as const;

export type VendorCostModeType =
  (typeof VendorCostMode)[keyof typeof VendorCostMode];

export const PriceItemType = {
  BASE_PRINT: 'BASE_PRINT',
  FINISHING: 'FINISHING',
} as const;

export type PriceItemTypeValue =
  (typeof PriceItemType)[keyof typeof PriceItemType];

export const QuotePricingStatus = {
  COMPLETE: 'COMPLETE',
  PENDING_COST: 'PENDING_COST',
} as const;

export type QuotePricingStatusType =
  (typeof QuotePricingStatus)[keyof typeof QuotePricingStatus];

export const LineCostSource = {
  CATALOG: 'CATALOG',
  MANUAL: 'MANUAL',
  CATALOG_OVERRIDDEN: 'CATALOG_OVERRIDDEN',
} as const;

export type LineCostSourceType =
  (typeof LineCostSource)[keyof typeof LineCostSource];

export const AreaInputMode = {
  DIMENSIONS: 'DIMENSIONS',
  DIRECT_AREA: 'DIRECT_AREA',
} as const;

export type AreaInputModeType =
  (typeof AreaInputMode)[keyof typeof AreaInputMode];

export const ProfitBasis = {
  LINE_TOTAL_VENDOR_COST: 'LINE_TOTAL_VENDOR_COST',
} as const;

export type ProfitBasisType = (typeof ProfitBasis)[keyof typeof ProfitBasis];

export const BatchQuantityPolicy = {
  EXACT: 'EXACT',
  MAX: 'MAX',
  RANGE: 'RANGE',
  ANY_QTY: 'ANY_QTY',
} as const;

export type BatchQuantityPolicyType =
  (typeof BatchQuantityPolicy)[keyof typeof BatchQuantityPolicy];

export const MAX_PRINTQUOTE_QUANTITY = 10_000_000;
export const MAX_PRINTQUOTE_DIMENSION_M = 1_000;
export const MAX_PRINTQUOTE_AREA_SQM = 1_000_000;
export const MAX_PRINTQUOTE_RATE_VND = 100_000_000_000;
export const MAX_PRINTQUOTE_PERCENT = 10_000;

export interface QuoteAreaSpec {
  mode: AreaInputModeType;
  widthM: number | null;
  heightM: number | null;
  sheetsCount: number;
  actualAreaSqm: number;
  billableAreaSqm: number;
  adjustmentReason?: string | undefined;
}

export interface QuoteAreaSpecInput {
  mode: AreaInputModeType;
  widthM?: number | null | undefined;
  heightM?: number | null | undefined;
  sheetsCount?: number | undefined;
  actualAreaSqm?: number | undefined;
  billableAreaSqm?: number | null | undefined;
  adjustmentReason?: string | null | undefined;
}

export interface QuoteFinishingStageInput {
  id: string;
  priceItemId?: string | null | undefined;
  code?: string | null | undefined;
  priceItemVersion?: number | null | undefined;
  vendorId?: string | null | undefined;
  vendorName?: string | null | undefined;
  catalogOriginalRate?: number | null | undefined;
  catalogBatchQuantity?: number | null | undefined;
  appliedAt?: string | null | undefined;
  name: string;
  pricingMode: VendorCostModeType;
  rate: number;
  unit?: string | undefined;
  billableAreaSqm?: number | null | undefined;
  costSource?: LineCostSourceType | undefined;
  note?: string | null | undefined;
}

export interface CalculatedFinishingStage {
  id: string;
  priceItemId: string | null;
  code: string | null;
  priceItemVersion?: number | null | undefined;
  vendorId?: string | null | undefined;
  vendorName?: string | null | undefined;
  catalogOriginalRate?: number | null | undefined;
  catalogBatchQuantity?: number | null | undefined;
  appliedAt?: string | null | undefined;
  name: string;
  pricingMode: VendorCostModeType;
  rate: number;
  unit: string;
  billableAreaSqm: number | null;
  vendorCost: number;
  costSource: LineCostSourceType;
  note: string | null;
}

export interface PendingCostDraftStageSnapshot {
  id: string;
  priceItemId?: string | null | undefined;
  code?: string | null | undefined;
  priceItemVersion?: number | null | undefined;
  vendorId?: string | null | undefined;
  vendorName?: string | null | undefined;
  catalogOriginalRate?: number | null | undefined;
  catalogBatchQuantity?: number | null | undefined;
  appliedAt?: string | null | undefined;
  name: string;
  pricingMode: VendorCostModeType;
  rate: number | null;
  unit?: string | undefined;
  billableAreaSqm?: number | null | undefined;
  costSource?: LineCostSourceType | undefined;
  note?: string | null | undefined;
}

export interface PendingCostLineSummary {
  lineId: string;
  lineName: string;
  missingBaseCost: boolean;
  missingStageNames: string[];
}

export const ShippingAllocationStrategy = {
  PROPORTIONAL_BY_BASE_AMOUNT: 'PROPORTIONAL_BY_BASE_AMOUNT',
  PROPORTIONAL_BY_QUANTITY: 'PROPORTIONAL_BY_QUANTITY',
  EQUAL_SPLIT: 'EQUAL_SPLIT',
} as const;

export type ShippingAllocationStrategyType =
  (typeof ShippingAllocationStrategy)[keyof typeof ShippingAllocationStrategy];

export const RoundingMode = {
  NEAREST: 'NEAREST',
  FLOOR: 'FLOOR',
  CEIL: 'CEIL',
} as const;

export type RoundingModeType = (typeof RoundingMode)[keyof typeof RoundingMode];

export interface ProfitConfig {
  mode: ProfitModeType;
  scope: ProfitScopeType;
  value: number;
}

export interface QuoteLineInput {
  id: string;
  name: string;
  specification?: string | undefined;
  vendorId?: string | null | undefined;
  vendorName?: string | null | undefined;
  vendorPriceItemId?: string | null | undefined;
  vendorPriceItemCode?: string | null | undefined;
  vendorPriceItemVersion?: number | null | undefined;
  catalogOriginalRate?: number | null | undefined;
  catalogBatchQuantity?: number | null | undefined;
  priceAppliedAt?: string | null | undefined;
  unit?: string | undefined;
  quantity: number;
  vendorCostMode?: VendorCostModeType | undefined;
  baseCostRate?: number | undefined;
  baseCostSource?: LineCostSourceType | undefined;
  baseIncludedStages?: readonly string[] | undefined;
  areaSpec?: QuoteAreaSpecInput | null | undefined;
  finishingStages?: readonly QuoteFinishingStageInput[] | undefined;
  unitVendorCost?: number | undefined;
  totalVendorCost?: number | undefined;
  profit?: ProfitConfig | undefined;
  extraCost?: number | undefined;
}

export interface UnitPriceRoundingPolicy {
  mode?: RoundingModeType | undefined;
  step?: number | undefined;
}

export interface QuoteCalculationInput {
  quoteId?: string | undefined;
  customerName?: string | undefined;
  items: QuoteLineInput[];
  defaultProfit?: ProfitConfig | undefined;
  shippingFee?: number | undefined;
  extraCost?: number | undefined;
  includeShippingInUnitPrice?: boolean | undefined;
  shippingAllocationStrategy?: ShippingAllocationStrategyType | undefined;
  roundingPolicy?: UnitPriceRoundingPolicy | undefined;
  requireAreaAdjustmentReason?: boolean | undefined;
}

export interface ExactUnitPriceSplitSegment {
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface QuoteLineBreakdown {
  id: string;
  name: string;
  specification: string;
  vendorId: string | null;
  vendorName: string | null;
  vendorPriceItemId: string | null;
  vendorPriceItemCode?: string | null | undefined;
  vendorPriceItemVersion?: number | null | undefined;
  catalogOriginalRate?: number | null | undefined;
  catalogBatchQuantity?: number | null | undefined;
  priceAppliedAt?: string | null | undefined;
  unit: string;
  quantity: number;

  vendorCostMode?: VendorCostModeType | undefined;
  baseCostRate?: number | undefined;
  baseCostSource?: LineCostSourceType | undefined;
  baseIncludedStages?: string[] | undefined;
  baseVendorCost?: number | undefined;
  finishingVendorCost?: number | undefined;
  finishingStages?: CalculatedFinishingStage[] | undefined;
  areaSpec?: QuoteAreaSpec | null | undefined;

  unitVendorCost: number;
  totalVendorCost: number;

  profitMode: ProfitModeType;
  profitScope: ProfitScopeType;
  profitBasis?: ProfitBasisType | undefined;
  profitInputValue: number;
  unitProfit: number;
  totalProfit: number;

  lineExtraCost: number;
  allocatedOrderExtraCost: number;
  totalExtraCost: number;

  baseLineAmountBeforeShipping: number;

  allocatedShippingFee: number;
  shippingIncludedInUnitPrice: boolean;

  targetLineTotal: number;

  rawFinalUnitPrice: number;
  finalUnitPrice: number;

  billedLineSubtotal: number;
  roundingAdjustment: number;
  reconciledLineTotal: number;
  exactSplitSchedule: ExactUnitPriceSplitSegment[];
}

export interface QuoteCalculationResult {
  quoteId: string;
  customerName: string;
  calculatedAt: string;

  includeShippingInUnitPrice: boolean;
  shippingAllocationStrategy: ShippingAllocationStrategyType;
  roundingPolicy: Required<UnitPriceRoundingPolicy>;

  totalQuantity: number;
  totalVendorCost: number;
  totalProfit: number;
  shippingFee: number;
  lineExtraCostTotal: number;
  orderExtraCost: number;
  totalExtraCost: number;

  totalQuoteAmount: number;
  singleProductFinalUnitPrice: number | null;

  totalAllocatedShippingFee: number;
  totalBilledLinesSubtotal: number;
  totalRoundingAdjustment: number;
  totalReconciledLinesAmount: number;
  unmergedShippingFee: number;
  isReconciled: boolean;
  reconciliationDelta: number;

  lines: QuoteLineBreakdown[];
}

export interface QuotePdfLineItem {
  index: number;
  id: string;
  name: string;
  specification?: string | undefined;
  unit: string;
  quantity: number;
  displayAreaSqm?: number | undefined;
  unitPrice: number;
  billedSubtotal: number;
  roundingAdjustment: number;
  lineTotal: number;
  shippingIncludedInUnitPrice: boolean;
}

export interface QuotePdfPayload {
  quoteId: string;
  customerName: string;
  generatedAt: string;
  includeShippingInUnitPrice: boolean;
  lines: QuotePdfLineItem[];
  subtotalFromLines: number;
  totalRoundingAdjustment: number;
  originalShippingFee: number;
  shippingAmountToAddOnPdfFooter: number;
  shippingFooterNote: string;
  grandTotalPayable: number;
}

/**
 * Customer-facing PDF payload guaranteed to omit all internal vendor cost,
 * profit, and merged shipping cost amounts.
 */
export interface CustomerSafePdfPayload {
  quoteId: string;
  quoteCode: string;
  customerName: string;
  customerPhone?: string | null | undefined;
  customerAddress?: string | null | undefined;
  generatedAt: string;
  validUntil?: string | null | undefined;
  notes?: string | null | undefined;
  includeShippingInUnitPrice: boolean;
  lines: QuotePdfLineItem[];
  subtotalFromLines: number;
  totalRoundingAdjustment: number;
  shippingAmountToAddOnPdfFooter: number;
  shippingFooterNote: string;
  grandTotalPayable: number;
}

export const QuoteOrderStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  APPROVED: 'APPROVED',
  FINALIZED: 'FINALIZED',
  CONVERTED: 'CONVERTED',
  CANCELLED: 'CANCELLED',
} as const;

export type QuoteOrderStatusType =
  (typeof QuoteOrderStatus)[keyof typeof QuoteOrderStatus];

export interface PersistedQuoteLineSnapshot {
  readonly id: string;
  readonly name: string;
  readonly specification?: string | undefined;
  readonly vendorId?: string | null | undefined;
  readonly vendorName?: string | null | undefined;
  readonly vendorPriceItemId?: string | null | undefined;
  readonly vendorPriceItemCode?: string | null | undefined;
  readonly vendorPriceItemVersion?: number | null | undefined;
  readonly catalogOriginalRate?: number | null | undefined;
  readonly catalogBatchQuantity?: number | null | undefined;
  readonly priceAppliedAt?: string | null | undefined;
  readonly unit: string;
  readonly quantity: number;
  readonly vendorCostMode?: VendorCostModeType | undefined;
  readonly baseCostRate?: number | null | undefined;
  readonly baseCostPending?: boolean | undefined;
  readonly baseCostSource?: LineCostSourceType | undefined;
  readonly baseIncludedStages?: readonly string[] | undefined;
  readonly baseVendorCost?: number | null | undefined;
  readonly finishingVendorCost?: number | null | undefined;
  readonly finishingStages?:
    | readonly (CalculatedFinishingStage | PendingCostDraftStageSnapshot)[]
    | undefined;
  readonly areaSpec?: QuoteAreaSpec | null | undefined;
  readonly isPendingCost?: boolean | undefined;
  readonly unitVendorCost: number;
  readonly totalVendorCost: number;
  readonly profitMode: ProfitModeType;
  readonly profitScope: ProfitScopeType;
  readonly profitBasis?: ProfitBasisType | undefined;
  readonly profitInputValue: number;
  readonly unitProfit: number;
  readonly totalProfit: number;
  readonly allocatedShippingFee: number;
  readonly totalExtraCost: number;
  readonly rawFinalUnitPrice: number;
  readonly finalUnitPrice: number;
  readonly billedLineSubtotal: number;
  readonly roundingAdjustment: number;
  readonly reconciledLineTotal: number;
}

export interface PersistedQuoteOrderSnapshot {
  readonly orderId: string;
  readonly quoteId: string;
  readonly customerName: string;
  readonly status: QuoteOrderStatusType;
  readonly pricingStatus?: QuotePricingStatusType | undefined;
  readonly pendingCostSummary?: readonly PendingCostLineSummary[] | undefined;
  readonly createdAt: string;
  readonly finalizedAt: string | null;
  readonly includeShippingInUnitPrice: boolean;
  readonly shippingAllocationStrategy: ShippingAllocationStrategyType;
  readonly totalVendorCost: number;
  readonly totalProfit: number;
  readonly shippingFee: number;
  readonly totalExtraCost: number;
  readonly finalUnitPrice: number | null;
  readonly totalQuoteAmount: number;
  readonly totalRoundingAdjustment: number;
  readonly lines: readonly PersistedQuoteLineSnapshot[];
  readonly pdfPayload: Readonly<QuotePdfPayload> | null;
  readonly integrityHash: string;
}

// ============================================================================
// PURE FIPS 180-4 SHA-256 (Browser & Node Isomorphic — Zero node:crypto needed)
// ============================================================================

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const totalLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const highBits = Math.floor(bitLen / 0x100000000);
  const lowBits = bitLen >>> 0;
  view.setUint32(totalLen - 8, highBits, false);
  view.setUint32(totalLen - 4, lowBits, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = rotr(7, w15) ^ rotr(18, w15) ^ (w15 >>> 3);
      const s1 = rotr(17, w2) ^ rotr(19, w2) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

// ============================================================================
// CORE PRICING ENGINE FUNCTIONS
// ============================================================================

export function roundByPolicy(
  value: number,
  mode: RoundingModeType = RoundingMode.NEAREST,
  step: number = 1,
): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Giá trị cần làm tròn không hợp lệ: ${value}`);
  }
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error(`Bước làm tròn (step) phải > 0, nhận được: ${step}`);
  }

  const scaled = value / step;
  const epsilonCorrected = Number(scaled.toFixed(12));

  let roundedUnits: number;
  switch (mode) {
    case RoundingMode.FLOOR:
      roundedUnits = Math.floor(epsilonCorrected);
      break;
    case RoundingMode.CEIL:
      roundedUnits = Math.ceil(epsilonCorrected);
      break;
    case RoundingMode.NEAREST:
    default:
      roundedUnits = Math.round(epsilonCorrected);
      break;
  }

  return roundedUnits * step;
}

export function allocateIntegerAmount(
  totalAmount: number,
  weights: readonly number[],
): number[] {
  const count = weights.length;
  if (count === 0) {
    return [];
  }

  const normalizedTotal = Math.round(totalAmount);
  if (normalizedTotal < 0) {
    throw new Error(`Số tiền phân bổ không được âm: ${totalAmount}`);
  }
  if (normalizedTotal === 0) {
    return new Array<number>(count).fill(0);
  }
  if (count === 1) {
    return [normalizedTotal];
  }

  const sanitizedWeights = weights.map((w) =>
    Number.isFinite(w) && w > 0 ? w : 0,
  );
  const weightSum = sanitizedWeights.reduce((acc, w) => acc + w, 0);

  const effectiveWeights =
    weightSum > 0 ? sanitizedWeights : new Array<number>(count).fill(1);
  const effectiveWeightSum = weightSum > 0 ? weightSum : count;

  const floors: number[] = new Array<number>(count);
  const remainders: { index: number; remainder: number; weight: number }[] = [];
  let sumFloors = 0;

  for (let i = 0; i < count; i++) {
    const exactShare =
      (normalizedTotal * effectiveWeights[i]!) / effectiveWeightSum;
    const floorVal = Math.floor(Number(exactShare.toFixed(12)));
    const remainder = exactShare - floorVal;
    floors[i] = floorVal;
    sumFloors += floorVal;
    remainders.push({
      index: i,
      remainder,
      weight: effectiveWeights[i]!,
    });
  }

  const remainderUnitsToDistribute = normalizedTotal - sumFloors;
  if (remainderUnitsToDistribute > 0) {
    remainders.sort((a, b) => {
      if (Math.abs(b.remainder - a.remainder) > 1e-12) {
        return b.remainder - a.remainder;
      }
      if (b.weight !== a.weight) {
        return b.weight - a.weight;
      }
      return a.index - b.index;
    });

    for (let k = 0; k < remainderUnitsToDistribute; k++) {
      const targetIndex = remainders[k]!.index;
      floors[targetIndex] = (floors[targetIndex] ?? 0) + 1;
    }
  }

  return floors;
}

// ============================================================================
// EXACT DECIMAL AREA (m²) & FINISHING STAGE HELPERS (ZERO FLOAT DRIFT)
// ============================================================================

export function normalizeAreaSqm(area: number): number {
  if (!Number.isFinite(area) || area <= 0) {
    throw new Error(`Diện tích m² phải lớn hơn 0, nhận được: ${area}`);
  }
  if (area > MAX_PRINTQUOTE_AREA_SQM) {
    throw new Error(
      `Diện tích m² vượt giới hạn an toàn (${MAX_PRINTQUOTE_AREA_SQM} m²), nhận được: ${area}`,
    );
  }
  const microSqm = Math.round(area * 1_000_000);
  if (microSqm <= 0) {
    throw new Error(`Diện tích m² quá nhỏ hoặc không hợp lệ: ${area}`);
  }
  return microSqm / 1_000_000;
}

/**
 * Computes exact area (m²) = widthM × heightM × sheetsCount using scaled BigInt
 * (1 m = 10,000 units of 0.1mm) so 0.8 × 1.2 × 3 === 2.88 with zero IEEE-754 drift.
 */
export function computeExactAreaSqm(
  widthM: number,
  heightM: number,
  sheetsCount: number = 1,
): number {
  if (
    !Number.isFinite(widthM) ||
    widthM <= 0 ||
    widthM > MAX_PRINTQUOTE_DIMENSION_M
  ) {
    throw new Error(
      `Chiều ngang (m) phải nằm trong khoảng (0, ${MAX_PRINTQUOTE_DIMENSION_M}], nhận được: ${widthM}`,
    );
  }
  if (
    !Number.isFinite(heightM) ||
    heightM <= 0 ||
    heightM > MAX_PRINTQUOTE_DIMENSION_M
  ) {
    throw new Error(
      `Chiều cao (m) phải nằm trong khoảng (0, ${MAX_PRINTQUOTE_DIMENSION_M}], nhận được: ${heightM}`,
    );
  }
  if (
    !Number.isInteger(sheetsCount) ||
    sheetsCount <= 0 ||
    sheetsCount > MAX_PRINTQUOTE_QUANTITY
  ) {
    throw new Error(
      `Số tấm tính diện tích phải là số nguyên dương <= ${MAX_PRINTQUOTE_QUANTITY}, nhận được: ${sheetsCount}`,
    );
  }
  const wScaled = BigInt(Math.round(widthM * 10_000));
  const hScaled = BigInt(Math.round(heightM * 10_000));
  const cScaled = BigInt(sheetsCount);
  if (wScaled <= 0n || hScaled <= 0n) {
    throw new Error('Kích thước ngang/cao quá nhỏ.');
  }
  // wScaled * hScaled is in 10^-8 m²; convert half-up to 10^-6 m² (micro-m²)
  const prod1e8 = wScaled * hScaled * cScaled;
  const microSqm = (prod1e8 + 50n) / 100n;
  const resultSqm = Number(microSqm) / 1_000_000;
  if (resultSqm <= 0 || resultSqm > MAX_PRINTQUOTE_AREA_SQM) {
    throw new Error(
      `Tổng diện tích tính ra (${resultSqm} m²) vượt giới hạn hợp lệ.`,
    );
  }
  return resultSqm;
}

/**
 * Multiplies a VND/m² rate by billableAreaSqm using scaled BigInt arithmetic
 * and half-up rounds once to integer VND.
 * Example: 50,000 đ/m² × 2.88 m² === 144,000 đ exact.
 */
export function multiplyRateByAreaSqmToVnd(
  ratePerSqm: number,
  billableAreaSqm: number,
): number {
  if (
    !Number.isFinite(ratePerSqm) ||
    ratePerSqm < 0 ||
    ratePerSqm > MAX_PRINTQUOTE_RATE_VND
  ) {
    throw new Error(
      `Đơn giá / m² phải nằm trong khoảng [0, ${MAX_PRINTQUOTE_RATE_VND}], nhận được: ${ratePerSqm}`,
    );
  }
  const normalizedArea = normalizeAreaSqm(billableAreaSqm);
  if (ratePerSqm === 0) return 0;
  const areaMicro = BigInt(Math.round(normalizedArea * 1_000_000));
  const rateCents = BigInt(Math.round(ratePerSqm * 100));
  const prod = areaMicro * rateCents;
  const roundedVnd = (prod + 50_000_000n) / 100_000_000n;
  if (roundedVnd > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Thành tiền diện tích vượt giới hạn số nguyên an toàn.');
  }
  return Number(roundedVnd);
}

export interface CatalogBatchConditionResult {
  allowed: boolean;
  policy: BatchQuantityPolicyType;
  batchQuantity: number;
  minQuantity: number;
  maxQuantity: number | null;
  reason: string | null;
}

export function resolveCatalogBatchQuantityPolicy(item: {
  itemType?: PriceItemTypeValue | undefined;
  pricingMode: VendorCostModeType;
  batchQuantity: number;
  structuredSpec?: Record<string, unknown> | null | undefined;
}): {
  policy: BatchQuantityPolicyType;
  batchQuantity: number;
  minQuantity: number;
  maxQuantity: number | null;
} {
  const batchQuantity = Math.max(
    1,
    Math.trunc(Number(item.batchQuantity) || 1),
  );
  if (item.pricingMode !== VendorCostMode.TOTAL_BATCH) {
    return {
      policy: BatchQuantityPolicy.ANY_QTY,
      batchQuantity,
      minQuantity: 1,
      maxQuantity: null,
    };
  }

  const rawPolicy = item.structuredSpec?.['batch_qty_policy'];
  let policy: BatchQuantityPolicyType;
  if (
    rawPolicy === BatchQuantityPolicy.EXACT ||
    rawPolicy === BatchQuantityPolicy.MAX ||
    rawPolicy === BatchQuantityPolicy.RANGE ||
    rawPolicy === BatchQuantityPolicy.ANY_QTY
  ) {
    policy = rawPolicy;
  } else if (item.itemType === PriceItemType.FINISHING && batchQuantity === 1) {
    // Flat per-lot setup fee on finishing stages (e.g. "Khuôn bế 1 lô") applies once per job unless restricted
    policy = BatchQuantityPolicy.ANY_QTY;
  } else {
    // Fail-closed default for BASE_PRINT TOTAL_BATCH and any multi-unit batch: exact batch quantity required
    policy = BatchQuantityPolicy.EXACT;
  }

  if (policy === BatchQuantityPolicy.EXACT) {
    return {
      policy,
      batchQuantity,
      minQuantity: batchQuantity,
      maxQuantity: batchQuantity,
    };
  }
  if (policy === BatchQuantityPolicy.MAX) {
    return {
      policy,
      batchQuantity,
      minQuantity: 1,
      maxQuantity: batchQuantity,
    };
  }
  if (policy === BatchQuantityPolicy.RANGE) {
    const rawMin = Number(item.structuredSpec?.['batch_min_qty']);
    const rawMax = Number(item.structuredSpec?.['batch_max_qty']);
    const minQuantity =
      Number.isInteger(rawMin) && rawMin >= 1 ? rawMin : batchQuantity;
    const maxQuantity =
      Number.isInteger(rawMax) && rawMax >= minQuantity
        ? rawMax
        : batchQuantity;
    return {
      policy,
      batchQuantity,
      minQuantity,
      maxQuantity,
    };
  }
  return {
    policy: BatchQuantityPolicy.ANY_QTY,
    batchQuantity,
    minQuantity: 1,
    maxQuantity: null,
  };
}

export function evaluateCatalogBatchQuantityCondition(params: {
  itemName: string;
  itemCode?: string | null | undefined;
  itemType?: PriceItemTypeValue | undefined;
  pricingMode: VendorCostModeType;
  batchQuantity: number;
  structuredSpec?: Record<string, unknown> | null | undefined;
  costSource?: LineCostSourceType | undefined;
  lineQuantity: number;
  unit?: string | undefined;
}): CatalogBatchConditionResult {
  const resolved = resolveCatalogBatchQuantityPolicy({
    itemType: params.itemType,
    pricingMode: params.pricingMode,
    batchQuantity: params.batchQuantity,
    structuredSpec: params.structuredSpec,
  });

  if (
    params.pricingMode !== VendorCostMode.TOTAL_BATCH ||
    params.costSource === LineCostSource.MANUAL ||
    params.costSource === LineCostSource.CATALOG_OVERRIDDEN ||
    resolved.policy === BatchQuantityPolicy.ANY_QTY
  ) {
    return {
      allowed: true,
      policy: resolved.policy,
      batchQuantity: resolved.batchQuantity,
      minQuantity: resolved.minQuantity,
      maxQuantity: resolved.maxQuantity,
      reason: null,
    };
  }

  const unitLabel = params.unit || 'đơn vị';
  const codePrefix = params.itemCode ? `[${params.itemCode}] ` : '';

  if (
    resolved.policy === BatchQuantityPolicy.EXACT &&
    params.lineQuantity !== resolved.batchQuantity
  ) {
    return {
      allowed: false,
      policy: resolved.policy,
      batchQuantity: resolved.batchQuantity,
      minQuantity: resolved.minQuantity,
      maxQuantity: resolved.maxQuantity,
      reason: `Mục giá trọn lô ${codePrefix}"${params.itemName}" chỉ áp dụng cho đúng ${resolved.batchQuantity} ${unitLabel} (hiện đang nhập ${params.lineQuantity} ${unitLabel}). Không tự áp dụng giá trọn lô cho số lượng khác — vui lòng đặt lại SL = ${resolved.batchQuantity}, hoặc xác nhận sửa giá riêng cho báo giá này.`,
    };
  }

  if (
    resolved.policy === BatchQuantityPolicy.MAX &&
    (params.lineQuantity < 1 || params.lineQuantity > resolved.batchQuantity)
  ) {
    return {
      allowed: false,
      policy: resolved.policy,
      batchQuantity: resolved.batchQuantity,
      minQuantity: resolved.minQuantity,
      maxQuantity: resolved.maxQuantity,
      reason: `Mục giá trọn lô ${codePrefix}"${params.itemName}" chỉ áp dụng tối đa ${resolved.batchQuantity} ${unitLabel} (hiện đang nhập ${params.lineQuantity} ${unitLabel}). Vui lòng giảm SL <= ${resolved.batchQuantity} hoặc xác nhận giá riêng.`,
    };
  }

  if (
    resolved.policy === BatchQuantityPolicy.RANGE &&
    (params.lineQuantity < resolved.minQuantity ||
      (resolved.maxQuantity !== null &&
        params.lineQuantity > resolved.maxQuantity))
  ) {
    return {
      allowed: false,
      policy: resolved.policy,
      batchQuantity: resolved.batchQuantity,
      minQuantity: resolved.minQuantity,
      maxQuantity: resolved.maxQuantity,
      reason: `Mục giá trọn lô ${codePrefix}"${params.itemName}" chỉ áp dụng cho khoảng ${resolved.minQuantity}–${resolved.maxQuantity} ${unitLabel} (hiện đang nhập ${params.lineQuantity} ${unitLabel}). Vui lòng điều chỉnh SL hoặc xác nhận giá riêng.`,
    };
  }

  return {
    allowed: true,
    policy: resolved.policy,
    batchQuantity: resolved.batchQuantity,
    minQuantity: resolved.minQuantity,
    maxQuantity: resolved.maxQuantity,
    reason: null,
  };
}

export function normalizeStageKey(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveStageConflictFamily(normalizedKey: string): string {
  if (
    normalizedKey.includes('can_mang') ||
    normalizedKey.includes('can_mo') ||
    normalizedKey.includes('can_bong')
  ) {
    return 'lamination';
  }
  if (normalizedKey.includes('ep_kim') || normalizedKey.includes('nhu')) {
    return 'foil_stamping';
  }
  if (normalizedKey.includes('be_') || normalizedKey === 'be') {
    return 'die_cut';
  }
  if (normalizedKey.includes('can_gan') || normalizedKey.includes('gap')) {
    return 'creasing_folding';
  }
  if (normalizedKey.includes('bo_goc')) {
    return 'corner_rounding';
  }
  if (normalizedKey.includes('dong_khoen')) {
    return 'eyelets';
  }
  if (normalizedKey.includes('dan_bien') || normalizedKey.includes('xo_cay')) {
    return 'hem_pocket';
  }
  return normalizedKey;
}

export interface StageOverlapWarning {
  stageId: string;
  stageName: string;
  matchedIncludedLabel: string;
}

export function detectIncludedStageOverlaps(params: {
  baseIncludedStages?: readonly string[] | undefined;
  baseCatalogSpecification?: string | null | undefined;
  finishingStages: readonly {
    id: string;
    name: string;
  }[];
}): StageOverlapWarning[] {
  const includedPool: { label: string; key: string; family: string }[] = [];
  for (const raw of params.baseIncludedStages ?? []) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const key = normalizeStageKey(trimmed);
    if (!key) continue;
    includedPool.push({
      label: trimmed,
      key,
      family: resolveStageConflictFamily(key),
    });
  }

  // Also detect explicit lamination/finishing mentions in the catalog base item's specification
  if (params.baseCatalogSpecification) {
    const specKey = normalizeStageKey(params.baseCatalogSpecification);
    const knownSpecPatterns: Array<{
      pattern: string;
      label: string;
      family: string;
    }> = [
      {
        pattern: 'can_mang_2_mat',
        label: 'Cán màng 2 mặt',
        family: 'lamination',
      },
      {
        pattern: 'can_mang_1_mat',
        label: 'Cán màng 1 mặt',
        family: 'lamination',
      },
      { pattern: 'can_mo', label: 'Cán màng mờ', family: 'lamination' },
      { pattern: 'can_bong', label: 'Cán màng bóng', family: 'lamination' },
      { pattern: 'can_mang', label: 'Cán màng', family: 'lamination' },
      { pattern: 'dong_khoen', label: 'Đóng khoen', family: 'eyelets' },
    ];
    for (const pat of knownSpecPatterns) {
      if (
        specKey.includes(pat.pattern) &&
        !specKey.includes(`khong_${pat.pattern}`) &&
        !includedPool.some((p) => p.family === pat.family)
      ) {
        includedPool.push({
          label: pat.label,
          key: pat.pattern,
          family: pat.family,
        });
      }
    }
  }

  if (includedPool.length === 0) return [];

  const warnings: StageOverlapWarning[] = [];
  for (const stage of params.finishingStages) {
    const stageKey = normalizeStageKey(stage.name);
    if (!stageKey) continue;
    const stageFamily = resolveStageConflictFamily(stageKey);
    const hit = includedPool.find(
      (inc) =>
        inc.key === stageKey ||
        inc.family === stageFamily ||
        stageKey.includes(inc.key) ||
        inc.key.includes(stageKey),
    );
    if (hit) {
      warnings.push({
        stageId: stage.id,
        stageName: stage.name,
        matchedIncludedLabel: hit.label,
      });
    }
  }
  return warnings;
}

/**
 * Builds a concise human-readable summary string such as:
 * "A4 C200 · In màu 2 mặt · Cán màng 1 mặt"
 */
export function buildCompactProductSummary(params: {
  specification?: string | null | undefined;
  finishingStageNames?: readonly string[] | undefined;
  areaSpec?: QuoteAreaSpec | QuoteAreaSpecInput | null | undefined;
}): string {
  const tokens: string[] = [];
  const seenKeys = new Set<string>();
  const pushToken = (raw: string | null | undefined) => {
    const cleaned = String(raw || '').trim();
    if (!cleaned) return;
    const key = normalizeStageKey(cleaned);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    tokens.push(cleaned);
  };

  if (params.specification) {
    for (const part of params.specification.split(/[·•,;|\n]+/)) {
      pushToken(part);
    }
  }
  if (params.areaSpec) {
    const a = params.areaSpec;
    if (
      a.mode === AreaInputMode.DIMENSIONS &&
      a.widthM &&
      a.heightM &&
      a.actualAreaSqm
    ) {
      const sheets = a.sheetsCount ?? 1;
      pushToken(
        `${String(a.widthM).replace('.', ',')}×${String(a.heightM).replace('.', ',')}m × ${sheets} tấm (${String(a.actualAreaSqm).replace('.', ',')}m²)`,
      );
    } else if (a.actualAreaSqm) {
      pushToken(`${String(a.actualAreaSqm).replace('.', ',')}m²`);
    }
  }
  for (const stageName of params.finishingStageNames ?? []) {
    pushToken(stageName);
  }
  return tokens.join(' · ');
}

export const WORKSHOP_MATERIAL_GROUPS = [
  {
    id: 'GIAY',
    label: 'Giấy',
    subtypes: [
      'Couche',
      'Fort',
      'Bristol',
      'Ivory',
      'Kraft',
      'Mỹ thuật',
      'Khác',
    ],
    gsmBySubtype: {
      Couche: ['C100', 'C150', 'C200', 'C250', 'C300', 'Khác'],
      Fort: ['Fort 60', 'Fort 70', 'Fort 80', 'Fort 100', 'Khác'],
      default: ['C150', 'C200', 'C250', 'C300', 'Fort 80', 'Khác'],
    },
    sizes: ['A4', 'A5', 'A3', 'A6', '9×5.4cm', 'Khác'],
    printColors: [
      'In màu 2 mặt',
      'In màu 1 mặt',
      'Trắng đen 2 mặt',
      'Trắng đen 1 mặt',
      'Khác',
    ],
    laminations: ['Không cán', 'Cán màng 1 mặt', 'Cán màng 2 mặt', 'Khác'],
    defaultUnit: 'tờ',
  },
  {
    id: 'DECAL',
    label: 'Decal',
    subtypes: [
      'Decal giấy',
      'Decal sữa',
      'Decal trong',
      'Decal dán kính',
      'Decal nhựa',
      'Khác',
    ],
    gsmBySubtype: { default: [] as string[] },
    sizes: ['A4', 'A3', 'Theo m²', 'Tem cắt bế', 'Khác'],
    printColors: ['In màu 1 mặt', 'Trắng đen 1 mặt', 'Khác'],
    laminations: ['Không cán', 'Cán màng 1 mặt', 'Khác'],
    defaultUnit: 'tờ',
  },
  {
    id: 'BAT',
    label: 'Bạt / Khổ lớn',
    subtypes: [
      'Bạt Hiflex thường',
      'Bạt Hiflex đế xám',
      'PP trong nhà',
      'PP ngoài trời',
      'Canvas',
      'Khác',
    ],
    gsmBySubtype: { default: [] as string[] },
    sizes: ['Tính theo m²', '0.8×1.8m', '0.6×1.6m', 'Khác'],
    printColors: ['In màu KTS', 'In UV', 'Khác'],
    laminations: ['Không cán', 'Cán màng 1 mặt', 'Đóng khoen 4 góc', 'Khác'],
    defaultUnit: 'm²',
  },
  {
    id: 'KHAC',
    label: 'Khác (Tự nhập)',
    subtypes: ['Khác'],
    gsmBySubtype: { default: [] as string[] },
    sizes: ['Khác'],
    printColors: ['Khác'],
    laminations: ['Khác'],
    defaultUnit: 'sp',
  },
] as const;

export const WORKSHOP_FINISHING_SUGGESTIONS = [
  {
    name: 'Cán màng 1 mặt',
    defaultUnit: 'tờ',
    defaultMode: VendorCostMode.PER_UNIT,
  },
  {
    name: 'Cán màng 2 mặt',
    defaultUnit: 'tờ',
    defaultMode: VendorCostMode.PER_UNIT,
  },
  {
    name: 'Cán màng theo m²',
    defaultUnit: 'm²',
    defaultMode: VendorCostMode.PER_SQM,
  },
  {
    name: 'Bế demi / Cắt thành phẩm',
    defaultUnit: 'lô',
    defaultMode: VendorCostMode.TOTAL_BATCH,
  },
  {
    name: 'Cấn gân / Gấp',
    defaultUnit: 'tờ',
    defaultMode: VendorCostMode.PER_UNIT,
  },
  { name: 'Bo góc', defaultUnit: 'hộp', defaultMode: VendorCostMode.PER_UNIT },
  {
    name: 'Ép kim / Phủ UV',
    defaultUnit: 'lô',
    defaultMode: VendorCostMode.TOTAL_BATCH,
  },
  {
    name: 'Đóng khoen / Dán biên',
    defaultUnit: 'tấm',
    defaultMode: VendorCostMode.PER_UNIT,
  },
  {
    name: 'Đóng cuốn / Đóng kim',
    defaultUnit: 'cuốn',
    defaultMode: VendorCostMode.PER_UNIT,
  },
] as const;

function resolveAreaSpec(
  areaInput: QuoteAreaSpecInput | null | undefined,
  lineQuantity: number,
  lineId: string,
  options?: {
    requireAdjustmentReason?: boolean | undefined;
    lineName?: string | undefined;
  },
): QuoteAreaSpec | null {
  if (!areaInput) return null;
  const trimmedReason = String(areaInput.adjustmentReason ?? '').trim();
  const label = options?.lineName ? `"${options.lineName}"` : `(${lineId})`;

  if (areaInput.mode === AreaInputMode.DIMENSIONS) {
    const w = Number(areaInput.widthM);
    const h = Number(areaInput.heightM);
    const sheets =
      areaInput.sheetsCount !== undefined
        ? Number(areaInput.sheetsCount)
        : lineQuantity;
    const actualAreaSqm = computeExactAreaSqm(w, h, sheets);
    const billableAreaSqm =
      areaInput.billableAreaSqm !== undefined &&
      areaInput.billableAreaSqm !== null
        ? normalizeAreaSqm(Number(areaInput.billableAreaSqm))
        : actualAreaSqm;
    const hasDiff = Math.abs(billableAreaSqm - actualAreaSqm) > 1e-9;
    if (hasDiff && options?.requireAdjustmentReason && !trimmedReason) {
      throw new Error(
        `Sản phẩm ${label} có diện tích tính tiền (${billableAreaSqm} m²) khác diện tích thực tế (${actualAreaSqm} m²) — bắt buộc nhập lý do điều chỉnh diện tích.`,
      );
    }
    return {
      mode: AreaInputMode.DIMENSIONS,
      widthM: Math.round(w * 10_000) / 10_000,
      heightM: Math.round(h * 10_000) / 10_000,
      sheetsCount: sheets,
      actualAreaSqm,
      billableAreaSqm,
      ...(trimmedReason ? { adjustmentReason: trimmedReason } : {}),
    };
  }
  if (areaInput.mode === AreaInputMode.DIRECT_AREA) {
    if (areaInput.actualAreaSqm === undefined) {
      throw new Error(
        `Dòng (${lineId}) tính theo diện tích m² phải có diện tích thực tế > 0.`,
      );
    }
    const actualAreaSqm = normalizeAreaSqm(Number(areaInput.actualAreaSqm));
    const billableAreaSqm =
      areaInput.billableAreaSqm !== undefined &&
      areaInput.billableAreaSqm !== null
        ? normalizeAreaSqm(Number(areaInput.billableAreaSqm))
        : actualAreaSqm;
    const hasDiff = Math.abs(billableAreaSqm - actualAreaSqm) > 1e-9;
    if (hasDiff && options?.requireAdjustmentReason && !trimmedReason) {
      throw new Error(
        `Sản phẩm ${label} có diện tích tính tiền (${billableAreaSqm} m²) khác diện tích thực tế (${actualAreaSqm} m²) — bắt buộc nhập lý do điều chỉnh diện tích.`,
      );
    }
    return {
      mode: AreaInputMode.DIRECT_AREA,
      widthM: null,
      heightM: null,
      sheetsCount: lineQuantity,
      actualAreaSqm,
      billableAreaSqm,
      ...(trimmedReason ? { adjustmentReason: trimmedReason } : {}),
    };
  }
  throw new Error(
    `Chế độ tính diện tích không hợp lệ trên dòng (${lineId}): ${String(areaInput.mode)}`,
  );
}

function resolveLineCostAndProfit(
  item: QuoteLineInput,
  defaultProfit?: ProfitConfig,
  requireAreaAdjustmentReason?: boolean,
): {
  vendorCostMode?: VendorCostModeType | undefined;
  baseCostRate?: number | undefined;
  baseCostSource?: LineCostSourceType | undefined;
  baseIncludedStages?: string[] | undefined;
  baseVendorCost?: number | undefined;
  finishingVendorCost?: number | undefined;
  finishingStages?: CalculatedFinishingStage[] | undefined;
  areaSpec?: QuoteAreaSpec | null | undefined;
  unitVendorCost: number;
  totalVendorCost: number;
  profitConfig: ProfitConfig;
  profitBasis?: ProfitBasisType | undefined;
  unitProfit: number;
  totalProfit: number;
  lineExtraCost: number;
} {
  if (!item.id || !item.name) {
    throw new Error('Mỗi dòng sản phẩm phải có đầy đủ `id` và `name`.');
  }
  if (
    !Number.isInteger(item.quantity) ||
    item.quantity <= 0 ||
    item.quantity > MAX_PRINTQUOTE_QUANTITY
  ) {
    throw new Error(
      `Số lượng sản phẩm (${item.id}) phải là số nguyên dương <= ${MAX_PRINTQUOTE_QUANTITY}, nhận được: ${item.quantity}`,
    );
  }

  const resolvedArea = resolveAreaSpec(item.areaSpec, item.quantity, item.id, {
    requireAdjustmentReason: requireAreaAdjustmentReason,
    lineName: item.name,
  });
  const hasExtendedPricing =
    item.vendorCostMode !== undefined ||
    item.baseCostRate !== undefined ||
    resolvedArea !== null ||
    Boolean(item.finishingStages && item.finishingStages.length > 0);

  let unitVendorCost: number;
  let totalVendorCost: number;
  let baseVendorCost: number | undefined;
  let finishingVendorCost: number | undefined;
  let calculatedStages: CalculatedFinishingStage[] | undefined;
  let resolvedVendorCostMode: VendorCostModeType | undefined;
  let resolvedBaseRate: number | undefined;

  if (!hasExtendedPricing) {
    // 100% Legacy code path — preserves identical behavior & snapshot hash for existing V1/V2 quotes
    const hasUnitCost = item.unitVendorCost !== undefined;
    const hasTotalCost = item.totalVendorCost !== undefined;

    if (!hasUnitCost && !hasTotalCost) {
      throw new Error(
        `Dòng sản phẩm (${item.id}) phải cung cấp unitVendorCost hoặc totalVendorCost.`,
      );
    }

    if (hasUnitCost && hasTotalCost) {
      if (
        !Number.isFinite(item.unitVendorCost!) ||
        !Number.isFinite(item.totalVendorCost!) ||
        item.unitVendorCost! > MAX_PRINTQUOTE_RATE_VND ||
        item.totalVendorCost! > MAX_PRINTQUOTE_RATE_VND
      ) {
        throw new Error(
          `Giá vốn nhà in (${item.id}) phải là số hợp lệ <= ${MAX_PRINTQUOTE_RATE_VND}.`,
        );
      }
      if (item.unitVendorCost! < 0 || item.totalVendorCost! < 0) {
        throw new Error(`Giá vốn nhà in (${item.id}) không được âm.`);
      }
      const expectedTotal = Math.round(item.unitVendorCost! * item.quantity);
      const providedTotal = Math.round(item.totalVendorCost!);
      if (Math.abs(expectedTotal - providedTotal) > 1) {
        throw new Error(
          `Dòng (${item.id}) có unitVendorCost (${item.unitVendorCost}) * quantity (${item.quantity}) = ${expectedTotal} không khớp totalVendorCost (${providedTotal}).`,
        );
      }
      unitVendorCost = item.unitVendorCost!;
      totalVendorCost = providedTotal;
    } else if (hasUnitCost) {
      if (
        !Number.isFinite(item.unitVendorCost!) ||
        item.unitVendorCost! > MAX_PRINTQUOTE_RATE_VND
      ) {
        throw new Error(
          `Giá vốn đơn vị (${item.id}) phải là số hợp lệ <= ${MAX_PRINTQUOTE_RATE_VND}.`,
        );
      }
      if (item.unitVendorCost! < 0) {
        throw new Error(`Giá vốn đơn vị (${item.id}) không được âm.`);
      }
      unitVendorCost = item.unitVendorCost!;
      totalVendorCost = Math.round(unitVendorCost * item.quantity);
    } else {
      if (
        !Number.isFinite(item.totalVendorCost!) ||
        item.totalVendorCost! > MAX_PRINTQUOTE_RATE_VND
      ) {
        throw new Error(
          `Tổng giá vốn (${item.id}) phải là số hợp lệ <= ${MAX_PRINTQUOTE_RATE_VND}.`,
        );
      }
      if (item.totalVendorCost! < 0) {
        throw new Error(`Tổng giá vốn (${item.id}) không được âm.`);
      }
      totalVendorCost = Math.round(item.totalVendorCost!);
      unitVendorCost = totalVendorCost / item.quantity;
    }
  } else {
    resolvedVendorCostMode =
      item.vendorCostMode ??
      (item.totalVendorCost !== undefined && item.unitVendorCost === undefined
        ? VendorCostMode.TOTAL_BATCH
        : VendorCostMode.PER_UNIT);

    const candidateBaseRate =
      item.baseCostRate !== undefined
        ? item.baseCostRate
        : resolvedVendorCostMode === VendorCostMode.TOTAL_BATCH
          ? item.totalVendorCost
          : item.unitVendorCost;

    if (
      candidateBaseRate === undefined ||
      !Number.isFinite(candidateBaseRate) ||
      candidateBaseRate < 0 ||
      candidateBaseRate > MAX_PRINTQUOTE_RATE_VND
    ) {
      throw new Error(
        `Giá cơ bản của sản phẩm (${item.id}) phải là số hợp lệ trong khoảng [0, ${MAX_PRINTQUOTE_RATE_VND}].`,
      );
    }
    resolvedBaseRate = candidateBaseRate;

    if (resolvedVendorCostMode === VendorCostMode.PER_UNIT) {
      baseVendorCost = Math.round(resolvedBaseRate * item.quantity);
    } else if (resolvedVendorCostMode === VendorCostMode.PER_SQM) {
      if (!resolvedArea) {
        throw new Error(
          `Dòng (${item.id}) tính giá cơ bản theo m² phải có diện tích m² hợp lệ.`,
        );
      }
      baseVendorCost = multiplyRateByAreaSqmToVnd(
        resolvedBaseRate,
        resolvedArea.billableAreaSqm,
      );
    } else if (resolvedVendorCostMode === VendorCostMode.TOTAL_BATCH) {
      baseVendorCost = Math.round(resolvedBaseRate);
    } else {
      throw new Error(
        `Chế độ tính giá cơ bản không hợp lệ (${item.id}): ${String(resolvedVendorCostMode)}`,
      );
    }

    const stagesInput = item.finishingStages ?? [];
    calculatedStages = [];
    const seenPriceItemIds = new Set<string>();
    const seenStageNameKeys = new Set<string>();

    for (const stg of stagesInput) {
      const trimmedStageName = String(stg.name || '').trim();
      if (!trimmedStageName) {
        throw new Error(
          `Công đoạn gia công trên sản phẩm (${item.id}) phải có tên rõ ràng.`,
        );
      }
      if (stg.priceItemId) {
        if (seenPriceItemIds.has(stg.priceItemId)) {
          throw new Error(
            `Công đoạn gia công "${trimmedStageName}" bị chọn lặp trên cùng sản phẩm (${item.name}). Mỗi công đoạn chỉ được cộng một lần.`,
          );
        }
        seenPriceItemIds.add(stg.priceItemId);
      }
      const normNameKey = normalizeStageKey(trimmedStageName);
      if (normNameKey) {
        if (seenStageNameKeys.has(normNameKey)) {
          throw new Error(
            `Công đoạn gia công "${trimmedStageName}" bị nhập trùng trên cùng sản phẩm (${item.name}). Mỗi công đoạn chỉ được cộng một lần.`,
          );
        }
        seenStageNameKeys.add(normNameKey);
      }

      if (
        !Number.isFinite(stg.rate) ||
        stg.rate < 0 ||
        stg.rate > MAX_PRINTQUOTE_RATE_VND
      ) {
        throw new Error(
          `Giá công đoạn "${trimmedStageName}" trên sản phẩm (${item.id}) phải là số hợp lệ trong khoảng [0, ${MAX_PRINTQUOTE_RATE_VND}].`,
        );
      }

      let stageCost = 0;
      let resolvedStageArea: number | null = null;

      if (stg.pricingMode === VendorCostMode.PER_UNIT) {
        stageCost = Math.round(stg.rate * item.quantity);
      } else if (stg.pricingMode === VendorCostMode.PER_SQM) {
        const areaForStage =
          stg.billableAreaSqm !== undefined && stg.billableAreaSqm !== null
            ? normalizeAreaSqm(Number(stg.billableAreaSqm))
            : (resolvedArea?.billableAreaSqm ?? null);
        if (areaForStage === null || areaForStage <= 0) {
          throw new Error(
            `Công đoạn "${trimmedStageName}" (${item.id}) tính theo m² phải có diện tích m² hợp lệ.`,
          );
        }
        resolvedStageArea = areaForStage;
        stageCost = multiplyRateByAreaSqmToVnd(stg.rate, areaForStage);
      } else if (stg.pricingMode === VendorCostMode.TOTAL_BATCH) {
        stageCost = Math.round(stg.rate);
      } else {
        throw new Error(
          `Cách tính công đoạn "${trimmedStageName}" không hợp lệ: ${String(stg.pricingMode)}`,
        );
      }

      calculatedStages.push({
        id: stg.id,
        priceItemId: stg.priceItemId ?? null,
        code: stg.code ?? null,
        ...(stg.priceItemVersion !== undefined
          ? { priceItemVersion: stg.priceItemVersion }
          : {}),
        ...(stg.vendorId !== undefined ? { vendorId: stg.vendorId } : {}),
        ...(stg.vendorName !== undefined ? { vendorName: stg.vendorName } : {}),
        ...(stg.catalogOriginalRate !== undefined
          ? { catalogOriginalRate: stg.catalogOriginalRate }
          : {}),
        ...(stg.catalogBatchQuantity !== undefined
          ? { catalogBatchQuantity: stg.catalogBatchQuantity }
          : {}),
        ...(stg.appliedAt !== undefined ? { appliedAt: stg.appliedAt } : {}),
        name: trimmedStageName,
        pricingMode: stg.pricingMode,
        rate: stg.rate,
        unit:
          stg.unit ??
          (stg.pricingMode === VendorCostMode.PER_SQM
            ? 'm²'
            : (item.unit ?? 'tờ')),
        billableAreaSqm: resolvedStageArea,
        vendorCost: stageCost,
        costSource:
          stg.costSource ??
          (stg.priceItemId ? LineCostSource.CATALOG : LineCostSource.MANUAL),
        note: stg.note ?? null,
      });
    }

    finishingVendorCost = calculatedStages.reduce(
      (acc, s) => acc + s.vendorCost,
      0,
    );
    totalVendorCost = baseVendorCost + finishingVendorCost;
    unitVendorCost =
      resolvedVendorCostMode === VendorCostMode.PER_UNIT &&
      calculatedStages.length === 0
        ? resolvedBaseRate
        : totalVendorCost / item.quantity;
  }

  const profitConfig = item.profit ?? defaultProfit;
  if (!profitConfig) {
    throw new Error(
      `Dòng sản phẩm (${item.id}) chưa có cấu hình lợi nhuận (profit hoặc defaultProfit).`,
    );
  }
  const maxAllowedProfitVal =
    profitConfig.mode === ProfitMode.PERCENTAGE
      ? MAX_PRINTQUOTE_PERCENT
      : MAX_PRINTQUOTE_RATE_VND;
  if (
    !Number.isFinite(profitConfig.value) ||
    profitConfig.value < 0 ||
    profitConfig.value > maxAllowedProfitVal
  ) {
    throw new Error(
      `Giá trị lợi nhuận của dòng (${item.id}) phải nằm trong khoảng [0, ${maxAllowedProfitVal}], nhận được: ${profitConfig.value}`,
    );
  }

  let unitProfit: number;
  let totalProfit: number;
  let profitBasis: ProfitBasisType | undefined;

  if (profitConfig.mode === ProfitMode.FIXED_AMOUNT) {
    if (profitConfig.scope === ProfitScope.PER_UNIT) {
      unitProfit = profitConfig.value;
      totalProfit = Math.round(profitConfig.value * item.quantity);
    } else if (profitConfig.scope === ProfitScope.PER_SQM) {
      if (!resolvedArea) {
        throw new Error(
          `Dòng (${item.id}) tính lợi nhuận theo m² phải có diện tích m² hợp lệ.`,
        );
      }
      totalProfit = multiplyRateByAreaSqmToVnd(
        profitConfig.value,
        resolvedArea.billableAreaSqm,
      );
      unitProfit = totalProfit / item.quantity;
    } else if (profitConfig.scope === ProfitScope.TOTAL_BATCH) {
      totalProfit = Math.round(profitConfig.value);
      unitProfit = totalProfit / item.quantity;
    } else {
      throw new Error(
        `ProfitScope không hợp lệ: ${String(profitConfig.scope)}`,
      );
    }
  } else if (profitConfig.mode === ProfitMode.PERCENTAGE) {
    if (
      profitConfig.scope === ProfitScope.PER_UNIT ||
      profitConfig.scope === ProfitScope.PER_SQM ||
      profitConfig.scope === ProfitScope.TOTAL_BATCH
    ) {
      profitBasis = ProfitBasis.LINE_TOTAL_VENDOR_COST;
      totalProfit = Math.round((totalVendorCost * profitConfig.value) / 100);
      unitProfit =
        profitConfig.scope === ProfitScope.PER_UNIT
          ? (unitVendorCost * profitConfig.value) / 100
          : totalProfit / item.quantity;
    } else {
      throw new Error(
        `ProfitScope không hợp lệ: ${String(profitConfig.scope)}`,
      );
    }
  } else {
    throw new Error(`ProfitMode không hợp lệ: ${String(profitConfig.mode)}`);
  }

  const lineExtraCost = Math.round(item.extraCost ?? 0);
  if (lineExtraCost < 0 || lineExtraCost > MAX_PRINTQUOTE_RATE_VND) {
    throw new Error(
      `Chi phí phát sinh dòng (${item.id}) phải nằm trong khoảng [0, ${MAX_PRINTQUOTE_RATE_VND}].`,
    );
  }

  return {
    ...(hasExtendedPricing
      ? {
          vendorCostMode: resolvedVendorCostMode,
          baseCostRate: resolvedBaseRate,
          baseCostSource:
            item.baseCostSource ??
            (item.vendorPriceItemId
              ? LineCostSource.CATALOG
              : LineCostSource.MANUAL),
          ...(item.baseIncludedStages && item.baseIncludedStages.length > 0
            ? { baseIncludedStages: [...item.baseIncludedStages] }
            : {}),
          baseVendorCost,
          finishingVendorCost,
          finishingStages: calculatedStages,
          areaSpec: resolvedArea,
        }
      : {}),
    unitVendorCost,
    totalVendorCost,
    profitConfig,
    ...(profitBasis !== undefined ? { profitBasis } : {}),
    unitProfit,
    totalProfit,
    lineExtraCost,
  };
}

function buildExactSplitSchedule(
  quantity: number,
  finalUnitPrice: number,
  roundingAdjustment: number,
  targetLineTotal: number,
): ExactUnitPriceSplitSegment[] {
  if (roundingAdjustment === 0 || quantity === 1) {
    const effectiveUnitPrice =
      quantity === 1 ? targetLineTotal : finalUnitPrice;
    return [
      {
        quantity,
        unitPrice: effectiveUnitPrice,
        subtotal: targetLineTotal,
      },
    ];
  }

  const mainQty = quantity - 1;
  const mainSubtotal = mainQty * finalUnitPrice;
  const lastUnitPrice = targetLineTotal - mainSubtotal;

  return [
    {
      quantity: mainQty,
      unitPrice: finalUnitPrice,
      subtotal: mainSubtotal,
    },
    {
      quantity: 1,
      unitPrice: lastUnitPrice,
      subtotal: lastUnitPrice,
    },
  ];
}

export function calculatePrintQuote(
  input: QuoteCalculationInput,
): QuoteCalculationResult {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Đơn báo giá phải có ít nhất 1 dòng sản phẩm.');
  }

  const shippingFee = Math.round(input.shippingFee ?? 0);
  if (
    !Number.isFinite(shippingFee) ||
    shippingFee < 0 ||
    shippingFee > MAX_PRINTQUOTE_RATE_VND
  ) {
    throw new Error(
      `Chi phí vận chuyển (shippingFee) phải nằm trong khoảng [0, ${MAX_PRINTQUOTE_RATE_VND}].`,
    );
  }

  const orderExtraCost = Math.round(input.extraCost ?? 0);
  if (
    !Number.isFinite(orderExtraCost) ||
    orderExtraCost < 0 ||
    orderExtraCost > MAX_PRINTQUOTE_RATE_VND
  ) {
    throw new Error(
      `Chi phí phát sinh đơn hàng (extraCost) phải nằm trong khoảng [0, ${MAX_PRINTQUOTE_RATE_VND}].`,
    );
  }

  const includeShippingInUnitPrice = input.includeShippingInUnitPrice ?? true;
  const shippingAllocationStrategy: ShippingAllocationStrategyType =
    input.shippingAllocationStrategy ??
    ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT;

  const roundingPolicy: Required<UnitPriceRoundingPolicy> = {
    mode: input.roundingPolicy?.mode ?? RoundingMode.NEAREST,
    step: input.roundingPolicy?.step ?? 1,
  };

  const prelimLines = input.items.map((item) => {
    const resolved = resolveLineCostAndProfit(
      item,
      input.defaultProfit,
      input.requireAreaAdjustmentReason,
    );
    const prelimBase =
      resolved.totalVendorCost + resolved.totalProfit + resolved.lineExtraCost;
    return {
      item,
      ...resolved,
      prelimBase,
    };
  });

  const getAllocationWeights = (
    strategy: ShippingAllocationStrategyType,
    bases: readonly number[],
  ): number[] => {
    switch (strategy) {
      case ShippingAllocationStrategy.PROPORTIONAL_BY_QUANTITY:
        return prelimLines.map((l) => l.item.quantity);
      case ShippingAllocationStrategy.EQUAL_SPLIT:
        return prelimLines.map(() => 1);
      case ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT:
      default: {
        const sumBases = bases.reduce((acc, b) => acc + b, 0);
        if (sumBases <= 0) {
          return prelimLines.map((l) => l.item.quantity);
        }
        return [...bases];
      }
    }
  };

  const initialWeights = getAllocationWeights(
    shippingAllocationStrategy,
    prelimLines.map((l) => l.prelimBase),
  );

  const allocatedOrderExtras = allocateIntegerAmount(
    orderExtraCost,
    initialWeights,
  );

  const baseLineAmountsBeforeShipping = prelimLines.map(
    (l, idx) => l.prelimBase + (allocatedOrderExtras[idx] ?? 0),
  );

  const shippingWeights = getAllocationWeights(
    shippingAllocationStrategy,
    baseLineAmountsBeforeShipping,
  );
  const allocatedShippingFees = allocateIntegerAmount(
    shippingFee,
    shippingWeights,
  );

  const lines: QuoteLineBreakdown[] = prelimLines.map((l, idx) => {
    const allocatedOrderExtraCost = allocatedOrderExtras[idx] ?? 0;
    const totalLineExtraCost = l.lineExtraCost + allocatedOrderExtraCost;
    const baseLineAmountBeforeShipping =
      baseLineAmountsBeforeShipping[idx] ?? 0;
    const allocatedShippingFee = allocatedShippingFees[idx] ?? 0;

    const targetLineTotal = includeShippingInUnitPrice
      ? baseLineAmountBeforeShipping + allocatedShippingFee
      : baseLineAmountBeforeShipping;

    const rawFinalUnitPrice = targetLineTotal / l.item.quantity;
    const finalUnitPrice = roundByPolicy(
      rawFinalUnitPrice,
      roundingPolicy.mode,
      roundingPolicy.step,
    );

    const billedLineSubtotal = finalUnitPrice * l.item.quantity;
    const roundingAdjustment = targetLineTotal - billedLineSubtotal;
    const reconciledLineTotal = billedLineSubtotal + roundingAdjustment;

    const exactSplitSchedule = buildExactSplitSchedule(
      l.item.quantity,
      finalUnitPrice,
      roundingAdjustment,
      targetLineTotal,
    );

    return {
      id: l.item.id,
      name: l.item.name,
      specification: l.item.specification ?? '',
      vendorId: l.item.vendorId ?? null,
      vendorName: l.item.vendorName ?? null,
      vendorPriceItemId: l.item.vendorPriceItemId ?? null,
      ...(l.item.vendorPriceItemCode !== undefined
        ? { vendorPriceItemCode: l.item.vendorPriceItemCode }
        : {}),
      ...(l.item.vendorPriceItemVersion !== undefined
        ? { vendorPriceItemVersion: l.item.vendorPriceItemVersion }
        : {}),
      ...(l.item.catalogOriginalRate !== undefined
        ? { catalogOriginalRate: l.item.catalogOriginalRate }
        : {}),
      ...(l.item.catalogBatchQuantity !== undefined
        ? { catalogBatchQuantity: l.item.catalogBatchQuantity }
        : {}),
      ...(l.item.priceAppliedAt !== undefined
        ? { priceAppliedAt: l.item.priceAppliedAt }
        : {}),
      unit: l.item.unit ?? 'tờ',
      quantity: l.item.quantity,
      ...(l.vendorCostMode !== undefined
        ? {
            vendorCostMode: l.vendorCostMode,
            baseCostRate: l.baseCostRate,
            baseCostSource: l.baseCostSource,
            ...(l.baseIncludedStages
              ? { baseIncludedStages: l.baseIncludedStages }
              : {}),
            baseVendorCost: l.baseVendorCost,
            finishingVendorCost: l.finishingVendorCost,
            finishingStages: l.finishingStages,
            areaSpec: l.areaSpec ?? null,
          }
        : {}),
      unitVendorCost: l.unitVendorCost,
      totalVendorCost: l.totalVendorCost,
      profitMode: l.profitConfig.mode,
      profitScope: l.profitConfig.scope,
      ...(l.profitBasis !== undefined ? { profitBasis: l.profitBasis } : {}),
      profitInputValue: l.profitConfig.value,
      unitProfit: l.unitProfit,
      totalProfit: l.totalProfit,
      lineExtraCost: l.lineExtraCost,
      allocatedOrderExtraCost,
      totalExtraCost: totalLineExtraCost,
      baseLineAmountBeforeShipping,
      allocatedShippingFee,
      shippingIncludedInUnitPrice: includeShippingInUnitPrice,
      targetLineTotal,
      rawFinalUnitPrice,
      finalUnitPrice,
      billedLineSubtotal,
      roundingAdjustment,
      reconciledLineTotal,
      exactSplitSchedule,
    };
  });

  const totalQuantity = lines.reduce((acc, l) => acc + l.quantity, 0);
  const totalVendorCost = lines.reduce((acc, l) => acc + l.totalVendorCost, 0);
  const totalProfit = lines.reduce((acc, l) => acc + l.totalProfit, 0);
  const lineExtraCostTotal = lines.reduce((acc, l) => acc + l.lineExtraCost, 0);
  const totalExtraCost = lineExtraCostTotal + orderExtraCost;

  const totalQuoteAmount =
    totalVendorCost + totalProfit + shippingFee + totalExtraCost;

  const singleProductFinalUnitPrice =
    lines.length === 1 ? lines[0]!.finalUnitPrice : null;

  const totalAllocatedShippingFee = lines.reduce(
    (acc, l) => acc + l.allocatedShippingFee,
    0,
  );
  const totalBilledLinesSubtotal = lines.reduce(
    (acc, l) => acc + l.billedLineSubtotal,
    0,
  );
  const totalRoundingAdjustment = lines.reduce(
    (acc, l) => acc + l.roundingAdjustment,
    0,
  );
  const totalReconciledLinesAmount = lines.reduce(
    (acc, l) => acc + l.reconciledLineTotal,
    0,
  );

  const unmergedShippingFee = includeShippingInUnitPrice ? 0 : shippingFee;
  const reconciliationDelta =
    totalQuoteAmount - (totalReconciledLinesAmount + unmergedShippingFee);
  const isReconciled =
    reconciliationDelta === 0 && totalAllocatedShippingFee === shippingFee;

  return {
    quoteId: input.quoteId ?? `PQ-${Date.now()}`,
    customerName: input.customerName ?? 'Khách hàng',
    calculatedAt: new Date().toISOString(),
    includeShippingInUnitPrice,
    shippingAllocationStrategy,
    roundingPolicy,
    totalQuantity,
    totalVendorCost,
    totalProfit,
    shippingFee,
    lineExtraCostTotal,
    orderExtraCost,
    totalExtraCost,
    totalQuoteAmount,
    singleProductFinalUnitPrice,
    totalAllocatedShippingFee,
    totalBilledLinesSubtotal,
    totalRoundingAdjustment,
    totalReconciledLinesAmount,
    unmergedShippingFee,
    isReconciled,
    reconciliationDelta,
    lines,
  };
}

export function buildPdfQuotePayload(
  quote: QuoteCalculationResult,
): QuotePdfPayload {
  const pdfLines: QuotePdfLineItem[] = quote.lines.map((line, idx) => {
    const unitNorm = line.unit.trim().toLowerCase();
    const isSqmUnit = unitNorm === 'm²' || unitNorm === 'm2';
    const displayAreaSqm =
      isSqmUnit && line.areaSpec && line.areaSpec.billableAreaSqm > 0
        ? line.areaSpec.billableAreaSqm
        : undefined;

    return {
      index: idx + 1,
      id: line.id,
      name: line.name,
      specification: line.specification,
      unit: line.unit,
      quantity: line.quantity,
      ...(displayAreaSqm !== undefined ? { displayAreaSqm } : {}),
      unitPrice: line.finalUnitPrice,
      billedSubtotal: line.billedLineSubtotal,
      roundingAdjustment: line.roundingAdjustment,
      lineTotal: line.reconciledLineTotal,
      shippingIncludedInUnitPrice: line.shippingIncludedInUnitPrice,
    };
  });

  const subtotalFromLines = pdfLines.reduce(
    (acc, l) => acc + l.billedSubtotal,
    0,
  );
  const totalRoundingAdjustment = pdfLines.reduce(
    (acc, l) => acc + l.roundingAdjustment,
    0,
  );

  const shippingAmountToAddOnPdfFooter = quote.includeShippingInUnitPrice
    ? 0
    : quote.shippingFee;

  const shippingFooterNote = quote.includeShippingInUnitPrice
    ? 'Đã bao gồm trong đơn giá sản phẩm (Không cộng thêm)'
    : 'Cước vận chuyển toàn đơn (Cộng 1 lần)';

  const grandTotalPayable =
    subtotalFromLines +
    totalRoundingAdjustment +
    shippingAmountToAddOnPdfFooter;

  if (grandTotalPayable !== quote.totalQuoteAmount) {
    throw new Error(
      `Lỗi đối soát PDF: grandTotalPayable (${grandTotalPayable}) != totalQuoteAmount (${quote.totalQuoteAmount})`,
    );
  }

  return {
    quoteId: quote.quoteId,
    customerName: quote.customerName,
    generatedAt: new Date().toISOString(),
    includeShippingInUnitPrice: quote.includeShippingInUnitPrice,
    lines: pdfLines,
    subtotalFromLines,
    totalRoundingAdjustment,
    originalShippingFee: quote.shippingFee,
    shippingAmountToAddOnPdfFooter,
    shippingFooterNote,
    grandTotalPayable,
  };
}

export const FORBIDDEN_CUSTOMER_PDF_KEYS = new Set([
  'unitVendorCost',
  'totalVendorCost',
  'baseCostRate',
  'baseCostSource',
  'baseCostPending',
  'baseVendorCost',
  'finishingVendorCost',
  'finishingStages',
  'stageVendorCost',
  'vendorCost',
  'costSource',
  'baseIncludedStages',
  'includedStages',
  'conditionsNote',
  'internalNote',
  'internalNotes',
  'pricingStatus',
  'pendingCostSummary',
  'isPendingCost',
  'profitMode',
  'profitScope',
  'profitBasis',
  'profitInputValue',
  'unitProfit',
  'totalProfit',
  'vendorId',
  'vendorName',
  'vendorPriceItemId',
  'vendorPriceItemCode',
  'vendorPriceItemVersion',
  'priceItemVersion',
  'catalogOriginalRate',
  'catalogBatchQuantity',
  'priceAppliedAt',
  'adjustmentReason',
  'expected_vendor_cost',
  'expected_profit',
  'entered_vendor_cost',
  'entered_shipping_fee',
  'entered_extra_cost',
  'cost_reconciliation_status',
  'cost_history',
  'legacy_raw_actual_costs',
  'actual_vendor_cost',
  'actual_profit',
  'actual_cost_confirmed',
  'vendor_paid_amount',
  'originalShippingFee',
  'allocatedShippingFee',
  'lineExtraCost',
  'allocatedOrderExtraCost',
  'totalExtraCost',
]);

export function assertCustomerSafePdfPayload(payload: unknown): void {
  const visit = (node: unknown, path: string): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_CUSTOMER_PDF_KEYS.has(k)) {
        throw new Error(
          `[PDF Security Guard] Forbidden internal cost/profit field "${k}" detected at ${path}.${k}`,
        );
      }
      visit(v, `${path}.${k}`);
    }
  };
  visit(payload, 'root');
}

export function buildCustomerSafePdfPayload(
  quote: QuoteCalculationResult,
  meta?: {
    quoteCode?: string | undefined;
    customerPhone?: string | null | undefined;
    customerAddress?: string | null | undefined;
    validUntil?: string | null | undefined;
    notes?: string | null | undefined;
  },
): CustomerSafePdfPayload {
  const basePdf = buildPdfQuotePayload(quote);
  const safePayload: CustomerSafePdfPayload = {
    quoteId: basePdf.quoteId,
    quoteCode: meta?.quoteCode ?? basePdf.quoteId,
    customerName: basePdf.customerName,
    customerPhone: meta?.customerPhone ?? null,
    customerAddress: meta?.customerAddress ?? null,
    generatedAt: basePdf.generatedAt,
    validUntil: meta?.validUntil ?? null,
    notes: meta?.notes ?? null,
    includeShippingInUnitPrice: basePdf.includeShippingInUnitPrice,
    lines: basePdf.lines.map((l) => ({
      index: l.index,
      id: l.id,
      name: l.name,
      specification: l.specification ?? '',
      unit: l.unit,
      quantity: l.quantity,
      ...(l.displayAreaSqm !== undefined
        ? { displayAreaSqm: l.displayAreaSqm }
        : {}),
      unitPrice: l.unitPrice,
      billedSubtotal: l.billedSubtotal,
      roundingAdjustment: l.roundingAdjustment,
      lineTotal: l.lineTotal,
      shippingIncludedInUnitPrice: l.shippingIncludedInUnitPrice,
    })),
    subtotalFromLines: basePdf.subtotalFromLines,
    totalRoundingAdjustment: basePdf.totalRoundingAdjustment,
    shippingAmountToAddOnPdfFooter: basePdf.shippingAmountToAddOnPdfFooter,
    shippingFooterNote: basePdf.shippingFooterNote,
    grandTotalPayable: basePdf.grandTotalPayable,
  };
  assertCustomerSafePdfPayload(safePayload);
  return safePayload;
}

function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const value = (obj as Record<string, unknown>)[key];
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        deepFreeze(value);
      }
    }
  }
  return obj;
}

export function computeQuoteSnapshotHash(
  snapshotWithoutHash: Omit<PersistedQuoteOrderSnapshot, 'integrityHash'>,
): string {
  const hasExtendedSnapshotFields =
    snapshotWithoutHash.pricingStatus === QuotePricingStatus.PENDING_COST ||
    snapshotWithoutHash.lines.some(
      (l) =>
        l.vendorCostMode !== undefined ||
        l.isPendingCost === true ||
        Boolean(l.finishingStages && l.finishingStages.length > 0) ||
        Boolean(l.areaSpec),
    );

  const canonicalPayload = JSON.stringify({
    orderId: snapshotWithoutHash.orderId,
    quoteId: snapshotWithoutHash.quoteId,
    customerName: snapshotWithoutHash.customerName,
    status: snapshotWithoutHash.status,
    ...(hasExtendedSnapshotFields
      ? {
          pricingStatus:
            snapshotWithoutHash.pricingStatus ?? QuotePricingStatus.COMPLETE,
        }
      : {}),
    includeShippingInUnitPrice: snapshotWithoutHash.includeShippingInUnitPrice,
    shippingAllocationStrategy: snapshotWithoutHash.shippingAllocationStrategy,
    totalVendorCost: snapshotWithoutHash.totalVendorCost,
    totalProfit: snapshotWithoutHash.totalProfit,
    shippingFee: snapshotWithoutHash.shippingFee,
    totalExtraCost: snapshotWithoutHash.totalExtraCost,
    finalUnitPrice: snapshotWithoutHash.finalUnitPrice,
    totalQuoteAmount: snapshotWithoutHash.totalQuoteAmount,
    totalRoundingAdjustment: snapshotWithoutHash.totalRoundingAdjustment,
    lines: snapshotWithoutHash.lines.map((l) => ({
      id: l.id,
      name: l.name,
      unit: l.unit,
      quantity: l.quantity,
      ...(hasExtendedSnapshotFields
        ? {
            vendorCostMode: l.vendorCostMode ?? null,
            baseCostRate: l.baseCostRate ?? null,
            baseCostPending: l.baseCostPending ?? false,
            baseVendorCost: l.baseVendorCost ?? null,
            finishingVendorCost: l.finishingVendorCost ?? null,
            finishingStages: (l.finishingStages ?? []).map((s) => ({
              id: s.id,
              priceItemId: s.priceItemId ?? null,
              name: s.name,
              pricingMode: s.pricingMode,
              rate: s.rate,
              vendorCost: 'vendorCost' in s ? s.vendorCost : null,
            })),
            areaSpec: l.areaSpec ?? null,
            isPendingCost: l.isPendingCost ?? false,
          }
        : {}),
      unitVendorCost: l.unitVendorCost,
      totalVendorCost: l.totalVendorCost,
      profitMode: l.profitMode,
      profitScope: l.profitScope,
      profitInputValue: l.profitInputValue,
      unitProfit: l.unitProfit,
      totalProfit: l.totalProfit,
      allocatedShippingFee: l.allocatedShippingFee,
      totalExtraCost: l.totalExtraCost,
      rawFinalUnitPrice: l.rawFinalUnitPrice,
      finalUnitPrice: l.finalUnitPrice,
      billedLineSubtotal: l.billedLineSubtotal,
      roundingAdjustment: l.roundingAdjustment,
      reconciledLineTotal: l.reconciledLineTotal,
    })),
  });

  return sha256Hex(canonicalPayload);
}

export function createQuoteOrderSnapshot(
  quote: QuoteCalculationResult,
  options?: {
    orderId?: string | undefined;
    status?: QuoteOrderStatusType | undefined;
    createdAt?: string | undefined;
    finalizedAt?: string | null | undefined;
  },
): PersistedQuoteOrderSnapshot {
  const status = options?.status ?? QuoteOrderStatus.DRAFT;
  const nowIso = new Date().toISOString();
  const createdAt = options?.createdAt ?? nowIso;
  const finalizedAt =
    status === QuoteOrderStatus.FINALIZED
      ? (options?.finalizedAt ?? nowIso)
      : null;

  const persistedLines: PersistedQuoteLineSnapshot[] = quote.lines.map(
    (line) => ({
      id: line.id,
      name: line.name,
      specification: line.specification,
      vendorId: line.vendorId,
      vendorName: line.vendorName,
      vendorPriceItemId: line.vendorPriceItemId,
      ...(line.vendorPriceItemCode !== undefined
        ? { vendorPriceItemCode: line.vendorPriceItemCode }
        : {}),
      ...(line.vendorPriceItemVersion !== undefined
        ? { vendorPriceItemVersion: line.vendorPriceItemVersion }
        : {}),
      ...(line.catalogOriginalRate !== undefined
        ? { catalogOriginalRate: line.catalogOriginalRate }
        : {}),
      ...(line.catalogBatchQuantity !== undefined
        ? { catalogBatchQuantity: line.catalogBatchQuantity }
        : {}),
      ...(line.priceAppliedAt !== undefined
        ? { priceAppliedAt: line.priceAppliedAt }
        : {}),
      unit: line.unit,
      quantity: line.quantity,
      ...(line.vendorCostMode !== undefined
        ? {
            vendorCostMode: line.vendorCostMode,
            baseCostRate: line.baseCostRate ?? null,
            baseCostPending: false,
            baseCostSource: line.baseCostSource,
            ...(line.baseIncludedStages
              ? { baseIncludedStages: line.baseIncludedStages }
              : {}),
            baseVendorCost: line.baseVendorCost ?? null,
            finishingVendorCost: line.finishingVendorCost ?? null,
            finishingStages: line.finishingStages,
            areaSpec: line.areaSpec ?? null,
            isPendingCost: false,
          }
        : {}),
      unitVendorCost: line.unitVendorCost,
      totalVendorCost: line.totalVendorCost,
      profitMode: line.profitMode,
      profitScope: line.profitScope,
      ...(line.profitBasis !== undefined
        ? { profitBasis: line.profitBasis }
        : {}),
      profitInputValue: line.profitInputValue,
      unitProfit: line.unitProfit,
      totalProfit: line.totalProfit,
      allocatedShippingFee: line.allocatedShippingFee,
      totalExtraCost: line.totalExtraCost,
      rawFinalUnitPrice: line.rawFinalUnitPrice,
      finalUnitPrice: line.finalUnitPrice,
      billedLineSubtotal: line.billedLineSubtotal,
      roundingAdjustment: line.roundingAdjustment,
      reconciledLineTotal: line.reconciledLineTotal,
    }),
  );

  const pdfPayload = buildPdfQuotePayload(quote);

  const baseSnapshot: Omit<PersistedQuoteOrderSnapshot, 'integrityHash'> = {
    orderId: options?.orderId ?? `ORD-${quote.quoteId}`,
    quoteId: quote.quoteId,
    customerName: quote.customerName,
    status,
    createdAt,
    finalizedAt,
    includeShippingInUnitPrice: quote.includeShippingInUnitPrice,
    shippingAllocationStrategy: quote.shippingAllocationStrategy,
    totalVendorCost: quote.totalVendorCost,
    totalProfit: quote.totalProfit,
    shippingFee: quote.shippingFee,
    totalExtraCost: quote.totalExtraCost,
    finalUnitPrice: quote.singleProductFinalUnitPrice,
    totalQuoteAmount: quote.totalQuoteAmount,
    totalRoundingAdjustment: quote.totalRoundingAdjustment,
    lines: persistedLines,
    pdfPayload,
  };

  const integrityHash = computeQuoteSnapshotHash(baseSnapshot);
  const fullSnapshot: PersistedQuoteOrderSnapshot = {
    ...baseSnapshot,
    integrityHash,
  };

  return status === QuoteOrderStatus.FINALIZED
    ? deepFreeze(fullSnapshot)
    : fullSnapshot;
}

export interface PendingCostDraftLineInput {
  id: string;
  name: string;
  specification?: string | undefined;
  vendorId?: string | null | undefined;
  vendorName?: string | null | undefined;
  vendorPriceItemId?: string | null | undefined;
  vendorPriceItemCode?: string | null | undefined;
  vendorPriceItemVersion?: number | null | undefined;
  catalogOriginalRate?: number | null | undefined;
  catalogBatchQuantity?: number | null | undefined;
  priceAppliedAt?: string | null | undefined;
  unit?: string | undefined;
  quantity: number;
  vendorCostMode?: VendorCostModeType | undefined;
  /** null means missing ("Chờ giá xưởng"); 0 means explicit 0đ */
  baseCostRate: number | null;
  baseCostSource?: LineCostSourceType | undefined;
  baseIncludedStages?: readonly string[] | undefined;
  areaSpec?: QuoteAreaSpecInput | null | undefined;
  finishingStages?: readonly PendingCostDraftStageSnapshot[] | undefined;
  profit?: ProfitConfig | undefined;
}

/**
 * Evaluates whether any line in a draft has missing vendor cost (null !== 0),
 * validates structural fields (quantity, dimensions, non-negative numbers on filled fields,
 * no duplicate finishing stages), and returns pending cost summaries.
 */
export function evaluatePendingCostDraftLines(
  lines: readonly PendingCostDraftLineInput[],
  options?: {
    requireAreaAdjustmentReason?: boolean | undefined;
  },
): {
  hasPendingCost: boolean;
  pendingSummary: PendingCostLineSummary[];
  resolvedAreas: (QuoteAreaSpec | null)[];
} {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Đơn báo giá phải có ít nhất 1 dòng sản phẩm.');
  }
  const pendingSummary: PendingCostLineSummary[] = [];
  const resolvedAreas: (QuoteAreaSpec | null)[] = [];

  for (const item of lines) {
    if (!item.id || !String(item.name || '').trim()) {
      throw new Error('Mỗi dòng sản phẩm phải có tên sản phẩm.');
    }
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > MAX_PRINTQUOTE_QUANTITY
    ) {
      throw new Error(
        `Số lượng sản phẩm "${item.name}" phải là số nguyên dương <= ${MAX_PRINTQUOTE_QUANTITY}.`,
      );
    }
    const lineCostMode = item.vendorCostMode ?? VendorCostMode.PER_UNIT;
    const lineProfit: ProfitConfig = item.profit ?? {
      mode: ProfitMode.FIXED_AMOUNT,
      scope: ProfitScope.PER_UNIT,
      value: 0,
    };
    const resolvedArea = resolveAreaSpec(
      item.areaSpec,
      item.quantity,
      item.id,
      {
        requireAdjustmentReason: options?.requireAreaAdjustmentReason,
        lineName: item.name,
      },
    );
    if (lineCostMode === VendorCostMode.PER_SQM && !resolvedArea) {
      throw new Error(
        `Sản phẩm "${item.name}" tính theo m² phải nhập kích thước hoặc tổng m² hợp lệ.`,
      );
    }
    resolvedAreas.push(resolvedArea);

    if (
      item.baseCostRate !== null &&
      (!Number.isFinite(item.baseCostRate) ||
        item.baseCostRate < 0 ||
        item.baseCostRate > MAX_PRINTQUOTE_RATE_VND)
    ) {
      throw new Error(
        `Giá cơ bản của sản phẩm "${item.name}" phải nằm trong khoảng [0, ${MAX_PRINTQUOTE_RATE_VND}].`,
      );
    }
    const maxProfit =
      lineProfit.mode === ProfitMode.PERCENTAGE
        ? MAX_PRINTQUOTE_PERCENT
        : MAX_PRINTQUOTE_RATE_VND;
    if (
      !Number.isFinite(lineProfit.value) ||
      lineProfit.value < 0 ||
      lineProfit.value > maxProfit
    ) {
      throw new Error(
        `Giá trị lợi nhuận của sản phẩm "${item.name}" phải nằm trong khoảng [0, ${maxProfit}].`,
      );
    }
    if (
      lineProfit.mode === ProfitMode.FIXED_AMOUNT &&
      lineProfit.scope === ProfitScope.PER_SQM &&
      !resolvedArea
    ) {
      throw new Error(
        `Sản phẩm "${item.name}" tính lợi nhuận theo m² phải có diện tích m² hợp lệ.`,
      );
    }

    const missingBaseCost = item.baseCostRate === null;
    const missingStageNames: string[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    for (const stg of item.finishingStages ?? []) {
      const sName = String(stg.name || '').trim();
      if (!sName) {
        throw new Error(
          `Công đoạn gia công trên "${item.name}" phải có tên rõ ràng.`,
        );
      }
      if (stg.priceItemId) {
        if (seenIds.has(stg.priceItemId)) {
          throw new Error(
            `Công đoạn "${sName}" bị chọn lặp trên cùng sản phẩm "${item.name}".`,
          );
        }
        seenIds.add(stg.priceItemId);
      }
      const normKey = normalizeStageKey(sName);
      if (normKey) {
        if (seenNames.has(normKey)) {
          throw new Error(
            `Công đoạn "${sName}" bị nhập trùng trên cùng sản phẩm "${item.name}".`,
          );
        }
        seenNames.add(normKey);
      }
      if (
        stg.pricingMode === VendorCostMode.PER_SQM &&
        !resolvedArea &&
        (stg.billableAreaSqm === undefined ||
          stg.billableAreaSqm === null ||
          stg.billableAreaSqm <= 0)
      ) {
        throw new Error(
          `Công đoạn "${sName}" tính theo m² phải có diện tích m² hợp lệ.`,
        );
      }
      if (stg.rate === null) {
        missingStageNames.push(sName);
      } else if (!Number.isFinite(stg.rate) || stg.rate < 0) {
        throw new Error(
          `Giá công đoạn "${sName}" trên "${item.name}" không được âm.`,
        );
      }
    }

    if (missingBaseCost || missingStageNames.length > 0) {
      pendingSummary.push({
        lineId: item.id,
        lineName: item.name,
        missingBaseCost,
        missingStageNames,
      });
    }
  }

  return {
    hasPendingCost: pendingSummary.length > 0,
    pendingSummary,
    resolvedAreas,
  };
}

/**
 * Builds an incomplete "Chờ giá xưởng" (PENDING_COST) draft snapshot WITHOUT
 * fabricating fake completed vendor cost, profit, or customer selling totals,
 * and sets pdfPayload = null so no customer PDF can be generated from it.
 */
export function createPendingCostQuoteSnapshot(params: {
  quoteId: string;
  orderId?: string | undefined;
  customerName: string;
  includeShippingInUnitPrice: boolean;
  shippingAllocationStrategy: ShippingAllocationStrategyType;
  shippingFee: number;
  lines: readonly PendingCostDraftLineInput[];
  createdAt?: string | undefined;
  requireAreaAdjustmentReason?: boolean | undefined;
}): {
  snapshot: PersistedQuoteOrderSnapshot;
  pendingSummary: PendingCostLineSummary[];
  totalQuantity: number;
} {
  const shippingFee = Math.round(params.shippingFee ?? 0);
  if (
    !Number.isFinite(shippingFee) ||
    shippingFee < 0 ||
    shippingFee > MAX_PRINTQUOTE_RATE_VND
  ) {
    throw new Error(
      `Chi phí vận chuyển (shippingFee) phải nằm trong khoảng [0, ${MAX_PRINTQUOTE_RATE_VND}].`,
    );
  }
  const evalResult = evaluatePendingCostDraftLines(params.lines, {
    requireAreaAdjustmentReason: params.requireAreaAdjustmentReason,
  });
  if (!evalResult.hasPendingCost) {
    throw new Error(
      'Tất cả sản phẩm đã có đủ giá xưởng — vui lòng dùng calculatePrintQuote để tính báo giá hoàn chỉnh.',
    );
  }

  const nowIso = params.createdAt ?? new Date().toISOString();
  const persistedLines: PersistedQuoteLineSnapshot[] = params.lines.map(
    (line, idx) => {
      const resolvedArea = evalResult.resolvedAreas[idx] ?? null;
      const lineMissing = evalResult.pendingSummary.some(
        (s) => s.lineId === line.id,
      );

      // Compute individual stage costs ONLY for stages that already have a numeric rate;
      // keep rate: null for pending stages, and NEVER compute fake completed line totals when pending.
      const stageSnapshots: (
        CalculatedFinishingStage | PendingCostDraftStageSnapshot
      )[] = (line.finishingStages ?? []).map((stg) => {
        if (stg.rate === null) {
          return {
            id: stg.id,
            priceItemId: stg.priceItemId ?? null,
            code: stg.code ?? null,
            name: stg.name.trim(),
            pricingMode: stg.pricingMode,
            rate: null,
            unit:
              stg.unit ??
              (stg.pricingMode === VendorCostMode.PER_SQM
                ? 'm²'
                : (line.unit ?? 'tờ')),
            billableAreaSqm:
              stg.billableAreaSqm ?? resolvedArea?.billableAreaSqm ?? null,
            costSource:
              stg.costSource ??
              (stg.priceItemId
                ? LineCostSource.CATALOG
                : LineCostSource.MANUAL),
            note: stg.note ?? null,
          };
        }
        let stageCost = 0;
        let stageArea: number | null = null;
        if (stg.pricingMode === VendorCostMode.PER_UNIT) {
          stageCost = Math.round(stg.rate * line.quantity);
        } else if (stg.pricingMode === VendorCostMode.PER_SQM) {
          stageArea = normalizeAreaSqm(
            Number(stg.billableAreaSqm ?? resolvedArea?.billableAreaSqm ?? 0),
          );
          stageCost = multiplyRateByAreaSqmToVnd(stg.rate, stageArea);
        } else {
          stageCost = Math.round(stg.rate);
        }
        return {
          id: stg.id,
          priceItemId: stg.priceItemId ?? null,
          code: stg.code ?? null,
          name: stg.name.trim(),
          pricingMode: stg.pricingMode,
          rate: stg.rate,
          unit:
            stg.unit ??
            (stg.pricingMode === VendorCostMode.PER_SQM
              ? 'm²'
              : (line.unit ?? 'tờ')),
          billableAreaSqm: stageArea,
          vendorCost: stageCost,
          costSource:
            stg.costSource ??
            (stg.priceItemId ? LineCostSource.CATALOG : LineCostSource.MANUAL),
          note: stg.note ?? null,
        };
      });

      const lineCostMode = line.vendorCostMode ?? VendorCostMode.PER_UNIT;
      const lineProfit: ProfitConfig = line.profit ?? {
        mode: ProfitMode.FIXED_AMOUNT,
        scope: ProfitScope.PER_UNIT,
        value: 0,
      };
      let knownBaseCost: number | null = null;
      if (line.baseCostRate !== null) {
        if (lineCostMode === VendorCostMode.PER_UNIT) {
          knownBaseCost = Math.round(line.baseCostRate * line.quantity);
        } else if (lineCostMode === VendorCostMode.PER_SQM && resolvedArea) {
          knownBaseCost = multiplyRateByAreaSqmToVnd(
            line.baseCostRate,
            resolvedArea.billableAreaSqm,
          );
        } else {
          knownBaseCost = Math.round(line.baseCostRate);
        }
      }

      return {
        id: line.id,
        name: line.name.trim(),
        specification: line.specification ?? '',
        vendorId: line.vendorId ?? null,
        vendorName: line.vendorName ?? null,
        vendorPriceItemId: line.vendorPriceItemId ?? null,
        ...(line.vendorPriceItemCode !== undefined
          ? { vendorPriceItemCode: line.vendorPriceItemCode }
          : {}),
        ...(line.vendorPriceItemVersion !== undefined
          ? { vendorPriceItemVersion: line.vendorPriceItemVersion }
          : {}),
        ...(line.catalogOriginalRate !== undefined
          ? { catalogOriginalRate: line.catalogOriginalRate }
          : {}),
        ...(line.catalogBatchQuantity !== undefined
          ? { catalogBatchQuantity: line.catalogBatchQuantity }
          : {}),
        ...(line.priceAppliedAt !== undefined
          ? { priceAppliedAt: line.priceAppliedAt }
          : {}),
        unit: line.unit ?? 'tờ',
        quantity: line.quantity,
        vendorCostMode: lineCostMode,
        baseCostRate: line.baseCostRate,
        baseCostPending: line.baseCostRate === null,
        baseCostSource:
          line.baseCostSource ??
          (line.vendorPriceItemId
            ? LineCostSource.CATALOG
            : LineCostSource.MANUAL),
        ...(line.baseIncludedStages && line.baseIncludedStages.length > 0
          ? { baseIncludedStages: [...line.baseIncludedStages] }
          : {}),
        baseVendorCost: knownBaseCost,
        finishingVendorCost: null,
        finishingStages: stageSnapshots,
        areaSpec: resolvedArea,
        isPendingCost: lineMissing,
        // Pending-cost drafts intentionally store 0 in non-nullable numeric columns while
        // pricingStatus='PENDING_COST' blocks all customer totals, PDFs, finalization, and orders.
        unitVendorCost: 0,
        totalVendorCost: 0,
        profitMode: lineProfit.mode,
        profitScope: lineProfit.scope,
        profitInputValue: lineProfit.value,
        unitProfit: 0,
        totalProfit: 0,
        allocatedShippingFee: 0,
        totalExtraCost: 0,
        rawFinalUnitPrice: 0,
        finalUnitPrice: 0,
        billedLineSubtotal: 0,
        roundingAdjustment: 0,
        reconciledLineTotal: 0,
      };
    },
  );

  const totalQuantity = persistedLines.reduce((acc, l) => acc + l.quantity, 0);

  const baseSnapshot: Omit<PersistedQuoteOrderSnapshot, 'integrityHash'> = {
    orderId: params.orderId ?? `ORD-${params.quoteId}`,
    quoteId: params.quoteId,
    customerName: params.customerName,
    status: QuoteOrderStatus.DRAFT,
    pricingStatus: QuotePricingStatus.PENDING_COST,
    pendingCostSummary: evalResult.pendingSummary,
    createdAt: nowIso,
    finalizedAt: null,
    includeShippingInUnitPrice: params.includeShippingInUnitPrice,
    shippingAllocationStrategy: params.shippingAllocationStrategy,
    totalVendorCost: 0,
    totalProfit: 0,
    shippingFee,
    totalExtraCost: 0,
    finalUnitPrice: null,
    totalQuoteAmount: 0,
    totalRoundingAdjustment: 0,
    lines: persistedLines,
    pdfPayload: null,
  };

  const integrityHash = computeQuoteSnapshotHash(baseSnapshot);
  return {
    snapshot: {
      ...baseSnapshot,
      integrityHash,
    },
    pendingSummary: evalResult.pendingSummary,
    totalQuantity,
  };
}

export function finalizeQuoteOrder(
  quoteOrDraft: QuoteCalculationResult | PersistedQuoteOrderSnapshot,
  orderId?: string,
): PersistedQuoteOrderSnapshot {
  if ('status' in quoteOrDraft) {
    if (
      quoteOrDraft.pricingStatus === QuotePricingStatus.PENDING_COST ||
      quoteOrDraft.lines.some((l) => l.isPendingCost === true)
    ) {
      throw new Error(
        'Không thể chốt báo giá khi còn khoản đang chờ giá xưởng (PENDING_COST).',
      );
    }
    if (quoteOrDraft.status === QuoteOrderStatus.FINALIZED) {
      return quoteOrDraft;
    }
    const finalizedBase: Omit<PersistedQuoteOrderSnapshot, 'integrityHash'> = {
      ...quoteOrDraft,
      orderId: orderId ?? quoteOrDraft.orderId,
      status: QuoteOrderStatus.FINALIZED,
      finalizedAt: new Date().toISOString(),
    };
    const integrityHash = computeQuoteSnapshotHash(finalizedBase);
    return deepFreeze({
      ...finalizedBase,
      integrityHash,
    });
  }

  return createQuoteOrderSnapshot(quoteOrDraft, {
    orderId,
    status: QuoteOrderStatus.FINALIZED,
  });
}

export function verifyQuoteSnapshotIntegrity(
  snapshot: PersistedQuoteOrderSnapshot,
): boolean {
  const expectedHash = computeQuoteSnapshotHash(snapshot);
  return expectedHash === snapshot.integrityHash;
}

export class QuoteOrderRepository {
  private readonly store = new Map<string, PersistedQuoteOrderSnapshot>();

  save(snapshot: PersistedQuoteOrderSnapshot): PersistedQuoteOrderSnapshot {
    const existing = this.store.get(snapshot.orderId);
    if (existing && existing.status === QuoteOrderStatus.FINALIZED) {
      throw new Error(
        `Đơn hàng (${snapshot.orderId}) đã chốt (FINALIZED) — Không được phép ghi đè hoặc chỉnh sửa giá nhà in, lợi nhuận, vận chuyển hay tổng báo giá.`,
      );
    }
    if (!verifyQuoteSnapshotIntegrity(snapshot)) {
      throw new Error(
        `Bản ghi đơn hàng (${snapshot.orderId}) không hợp lệ: Sai lệch mã băm toàn vẹn (integrityHash).`,
      );
    }

    const cloned = JSON.parse(
      JSON.stringify(snapshot),
    ) as PersistedQuoteOrderSnapshot;
    const stored =
      cloned.status === QuoteOrderStatus.FINALIZED
        ? deepFreeze(cloned)
        : cloned;
    this.store.set(stored.orderId, stored);
    return stored;
  }

  finalize(orderId: string): PersistedQuoteOrderSnapshot {
    const existing = this.store.get(orderId);
    if (!existing) {
      throw new Error(`Không tìm thấy đơn hàng (${orderId}) để chốt.`);
    }
    if (existing.status === QuoteOrderStatus.FINALIZED) {
      return existing;
    }
    const finalized = finalizeQuoteOrder(existing, orderId);
    this.store.set(orderId, finalized);
    return finalized;
  }

  getById(orderId: string): PersistedQuoteOrderSnapshot | undefined {
    return this.store.get(orderId);
  }
}

// ============================================================================
// VENDOR PRICE ITEM HELPER (Point-in-time snapshot decoupling)
// ============================================================================

export interface PrintVendorPriceCatalogEntry {
  id: string;
  vendorId: string | null;
  vendorName?: string | null | undefined;
  code: string;
  name: string;
  itemType?: PriceItemTypeValue | undefined;
  specification?: string | undefined;
  includedStages?: readonly string[] | undefined;
  unit: string;
  pricingMode: VendorCostModeType;
  unitCost: number;
  batchQuantity: number;
  batchTotalCost: number;
  defaultProfitMode: ProfitModeType;
  defaultProfitScope: ProfitScopeType;
  defaultProfitValue: number;
}

/**
 * Copies pricing values from a vendor catalog item into an independent QuoteLineInput.
 * Updating the vendor catalog later will NEVER alter already-built QuoteLineInput or snapshots.
 */
export function buildQuoteLineFromVendorCatalogItem(
  catalogItem: PrintVendorPriceCatalogEntry,
  options?: {
    lineId?: string | undefined;
    quantity?: number | undefined;
    areaSpec?: QuoteAreaSpecInput | null | undefined;
    finishingStages?: readonly QuoteFinishingStageInput[] | undefined;
    profitOverride?: ProfitConfig | undefined;
    extraCost?: number | undefined;
  },
): QuoteLineInput {
  const quantity =
    options?.quantity ??
    (catalogItem.pricingMode === VendorCostMode.TOTAL_BATCH
      ? Math.max(1, catalogItem.batchQuantity || 1)
      : 1);

  const profit: ProfitConfig = options?.profitOverride
    ? { ...options.profitOverride }
    : {
        mode: catalogItem.defaultProfitMode,
        scope: catalogItem.defaultProfitScope,
        value: catalogItem.defaultProfitValue,
      };

  const hasExtended =
    catalogItem.pricingMode === VendorCostMode.PER_SQM ||
    Boolean(options?.areaSpec) ||
    Boolean(options?.finishingStages && options.finishingStages.length > 0) ||
    Boolean(
      catalogItem.includedStages && catalogItem.includedStages.length > 0,
    );

  if (hasExtended) {
    const rate =
      catalogItem.pricingMode === VendorCostMode.TOTAL_BATCH
        ? catalogItem.batchTotalCost
        : catalogItem.unitCost;
    return {
      id: options?.lineId ?? `LINE-${catalogItem.id}`,
      name: catalogItem.name,
      specification: catalogItem.specification ?? '',
      vendorId: catalogItem.vendorId,
      vendorName: catalogItem.vendorName ?? null,
      vendorPriceItemId: catalogItem.id,
      unit: catalogItem.unit,
      quantity,
      vendorCostMode: catalogItem.pricingMode,
      baseCostRate: rate,
      baseCostSource: LineCostSource.CATALOG,
      ...(catalogItem.includedStages && catalogItem.includedStages.length > 0
        ? { baseIncludedStages: [...catalogItem.includedStages] }
        : {}),
      areaSpec: options?.areaSpec ?? null,
      finishingStages: options?.finishingStages ?? [],
      profit,
      extraCost: options?.extraCost ?? 0,
    };
  }

  if (catalogItem.pricingMode === VendorCostMode.TOTAL_BATCH) {
    return {
      id: options?.lineId ?? `LINE-${catalogItem.id}`,
      name: catalogItem.name,
      specification: catalogItem.specification ?? '',
      vendorId: catalogItem.vendorId,
      vendorName: catalogItem.vendorName ?? null,
      vendorPriceItemId: catalogItem.id,
      unit: catalogItem.unit,
      quantity,
      totalVendorCost: catalogItem.batchTotalCost,
      profit,
      extraCost: options?.extraCost ?? 0,
    };
  }

  return {
    id: options?.lineId ?? `LINE-${catalogItem.id}`,
    name: catalogItem.name,
    specification: catalogItem.specification ?? '',
    vendorId: catalogItem.vendorId,
    vendorName: catalogItem.vendorName ?? null,
    vendorPriceItemId: catalogItem.id,
    unit: catalogItem.unit,
    quantity,
    unitVendorCost: catalogItem.unitCost,
    profit,
    extraCost: options?.extraCost ?? 0,
  };
}

// ============================================================================
// DATABASE & API ENTITY TYPES (PHASES 2, 3, 4)
// ============================================================================

export const PrintProductionStatus = {
  PENDING: 'PENDING',
  PREPRESS: 'PREPRESS',
  PRINTING: 'PRINTING',
  FINISHING: 'FINISHING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type PrintProductionStatusType =
  (typeof PrintProductionStatus)[keyof typeof PrintProductionStatus];

export const PrintDeliveryStatus = {
  NOT_SHIPPED: 'NOT_SHIPPED',
  PACKING: 'PACKING',
  SHIPPING: 'SHIPPING',
  DELIVERED: 'DELIVERED',
  RETURNED: 'RETURNED',
} as const;

export type PrintDeliveryStatusType =
  (typeof PrintDeliveryStatus)[keyof typeof PrintDeliveryStatus];

export const PrintPaymentStatus = {
  UNPAID: 'UNPAID',
  DEPOSIT_PAID: 'DEPOSIT_PAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
} as const;

export type PrintPaymentStatusType =
  (typeof PrintPaymentStatus)[keyof typeof PrintPaymentStatus];

export interface PrintVendorData {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  note: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PrintVendorPriceItemData {
  id: string;
  workspace_id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  code: string;
  name: string;
  item_type: PriceItemTypeValue;
  category: string | null;
  specification: string | null;
  included_stages: string[];
  structured_spec: Record<string, unknown> | null;
  conditions_note: string | null;
  unit: string;
  pricing_mode: VendorCostModeType;
  unit_cost: number;
  batch_quantity: number;
  batch_total_cost: number;
  default_profit_mode: ProfitModeType;
  default_profit_scope: ProfitScopeType;
  default_profit_value: number;
  note: string | null;
  is_active: boolean;
  version: number;
  updated_by?: string | null | undefined;
  is_used_in_quotes?: boolean | undefined;
  created_at: string;
  updated_at: string;
}

export interface PrintVendorPriceItemHistoryData {
  id: string;
  workspace_id: string;
  price_item_id: string;
  version: number;
  action: 'CREATED' | 'UPDATED' | 'DEACTIVATED' | 'RESTORED';
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown>;
  change_note: string | null;
  changed_by: string | null;
  changed_by_name?: string | null | undefined;
  changed_at: string;
}

export interface PrintCustomerData {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_code: string | null;
  note: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PrintQuoteVersionData {
  id: string;
  quote_id: string;
  version_number: number;
  status: QuoteOrderStatusType;
  pricing_status?: QuotePricingStatusType | undefined;
  pending_cost_summary?: PendingCostLineSummary[] | undefined;
  total_quantity: number;
  total_vendor_cost: number;
  total_profit: number;
  shipping_fee: number;
  total_extra_cost: number;
  total_quote_amount: number;
  total_rounding_adjustment: number;
  snapshot_json: PersistedQuoteOrderSnapshot;
  customer_pdf_json: CustomerSafePdfPayload | null;
  integrity_hash: string;
  change_note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PrintQuoteData {
  id: string;
  workspace_id: string;
  quote_code: string;
  title: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  status: QuoteOrderStatusType;
  pricing_status?: QuotePricingStatusType | undefined;
  pending_cost_summary?: PendingCostLineSummary[] | undefined;
  current_version: number;
  include_shipping_in_unit_price: boolean;
  shipping_allocation_strategy: ShippingAllocationStrategyType;
  rounding_mode: RoundingModeType;
  rounding_step: number;
  total_quantity: number;
  total_vendor_cost: number;
  total_profit: number;
  shipping_fee: number;
  total_extra_cost: number;
  total_quote_amount: number;
  total_rounding_adjustment: number;
  single_product_final_unit_price: number | null;
  lines_json: PersistedQuoteLineSnapshot[];
  snapshot_json: PersistedQuoteOrderSnapshot;
  customer_pdf_json: CustomerSafePdfPayload | null;
  integrity_hash: string;
  valid_until: string | null;
  notes: string | null;
  created_by: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
  versions?: PrintQuoteVersionData[] | undefined;
}

export interface PrintOrderPaymentData {
  id: string;
  workspace_id: string;
  order_id: string;
  payment_type: 'DEPOSIT' | 'INSTALLMENT' | 'FINAL' | 'REFUND';
  amount: number;
  payment_method: 'BANK_TRANSFER' | 'CASH' | 'QR_VIETQR' | 'OTHER';
  paid_at: string;
  reference_code: string | null;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

export const OrderCostReconciliationStatus = {
  UNVERIFIED: 'UNVERIFIED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  PARTIAL_ENTERED: 'PARTIAL_ENTERED',
  ENTERED_UNCONFIRMED: 'ENTERED_UNCONFIRMED',
  CONFIRMED: 'CONFIRMED',
} as const;

export type OrderCostReconciliationStatusType =
  (typeof OrderCostReconciliationStatus)[keyof typeof OrderCostReconciliationStatus];

export type OrderCostHistoryActionType =
  'ENTERED' | 'CONFIRMED' | 'ADJUSTED' | 'UNCONFIRMED' | 'VENDOR_PAYMENT_NOTE';

export interface PrintOrderCostHistoryData {
  id: string;
  workspace_id: string;
  order_id: string;
  action: OrderCostHistoryActionType;
  before_json: Record<string, unknown>;
  after_json: Record<string, unknown>;
  note: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface LegacyRawOrderActualCosts {
  vendor_cost: number;
  shipping_fee: number;
  extra_cost: number;
  profit: number;
}

export interface CancelledOrdersObligationSummary {
  cancelled_orders_count: number;
  cancelled_orders_with_obligations_count: number;
  cancelled_customer_paid_holding: number;
  cancelled_vendor_paid_amount: number;
  cancelled_confirmed_incurred_cost: number;
  cancelled_unconfirmed_entered_cost: number;
}

export interface PrintOrderData {
  id: string;
  workspace_id: string;
  order_code: string;
  quote_id: string;
  quote_code: string;
  quote_version: number;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  title: string;
  order_date: string;
  print_ordered_at: string | null;
  due_date: string | null;
  completed_at: string | null;
  delivered_at: string | null;
  production_status: PrintProductionStatusType;
  delivery_status: PrintDeliveryStatusType;
  payment_status: PrintPaymentStatusType;
  total_quote_amount: number;
  expected_vendor_cost: number;
  expected_shipping_fee: number;
  expected_extra_cost: number;
  expected_profit: number;
  cost_reconciliation_status: OrderCostReconciliationStatusType;
  actual_cost_confirmed: boolean;
  actual_cost_confirmed_at: string | null;
  actual_cost_confirmed_by?: string | null | undefined;
  entered_vendor_cost: number | null;
  entered_shipping_fee: number | null;
  entered_extra_cost: number | null;
  actual_vendor_cost: number | null;
  actual_shipping_fee: number | null;
  actual_extra_cost: number | null;
  actual_profit: number | null;
  legacy_raw_actual_costs?: LegacyRawOrderActualCosts | null | undefined;
  vendor_paid_amount: number;
  deposit_required: number;
  deposit_paid: number;
  total_paid_amount: number;
  remaining_debt_amount: number;
  snapshot_json: PersistedQuoteOrderSnapshot;
  integrity_hash: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  payments?: PrintOrderPaymentData[];
  cost_history?: PrintOrderCostHistoryData[] | undefined;
}

export interface PrintQuoteDashboardStats {
  total_vendors: number;
  total_price_items: number;
  total_customers: number;
  total_quotes: number;
  finalized_quotes: number;
  total_orders: number;
  confirmed_actual_orders_count?: number | undefined;
  needs_review_orders_count?: number | undefined;
  unconfirmed_entered_orders_count?: number | undefined;
  total_order_revenue: number;
  total_expected_vendor_cost: number;
  total_actual_vendor_cost: number;
  total_expected_profit: number;
  total_actual_profit: number;
  total_paid_amount: number;
  total_vendor_paid_amount?: number | undefined;
  total_remaining_debt: number;
  cancelled_orders_summary?: CancelledOrdersObligationSummary | undefined;
  orders_by_production_status: Record<PrintProductionStatusType, number>;
  orders_by_delivery_status: Record<PrintDeliveryStatusType, number>;
  orders_by_payment_status: Record<PrintPaymentStatusType, number>;
}
