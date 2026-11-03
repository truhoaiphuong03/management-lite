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
import { cardStyle, inputStyle, labelStyle, tabularNumStyle } from './types.js';
import { NumericDraftInput } from './NumericDraftInput.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';
import {
  PqLockIcon,
  PqPlusIcon,
  PqSearchIcon,
  PqStoreIcon,
  PqTagIcon,
} from './PrintQuoteIcons.js';

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
  onQuickQuotePriceItem?:
    ((item: PrintVendorPriceItemData) => void) | undefined;
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
                  Tạo hồ sơ xưởng in để quản lý bảng giá gốc và thông tin thanh
                  toán đơn hàng.
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
                (p) => p.vendor_id === v.id,
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

  return (
    <div
      data-testid="panel-catalog-prices"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">
            Bảng giá gốc nhà in ({priceItems.length})
          </h1>
          <p
            className="pq-page-subtitle"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <PqLockIcon size={13} />
            <span>
              Cập nhật bảng giá tại đây không làm thay đổi các báo giá & đơn
              hàng đã lưu trước đó
            </span>
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
          className="pq-btn pq-btn-primary pq-btn-cta"
        >
          <PqPlusIcon size={15} />
          <span>Thêm bảng giá</span>
        </button>
      </div>

      {/* Unified Search & Vendor Filter Bar */}
      <div className="pq-toolbar-card">
        <div className="pq-search-wrap" style={{ flex: '1 1 240px' }}>
          <PqSearchIcon size={15} className="pq-search-icon" />
          <input
            id="pq-price-search-input"
            type="search"
            aria-label="Tìm kiếm hạng mục bảng giá"
            style={{ ...inputStyle, paddingLeft: '36px', minHeight: '40px' }}
            placeholder="Tìm tên ấn phẩm, quy cách hoặc tên nhà in…"
            value={catalogSearch}
            onChange={(e) => setCatalogSearch(e.target.value)}
          />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <select
            id="pq-price-vendor-filter"
            aria-label="Lọc theo nhà in"
            style={{
              ...inputStyle,
              minHeight: '40px',
              width: 'auto',
              minWidth: '190px',
            }}
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

          {filterVendorId !== 'ALL' && (
            <button
              type="button"
              onClick={() => setFilterVendorId('ALL')}
              className="pq-btn pq-btn-ghost"
            >
              Bỏ lọc
            </button>
          )}
        </div>
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
                maxWidth: '420px',
                margin: '0 auto',
              }}
            >
              <div className="pq-empty-icon-ring">
                <PqTagIcon size={24} />
              </div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>
                Chưa có hạng mục bảng giá
              </div>
              <div style={{ color: 'var(--muted-color)', fontSize: '13px' }}>
                Lưu đơn giá gốc của nhà in và mức lời mặc định để chọn 1 chạm
                khi lập báo giá.
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!priceVendorId && vendors[0]) {
                    setPriceVendorId(vendors[0].id);
                  }
                  setIsPriceDialogOpen(true);
                }}
                className="pq-btn pq-btn-primary"
              >
                <PqPlusIcon size={15} />
                <span>Thêm hạng mục đầu tiên</span>
              </button>
            </div>
          ) : (
            <div style={{ color: 'var(--muted-color)', fontSize: '13.5px' }}>
              Không tìm thấy hạng mục bảng giá phù hợp.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredPriceItems.map((p) => (
            <div
              key={p.id}
              data-testid={`price-item-row-${p.code}`}
              className="pq-quote-card"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span className="pq-code-pill">{p.code}</span>
                  <strong style={{ fontSize: '14.5px' }}>{p.name}</strong>
                  <span className="pq-version-pill">
                    {p.vendor_name || 'Nhà in'} • v{p.version}
                  </span>
                </div>
                {p.specification && (
                  <div
                    style={{
                      color: 'var(--muted-color)',
                      fontSize: '12.5px',
                      marginTop: '4px',
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
                  gap: '14px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ textAlign: 'right', ...tabularNumStyle }}>
                  <div style={{ fontSize: '13.5px' }}>
                    Giá vốn:{' '}
                    <strong>
                      {p.pricing_mode === 'TOTAL_BATCH'
                        ? `${formatVnd(p.batch_total_cost)} / lô`
                        : `${formatVnd(p.unit_cost)} / ${p.unit}`}
                    </strong>
                  </div>
                  <div
                    style={{
                      color: 'var(--success-text)',
                      fontSize: '12px',
                      fontWeight: 600,
                      marginTop: '2px',
                    }}
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
                    className="pq-btn pq-btn-accent"
                  >
                    <PqPlusIcon size={14} />
                    <span>Báo giá</span>
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
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
          >
            <div style={{ fontSize: '13.5px', color: 'var(--muted-color)' }}>
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
                className="pq-btn pq-btn-primary"
                style={{ alignSelf: 'flex-start' }}
              >
                <PqStoreIcon size={15} />
                <span>Chuyển sang trang Nhà in đối tác</span>
              </button>
            )}
          </div>
        ) : (
          <form
            onSubmit={handlePriceDialogSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
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
                gap: '12px',
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
                  placeholder="VD: Tờ rơi A5 Couche 150gsm…"
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
                  placeholder="VD: tờ, hộp, cuốn…"
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
                placeholder="VD: In Offset 4 màu, 2 mặt, cán bóng…"
                value={priceSpec}
                onChange={(e) => setPriceSpec(e.target.value)}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
                gap: '12px',
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
                {submitting ? 'Đang lưu…' : 'Lưu vào Bảng giá'}
              </button>
            </div>
          </form>
        )}
      </CatalogModalDialog>
    </div>
  );
};
