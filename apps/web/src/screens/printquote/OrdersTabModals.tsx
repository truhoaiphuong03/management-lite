import React, { useState, useEffect } from 'react';
import { useAutoDismiss } from '../../../../../packages/ui/src/components/index.js';
import {
  PrintProductionStatus,
  PrintDeliveryStatus,
  OrderCostReconciliationStatus,
  type PrintProductionStatusType,
  type PrintDeliveryStatusType,
  type PrintOrderData,
  type PrintVendorData,
  type OrderCostHistoryActionType,
} from '../../../../../packages/contracts/src/printquote.js';
import {
  formatVnd,
  parseNumericDraftValue,
  PRODUCTION_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
} from '../helpers/printquote-helpers.js';
import { inputStyle, labelStyle, tabularNumStyle } from './types.js';
import { NumericDraftInput } from './NumericDraftInput.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';
import { PqWalletIcon } from './PrintQuoteIcons.js';
import { hasCancelledObligation } from './OrdersTab.js';

const HISTORY_ACTION_LABELS: Record<OrderCostHistoryActionType, string> = {
  ENTERED: 'Nhập nháp chi phí',
  CONFIRMED: 'Xác nhận chi phí thực tế',
  ADJUSTED: 'Điều chỉnh chi phí xác nhận',
  UNCONFIRMED: 'Bỏ xác nhận (mở rà soát lại)',
  VENDOR_PAYMENT_NOTE: 'Cập nhật ghi chú chi xưởng',
};

export interface OrdersTabModalsProps {
  detailOrder: PrintOrderData | null;
  onCloseDetailOrder: () => void;
  paymentOrderTarget: PrintOrderData | null;
  setPaymentOrderTarget: (ord: PrintOrderData | null) => void;
  paymentAmount: number;
  setPaymentAmount: (v: number) => void;
  paymentType: 'DEPOSIT' | 'INSTALLMENT' | 'FINAL' | 'REFUND';
  setPaymentType: (v: 'DEPOSIT' | 'INSTALLMENT' | 'FINAL' | 'REFUND') => void;
  paymentMethod: string;
  setPaymentMethod: (v: string) => void;
  paymentNote: string;
  setPaymentNote: (v: string) => void;
  onRecordPayment: (e: React.FormEvent) => void;
  paymentSubmitting?: boolean | undefined;
  costOrderTarget: PrintOrderData | null;
  setCostOrderTarget: (ord: PrintOrderData | null) => void;
  onOpenConfirmActualCostModal: (ord: PrintOrderData) => void;
  jobOrderTarget: PrintOrderData | null;
  setJobOrderTarget: (ord: PrintOrderData | null) => void;
  onOpenWorkshopJobModal: (ord: PrintOrderData) => void;
  settleCancelTarget: PrintOrderData | null;
  setSettleCancelTarget: (ord: PrintOrderData | null) => void;
  onOpenSettleCancelModal: (ord: PrintOrderData) => void;
  onOpenPaymentModal: (ord: PrintOrderData) => void;
  vendors: PrintVendorData[];
  onMutateLedger?:
    | ((
        endpoint: string,
        body: Record<string, unknown>,
        method?: 'POST' | 'PATCH',
      ) => Promise<{ ok: boolean; error?: string; code?: string }>)
    | undefined;
  onUpdateOrderField: (
    orderId: string,
    patch: Record<string, unknown>,
  ) => void | Promise<boolean>;
}

function renderUnconfirmedCostText(ord: PrintOrderData): React.ReactElement {
  const status = ord.cost_reconciliation_status;
  if (status === OrderCostReconciliationStatus.PARTIAL_ENTERED) {
    const parts: string[] = [];
    if (
      ord.entered_vendor_cost !== null &&
      ord.entered_vendor_cost !== undefined
    ) {
      parts.push(`Vốn: ${formatVnd(ord.entered_vendor_cost)}`);
    }
    if (
      ord.entered_shipping_fee !== null &&
      ord.entered_shipping_fee !== undefined
    ) {
      parts.push(`Ship: ${formatVnd(ord.entered_shipping_fee)}`);
    }
    if (
      ord.entered_extra_cost !== null &&
      ord.entered_extra_cost !== undefined
    ) {
      parts.push(`Phát sinh: ${formatVnd(ord.entered_extra_cost)}`);
    }
    return (
      <span style={{ color: 'var(--warning-text, var(--muted-color))' }}>
        Chi phí thực tế:{' '}
        <strong>
          Đã nhập một phần ({parts.join(' · ')}) — Chưa xác nhận từ xưởng
        </strong>
      </span>
    );
  }
  if (status === OrderCostReconciliationStatus.ENTERED_UNCONFIRMED) {
    const enteredTotal =
      (ord.entered_vendor_cost ?? 0) +
      (ord.entered_shipping_fee ?? 0) +
      (ord.entered_extra_cost ?? 0);
    return (
      <span style={{ color: 'var(--warning-text, var(--muted-color))' }}>
        Chi phí thực tế:{' '}
        <strong>
          Đã nhập nháp {formatVnd(enteredTotal)} — Chưa xác nhận từ xưởng
        </strong>
      </span>
    );
  }
  if (status === OrderCostReconciliationStatus.NEEDS_REVIEW) {
    return (
      <span style={{ color: 'var(--danger-text)' }}>
        Chi phí thực tế:{' '}
        <strong>Cần rà soát lại — Chưa xác nhận từ xưởng</strong>
      </span>
    );
  }
  return (
    <span style={{ color: 'var(--muted-color)' }}>
      Chi phí thực tế: <strong>Chưa xác nhận từ xưởng</strong>
    </span>
  );
}

export const OrdersTabModals: React.FC<OrdersTabModalsProps> = ({
  detailOrder,
  onCloseDetailOrder,
  paymentOrderTarget,
  setPaymentOrderTarget,
  paymentAmount,
  setPaymentAmount,
  paymentType,
  setPaymentType,
  paymentMethod,
  setPaymentMethod,
  paymentNote,
  setPaymentNote,
  onRecordPayment,
  paymentSubmitting = false,
  costOrderTarget,
  setCostOrderTarget,
  onOpenConfirmActualCostModal,
  jobOrderTarget,
  setJobOrderTarget,
  onOpenWorkshopJobModal,
  settleCancelTarget,
  setSettleCancelTarget,
  onOpenSettleCancelModal,
  onOpenPaymentModal,
  vendors,
  onMutateLedger,
  onUpdateOrderField,
}) => {
  const [paymentAmountInput, setPaymentAmountInput] = useState<string>(
    paymentAmount > 0 ? String(paymentAmount) : '',
  );
  const [actualVendorCostInput, setActualVendorCostInput] =
    useState<string>('');
  const [actualShippingInput, setActualShippingInput] = useState<string>('');
  const [actualExtraInput, setActualExtraInput] = useState<string>('');
  const [vendorPaidInput, setVendorPaidInput] = useState<string>('0');
  const [costNoteInput, setCostNoteInput] = useState<string>('');
  const [costModalError, setCostModalError] = useState<string>('');

  const [jobVendorId, setJobVendorId] = useState<string>('');
  const [jobVendorName, setJobVendorName] = useState<string>('');
  const [jobStageName, setJobStageName] = useState<string>('In / Gia công');
  const [jobExpectedInput, setJobExpectedInput] = useState<string>('0');
  const [jobModalError, setJobModalError] = useState<string>('');

  const [settleRefundInput, setSettleRefundInput] = useState<string>('0');
  const [settleFeeInput, setSettleFeeInput] = useState<string>('0');
  const [settleReasonInput, setSettleReasonInput] = useState<string>('');
  const [settleModalError, setSettleModalError] = useState<string>('');

  useAutoDismiss(costModalError, () => setCostModalError(''), 5000);
  useAutoDismiss(jobModalError, () => setJobModalError(''), 5000);
  useAutoDismiss(settleModalError, () => setSettleModalError(''), 5000);

  useEffect(() => {
    if (paymentOrderTarget) {
      setPaymentAmountInput(paymentAmount > 0 ? String(paymentAmount) : '');
    }
  }, [paymentOrderTarget, paymentAmount]);

  useEffect(() => {
    if (!costOrderTarget) return;
    setActualVendorCostInput(
      costOrderTarget.entered_vendor_cost !== null &&
        costOrderTarget.entered_vendor_cost !== undefined
        ? String(costOrderTarget.entered_vendor_cost)
        : costOrderTarget.actual_cost_confirmed &&
            costOrderTarget.actual_vendor_cost !== null
          ? String(costOrderTarget.actual_vendor_cost)
          : '',
    );
    setActualShippingInput(
      costOrderTarget.entered_shipping_fee !== null &&
        costOrderTarget.entered_shipping_fee !== undefined
        ? String(costOrderTarget.entered_shipping_fee)
        : costOrderTarget.actual_cost_confirmed &&
            costOrderTarget.actual_shipping_fee !== null
          ? String(costOrderTarget.actual_shipping_fee)
          : '',
    );
    setActualExtraInput(
      costOrderTarget.entered_extra_cost !== null &&
        costOrderTarget.entered_extra_cost !== undefined
        ? String(costOrderTarget.entered_extra_cost)
        : costOrderTarget.actual_cost_confirmed &&
            costOrderTarget.actual_extra_cost !== null
          ? String(costOrderTarget.actual_extra_cost)
          : '',
    );
    setVendorPaidInput(String(costOrderTarget.vendor_paid_amount ?? 0));
    setCostNoteInput('');
    setCostModalError('');
  }, [costOrderTarget]);

  useEffect(() => {
    if (!jobOrderTarget) return;
    setJobVendorId(jobOrderTarget.vendor_id || '');
    setJobVendorName('');
    setJobStageName('In / Gia công');
    setJobExpectedInput('0');
    setJobModalError('');
  }, [jobOrderTarget]);

  useEffect(() => {
    if (!settleCancelTarget) return;
    setSettleRefundInput(String(settleCancelTarget.total_paid_amount));
    setSettleFeeInput('0');
    setSettleReasonInput('');
    setSettleModalError('');
  }, [settleCancelTarget]);

  const parseOptionalIntegerInput = (
    raw: string,
    label: string,
  ): { ok: boolean; value: number | null; error?: string } => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return { ok: true, value: null };
    }
    const parsed = parseNumericDraftValue(trimmed, {
      allowDecimal: false,
      min: 0,
      integerOnly: true,
    });
    if (!parsed.isValid || parsed.value === null) {
      return {
        ok: false,
        value: null,
        error: `${label} phải là số nguyên không âm (VNĐ).`,
      };
    }
    return { ok: true, value: parsed.value };
  };

  const submitCostUpdate = async (
    mode: 'SAVE_DRAFT' | 'CONFIRM' | 'UNCONFIRM',
  ) => {
    if (!costOrderTarget) return;
    setCostModalError('');

    const vPaid = parseNumericDraftValue(vendorPaidInput.trim() || '0', {
      allowDecimal: false,
      min: 0,
      integerOnly: true,
    });
    if (!vPaid.isValid || vPaid.value === null) {
      setCostModalError(
        'Ghi chú tổng tiền đã chi xưởng phải là số nguyên không âm (VNĐ).',
      );
      return;
    }

    if (mode === 'UNCONFIRM') {
      const res = await onUpdateOrderField(costOrderTarget.id, {
        actual_cost_confirmed: false,
        vendor_paid_amount: vPaid.value,
        cost_note:
          costNoteInput.trim() || 'Bỏ xác nhận chi phí để kiểm tra lại',
      });
      if (res !== false) {
        setCostOrderTarget(null);
      }
      return;
    }

    const vCost = parseOptionalIntegerInput(
      actualVendorCostInput,
      'Chi phí nhà in + gia công thực tế',
    );
    if (!vCost.ok) {
      setCostModalError(vCost.error || 'Dữ liệu không hợp lệ.');
      return;
    }
    const vShip = parseOptionalIntegerInput(
      actualShippingInput,
      'Phí giao hàng thực tế',
    );
    if (!vShip.ok) {
      setCostModalError(vShip.error || 'Dữ liệu không hợp lệ.');
      return;
    }
    const vExtra = parseOptionalIntegerInput(
      actualExtraInput,
      'Phí phát sinh thực tế',
    );
    if (!vExtra.ok) {
      setCostModalError(vExtra.error || 'Dữ liệu không hợp lệ.');
      return;
    }

    if (
      mode === 'CONFIRM' &&
      (vCost.value === null || vShip.value === null || vExtra.value === null)
    ) {
      setCostModalError(
        'Cần nhập đủ cả 3 khoản (Chi phí nhà in, Phí giao hàng thực tế và Phí phát sinh; nhập 0 nếu không phát sinh) trước khi xác nhận. Hệ thống không tự lấy chi phí dự kiến cho khoản bỏ trống.',
      );
      return;
    }

    const res = await onUpdateOrderField(costOrderTarget.id, {
      ...(mode === 'CONFIRM' ? { actual_cost_confirmed: true } : {}),
      entered_vendor_cost: vCost.value,
      entered_shipping_fee: vShip.value,
      entered_extra_cost: vExtra.value,
      vendor_paid_amount: vPaid.value,
      cost_note: costNoteInput.trim() || null,
    });
    if (res !== false) {
      setCostOrderTarget(null);
    }
  };

  const hasActiveSubModal = Boolean(
    paymentOrderTarget ||
      costOrderTarget ||
      jobOrderTarget ||
      settleCancelTarget,
  );

  return (
    <>
      {/* Order Full Detail Dialog */}
      <CatalogModalDialog
        open={detailOrder !== null && !hasActiveSubModal}
        testId="pq-order-detail-dialog"
        ariaLabel={
          detailOrder
            ? `Chi tiết đơn hàng ${detailOrder.order_code}`
            : 'Chi tiết đơn hàng'
        }
        title={
          detailOrder
            ? `Chi tiết đơn hàng ${detailOrder.order_code}`
            : 'Chi tiết đơn hàng'
        }
        subtitle={
          detailOrder
            ? `Khách hàng: ${detailOrder.customer_name || 'Khách lẻ'} • Báo giá gốc: ${detailOrder.quote_code || '—'} (v${detailOrder.quote_version})`
            : undefined
        }
        maxWidth="760px"
        onClose={onCloseDetailOrder}
      >
        {detailOrder &&
          (() => {
            const isCancelled = detailOrder.production_status === 'CANCELLED';
            const cancelledHasObligation = hasCancelledObligation(detailOrder);
            return (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div className="pq-quote-metrics">
                  <div className="pq-metric-cell">
                    <span className="pq-metric-label">Tổng tiền đơn</span>
                    <strong className="pq-metric-val" style={tabularNumStyle}>
                      {formatVnd(detailOrder.total_quote_amount)}
                    </strong>
                  </div>
                  <div className="pq-metric-cell">
                    <span className="pq-metric-label">Đã thu</span>
                    <strong
                      className="pq-metric-val"
                      style={{
                        ...tabularNumStyle,
                        color: 'var(--success-text)',
                      }}
                    >
                      {formatVnd(detailOrder.total_paid_amount)}
                    </strong>
                  </div>
                  <div className="pq-metric-cell">
                    <span className="pq-metric-label">
                      {isCancelled ? 'Trạng thái hủy' : 'Còn nợ'}
                    </span>
                    <strong
                      className="pq-metric-val"
                      style={{
                        ...tabularNumStyle,
                        color: isCancelled
                          ? 'var(--muted-color)'
                          : detailOrder.remaining_debt_amount > 0
                            ? 'var(--danger-text)'
                            : 'var(--success-text)',
                      }}
                    >
                      {isCancelled
                        ? 'Đơn đã hủy'
                        : formatVnd(detailOrder.remaining_debt_amount)}
                    </strong>
                  </div>
                  <div className="pq-metric-cell pq-metric-cell-total">
                    <span className="pq-metric-label">Lời dự kiến (BG)</span>
                    <strong
                      className="pq-metric-total-val"
                      style={{
                        ...tabularNumStyle,
                        color: 'var(--success-text)',
                      }}
                    >
                      {formatVnd(detailOrder.expected_profit)}
                    </strong>
                  </div>
                </div>

                {cancelledHasObligation && (
                  <div
                    data-testid={`pq-order-cancelled-obligation-${detailOrder.order_code}`}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--danger-text)',
                      fontSize: '12px',
                      color: 'var(--danger-text)',
                      ...tabularNumStyle,
                    }}
                  >
                    <strong>Đơn đã hủy còn nghĩa vụ cần xử lý riêng:</strong>{' '}
                    Tiền khách đang giữ:{' '}
                    <strong>{formatVnd(detailOrder.total_paid_amount)}</strong>{' '}
                    • Ghi chú tổng đã chi xưởng:{' '}
                    <strong>
                      {formatVnd(detailOrder.vendor_paid_amount ?? 0)}
                    </strong>
                    {detailOrder.actual_cost_confirmed && (
                      <>
                        {' '}
                        • Chi phí phát sinh xác nhận:{' '}
                        <strong>
                          {formatVnd(
                            (detailOrder.actual_vendor_cost ?? 0) +
                              (detailOrder.actual_shipping_fee ?? 0) +
                              (detailOrder.actual_extra_cost ?? 0),
                          )}
                        </strong>
                      </>
                    )}
                  </div>
                )}

                <div
                  data-testid={`pq-order-financial-tiers-${detailOrder.order_code}`}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px',
                    fontSize: '12px',
                    ...tabularNumStyle,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '12px',
                      alignItems: 'center',
                    }}
                  >
                    <span>
                      Vốn dự kiến:{' '}
                      <strong>
                        {formatVnd(detailOrder.expected_vendor_cost)}
                      </strong>
                    </span>
                    <span>•</span>
                    {detailOrder.actual_cost_confirmed &&
                    detailOrder.actual_profit !== null ? (
                      <span style={{ color: 'var(--text-color)' }}>
                        Chi phí thực tế đã xác nhận:{' '}
                        <strong>
                          {formatVnd(
                            (detailOrder.actual_vendor_cost ?? 0) +
                              (detailOrder.actual_shipping_fee ?? 0) +
                              (detailOrder.actual_extra_cost ?? 0),
                          )}
                        </strong>{' '}
                        (Lời TT:{' '}
                        <strong style={{ color: 'var(--success-text)' }}>
                          {formatVnd(detailOrder.actual_profit)}
                        </strong>
                        )
                      </span>
                    ) : (
                      renderUnconfirmedCostText(detailOrder)
                    )}
                    <span>•</span>
                    <span title="Ghi chú tổng tiền đã chi cấp đơn — chưa tách sổ công nợ hoặc phiếu chi theo từng xưởng">
                      Thực chi xưởng (ghi chú cấp đơn — chưa tách sổ công nợ):{' '}
                      <strong>
                        {formatVnd(detailOrder.vendor_paid_amount ?? 0)}
                      </strong>
                    </span>
                  </div>

                  <button
                    type="button"
                    data-testid={`pq-order-confirm-cost-${detailOrder.order_code}`}
                    onClick={() => onOpenConfirmActualCostModal(detailOrder)}
                    className="pq-btn pq-btn-secondary pq-btn-sm"
                  >
                    <span>
                      {detailOrder.actual_cost_confirmed
                        ? 'Điều chỉnh / Bỏ xác nhận'
                        : 'Xác nhận chi phí thực tế'}
                    </span>
                  </button>
                </div>

                {onMutateLedger && (
                  <div
                    data-testid={`pq-order-workshop-jobs-${detailOrder.order_code}`}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px dashed var(--border-color)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '8px',
                      fontSize: '12px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px',
                        alignItems: 'center',
                      }}
                    >
                      <strong style={{ color: 'var(--text-color)' }}>
                        Phiếu đặt xưởng (
                        {detailOrder.workshop_jobs?.length ?? 0}):
                      </strong>
                      {detailOrder.workshop_jobs &&
                      detailOrder.workshop_jobs.length > 0 ? (
                        detailOrder.workshop_jobs.map((jb) => (
                          <span
                            key={jb.id}
                            style={{
                              padding: '2px 8px',
                              borderRadius: '999px',
                              backgroundColor: 'var(--surface-subtle)',
                              border: '1px solid var(--border-color)',
                              ...tabularNumStyle,
                            }}
                          >
                            {jb.job_code} •{' '}
                            {jb.vendor_name || 'Chưa chọn xưởng'} ({jb.title}) —{' '}
                            {jb.cost_status === 'CONFIRMED' &&
                            jb.confirmed_cost !== null
                              ? `TT ${formatVnd(jb.confirmed_cost)}`
                              : `DK ${formatVnd(jb.expected_cost)}`}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: 'var(--muted-color)' }}>
                          Chưa tách phiếu xưởng riêng
                        </span>
                      )}
                    </div>

                    <div
                      style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}
                    >
                      {!isCancelled && (
                        <button
                          type="button"
                          data-testid={`pq-order-add-job-${detailOrder.order_code}`}
                          className="pq-btn pq-btn-ghost pq-btn-sm"
                          onClick={() => onOpenWorkshopJobModal(detailOrder)}
                        >
                          + Đặt xưởng / Tách công đoạn
                        </button>
                      )}
                      {isCancelled && detailOrder.total_paid_amount > 0 && (
                        <button
                          type="button"
                          data-testid={`pq-order-settle-cancel-${detailOrder.order_code}`}
                          className="pq-btn pq-btn-secondary pq-btn-sm"
                          onClick={() => onOpenSettleCancelModal(detailOrder)}
                        >
                          Quyết toán hủy đơn
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(min(100%, 185px), 1fr))',
                    gap: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid var(--border-color)',
                  }}
                >
                  <div>
                    <label style={labelStyle}>Ngày gửi nhà in</label>
                    <input
                      aria-label={`Ngày đặt in ${detailOrder.order_code}`}
                      type="date"
                      style={inputStyle}
                      value={detailOrder.print_ordered_at || ''}
                      onChange={(e) =>
                        void onUpdateOrderField(detailOrder.id, {
                          print_ordered_at: e.target.value || null,
                        })
                      }
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Tiến độ in ấn</label>
                    <select
                      aria-label={`Trạng thái sản xuất ${detailOrder.order_code}`}
                      style={inputStyle}
                      value={detailOrder.production_status}
                      onChange={(e) =>
                        void onUpdateOrderField(detailOrder.id, {
                          production_status: e.target
                            .value as PrintProductionStatusType,
                        })
                      }
                    >
                      {Object.entries(PrintProductionStatus).map(([, val]) => (
                        <option key={val} value={val}>
                          {PRODUCTION_STATUS_LABELS[val]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={labelStyle}>Tiến độ giao hàng</label>
                    <select
                      aria-label={`Trạng thái giao hàng ${detailOrder.order_code}`}
                      style={inputStyle}
                      value={detailOrder.delivery_status}
                      onChange={(e) =>
                        void onUpdateOrderField(detailOrder.id, {
                          delivery_status: e.target
                            .value as PrintDeliveryStatusType,
                        })
                      }
                    >
                      {Object.entries(PrintDeliveryStatus).map(([, val]) => (
                        <option key={val} value={val}>
                          {DELIVERY_STATUS_LABELS[val]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      type="button"
                      data-testid={`pq-order-record-payment-${detailOrder.order_code}`}
                      onClick={() => onOpenPaymentModal(detailOrder)}
                      className="pq-btn pq-btn-primary"
                      style={{ width: '100%' }}
                    >
                      <PqWalletIcon size={15} />
                      <span>
                        {isCancelled
                          ? 'Hoàn tiền khách (Đơn hủy)'
                          : 'Ghi nhận thanh toán'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
      </CatalogModalDialog>

      {/* Record Payment Modal */}
      <CatalogModalDialog
        open={paymentOrderTarget !== null}
        ariaLabel="Ghi nhận thanh toán đơn hàng"
        title={
          paymentOrderTarget
            ? paymentOrderTarget.production_status === 'CANCELLED'
              ? `Hoàn tiền khách — Đơn hủy ${paymentOrderTarget.order_code}`
              : `Thu tiền / Đặt cọc — Đơn ${paymentOrderTarget.order_code}`
            : 'Ghi nhận thanh toán đơn hàng'
        }
        subtitle={
          paymentOrderTarget?.production_status === 'CANCELLED'
            ? 'Đơn đã hủy chỉ cho phép ghi nhận Hoàn tiền (REFUND) để tất toán số tiền khách đã đóng.'
            : 'Ghi nhận tiền đặt cọc hoặc thanh toán từng đợt của khách hàng.'
        }
        maxWidth="460px"
        onClose={() => setPaymentOrderTarget(null)}
      >
        <form
          onSubmit={onRecordPayment}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div>
            <label style={labelStyle}>Loại thanh toán</label>
            <select
              aria-label="Loại thanh toán"
              style={inputStyle}
              value={paymentType}
              onChange={(e) =>
                setPaymentType(
                  e.target.value as
                    | 'DEPOSIT'
                    | 'INSTALLMENT'
                    | 'FINAL'
                    | 'REFUND',
                )
              }
            >
              {paymentOrderTarget?.production_status !== 'CANCELLED' && (
                <>
                  <option value="DEPOSIT">Tiền đặt cọc (Deposit)</option>
                  <option value="INSTALLMENT">Thanh toán đợt</option>
                  <option value="FINAL">Tất toán công nợ cuối</option>
                </>
              )}
              <option value="REFUND">Hoàn tiền (Refund)</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>
              {paymentType === 'REFUND'
                ? 'Số tiền hoàn trả khách (VNĐ) *'
                : 'Số tiền thu (VNĐ) *'}
            </label>
            <NumericDraftInput
              ariaLabel="Số tiền thanh toán"
              allowDecimal={false}
              placeholder="VD: 50000"
              style={inputStyle}
              required
              value={paymentAmountInput}
              onValueChange={(nextRaw) => {
                setPaymentAmountInput(nextRaw);
                const parsed = parseNumericDraftValue(nextRaw, {
                  allowDecimal: false,
                  min: 0,
                  integerOnly: true,
                });
                setPaymentAmount(
                  parsed.isValid && parsed.value !== null ? parsed.value : 0,
                );
              }}
            />
          </div>

          <div>
            <label style={labelStyle}>Phương thức</label>
            <select
              aria-label="Phương thức thanh toán"
              style={inputStyle}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="BANK_TRANSFER">Chuyển khoản Ngân hàng</option>
              <option value="QR_VIETQR">Quét mã VietQR</option>
              <option value="CASH">Tiền mặt</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Ghi chú giao dịch</label>
            <input
              aria-label="Ghi chú thanh toán"
              style={inputStyle}
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              placeholder="VD: Khách CK cọc 50% đơn in…"
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
              onClick={() => setPaymentOrderTarget(null)}
              disabled={paymentSubmitting}
              className="pq-btn pq-btn-secondary"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={paymentSubmitting}
              aria-busy={paymentSubmitting || undefined}
              className="pq-btn pq-btn-primary"
            >
              {paymentSubmitting
                ? 'Đang xử lý…'
                : paymentOrderTarget?.production_status === 'CANCELLED'
                  ? 'Xác nhận hoàn tiền'
                  : 'Xác nhận thu tiền'}
            </button>
          </div>
        </form>
      </CatalogModalDialog>

      {/* Confirm / Save Draft / Unconfirm Actual Cost Modal */}
      <CatalogModalDialog
        open={costOrderTarget !== null}
        ariaLabel="Xác nhận chi phí thực tế xưởng"
        title={
          costOrderTarget
            ? `Đối soát chi phí thực tế — ${costOrderTarget.order_code}`
            : 'Xác nhận chi phí thực tế'
        }
        subtitle="Tách rõ Dự kiến, Đã nhập nháp và Đã xác nhận. Không tự lấy số dự kiến cho khoản chưa kiểm tra."
        maxWidth="520px"
        onClose={() => setCostOrderTarget(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCostUpdate('CONFIRM');
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {costOrderTarget && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                fontSize: '12px',
                ...tabularNumStyle,
              }}
            >
              <div>
                Tham chiếu dự kiến lúc báo giá: Vốn{' '}
                <strong>
                  {formatVnd(costOrderTarget.expected_vendor_cost)}
                </strong>{' '}
                • Ship{' '}
                <strong>
                  {formatVnd(costOrderTarget.expected_shipping_fee)}
                </strong>{' '}
                • Phát sinh{' '}
                <strong>
                  {formatVnd(costOrderTarget.expected_extra_cost)}
                </strong>{' '}
                • Lời dự kiến{' '}
                <strong style={{ color: 'var(--success-text)' }}>
                  {formatVnd(costOrderTarget.expected_profit)}
                </strong>
              </div>
              {costOrderTarget.legacy_raw_actual_costs && (
                <div style={{ marginTop: '4px', color: 'var(--muted-color)' }}>
                  Số ghi nhận cũ trước nâng cấp (chưa có bằng chứng xác nhận):
                  Vốn{' '}
                  {formatVnd(
                    costOrderTarget.legacy_raw_actual_costs.vendor_cost,
                  )}{' '}
                  • Ship{' '}
                  {formatVnd(
                    costOrderTarget.legacy_raw_actual_costs.shipping_fee,
                  )}{' '}
                  • Phát sinh{' '}
                  {formatVnd(
                    costOrderTarget.legacy_raw_actual_costs.extra_cost,
                  )}
                </div>
              )}
            </div>
          )}

          {costModalError && (
            <div
              role="alert"
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--danger-text)',
                color: 'var(--danger-text)',
                fontSize: '12px',
              }}
            >
              {costModalError}
            </div>
          )}

          <div>
            <label style={labelStyle}>
              1. Chi phí nhà in + gia công thực tế (VNĐ) *
            </label>
            <NumericDraftInput
              dataTestId="pq-order-actual-vendor-cost-input"
              ariaLabel="Chi phí nhà in thực tế"
              allowDecimal={false}
              placeholder="Nhập từ hóa đơn/phiếu xưởng (nhập 0 nếu không phát sinh)"
              style={{ ...inputStyle, ...tabularNumStyle }}
              value={actualVendorCostInput}
              onValueChange={setActualVendorCostInput}
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
              <label style={labelStyle}>2. Phí giao hàng thực tế (VNĐ) *</label>
              <NumericDraftInput
                dataTestId="pq-order-actual-shipping-input"
                ariaLabel="Phí giao hàng thực tế"
                allowDecimal={false}
                placeholder="Nhập 0 nếu miễn phí"
                style={{ ...inputStyle, ...tabularNumStyle }}
                value={actualShippingInput}
                onValueChange={setActualShippingInput}
              />
            </div>

            <div>
              <label style={labelStyle}>3. Phí phát sinh thực tế (VNĐ) *</label>
              <NumericDraftInput
                dataTestId="pq-order-actual-extra-input"
                ariaLabel="Phí phát sinh thực tế"
                allowDecimal={false}
                placeholder="Nhập 0 nếu không có"
                style={{ ...inputStyle, ...tabularNumStyle }}
                value={actualExtraInput}
                onValueChange={setActualExtraInput}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>
              Ghi chú tổng tiền đã chi xưởng cấp đơn (VNĐ)
            </label>
            <NumericDraftInput
              dataTestId="pq-order-vendor-paid-input"
              ariaLabel="Tiền thực chi cho xưởng"
              allowDecimal={false}
              style={{ ...inputStyle, ...tabularNumStyle }}
              value={vendorPaidInput}
              onValueChange={setVendorPaidInput}
            />
            <div
              style={{
                fontSize: '11.5px',
                color: 'var(--muted-color)',
                marginTop: '4px',
              }}
            >
              Lưu ý phạm vi: Đây là ghi chú tổng tiền đã thanh toán nhà in ở cấp
              đơn hàng, chưa tách sổ công nợ từng xưởng hoặc phiếu chi/hoàn tiền
              chi tiết.
            </div>
          </div>

          <div>
            <label style={labelStyle}>
              Căn cứ / Ghi chú đối soát hoặc lý do điều chỉnh
            </label>
            <input
              data-testid="pq-order-cost-note-input"
              aria-label="Ghi chú đối soát chi phí"
              style={inputStyle}
              value={costNoteInput}
              onChange={(e) => setCostNoteInput(e.target.value)}
              placeholder="VD: Đối chiếu phiếu giao hàng xưởng #HD-108…"
            />
          </div>

          {costOrderTarget?.cost_history &&
            costOrderTarget.cost_history.length > 0 && (
              <div
                data-testid="pq-order-cost-history-list"
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  maxHeight: '132px',
                  overflowY: 'auto',
                  fontSize: '11.5px',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                  Lịch sử thay đổi & xác nhận (
                  {costOrderTarget.cost_history.length})
                </div>
                {costOrderTarget.cost_history.slice(0, 5).map((h) => (
                  <div
                    key={h.id}
                    style={{
                      padding: '3px 0',
                      borderTop: '1px dashed var(--border-color)',
                      color: 'var(--muted-color)',
                    }}
                  >
                    <strong style={{ color: 'var(--text-color)' }}>
                      {HISTORY_ACTION_LABELS[h.action] || h.action}
                    </strong>{' '}
                    • {new Date(h.created_at).toLocaleString('vi-VN')}
                    {h.note ? ` — ${h.note}` : ''}
                  </div>
                ))}
              </div>
            )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              marginTop: '4px',
            }}
          >
            <div>
              {costOrderTarget?.actual_cost_confirmed && (
                <button
                  type="button"
                  data-testid="pq-order-unconfirm-cost-btn"
                  onClick={() => void submitCostUpdate('UNCONFIRM')}
                  className="pq-btn pq-btn-secondary"
                >
                  Bỏ xác nhận (kiểm tra lại)
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setCostOrderTarget(null)}
                className="pq-btn pq-btn-secondary"
              >
                Đóng
              </button>
              {!costOrderTarget?.actual_cost_confirmed && (
                <button
                  type="button"
                  data-testid="pq-order-save-draft-cost-btn"
                  onClick={() => void submitCostUpdate('SAVE_DRAFT')}
                  className="pq-btn pq-btn-secondary"
                >
                  Lưu tạm khoản đã nhập
                </button>
              )}
              <button
                type="submit"
                data-testid="pq-order-confirm-cost-submit"
                className="pq-btn pq-btn-primary"
              >
                Xác nhận đủ 3 khoản
              </button>
            </div>
          </div>
        </form>
      </CatalogModalDialog>

      {/* Add Workshop Job Modal */}
      <CatalogModalDialog
        open={jobOrderTarget !== null}
        ariaLabel="Tạo phiếu đặt xưởng"
        title={
          jobOrderTarget
            ? `Đặt xưởng / Tách công đoạn — ${jobOrderTarget.order_code}`
            : 'Tạo phiếu đặt xưởng'
        }
        maxWidth="460px"
        onClose={() => setJobOrderTarget(null)}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!jobOrderTarget || !onMutateLedger) return;
            setJobModalError('');
            const vend = vendors.find((v) => v.id === jobVendorId);
            const vName = vend?.name || jobVendorName.trim();
            if (!vName || !jobStageName.trim()) {
              setJobModalError('Chọn xưởng và nhập tên công đoạn.');
              return;
            }
            const expParsed = parseNumericDraftValue(
              jobExpectedInput.trim() || '0',
              { allowDecimal: false, min: 0, integerOnly: true },
            );
            const res = await onMutateLedger(
              `/api/v1/print-quotes/orders/${encodeURIComponent(jobOrderTarget.id)}/workshop-jobs`,
              {
                vendor_id: jobVendorId || null,
                vendor_name: vName,
                title: jobStageName.trim(),
                expected_cost:
                  expParsed.isValid && expParsed.value !== null
                    ? expParsed.value
                    : 0,
              },
            );
            if (!res.ok) {
              setJobModalError(res.error || 'Không thể tạo phiếu đặt xưởng.');
              return;
            }
            setJobOrderTarget(null);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {jobModalError && (
            <div
              role="alert"
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid var(--danger-text)',
                color: 'var(--danger-text)',
                fontSize: '12px',
              }}
            >
              {jobModalError}
            </div>
          )}
          <div>
            <label style={labelStyle}>Nhà in / Xưởng gia công *</label>
            <select
              aria-label="Chọn nhà in đặt hàng"
              style={inputStyle}
              value={jobVendorId}
              onChange={(e) => setJobVendorId(e.target.value)}
            >
              <option value="">-- Nhập tên xưởng ngoài --</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          {!jobVendorId && (
            <div>
              <label style={labelStyle}>Tên xưởng ngoài *</label>
              <input
                aria-label="Tên xưởng đặt hàng"
                style={inputStyle}
                value={jobVendorName}
                onChange={(e) => setJobVendorName(e.target.value)}
                placeholder="VD: Xưởng Cán màng Bế hộp…"
              />
            </div>
          )}
          <div>
            <label style={labelStyle}>Công đoạn / Hạng mục giao xưởng *</label>
            <input
              aria-label="Tên công đoạn giao xưởng"
              style={inputStyle}
              value={jobStageName}
              onChange={(e) => setJobStageName(e.target.value)}
              placeholder="VD: Cán màng mờ + Ép kim"
            />
          </div>
          <div>
            <label style={labelStyle}>Giá vốn dự kiến (VNĐ)</label>
            <NumericDraftInput
              ariaLabel="Giá vốn dự kiến giao xưởng"
              allowDecimal={false}
              style={{ ...inputStyle, ...tabularNumStyle }}
              value={jobExpectedInput}
              onValueChange={setJobExpectedInput}
            />
          </div>
          <div
            style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}
          >
            <button
              type="button"
              className="pq-btn pq-btn-secondary"
              onClick={() => setJobOrderTarget(null)}
            >
              Đóng
            </button>
            <button type="submit" className="pq-btn pq-btn-primary">
              Tạo phiếu xưởng
            </button>
          </div>
        </form>
      </CatalogModalDialog>

      {/* Settle Cancelled Order Modal */}
      <CatalogModalDialog
        open={settleCancelTarget !== null}
        ariaLabel="Quyết toán đơn đã hủy"
        title={
          settleCancelTarget
            ? `Quyết toán đơn hủy — ${settleCancelTarget.order_code}`
            : 'Quyết toán đơn hủy'
        }
        subtitle="Tổng Hoàn trả khách + Phí hủy giữ lại phải khớp số tiền khách đang đóng trên đơn."
        maxWidth="460px"
        onClose={() => setSettleCancelTarget(null)}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!settleCancelTarget || !onMutateLedger) return;
            setSettleModalError('');
            const rParsed = parseNumericDraftValue(
              settleRefundInput.trim() || '0',
              { allowDecimal: false, min: 0, integerOnly: true },
            );
            const fParsed = parseNumericDraftValue(
              settleFeeInput.trim() || '0',
              { allowDecimal: false, min: 0, integerOnly: true },
            );
            const res = await onMutateLedger(
              `/api/v1/print-quotes/orders/${encodeURIComponent(settleCancelTarget.id)}/cancel-settlement`,
              {
                agreed_customer_refund_amount: rParsed.value ?? 0,
                retained_cancellation_fee: fParsed.value ?? 0,
                reason: settleReasonInput.trim(),
              },
            );
            if (!res.ok) {
              setSettleModalError(res.error || 'Không thể lưu quyết toán hủy.');
              return;
            }
            setSettleCancelTarget(null);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {settleModalError && (
            <div
              role="alert"
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid var(--danger-text)',
                color: 'var(--danger-text)',
                fontSize: '12px',
              }}
            >
              {settleModalError}
            </div>
          )}
          <div style={{ fontSize: '12.5px', ...tabularNumStyle }}>
            Tiền cọc khách đang giữ:{' '}
            <strong>
              {formatVnd(settleCancelTarget?.total_paid_amount ?? 0)}
            </strong>
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
              <label style={labelStyle}>Thỏa thuận hoàn khách (VNĐ) *</label>
              <NumericDraftInput
                ariaLabel="Số tiền thỏa thuận hoàn khách"
                allowDecimal={false}
                style={{ ...inputStyle, ...tabularNumStyle }}
                value={settleRefundInput}
                onValueChange={setSettleRefundInput}
              />
            </div>
            <div>
              <label style={labelStyle}>Phí hủy giữ lại (VNĐ) *</label>
              <NumericDraftInput
                ariaLabel="Phí hủy giữ lại"
                allowDecimal={false}
                style={{ ...inputStyle, ...tabularNumStyle }}
                value={settleFeeInput}
                onValueChange={setSettleFeeInput}
              />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Lý do / Thỏa thuận quyết toán *</label>
            <input
              aria-label="Lý do quyết toán hủy đơn"
              style={inputStyle}
              required
              value={settleReasonInput}
              onChange={(e) => setSettleReasonInput(e.target.value)}
              placeholder="VD: Khách hủy sau khi bình bài, trừ 500k phí kẽm…"
            />
          </div>
          <div
            style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}
          >
            <button
              type="button"
              className="pq-btn pq-btn-secondary"
              onClick={() => setSettleCancelTarget(null)}
            >
              Đóng
            </button>
            <button type="submit" className="pq-btn pq-btn-primary">
              Xác nhận quyết toán
            </button>
          </div>
        </form>
      </CatalogModalDialog>
    </>
  );
};
