import type { DatabasePool } from './pool.js';
import type pg from 'pg';

export interface AuditEventParams {
  workspaceId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEY_PATTERN =
  /password|secret|token|credential|key|auth|bearer/i;

/**
 * Recursively scrubs sensitive values from audit metadata.
 * Prohibits tokens, passwords, and secret material in audit trails per T3 and SEC-02.
 */
export function sanitizeAuditMetadata(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {};

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      sanitized[key] = sanitizeAuditMetadata(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        item !== null && typeof item === 'object'
          ? sanitizeAuditMetadata(item as Record<string, unknown>)
          : item,
      );
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Inserts an append-only audit event into audit_events.
 * Operates on either pool or client (allowing transaction atomicity with mutation).
 */
export async function recordAuditEvent(
  clientOrPool: DatabasePool | pg.PoolClient,
  params: AuditEventParams,
): Promise<{ id: string }> {
  const sanitizedMeta = sanitizeAuditMetadata(params.metadata);

  const res = await clientOrPool.query<{ id: string }>(
    `
    INSERT INTO audit_events (
      workspace_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      request_id,
      metadata_sanitized
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    RETURNING id;
  `,
    [
      params.workspaceId,
      params.actorUserId ?? null,
      params.action,
      params.entityType,
      params.entityId,
      params.requestId,
      JSON.stringify(sanitizedMeta),
    ],
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error('Failed to record audit event: no ID returned');
  }

  return { id: row.id };
}
