# DOC-02 — Migration DAG, release gates and QA
No migrations have been authored or executed. The order below is a dependency-aware logical plan, not SQL filenames.

## DAG
M01 workspaces, users, audit/idempotency primitives
M02 memberships, credentials, sessions, activation invites, email outbox
M03 employees, positions, employee_positions
M04 attendance shifts, breaks, immutable versions, approvals, adjustments
M05 pay rates, payroll periods, items, calculation lines, correction ledger
M06 managed accounts, secrets, contacts, relationships, secret access events
M07 daily reports, report entries/revisions (optional channel FK only after channels exist)
M08 channels metadata and minimal work foundation IF in V0.1 release scope; otherwise defer
M09 storage folder/file/revision/receipt/operation/grants IF in V0.1 release scope; otherwise defer
M10 Content/Video specialized tables (V0.2 only, NOT V0.1)
M11 indexes/guards/read models dependent on above, staged with their owning migration

IMPORTANT: For daily_report_entries.channel_id, either create channels before reports or defer optional FK and add it only once channels exist; never deploy a dangling FK. For storage vs work assignments, resolve referenced target tables before adding typed grants. Each actual migration has up/down safety classification, checksum, transaction strategy, backup/restore evidence and explicit non-destructive behavior. No automatic destructive rollback.

## Acceptance evidence checklist
- [ ] Complete column-by-column DDL, NULL/default/CHECK, FK, unique, exclusion, index and delete policy
- [ ] Fresh PostgreSQL migrate succeeds; migration checksum and restart/replay verified
- [ ] FK workspace isolation / IDOR tests pass on real PostgreSQL
- [ ] Open shift/break, pay-rate overlap, period overlap DB constraints tested
- [ ] Immutable shift versions, approval binding and finalized payroll UPDATE/DELETE guard tested
- [ ] Concurrent clock-in, approve, calculate, finalize and correction idempotency tests pass
- [ ] Midnight, month-end, rate-change, break, fractional seconds and half-up payroll fixtures pass
- [ ] Outbox retry and Drive unknown/reconcile tests pass when module in release
- [ ] All P0 tests in release scope PASS; no P0 security findings; UI stable button tests PASS
- [ ] No real code/test/DB claim until executable evidence exists

## Unresolved gates
SEC-02: secret key lifecycle/reauth TTL, activation link delivery risk, Drive ACL and provider reconciliation.
FLOW-02: detailed transition authorization and exception workflows.
Owner policy only if brought into scope: negative net pay, tax/insurance, settlement/payment, Owner paid attendance approval.
Scope gate: determine which WORK/STORAGE capabilities actually ship in V0.1 without expanding V0.2 pipeline.
