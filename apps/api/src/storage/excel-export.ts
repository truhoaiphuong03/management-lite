import type { PoolClient } from 'pg';
import { buildXlsx, type XCell, type XSheet } from '../payroll/xlsx.js';

export interface WorkspaceExcelExportResult {
  buffer: Buffer;
  sheets: {
    employees: number;
    attendance: number;
    payroll: number;
    finance: number;
  };
}

function headerRow(labels: string[]): XCell[] {
  return labels.map((v) => ({ v, style: 'bold' as const }));
}

function formatRoleLabel(role: string | null | undefined): string {
  if (role === 'owner') return 'Chủ cơ sở (Owner)';
  if (role === 'manager') return 'Quản lý';
  return 'Nhân viên';
}

function formatStatusLabel(status: string | null | undefined): string {
  if (status === 'active') return 'Đang làm việc';
  if (status === 'suspended' || status === 'disabled') return 'Tạm ngưng';
  if (status === 'revoked' || status === 'inactive') return 'Đã nghỉ việc';
  return status || 'Đang làm việc';
}

function formatRunStateLabel(state: string | null | undefined): string {
  if (state === 'completed') return 'Hoàn thành';
  if (state === 'working') return 'Đang làm việc';
  if (state === 'paused') return 'Đang nghỉ giữa ca';
  return state || '';
}

function formatReviewStateLabel(state: string | null | undefined): string {
  if (state === 'approved') return 'Đã duyệt';
  if (state === 'rejected') return 'Từ chối';
  if (state === 'needs_review') return 'Cần kiểm tra';
  if (state === 'unreviewed') return 'Chờ duyệt';
  return state || '';
}

export async function buildWorkspaceFourSheetExcel(
  c: PoolClient,
  workspaceId: string,
): Promise<WorkspaceExcelExportResult> {
  // 1. Sheet: Nhân viên (Employees)
  const empRes = await c.query<{
    employee_code: string;
    full_name: string;
    role: string | null;
    job_title: string | null;
    phone: string | null;
    email: string | null;
    date_of_birth: string | null;
    bank_name: string | null;
    bank_account_number: string | null;
    bank_account_holder: string | null;
    payroll_calculation_enabled: boolean | null;
    status: string | null;
    created_at_vn: string | null;
  }>(
    `SELECT
       e.employee_code,
       e.full_name,
       COALESCE(m.role::text, to_jsonb(e) ->> 'sub_role', 'staff') AS role,
       to_jsonb(e) ->> 'position_title' AS job_title,
       to_jsonb(e) ->> 'phone' AS phone,
       COALESCE(to_jsonb(e) ->> 'google_email', u.email_normalized) AS email,
       to_jsonb(e) ->> 'date_of_birth' AS date_of_birth,
       to_jsonb(e) ->> 'bank_name' AS bank_name,
       to_jsonb(e) ->> 'bank_account_number' AS bank_account_number,
       to_jsonb(e) ->> 'bank_account_holder' AS bank_account_holder,
       e.is_payroll_eligible AS payroll_calculation_enabled,
       COALESCE(e.employment_status::text, m.status::text, 'active') AS status,
       to_char(e.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI') AS created_at_vn
     FROM employees e
     LEFT JOIN users u ON u.id = e.user_id
     LEFT JOIN workspace_memberships m
       ON m.workspace_id = e.workspace_id AND m.user_id = e.user_id
     WHERE e.workspace_id = $1
     ORDER BY e.employee_code ASC`,
    [workspaceId],
  );

  const employeeRows: XCell[][] = [
    headerRow([
      'Mã NV',
      'Họ và tên',
      'Vai trò',
      'Chức danh',
      'Số điện thoại',
      'Email',
      'Ngày sinh',
      'Ngân hàng',
      'Số tài khoản',
      'Chủ tài khoản',
      'Tính lương theo giờ',
      'Trạng thái',
      'Ngày tạo (VN)',
    ]),
    ...empRes.rows.map((r): XCell[] => [
      { v: r.employee_code || '' },
      { v: r.full_name || '' },
      { v: formatRoleLabel(r.role) },
      { v: r.job_title || '' },
      { v: r.phone || '' },
      { v: r.email || '' },
      { v: r.date_of_birth || '' },
      { v: r.bank_name || '' },
      { v: r.bank_account_number || '' },
      { v: r.bank_account_holder || '' },
      { v: r.payroll_calculation_enabled !== false ? 'Có' : 'Không' },
      { v: formatStatusLabel(r.status) },
      { v: r.created_at_vn || '' },
    ]),
  ];

  // 2. Sheet: Chấm công (Attendance)
  const attRes = await c.query<{
    employee_code: string;
    employee_name: string;
    shift_date_vn: string;
    clock_in_vn: string;
    clock_out_vn: string;
    worked_seconds: number;
    run_state: string;
    review_state: string;
    approval_reason: string;
  }>(
    `SELECT
       e.employee_code,
       e.full_name AS employee_name,
       to_char(s.clock_in_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS shift_date_vn,
       to_char(s.clock_in_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS') AS clock_in_vn,
       CASE WHEN s.clock_out_at IS NOT NULL
         THEN to_char(s.clock_out_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS')
         ELSE ''
       END AS clock_out_vn,
       GREATEST(
         0,
         COALESCE(
           EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, now()) - s.clock_in_at)),
           0
         ) - COALESCE(b.break_seconds, 0)
       )::float8 AS worked_seconds,
       s.run_state::text AS run_state,
       s.review_state::text AS review_state,
       COALESCE(s.approval_reason, '') AS approval_reason
     FROM attendance_shifts s
     JOIN employees e ON e.workspace_id = s.workspace_id AND e.id = s.employee_id
     LEFT JOIN (
       SELECT shift_id,
              SUM(EXTRACT(EPOCH FROM (ended_at - started_at))) AS break_seconds
       FROM attendance_breaks
       WHERE workspace_id = $1 AND ended_at IS NOT NULL
       GROUP BY shift_id
     ) b ON b.shift_id = s.id
     WHERE s.workspace_id = $1
     ORDER BY s.clock_in_at DESC
     LIMIT 3000`,
    [workspaceId],
  );

  const attendanceRows: XCell[][] = [
    headerRow([
      'Ngày ca (VN)',
      'Mã NV',
      'Họ và tên',
      'Giờ vào ca (VN)',
      'Giờ ra ca (VN)',
      'Số phút công',
      'Số giờ công',
      'Trạng thái ca',
      'Trạng thái duyệt',
      'Ghi chú duyệt',
    ]),
    ...attRes.rows.map((r): XCell[] => {
      const secs = Math.max(0, Number(r.worked_seconds || 0));
      const mins = Math.floor(secs / 60);
      const hours = Number((secs / 3600).toFixed(2));
      return [
        { v: r.shift_date_vn || '' },
        { v: r.employee_code || '' },
        { v: r.employee_name || '' },
        { v: r.clock_in_vn || '' },
        { v: r.clock_out_vn || '' },
        { v: mins },
        { v: hours, style: 'num2' },
        { v: formatRunStateLabel(r.run_state) },
        { v: formatReviewStateLabel(r.review_state) },
        { v: r.approval_reason || '' },
      ];
    }),
  ];

  // 3. Sheet: Lương (Payroll)
  const payRes = await c.query<{
    period_month: string;
    period_status: string;
    employee_code: string;
    full_name: string;
    hourly_rate_vnd: string | number;
    approved_worked_minutes: number;
    base_pay_vnd: string | number;
    paid_leave_pay_vnd: string | number;
    net_pay_vnd: string | number;
    paid_amount_vnd: string | number;
    bank_name: string | null;
    bank_account_number: string | null;
    bank_account_holder: string | null;
  }>(
    `SELECT
       COALESCE(p.period_month, to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM')) AS period_month,
       COALESCE(p.status::text, 'draft') AS period_status,
       e.employee_code,
       e.full_name,
       COALESCE(r.hourly_rate_vnd, 0)::bigint AS hourly_rate_vnd,
       COALESCE(i.approved_worked_minutes, 0)::int AS approved_worked_minutes,
       COALESCE(i.base_pay_vnd, 0)::bigint AS base_pay_vnd,
       COALESCE(i.paid_leave_pay_vnd, 0)::bigint AS paid_leave_pay_vnd,
       COALESCE(i.net_pay_vnd, 0)::bigint AS net_pay_vnd,
       COALESCE(d.paid_amount_vnd, 0)::bigint AS paid_amount_vnd,
       to_jsonb(e) ->> 'bank_name' AS bank_name,
       to_jsonb(e) ->> 'bank_account_number' AS bank_account_number,
       to_jsonb(e) ->> 'bank_account_holder' AS bank_account_holder
     FROM employees e
     LEFT JOIN payroll_employee_items i
       ON i.workspace_id = e.workspace_id AND i.employee_id = e.id
     LEFT JOIN payroll_periods p
       ON p.workspace_id = i.workspace_id AND p.id = i.period_id
     LEFT JOIN LATERAL (
       SELECT hourly_rate_vnd
       FROM employee_hourly_rates hr
       WHERE hr.workspace_id = e.workspace_id AND hr.employee_id = e.id
       ORDER BY hr.effective_from DESC
       LIMIT 1
     ) r ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(amount_vnd), 0)::bigint AS paid_amount_vnd
       FROM payroll_disbursements pd
       WHERE pd.workspace_id = e.workspace_id AND pd.payroll_item_id = i.id
     ) d ON true
     WHERE e.workspace_id = $1
     ORDER BY period_month DESC, e.employee_code ASC`,
    [workspaceId],
  );

  const payrollRows: XCell[][] = [
    headerRow([
      'Kỳ lương (YYYY-MM)',
      'Trạng thái kỳ',
      'Mã NV',
      'Họ và tên',
      'Đơn giá giờ (VND)',
      'Số phút đã duyệt',
      'Số giờ đã duyệt',
      'Lương cơ bản (VND)',
      'Điều chỉnh / Phụ cấp (VND)',
      'Thực lĩnh (VND)',
      'Đã chi trả (VND)',
      'Còn lại (VND)',
      'Ngân hàng',
      'Số tài khoản',
      'Chủ tài khoản',
    ]),
    ...payRes.rows.map((r): XCell[] => {
      const mins = Number(r.approved_worked_minutes || 0);
      const hours = Number((mins / 60).toFixed(2));
      const rate = Number(r.hourly_rate_vnd || 0);
      const base = Number(r.base_pay_vnd || 0);
      const adj = Number(r.paid_leave_pay_vnd || 0);
      const net = Number(r.net_pay_vnd || 0);
      const paid = Number(r.paid_amount_vnd || 0);
      const remaining = Math.max(0, net - paid);
      return [
        { v: r.period_month || '' },
        {
          v:
            r.period_status === 'finalized'
              ? 'Đã chốt sổ'
              : 'Đang tạm tính (Draft)',
        },
        { v: r.employee_code || '' },
        { v: r.full_name || '' },
        { v: rate, style: 'money' },
        { v: mins },
        { v: hours, style: 'num2' },
        { v: base, style: 'money' },
        { v: adj, style: 'money' },
        { v: net, style: 'money' },
        { v: paid, style: 'money' },
        { v: remaining, style: 'money' },
        { v: r.bank_name || '' },
        { v: r.bank_account_number || '' },
        { v: r.bank_account_holder || '' },
      ];
    }),
  ];

  // 4. Sheet: Thu chi (Finance)
  const finRes = await c.query<{
    occurred_on: string;
    occurred_at_vn: string;
    direction: string;
    category_name_snapshot: string;
    amount_vnd: string | number;
    note: string | null;
    root_entry_id: string;
    revision_number: number;
  }>(
    `SELECT
       e.occurred_on::text AS occurred_on,
       to_char(e.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS') AS occurred_at_vn,
       e.direction::text AS direction,
       e.category_name_snapshot,
       e.amount_vnd::bigint AS amount_vnd,
       e.note,
       e.root_entry_id::text AS root_entry_id,
       e.revision_number
     FROM fin_entries e
     WHERE e.workspace_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM fin_entry_corrections x
         WHERE x.workspace_id = e.workspace_id
           AND x.owner_user_id = e.owner_user_id
           AND x.original_revision_id = e.id
       )
     ORDER BY e.occurred_on DESC, e.created_at DESC
     LIMIT 5000`,
    [workspaceId],
  );

  const financeRows: XCell[][] = [
    headerRow([
      'Ngày ghi sổ',
      'Thời điểm (VN)',
      'Loại giao dịch',
      'Danh mục',
      'Số tiền (VND)',
      'Ghi chú',
      'Mã phiếu gốc',
      'Phiên bản',
    ]),
    ...finRes.rows.map((r): XCell[] => [
      { v: r.occurred_on || '' },
      { v: r.occurred_at_vn || '' },
      { v: r.direction === 'income' ? 'Thu (+)' : 'Chi (-)' },
      { v: r.category_name_snapshot || '' },
      { v: Number(r.amount_vnd || 0), style: 'money' },
      { v: r.note || '' },
      { v: r.root_entry_id || '' },
      { v: Number(r.revision_number || 1) },
    ]),
  ];

  const sheets: XSheet[] = [
    {
      name: 'Nhân viên',
      rows: employeeRows,
      colWidths: [14, 24, 18, 18, 16, 26, 14, 18, 18, 22, 16, 16, 18],
    },
    {
      name: 'Chấm công',
      rows: attendanceRows,
      colWidths: [14, 14, 24, 20, 20, 14, 14, 18, 18, 28],
    },
    {
      name: 'Lương',
      rows: payrollRows,
      colWidths: [16, 18, 14, 24, 18, 16, 16, 18, 20, 18, 18, 18, 18, 18, 22],
    },
    {
      name: 'Thu chi',
      rows: financeRows,
      colWidths: [14, 20, 16, 24, 18, 32, 36, 12],
    },
  ];

  const buffer = buildXlsx(sheets);

  return {
    buffer,
    sheets: {
      employees: empRes.rows.length,
      attendance: attRes.rows.length,
      payroll: payRes.rows.length,
      finance: finRes.rows.length,
    },
  };
}
