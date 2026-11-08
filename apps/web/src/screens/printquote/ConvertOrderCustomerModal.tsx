import React, { useState, useEffect } from 'react';
import { useAutoDismiss } from '../../../../../packages/ui/src/components/index.js';
import type {
  PrintCustomerData,
  PrintQuoteData,
} from '../../../../../packages/contracts/src/printquote.js';
import { formatVnd } from '../helpers/printquote-helpers.js';
import { inputStyle, labelStyle, tabularNumStyle } from './types.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';
import { PqPlusIcon } from './PrintQuoteIcons.js';

export interface ConvertOrderCustomerModalProps {
  quote: PrintQuoteData | null;
  customers: PrintCustomerData[];
  submitting: boolean;
  errorMessage: string;
  onClose: () => void;
  onSubmit: (payload: {
    customer_id?: string | undefined;
    quick_customer?:
      | {
          name: string;
          phone?: string | null | undefined;
          address?: string | null | undefined;
        }
      | undefined;
  }) => Promise<void>;
}

export const ConvertOrderCustomerModal: React.FC<
  ConvertOrderCustomerModalProps
> = ({ quote, customers, submitting, errorMessage, onClose, onSubmit }) => {
  const activeCustomers = customers.filter((c) => c.is_active !== false);
  const [mode, setMode] = useState<'SELECT' | 'QUICK_CREATE'>('SELECT');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [quickName, setQuickName] = useState<string>('');
  const [quickPhone, setQuickPhone] = useState<string>('');
  const [quickAddress, setQuickAddress] = useState<string>('');
  const [localError, setLocalError] = useState<string>('');
  useAutoDismiss(localError, () => setLocalError(''), 5000);

  useEffect(() => {
    if (!quote) return;
    // Never auto-select existing customer by name; require explicit selection or quick create
    setSelectedCustomerId('');
    setQuickName(quote.customer_name || '');
    setQuickPhone(quote.customer_phone || '');
    setQuickAddress('');
    setLocalError('');
    setMode(activeCustomers.length > 0 ? 'SELECT' : 'QUICK_CREATE');
  }, [quote, activeCustomers.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (mode === 'SELECT') {
      if (!selectedCustomerId) {
        setLocalError(
          'Vui lòng chọn khách hàng hợp lệ hoặc chuyển sang Tạo nhanh khách mới.',
        );
        return;
      }
      await onSubmit({ customer_id: selectedCustomerId });
      return;
    }

    if (!quickName.trim()) {
      setLocalError('Vui lòng nhập tên khách hàng.');
      return;
    }
    await onSubmit({
      quick_customer: {
        name: quickName.trim(),
        phone: quickPhone.trim() || null,
        address: quickAddress.trim() || null,
      },
    });
  };

  const displayError = localError || errorMessage;

  return (
    <CatalogModalDialog
      open={quote !== null}
      ariaLabel="Gắn khách hàng cho đơn đặt in mới"
      title="Gắn khách hàng trước khi tạo đơn"
      subtitle={
        quote
          ? `${quote.quote_code} • Tổng báo khách ${formatVnd(quote.total_quote_amount)}`
          : undefined
      }
      testId="pq-convert-order-customer-modal"
      maxWidth="480px"
      onClose={onClose}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
      >
        <div
          style={{
            padding: '8px 10px',
            borderRadius: '8px',
            backgroundColor: 'var(--surface-subtle)',
            border: '1px solid var(--border-color)',
            fontSize: '12.5px',
            color: 'var(--muted-color)',
            lineHeight: 1.45,
          }}
        >
          Đơn mới bắt buộc gắn mã khách hàng (<code>customer_id</code>) để quản
          lý công nợ AR chính xác. Hệ thống không tự gán theo tên chữ.
        </div>

        <div
          className="pq-filter-pills"
          role="group"
          aria-label="Cách gắn khách"
        >
          <button
            type="button"
            data-testid="pq-convert-cust-mode-select"
            aria-pressed={mode === 'SELECT'}
            className="pq-filter-pill"
            data-active={mode === 'SELECT' ? 'true' : 'false'}
            onClick={() => {
              setMode('SELECT');
              setLocalError('');
            }}
          >
            Chọn khách đã có ({activeCustomers.length})
          </button>
          <button
            type="button"
            data-testid="pq-convert-cust-mode-quick"
            aria-pressed={mode === 'QUICK_CREATE'}
            className="pq-filter-pill"
            data-active={mode === 'QUICK_CREATE' ? 'true' : 'false'}
            onClick={() => {
              setMode('QUICK_CREATE');
              setLocalError('');
            }}
          >
            + Tạo nhanh khách mới
          </button>
        </div>

        {displayError && (
          <div
            role="alert"
            style={{
              padding: '8px 10px',
              borderRadius: '8px',
              border: '1px solid var(--danger-text)',
              color: 'var(--danger-text)',
              fontSize: '12.5px',
            }}
          >
            {displayError}
          </div>
        )}

        {mode === 'SELECT' ? (
          <div>
            <label htmlFor="pq-convert-cust-select" style={labelStyle}>
              Khách hàng trong danh mục *
            </label>
            <select
              id="pq-convert-cust-select"
              data-testid="pq-convert-cust-select"
              style={inputStyle}
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
            >
              <option value="">-- Chọn khách hàng --</option>
              {activeCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                  {c.phone ? ` (${c.phone})` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <div>
              <label htmlFor="pq-convert-quick-name" style={labelStyle}>
                Tên khách hàng / Công ty *
              </label>
              <input
                id="pq-convert-quick-name"
                data-testid="pq-convert-quick-name"
                style={inputStyle}
                required
                autoComplete="off"
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                placeholder="VD: Công ty TNHH Minh Phát…"
              />
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
                gap: '10px',
              }}
            >
              <div>
                <label htmlFor="pq-convert-quick-phone" style={labelStyle}>
                  Số điện thoại
                </label>
                <input
                  id="pq-convert-quick-phone"
                  data-testid="pq-convert-quick-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  style={{ ...inputStyle, ...tabularNumStyle }}
                  value={quickPhone}
                  onChange={(e) => setQuickPhone(e.target.value)}
                  placeholder="VD: 0909123456…"
                />
              </div>
              <div>
                <label htmlFor="pq-convert-quick-address" style={labelStyle}>
                  Địa chỉ giao hàng
                </label>
                <input
                  id="pq-convert-quick-address"
                  data-testid="pq-convert-quick-address"
                  autoComplete="off"
                  style={inputStyle}
                  value={quickAddress}
                  onChange={(e) => setQuickAddress(e.target.value)}
                  placeholder="Không bắt buộc…"
                />
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            flexWrap: 'wrap',
            marginTop: '4px',
          }}
        >
          <button
            type="button"
            className="pq-btn pq-btn-secondary"
            onClick={onClose}
          >
            Đóng
          </button>
          <button
            type="submit"
            data-testid="pq-convert-cust-submit"
            disabled={submitting}
            className="pq-btn pq-btn-primary"
          >
            <PqPlusIcon size={15} />
            <span>
              {submitting ? 'Đang tạo đơn…' : 'Xác nhận & Tạo đơn in'}
            </span>
          </button>
        </div>
      </form>
    </CatalogModalDialog>
  );
};
