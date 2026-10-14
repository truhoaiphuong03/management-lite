/**
 * @management-lite/contracts - work
 * Types and DTOs for Work Management (WORK-01 V0.2)
 * Standardized to lifecycle: todo | in_progress | in_review | completed
 * Scope locked via SCOPE-EXT-03-WORK-01
 */

export type WorkPriority = 'low' | 'medium' | 'high' | 'urgent';

export type WorkType = 'general' | 'content' | 'video' | 'design' | 'other';

export type WorkAssignmentStatus =
  'todo' | 'in_progress' | 'in_review' | 'completed';

export type WorkItemStatus =
  'todo' | 'in_progress' | 'in_review' | 'completed' | 'cancelled';

export type WorkReviewDecision = 'approved' | 'request_changes';

export interface WorkSubmissionAttachment {
  name: string;
  url: string;
}

export interface WorkSubmissionData {
  id: string;
  workspace_id: string;
  work_item_id: string;
  assignment_id: string;
  revision_number: number;
  submission_note: string;
  attachments?: WorkSubmissionAttachment[] | undefined;
  submitted_by: string;
  submitted_by_name?: string | undefined;
  submitted_at: string; // ISO 8601 UTC
}

export interface WorkReviewData {
  id: string;
  workspace_id: string;
  work_item_id: string;
  assignment_id: string;
  submission_id?: string | null | undefined;
  reviewer_user_id: string;
  reviewer_name?: string | undefined;
  decision: WorkReviewDecision;
  feedback?: string | null | undefined;
  reviewed_at: string; // ISO 8601 UTC
}

export interface WorkAssignmentData {
  id: string;
  workspace_id: string;
  work_item_id: string;
  employee_id: string;
  employee_code?: string | undefined;
  full_name?: string | undefined;
  stage: string;
  status: WorkAssignmentStatus;
  assigned_by?: string | undefined;
  assigned_at: string; // ISO 8601 UTC
  submissions?: WorkSubmissionData[] | undefined;
  schedule_links?:
    | Array<{
        schedule_id: string;
        work_date: string;
        start_time: string;
        status: string;
      }>
    | undefined;
  latest_review?: WorkReviewData | null | undefined;
}

export interface WorkItemData {
  id: string;
  workspace_id: string;
  title: string;
  description?: string | null | undefined;
  work_type: WorkType;
  status: WorkItemStatus;
  priority: WorkPriority;
  due_at?: string | null | undefined; // ISO 8601 UTC
  created_by: string;
  created_by_name?: string | undefined;
  version: number;
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
  assignments?: WorkAssignmentData[] | undefined;
}

export interface CreateWorkItemRequest {
  title: string;
  description?: string | undefined;
  work_type?: WorkType | undefined;
  priority?: WorkPriority | undefined;
  due_at?: string | null | undefined;
  assignee_ids?: string[] | undefined;
}

export interface UpdateWorkItemRequest {
  title?: string | undefined;
  description?: string | null | undefined;
  work_type?: WorkType | undefined;
  priority?: WorkPriority | undefined;
  due_at?: string | null | undefined;
  status?: WorkItemStatus | undefined;
}

export interface AssignWorkItemRequest {
  employee_ids: string[];
  stage?: string | undefined;
}

export interface StartWorkRequest {
  note?: string | undefined;
}

export interface SubmitWorkRequest {
  submission_note: string;
  attachments?: WorkSubmissionAttachment[] | undefined;
}

export interface ReviewWorkRequest {
  submission_id: string;
  decision: WorkReviewDecision;
  feedback?: string | undefined;
}

export interface CancelWorkItemRequest {
  reason?: string | undefined;
}

export interface UpdateAssignmentStatusRequest {
  status: WorkAssignmentStatus;
}

export interface WorkItemListResponse {
  items: WorkItemData[];
  total: number;
}
