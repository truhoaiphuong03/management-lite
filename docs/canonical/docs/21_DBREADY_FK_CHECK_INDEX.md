# DB-READY — FK, constraints, index, invariants
All tenant-owned tables: FK(workspace_id)->workspaces(id); UNIQUE(workspace_id,id) for referenced parents; FK(workspace_id,parent_id)->parent(workspace_id,id) ON DELETE RESTRICT/NO ACTION. For multi-parent relationships, each FK carries workspace_id. `users` global; membership workspace FK anchors user. All FK names explicit and deterministic. Add deferred circular FK (`attendance_shifts.current_version_id`) only after version table and ensure current version belongs to same shift via composite unique (workspace_id,shift_id,id). Approvals require (workspace_id,shift_id,shift_version_id) composite linkage, not just version ID. Payroll lines require source approved version and rate within same workspace/employee; cross-parent semantic checks enforced transactionally with lock and DB guard where appropriate.

## Critical constraints
1. Shift: partial unique (workspace_id,employee_id) WHERE clock_out_at IS NULL; GiST exclusion on tstzrange(clock_in_at,clock_out_at,'[)') for closed shifts of same employee. Use btree_gist if extension approved; alternatively serialized guard + constraint strategy, never app-only read-before-write.
2. Break: partial unique open break per shift; exclusion tstzrange(started_at,ended_at,'[)') per shift for closed breaks; break bounded by shift; cannot clock out while paused.
3. Rates: exclusion same employee on tstzrange(effective_from,coalesce(effective_to,'infinity'),'[)'); no silent overwrite of historical rates.
4. Periods: exclusion daterange(starts_on,ends_on,'[)') by workspace; timezone_snapshot frozen on finalized period.
5. Employee positions: overlapping positions allowed when different positions; only overlapping PRIMARY position forbidden; interval date ranges [start,end).
6. Unique attendance approval per version; approvals append-only; only latest approved version usable for NEW draft payroll. Finalized payroll keeps its own original version snapshot even after correction.
7. Payroll calculation lines for one employee must be disjoint for actual paid seconds within a period; overlapping line intervals across payroll items/periods are detected transactionally against source shift version, with immutable finalized coverage ledger/constraint if needed. Unique keys alone do NOT prevent arbitrary overlapping ranges.
8. Finalized payroll period/items/lines: deny UPDATE/DELETE by DB guard; correction entries append-only; direct DB mutations prohibited.
9. Owner exclusion: `is_payroll_eligible=false` for Owner role enforced in service transaction and release-blocking integration tests. Do not pretend CHECK can enforce cross-table role.
10. Secret access: DB role permissions prevent application staff queries from selecting secret columns; application Owner auth enforced per request, reveal only after single-use reauth.

## Index registry
- IX_AUTH_SESSION_TOKEN: unique(session_token_hash), plus (workspace_id,user_id,revoked_at,absolute_expires_at).
- IX_INVITE_TOKEN: unique(token_hash), plus (workspace_id,user_id,status,expires_at).
- IX_EMAIL_QUEUE: (status,next_attempt_at,lease_until,id) for due work.
- IX_AUDIT_CURSOR: (workspace_id,created_at DESC,id DESC).
- IX_EMPLOYEE_CODE: unique(workspace_id,employee_code); IX_EMPLOYEE_USER: unique(workspace_id,user_id) WHERE user_id IS NOT NULL.
- IX_ATT_OPEN: unique(workspace_id,employee_id) WHERE clock_out_at IS NULL; IX_ATT_HISTORY: (workspace_id,employee_id,clock_in_at DESC,id DESC).
- IX_ATT_VERSION: unique(workspace_id,shift_id,version_number); IX_ATT_APPROVAL: unique(workspace_id,shift_version_id).
- IX_RATE_EFFECTIVE: GiST exclusion as above plus btree (workspace_id,employee_id,effective_from DESC).
- IX_PERIOD_RANGE: GiST exclusion as above; IX_PAY_ITEM: unique(workspace_id,period_id,employee_id).
- IX_PAY_LINES_SOURCE: (workspace_id,approved_shift_version_id,segment_start_at,segment_end_at).
- IX_REPORT_DAY: unique(workspace_id,employee_id,report_date); IX_REPORT_REV: unique(workspace_id,report_id,revision_number).
- IX_ACC_CONTACT: unique(workspace_id,type,normalized_value); IX_ACC_SECRET: unique(workspace_id,account_id,secret_type).
- IX_IDEMPOTENCY: unique(workspace_id,actor_user_id,operation_key), expiry cleanup index.

## Guards, race safety and semantics
- Explicit transaction locks around clock-in, pause/resume, approval, payroll calculation/finalization, invitation replacement and secret reauth consumption.
- Optimistic version (`If-Match`) plus idempotency key on mutations; 412 stale version; 409 business conflict.
- Event history immutable; mutable aggregate row points at immutable latest version.
- RESTRICT delete for identity/business rows referenced by attendance, payroll, audit; archive/suspend instead. No cascading deletes of financial evidence.
- `timestamptz` instants UTC; local midnight boundaries calculated with pinned IANA timezone; daylight-saving cases tested even though default is Asia/Ho_Chi_Minh.
- Integer multiplication may overflow bigint for pathological input; use NUMERIC(38,0) / arbitrary precision for sum of numerator seconds×VND, then half-up once per employee-period: floor((sum_numerator+1800)/3600) for nonnegative numerator.
