# DOC-02 — Schema, FK and immutable snapshots
Design contract, not executable SQL. PostgreSQL source of truth.

## Required tables and essential fields
- attendance_shift_versions: id UUID PK; workspace_id; shift_id; version_number integer >0; clock_in_at timestamptz; clock_out_at timestamptz nullable; breaks_snapshot jsonb with validated canonical intervals; worked_seconds bigint >=0; snapshot_hash; created_by; created_at; reason. UNIQUE(workspace_id,shift_id,version_number); immutable after insertion.
- attendance_approvals: id; workspace_id; shift_id; shift_version_id; reviewer_user_id; decision approved/rejected; reviewed_at; reason; UNIQUE(workspace_id,shift_version_id) for terminal decision. FK (workspace_id,shift_version_id) -> attendance_shift_versions; reviewer cannot equal subject user via transactional guard.
- attendance_adjustments: id; workspace_id; shift_id; from_version_id; to_version_id; actor_user_id; reason; created_at. Append-only; correction after payroll finalization does not rewrite settled snapshot.
- payroll_calculation_lines: id; workspace_id; payroll_item_id; approved_shift_version_id; pay_rate_id; segment_start_at; segment_end_at; worked_seconds; hourly_rate_vnd_snapshot; numerator_vnd_seconds; timezone_snapshot. All interval boundaries are half-open [start,end); segment_end_at > segment_start_at; seconds exact; immutable when finalized.
- payroll_correction_entries: id; workspace_id; original_payroll_item_id; affected_employee_id; amount_vnd signed bigint; reason; evidence_reference; created_by; created_at; posting_period_id nullable; status; append-only; immutable original payroll item. Posting/disbursement of post-finalization corrections requires separate policy; no assumed payment.
- payroll_periods: timezone_snapshot; calculation_revision; finalized_snapshot_hash; finalized_by; finalized_at; status draft/finalized; business date range half-open [starts_on,ends_on).
- pay_rates: employee_id; effective_from/effective_to timestamptz; hourly_rate_vnd bigint >=0; exclusion overlap per employee/workspace; history retained. Zero rate is valid technical representation, not assumed compensation policy.
- idempotency_records: workspace_id; actor_user_id; operation_key; request_fingerprint; response/status; created_at; expires_at; unique(workspace_id,actor_user_id,operation_key). Concurrent request claiming must be atomic.
- activation_invites: hashed token, token version, expires_at, consumed_at, revoked_at; only one current usable invite per user/workspace; no raw link persisted in audit.
- resource_access_grants: replace unchecked resource_type/resource_id polymorphic reference with typed FK tables for actual V0.1 resource types, or a DB-validated resource registry. Explicitly reject dangling grants.

## FK and delete policy
All workspace children use FK (workspace_id,parent_id) to parent UNIQUE(workspace_id,id). Employee.user_id refers to users.id AND matching workspace_memberships(workspace_id,user_id). Parent rows referenced by finance/audit/history are RESTRICT/NO ACTION; use archive/suspend rather than cascade. Secret ciphertext is never returned in list/detail projections.

## Constraints and indexes
- One open shift per employee (partial unique index); one open break per shift; no overlapping closed shifts/breaks per employee/shift using exclusion ranges, where practical.
- Nonoverlap of effective pay rate intervals and payroll business-date periods within workspace; nonoverlap primary position intervals.
- Unique (workspace_id,period_id,employee_id) payroll item; finalized rows immutable by DB enforcement and application checks.
- Unique approval per immutable shift version; stale approvals cannot be reused after correction.
- Index workspace_id + created_at/id for cursor paging; work assignment by employee/status; outbox by status/next_attempt_at.

## Deterministic payroll algorithm
1. Read eligible non-Owner employees and approved completed shift versions under consistent transaction snapshot.
2. Form canonical worked intervals: shift [in,out) minus union of unpaid breaks; reject overlap/inconsistency.
3. Split at workspace-local midnights and pay-rate effective instants; freeze timezone identifier and rate snapshots.
4. Intersect with payroll period local-date boundaries; verify each second assigned at most once.
5. Sum exact numerator Σ(worked_seconds * hourly_rate_vnd) using arbitrary-precision integers; base_pay_vnd = floor((numerator + 1800)/3600) for nonnegative numerator (half-up once per employee/period).
6. Apply integer VND bonus/allowance/advance/deduction entries; do not assume handling of negative net pay.
7. Persist lines and hash in draft; finalize only if versions/rates/eligibility unchanged and no unresolved errors. Finalized snapshot immutable.

## Temporal example
22:00 local Oct 31 to 02:00 local Nov 1 => 2h Oct and 2h Nov (less any breaks). Rate changes at 00:30 => split again. Timezone history must not be retroactively reinterpreted.
