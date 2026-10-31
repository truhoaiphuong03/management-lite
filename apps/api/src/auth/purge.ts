/**
 * Housekeeping for rows that only grow: dead auth sessions, spent re-auth proofs and
 * expired idempotency records. Everything deleted here is already unusable (expired or
 * revoked at least a grace period ago), so removal never changes behaviour.
 */
export interface PurgeQueryable {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rowCount?: number | null }>;
}

export async function purgeExpiredAuthRecords(
  db: PurgeQueryable,
): Promise<number> {
  // Proofs hold a RESTRICT foreign key on auth_sessions, so clear the spent ones first.
  const proofs = await db.query(
    `DELETE FROM account_reauth_proofs WHERE expires_at < now() - interval '1 day'`,
  );
  const sessions = await db.query(
    `DELETE FROM auth_sessions s
     WHERE (
       s.absolute_expires_at < now() - interval '7 days'
       OR s.idle_expires_at < now() - interval '7 days'
       OR s.revoked_at < now() - interval '7 days'
     )
     AND NOT EXISTS (
       SELECT 1 FROM account_reauth_proofs p WHERE p.session_id = s.id
     )`,
  );
  const idempotency = await db.query(
    `DELETE FROM idempotency_records WHERE expires_at < now() - interval '1 day'`,
  );
  return (
    (proofs.rowCount ?? 0) +
    (sessions.rowCount ?? 0) +
    (idempotency.rowCount ?? 0)
  );
}
