import React, { useState, useMemo } from 'react';
import type { PrintCustomerData } from '../../../../../packages/contracts/src/printquote.js';
import { cardStyle, inputStyle, labelStyle } from './types.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';

export interface CustomersTabProps {
  customers: PrintCustomerData[];
  custName: string;
  setCustName: (v: string) => void;
  custCompany: string;
  setCustCompany: (v: string) => void;
  custPhone: string;
  setCustPhone: (v: string) => void;
  custAddress: string;
  setCustAddress: (v: string) => void;
  onCreateCustomer: (e: React.FormEvent) => Promise<boolean> | void;
  onSelectCustomerForQuote: (customerId: string) => void;
}

export const CustomersTab: React.FC<CustomersTabProps> = ({
  customers,
  custName,
  setCustName,
  custCompany,
  setCustCompany,
  custPhone,
  setCustPhone,
  custAddress,
  setCustAddress,
  onCreateCustomer,
  onSelectCustomerForQuote,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.company_name || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q),
    );
  }, [customers, searchQuery]);

  const handleDialogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const ok = await onCreateCustomer(e);
      if (ok !== false) {
        setIsDialogOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={cardStyle} data-testid="panel-customers">
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
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
            Danh bạ Khách hàng đặt in ({customers.length})
          </h2>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            Lưu thông tin khách hàng để chọn nhanh khi tạo báo giá và in lên PDF
            A4
          </div>
        </div>

        <button
          type="button"
          data-testid="pq-open-customer-dialog-btn"
          onClick={() => setIsDialogOpen(true)}
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
          + Thêm khách hàng
        </button>
      </div>

      <div style={{ marginBottom: '14px', maxWidth: '380px' }}>
        <label htmlFor="pq-customer-search-input" style={labelStyle}>
          Tìm kiếm khách hàng
        </label>
        <input
          id="pq-customer-search-input"
          type="search"
          aria-label="Tìm kiếm khách hàng"
          style={inputStyle}
          placeholder="Tìm tên, công ty, SĐT hoặc địa chỉ khách…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {filteredCustomers.length === 0 ? (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            color: 'var(--muted-color)',
            fontSize: '13.5px',
          }}
        >
          {customers.length === 0
            ? 'Chưa có hồ sơ khách hàng nào. Bấm "+ Thêm khách hàng" để tạo mới.'
            : 'Không tìm thấy khách hàng phù hợp.'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
            gap: '10px',
          }}
        >
          {filteredCustomers.map((c) => (
            <div
              key={c.id}
              data-testid={`customer-card-${c.code}`}
              style={{
                padding: '12px',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '13.5px' }}>
                  <span style={{ color: 'var(--accent-text)' }}>{c.code}</span>{' '}
                  — {c.name}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  {c.company_name ? `${c.company_name} • ` : ''}SĐT:{' '}
                  {c.phone || '—'}
                </div>
                {c.address && (
                  <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                    Đ/c: {c.address}
                  </div>
                )}
              </div>
              <button
                type="button"
                data-testid={`pq-quick-quote-customer-${c.code}`}
                onClick={() => onSelectCustomerForQuote(c.id)}
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
                  whiteSpace: 'nowrap',
                }}
              >
                + Báo giá
              </button>
            </div>
          ))}
        </div>
      )}

      <CatalogModalDialog
        open={isDialogOpen}
        title="Thêm khách hàng đặt in mới"
        subtitle="Thông tin khách hàng sẽ tự động điền vào biểu mẫu báo giá và PDF A4."
        testId="pq-customer-dialog"
        onClose={() => setIsDialogOpen(false)}
      >
        <form
          onSubmit={handleDialogSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
              gap: '10px',
            }}
          >
            <div>
              <label htmlFor="pq-dialog-cust-name" style={labelStyle}>
                Tên khách hàng *
              </label>
              <input
                id="pq-dialog-cust-name"
                aria-label="Tên khách hàng"
                style={inputStyle}
                placeholder="VD: Anh Minh"
                value={custName}
                onChange={(e) => setCustName(e.target.value)}
                required
              />
            </div>

            <div>
              <label htmlFor="pq-dialog-cust-phone" style={labelStyle}>
                Số điện thoại
              </label>
              <input
                id="pq-dialog-cust-phone"
                aria-label="Số điện thoại khách hàng"
                type="tel"
                inputMode="tel"
                style={inputStyle}
                placeholder="VD: 0918222333"
                value={custPhone}
                onChange={(e) => setCustPhone(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="pq-dialog-cust-company" style={labelStyle}>
              Công ty / Thương hiệu
            </label>
            <input
              id="pq-dialog-cust-company"
              aria-label="Tên công ty khách hàng"
              style={inputStyle}
              placeholder="VD: Công ty TNHH Thực Phẩm Xanh"
              value={custCompany}
              onChange={(e) => setCustCompany(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="pq-dialog-cust-address" style={labelStyle}>
              Địa chỉ nhận hàng
            </label>
            <input
              id="pq-dialog-cust-address"
              aria-label="Địa chỉ giao hàng"
              style={inputStyle}
              placeholder="VD: 120 Nguyễn Trãi, Q.1, TP.HCM"
              value={custAddress}
              onChange={(e) => setCustAddress(e.target.value)}
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
              onClick={() => setIsDialogOpen(false)}
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
              data-testid="pq-submit-customer-btn"
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
              {submitting ? 'Đang lưu…' : '+ Lưu Khách hàng'}
            </button>
          </div>
        </form>
      </CatalogModalDialog>
    </div>
  );
};
