import React, { useState } from 'react';
import type {
  HistoricalImportFlagType,
  HistoricalImportResolutionType,
  LedgerScopeType,
  PrintHistoricalImportBatchData,
  PrintHistoricalImportRowData,
} from '../../../../../packages/contracts/src/printquote-finance.js';
import { formatVnd } from '../helpers/printquote-helpers.js';
import { cardStyle, inputStyle, labelStyle, tabularNumStyle } from './types.js';
import { PqCheckIcon, PqHistoryIcon } from './PrintQuoteIcons.js';

export interface HistoricalImportTabProps {
  batches: PrintHistoricalImportBatchData[];
  onMutateLedger: (
    endpoint: string,
    body: Record<string, unknown>,
    method?: 'POST' | 'PATCH',
  ) => Promise<{
    ok: boolean;
    error?: string;
    code?: string;
    data?: unknown;
  }>;
  onRefresh: () => void;
}

const ANOMALY_LABELS: Record<HistoricalImportFlagType, string> = {
  EMPTY_CELL_NOT_ZERO: 'Ô trống (không tự tính = 0)',
  MISSING_AMOUNT: 'Thiếu số tiền',
  MISSING_VOUCHER: 'Thiếu mã chứng từ',
  MISSING_COUNTERPARTY: 'Thiếu tên đối tác',
  TOTAL_GOODS_NOT_AUTO_DEBT: 'Chỉ có tiền hàng (không tự coi là nợ)',
  DUPLICATE_IN_BATCH: 'Trùng dòng trong cùng bảng',
  DUPLICATE_EXISTING_ROW: 'Trùng dòng lịch sử đã nhập trước đó',
  SCOPE_RIENG: 'Gắn nhãn riêng Sổ RIÊNG',
  SCOPE_HVGROUP: 'Gắn nhãn riêng Sổ HVGROUP',
};

export const HistoricalImportTab: React.FC<HistoricalImportTabProps> = ({
  batches,
  onMutateLedger,
}) => {
  const [sourceSheetName, setSourceSheetName] = useState<string>(
    'Bảng công nợ Google Sheet #1',
  );
  const [sourceTabName, setSourceTabName] = useState<string>('');
  const [defaultScope, setDefaultScope] = useState<LedgerScopeType>('RIENG');
  const [rawText, setRawText] = useState<string>('');
  const [activeBatch, setActiveBatch] =
    useState<PrintHistoricalImportBatchData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!sourceTabName.trim() || !rawText.trim()) {
      setErrorMsg(
        'Nhập tên Tab nguồn và dán dữ liệu bảng (TSV/CSV) trước khi xem trước.',
      );
      return;
    }
    setBusy(true);
    try {
      const res = await onMutateLedger(
        '/api/v1/print-quotes/import-history/preview',
        {
          source_sheet_name: sourceSheetName.trim(),
          source_tab_name: sourceTabName.trim(),
          default_ledger_scope: defaultScope,
          raw_text: rawText,
        },
      );
      if (!res.ok) {
        setErrorMsg(res.error || 'Không thể phân tích bảng dữ liệu.');
        return;
      }
      const batch = res.data as PrintHistoricalImportBatchData | undefined;
      if (batch) {
        setActiveBatch(batch);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResolveRow = async (
    rowId: string,
    ownerResolution: HistoricalImportResolutionType,
  ) => {
    if (!activeBatch) return;
    setErrorMsg('');
    const res = await onMutateLedger(
      `/api/v1/print-quotes/import-history/batches/${encodeURIComponent(activeBatch.id)}/rows/${encodeURIComponent(rowId)}`,
      { owner_resolution: ownerResolution },
      'PATCH',
    );
    if (!res.ok) {
      setErrorMsg(res.error || 'Không thể cập nhật lựa chọn dòng.');
      return;
    }
    const updatedRow = res.data as PrintHistoricalImportRowData | undefined;
    if (updatedRow && activeBatch.rows) {
      setActiveBatch({
        ...activeBatch,
        rows: activeBatch.rows.map((r: PrintHistoricalImportRowData) =>
          r.id === rowId ? updatedRow : r,
        ),
      });
    }
  };

  const handleConfirmBatch = async () => {
    if (!activeBatch) return;
    setErrorMsg('');
    setBusy(true);
    try {
      const res = await onMutateLedger(
        `/api/v1/print-quotes/import-history/batches/${encodeURIComponent(activeBatch.id)}/confirm`,
        {},
      );
      if (!res.ok) {
        setErrorMsg(
          res.error ||
            'Còn dòng sai lệch chưa chọn hướng xử lý (UNDECIDED). Vui lòng xử lý hết trước khi xác nhận.',
        );
        return;
      }
      const confirmed = res.data as PrintHistoricalImportBatchData | undefined;
      if (confirmed) {
        setActiveBatch(confirmed);
      }
    } finally {
      setBusy(false);
    }
  };

  const undecidedCount =
    activeBatch?.rows?.filter(
      (r: PrintHistoricalImportRowData) => r.owner_resolution === 'UNDECIDED',
    ).length ?? 0;

  return (
    <div
      data-testid="panel-pq-import-history"
      style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">
            Nhập dữ liệu lịch sử (2 Google Sheet)
          </h1>
          <p className="pq-page-subtitle">
            Quy trình 3 bước: Dán bảng → Kiểm tra cờ sai lệch (không tự đoán ô
            trống = 0, tách riêng RIÊNG & HVGROUP) → Xác nhận nhập
          </p>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          data-testid="pq-import-error-alert"
          style={{
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid var(--danger-text)',
            color: 'var(--danger-text)',
            fontSize: '13px',
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Step 1: Paste & Preview */}
      <form onSubmit={(e) => void handlePreview(e)} style={cardStyle}>
        <h2 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700 }}>
          1. Nguồn bảng & Dữ liệu xem trước
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
            gap: '10px',
            marginBottom: '10px',
          }}
        >
          <div>
            <label style={labelStyle}>Tên Google Sheet nguồn *</label>
            <input
              aria-label="Tên Google Sheet nguồn"
              data-testid="pq-import-sheet-name"
              style={inputStyle}
              value={sourceSheetName}
              onChange={(e) => setSourceSheetName(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Tên Tab (Sheet con) *</label>
            <input
              aria-label="Tên Tab nguồn"
              data-testid="pq-import-tab-name"
              style={inputStyle}
              value={sourceTabName}
              onChange={(e) => setSourceTabName(e.target.value)}
              placeholder="VD: CongNo_RIENG_2026"
            />
          </div>
          <div>
            <label style={labelStyle}>Nhóm sổ mặc định của Tab *</label>
            <select
              aria-label="Nhóm sổ mặc định"
              data-testid="pq-import-default-scope"
              style={inputStyle}
              value={defaultScope}
              onChange={(e) =>
                setDefaultScope(e.target.value as LedgerScopeType)
              }
            >
              <option value="RIENG">Sổ RIÊNG (không cộng chung HVGROUP)</option>
              <option value="HVGROUP">
                Sổ HVGROUP (không cộng chung RIÊNG)
              </option>
              <option value="GENERAL">Sổ chung (GENERAL)</option>
            </select>
          </div>
        </div>

        <div>
          <label style={labelStyle}>
            Dán các dòng sao chép từ Google Sheet (có dòng tiêu đề cột) *
          </label>
          <textarea
            aria-label="Dữ liệu bảng Google Sheet"
            data-testid="pq-import-raw-textarea"
            rows={5}
            style={{
              ...inputStyle,
              fontFamily: 'monospace',
              minHeight: '110px',
            }}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={'Khách hàng\tLoại\tCòn nợ\tChứng từ\tGhi chú\n...'}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '10px',
          }}
        >
          <button
            type="submit"
            disabled={busy}
            data-testid="pq-import-preview-btn"
            className="pq-btn pq-btn-primary"
          >
            <PqHistoryIcon size={15} />
            <span>{busy ? 'Đang kiểm tra…' : 'Phân tích & Xem trước'}</span>
          </button>
        </div>
      </form>

      {/* Step 2 & 3: Preview Anomaly Resolution & Confirm */}
      {activeBatch && (
        <div style={cardStyle} data-testid="pq-import-preview-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              marginBottom: '12px',
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                2. Xem trước lô {activeBatch.batch_code} (
                {activeBatch.total_rows} dòng •{' '}
                {activeBatch.needs_confirmation_rows_count} dòng cần xác nhận)
              </h2>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Nguồn: {activeBatch.source_sheet_name} /{' '}
                {activeBatch.source_tab_name} • Trạng thái:{' '}
                <strong>{activeBatch.status}</strong>
              </div>
            </div>

            {activeBatch.status === 'PREVIEW' && (
              <button
                type="button"
                disabled={busy || undecidedCount > 0}
                data-testid="pq-import-confirm-btn"
                className="pq-btn pq-btn-success"
                onClick={() => void handleConfirmBatch()}
              >
                <PqCheckIcon size={15} />
                <span>
                  {undecidedCount > 0
                    ? `Còn ${undecidedCount} dòng chờ xử lý`
                    : '3. Xác nhận nhập vào sổ'}
                </span>
              </button>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="pq-table">
              <thead>
                <tr>
                  <th>Dòng #</th>
                  <th>Đối tác</th>
                  <th>Nhóm sổ</th>
                  <th style={{ textAlign: 'right' }}>Số tiền đọc được</th>
                  <th>Cảnh báo sai lệch</th>
                  <th>Quyết định xử lý</th>
                </tr>
              </thead>
              <tbody>
                {(activeBatch.rows ?? []).map(
                  (r: PrintHistoricalImportRowData) => (
                    <tr key={r.id}>
                      <td style={tabularNumStyle}>#{r.source_row_number}</td>
                      <td style={{ fontWeight: 600 }}>
                        {r.counterparty_name || '—'}
                      </td>
                      <td>{r.ledger_scope}</td>
                      <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                        {r.parsed_amount !== null
                          ? formatVnd(r.parsed_amount)
                          : 'Trống / Chưa rõ'}
                      </td>
                      <td>
                        {r.flags.length === 0 ? (
                          <span style={{ color: 'var(--success-text)' }}>
                            Hợp lệ
                          </span>
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              color: 'var(--danger-text)',
                              fontSize: '12px',
                            }}
                          >
                            {r.flags.map((fl: HistoricalImportFlagType) => (
                              <span key={fl}>• {ANOMALY_LABELS[fl] || fl}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        {activeBatch.status === 'CONFIRMED' ? (
                          <strong>{r.owner_resolution}</strong>
                        ) : (
                          <select
                            aria-label={`Xử lý dòng ${r.source_row_number}`}
                            data-testid={`pq-import-row-res-${r.source_row_number}`}
                            style={{
                              ...inputStyle,
                              minHeight: '34px',
                              padding: '4px 8px',
                              fontSize: '12.5px',
                            }}
                            value={r.owner_resolution}
                            onChange={(e) =>
                              void handleResolveRow(
                                r.id,
                                e.target
                                  .value as HistoricalImportResolutionType,
                              )
                            }
                          >
                            <option value="UNDECIDED">
                              -- Chờ quyết định (chặn nhập) --
                            </option>
                            <option value="IMPORT_OPENING_RECEIVABLE">
                              Nhập dư phải thu khách (AR)
                            </option>
                            <option value="IMPORT_OPENING_PAYABLE">
                              Nhập dư phải trả xưởng (AP)
                            </option>
                            <option value="IMPORT_CUSTOMER_ADVANCE">
                              Nhập tiền ứng trước khách
                            </option>
                            <option value="IMPORT_VENDOR_ADVANCE">
                              Nhập tiền tạm ứng xưởng
                            </option>
                            <option value="HOLD_FOR_REVIEW">
                              Treo chờ đối chiếu ngoài
                            </option>
                            <option value="SKIP">
                              Bỏ qua dòng này (lưu vết kiểm toán)
                            </option>
                          </select>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Import Batches */}
      {batches.length > 0 && (
        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 10px', fontSize: '15px', fontWeight: 700 }}>
            Lịch sử các lô đã kiểm tra / nhập ({batches.length})
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="pq-table">
              <thead>
                <tr>
                  <th>Mã lô</th>
                  <th>Google Sheet / Tab</th>
                  <th>Nhóm sổ</th>
                  <th style={{ textAlign: 'right' }}>Tổng dòng</th>
                  <th style={{ textAlign: 'right' }}>Đã nhập</th>
                  <th style={{ textAlign: 'right' }}>Trùng lặp</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b: PrintHistoricalImportBatchData) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 700 }}>{b.batch_code}</td>
                    <td>
                      {b.source_sheet_name} / {b.source_tab_name}
                    </td>
                    <td>{b.default_ledger_scope}</td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {b.total_rows}
                    </td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {b.imported_rows_count}
                    </td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {b.duplicate_rows_count}
                    </td>
                    <td>{b.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
