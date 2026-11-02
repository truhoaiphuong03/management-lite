import React, { useState, useMemo } from 'react';
import {
  VendorCostMode,
  type VendorCostModeType,
  type PrintVendorData,
  type PrintVendorPriceItemData,
} from '../../../../../packages/contracts/src/printquote.js';
import { formatVnd } from '../helpers/printquote-helpers.js';
import { cardStyle, inputStyle } from './types.js';

export interface VendorsCatalogTabProps {
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
  onCreateVendor: (e: React.FormEvent) => void;
  priceVendorId: string;
  setPriceVendorId: (v: string) => void;
  priceItemName: string;
  setPriceItemName: (v: string) => void;
  priceSpec: string;
  setPriceSpec: (v: string) => void;
  priceCostMode: VendorCostModeType;
  setPriceCostMode: (v: VendorCostModeType) => void;
  priceUnitCost: number;
  setPriceUnitCost: (v: number) => void;
  priceBatchCost: number;
  setPriceBatchCost: (v: number) => void;
  priceDefaultProfitVal: number;
  setPriceDefaultProfitVal: (v: number) => void;
  onCreatePriceItem: (e: React.FormEvent) => void;
  onQuickQuotePriceItem?: (item: PrintVendorPriceItemData) => void;
}

export const VendorsCatalogTab: React.FC<VendorsCatalogTabProps> = ({
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
}) => {
  const [filterVendorId, setFilterVendorId] = useState<string>('ALL');
  const [catalogSearch, setCatalogSearch] = useState<string>('');

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

  return (
    <div
      data-testid="panel-vendors-catalog"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
        gap: '16px',
      }}
    >
      {/* Vendors Management */}
      <div style={cardStyle}>
        <div style={{ marginBottom: '12px' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700 }}>
            Danh sách Nhà in đối tác ({vendors.length})
          </h2>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            Lưu thông tin liên hệ và số tài khoản thanh toán của xưởng in
          </div>
        </div>

        <form
          onSubmit={onCreateVendor}
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
            gap: '8px',
            marginBottom: '14px',
            padding: '12px',
            borderRadius: '10px',
            backgroundColor: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
          }}
        >
          <input
            aria-label="Tên nhà in"
            style={inputStyle}
            placeholder="Tên nhà in *"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            required
          />
          <input
            aria-label="Số điện thoại nhà in"
            style={inputStyle}
            placeholder="Số điện thoại"
            value={vendorPhone}
            onChange={(e) => setVendorPhone(e.target.value)}
          />
          <input
            aria-label="Ngân hàng nhà in"
            style={inputStyle}
            placeholder="Ngân hàng (VD: VCB)"
            value={vendorBankName}
            onChange={(e) => setVendorBankName(e.target.value)}
          />
          <input
            aria-label="Số tài khoản nhà in"
            style={inputStyle}
            placeholder="Số tài khoản"
            value={vendorBankAccount}
            onChange={(e) => setVendorBankAccount(e.target.value)}
          />
          <button
            type="submit"
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'var(--accent-text)',
              color: '#0F172A',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            + Thêm Nhà in
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {vendors.map((v) => {
            const isFiltered = filterVendorId === v.id;
            return (
              <div
                key={v.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: isFiltered
                    ? '1px solid var(--accent-text)'
                    : '1px solid var(--border-color)',
                  backgroundColor: isFiltered
                    ? 'var(--accent-soft)'
                    : 'var(--bg-color)',
                  fontSize: '13px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>
                    <span style={{ color: 'var(--accent-text)' }}>
                      {v.code}
                    </span>{' '}
                    — {v.name}
                  </div>
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    SĐT: {v.phone || '—'} • NH: {v.bank_name || '—'}{' '}
                    {v.bank_account_number ? `(${v.bank_account_number})` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFilterVendorId(isFiltered ? 'ALL' : v.id)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface-color)',
                    color: isFiltered
                      ? 'var(--accent-text)'
                      : 'var(--muted-color)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {isFiltered ? 'Đang lọc bảng giá' : 'Xem bảng giá'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Vendor Price Catalog Management */}
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700 }}>
          Bảng giá gốc Nhà in ({priceItems.length})
        </h2>
        <p
          style={{
            margin: '0 0 12px',
            fontSize: '12px',
            color: 'var(--muted-color)',
          }}
        >
          🔒 Khi cập nhật giá nhà in tại đây, các báo giá và đơn hàng cũ đã tạo
          trước đó được giữ nguyên 100%, không bị tự động đổi giá.
        </p>

        <form
          onSubmit={onCreatePriceItem}
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
            gap: '8px',
            marginBottom: '14px',
            padding: '12px',
            borderRadius: '10px',
            backgroundColor: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
          }}
        >
          <select
            aria-label="Chọn nhà in cho bảng giá"
            style={inputStyle}
            value={priceVendorId}
            onChange={(e) => setPriceVendorId(e.target.value)}
          >
            <option value="">-- Chọn Nhà in --</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} — {v.name}
              </option>
            ))}
          </select>

          <input
            aria-label="Tên hạng mục bảng giá"
            style={inputStyle}
            placeholder="Tên ấn phẩm (VD: Tờ rơi A5) *"
            value={priceItemName}
            onChange={(e) => setPriceItemName(e.target.value)}
            required
          />

          <input
            aria-label="Quy cách in bảng giá"
            style={inputStyle}
            placeholder="Quy cách (VD: C150 2 mặt)"
            value={priceSpec}
            onChange={(e) => setPriceSpec(e.target.value)}
          />

          <select
            aria-label="Kiểu tính giá nhà in"
            style={inputStyle}
            value={priceCostMode}
            onChange={(e) =>
              setPriceCostMode(e.target.value as VendorCostModeType)
            }
          >
            <option value={VendorCostMode.PER_UNIT}>Giá theo 1 cái/tờ</option>
            <option value={VendorCostMode.TOTAL_BATCH}>Giá trọn lô</option>
          </select>

          {priceCostMode === VendorCostMode.PER_UNIT ? (
            <input
              aria-label="Đơn giá vốn nhà in"
              type="number"
              min={0}
              style={inputStyle}
              placeholder="Giá vốn / 1 cái"
              value={priceUnitCost}
              onChange={(e) =>
                setPriceUnitCost(Math.max(0, Number(e.target.value) || 0))
              }
            />
          ) : (
            <input
              aria-label="Giá vốn trọn lô nhà in"
              type="number"
              min={0}
              style={inputStyle}
              placeholder="Giá vốn trọn lô"
              value={priceBatchCost}
              onChange={(e) =>
                setPriceBatchCost(Math.max(0, Number(e.target.value) || 0))
              }
            />
          )}

          <input
            aria-label="Lợi nhuận mặc định"
            type="number"
            min={0}
            style={inputStyle}
            placeholder="Lời mặc định"
            value={priceDefaultProfitVal}
            onChange={(e) =>
              setPriceDefaultProfitVal(Math.max(0, Number(e.target.value) || 0))
            }
          />

          <button
            type="submit"
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'var(--accent-text)',
              color: '#0F172A',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            + Lưu vào Bảng giá
          </button>
        </form>

        {/* Search & Vendor Filter Bar */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            marginBottom: '10px',
          }}
        >
          <input
            type="search"
            aria-label="Tìm kiếm hạng mục bảng giá"
            style={{ ...inputStyle, flex: '1 1 200px' }}
            placeholder="Tìm tên ấn phẩm, quy cách hoặc tên nhà in…"
            value={catalogSearch}
            onChange={(e) => setCatalogSearch(e.target.value)}
          />
          {filterVendorId !== 'ALL' && (
            <button
              type="button"
              onClick={() => setFilterVendorId('ALL')}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--surface-color)',
                color: 'var(--text-color)',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              ✕ Bỏ lọc nhà in
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredPriceItems.map((p) => (
            <div
              key={p.id}
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                fontSize: '12.5px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div>
                <strong>
                  {p.code} — {p.name}
                </strong>{' '}
                <span style={{ color: 'var(--muted-color)' }}>
                  ({p.vendor_name || 'Nhà in'}) • v{p.version}
                </span>
                {p.specification && (
                  <div style={{ color: 'var(--muted-color)' }}>
                    Quy cách: {p.specification}
                  </div>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
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
                  <div style={{ color: 'var(--success-text)' }}>
                    Lời mặc định:{' '}
                    {p.default_profit_mode === 'PERCENTAGE'
                      ? `${p.default_profit_value}%`
                      : `${formatVnd(p.default_profit_value)}`}
                  </div>
                </div>
                {onQuickQuotePriceItem && (
                  <button
                    type="button"
                    onClick={() => onQuickQuotePriceItem(p)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--accent-text)',
                      backgroundColor: 'var(--accent-soft)',
                      color: 'var(--accent-text)',
                      fontSize: '12px',
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
      </div>
    </div>
  );
};
