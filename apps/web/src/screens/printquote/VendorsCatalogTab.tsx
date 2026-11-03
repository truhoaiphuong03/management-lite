import React, { useState, useMemo, useEffect } from 'react';
import {
  VendorCostMode,
  type VendorCostModeType,
  type PrintVendorData,
  type PrintVendorPriceItemData,
} from '../../../../../packages/contracts/src/printquote.js';
import {
  formatVnd,
  parseNumericDraftValue,
} from '../helpers/printquote-helpers.js';
import { cardStyle, inputStyle, labelStyle } from './types.js';
import { NumericDraftInput } from './NumericDraftInput.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';

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
  onQuickQuotePriceItem?: ((item: PrintVendorPriceItemData) => void) | undefined;
  onNavigateCatalogSubPage?: ((sub: 'prices' | 'vendors') => void) | undefined;
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
  priceUnitCost,
  setPriceUnitCost,
  priceBatchCost,
  setPriceBatchCost,
  priceDefaultProfitVal,
  setPriceDefaultProfitVal,
  onCreatePriceItem,
  onQuickQuotePriceItem,
  onNavigateCatalogSubPage,
}) => {
  const [filterVendorId, setFilterVendorId] = useState<string>('ALL');
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [vendorSearch, setVendorSearch] = useState<string>('');
  const [isPriceDialogOpen, setIsPriceDialogOpen] = useState<boolean>(false);
  const [isVendorDialogOpen, setIsVendorDialogOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const [unitCostInput, setUnitCostInput] = useState<string>(
    priceUnitCost > 0 ? String(priceUnitCost) : '',
  );
  const [batchCostInput, setBatchCostInput] = useState<string>(
    priceBatchCost > 0 ? String(priceBatchCost) : '',
  );
  const [defaultProfitInput, setDefaultProfitInput] = useState<string>(
    priceDefaultProfitVal > 0 ? String(priceDefaultProfitVal) : '',
  );

  useEffect(() => {
    setUnitCostInput((prev) =>
      prev === ''
        ? prev
        : Number(prev) === priceUnitCost
          ? prev
          : String(priceUnitCost),
    );
  }, [priceUnitCost]);

  useEffect(() => {
    setBatchCostInput((prev) =>
      prev === ''
        ? prev
        : Number(prev) === priceBatchCost
          ? prev
          : String(priceBatchCost),
    );
  }, [priceBatchCost]);

  useEffect(() => {
    setDefaultProfitInput((prev) =>
      prev === ''
        ? prev
        : Number(prev) === priceDefaultProfitVal
          ? prev
          : String(priceDefaultProfitVal),
    );
  }, [priceDefaultProfitVal]);

  const filteredPriceItems = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return priceItems.filter((item) => {
      if (filterVendorId !== 'ALL' && item.vendor_id !== filterVendorId) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q) ||
        (item.specification || '').toLowerCase().includes(q) ||
        (item.vendor_name || '').toLowerCase().includes(q)
      );
    });
  }, [priceItems, filterVendorId, catalogSearch]);

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

  const handlePriceDialogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const ok = await onCreatePriceItem(e);
      if (ok !== false) {
        setIsPriceDialogOpen(false);
        setUnitCostInput('');
        setBatchCostInput('');
        setDefaultProfitInput('');
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
      <div style={cardStyle} data-testid="panel-catalog-vendors">
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
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700 }}>
              Danh sách Nhà in đối tác ({vendors.length})
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
              Lưu thông tin liên hệ và tài khoản thanh toán của các xưởng in đối
              tác
            </div>
          </div>

          <button
            type="button"
            data-testid="pq-open-vendor-dialog-btn"
            onClick={() => setIsVendorDialogOpen(true)}
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
            + Thêm nhà in
          </button>
        </div>

        <div style={{ marginBottom: '14px', maxWidth: '380px' }}>
          <label htmlFor="pq-vendor-search-input" style={labelStyle}>
            Tìm kiếm nhà in
          </label>
          <input
            id="pq-vendor-search-input"
            type="search"
            style={inputStyle}
            placeholder="Tìm mã, tên xưởng in, SĐT hoặc ngân hàng…"
            value={vendorSearch}
            onChange={(e) => setVendorSearch(e.target.value)}
          />
        </div>

        {filteredVendors.length === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: 'var(--muted-color)',
              fontSize: '13.5px',
            }}
          >
            {vendors.length === 0
              ? 'Chưa có nhà in đối tác nào. Bấm "+ Thêm nhà in" để tạo hồ sơ xưởng in đầu tiên.'
              : 'Không tìm thấy nhà in phù hợp với từ khóa.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredVendors.map((v) => {
              const vendorPriceCount = priceItems.filter(
                (p) => p.vendor_id === v.id,
              ).length;
              return (
                <div
                  key={v.id}
                  data-testid={`vendor-row-${v.code}`}
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    fontSize: '13px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px' }}>
                      <span style={{ color: 'var(--accent-text)' }}>
                        {v.code}
                      </span>{' '}
                      — {v.name}
                    </div>
                    <div
                      style={{
                        fontSize: '12.5px',
                        color: 'var(--muted-color)',
                        marginTop: '2px',
                      }}
                    >
                      SĐT: {v.phone || '—'} • NH: {v.bank_name || '—'}{' '}
                      {v.bank_account_number
                        ? `(${v.bank_account_number})`
                        : ''}{' '}
                      • {vendorPriceCount} hạng mục giá
                    </div>
                  </div>
                  {onNavigateCatalogSubPage && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilterVendorId(v.id);
                        onNavigateCatalogSubPage('prices');
                      }}
                      style={{
                        minHeight: '44px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--surface-color)',
                        color: 'var(--text-color)',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Xem bảng giá ({vendorPriceCount}) →
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
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <div>
              <label htmlFor="pq-dialog-vendor-name" style={labelStyle}>
                Tên nhà in đối tác *
              </label>
              <input
                id="pq-dialog-vendor-name"
                aria-label="Tên nhà in"
                style={inputStyle}
                placeholder="VD: Xưởng In Nhanh Sài Gòn"
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
                gap: '10px',
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
                  placeholder="VD: 0909111222"
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
                  placeholder="VD: Vietcombank"
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
                placeholder="VD: 0071000888999"
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
                data-testid="pq-submit-vendor-btn"
                disabled={submitting}
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
                {submitting ? 'Đang lưu…' : '+ Lưu Nhà in'}
              </button>
            </div>
          </form>
        </CatalogModalDialog>
      </div>
    );
  }

  return (
    <div style={cardStyle} data-testid="panel-catalog-prices">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '8px',
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700 }}>
            Bảng giá gốc Nhà in ({priceItems.length})
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              color: 'var(--muted-color)',
            }}
          >
            🔒 Khi thêm hoặc cập nhật bảng giá tại đây, các báo giá và đơn hàng
            cũ đã lưu trước đó giữ nguyên 100%, không bị tự động đổi giá.
          </p>
        </div>

        <button
          type="button"
          data-testid="pq-open-price-dialog-btn"
          onClick={() => {
            if (!priceVendorId && vendors[0]) {
              setPriceVendorId(vendors[0].id);
            }
            setIsPriceDialogOpen(true);
          }}
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
          + Thêm bảng giá
        </button>
      </div>

      {/* Search & Vendor Filter Bar */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          marginBottom: '14px',
          marginTop: '12px',
        }}
      >
        <div style={{ flex: '1 1 220px', maxWidth: '360px' }}>
          <label htmlFor="pq-price-search-input" style={labelStyle}>
            Tìm hạng mục bảng giá
          </label>
          <input
            id="pq-price-search-input"
            type="search"
            aria-label="Tìm kiếm hạng mục bảng giá"
            style={inputStyle}
            placeholder="Tìm tên ấn phẩm, quy cách hoặc tên nhà in…"
            value={catalogSearch}
            onChange={(e) => setCatalogSearch(e.target.value)}
          />
        </div>

        <div style={{ flex: '0 1 220px', minWidth: '170px' }}>
          <label htmlFor="pq-price-vendor-filter" style={labelStyle}>
            Lọc theo nhà in
          </label>
          <select
            id="pq-price-vendor-filter"
            style={inputStyle}
            value={filterVendorId}
            onChange={(e) => setFilterVendorId(e.target.value)}
          >
            <option value="ALL">Tất cả nhà in ({vendors.length})</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} — {v.name}
              </option>
            ))}
          </select>
        </div>

        {filterVendorId !== 'ALL' && (
          <button
            type="button"
            onClick={() => setFilterVendorId('ALL')}
            style={{
              minHeight: '44px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--surface-color)',
              color: 'var(--text-color)',
              fontSize: '12.5px',
              cursor: 'pointer',
            }}
          >
            ✕ Bỏ lọc nhà in
          </button>
        )}
      </div>

      {filteredPriceItems.length === 0 ? (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            color: 'var(--muted-color)',
            fontSize: '13.5px',
          }}
        >
          {priceItems.length === 0
            ? 'Chưa có hạng mục bảng giá nào. Bấm "+ Thêm bảng giá" để lưu đơn giá gốc của nhà in.'
            : 'Không tìm thấy hạng mục bảng giá phù hợp.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredPriceItems.map((p) => (
            <div
              key={p.id}
              data-testid={`price-item-row-${p.code}`}
              style={{
                padding: '12px',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                fontSize: '13px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <div>
                <strong>
                  <span style={{ color: 'var(--accent-text)' }}>{p.code}</span>{' '}
                  — {p.name}
                </strong>{' '}
                <span style={{ color: 'var(--muted-color)' }}>
                  ({p.vendor_name || 'Nhà in'}) • v{p.version}
                </span>
                {p.specification && (
                  <div
                    style={{
                      color: 'var(--muted-color)',
                      fontSize: '12px',
                      marginTop: '2px',
                    }}
                  >
                    Quy cách: {p.specification}
                  </div>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ textAlign: 'right' }}>
                  <div>
                    Giá vốn:{' '}
                    <strong>
                      {p.pricing_mode === 'TOTAL_BATCH'
                        ? `${formatVnd(p.batch_total_cost)} / lô`
                        : `${formatVnd(p.unit_cost)} / ${p.unit}`}
                    </strong>
                  </div>
                  <div
                    style={{ color: 'var(--success-text)', fontSize: '12px' }}
                  >
                    Lời mặc định:{' '}
                    {p.default_profit_mode === 'PERCENTAGE'
                      ? `${p.default_profit_value}%`
                      : formatVnd(p.default_profit_value)}
                  </div>
                </div>
                {onQuickQuotePriceItem && (
                  <button
                    type="button"
                    data-testid={`pq-quick-quote-price-${p.code}`}
                    onClick={() => onQuickQuotePriceItem(p)}
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
                    + Báo giá
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CatalogModalDialog
        open={isPriceDialogOpen}
        title="Thêm hạng mục vào Bảng giá nhà in"
        subtitle="Lưu đơn giá gốc của xưởng in và mức lời mặc định để chọn nhanh khi lập báo giá."
        testId="pq-price-dialog"
        onClose={() => setIsPriceDialogOpen(false)}
      >
        {vendors.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '13px', color: 'var(--muted-color)' }}>
              Bạn cần thêm ít nhất 1 Nhà in đối tác trước khi tạo hạng mục bảng
              giá.
            </div>
            {onNavigateCatalogSubPage && (
              <button
                type="button"
                onClick={() => {
                  setIsPriceDialogOpen(false);
                  onNavigateCatalogSubPage('vendors');
                }}
                style={{
                  minHeight: '44px',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: 'var(--primary-color)',
                  color: 'var(--inverse-text)',
                  fontWeight: 800,
                  cursor: 'pointer',
                  alignSelf: 'flex-start',
                }}
              >
                Chuyển sang trang Nhà in đối tác →
              </button>
            )}
          </div>
        ) : (
          <form
            onSubmit={handlePriceDialogSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <div>
              <label htmlFor="pq-dialog-price-vendor" style={labelStyle}>
                Nhà in đối tác *
              </label>
              <select
                id="pq-dialog-price-vendor"
                aria-label="Chọn nhà in cho bảng giá"
                style={inputStyle}
                value={priceVendorId}
                onChange={(e) => setPriceVendorId(e.target.value)}
                required
              >
                <option value="">-- Chọn Nhà in --</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.code} — {v.name}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                gap: '10px',
              }}
            >
              <div>
                <label htmlFor="pq-dialog-price-name" style={labelStyle}>
                  Tên ấn phẩm / Hạng mục *
                </label>
                <input
                  id="pq-dialog-price-name"
                  aria-label="Tên hạng mục bảng giá"
                  style={inputStyle}
                  placeholder="VD: Tờ rơi A5 Couche 150gsm"
                  value={priceItemName}
                  onChange={(e) => setPriceItemName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label htmlFor="pq-dialog-price-unit" style={labelStyle}>
                  Đơn vị tính
                </label>
                <input
                  id="pq-dialog-price-unit"
                  aria-label="Đơn vị tính bảng giá"
                  style={inputStyle}
                  placeholder="VD: tờ, hộp, cuốn"
                  value={priceUnit}
                  onChange={(e) => setPriceUnit?.(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label htmlFor="pq-dialog-price-spec" style={labelStyle}>
                Quy cách / Chất liệu in
              </label>
              <input
                id="pq-dialog-price-spec"
                aria-label="Quy cách in bảng giá"
                style={inputStyle}
                placeholder="VD: In Offset 4 màu, 2 mặt, cán bóng"
                value={priceSpec}
                onChange={(e) => setPriceSpec(e.target.value)}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
                gap: '10px',
              }}
            >
              <div>
                <label htmlFor="pq-dialog-price-mode" style={labelStyle}>
                  Kiểu tính giá nhà in
                </label>
                <select
                  id="pq-dialog-price-mode"
                  aria-label="Kiểu tính giá nhà in"
                  style={inputStyle}
                  value={priceCostMode}
                  onChange={(e) =>
                    setPriceCostMode(e.target.value as VendorCostModeType)
                  }
                >
                  <option value={VendorCostMode.PER_UNIT}>
                    Giá theo 1 đơn vị
                  </option>
                  <option value={VendorCostMode.TOTAL_BATCH}>
                    Giá trọn lô
                  </option>
                </select>
              </div>

              {priceCostMode === VendorCostMode.PER_UNIT ? (
                <div>
                  <label htmlFor="pq-dialog-price-unit-cost" style={labelStyle}>
                    Đơn giá vốn nhà in (đ) *
                  </label>
                  <NumericDraftInput
                    id="pq-dialog-price-unit-cost"
                    ariaLabel="Đơn giá vốn nhà in"
                    allowDecimal={false}
                    style={inputStyle}
                    placeholder="VD: 300"
                    value={unitCostInput}
                    onValueChange={(nextRaw) => {
                      setUnitCostInput(nextRaw);
                      const parsed = parseNumericDraftValue(nextRaw, {
                        allowDecimal: false,
                        min: 0,
                        integerOnly: true,
                      });
                      if (parsed.isValid && parsed.value !== null) {
                        setPriceUnitCost(parsed.value);
                      }
                    }}
                  />
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="pq-dialog-price-batch-cost"
                    style={labelStyle}
                  >
                    Giá vốn trọn lô (đ) *
                  </label>
                  <NumericDraftInput
                    id="pq-dialog-price-batch-cost"
                    ariaLabel="Giá vốn trọn lô nhà in"
                    allowDecimal={false}
                    style={inputStyle}
                    placeholder="VD: 300000"
                    value={batchCostInput}
                    onValueChange={(nextRaw) => {
                      setBatchCostInput(nextRaw);
                      const parsed = parseNumericDraftValue(nextRaw, {
                        allowDecimal: false,
                        min: 0,
                        integerOnly: true,
                      });
                      if (parsed.isValid && parsed.value !== null) {
                        setPriceBatchCost(parsed.value);
                      }
                    }}
                  />
                </div>
              )}

              <div>
                <label htmlFor="pq-dialog-price-profit" style={labelStyle}>
                  Lời mặc định / đơn vị (đ)
                </label>
                <NumericDraftInput
                  id="pq-dialog-price-profit"
                  ariaLabel="Lợi nhuận mặc định"
                  allowDecimal={false}
                  style={inputStyle}
                  placeholder="VD: 200"
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
                onClick={() => setIsPriceDialogOpen(false)}
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
                data-testid="pq-submit-price-item-btn"
                disabled={submitting}
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
                {submitting ? 'Đang lưu…' : '+ Lưu vào Bảng giá'}
              </button>
            </div>
          </form>
        )}
      </CatalogModalDialog>
    </div>
  );
};
