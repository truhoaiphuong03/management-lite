export type ReportStatus = 'draft' | 'submitted';

export interface ReportEntryData {
  id?: string | undefined;
  work_type: string;
  reported_count: number;
  notes?: string | null | undefined;
  sort_order?: number | undefined;
}

export interface ReportRevisionSnapshot {
  entries: Array<{
    work_type: string;
    reported_count: number;
    notes?: string | null | undefined;
  }>;
  notes?: string | null | undefined;
}

export interface ReportRevisionData {
  id: string;
  report_id: string;
  revision_number: number;
  status: ReportStatus;
  snapshot: ReportRevisionSnapshot;
  reason: string | null;
  edited_by: string;
  edited_by_name?: string | null | undefined;
  edited_at: string;
}

export interface DailyReportData {
  id: string;
  workspace_id: string;
  employee_id: string;
  employee_name?: string | null | undefined;
  report_date: string;
  status: ReportStatus;
  current_revision: number;
  version: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  entries: ReportEntryData[];
  latest_revision?: ReportRevisionData | null | undefined;
}

export interface DailyReportListItem {
  id: string;
  workspace_id: string;
  employee_id: string;
  employee_name?: string | null | undefined;
  report_date: string;
  status: ReportStatus;
  current_revision: number;
  version: number;
  notes: string | null;
  entries_count: number;
  total_reported_count: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

export interface CreateReportRequestBody {
  report_date: string;
  entries: Array<{
    work_type: string;
    reported_count: number;
    notes?: string | null | undefined;
  }>;
  notes?: string | null | undefined;
}

export interface UpdateReportRequestBody {
  entries: Array<{
    work_type: string;
    reported_count: number;
    notes?: string | null | undefined;
  }>;
  notes?: string | null | undefined;
}

export interface ReviseReportRequestBody {
  entries: Array<{
    work_type: string;
    reported_count: number;
    notes?: string | null | undefined;
  }>;
  notes?: string | null | undefined;
  reason?: string | null | undefined;
}

export interface SubmitReportResponseData {
  report_id: string;
  revision_id: string;
  revision_number: number;
  status: 'submitted';
  submitted_at: string;
  version: number;
}

export interface ReviseReportResponseData {
  report_id: string;
  revision_id: string;
  revision_number: number;
  status: 'submitted';
  submitted_at: string;
  version: number;
}

export interface ListReportsResponseData {
  items: DailyReportListItem[];
  next_cursor: string | null;
}

export interface ReportDetailResponseData extends DailyReportData {
  revisions: ReportRevisionData[];
}
