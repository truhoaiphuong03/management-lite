# DOC-02 — Architecture remediation
Version: 0.1.0-doc.2 | 2026-10-08 | design only, not executable DDL

## Authority and scope
DOC-01 remains baseline; this document overrides only explicitly enumerated technical inconsistencies. Owner-approved PAY-02, RBAC-02 and V0.1 scope remain unchanged. No repository modifications, implementation or executor assignment.

## Resolution register AR-01..AR-20
| ID | Technical disposition | Gate |
|---|---|---|
| AR-01 | Append-only attendance_shift_versions; approvals bind version and hash | design resolved, DDL pending |
| AR-02 | Append-only payroll_correction_entries separate from immutable finalized payroll items | design resolved; settlement out of V0.1 |
| AR-03 | Nonoverlapping canonical worked intervals and unique source allocation per period; concurrency locks | design resolved, DB proof pending |
| AR-04 | Resource grants use typed target FK or validated target registry; no unchecked polymorphic FK | design resolved, DDL pending |
| AR-05 | Activation token lifecycle and email delivery separate; retry reconciled | design resolved; SEC-02 pending |
| AR-06 | Drive trash two-phase intent, revision precondition, provider reconciliation | design resolved; SEC-02 pending |
| AR-07 | Mutations require idempotency and version preconditions; lock/recheck at commit | design resolved |
| AR-08 | FK DAG, restrictive deletes, migration ledger and verification gates | design resolved; SQL pending |
| AR-09 | Global user identity; membership per workspace; no new multiworkspace UI | preserved baseline |
| AR-10 | Employee identity must have matching membership, enforced transactionally | design resolved |
| AR-11 | Employment status distinct from activation/membership state | design resolved |
| AR-12 | WORK reads channel metadata only; never account secrets | design resolved |
| AR-13 | Report draft/submitted + append-only revisions; reported != approved | design resolved |
| AR-14 | One status registry shared by API/DB/UI | design resolved |
| AR-15 | 412 for If-Match mismatch; 409 for business conflict | design resolved |
| AR-16 | Review binds submission revision; one terminal decision per submission | design resolved |
| AR-17 | Dependency DAG; V0.2 Content/Video not required for V0.1 | design resolved |
| AR-18 | Freeze timezone identifier in payroll period and calculation snapshot | design resolved |
| AR-19 | Drive ACL reconciliation and revocation, not just app permissions | SEC-02 pending |
| AR-20 | Attendance correction and calculation line read endpoints defined | design resolved |

## Canonical invariants
- Workspace-owned tables have unique (workspace_id,id), all cross-entity FKs include workspace_id; global users are exception.
- No deletion cascade from parent entities into audit, payroll, shift versions or secrets history; soft-archive where applicable.
- No self-approval: reviewer user_id must not be the subject user_id; enforce in transaction using identity mapping, not only UI.
- Clock times originate on server. Clock-in/out and pause/resume state transitions are atomic and idempotent.
- Every payroll calculation line points to an approved immutable shift version and rate snapshot; lines for a finalized period cannot mutate.
- Any failed integrity check blocks finalization, not silently repairs data.
- P0 security and data guarantees need real integration test evidence before PASS.
