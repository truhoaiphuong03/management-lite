import React, { useState, useMemo } from 'react';
import type { PrintCustomerData } from '../../../../../packages/contracts/src/printquote.js';
import { cardStyle, inputStyle, labelStyle } from './types.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';
import { PqPlusIcon, PqSearchIcon, PqUsersIcon } from './PrintQuoteIcons.js';

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
    <div
      data-testid="panel-customers"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">
            Khách hàng đặt in ({customers.length})
          </h1>
          <p className="pq-page-subtitle">
            Lưu thông tin liên hệ và địa chỉ giao hàng để chọn nhanh khi lập báo
            giá
          </p>
        </div>

        <button
          type="button"
          data-testid="pq-open-customer-dialog-btn"
          onClick={() => setIsDialogOpen(true)}
          className="pq-btn pq-btn-primary pq-btn-cta"
        >
          <PqPlusIcon size={15} />
          <span>Thêm khách hàng</span>
        </button>
      </div>

      <div className="pq-toolbar-card">
        <div className="pq-search-wrap" style={{ maxWidth: '420px' }}>
          <PqSearchIcon size={15} className="pq-search-icon" />
          <input
            id="pq-customer-search-input"
            type="search"
            aria-label="Tìm kiếm khách hàng"
            style={{ ...inputStyle, paddingLeft: '36px', minHeight: '40px' }}
            placeholder="Tìm tên, công ty, SĐT hoặc địa chỉ khách…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {filteredCustomers.length === 0 ? (
        <div
          style={{
            ...cardStyle,
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          {customers.length === 0 ? (
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
                <PqUsersIcon size={24} />
              </div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>
                Chưa có khách hàng trong danh bạ
              </div>
              <div style={{ color: 'var(--muted-color)', fontSize: '13px' }}>
                Thêm khách hàng thường xuyên để tự động điền tên, SĐT và địa chỉ
                trên PDF A4.
              </div>
              <button
                type="button"
                onClick={() => setIsDialogOpen(true)}
                className="pq-btn pq-btn-primary"
              >
                <PqPlusIcon size={15} />
                <span>Thêm khách hàng đầu tiên</span>
              </button>
            </div>
          ) : (
            <div style={{ color: 'var(--muted-color)', fontSize: '13.5px' }}>
              Không tìm thấy khách hàng phù hợp với từ khóa.
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
            gap: '12px',
          }}
        >
          {filteredCustomers.map((c) => (
            <div
              key={c.id}
              data-testid={`customer-card-${c.code}`}
              className="pq-quote-card"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
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
                  <span className="pq-code-pill">{c.code}</span>
                  <strong style={{ fontSize: '14px' }}>{c.name}</strong>
                </div>
                <div
                  style={{
                    fontSize: '12.5px',
                    color: 'var(--muted-color)',
                    marginTop: '5px',
                  }}
                >
                  {c.company_name ? `${c.company_name} • ` : ''}SĐT:{' '}
                  <strong style={{ color: 'var(--text-color)' }}>
                    {c.phone || '—'}
                  </strong>
                </div>
                {c.address && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    Đ/c: {c.address}
                  </div>
                )}
              </div>

              <button
                type="button"
                data-testid={`pq-quick-quote-customer-${c.code}`}
                onClick={() => onSelectCustomerForQuote(c.id)}
                className="pq-btn pq-btn-accent"
                style={{ flexShrink: 0 }}
              >
                <PqPlusIcon size={14} />
                <span>Báo giá</span>
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
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
              gap: '12px',
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
                placeholder="VD: Anh Minh…"
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
                placeholder="VD: 0918222333…"
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
              placeholder="VD: Công ty TNHH Thực Phẩm Xanh…"
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
              placeholder="VD: 120 Nguyễn Trãi, Q.1, TP.HCM…"
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
              className="pq-btn pq-btn-secondary"
            >
              Hủy
            </button>
            <button
              type="submit"
              data-testid="pq-submit-customer-btn"
              disabled={submitting}
              className="pq-btn pq-btn-primary"
            >
              {submitting ? 'Đang lưu…' : 'Lưu khách hàng'}
            </button>
          </div>
        </form>
      </CatalogModalDialog>
    </div>
  );
};
