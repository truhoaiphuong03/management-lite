/**
 * @management-lite/contracts - payroll
 * Types and DTOs for Compensation & Payroll (PAY-01 POLICY-01 V0.2)
 */

export interface HourlyRateData {
  id: string;
  workspace_id: string;
  employee_id: string;
  employee_code?: string;
  full_name?: string;
  hourly_rate_vnd: number;
  effective_from: string; // ISO 8601 UTC
  effective_to?: string | null; // ISO 8601 UTC
  created_at: string;
}

export interface SetHourlyRateRequest {
  employee_id: string;
  hourly_rate_vnd: number;
  effective_from: string; // ISO 8601 UTC
}

export interface PayrollPeriodData {
  /**
   * Period ID. Returns `null` when the period is a virtual draft without a DB row.
   * GET /api/v1/payroll/periods/:month does NOT create a database record.
   */
  id: string | null;
  workspace_id?: string | null | undefined;
  period_month: string; // YYYY-MM
  starts_on?: string | undefined; // YYYY-MM-DD
  ends_on?: string | undefined; // YYYY-MM-DD
  timezone?: string | undefined;
  status: 'draft' | 'finalized';
  calculation_revision?: number | undefined;
  finalized_at?: string | null | undefined;
  finalized_by?: string | null | undefined;
  finalized_snapshot_hash?: string | null | undefined;
  version: number;
  total_employees?: number | undefined;
  total_net_pay_vnd?: number | undefined;
  total_paid_amount_vnd?: number | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
  server_as_of?: string | undefined;
}

export interface PayrollDailyBreakdownData {
  id?: string | undefined;
  work_date: string; // YYYY-MM-DD
  shift_count: number;
  worked_seconds: number;
  worked_minutes: number;
  hourly_rate_vnd_snapshot: number;
  hourly_rate_vnd?: number | undefined;
  raw_wage_vnd: number;
  rounded_wage_vnd: number;
}

export type PayrollAdjustmentType = 'paid_leave';

export interface PayrollAdjustmentData {
  id?: string | undefined;
  adjustment_type: PayrollAdjustmentType;
  amount_vnd: number;
  attributable_date?: string | null | undefined; // YYYY-MM-DD (required for paid_leave)
  reason: string;
  created_at?: string | undefined;
}

export interface PayrollDisbursementData {
  id?: string;
  disbursement_order: number;
  amount_vnd: number;
  payment_method: 'bank_transfer' | 'cash' | 'other';
  payment_date: string; // YYYY-MM-DD
  reference_note?: string | null;
  created_at?: string;
}

export interface ConfirmedPayData {
  approved_worked_seconds: number;
  approved_worked_minutes: number;
  base_pay_vnd: number;
  paid_leave_pay_vnd: number;
  allowance_vnd?: number | undefined;
  bonus_vnd?: number | undefined;
  deduction_vnd?: number | undefined;
  net_pay_vnd: number;
  paid_amount_vnd: number;
  remaining_balance_vnd?: number | undefined;
  payment_status: 'unpaid' | 'partially_paid' | 'paid';
}

export interface PendingReviewPayData {
  shift_count: number;
  pending_seconds: number;
  pending_minutes: number;
  estimated_pay_vnd: number;
}

export interface LiveProvisionalPayData {
  has_open_shift: boolean;
  current_shift_id?: string | null;
  working_state?: 'working' | 'paused' | null;
  live_seconds: number;
  live_minutes: number;
  live_pay_vnd: number;
}

export interface PayrollEmployeeItemData {
  id?: string | null | undefined;
  version?: number | undefined;
  employee_id: string;
  employee_code: string;
  full_name: string;
  phone?: string | null | undefined;
  position_title?: string | null | undefined;
  bank_name?: string | null | undefined;
  bank_account_number?: string | null | undefined;
  bank_account_holder?: string | null | undefined;
  /**
   * Hourly rate effective at server_as_of, or null if not configured.
   * Does NOT represent the rate of the entire period; past shifts use their snapshot rate.
   * Finalized breakdown/snapshot is NOT recalculated based on this current rate.
   */
  hourly_rate_vnd: number | null;
  confirmed: ConfirmedPayData;
  pending_review: PendingReviewPayData;
  live_provisional: LiveProvisionalPayData;
  daily_breakdowns?: PayrollDailyBreakdownData[] | undefined;
  adjustments?: PayrollAdjustmentData[] | undefined;
  paid_leaves?: PayrollAdjustmentData[] | undefined;
  disbursements?: PayrollDisbursementData[] | undefined;
}

export interface CreateAdjustmentRequest {
  employee_id: string;
  adjustment_type: PayrollAdjustmentType;
  amount_vnd: number;
  attributable_date?: string | null | undefined; // YYYY-MM-DD (mandatory for paid_leave)
  reason: string;
}

export interface CreateDisbursementRequest {
  amount_vnd: number;
  payment_method: 'bank_transfer' | 'cash' | 'other';
  payment_date: string; // YYYY-MM-DD
  reference_note?: string | null | undefined;
}

export interface PayrollMonthOverviewData {
  period: PayrollPeriodData;
  server_as_of: string;
  items: PayrollEmployeeItemData[];
}

export interface StaffPayslipData {
  period_month: string;
  status: 'draft' | 'finalized';
  server_as_of: string;
  employee: {
    id: string;
    employee_code: string;
    full_name: string;
  };
  /**
   * Hourly rate effective at server_as_of, or null if not configured.
   * Does NOT represent the rate of the entire period; past shifts use their snapshot rate.
   * Finalized breakdown/snapshot is NOT recalculated based on this current rate.
   */
  hourly_rate_vnd: number | null;
  confirmed: ConfirmedPayData;
  pending_review: PendingReviewPayData;
  live_provisional: LiveProvisionalPayData;
  daily_breakdowns: PayrollDailyBreakdownData[];
  adjustments?: PayrollAdjustmentData[] | undefined;
  paid_leaves?: PayrollAdjustmentData[] | undefined;
  disbursements: PayrollDisbursementData[];
}
