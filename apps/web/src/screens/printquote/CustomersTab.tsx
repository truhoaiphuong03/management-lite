import React, { useState, useMemo } from 'react';
import type { PrintCustomerData } from '../../../../../packages/contracts/src/printquote.js';
import { cardStyle, inputStyle } from './types.js';

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
  onCreateCustomer: (e: React.FormEvent) => void;
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
        <input
          type="search"
          aria-label="Tìm kiếm khách hàng"
          style={{ ...inputStyle, maxWidth: '280px' }}
          placeholder="Tìm tên, công ty hoặc SĐT khách…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <form
        onSubmit={onCreateCustomer}
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
          gap: '8px',
          marginBottom: '16px',
          padding: '12px',
          borderRadius: '10px',
          backgroundColor: 'var(--bg-color)',
          border: '1px solid var(--border-color)',
        }}
      >
        <input
          aria-label="Tên khách hàng"
          style={inputStyle}
          placeholder="Tên khách hàng *"
          value={custName}
          onChange={(e) => setCustName(e.target.value)}
          required
        />
        <input
          aria-label="Tên công ty khách hàng"
          style={inputStyle}
          placeholder="Công ty / Thương hiệu"
          value={custCompany}
          onChange={(e) => setCustCompany(e.target.value)}
        />
        <input
          aria-label="Số điện thoại khách hàng"
          style={inputStyle}
          placeholder="Số điện thoại"
          value={custPhone}
          onChange={(e) => setCustPhone(e.target.value)}
        />
        <input
          aria-label="Địa chỉ giao hàng"
          style={inputStyle}
          placeholder="Địa chỉ nhận hàng"
          value={custAddress}
          onChange={(e) => setCustAddress(e.target.value)}
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
          + Thêm Khách hàng
        </button>
      </form>

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
                <span style={{ color: 'var(--accent-text)' }}>{c.code}</span> —{' '}
                {c.name}
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
              onClick={() => onSelectCustomerForQuote(c.id)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid var(--accent-text)',
                backgroundColor: 'var(--accent-soft)',
                color: 'var(--accent-text)',
                fontSize: '12px',
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
    </div>
  );
};
