import type React from 'react';
import {
  ProfitMode,
  ProfitScope,
  VendorCostMode,
  type AreaInputModeType,
  type LineCostSourceType,
  type ProfitModeType,
  type ProfitScopeType,
  type VendorCostModeType,
} from '../../../../../packages/contracts/src/printquote.js';
import type { AmbiguousLegacyCostState } from '../helpers/printquote-helpers.js';

export type PrintQuoteTabId =
  'create' | 'quotes' | 'vendors' | 'customers' | 'orders' | 'analytics';

export type PrintQuoteViewMode =
  | 'quotes'
  | 'new'
  | 'detail'
  | 'edit'
  | 'orders'
  | 'receivables'
  | 'payables'
  | 'transactions'
  | 'import-history'
  | 'catalog-prices'
  | 'catalog-customers'
  | 'catalog-vendors'
  | 'reports';

export type CatalogSubPageId = 'prices' | 'customers' | 'vendors';

export type FinanceSubPageId =
  'receivables' | 'payables' | 'transactions' | 'import-history';

export type SummaryViewMode = 'customer' | 'internal';

export interface DraftFinishingStageState {
  id: string;
  priceItemId: string;
  code?: string | null | undefined;
  priceItemVersion?: number | null | undefined;
  vendorId?: string | null | undefined;
  vendorName?: string | null | undefined;
  name: string;
  pricingMode: VendorCostModeType;
  rateValue: number;
  rateInput: string;
  unit: string;
  costSource: LineCostSourceType;
  catalogOriginalRate?: number | null | undefined;
  catalogBatchQuantity?: number | null | undefined;
  appliedAt?: string | null | undefined;
  note?: string | null | undefined;
}

export interface DraftLineState {
  id: string;
  vendorPriceItemId: string;
  vendorPriceItemCode?: string | null | undefined;
  vendorPriceItemVersion?: number | null | undefined;
  name: string;
  specification: string;
  unit: string;
  quantity: number;
  quantityInput?: string | undefined;
  vendorCostMode: VendorCostModeType;
  vendorCostValue: number;
  vendorCostInput?: string | undefined;
  baseCostSource?: LineCostSourceType | undefined;
  baseCatalogOriginalRate?: number | null | undefined;
  baseCatalogBatchQuantity?: number | null | undefined;
  priceAppliedAt?: string | null | undefined;
  baseIncludedStages?: string[] | undefined;
  materialGroup?: string | undefined;
  areaMode?: AreaInputModeType | undefined;
  widthMInput?: string | undefined;
  heightMInput?: string | undefined;
  sheetsCountInput?: string | undefined;
  actualAreaInput?: string | undefined;
  billableAreaInput?: string | undefined;
  adjustBillableArea?: boolean | undefined;
  areaAdjustmentReason?: string | undefined;
  customerAreaNote?: string | undefined;
  finishingStages?: DraftFinishingStageState[] | undefined;
  ambiguousLegacyCost?: AmbiguousLegacyCostState | null | undefined;
  profitMode: ProfitModeType;
  profitScope: ProfitScopeType;
  profitValue: number;
  profitInput?: string | undefined;
}

export interface PdfPreviewState {
  title: string;
  html: string;
  quoteId?: string | null | undefined;
  quoteCode: string;
}

/**
 * UX V2 clean empty line for `/print-quotes/new` — zero fake demo numbers.
 */
export const EMPTY_DRAFT_LINE = (index: number): DraftLineState => ({
  id: `ITEM-${index}`,
  vendorPriceItemId: '',
  name: '',
  specification: '',
  unit: 'tờ',
  quantity: 0,
  quantityInput: '',
  vendorCostMode: VendorCostMode.PER_UNIT,
  vendorCostValue: 0,
  vendorCostInput: '',
  ambiguousLegacyCost: null,
  profitMode: ProfitMode.FIXED_AMOUNT,
  profitScope: ProfitScope.PER_UNIT,
  profitValue: 0,
  profitInput: '',
});

export function isQuoteStatusEditable(status: string): boolean {
  return status === 'DRAFT' || status === 'SENT' || status === 'APPROVED';
}

export const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '42px',
  padding: '9px 12px',
  borderRadius: '10px',
  border: '1px solid var(--border-color)',
  backgroundColor: 'var(--bg-color)',
  color: 'var(--text-color)',
  fontSize: '13.5px',
  lineHeight: 1.4,
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  boxSizing: 'border-box',
};

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--muted-color)',
  marginBottom: '6px',
  letterSpacing: '0.01em',
};

export const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface-color)',
  border: '1px solid var(--border-color)',
  borderRadius: '14px',
  padding: '18px 20px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
  boxSizing: 'border-box',
};

export const tabularNumStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
};
