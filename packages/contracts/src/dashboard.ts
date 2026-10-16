export interface DashboardShiftSummary {
  current_shift: {
    id: string;
    run_state: 'working' | 'paused' | 'completed';
    clock_in_at: string;
  } | null;
  recent_shifts_count: number;
  completed_shifts_count: number;
  total_worked_seconds: number;
}

export interface DashboardReportSummary {
  today_report: {
    id: string;
    report_date: string;
    status: 'draft' | 'submitted';
    entries_count: number;
    total_reported_count: number;
  } | null;
  total_reports_count: number;
}

export interface DashboardEmployeesSummary {
  total_count: number;
  active_count: number;
  invited_count: number;
}

export interface DashboardPayrollSummary {
  period_month: string;
  status: 'draft' | 'finalized';
  employee_count: number;
  has_period_record: boolean;
}

export interface DashboardSummaryResponseData {
  shift: DashboardShiftSummary;
  report: DashboardReportSummary;
  employees: DashboardEmployeesSummary | null;
  payroll: DashboardPayrollSummary | null;
}
