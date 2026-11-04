import React, { useState, useMemo } from 'react';
import { StatusBadge } from '../../../../../packages/ui/src/components/index.js';
import {
  PriceItemType,
  ProfitMode,
  ProfitScope,
  VendorCostMode,
  WORKSHOP_FINISHING_SUGGESTIONS,
  WORKSHOP_MATERIAL_GROUPS,
  type PriceItemTypeValue,
  type ProfitModeType,
  type ProfitScopeType,
  type VendorCostModeType,
  type PrintVendorData,
  type PrintVendorPriceItemData,
  type PrintVendorPriceItemHistoryData,
} from '../../../../../packages/contracts/src/printquote.js';
import {
  formatDateVn,
  formatVnd,
  parseNumericDraftValue,
} from '../helpers/printquote-helpers.js';
import { cardStyle, inputStyle, labelStyle, tabularNumStyle } from './types.js';
import { NumericDraftInput } from './NumericDraftInput.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';
import {
  PqCheckIcon,
  PqEditIcon,
  PqHistoryIcon,
  PqLockIcon,
  PqPlusIcon,
  PqSearchIcon,
  PqStoreIcon,
  PqTagIcon,
  PqTrashIcon,
} from './PrintQuoteIcons.js';

export interface SaveCatalogPriceItemPayload {
  vendor_id: string | null;
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
  batch_quantity?: number;
  batch_total_cost: number;
  default_profit_mode: ProfitModeType;
  default_profit_scope: ProfitScopeType;
  default_profit_value: number;
  change_note?: string | null;
}

export interface VendorsCatalogTabProps {
  mode: 'prices' | 'vendors';
  vendors: PrintVendorData[];
  priceItems: PrintVendorPriceItemData[];
  vendorName: string;
  setVendorName: (v: string) => void;
  vendorPhone: string;
  setVendorPhone: (v: string) => void;
  vendorBankName: string;
  setVendorBankName: (v: string) => void;
  vendorBankAccount: string;
  setVendorBankAccount: (v: string) => void;
  onCreateVendor: (e: React.FormEvent) => Promise<boolean> | void;
  priceVendorId: string;
  setPriceVendorId: (v: string) => void;
  priceItemName: string;
  setPriceItemName: (v: string) => void;
  priceSpec: string;
  setPriceSpec: (v: string) => void;
  priceUnit?: string | undefined;
  setPriceUnit?: ((v: string) => void) | undefined;
  priceCostMode: VendorCostModeType;
  setPriceCostMode: (v: VendorCostModeType) => void;
  priceUnitCost: number;
  setPriceUnitCost: (v: number) => void;
  priceBatchCost: number;
  setPriceBatchCost: (v: number) => void;
  priceDefaultProfitVal: number;
  setPriceDefaultProfitVal: (v: number) => void;
  onCreatePriceItem: (e: React.FormEvent) => Promise<boolean> | void;
  onSaveCatalogPriceItem?:
    | ((
        payload: SaveCatalogPriceItemPayload,
        editingId: string | null,
      ) => Promise<boolean>)
    | undefined;
  onDeactivatePriceItem?: ((itemId: string) => Promise<void>) | undefined;
  onRestorePriceItem?: ((itemId: string) => Promise<void>) | undefined;
  onDeletePriceItem?: ((itemId: string) => Promise<void>) | undefined;
  onFetchPriceItemHistory?:
    | ((itemId: string) => Promise<PrintVendorPriceItemHistoryData[]>)
    | undefined;
  onQuickQuotePriceItem?:
    ((item: PrintVendorPriceItemData) => void) | undefined;
  onNavigateCatalogSubPage?: ((sub: 'prices' | 'vendors') => void) | undefined;
}

const QUICK_INCLUDED_STAGE_OPTIONS = [
  'Cán màng 1 mặt',
  'Cán màng 2 mặt',
  'Cắt thành phẩm',
  'Bế demi',
  'Đóng khoen 4 góc',
] as const;

type PriceTypeFilter = 'ACTIVE_ALL' | 'BASE_PRINT' | 'FINISHING' | 'INACTIVE';

function appendSpecChip(current: string, chip: string): string {
  const cleanChip = chip.trim();
  if (!cleanChip || cleanChip === 'Khác') return current;
  const parts = current
    .split(/[·,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === cleanChip.toLowerCase())) {
    return parts
      .filter((p) => p.toLowerCase() !== cleanChip.toLowerCase())
      .join(' · ');
  }
  return [...parts, cleanChip].join(' · ');
}

export const VendorsCatalogTab: React.FC<VendorsCatalogTabProps> = ({
  mode,
  vendors,
  priceItems,
  vendorName,
  setVendorName,
  vendorPhone,
  setVendorPhone,
  vendorBankName,
  setVendorBankName,
  vendorBankAccount,
  setVendorBankAccount,
  onCreateVendor,
  priceVendorId,
  setPriceVendorId,
  priceItemName,
  setPriceItemName,
  priceSpec,
  setPriceSpec,
  priceUnit = 'tờ',
  setPriceUnit,
  priceCostMode,
  setPriceCostMode,
  setPriceUnitCost,
  setPriceBatchCost,
  setPriceDefaultProfitVal,
  onCreatePriceItem,
  onSaveCatalogPriceItem,
  onDeactivatePriceItem,
  onRestorePriceItem,
  onDeletePriceItem,
  onFetchPriceItemHistory,
  onQuickQuotePriceItem,
  onNavigateCatalogSubPage,
}) => {
  const [filterVendorId, setFilterVendorId] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<PriceTypeFilter>('ACTIVE_ALL');
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [vendorSearch, setVendorSearch] = useState<string>('');
  const [isPriceDialogOpen, setIsPriceDialogOpen] = useState<boolean>(false);
  const [isVendorDialogOpen, setIsVendorDialogOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Extended Workshop Price Dialog states
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [dialogItemType, setDialogItemType] = useState<PriceItemTypeValue>(
    PriceItemType.BASE_PRINT,
  );
  const [selectedMaterialGroupId, setSelectedMaterialGroupId] =
    useState<string>('GIAY');
  const [includedStages, setIncludedStages] = useState<string[]>([]);
  const [customIncludedStageInput, setCustomIncludedStageInput] =
    useState<string>('');
  const [conditionsNote, setConditionsNote] = useState<string>('');
  const [changeNote, setChangeNote] = useState<string>('');
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [costRateInput, setCostRateInput] = useState<string>('');
  const [defaultProfitInput, setDefaultProfitInput] = useState<string>('');
  const [batchQtyInput, setBatchQtyInput] = useState<string>('1');
  const [batchQtyPolicy, setBatchQtyPolicy] = useState<
    'EXACT' | 'MAX' | 'ANY_QTY'
  >('EXACT');

  // History modal state
  const [historyModalItem, setHistoryModalItem] =
    useState<PrintVendorPriceItemData | null>(null);
  const [historyRecords, setHistoryRecords] = useState<
    PrintVendorPriceItemHistoryData[]
  >([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // Delete confirmation modal state
  const [deleteTargetItem, setDeleteTargetItem] =
    useState<PrintVendorPriceItemData | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const activeItems = useMemo(
    () => priceItems.filter((p) => p.is_active !== false),
    [priceItems],
  );
  const inactiveItems = useMemo(
    () => priceItems.filter((p) => p.is_active === false),
    [priceItems],
  );

  const filteredPriceItems = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return priceItems.filter((item) => {
      const isActive = item.is_active !== false;
      const itemType = item.item_type || PriceItemType.BASE_PRINT;

      if (typeFilter === 'INACTIVE') {
        if (isActive) return false;
      } else {
        if (!isActive) return false;
        if (
          typeFilter === 'BASE_PRINT' &&
          itemType !== PriceItemType.BASE_PRINT
        )
          return false;
        if (typeFilter === 'FINISHING' && itemType !== PriceItemType.FINISHING)
          return false;
      }

      if (filterVendorId === '__GENERAL__') {
        if (item.vendor_id) return false;
      } else if (
        filterVendorId !== 'ALL' &&
        item.vendor_id !== filterVendorId
      ) {
        return false;
      }

      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q) ||
        (item.specification || '').toLowerCase().includes(q) ||
        (item.conditions_note || '').toLowerCase().includes(q) ||
        (item.vendor_name || '').toLowerCase().includes(q)
      );
    });
  }, [priceItems, typeFilter, filterVendorId, catalogSearch]);

  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.code.toLowerCase().includes(q) ||
        (v.phone || '').toLowerCase().includes(q) ||
        (v.bank_name || '').toLowerCase().includes(q),
    );
  }, [vendors, vendorSearch]);

  const openCreateDialog = (defaultType: PriceItemTypeValue = 'BASE_PRINT') => {
    setEditingItemId(null);
    setDialogItemType(defaultType);
    setPriceVendorId('');
    setPriceItemName('');
    setPriceSpec('');
    setPriceUnit?.(defaultType === PriceItemType.FINISHING ? 'tờ' : 'tờ');
    setPriceCostMode(VendorCostMode.PER_UNIT);
    setPriceUnitCost(0);
    setPriceBatchCost(0);
    setPriceDefaultProfitVal(0);
    setCostRateInput('');
    setDefaultProfitInput('');
    setBatchQtyInput('1');
    setBatchQtyPolicy(
      defaultType === PriceItemType.FINISHING ? 'ANY_QTY' : 'EXACT',
    );
    setIncludedStages([]);
    setCustomIncludedStageInput('');
    setConditionsNote('');
    setChangeNote('');
    setDialogError(null);
    setIsPriceDialogOpen(true);
  };

  const openEditDialog = (item: PrintVendorPriceItemData) => {
    setEditingItemId(item.id);
    setDialogItemType(item.item_type || PriceItemType.BASE_PRINT);
    setPriceVendorId(item.vendor_id || '');
    setPriceItemName(item.name);
    setPriceSpec(item.specification || '');
    setPriceUnit?.(item.unit || 'tờ');
    setPriceCostMode(item.pricing_mode);
    const currentRate =
      item.pricing_mode === VendorCostMode.TOTAL_BATCH
        ? item.batch_total_cost
        : item.unit_cost;
    setPriceUnitCost(item.unit_cost);
    setPriceBatchCost(item.batch_total_cost);
    setPriceDefaultProfitVal(item.default_profit_value);
    setCostRateInput(String(currentRate));
    setDefaultProfitInput(
      item.default_profit_value > 0 ? String(item.default_profit_value) : '0',
    );
    const savedBatchQty = Math.max(1, Math.round(item.batch_quantity ?? 1));
    setBatchQtyInput(String(savedBatchQty));
    const rawPolicy =
      typeof item.structured_spec?.['batch_qty_policy'] === 'string'
        ? item.structured_spec['batch_qty_policy'].toUpperCase()
        : '';
    if (
      rawPolicy === 'EXACT' ||
      rawPolicy === 'MAX' ||
      rawPolicy === 'ANY_QTY'
    ) {
      setBatchQtyPolicy(rawPolicy);
    } else {
      setBatchQtyPolicy(
        item.item_type === PriceItemType.FINISHING && savedBatchQty === 1
          ? 'ANY_QTY'
          : 'EXACT',
      );
    }
    setIncludedStages([...(item.included_stages ?? [])]);
    setCustomIncludedStageInput('');
    setConditionsNote(item.conditions_note || '');
    setChangeNote('');
    setDialogError(null);
    setIsPriceDialogOpen(true);
  };

  const handleOpenHistory = async (item: PrintVendorPriceItemData) => {
    setHistoryModalItem(item);
    setHistoryRecords([]);
    if (!onFetchPriceItemHistory) return;
    setHistoryLoading(true);
    try {
      const rows = await onFetchPriceItemHistory(item.id);
      setHistoryRecords(rows);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handlePriceDialogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setDialogError(null);

    if (!priceItemName.trim()) {
      setDialogError('Vui lòng nhập tên hạng mục giá xưởng.');
      return;
    }

    const parsedCost = parseNumericDraftValue(costRateInput, {
      allowDecimal: false,
      min: 0,
      integerOnly: true,
    });
    if (!parsedCost.isValid || parsedCost.value === null) {
      setDialogError(
        parsedCost.isEmpty
          ? 'Vui lòng nhập đơn giá xưởng (nhập 0 nếu miễn phí).'
          : 'Đơn giá xưởng không hợp lệ.',
      );
      return;
    }

    const parsedProfit =
      defaultProfitInput.trim() === ''
        ? { isValid: true, value: 0 }
        : parseNumericDraftValue(defaultProfitInput, {
            allowDecimal: false,
            min: 0,
            integerOnly: true,
          });
    if (!parsedProfit.isValid || parsedProfit.value === null) {
      setDialogError('Mức lời mặc định không hợp lệ.');
      return;
    }

    let resolvedBatchQuantity = 1;
    if (priceCostMode === VendorCostMode.TOTAL_BATCH) {
      const parsedBatchQty = parseNumericDraftValue(batchQtyInput, {
        allowDecimal: false,
        min: 1,
        integerOnly: true,
      });
      if (!parsedBatchQty.isValid || parsedBatchQty.value === null) {
        setDialogError('Số lượng chuẩn của lô phải từ 1 trở lên.');
        return;
      }
      resolvedBatchQuantity = parsedBatchQty.value;
    }

    setSubmitting(true);
    try {
      if (onSaveCatalogPriceItem) {
        const resolvedUnit =
          (priceUnit || '').trim() ||
          (priceCostMode === VendorCostMode.PER_SQM
            ? 'm²'
            : priceCostMode === VendorCostMode.TOTAL_BATCH
              ? 'lô'
              : 'tờ');
        const extraCustomStages = customIncludedStageInput
          .split(/[,;·]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const mergedIncluded =
          dialogItemType === PriceItemType.BASE_PRINT
            ? Array.from(new Set([...includedStages, ...extraCustomStages]))
            : [];
        const activeGroup = WORKSHOP_MATERIAL_GROUPS.find(
          (g) => g.id === selectedMaterialGroupId,
        );
        const nextStructuredSpec: Record<string, unknown> = {};
        if (dialogItemType === PriceItemType.BASE_PRINT) {
          nextStructuredSpec['materialGroup'] = selectedMaterialGroupId;
        }
        if (priceCostMode === VendorCostMode.TOTAL_BATCH) {
          nextStructuredSpec['batch_qty_policy'] = batchQtyPolicy;
        }

        const ok = await onSaveCatalogPriceItem(
          {
            vendor_id: priceVendorId.trim() || null,
            name: priceItemName.trim(),
            item_type: dialogItemType,
            category:
              dialogItemType === PriceItemType.FINISHING
                ? 'Công đoạn gia công'
                : (activeGroup?.label ?? 'Ấn phẩm in'),
            specification: priceSpec.trim() || null,
            included_stages: mergedIncluded,
            structured_spec:
              Object.keys(nextStructuredSpec).length > 0
                ? nextStructuredSpec
                : null,
            conditions_note: conditionsNote.trim() || null,
            unit: resolvedUnit,
            pricing_mode: priceCostMode,
            unit_cost:
              priceCostMode === VendorCostMode.TOTAL_BATCH
                ? 0
                : parsedCost.value,
            batch_quantity: resolvedBatchQuantity,
            batch_total_cost:
              priceCostMode === VendorCostMode.TOTAL_BATCH
                ? parsedCost.value
                : parsedCost.value,
            default_profit_mode: ProfitMode.FIXED_AMOUNT,
            default_profit_scope:
              priceCostMode === VendorCostMode.PER_SQM
                ? ProfitScope.PER_SQM
                : priceCostMode === VendorCostMode.TOTAL_BATCH
                  ? ProfitScope.TOTAL_BATCH
                  : ProfitScope.PER_UNIT,
            default_profit_value:
              dialogItemType === PriceItemType.FINISHING
                ? 0
                : parsedProfit.value,
            change_note: changeNote.trim() || null,
          },
          editingItemId,
        );
        if (ok !== false) {
          setIsPriceDialogOpen(false);
          setEditingItemId(null);
        }
      } else {
        const ok = await onCreatePriceItem(e);
        if (ok !== false) {
          setIsPriceDialogOpen(false);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVendorDialogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const ok = await onCreateVendor(e);
      if (ok !== false) {
        setIsVendorDialogOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === 'vendors') {
    return (
      <div
        data-testid="panel-catalog-vendors"
        style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <div className="pq-page-head">
          <div>
            <h1 className="pq-page-title">Nhà in đối tác ({vendors.length})</h1>
            <p className="pq-page-subtitle">
              Lưu thông tin liên hệ và tài khoản ngân hàng của các xưởng in gia
              công
            </p>
          </div>

          <button
            type="button"
            data-testid="pq-open-vendor-dialog-btn"
            onClick={() => setIsVendorDialogOpen(true)}
            className="pq-btn pq-btn-primary pq-btn-cta"
          >
            <PqPlusIcon size={15} />
            <span>Thêm nhà in</span>
          </button>
        </div>

        <div className="pq-toolbar-card">
          <div className="pq-search-wrap" style={{ maxWidth: '420px' }}>
            <PqSearchIcon size={15} className="pq-search-icon" />
            <input
              id="pq-vendor-search-input"
              type="search"
              aria-label="Tìm kiếm nhà in"
              style={{ ...inputStyle, paddingLeft: '36px', minHeight: '40px' }}
              placeholder="Tìm mã, tên xưởng in, SĐT hoặc ngân hàng…"
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
            />
          </div>
        </div>

        {filteredVendors.length === 0 ? (
          <div
            style={{
              ...cardStyle,
              padding: '40px 24px',
              textAlign: 'center',
            }}
          >
            {vendors.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                  maxWidth: '400px',
                  margin: '0 auto',
                }}
              >
                <div className="pq-empty-icon-ring">
                  <PqStoreIcon size={24} />
                </div>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>
                  Chưa có nhà in đối tác
                </div>
                <div style={{ color: 'var(--muted-color)', fontSize: '13px' }}>
                  Tạo hồ sơ xưởng in để quản lý bảng giá theo xưởng và thông tin
                  thanh toán đơn hàng.
                </div>
                <button
                  type="button"
                  onClick={() => setIsVendorDialogOpen(true)}
                  className="pq-btn pq-btn-primary"
                >
                  <PqPlusIcon size={15} />
                  <span>Thêm nhà in đầu tiên</span>
                </button>
              </div>
            ) : (
              <div style={{ color: 'var(--muted-color)', fontSize: '13.5px' }}>
                Không tìm thấy nhà in phù hợp với từ khóa.
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
              gap: '12px',
            }}
          >
            {filteredVendors.map((v) => {
              const vendorPriceCount = priceItems.filter(
                (p) => p.vendor_id === v.id && p.is_active !== false,
              ).length;
              return (
                <div
                  key={v.id}
                  data-testid={`vendor-row-${v.code}`}
                  className="pq-quote-card"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span className="pq-code-pill">{v.code}</span>
                      <strong style={{ fontSize: '14.5px' }}>{v.name}</strong>
                    </div>
                    <div
                      style={{
                        fontSize: '12.5px',
                        color: 'var(--muted-color)',
                        marginTop: '5px',
                      }}
                    >
                      SĐT:{' '}
                      <strong style={{ color: 'var(--text-color)' }}>
                        {v.phone || '—'}
                      </strong>{' '}
                      • NH: {v.bank_name || '—'}{' '}
                      {v.bank_account_number
                        ? `(${v.bank_account_number})`
                        : ''}
                    </div>
                  </div>

                  {onNavigateCatalogSubPage && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilterVendorId(v.id);
                        onNavigateCatalogSubPage('prices');
                      }}
                      className="pq-btn pq-btn-secondary"
                    >
                      <PqTagIcon size={14} />
                      <span>Bảng giá ({vendorPriceCount})</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <CatalogModalDialog
          open={isVendorDialogOpen}
          title="Thêm nhà in đối tác mới"
          subtitle="Lưu thông tin liên hệ và số tài khoản thanh toán của xưởng in."
          testId="pq-vendor-dialog"
          onClose={() => setIsVendorDialogOpen(false)}
        >
          <form
            onSubmit={handleVendorDialogSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
          >
            <div>
              <label htmlFor="pq-dialog-vendor-name" style={labelStyle}>
                Tên nhà in đối tác *
              </label>
              <input
                id="pq-dialog-vendor-name"
                aria-label="Tên nhà in"
                style={inputStyle}
                placeholder="VD: Xưởng In Nhanh Sài Gòn…"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                required
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                gap: '12px',
              }}
            >
              <div>
                <label htmlFor="pq-dialog-vendor-phone" style={labelStyle}>
                  Số điện thoại liên hệ
                </label>
                <input
                  id="pq-dialog-vendor-phone"
                  aria-label="Số điện thoại nhà in"
                  type="tel"
                  inputMode="tel"
                  style={inputStyle}
                  placeholder="VD: 0909111222…"
                  value={vendorPhone}
                  onChange={(e) => setVendorPhone(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="pq-dialog-vendor-bank" style={labelStyle}>
                  Ngân hàng
                </label>
                <input
                  id="pq-dialog-vendor-bank"
                  aria-label="Ngân hàng nhà in"
                  style={inputStyle}
                  placeholder="VD: Vietcombank…"
                  value={vendorBankName}
                  onChange={(e) => setVendorBankName(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label htmlFor="pq-dialog-vendor-account" style={labelStyle}>
                Số tài khoản ngân hàng
              </label>
              <input
                id="pq-dialog-vendor-account"
                aria-label="Số tài khoản nhà in"
                style={inputStyle}
                placeholder="VD: 0071000888999…"
                value={vendorBankAccount}
                onChange={(e) => setVendorBankAccount(e.target.value)}
              />
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
                onClick={() => setIsVendorDialogOpen(false)}
                className="pq-btn pq-btn-secondary"
              >
                Hủy
              </button>
              <button
                type="submit"
                data-testid="pq-submit-vendor-btn"
                disabled={submitting}
                className="pq-btn pq-btn-primary"
              >
                {submitting ? 'Đang lưu…' : 'Lưu nhà in'}
              </button>
            </div>
          </form>
        </CatalogModalDialog>
      </div>
    );
  }

  const activeMaterialGroup =
    WORKSHOP_MATERIAL_GROUPS.find((g) => g.id === selectedMaterialGroupId) ||
    WORKSHOP_MATERIAL_GROUPS[0];

  const baseActiveCount = activeItems.filter(
    (p) => (p.item_type || 'BASE_PRINT') === PriceItemType.BASE_PRINT,
  ).length;
  const finishingActiveCount = activeItems.filter(
    (p) => p.item_type === PriceItemType.FINISHING,
  ).length;

  const typeFilterTabs: Array<{
    id: PriceTypeFilter;
    label: string;
    count: number;
  }> = [
    { id: 'ACTIVE_ALL', label: 'Đang dùng', count: activeItems.length },
    { id: 'BASE_PRINT', label: 'Giá in cơ bản', count: baseActiveCount },
    {
      id: 'FINISHING',
      label: 'Công đoạn gia công',
      count: finishingActiveCount,
    },
    { id: 'INACTIVE', label: 'Đã ngừng dùng', count: inactiveItems.length },
  ];

  return (
    <div
      data-testid="panel-catalog-prices"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">
            Bảng giá xưởng ({activeItems.length})
          </h1>
          <p
            className="pq-page-subtitle"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <PqLockIcon size={13} />
            <span>
              Tách rõ giá in cơ bản và giá gia công — sửa bảng giá không làm đổi
              báo giá đã lưu
            </span>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="pq-open-finishing-price-dialog-btn"
            onClick={() => openCreateDialog(PriceItemType.FINISHING)}
            className="pq-btn pq-btn-secondary"
          >
            <PqPlusIcon size={14} />
            <span>Thêm giá gia công</span>
          </button>

          <button
            type="button"
            data-testid="pq-open-price-dialog-btn"
            onClick={() => openCreateDialog(PriceItemType.BASE_PRINT)}
            className="pq-btn pq-btn-primary pq-btn-cta"
          >
            <PqPlusIcon size={15} />
            <span>Thêm giá cơ bản</span>
          </button>
        </div>
      </div>

      {/* Unified Search, Type Segmented Pills & Optional Vendor Filter */}
      <div className="pq-toolbar-card">
        <div className="pq-search-wrap" style={{ flex: '1 1 230px' }}>
          <PqSearchIcon size={15} className="pq-search-icon" />
          <input
            id="pq-price-search-input"
            type="search"
            aria-label="Tìm kiếm hạng mục bảng giá xưởng"
            style={{ ...inputStyle, paddingLeft: '36px', minHeight: '40px' }}
            placeholder="Tìm tên giá cơ bản, gia công, quy cách hoặc xưởng…"
            value={catalogSearch}
            onChange={(e) => setCatalogSearch(e.target.value)}
          />
        </div>

        <div
          className="pq-filter-pills"
          role="group"
          aria-label="Lọc loại bảng giá xưởng"
        >
          {typeFilterTabs.map((tab) => {
            const active = typeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`pq-price-filter-${tab.id}`}
                aria-pressed={active}
                className="pq-filter-pill"
                data-active={active ? 'true' : 'false'}
                onClick={() => setTypeFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="pq-filter-pill-count">{tab.count}</span>
              </button>
            );
          })}
        </div>

        {vendors.length > 0 && (
          <select
            id="pq-price-vendor-filter"
            aria-label="Lọc theo xưởng in"
            style={{
              ...inputStyle,
              minHeight: '38px',
              width: 'auto',
              minWidth: '175px',
            }}
            value={filterVendorId}
            onChange={(e) => setFilterVendorId(e.target.value)}
          >
            <option value="ALL">Tất cả nguồn giá</option>
            <option value="__GENERAL__">Giá xưởng chung</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} — {v.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {filteredPriceItems.length === 0 ? (
        <div
          style={{
            ...cardStyle,
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          {priceItems.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                maxWidth: '440px',
                margin: '0 auto',
              }}
            >
              <div className="pq-empty-icon-ring">
                <PqTagIcon size={24} />
              </div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>
                Chưa có mục giá xưởng nào được lưu
              </div>
              <div style={{ color: 'var(--muted-color)', fontSize: '13px' }}>
                Thiết lập <strong>Giá in cơ bản</strong> (VD: A4 C200, in màu 2
                mặt) và <strong>Giá gia công</strong> (VD: Cán màng 1 mặt) để
                chọn nhanh khi tạo báo giá. Hệ thống không tự thêm giá mẫu.
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                }}
              >
                <button
                  type="button"
                  onClick={() => openCreateDialog(PriceItemType.BASE_PRINT)}
                  className="pq-btn pq-btn-primary"
                >
                  <PqPlusIcon size={15} />
                  <span>Thêm giá cơ bản</span>
                </button>
                <button
                  type="button"
                  onClick={() => openCreateDialog(PriceItemType.FINISHING)}
                  className="pq-btn pq-btn-secondary"
                >
                  <PqPlusIcon size={15} />
                  <span>Thêm giá gia công</span>
                </button>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--muted-color)', fontSize: '13.5px' }}>
              Không có mục giá xưởng phù hợp với bộ lọc đang chọn.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredPriceItems.map((p) => {
            const isFinishing = p.item_type === PriceItemType.FINISHING;
            const isActive = p.is_active !== false;
            const isUsed = Boolean(p.is_used_in_quotes);
            const busy = busyItemId === p.id;

            const rateLabel =
              p.pricing_mode === VendorCostMode.TOTAL_BATCH
                ? `${formatVnd(p.batch_total_cost)} / lô`
                : p.pricing_mode === VendorCostMode.PER_SQM
                  ? `${formatVnd(p.unit_cost)} / m²`
                  : `${formatVnd(p.unit_cost)} / ${p.unit}`;

            return (
              <div
                key={p.id}
                data-testid={`price-item-row-${p.code}`}
                className="pq-quote-card"
                style={{
                  opacity: isActive ? 1 : 0.78,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div style={{ minWidth: 0, flex: '1 1 250px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '7px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span className="pq-code-pill">{p.code}</span>
                      <StatusBadge
                        status={isFinishing ? 'neutral' : 'success'}
                        label={isFinishing ? 'Gia công' : 'Giá cơ bản'}
                      />
                      {!isActive && (
                        <StatusBadge status="muted" label="Đã ngừng dùng" />
                      )}
                      <strong style={{ fontSize: '14.5px' }}>{p.name}</strong>
                      <span className="pq-version-pill">
                        {p.vendor_name || 'Xưởng chung'} • v{p.version}
                      </span>
                    </div>

                    {p.specification && (
                      <div
                        style={{
                          color: 'var(--muted-color)',
                          fontSize: '12.5px',
                          marginTop: '5px',
                        }}
                      >
                        Quy cách: {p.specification}
                      </div>
                    )}

                    {p.included_stages && p.included_stages.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexWrap: 'wrap',
                          marginTop: '6px',
                          fontSize: '12px',
                        }}
                      >
                        <span
                          style={{
                            color: 'var(--muted-color)',
                            fontWeight: 600,
                          }}
                        >
                          Đã bao gồm:
                        </span>
                        {p.included_stages.map((stg) => (
                          <span key={stg} className="pq-safe-pill">
                            <PqCheckIcon size={11} />
                            <span>{stg}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {p.conditions_note && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--muted-color)',
                          marginTop: '4px',
                        }}
                      >
                        Điều kiện áp dụng: {p.conditions_note}
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: 'right', ...tabularNumStyle }}>
                    <div style={{ fontSize: '15px', fontWeight: 800 }}>
                      {rateLabel}
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: 'var(--muted-color)',
                        marginTop: '2px',
                      }}
                    >
                      {p.pricing_mode === VendorCostMode.PER_SQM
                        ? 'Tính theo diện tích m²'
                        : p.pricing_mode === VendorCostMode.TOTAL_BATCH
                          ? `Trọn lô (${p.batch_quantity ?? 1} ${p.unit})`
                          : `Tính theo 1 ${p.unit}`}
                      {!isFinishing && p.default_profit_value > 0
                        ? ` • +Lời mặc định: ${
                            p.default_profit_mode === 'PERCENTAGE'
                              ? `${p.default_profit_value}%`
                              : formatVnd(p.default_profit_value)
                          }`
                        : ''}
                    </div>
                  </div>
                </div>

                <div className="pq-quote-card-actions">
                  <div className="pq-action-group-left">
                    {isActive && !isFinishing && onQuickQuotePriceItem && (
                      <button
                        type="button"
                        data-testid={`pq-quick-quote-price-${p.code}`}
                        onClick={() => onQuickQuotePriceItem(p)}
                        className="pq-btn pq-btn-accent pq-btn-sm"
                      >
                        <PqPlusIcon size={13} />
                        <span>Báo giá</span>
                      </button>
                    )}

                    <button
                      type="button"
                      data-testid={`pq-edit-price-${p.code}`}
                      onClick={() => openEditDialog(p)}
                      className="pq-btn pq-btn-secondary pq-btn-sm"
                    >
                      <PqEditIcon size={13} />
                      <span>Sửa</span>
                    </button>

                    {onFetchPriceItemHistory && (
                      <button
                        type="button"
                        data-testid={`pq-history-price-${p.code}`}
                        onClick={() => void handleOpenHistory(p)}
                        className="pq-btn pq-btn-ghost pq-btn-sm"
                      >
                        <PqHistoryIcon size={13} />
                        <span>Lịch sử (v{p.version})</span>
                      </button>
                    )}
                  </div>

                  <div className="pq-action-group-right">
                    {isActive
                      ? onDeactivatePriceItem && (
                          <button
                            type="button"
                            data-testid={`pq-deactivate-price-${p.code}`}
                            disabled={busy}
                            onClick={async () => {
                              setBusyItemId(p.id);
                              try {
                                await onDeactivatePriceItem(p.id);
                              } finally {
                                setBusyItemId(null);
                              }
                            }}
                            className="pq-btn pq-btn-ghost pq-btn-sm"
                          >
                            <span>Ngừng dùng</span>
                          </button>
                        )
                      : onRestorePriceItem && (
                          <button
                            type="button"
                            data-testid={`pq-restore-price-${p.code}`}
                            disabled={busy}
                            onClick={async () => {
                              setBusyItemId(p.id);
                              try {
                                await onRestorePriceItem(p.id);
                              } finally {
                                setBusyItemId(null);
                              }
                            }}
                            className="pq-btn pq-btn-accent pq-btn-sm"
                          >
                            <span>Khôi phục</span>
                          </button>
                        )}

                    {onDeletePriceItem && (
                      <button
                        type="button"
                        data-testid={`pq-delete-price-${p.code}`}
                        disabled={busy || isUsed}
                        title={
                          isUsed
                            ? 'Mục giá đã được tham chiếu trong báo giá — chỉ được Ngừng dùng để bảo toàn lịch sử'
                            : 'Xóa mục giá chưa từng dùng trong báo giá'
                        }
                        onClick={() => setDeleteTargetItem(p)}
                        className="pq-btn pq-btn-danger-ghost pq-btn-sm"
                      >
                        <PqTrashIcon size={13} />
                        <span>{isUsed ? 'Đã dùng (Không xóa)' : 'Xóa'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Workshop Price Item Dialog */}
      <CatalogModalDialog
        open={isPriceDialogOpen}
        title={
          editingItemId
            ? 'Cập nhật mục Giá xưởng'
            : dialogItemType === PriceItemType.FINISHING
              ? 'Thêm Công đoạn gia công'
              : 'Thêm Giá in cơ bản'
        }
        subtitle="Thiết lập giá vốn thực tế của xưởng. Thay đổi tại đây sẽ tăng phiên bản mục giá và KHÔNG sửa các báo giá cũ."
        testId="pq-price-dialog"
        maxWidth="580px"
        onClose={() => setIsPriceDialogOpen(false)}
      >
        <form
          onSubmit={handlePriceDialogSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}
        >
          {/* Segmented Type Selector: BASE_PRINT vs FINISHING */}
          <div
            role="group"
            aria-label="Phân loại mục giá xưởng"
            className="pq-segmented-switch"
            style={{ alignSelf: 'flex-start' }}
          >
            <button
              type="button"
              data-testid="pq-dialog-type-base"
              aria-pressed={dialogItemType === PriceItemType.BASE_PRINT}
              data-active={
                dialogItemType === PriceItemType.BASE_PRINT ? 'true' : 'false'
              }
              className="pq-segmented-btn"
              onClick={() => setDialogItemType(PriceItemType.BASE_PRINT)}
            >
              <span>Giá in cơ bản</span>
            </button>
            <button
              type="button"
              data-testid="pq-dialog-type-finishing"
              aria-pressed={dialogItemType === PriceItemType.FINISHING}
              data-active={
                dialogItemType === PriceItemType.FINISHING ? 'true' : 'false'
              }
              className="pq-segmented-btn"
              onClick={() => setDialogItemType(PriceItemType.FINISHING)}
            >
              <span>Công đoạn gia công</span>
            </button>
          </div>

          {/* Quick Guided Chips (Compact — never a long table) */}
          {dialogItemType === PriceItemType.FINISHING ? (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted-color)',
                }}
              >
                Gợi ý công đoạn nhanh (hoặc tự gõ vào ô Tên bên dưới):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {WORKSHOP_FINISHING_SUGGESTIONS.map((sug) => (
                  <button
                    key={sug.name}
                    type="button"
                    onClick={() => {
                      setPriceItemName(sug.name);
                      setPriceUnit?.(sug.defaultUnit);
                      setPriceCostMode(sug.defaultMode);
                    }}
                    className="pq-filter-pill"
                    data-active={priceItemName === sug.name ? 'true' : 'false'}
                    style={{ minHeight: '30px', padding: '4px 10px' }}
                  >
                    {sug.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div
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
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                  }}
                >
                  Nhóm chất liệu gợi ý:
                </span>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  {WORKSHOP_MATERIAL_GROUPS.map((grp) => (
                    <button
                      key={grp.id}
                      type="button"
                      onClick={() => {
                        setSelectedMaterialGroupId(grp.id);
                        if (!editingItemId) {
                          setPriceUnit?.(grp.defaultUnit);
                          if (grp.defaultUnit === 'm²') {
                            setPriceCostMode(VendorCostMode.PER_SQM);
                          }
                        }
                      }}
                      className="pq-filter-pill"
                      data-active={
                        selectedMaterialGroupId === grp.id ? 'true' : 'false'
                      }
                      style={{ minHeight: '28px', padding: '3px 9px' }}
                    >
                      {grp.label}
                    </button>
                  ))}
                </div>
              </div>

              {activeMaterialGroup.id !== 'KHAC' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {[
                    ...activeMaterialGroup.subtypes,
                    ...(activeMaterialGroup.gsmBySubtype.default ?? []),
                    ...activeMaterialGroup.sizes,
                    ...activeMaterialGroup.printColors,
                  ]
                    .filter((tok) => tok !== 'Khác')
                    .slice(0, 14)
                    .map((chip) => {
                      const activeChip = priceSpec
                        .toLowerCase()
                        .includes(chip.toLowerCase());
                      return (
                        <button
                          key={chip}
                          type="button"
                          onClick={() =>
                            setPriceSpec(appendSpecChip(priceSpec, chip))
                          }
                          className="pq-filter-pill"
                          data-active={activeChip ? 'true' : 'false'}
                          style={{
                            minHeight: '28px',
                            padding: '2px 8px',
                            fontSize: '12px',
                          }}
                        >
                          + {chip}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
              gap: '12px',
            }}
          >
            <div>
              <label htmlFor="pq-dialog-price-name" style={labelStyle}>
                {dialogItemType === PriceItemType.FINISHING
                  ? 'Tên công đoạn gia công *'
                  : 'Tên hạng mục giá cơ bản *'}
              </label>
              <input
                id="pq-dialog-price-name"
                aria-label="Tên hạng mục bảng giá"
                style={inputStyle}
                placeholder={
                  dialogItemType === PriceItemType.FINISHING
                    ? 'VD: Cán màng 1 mặt…'
                    : 'VD: A4 C200, in màu 2 mặt…'
                }
                value={priceItemName}
                onChange={(e) => setPriceItemName(e.target.value)}
                required
              />
            </div>

            <div>
              <label htmlFor="pq-dialog-price-vendor" style={labelStyle}>
                Xưởng áp dụng (Không bắt buộc)
              </label>
              <select
                id="pq-dialog-price-vendor"
                aria-label="Chọn nhà in cho bảng giá"
                style={inputStyle}
                value={priceVendorId}
                onChange={(e) => setPriceVendorId(e.target.value)}
              >
                <option value="">-- Giá xưởng chung --</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.code} — {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="pq-dialog-price-spec" style={labelStyle}>
              Quy cách / Chất liệu (Sửa hoặc tự nhập Khác)
            </label>
            <input
              id="pq-dialog-price-spec"
              aria-label="Quy cách in bảng giá"
              style={inputStyle}
              placeholder="VD: A4 · Couche C200 · In màu 2 mặt…"
              value={priceSpec}
              onChange={(e) => setPriceSpec(e.target.value)}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
              gap: '10px',
            }}
          >
            <div>
              <label htmlFor="pq-dialog-price-mode" style={labelStyle}>
                Cách tính giá xưởng
              </label>
              <select
                id="pq-dialog-price-mode"
                aria-label="Kiểu tính giá nhà in"
                style={inputStyle}
                value={priceCostMode}
                onChange={(e) => {
                  const nextMode = e.target.value as VendorCostModeType;
                  setPriceCostMode(nextMode);
                  if (nextMode === VendorCostMode.PER_SQM) {
                    setPriceUnit?.('m²');
                  } else if (
                    nextMode === VendorCostMode.TOTAL_BATCH &&
                    priceUnit === 'm²'
                  ) {
                    setPriceUnit?.('lô');
                  }
                }}
              >
                <option value={VendorCostMode.PER_UNIT}>Theo 1 đơn vị</option>
                <option value={VendorCostMode.PER_SQM}>
                  Theo diện tích (m²)
                </option>
                <option value={VendorCostMode.TOTAL_BATCH}>Trọn lô</option>
              </select>
            </div>

            <div>
              <label htmlFor="pq-dialog-price-unit" style={labelStyle}>
                Đơn vị tính
              </label>
              <input
                id="pq-dialog-price-unit"
                aria-label="Đơn vị tính bảng giá"
                style={inputStyle}
                placeholder="tờ, m², hộp, lô…"
                value={priceUnit}
                onChange={(e) => setPriceUnit?.(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="pq-dialog-price-unit-cost" style={labelStyle}>
                {priceCostMode === VendorCostMode.TOTAL_BATCH
                  ? 'Giá xưởng trọn lô (đ) *'
                  : priceCostMode === VendorCostMode.PER_SQM
                    ? 'Giá xưởng / 1 m² (đ) *'
                    : `Giá xưởng / 1 ${priceUnit || 'đv'} (đ) *`}
              </label>
              <NumericDraftInput
                id="pq-dialog-price-unit-cost"
                ariaLabel="Đơn giá vốn nhà in"
                allowDecimal={false}
                style={{ ...inputStyle, ...tabularNumStyle }}
                placeholder="VD: 4000"
                value={costRateInput}
                onValueChange={(nextRaw) => {
                  setCostRateInput(nextRaw);
                  const parsed = parseNumericDraftValue(nextRaw, {
                    allowDecimal: false,
                    min: 0,
                    integerOnly: true,
                  });
                  if (parsed.isValid && parsed.value !== null) {
                    setPriceUnitCost(parsed.value);
                    setPriceBatchCost(parsed.value);
                  }
                }}
              />
            </div>
          </div>

          {priceCostMode === VendorCostMode.TOTAL_BATCH && (
            <div
              data-testid="pq-dialog-batch-condition-row"
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                gap: '10px',
              }}
            >
              <div>
                <label htmlFor="pq-dialog-batch-qty" style={labelStyle}>
                  Số lượng chuẩn của lô *
                </label>
                <NumericDraftInput
                  id="pq-dialog-batch-qty"
                  dataTestId="pq-dialog-batch-qty"
                  ariaLabel="Số lượng chuẩn của lô"
                  allowDecimal={false}
                  style={{ ...inputStyle, ...tabularNumStyle }}
                  placeholder="VD: 500 hoặc 1000"
                  value={batchQtyInput}
                  onValueChange={(nextRaw) => setBatchQtyInput(nextRaw)}
                />
              </div>

              <div>
                <label htmlFor="pq-dialog-batch-policy" style={labelStyle}>
                  Điều kiện áp dụng khi khác số lượng lô
                </label>
                <select
                  id="pq-dialog-batch-policy"
                  data-testid="pq-dialog-batch-policy"
                  aria-label="Điều kiện áp dụng giá trọn lô"
                  style={inputStyle}
                  value={batchQtyPolicy}
                  onChange={(e) =>
                    setBatchQtyPolicy(
                      e.target.value as 'EXACT' | 'MAX' | 'ANY_QTY',
                    )
                  }
                >
                  <option value="EXACT">
                    Chỉ áp dụng đúng bằng SL lô (chặn SL khác)
                  </option>
                  <option value="MAX">
                    Áp dụng tối đa đến SL lô (chặn vượt lô)
                  </option>
                  <option value="ANY_QTY">
                    Phí cố định 1 lô cho mọi số lượng
                  </option>
                </select>
              </div>
            </div>
          )}

          {dialogItemType === PriceItemType.BASE_PRINT && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
                gap: '12px',
              }}
            >
              <div>
                <label htmlFor="pq-dialog-price-profit" style={labelStyle}>
                  Lời mặc định gợi ý (đ — Không bắt buộc)
                </label>
                <NumericDraftInput
                  id="pq-dialog-price-profit"
                  ariaLabel="Lợi nhuận mặc định"
                  allowDecimal={false}
                  style={{ ...inputStyle, ...tabularNumStyle }}
                  placeholder="Để trống hoặc 0"
                  value={defaultProfitInput}
                  onValueChange={(nextRaw) => {
                    setDefaultProfitInput(nextRaw);
                    const parsed = parseNumericDraftValue(nextRaw, {
                      allowDecimal: false,
                      min: 0,
                      integerOnly: true,
                    });
                    if (parsed.isValid && parsed.value !== null) {
                      setPriceDefaultProfitVal(parsed.value);
                    }
                  }}
                />
              </div>

              <div>
                <label htmlFor="pq-dialog-conditions-note" style={labelStyle}>
                  Điều kiện áp dụng
                </label>
                <input
                  id="pq-dialog-conditions-note"
                  aria-label="Điều kiện áp dụng giá xưởng"
                  style={inputStyle}
                  placeholder="VD: Áp dụng từ 100 tờ, lấy trong ngày…"
                  value={conditionsNote}
                  onChange={(e) => setConditionsNote(e.target.value)}
                />
              </div>
            </div>
          )}

          {dialogItemType === PriceItemType.FINISHING && (
            <div>
              <label htmlFor="pq-dialog-conditions-note" style={labelStyle}>
                Điều kiện áp dụng / Ghi chú gia công
              </label>
              <input
                id="pq-dialog-conditions-note"
                aria-label="Điều kiện áp dụng giá gia công"
                style={inputStyle}
                placeholder="VD: Khuôn bế có sẵn, từ 500 tờ trở lên…"
                value={conditionsNote}
                onChange={(e) => setConditionsNote(e.target.value)}
              />
            </div>
          )}

          {dialogItemType === PriceItemType.BASE_PRINT && (
            <div
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
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted-color)',
                }}
              >
                Công đoạn đã bao gồm sẵn trong giá cơ bản này (để cảnh báo tránh
                cộng trùng):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {QUICK_INCLUDED_STAGE_OPTIONS.map((opt) => {
                  const active = includedStages.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      data-testid={`pq-included-stage-chip-${opt}`}
                      onClick={() =>
                        setIncludedStages((prev) =>
                          prev.includes(opt)
                            ? prev.filter((x) => x !== opt)
                            : [...prev, opt],
                        )
                      }
                      className="pq-filter-pill"
                      data-active={active ? 'true' : 'false'}
                      style={{ minHeight: '30px', padding: '4px 10px' }}
                    >
                      {active ? `✓ ${opt}` : `+ ${opt}`}
                    </button>
                  );
                })}
              </div>
              <input
                aria-label="Công đoạn khác đã bao gồm"
                style={{ ...inputStyle, minHeight: '36px', fontSize: '12.5px' }}
                placeholder="Hoặc nhập thêm công đoạn đã gộp (cách nhau bằng dấu phẩy)…"
                value={customIncludedStageInput}
                onChange={(e) => setCustomIncludedStageInput(e.target.value)}
              />
            </div>
          )}

          {editingItemId && (
            <div>
              <label htmlFor="pq-dialog-change-note" style={labelStyle}>
                Lý do điều chỉnh giá (lưu vào lịch sử giá)
              </label>
              <input
                id="pq-dialog-change-note"
                aria-label="Lý do điều chỉnh giá xưởng"
                style={inputStyle}
                placeholder="VD: Xưởng báo giá giấy mới tháng 11…"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
              />
            </div>
          )}

          {dialogError && (
            <div
              role="alert"
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid var(--danger-text)',
                color: 'var(--danger-text)',
                fontSize: '12.5px',
                fontWeight: 600,
              }}
            >
              {dialogError}
            </div>
          )}

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
              onClick={() => setIsPriceDialogOpen(false)}
              className="pq-btn pq-btn-secondary"
            >
              Hủy
            </button>
            <button
              type="submit"
              data-testid="pq-submit-price-item-btn"
              disabled={submitting}
              className="pq-btn pq-btn-primary"
            >
              {submitting
                ? 'Đang lưu…'
                : editingItemId
                  ? 'Lưu cập nhật giá'
                  : 'Lưu vào Bảng giá xưởng'}
            </button>
          </div>
        </form>
      </CatalogModalDialog>

      {/* Immutable Price History Modal */}
      <CatalogModalDialog
        open={historyModalItem !== null}
        title={`Lịch sử thay đổi giá — ${historyModalItem?.code || ''} ${historyModalItem?.name || ''}`}
        subtitle="Mọi lần tạo, cập nhật, ngừng dùng và khôi phục đều được lưu vết kèm thời gian và người thực hiện."
        testId="pq-price-history-dialog"
        maxWidth="560px"
        onClose={() => setHistoryModalItem(null)}
      >
        {historyLoading ? (
          <div style={{ fontSize: '13px', color: 'var(--muted-color)' }}>
            Đang tải lịch sử thay đổi giá…
          </div>
        ) : historyRecords.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--muted-color)' }}>
            Chưa có bản ghi lịch sử thay đổi.
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
            {historyRecords.map((rec) => {
              const afterMode = String(
                rec.after_json?.['pricing_mode'] || 'PER_UNIT',
              );
              const afterRate =
                afterMode === 'TOTAL_BATCH'
                  ? Number(rec.after_json?.['batch_total_cost'] ?? 0)
                  : Number(rec.after_json?.['unit_cost'] ?? 0);
              const actionLabel =
                rec.action === 'CREATED'
                  ? 'Tạo mới'
                  : rec.action === 'UPDATED'
                    ? 'Cập nhật giá'
                    : rec.action === 'DEACTIVATED'
                      ? 'Ngừng dùng'
                      : 'Khôi phục';
              return (
                <div key={rec.id} className="pq-version-card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      flexWrap: 'wrap',
                      fontSize: '13px',
                    }}
                  >
                    <strong>
                      v{rec.version} • {actionLabel}
                    </strong>
                    <span
                      style={{
                        color: 'var(--accent-text)',
                        fontWeight: 700,
                        ...tabularNumStyle,
                      }}
                    >
                      {formatVnd(afterRate)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '3px',
                    }}
                  >
                    {rec.change_note ? `${rec.change_note} • ` : ''}
                    {rec.changed_by_name ? `Bởi ${rec.changed_by_name} • ` : ''}
                    {formatDateVn(rec.changed_at)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CatalogModalDialog>

      {/* Delete Unused Price Item Confirmation Modal */}
      <CatalogModalDialog
        open={deleteTargetItem !== null}
        title="Xóa mục giá xưởng?"
        subtitle={`Mục "${deleteTargetItem?.name || ''}" chưa từng dùng trong báo giá nào. Nếu chỉ muốn tạm ẩn, hãy chọn "Ngừng dùng".`}
        testId="pq-delete-price-dialog"
        maxWidth="440px"
        onClose={() => setDeleteTargetItem(null)}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            marginTop: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => setDeleteTargetItem(null)}
            className="pq-btn pq-btn-secondary"
          >
            Hủy
          </button>
          <button
            type="button"
            data-testid="pq-confirm-delete-price-btn"
            onClick={async () => {
              const target = deleteTargetItem;
              setDeleteTargetItem(null);
              if (!target || !onDeletePriceItem) return;
              setBusyItemId(target.id);
              try {
                await onDeletePriceItem(target.id);
              } finally {
                setBusyItemId(null);
              }
            }}
            className="pq-btn pq-btn-danger-ghost"
          >
            Xác nhận xóa
          </button>
        </div>
      </CatalogModalDialog>
    </div>
  );
};
