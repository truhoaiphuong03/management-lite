import type React from 'react';
import {
  ProfitMode,
  ProfitScope,
  VendorCostMode,
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
  | 'catalog-prices'
  | 'catalog-customers'
  | 'catalog-vendors'
  | 'reports';

export type CatalogSubPageId = 'prices' | 'customers' | 'vendors';

export type PrintQuoteNavGroupId =
  'quotes_group' | 'orders_group' | 'catalog_group' | 'analytics_group';

export type CreateQuoteSectionId =
  'customer' | 'products' | 'summary' | 'actions';

export type SummaryViewMode = 'customer' | 'internal';

export interface DraftLineState {
  id: string;
  vendorPriceItemId: string;
  name: string;
  specification: string;
  unit: string;
  quantity: number;
  quantityInput?: string | undefined;
  vendorCostMode: VendorCostModeType;
  vendorCostValue: number;
  vendorCostInput?: string | undefined;
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

/**
 * Legacy helper retained for backwards compatibility with any standalone caller.
 */
export const DEFAULT_DRAFT_LINE = (index: number): DraftLineState => ({
  id: `ITEM-${index}`,
  vendorPriceItemId: '',
  name:
    index === 1 ? 'Tờ rơi A5 Couche 150gsm (In 2 mặt)' : `Ấn phẩm #${index}`,
  specification:
    index === 1 ? 'In Offset 4 màu, cán bóng 2 mặt, cắt thành phẩm' : '',
  unit: 'tờ',
  quantity: 100,
  quantityInput: '100',
  vendorCostMode: VendorCostMode.PER_UNIT,
  vendorCostValue: 300,
  vendorCostInput: '300',
  profitMode: ProfitMode.FIXED_AMOUNT,
  profitScope: ProfitScope.PER_UNIT,
  profitValue: 200,
  profitInput: '200',
});

export function isQuoteStatusEditable(status: string): boolean {
  return status === 'DRAFT' || status === 'SENT' || status === 'APPROVED';
}

export const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '44px',
  padding: '8px 10px',
  borderRadius: '8px',
  border: '1px solid var(--border-color)',
  backgroundColor: 'var(--bg-color)',
  color: 'var(--text-color)',
  fontSize: '13.5px',
  boxSizing: 'border-box',
};

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--muted-color)',
  marginBottom: '4px',
};

export const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface-color)',
  border: '1px solid var(--border-color)',
  borderRadius: '12px',
  padding: '16px',
  boxSizing: 'border-box',
};

export function resolveNavGroupForTab(
  tabId: PrintQuoteTabId,
): PrintQuoteNavGroupId {
  switch (tabId) {
    case 'create':
    case 'quotes':
      return 'quotes_group';
    case 'orders':
      return 'orders_group';
    case 'vendors':
    case 'customers':
      return 'catalog_group';
    case 'analytics':
      return 'analytics_group';
  }
}
