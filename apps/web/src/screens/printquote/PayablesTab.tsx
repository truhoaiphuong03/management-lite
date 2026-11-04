import React, { useState, useMemo } from 'react';
import type {
  PrintVendorData,
  PrintOrderData,
} from '../../../../../packages/contracts/src/printquote.js';
import type {
  LedgerScopeType,
  LegacyUnreconciledVendorNoteItem,
  PrintApAdjustmentData,
  PrintApTransactionData,
  PrintOpeningBalanceData,
  PrintWorkshopJobData,
  VendorPayableSummaryItem,
} from '../../../../../packages/contracts/src/printquote-finance.js';
import {
  formatVnd,
  parseNumericDraftValue,
} from '../helpers/printquote-helpers.js';
import { cardStyle, inputStyle, labelStyle, tabularNumStyle } from './types.js';
import { NumericDraftInput } from './NumericDraftInput.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';
import { PqPlusIcon, PqStoreIcon } from './PrintQuoteIcons.js';

export interface PayablesLedgerPayload {
  summaries: VendorPayableSummaryItem[];
  workshop_jobs: PrintWorkshopJobData[];
  transactions: PrintApTransactionData[];
  adjustments: PrintApAdjustmentData[];
  opening_balances: PrintOpeningBalanceData[];
  legacy_unreconciled_notes: LegacyUnreconciledVendorNoteItem[];
}

export interface PayablesTabProps {
  data: PayablesLedgerPayload | null;
  vendors: PrintVendorData[];
  orders: PrintOrderData[];
  onMutateLedger: (
    endpoint: string,
    body: Record<string, unknown>,
    method?: 'POST' | 'PATCH',
  ) => Promise<{ ok: boolean; error?: string; code?: string }>;
}

const SCOPE_LABELS: Record<LedgerScopeType, string> = {
  GENERAL: 'Sổ chung',
  RIENG: 'Sổ RIÊNG',
  HVGROUP: 'Sổ HVGROUP',
};

export const PayablesTab: React.FC<PayablesTabProps> = ({
  data,
  vendors,
  onMutateLedger,
}) => {
  const [scopeFilter, setScopeFilter] = useState<'ALL' | LedgerScopeType>(
    'ALL',
  );
  const [modalMode, setModalMode] = useState<
    | null
    | 'PAYOUT'
    | 'ALLOCATE'
    | 'VENDOR_REFUND'
    | 'ADJUSTMENT'
    | 'OPENING'
    | 'CONFIRM_JOB'
    | 'RECONCILE_LEGACY'
  >(null);
  const [selectedTx, setSelectedTx] = useState<PrintApTransactionData | null>(
    null,
  );
  const [selectedJob, setSelectedJob] = useState<PrintWorkshopJobData | null>(
    null,
  );
  const [legacyTargetOrderId, setLegacyTargetOrderId] = useState<string>('');
  const [formVendorId, setFormVendorId] = useState<string>('');
  const [formLedgerScope, setFormLedgerScope] =
    useState<LedgerScopeType>('GENERAL');
  const [formAmountInput, setFormAmountInput] = useState<string>('');
  const [formPaymentMethod, setFormPaymentMethod] =
    useState<string>('BANK_TRANSFER');
  const [formReferenceCode, setFormReferenceCode] = useState<string>('');
  const [formConfirmDupRef, setFormConfirmDupRef] = useState<boolean>(false);
  const [formReason, setFormReason] = useState<string>('');
  const [formNote, setFormNote] = useState<string>('');
  const [formTargetJobId, setFormTargetJobId] = useState<string>('');
  const [formAdjType, setFormAdjType] = useState<
    'DEFECT_DEDUCTION' | 'DISCOUNT' | 'SURCHARGE'
  >('DEFECT_DEDUCTION');
  const [allocMap, setAllocMap] = useState<Record<string, string>>({});
  const [modalError, setModalError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const openJobs = useMemo(
    () =>
      (data?.workshop_jobs ?? []).filter(
        (j: PrintWorkshopJobData) =>
          j.job_status !== 'CANCELLED' &&
          (scopeFilter === 'ALL' || j.ledger_scope === scopeFilter),
      ),
    [data, scopeFilter],
  );

  const filteredVendors = useMemo(
    () =>
      (data?.summaries ?? []).filter(
        (v: VendorPayableSummaryItem) =>
          scopeFilter === 'ALL' || v.ledger_scope === scopeFilter,
      ),
    [data, scopeFilter],
  );

  const unallocatedPayouts = useMemo(
    () =>
      (data?.transactions ?? []).filter(
        (tx: PrintApTransactionData) =>
          tx.status === 'POSTED' &&
          tx.tx_kind === 'PAYOUT' &&
          tx.unallocated_amount > 0 &&
          (scopeFilter === 'ALL' || tx.ledger_scope === scopeFilter),
      ),
    [data, scopeFilter],
  );

  const totals = useMemo(() => {
    let valid = 0;
    let paid = 0;
    let remaining = 0;
    let advance = 0;
    let unconfirmed = 0;
    for (const v of filteredVendors) {
      valid += v.valid_payable_total;
      paid += v.net_allocated_payout_total;
      remaining += v.remaining_payable_total;
      advance += v.unallocated_advance_total;
      unconfirmed += v.expected_unconfirmed_cost_total;
    }
    return { valid, paid, remaining, advance, unconfirmed };
  }, [filteredVendors]);

  const legacyNotes = data?.legacy_unreconciled_notes ?? [];

  const resetForm = () => {
    setFormVendorId(vendors[0]?.id || '');
    setFormLedgerScope(scopeFilter === 'ALL' ? 'GENERAL' : scopeFilter);
    setFormAmountInput('');
    setFormPaymentMethod('BANK_TRANSFER');
    setFormReferenceCode('');
    setFormConfirmDupRef(false);
    setFormReason('');
    setFormNote('');
    setFormTargetJobId('');
    setAllocMap({});
    setModalError('');
    setSelectedTx(null);
    setSelectedJob(null);
    setLegacyTargetOrderId('');
  };

  const openModal = (mode: NonNullable<typeof modalMode>) => {
    resetForm();
    setModalMode(mode);
  };

  const parsePositiveInt = (raw: string): number | null => {
    const parsed = parseNumericDraftValue(raw.trim(), {
      allowDecimal: false,
      min: 1,
      integerOnly: true,
    });
    return parsed.isValid && parsed.value !== null && parsed.value > 0
      ? parsed.value
      : null;
  };

  const parseNonNegInt = (raw: string): number | null => {
    const parsed = parseNumericDraftValue(raw.trim(), {
      allowDecimal: false,
      min: 0,
      integerOnly: true,
    });
    return parsed.isValid && parsed.value !== null && parsed.value >= 0
      ? parsed.value
      : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    setSubmitting(true);
    try {
      if (modalMode === 'PAYOUT') {
        const amount = parsePositiveInt(formAmountInput);
        if (!amount || !formVendorId) {
          setModalError(
            'Chọn xưởng in và nhập số tiền chi nguyên dương (VNĐ).',
          );
          return;
        }
        const allocations = Object.entries(allocMap)
          .map(([jobId, raw]) => ({
            workshop_job_id: jobId,
            amount: parsePositiveInt(raw) || 0,
          }))
          .filter((a) => a.amount > 0);
        const res = await onMutateLedger(
          '/api/v1/print-quotes/payables/payouts',
          {
            vendor_id: formVendorId,
            ledger_scope: formLedgerScope,
            amount,
            payment_method: formPaymentMethod,
            reference_code: formReferenceCode.trim() || null,
            confirm_duplicate_reference: formConfirmDupRef,
            note: formNote.trim() || null,
            allocations,
          },
        );
        if (!res.ok) {
          if (res.code === 'DUPLICATE_REFERENCE_CODE') {
            setFormConfirmDupRef(true);
          }
          setModalError(res.error || 'Không thể ghi nhận phiếu chi xưởng.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'ALLOCATE' && selectedTx) {
        const allocations = Object.entries(allocMap)
          .map(([jobId, raw]) => ({
            workshop_job_id: jobId,
            amount: parsePositiveInt(raw) || 0,
          }))
          .filter((a) => a.amount > 0);
        if (allocations.length === 0) {
          setModalError('Nhập số tiền phân bổ cho ít nhất 1 phiếu xưởng.');
          return;
        }
        const res = await onMutateLedger(
          `/api/v1/print-quotes/payables/payouts/${encodeURIComponent(selectedTx.id)}/allocate`,
          { allocations, note: formNote.trim() || null },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể phân bổ tạm ứng xưởng.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'VENDOR_REFUND') {
        const amount = parsePositiveInt(formAmountInput);
        if (!amount) {
          setModalError('Nhập số tiền xưởng hoàn trả nguyên dương (VNĐ).');
          return;
        }
        const res = await onMutateLedger(
          '/api/v1/print-quotes/payables/refunds',
          {
            vendor_id: formVendorId || null,
            ledger_scope: formLedgerScope,
            amount,
            payment_method: formPaymentMethod,
            reference_code: formReferenceCode.trim() || null,
            source: formTargetJobId ? 'JOB_OVERPAYMENT' : 'UNALLOCATED_ADVANCE',
            workshop_job_id: formTargetJobId || null,
            reason: formReason.trim(),
            note: formNote.trim() || null,
          },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể ghi nhận xưởng hoàn tiền.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'ADJUSTMENT') {
        const amount = parsePositiveInt(formAmountInput);
        if (!amount || !formTargetJobId) {
          setModalError('Chọn phiếu xưởng và nhập số tiền điều chỉnh > 0.');
          return;
        }
        const deltaAmount = formAdjType === 'SURCHARGE' ? amount : -amount;
        const res = await onMutateLedger(
          '/api/v1/print-quotes/payables/adjustments',
          {
            workshop_job_id: formTargetJobId,
            adjustment_type: formAdjType,
            delta_amount: deltaAmount,
            reason: formReason.trim(),
          },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể điều chỉnh phải trả xưởng.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'OPENING') {
        const amount = parsePositiveInt(formAmountInput);
        if (!amount || !formVendorId) {
          setModalError('Chọn nhà in và nhập số dư phải trả đầu kỳ > 0.');
          return;
        }
        const res = await onMutateLedger(
          '/api/v1/print-quotes/opening-balances',
          {
            direction: 'VENDOR_PAYABLE',
            ledger_scope: formLedgerScope,
            vendor_id: formVendorId,
            original_amount: amount,
            note: formNote.trim() || null,
          },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể tạo công nợ đầu kỳ xưởng.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'CONFIRM_JOB' && selectedJob) {
        const costVal = parseNonNegInt(formAmountInput);
        if (costVal === null) {
          setModalError('Nhập chi phí thực tế xưởng (số nguyên ≥ 0).');
          return;
        }
        const res = await onMutateLedger(
          `/api/v1/print-quotes/workshop-jobs/${encodeURIComponent(selectedJob.id)}`,
          {
            ...(formVendorId ? { vendor_id: formVendorId } : {}),
            entered_cost: costVal,
            confirm_cost: true,
            reason: formReason.trim() || null,
            note: formNote.trim() || null,
          },
          'PATCH',
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể xác nhận chi phí phiếu xưởng.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'RECONCILE_LEGACY' && legacyTargetOrderId) {
        const res = await onMutateLedger(
          `/api/v1/print-quotes/orders/${encodeURIComponent(legacyTargetOrderId)}/reconcile-legacy-vendor-note`,
          {
            action: formVendorId ? 'CREATE_PAYOUT' : 'DISMISS_NOTE',
            vendor_id: formVendorId || null,
            ...(formTargetJobId
              ? {
                  allocations: [
                    {
                      workshop_job_id: formTargetJobId,
                      amount:
                        legacyNotes.find(
                          (ln: LegacyUnreconciledVendorNoteItem) =>
                            ln.order_id === legacyTargetOrderId,
                        )?.vendor_paid_amount || 0,
                    },
                  ],
                }
              : {}),
            reason: formReason.trim(),
          },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể đối soát ghi chú cũ.');
          return;
        }
        setModalMode(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="panel-pq-payables"
      style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">Công nợ xưởng in & gia công</h1>
          <p className="pq-page-subtitle">
            Chỉ phát sinh phải trả khi chi phí phiếu xưởng đã xác nhận — tách rõ
            với chi phí dự kiến và tiền thực chi
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button
            type="button"
            data-testid="pq-ap-new-payout-btn"
            className="pq-btn pq-btn-primary"
            onClick={() => openModal('PAYOUT')}
          >
            <PqPlusIcon size={15} />
            <span>Chi tiền xưởng</span>
          </button>
          <button
            type="button"
            data-testid="pq-ap-adjustment-btn"
            className="pq-btn pq-btn-secondary"
            onClick={() => openModal('ADJUSTMENT')}
          >
            <span>Điều chỉnh AP</span>
          </button>
          <button
            type="button"
            data-testid="pq-ap-refund-btn"
            className="pq-btn pq-btn-secondary"
            onClick={() => openModal('VENDOR_REFUND')}
          >
            <span>Xưởng hoàn tiền</span>
          </button>
          <button
            type="button"
            data-testid="pq-ap-opening-btn"
            className="pq-btn pq-btn-ghost"
            onClick={() => openModal('OPENING')}
          >
            <span>+ Dư đầu kỳ xưởng</span>
          </button>
        </div>
      </div>

      {/* Scope Filter Pills */}
      <div
        className="pq-filter-pills"
        role="group"
        aria-label="Lọc nhóm sổ xưởng"
      >
        {(['ALL', 'GENERAL', 'RIENG', 'HVGROUP'] as const).map((sc) => (
          <button
            key={sc}
            type="button"
            data-testid={`pq-ap-scope-${sc}`}
            aria-pressed={scopeFilter === sc}
            className="pq-filter-pill"
            data-active={scopeFilter === sc ? 'true' : 'false'}
            onClick={() => setScopeFilter(sc)}
          >
            {sc === 'ALL' ? 'Tất cả sổ' : SCOPE_LABELS[sc]}
          </button>
        ))}
      </div>

      {/* Legacy Vendor Note Warning Banner (Never Auto-Converted) */}
      {legacyNotes.length > 0 && (
        <div
          data-testid="pq-ap-legacy-notes-banner"
          style={{
            ...cardStyle,
            borderColor: 'var(--accent-text)',
            backgroundColor: 'var(--surface-subtle)',
          }}
        >
          <div
            style={{ fontWeight: 700, fontSize: '13.5px', marginBottom: '6px' }}
          >
            Ghi chú chi xưởng cũ chờ đối soát ({legacyNotes.length} đơn) — Hệ
            thống không tự động chuyển thành phiếu chi AP
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {legacyNotes.map((ln: LegacyUnreconciledVendorNoteItem) => (
              <div
                key={ln.order_id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                  fontSize: '12.5px',
                }}
              >
                <span>
                  <strong>{ln.order_code}</strong> (
                  {ln.customer_name || 'Khách lẻ'}) • Ghi chú cũ:{' '}
                  <strong>{formatVnd(ln.vendor_paid_amount)}</strong>
                </span>
                <button
                  type="button"
                  className="pq-btn pq-btn-secondary pq-btn-sm"
                  onClick={() => {
                    resetForm();
                    setLegacyTargetOrderId(ln.order_id);
                    setFormVendorId(ln.vendor_id || '');
                    setModalMode('RECONCILE_LEGACY');
                  }}
                >
                  Đối soát ghi chú này
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '12px',
        }}
      >
        <div className="pq-stat-card" data-testid="pq-ap-kpi-remaining">
          <div className="pq-stat-label">Còn phải trả xưởng (đã xác nhận)</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--danger-text)' }}
          >
            {formatVnd(totals.remaining)}
          </div>
          <div className="pq-stat-sub">
            Phải trả hợp lệ: {formatVnd(totals.valid)}
          </div>
        </div>

        <div className="pq-stat-card" data-testid="pq-ap-kpi-paid">
          <div className="pq-stat-label">Chi ròng đã phân bổ</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--success-text)' }}
          >
            {formatVnd(totals.paid)}
          </div>
          <div className="pq-stat-sub">Đã gán vào phiếu xưởng / đầu kỳ</div>
        </div>

        <div className="pq-stat-card" data-testid="pq-ap-kpi-advance">
          <div className="pq-stat-label">Tạm ứng xưởng chưa gán</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--accent-text)' }}
          >
            {formatVnd(totals.advance)}
          </div>
          <div className="pq-stat-sub">
            {unallocatedPayouts.length} phiếu chi còn dư chưa phân bổ
          </div>
        </div>

        <div className="pq-stat-card" data-testid="pq-ap-kpi-unconfirmed">
          <div className="pq-stat-label">Dự kiến / Nháp chưa xác nhận</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--muted-color)' }}
          >
            {formatVnd(totals.unconfirmed)}
          </div>
          <div className="pq-stat-sub">
            Chưa tạo công nợ phải trả chính thức
          </div>
        </div>
      </div>

      {/* Unallocated Vendor Advances */}
      {unallocatedPayouts.length > 0 && (
        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 10px', fontSize: '15px', fontWeight: 700 }}>
            Khoản chi tạm ứng xưởng chưa phân bổ ({unallocatedPayouts.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {unallocatedPayouts.map((tx: PrintApTransactionData) => (
              <div
                key={tx.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  fontSize: '13px',
                }}
              >
                <div>
                  <strong>{tx.tx_code}</strong> • {tx.vendor_name} •{' '}
                  <span style={{ color: 'var(--muted-color)' }}>
                    {SCOPE_LABELS[tx.ledger_scope]}
                  </span>
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Tổng chi {formatVnd(tx.amount)} • Còn dư tạm ứng:{' '}
                    <strong style={{ color: 'var(--accent-text)' }}>
                      {formatVnd(tx.unallocated_amount)}
                    </strong>
                  </div>
                </div>
                <button
                  type="button"
                  className="pq-btn pq-btn-accent pq-btn-sm"
                  onClick={() => {
                    resetForm();
                    setSelectedTx(tx);
                    setFormVendorId(tx.vendor_id);
                    setFormLedgerScope(tx.ledger_scope);
                    setModalMode('ALLOCATE');
                  }}
                >
                  Phân bổ vào phiếu xưởng
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vendor Summary Table */}
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700 }}>
          Tổng hợp công nợ theo từng xưởng
        </h2>
        {filteredVendors.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: 'var(--muted-color)',
              fontSize: '13px',
            }}
          >
            Chưa có phát sinh công nợ xưởng trong phạm vi đang chọn.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="pq-table">
              <thead>
                <tr>
                  <th>Nhà in / Xưởng gia công</th>
                  <th>Nhóm sổ</th>
                  <th style={{ textAlign: 'right' }}>Phải trả đã xác nhận</th>
                  <th style={{ textAlign: 'right' }}>Chi ròng đã gán</th>
                  <th style={{ textAlign: 'right' }}>Còn phải trả</th>
                  <th style={{ textAlign: 'right' }}>Tạm ứng dư</th>
                </tr>
              </thead>
              <tbody>
                {filteredVendors.map((row: VendorPayableSummaryItem) => (
                  <tr key={`${row.vendor_id}-${row.ledger_scope}`}>
                    <td style={{ fontWeight: 700 }}>{row.vendor_name}</td>
                    <td>{SCOPE_LABELS[row.ledger_scope]}</td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {formatVnd(row.valid_payable_total)}
                    </td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {formatVnd(row.net_allocated_payout_total)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 700,
                        color:
                          row.remaining_payable_total > 0
                            ? 'var(--danger-text)'
                            : 'var(--success-text)',
                        ...tabularNumStyle,
                      }}
                    >
                      {formatVnd(row.remaining_payable_total)}
                    </td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {formatVnd(row.unallocated_advance_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Workshop Jobs List */}
      {openJobs.length > 0 && (
        <div style={cardStyle} data-testid="pq-ap-jobs-section">
          <h2 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700 }}>
            Phiếu đặt xưởng cần xác nhận hoặc thanh toán ({openJobs.length})
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="pq-table">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Xưởng / Công đoạn</th>
                  <th style={{ textAlign: 'right' }}>Dự kiến</th>
                  <th style={{ textAlign: 'right' }}>Thực tế xác nhận</th>
                  <th style={{ textAlign: 'right' }}>Còn phải trả</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {openJobs.map((job: PrintWorkshopJobData) => (
                  <tr key={job.id}>
                    <td style={{ fontWeight: 700 }}>{job.job_code}</td>
                    <td>
                      <div>{job.vendor_name || 'Chưa chọn xưởng'}</div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--muted-color)',
                        }}
                      >
                        {job.title}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {formatVnd(job.expected_cost)}
                    </td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {job.cost_status === 'CONFIRMED' &&
                      job.confirmed_cost !== null
                        ? formatVnd(job.confirmed_cost)
                        : 'Chưa xác nhận'}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 700,
                        color:
                          job.remaining_payable_amount > 0
                            ? 'var(--danger-text)'
                            : 'var(--muted-color)',
                        ...tabularNumStyle,
                      }}
                    >
                      {job.cost_status === 'CONFIRMED'
                        ? formatVnd(job.remaining_payable_amount)
                        : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="pq-btn pq-btn-secondary pq-btn-sm"
                        onClick={() => {
                          resetForm();
                          setSelectedJob(job);
                          setFormVendorId(
                            job.vendor_id || vendors[0]?.id || '',
                          );
                          setFormAmountInput(
                            job.confirmed_cost !== null
                              ? String(job.confirmed_cost)
                              : job.entered_cost !== null
                                ? String(job.entered_cost)
                                : '',
                          );
                          setModalMode('CONFIRM_JOB');
                        }}
                      >
                        {job.cost_status === 'CONFIRMED'
                          ? 'Sửa chi phí'
                          : 'Xác nhận chi phí'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      <CatalogModalDialog
        open={modalMode !== null}
        ariaLabel="Thao tác công nợ xưởng"
        title={
          modalMode === 'PAYOUT'
            ? 'Chi tiền xưởng & Phân bổ phiếu'
            : modalMode === 'ALLOCATE'
              ? `Phân bổ phiếu chi ${selectedTx?.tx_code || ''}`
              : modalMode === 'VENDOR_REFUND'
                ? 'Ghi nhận xưởng hoàn tiền'
                : modalMode === 'ADJUSTMENT'
                  ? 'Điều chỉnh công nợ phiếu xưởng'
                  : modalMode === 'OPENING'
                    ? 'Thêm công nợ phải trả đầu kỳ'
                    : modalMode === 'CONFIRM_JOB'
                      ? `Xác nhận chi phí — ${selectedJob?.job_code || ''}`
                      : 'Đối soát ghi chú chi xưởng cũ'
        }
        maxWidth="540px"
        onClose={() => setModalMode(null)}
      >
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {modalError && (
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
              {modalError}
            </div>
          )}

          {(modalMode === 'PAYOUT' ||
            modalMode === 'VENDOR_REFUND' ||
            modalMode === 'OPENING' ||
            modalMode === 'CONFIRM_JOB' ||
            modalMode === 'RECONCILE_LEGACY') && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                gap: '10px',
              }}
            >
              <div>
                <label style={labelStyle}>Nhà in / Xưởng đối tác *</label>
                <select
                  aria-label="Chọn nhà in"
                  style={inputStyle}
                  value={formVendorId}
                  onChange={(e) => setFormVendorId(e.target.value)}
                >
                  <option value="">
                    {modalMode === 'RECONCILE_LEGACY'
                      ? '-- Chỉ đánh dấu đã kiểm tra (không tạo phiếu chi) --'
                      : '-- Chọn xưởng trong danh mục --'}
                  </option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              {modalMode !== 'RECONCILE_LEGACY' &&
                modalMode !== 'CONFIRM_JOB' && (
                  <div>
                    <label style={labelStyle}>Nhóm sổ công nợ</label>
                    <select
                      aria-label="Nhóm sổ công nợ xưởng"
                      style={inputStyle}
                      value={formLedgerScope}
                      onChange={(e) =>
                        setFormLedgerScope(e.target.value as LedgerScopeType)
                      }
                    >
                      <option value="GENERAL">Sổ chung (GENERAL)</option>
                      <option value="RIENG">Sổ RIÊNG</option>
                      <option value="HVGROUP">Sổ HVGROUP</option>
                    </select>
                  </div>
                )}
            </div>
          )}

          {(modalMode === 'ADJUSTMENT' ||
            modalMode === 'VENDOR_REFUND' ||
            modalMode === 'RECONCILE_LEGACY') && (
            <div>
              <label style={labelStyle}>
                {modalMode === 'ADJUSTMENT'
                  ? 'Phiếu xưởng áp dụng *'
                  : 'Gán vào phiếu xưởng (tùy chọn)'}
              </label>
              <select
                aria-label="Chọn phiếu đặt xưởng"
                style={inputStyle}
                value={formTargetJobId}
                onChange={(e) => setFormTargetJobId(e.target.value)}
              >
                <option value="">-- Không gán phiếu cụ thể --</option>
                {openJobs
                  .filter(
                    (j: PrintWorkshopJobData) => j.cost_status === 'CONFIRMED',
                  )
                  .map((j: PrintWorkshopJobData) => (
                    <option key={j.id} value={j.id}>
                      {j.job_code} — {j.vendor_name} (Còn trả:{' '}
                      {formatVnd(j.remaining_payable_amount)})
                    </option>
                  ))}
              </select>
            </div>
          )}

          {modalMode === 'ADJUSTMENT' && (
            <div>
              <label style={labelStyle}>Loại điều chỉnh công nợ xưởng</label>
              <select
                aria-label="Loại điều chỉnh công nợ xưởng"
                style={inputStyle}
                value={formAdjType}
                onChange={(e) =>
                  setFormAdjType(e.target.value as typeof formAdjType)
                }
              >
                <option value="DEFECT_DEDUCTION">
                  Giảm phải trả — Trừ hàng lỗi
                </option>
                <option value="DISCOUNT">
                  Giảm phải trả — Chiết khấu nhà in
                </option>
                <option value="SURCHARGE">
                  Tăng phải trả — Phụ phí khuôn / gia công
                </option>
              </select>
            </div>
          )}

          {modalMode !== 'ALLOCATE' && modalMode !== 'RECONCILE_LEGACY' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                gap: '10px',
              }}
            >
              <div>
                <label style={labelStyle}>
                  {modalMode === 'CONFIRM_JOB'
                    ? 'Chi phí thực tế xác nhận (VNĐ) *'
                    : 'Số tiền (VNĐ) *'}
                </label>
                <NumericDraftInput
                  ariaLabel="Số tiền giao dịch xưởng"
                  allowDecimal={false}
                  style={{ ...inputStyle, ...tabularNumStyle }}
                  value={formAmountInput}
                  onValueChange={setFormAmountInput}
                  placeholder="Nhập số nguyên VNĐ…"
                />
              </div>
              {(modalMode === 'PAYOUT' || modalMode === 'VENDOR_REFUND') && (
                <div>
                  <label style={labelStyle}>Mã chứng từ / UNC</label>
                  <input
                    aria-label="Mã chứng từ chi xưởng"
                    style={inputStyle}
                    value={formReferenceCode}
                    onChange={(e) => setFormReferenceCode(e.target.value)}
                    placeholder="VD: UNC-2026-..."
                  />
                </div>
              )}
            </div>
          )}

          {(modalMode === 'PAYOUT' || modalMode === 'ALLOCATE') &&
            openJobs.filter(
              (j: PrintWorkshopJobData) =>
                j.cost_status === 'CONFIRMED' &&
                j.remaining_payable_amount > 0 &&
                (!formVendorId || j.vendor_id === formVendorId),
            ).length > 0 && (
              <div
                style={{
                  padding: '10px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  maxHeight: '190px',
                  overflowY: 'auto',
                }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    marginBottom: '6px',
                  }}
                >
                  Phân bổ vào phiếu xưởng đã xác nhận (để trống nếu giữ làm tạm
                  ứng)
                </div>
                {openJobs
                  .filter(
                    (j: PrintWorkshopJobData) =>
                      j.cost_status === 'CONFIRMED' &&
                      j.remaining_payable_amount > 0 &&
                      (!formVendorId || j.vendor_id === formVendorId),
                  )
                  .slice(0, 8)
                  .map((job: PrintWorkshopJobData) => (
                    <div
                      key={job.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '4px 0',
                        fontSize: '12.5px',
                      }}
                    >
                      <span>
                        <strong>{job.job_code}</strong> • {job.vendor_name}{' '}
                        (Còn: {formatVnd(job.remaining_payable_amount)})
                      </span>
                      <div style={{ width: '135px' }}>
                        <NumericDraftInput
                          ariaLabel={`Phân bổ phiếu ${job.job_code}`}
                          allowDecimal={false}
                          style={{
                            ...inputStyle,
                            minHeight: '34px',
                            padding: '5px 8px',
                            ...tabularNumStyle,
                          }}
                          value={allocMap[job.id] || ''}
                          onValueChange={(v) =>
                            setAllocMap((prev) => ({ ...prev, [job.id]: v }))
                          }
                          placeholder="0"
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}

          {(modalMode === 'VENDOR_REFUND' ||
            modalMode === 'ADJUSTMENT' ||
            modalMode === 'RECONCILE_LEGACY' ||
            (modalMode === 'CONFIRM_JOB' &&
              selectedJob?.cost_status === 'CONFIRMED')) && (
            <div>
              <label style={labelStyle}>Lý do / Căn cứ bắt buộc *</label>
              <input
                aria-label="Lý do thực hiện công nợ xưởng"
                style={inputStyle}
                required
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
                placeholder="Ghi rõ lý do / căn cứ hóa đơn nhà in…"
              />
            </div>
          )}

          {modalMode !== 'ADJUSTMENT' && modalMode !== 'RECONCILE_LEGACY' && (
            <div>
              <label style={labelStyle}>Ghi chú</label>
              <input
                aria-label="Ghi chú phiếu xưởng"
                style={inputStyle}
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="Ghi chú nội bộ (không bắt buộc)…"
              />
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
              className="pq-btn pq-btn-secondary"
              onClick={() => setModalMode(null)}
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="pq-btn pq-btn-primary"
            >
              <PqStoreIcon size={15} />
              <span>{submitting ? 'Đang lưu…' : 'Xác nhận lưu'}</span>
            </button>
          </div>
        </form>
      </CatalogModalDialog>
    </div>
  );
};
