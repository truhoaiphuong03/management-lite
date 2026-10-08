# DB-READY — Dependency DAG and migration acceptance
DESIGN ONLY. No executable SQL or migration run. Actual filenames/versions assigned on implementation. Use additive-first, checksum, transactional migrations where supported, backup before risky changes, no destructive rollback.

M00 PostgreSQL extensions (btree_gist only if exclusion constraints chosen and authorized).
M01 workspaces + users + global audit/idempotency primitives (audit tenant FK after workspace).
M02 workspace_memberships + user_credentials + auth_sessions + activation_invites + email_outbox + email_delivery_attempts.
M03 employees + job_positions + employee_positions; employee membership FK requires M02.
M04 attendance_shifts + attendance_breaks + attendance_shift_versions + attendance_approvals + attendance_adjustments; add `current_version_id` circular FK after versions exist, validate same shift.
M05 pay_rates + payroll_periods + payroll_items + payroll_adjustments + payroll_calculation_lines + payroll_correction_entries; install finalized immutability guard with table creation.
M06 managed_accounts + account_secrets + contact_points + account_contact_links + account_relationships + secret_access_events.
M07 daily_reports + daily_report_entries + daily_report_revisions WITHOUT dangling channel FK.
M08 optional channels (WORK-owned metadata) + minimal work foundation ONLY after Owner scope lock; then add channel FK to reports with NOT VALID / validate strategy where appropriate.
M09 optional storage metadata, receipts, operations, typed grants ONLY after scope lock; ensure work assignment dependencies exist if grants reference them.
M10 V0.2 ONLY content/video specialized workflows, never in V0.1 migrations.
M11 incremental indexes/guards/data validation, staged with owning migration and no interval where unsafe writes are permitted.

DAG: M01 -> M02 -> M03 -> {M04,M06,M07}; M04 -> M05; M06 -> optional M08; M07 -> optional channel FK after M08; M08 -> optional M09 if work assignments required. M10 excluded.

## Release acceptance checklist
- [ ] Every table has complete DDL with NULL, defaults, CHECK, unique, composite FK, ON DELETE, index and immutable guards.
- [ ] Fresh PostgreSQL migrate PASS, migration checksum/replay PASS, restart PASS, clean environment reproducible.
- [ ] Real DB tests prove tenant isolation, overlap exclusion, immutable snapshots, finalized guards, duplicate requests, exact payroll arithmetic.
- [ ] Production backup/restore and key recovery tests PASS before live data.
- [ ] No destructive SQL, no auto-rollback dropping production data.
- [ ] Security P0 and functional QA P0 all PASS for actual release scope.

## HOLD gates
1. Exact scope for optional WORK/Drive migrations (Owner scope checkpoint; do not infer).
2. Negative net pay policy if encountered; fail finalize affected item, do not auto-zero or auto-debit.
3. Production key custody, restore, email activation secure delivery mechanism; SEC-02 design is not runtime proof.
4. No code/test results yet. `DB-READY` means schema specification prepared, not database deployed.


## V0.1 normative release allowlist (doc.11)
Only M00–M07 plus essential M11 core audit/idempotency/outbox/integrity guards may ship. M08 WORK, M09 Drive/storage workflow and M10 Content/Video are V0.2-only. Historical optional language does not grant V0.1 scope.
