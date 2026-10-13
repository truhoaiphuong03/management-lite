export type IssueType = 'bug' | 'improvement';

export type IssueStatus =
  | 'open'
  | 'analyzing'
  | 'fixing'
  | 'testing'
  | 'deploying'
  | 'verifying'
  | 'fixed'
  | 'reopened'
  | 'waiting_for_owner'
  | 'awaiting_owner'
  | 'closed';

export type IssueSeverity = 'P0' | 'P1' | 'P2' | 'P3';

export type IssueTestResult = 'pending' | 'passed' | 'failed' | 'manual';

export type IssueActivityAction =
  | 'created'
  | 'edited'
  | 'status_changed'
  | 'fix_confirmed'
  | 'reopened'
  | 'gemini_analyzed'
  | 'pr_linked'
  | 'deploy_linked'
  | 'test_verified'
  | 'marked_fixed'
  | 'waiting_owner';

export interface GeminiAnalysisResult {
  analyzed_at?: string;
  model?: string;
  summary?: string;
  root_cause?: string;
  affected_files?: string[];
  suggested_fix?: string;
  severity?: IssueSeverity;
  can_auto_verify?: boolean;
  suggested_tests?: string[];
  error?: string;
  [key: string]: unknown;
}

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
  bug_code?: string | undefined;
  severity?: IssueSeverity | undefined;
  gemini_analysis?: GeminiAnalysisResult | undefined;
  github_issue_number?: number | null | undefined;
  github_issue_url?: string | null | undefined;
  pr_number?: number | null | undefined;
  deploy_sha?: string | null | undefined;
  test_result?: IssueTestResult | null | undefined;
  reopen_count?: number | undefined;
  metadata_context?: Record<string, unknown> | undefined;
  screenshot_url?: string | null | undefined;
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
  severity?: IssueSeverity | undefined;
  screenshot_url?: string | undefined;
  metadata_context?: Record<string, unknown> | undefined;
}

export interface CreateReportRequest {
  title?: string | undefined;
  description: string;
  route_template?: string | undefined;
  module_name?: string | undefined;
  severity?: IssueSeverity | undefined;
  screenshot_url?: string | undefined;
  metadata_context?:
    | {
        url?: string;
        release_sha?: string;
        error_id?: string;
        request_id?: string;
        user_agent?: string;
        client_timestamp?: string;
        [key: string]: unknown;
      }
    | undefined;
}

export interface UpdateIssueRequest {
  title?: string | undefined;
  description?: string | undefined;
  type?: IssueType | undefined;
  status?: IssueStatus | undefined;
  severity?: IssueSeverity | undefined;
  github_issue_number?: number | null | undefined;
  github_issue_url?: string | null | undefined;
  pr_number?: number | null | undefined;
  deploy_sha?: string | null | undefined;
  test_result?: IssueTestResult | null | undefined;
  reason?: string | undefined;
}

export interface ConfirmFixRequest {
  comment?: string | undefined;
}

export interface ReopenIssueRequest {
  reason: string;
}

export interface VerifyIssueRequest {
  commit_sha: string;
  test_result: IssueTestResult;
  test_output?: string | undefined;
  verified_by?: string | undefined;
}

export interface AnalyzeIssueResponseData {
  issue: IssueData;
  analysis: GeminiAnalysisResult;
}

export interface IssueGroupCounts {
  all: number;
  open: number;
  in_progress: number;
  awaiting_owner: number;
  closed: number;
}

export interface ListIssuesQuery {
  status?:
    IssueStatus | 'active' | 'archived' | 'in_progress' | 'new' | undefined;
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
