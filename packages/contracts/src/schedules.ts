/**
 * @management-lite/contracts - schedules
 * Types and DTOs for Staff Schedule Registration & Revision (SCHEDULE-01 R09)
 */

export interface ScheduleEntryData {
  id?: string;
  schedule_id?: string;
  work_date: string; // YYYY-MM-DD
  day_of_week: number; // 1 = Monday, ..., 7 = Sunday
  start_time: string; // HH:MM (00:00 - 23:59)
  notes?: string | null;
}

export interface ScheduleRevisionSnapshot {
  entries: {
    work_date: string;
    day_of_week: number;
    start_time: string;
    notes?: string | null;
  }[];
}

export interface ScheduleRevisionData {
  id: string;
  schedule_id: string;
  revision_number: number;
  snapshot: ScheduleRevisionSnapshot;
  reason?: string | null;
  edited_by: string;
  edited_by_name?: string;
  edited_at: string;
}

export interface ScheduleData {
  id: string;
  workspace_id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  week_start_date: string; // YYYY-MM-DD (Monday)
  week_end_date: string; // YYYY-MM-DD (Sunday)
  timezone: string;
  status: 'registered' | 'cancelled';
  current_revision: number;
  version: number;
  entries: ScheduleEntryData[];
  revisions?: ScheduleRevisionData[];
  created_at: string;
  updated_at: string;
}

export interface CreateScheduleEntryInput {
  work_date: string;
  day_of_week: number;
  start_time: string;
  notes?: string;
}

export interface CreateScheduleRequest {
  week_start_date: string;
  entries: CreateScheduleEntryInput[];
}

export interface UpdateScheduleRequest {
  entries: CreateScheduleEntryInput[];
  reason?: string | null;
}

export interface ScheduleDetailResponseData {
  schedule: ScheduleData;
  entries: ScheduleEntryData[];
  revisions: ScheduleRevisionData[];
}

export interface ScheduleListResponseData {
  items: ScheduleData[];
  week_start_date: string;
  week_end_date: string;
}
