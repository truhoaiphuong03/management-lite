import React, { useState, useMemo } from 'react';
import type {
  LedgerScopeType,
  UnifiedPrintLedgerItem,
} from '../../../../../packages/contracts/src/printquote-finance.js';
import { formatVnd } from '../helpers/printquote-helpers.js';
import { cardStyle, inputStyle, tabularNumStyle } from './types.js';
import { PqSearchIcon } from './PrintQuoteIcons.js';

export interface TransactionsTabProps {
  items: UnifiedPrintLedgerItem[];
}

const STREAM_LABELS: Record<UnifiedPrintLedgerItem['ledger_side'], string> = {
  AR: 'Thu khách (AR)',
  AP: 'Chi xưởng (AP)',
  AR_ADJUSTMENT: 'Điều chỉnh AR',
  AP_ADJUSTMENT: 'Điều chỉnh AP',
};

const SCOPE_LABELS: Record<LedgerScopeType, string> = {
  GENERAL: 'Sổ chung',
  RIENG: 'Sổ RIÊNG',
  HVGROUP: 'Sổ HVGROUP',
};

export const TransactionsTab: React.FC<TransactionsTabProps> = ({ items }) => {
  const [streamFilter, setStreamFilter] = useState<
    'ALL' | 'AR' | 'AP' | 'ADJUSTMENTS' | 'UNALLOCATED'
  >('ALL');
  const [scopeFilter, setScopeFilter] = useState<'ALL' | LedgerScopeType>(
    'ALL',
  );
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((row: UnifiedPrintLedgerItem) => {
      if (scopeFilter !== 'ALL' && row.ledger_scope !== scopeFilter) {
        return false;
      }
      if (streamFilter === 'AR' && row.ledger_side !== 'AR') return false;
      if (streamFilter === 'AP' && row.ledger_side !== 'AP') return false;
      if (
        streamFilter === 'ADJUSTMENTS' &&
        row.ledger_side !== 'AR_ADJUSTMENT' &&
        row.ledger_side !== 'AP_ADJUSTMENT'
      ) {
        return false;
      }
      if (streamFilter === 'UNALLOCATED' && row.unallocated_amount <= 0) {
        return false;
      }
      if (q) {
        const hay =
          `${row.code} ${row.counterparty_name} ${row.reference_code || ''} ${row.note || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, streamFilter, scopeFilter, searchQuery]);

  return (
    <div
      data-testid="panel-pq-transactions"
      style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">Sổ giao dịch thu chi in ấn</h1>
          <p className="pq-page-subtitle">
            Tra cứu phiếu thu, phiếu chi, hoàn tiền, điều chỉnh và chứng từ
            (tách biệt hoàn toàn khỏi Sổ thu chi cá nhân /finance)
          </p>
        </div>
      </div>

      <div className="pq-toolbar-card">
        <div className="pq-search-wrap">
          <PqSearchIcon size={15} className="pq-search-icon" />
          <input
            type="search"
            aria-label="Tìm mã phiếu, đối tác hoặc chứng từ"
            data-testid="pq-tx-search-input"
            style={{ ...inputStyle, paddingLeft: '34px' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm mã PT/PC, tên khách/xưởng, mã UNC…"
          />
        </div>

        <div
          className="pq-filter-pills"
          role="group"
          aria-label="Loại giao dịch"
        >
          {(
            [
              ['ALL', 'Tất cả'],
              ['AR', 'Thu khách'],
              ['AP', 'Chi xưởng'],
              ['ADJUSTMENTS', 'Điều chỉnh'],
              ['UNALLOCATED', 'Còn dư chưa gán'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`pq-tx-filter-${id}`}
              aria-pressed={streamFilter === id}
              className="pq-filter-pill"
              data-active={streamFilter === id ? 'true' : 'false'}
              onClick={() => setStreamFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          aria-label="Lọc nhóm sổ giao dịch"
          style={{ ...inputStyle, width: 'auto', minWidth: '150px' }}
          value={scopeFilter}
          onChange={(e) =>
            setScopeFilter(e.target.value as 'ALL' | LedgerScopeType)
          }
        >
          <option value="ALL">Mọi nhóm sổ</option>
          <option value="GENERAL">Sổ chung</option>
          <option value="RIENG">Sổ RIÊNG</option>
          <option value="HVGROUP">Sổ HVGROUP</option>
        </select>
      </div>

      <div style={cardStyle}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: '28px 14px',
              textAlign: 'center',
              color: 'var(--muted-color)',
              fontSize: '13px',
            }}
          >
            Chưa có giao dịch nào khớp bộ lọc hiện tại.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="pq-table">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Loại</th>
                  <th>Khách / Xưởng</th>
                  <th>Nhóm sổ</th>
                  <th style={{ textAlign: 'right' }}>Số tiền</th>
                  <th style={{ textAlign: 'right' }}>Đã phân bổ</th>
                  <th style={{ textAlign: 'right' }}>Chưa phân bổ</th>
                  <th>Chứng từ / Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row: UnifiedPrintLedgerItem) => (
                  <tr
                    key={`${row.ledger_side}-${row.id}`}
                    style={{
                      opacity: row.status === 'VOIDED' ? 0.58 : 1,
                    }}
                  >
                    <td
                      style={{ fontWeight: 700, color: 'var(--accent-text)' }}
                    >
                      {row.code}
                    </td>
                    <td>
                      <div>{STREAM_LABELS[row.ledger_side]}</div>
                      <div
                        style={{
                          fontSize: '11.5px',
                          color: 'var(--muted-color)',
                        }}
                      >
                        {row.tx_kind}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{row.counterparty_name}</td>
                    <td>{SCOPE_LABELS[row.ledger_scope]}</td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 700,
                        ...tabularNumStyle,
                      }}
                    >
                      {formatVnd(row.amount)}
                    </td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {formatVnd(row.allocated_amount)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        color:
                          row.unallocated_amount > 0
                            ? 'var(--accent-text)'
                            : 'var(--muted-color)',
                        ...tabularNumStyle,
                      }}
                    >
                      {formatVnd(row.unallocated_amount)}
                    </td>
                    <td>
                      <div>{row.reference_code || '—'}</div>
                      <div
                        style={{
                          fontSize: '11.5px',
                          color:
                            row.status === 'VOIDED'
                              ? 'var(--danger-text)'
                              : 'var(--muted-color)',
                        }}
                      >
                        {row.status === 'VOIDED' ? 'Đã hủy phiếu' : 'Hợp lệ'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
