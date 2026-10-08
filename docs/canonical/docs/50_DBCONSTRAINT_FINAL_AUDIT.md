# DB-CONSTRAINT — Final design audit (normative)
Version 0.1.0-doc.17 | DESIGN ONLY | Parent 0.1.0-doc.16

## Authority and non-regression
Normative precedence: Owner-approved C01–C06, G01–G05 and locked PAY-02/RBAC-02/SEC-02 > API-SYNC docs 36–37 > this database enforcement clarification > historical DB-READY/DOC-02 texts. No business-policy change. WORK/Drive/Content/Video M08–M10 are V0.2-only. No executable SQL, migration, repository or executor action is authorized.

## Findings and dispositions
| ID | Severity | Finding | Design disposition | Runtime |
|---|---|---|---|---|
| DBF-01 | P0 | Composite FK coverage for cross-tenant multi-parent edges and circular shift current-version pointer incomplete | Require composite (workspace_id,shift_id,version_id) and UNIQUE supporting parent keys, deferred FK where circular, RESTRICT history | HOLD |
| DBF-02 | P0 | Open shift and closed shift exclusion can race, and closed shift may overlap an open shift | Serialize all writes per workspace+employee with transaction/advisory row lock, validate intersection against open and closed intervals; exclusion for bounded ranges | HOLD |
| DBF-03 | P0 | Break bounds/open break closure and C01 paused-shift evidence require cross-row invariants | Transactionally lock shift, break and request; no automatic break end; reject missing evidence, require explicit supported end <= Owner clock-out | HOLD |
| DBF-04 | P0 | Immutable attendance versions, approval current-version and reviewer != employee need cross-table enforcement | DB write guards + transactional checks, enforce same-shift FK, current pointer, stale approval invalidation for new payroll | HOLD |
| DBF-05 | P0 | Duplicate paid seconds can cross items, revisions and periods | Lock period and sources, calculate coverage per employee/workspace, reject any overlapping paid intervals; retain immutable finalized coverage references | HOLD |
| DBF-06 | P0 | Finalization must revalidate negative net and source freshness atomically | Single transaction locks period, items, current approved versions, rates; all-or-nothing, reject any net<0, no clamp/carryover | HOLD |
| DBF-07 | P0 | Tenant isolation must hold for all multi-parent joins, including ACC/REP/PAY | Composite FK, scoped queries, membership/session binding; DB roles and tests deny cross-tenant | HOLD |
| DBF-08 | P0 | Secret-write reauth proof persistence and atomic consumption are not fully column-specified | Add action/account/session-bound one-use proof contract; transactional consumption with ciphertext version; no plaintext in DB/log/outbox | HOLD |
| DBF-09 | P0 | Invite delivery with no persistent raw token is underspecified | Define ephemeral secure handoff/retry mechanism before implementation; never persist raw token or activation link in outbox/log | HOLD |
| DBF-10 | P0 | M11 guards cannot be installed after an unsafe write window | Place guards with owning table migration or block writes until installed; only M00–M07 plus necessary M11 V0.1 | HOLD |
| DBF-11 | P1 | Old DB-READY rows mention needs_review, negative net HOLD, optional WORK/Drive | Historical only; normative states doc37, C04 negative net blocker, C03 V0.2 exclusion | PASS design |
| DBF-12 | P1 | Effective rate/position/period intervals require exact half-open semantics and timezone handling | Check end>start, exclusion/serialized guard, IANA timezone pinned at calculation/finalization, DST test | HOLD |
| DBF-13 | P1 | Idempotency keys may be reused across routes; request fingerprints may leak secret | Bind workspace+actor+operation/route+key; sanitized fingerprints never include plaintext or reauth proof | HOLD |
| DBF-14 | P1 | Append-only correction/ledger and audit DB protection not proven | DB guard denies UPDATE/DELETE, compensating entry only; restrict DB roles | HOLD |
| DBF-15 | P1 | Workspace binding for multiple memberships not backed by explicit provisioning mechanism | Explicit preauthorized binding; no arbitrary selection; fail closed if ambiguous/revoked | HOLD |
| DBF-16 | P1 | DB operational evidence absent | Fresh migration/replay/checksum, rollback safety, backup/restore/key recovery, concurrency QA all NOT RUN | HOLD |

**Interpretation:** 16 findings specified; DBF-11 reconciled in design, remaining 15 need implementation and/or test evidence. This is not a claim that 15 defects exist in running software: no software has been tested.

## Mandatory invariant classes
1. Declarative: PK, UNIQUE, CHECK, composite FK, partial UNIQUE, GiST exclusion where available; no unsupported cross-table CHECK claims.
2. Transactional: row/advisory lock discipline, version/If-Match, idempotency, consistent isolation and explicit serialization/retry behavior; no read-before-write race.
3. Immutable: attendance snapshots, approvals, audit, finalized payroll and correction ledger cannot UPDATE/DELETE by app DB role.
4. Temporal: all intervals [start,end); split by local day/rate; no overlapping paid seconds; exact seconds; NUMERIC numerator; half-up once per employee/period.
5. Security: Owner/Staff permissions enforced server-side, explicit workspace binding, no secret plaintext at rest or in logs, reauth proof action-bound and one-use.

## Important schema reconciliation
- `attendance_shifts.review_state` in historical doc20 lists `needs_review`; normative per-version `unreviewed|approved|rejected` is in doc37. Do not introduce fourth review state.
- `payroll_items.net_amount_vnd` historical policy HOLD is superseded by C04: any negative net blocks **entire** finalize transaction.
- `daily_report_entries.channel_id` and optional WORK/Drive tables are historical V0.2 reference only; no V0.1 FK or migration.
- A DB `CHECK` cannot enforce reviewer != shift employee or Owner payroll exclusion across tables; require locked transaction/guard and integration tests.
- PostgreSQL `EXCLUDE` alone for completed bounded shifts does not automatically cover unbounded open shifts; combine lock discipline and validations.

## Exit gates
DESIGN: requirements and test evidence targets specified (PASS). EXECUTABLE: SQL constraints, migrations, triggers/permissions, and transactional services (HOLD). VERIFICATION: clean install/replay, concurrent mutation tests, cross-tenant attacks, arithmetic tests, restore and security review (NOT RUN). RELEASE: HOLD.
