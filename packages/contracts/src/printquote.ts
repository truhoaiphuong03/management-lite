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
  TOTAL_BATCH: 'TOTAL_BATCH',
} as const;

export type ProfitScopeType = (typeof ProfitScope)[keyof typeof ProfitScope];

export const VendorCostMode = {
  PER_UNIT: 'PER_UNIT',
  TOTAL_BATCH: 'TOTAL_BATCH',
} as const;

export type VendorCostModeType =
  (typeof VendorCostMode)[keyof typeof VendorCostMode];

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
  specification?: string;
  vendorId?: string | null;
  vendorName?: string | null;
  vendorPriceItemId?: string | null;
  unit?: string;
  quantity: number;
  unitVendorCost?: number;
  totalVendorCost?: number;
  profit?: ProfitConfig;
  extraCost?: number;
}

export interface UnitPriceRoundingPolicy {
  mode?: RoundingModeType;
  step?: number;
}

export interface QuoteCalculationInput {
  quoteId?: string;
  customerName?: string;
  items: QuoteLineInput[];
  defaultProfit?: ProfitConfig;
  shippingFee?: number;
  extraCost?: number;
  includeShippingInUnitPrice?: boolean;
  shippingAllocationStrategy?: ShippingAllocationStrategyType;
  roundingPolicy?: UnitPriceRoundingPolicy;
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
  unit: string;
  quantity: number;

  unitVendorCost: number;
  totalVendorCost: number;

  profitMode: ProfitModeType;
  profitScope: ProfitScopeType;
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
  specification?: string;
  unit: string;
  quantity: number;
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
  customerPhone?: string | null;
  customerAddress?: string | null;
  generatedAt: string;
  validUntil?: string | null;
  notes?: string | null;
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
  readonly specification?: string;
  readonly vendorId?: string | null;
  readonly vendorName?: string | null;
  readonly vendorPriceItemId?: string | null;
  readonly unit: string;
  readonly quantity: number;
  readonly unitVendorCost: number;
  readonly totalVendorCost: number;
  readonly profitMode: ProfitModeType;
  readonly profitScope: ProfitScopeType;
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
  readonly pdfPayload: Readonly<QuotePdfPayload>;
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

function resolveLineCostAndProfit(
  item: QuoteLineInput,
  defaultProfit?: ProfitConfig,
): {
  unitVendorCost: number;
  totalVendorCost: number;
  profitConfig: ProfitConfig;
  unitProfit: number;
  totalProfit: number;
  lineExtraCost: number;
} {
  if (!item.id || !item.name) {
    throw new Error('Mỗi dòng sản phẩm phải có đầy đủ `id` và `name`.');
  }
  if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
    throw new Error(
      `Số lượng sản phẩm (${item.id}) phải là số nguyên dương, nhận được: ${item.quantity}`,
    );
  }

  const hasUnitCost = item.unitVendorCost !== undefined;
  const hasTotalCost = item.totalVendorCost !== undefined;

  if (!hasUnitCost && !hasTotalCost) {
    throw new Error(
      `Dòng sản phẩm (${item.id}) phải cung cấp unitVendorCost hoặc totalVendorCost.`,
    );
  }

  let unitVendorCost: number;
  let totalVendorCost: number;

  if (hasUnitCost && hasTotalCost) {
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
    if (item.unitVendorCost! < 0) {
      throw new Error(`Giá vốn đơn vị (${item.id}) không được âm.`);
    }
    unitVendorCost = item.unitVendorCost!;
    totalVendorCost = Math.round(unitVendorCost * item.quantity);
  } else {
    if (item.totalVendorCost! < 0) {
      throw new Error(`Tổng giá vốn (${item.id}) không được âm.`);
    }
    totalVendorCost = Math.round(item.totalVendorCost!);
    unitVendorCost = totalVendorCost / item.quantity;
  }

  const profitConfig = item.profit ?? defaultProfit;
  if (!profitConfig) {
    throw new Error(
      `Dòng sản phẩm (${item.id}) chưa có cấu hình lợi nhuận (profit hoặc defaultProfit).`,
    );
  }
  if (!Number.isFinite(profitConfig.value) || profitConfig.value < 0) {
    throw new Error(
      `Giá trị lợi nhuận của dòng (${item.id}) không được âm: ${profitConfig.value}`,
    );
  }

  let unitProfit: number;
  let totalProfit: number;

  if (profitConfig.mode === ProfitMode.FIXED_AMOUNT) {
    if (profitConfig.scope === ProfitScope.PER_UNIT) {
      unitProfit = profitConfig.value;
      totalProfit = Math.round(profitConfig.value * item.quantity);
    } else if (profitConfig.scope === ProfitScope.TOTAL_BATCH) {
      totalProfit = Math.round(profitConfig.value);
      unitProfit = totalProfit / item.quantity;
    } else {
      throw new Error(
        `ProfitScope không hợp lệ: ${String(profitConfig.scope)}`,
      );
    }
  } else if (profitConfig.mode === ProfitMode.PERCENTAGE) {
    if (profitConfig.scope === ProfitScope.PER_UNIT) {
      unitProfit = (unitVendorCost * profitConfig.value) / 100;
      totalProfit = Math.round((totalVendorCost * profitConfig.value) / 100);
    } else if (profitConfig.scope === ProfitScope.TOTAL_BATCH) {
      totalProfit = Math.round((totalVendorCost * profitConfig.value) / 100);
      unitProfit = totalProfit / item.quantity;
    } else {
      throw new Error(
        `ProfitScope không hợp lệ: ${String(profitConfig.scope)}`,
      );
    }
  } else {
    throw new Error(`ProfitMode không hợp lệ: ${String(profitConfig.mode)}`);
  }

  const lineExtraCost = Math.round(item.extraCost ?? 0);
  if (lineExtraCost < 0) {
    throw new Error(`Chi phí phát sinh dòng (${item.id}) không được âm.`);
  }

  return {
    unitVendorCost,
    totalVendorCost,
    profitConfig,
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
  if (shippingFee < 0) {
    throw new Error('Chi phí vận chuyển (shippingFee) không được âm.');
  }

  const orderExtraCost = Math.round(input.extraCost ?? 0);
  if (orderExtraCost < 0) {
    throw new Error('Chi phí phát sinh đơn hàng (extraCost) không được âm.');
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
    const resolved = resolveLineCostAndProfit(item, input.defaultProfit);
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
      unit: l.item.unit ?? 'tờ',
      quantity: l.item.quantity,
      unitVendorCost: l.unitVendorCost,
      totalVendorCost: l.totalVendorCost,
      profitMode: l.profitConfig.mode,
      profitScope: l.profitConfig.scope,
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
  const pdfLines: QuotePdfLineItem[] = quote.lines.map((line, idx) => ({
    index: idx + 1,
    id: line.id,
    name: line.name,
    specification: line.specification,
    unit: line.unit,
    quantity: line.quantity,
    unitPrice: line.finalUnitPrice,
    billedSubtotal: line.billedLineSubtotal,
    roundingAdjustment: line.roundingAdjustment,
    lineTotal: line.reconciledLineTotal,
    shippingIncludedInUnitPrice: line.shippingIncludedInUnitPrice,
  }));

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

const FORBIDDEN_CUSTOMER_PDF_KEYS = new Set([
  'unitVendorCost',
  'totalVendorCost',
  'profitMode',
  'profitScope',
  'profitInputValue',
  'unitProfit',
  'totalProfit',
  'vendorId',
  'vendorName',
  'vendorPriceItemId',
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
    quoteCode?: string;
    customerPhone?: string | null;
    customerAddress?: string | null;
    validUntil?: string | null;
    notes?: string | null;
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
  const canonicalPayload = JSON.stringify({
    orderId: snapshotWithoutHash.orderId,
    quoteId: snapshotWithoutHash.quoteId,
    customerName: snapshotWithoutHash.customerName,
    status: snapshotWithoutHash.status,
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
      unit: line.unit,
      quantity: line.quantity,
      unitVendorCost: line.unitVendorCost,
      totalVendorCost: line.totalVendorCost,
      profitMode: line.profitMode,
      profitScope: line.profitScope,
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

export function finalizeQuoteOrder(
  quoteOrDraft: QuoteCalculationResult | PersistedQuoteOrderSnapshot,
  orderId?: string,
): PersistedQuoteOrderSnapshot {
  if ('status' in quoteOrDraft) {
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
  vendorId: string;
  vendorName?: string | null;
  code: string;
  name: string;
  specification?: string;
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
    lineId?: string;
    quantity?: number;
    profitOverride?: ProfitConfig;
    extraCost?: number;
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
  vendor_id: string;
  vendor_name: string | null;
  code: string;
  name: string;
  category: string | null;
  specification: string | null;
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
  created_at: string;
  updated_at: string;
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
  total_quantity: number;
  total_vendor_cost: number;
  total_profit: number;
  shipping_fee: number;
  total_extra_cost: number;
  total_quote_amount: number;
  total_rounding_adjustment: number;
  snapshot_json: PersistedQuoteOrderSnapshot;
  customer_pdf_json: CustomerSafePdfPayload;
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
  customer_pdf_json: CustomerSafePdfPayload;
  integrity_hash: string;
  valid_until: string | null;
  notes: string | null;
  created_by: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
  versions?: PrintQuoteVersionData[];
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
  actual_vendor_cost: number;
  actual_shipping_fee: number;
  actual_extra_cost: number;
  actual_profit: number;
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
}

export interface PrintQuoteDashboardStats {
  total_vendors: number;
  total_price_items: number;
  total_customers: number;
  total_quotes: number;
  finalized_quotes: number;
  total_orders: number;
  total_order_revenue: number;
  total_expected_vendor_cost: number;
  total_actual_vendor_cost: number;
  total_expected_profit: number;
  total_actual_profit: number;
  total_paid_amount: number;
  total_remaining_debt: number;
  orders_by_production_status: Record<PrintProductionStatusType, number>;
  orders_by_delivery_status: Record<PrintDeliveryStatusType, number>;
  orders_by_payment_status: Record<PrintPaymentStatusType, number>;
}
