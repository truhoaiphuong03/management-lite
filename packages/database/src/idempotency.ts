import crypto from 'node:crypto';
import type { DatabasePool } from './pool.js';
import type pg from 'pg';

export interface IdempotencyClaimParams {
  workspaceId: string;
  actorUserId: string;
  operationKey: string;
  requestFingerprint: string;
  ttlHours?: number;
}

export type IdempotencyClaimResult =
  | { status: 'claimed' }
  | {
      status: 'replay';
      responseCode: number | null;
      sanitizedResponse: unknown;
    }
  | { status: 'in_progress'; error: string }
  | { status: 'mismatch'; error: string }
  | { status: 'failed_retryable' };

/**
 * Computes deterministic request fingerprint from canonical JSON payload.
 * Sensitive fields (password, secret, token) must not be included.
 */
export function computeRequestFingerprint(
  method: string,
  route: string,
  sanitizedBody: unknown,
): string {
  const content = JSON.stringify({
    method: method.toUpperCase(),
    route: route.toLowerCase(),
    body: sanitizedBody ?? null,
  });
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Claims an idempotency key atomically under PostgreSQL UNIQUE constraint.
 */
export async function claimIdempotency(
  clientOrPool: DatabasePool | pg.PoolClient,
  params: IdempotencyClaimParams,
): Promise<IdempotencyClaimResult> {
  const ttlHours =
    params.ttlHours && params.ttlHours > 0 ? params.ttlHours : 24;

  // 1. Try to claim atomically
  const insertRes = await clientOrPool.query<{ id: string }>(
    `
    INSERT INTO idempotency_records (
      workspace_id,
      actor_user_id,
      operation_key,
      request_fingerprint,
      state,
      expires_at
    )
    VALUES ($1, $2, $3, $4, 'claimed', now() + ($5 || ' hours')::interval)
    ON CONFLICT (workspace_id, actor_user_id, operation_key) DO NOTHING
    RETURNING id;
  `,
    [
      params.workspaceId,
      params.actorUserId,
      params.operationKey,
      params.requestFingerprint,
      ttlHours.toString(),
    ],
  );

  if (insertRes.rows.length > 0) {
    return { status: 'claimed' };
  }

  // 2. Conflict detected - check existing record
  const existingRes = await clientOrPool.query<{
    state: 'claimed' | 'completed' | 'failed';
    request_fingerprint: string;
    response_code: number | null;
    sanitized_response: unknown;
    expires_at: Date;
  }>(
    `
    SELECT state, request_fingerprint, response_code, sanitized_response, expires_at
    FROM idempotency_records
    WHERE workspace_id = $1 AND actor_user_id = $2 AND operation_key = $3;
  `,
    [params.workspaceId, params.actorUserId, params.operationKey],
  );

  const existing = existingRes.rows[0];
  if (!existing) {
    // Highly unlikely race condition (deleted between insert and select)
    return { status: 'claimed' };
  }

  // T1: Check payload fingerprint mismatch -> 409 IDEMPOTENCY_CONFLICT
  if (existing.request_fingerprint !== params.requestFingerprint) {
    return {
      status: 'mismatch',
      error:
        'IDEMPOTENCY_CONFLICT: Idempotency-Key already used with different request parameters',
    };
  }

  // Same key + same fingerprint
  if (existing.state === 'completed') {
    return {
      status: 'replay',
      responseCode: existing.response_code,
      sanitizedResponse: existing.sanitized_response,
    };
  }

  if (existing.state === 'claimed') {
    return {
      status: 'in_progress',
      error:
        'IDEMPOTENCY_IN_PROGRESS: Operation with this Idempotency-Key is currently in progress',
    };
  }

  // Failed state can be retried safely
  return { status: 'failed_retryable' };
}

/**
 * Marks an idempotency record as completed with cached response.
 */
export async function completeIdempotency(
  clientOrPool: DatabasePool | pg.PoolClient,
  params: {
    workspaceId: string;
    actorUserId: string;
    operationKey: string;
    responseCode: number;
    sanitizedResponse: unknown;
  },
): Promise<void> {
  await clientOrPool.query(
    `
    UPDATE idempotency_records
    SET state = 'completed',
        response_code = $1,
        sanitized_response = $2::jsonb
    WHERE workspace_id = $3 AND actor_user_id = $4 AND operation_key = $5;
  `,
    [
      params.responseCode,
      JSON.stringify(params.sanitizedResponse),
      params.workspaceId,
      params.actorUserId,
      params.operationKey,
    ],
  );
}

/**
 * Marks an idempotency record as failed so retry can be permitted.
 */
export async function failIdempotency(
  clientOrPool: DatabasePool | pg.PoolClient,
  params: {
    workspaceId: string;
    actorUserId: string;
    operationKey: string;
  },
): Promise<void> {
  await clientOrPool.query(
    `
    UPDATE idempotency_records
    SET state = 'failed'
    WHERE workspace_id = $1 AND actor_user_id = $2 AND operation_key = $3;
  `,
    [params.workspaceId, params.actorUserId, params.operationKey],
  );
}
