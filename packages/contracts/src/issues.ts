export type IssueType = 'bug' | 'improvement';

export type IssueStatus =
  | 'open'
  | 'analyzing'
  | 'fixing'
  | 'awaiting_owner'
  | 'closed';

export type IssueActivityAction =
  | 'created'
  | 'edited'
  | 'status_changed'
  | 'fix_confirmed'
  | 'reopened';

export interface IssueData {
  id: string;
  workspace_id: string;
  reporter_user_id: string;
  reporter_name?: string | undefined;
  type: IssueType;
  title: string;
  description: string;
  route_template: string;
  status: IssueStatus;
  version: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface IssueActivityData {
  id: string;
  workspace_id: string;
  issue_id: string;
  actor_user_id: string;
  actor_name?: string | undefined;
  action: IssueActivityAction;
  metadata_sanitized: Record<string, unknown>;
  created_at: string;
}

export interface CreateIssueRequest {
  type: IssueType;
  title: string;
  description: string;
  route_template: string;
}

export interface CreateReportRequest {
  title?: string | undefined;
  description: string;
  route_template?: string | undefined;
  module_name?: string | undefined;
}

export interface UpdateIssueRequest {
  title?: string | undefined;
  description?: string | undefined;
  type?: IssueType | undefined;
  status?: IssueStatus | undefined;
  reason?: string | undefined;
}

export interface ConfirmFixRequest {
  comment?: string | undefined;
}

export interface ReopenIssueRequest {
  reason: string;
}

export interface IssueGroupCounts {
  all: number;
  open: number;
  in_progress: number;
  awaiting_owner: number;
  closed: number;
}

export interface ListIssuesQuery {
  status?: IssueStatus | 'active' | 'archived' | 'in_progress' | 'new' | undefined;
  type?: IssueType | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface ListIssuesResponseData {
  items: IssueData[];
  next_cursor: string | null;
  has_more: boolean;
  counts?: IssueGroupCounts | undefined;
}

export interface IssueDetailResponseData {
  issue: IssueData;
  activities: IssueActivityData[];
}
