export type ShiftRunState = 'working' | 'paused' | 'completed';
export type ShiftReviewState =
  'unreviewed' | 'approved' | 'rejected' | 'needs_review';

export interface BreakData {
  id: string;
  started_at: string;
  ended_at: string | null;
  unpaid: boolean;
  duration_seconds: number;
}

export interface CorrectionRequestData {
  id: string;
  workspace_id: string;
  shift_id: string;
  requested_by_user_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  reason: string;
  claimed_clock_out_at: string | null;
  evidence_note: string | null;
  decision_reason: string | null;
  decided_by_user_id: string | null;
  decided_at: string | null;
  version: number;
  created_at: string;
}

export interface ShiftData {
  id: string;
  workspace_id: string;
  employee_id: string;
  employee_code?: string | undefined;
  employee_name?: string | undefined;
  shift_date?: string | undefined;
  clock_in_at: string;
  clock_out_at: string | null;
  run_state: ShiftRunState;
  review_state: ShiftReviewState;
  version: number;
  current_version_id?: string | null | undefined;
  breaks: BreakData[];
  worked_seconds: number;
  created_at: string;
  pending_correction?: CorrectionRequestData | null | undefined;
  review_reason?: string | null | undefined;
  reviewed_at?: string | null | undefined;
  reviewed_by_user_id?: string | null | undefined;
  is_self_shift?: boolean | undefined;
  is_payroll_eligible?: boolean | undefined;
}

export interface AttendanceMeResponseData {
  current_shift: ShiftData | null;
  recent_shifts: ShiftData[];
  total?: number | undefined;
}

export interface AttendanceShiftsResponseData {
  shifts: ShiftData[];
  total: number;
}

export interface ClockInRequestBody {
  employee_id?: string | undefined;
}

export interface ClockInResponseData {
  shift_id: string;
  run_state: ShiftRunState;
  clock_in_at: string;
  version: number;
}

export interface BreakResponseData {
  break_id: string;
  started_at: string;
  run_state: ShiftRunState;
  version: number;
}

export interface ResumeResponseData {
  ended_at: string;
  run_state: ShiftRunState;
  version: number;
}

export interface ClockOutResponseData {
  clock_out_at: string;
  run_state: ShiftRunState;
  shift_version_id: string;
  worked_seconds: number;
  version: number;
}

export interface ReviewShiftRequestBody {
  decision: 'approved' | 'rejected';
  reason?: string | undefined;
}

export interface ReviewShiftResponseData {
  shift_id: string;
  review_state: ShiftReviewState;
  reviewed_at: string;
}

export interface CreateCorrectionRequestBody {
  reason: string;
  claimed_clock_out_at?: string | undefined;
  evidence_note?: string | undefined;
}

export interface DecideCorrectionRequestBody {
  decision: 'accept' | 'reject';
  reason: string;
  clock_out_at?: string | undefined;
}

export interface ResetClockShiftsRequestBody {
  scope?: 'me_today' | 'workspace_clock' | undefined;
}

export interface ResetClockShiftsResponseData {
  reset_shifts_count: number;
  scope: 'me_today' | 'workspace_clock';
  reset_at: string;
}
