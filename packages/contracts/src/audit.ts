export interface AuditEventData {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  actor_username: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  request_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ListAuditEventsQuery {
  limit?: number | undefined;
  cursor?: string | undefined;
  action?: string | undefined;
  entity_type?: string | undefined;
}

export interface ListAuditEventsResponseData {
  items: AuditEventData[];
  next_cursor: string | null;
  total_count?: number;
}
