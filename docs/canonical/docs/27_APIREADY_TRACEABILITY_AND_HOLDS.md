# API-READY — Traceability, Decision Log, HOLD
## Canonical precedence
Owner-approved PAY-02 and RBAC-02 and V0.1 scope > SEC-02 > FLOW-02 > DB-READY > API-READY technical refinements. Any unresolved business policy => STOP/ASK. API-READY is design, NOT running API, NOT executable OpenAPI and NOT tests.

## Technical decisions
API-R01 stable `/api/v1` snake_case envelopes; API-R02 201 create, 202 async enqueue, 204 logout; API-R03 428 missing If-Match, 412 stale, 409 business conflict; API-R04 Idempotency-Key on state-changing non-auth mutations with safe replay; API-R05 do not cache sensitive response values; API-R06 immutable attendance version approvals; API-R07 payroll source-version checks and atomic finalize; API-R08 Owner excluded from payroll, Owner self-approval forbidden; API-R09 report submit explicit route; API-R10 payroll rate creation and post-finalize correction separate routes; API-R11 reauth bound to session/account/action single-use; API-R12 external provider queued/unknown != success; API-R13 owner-only ACC including metadata; API-R14 optional WORK/Drive gated by SCOPE-REVIEW.

## Traceability
AR-01/03 -> ATT version/review and PAY calculation lines; AR-02 -> corrections; AR-04 -> tenant-scoped typed resource grants; AR-05 -> activation/outbox; AR-06/19 -> storage two-step reconciliation; AR-07/15/20 -> If-Match, 412, endpoints; AR-08/17 -> DB-READY DAG; AR-09/10/11 -> identity/membership HR; AR-12/16 -> WORK optional; AR-13 -> reports revisions/submit; AR-14 -> status registry; AR-18 -> timezone snapshot. SEC-T01..T12 -> SEC-02 plus QAs for secrets/session/provider. PAY-021..028 unchanged.

## HOLD gates (do not silently choose policy)
H01 Exact permission and correction workflow for forgotten OPEN shift (who may propose corrected clock-out; evidence, self-service vs Owner) requires Owner approval if materially changing HR policy. API route is provisional for this case.
H02 Post-submission daily report revision permission (staff self-revise vs Owner reopen) not locked; no silent mutation.
H03 Negative net pay, tax, insurance, actual payroll payout/settlement out of current policy; block negative finalization pending Owner.
H04 Whether WORK/Drive optional foundations ship in V0.1 remains SCOPE-REVIEW; do not run optional migrations by default.
H05 Email token secure transient delivery and retry with no token persisted in outbox must be demonstrated; never log activation token. SEC-02 production key custody and backup recovery remain unverified.
H06 Exact DDL, generated OpenAPI schema, database test evidence, real service/provider integration, QA-03 remain not executed.
H07 Global identity and multi-workspace account binding, login identifier ambiguity, and selecting active workspace require final UX/security check before implementation; do not assume user can access arbitrary workspace.
H08 Owner-only secret update policy: SEC-02 states Owner-only; reauth for update is security-hardening proposal, verify it does not conflict with product expectations before shipping.

## Release status
API-READY design: PASS with documented HOLD gates. Production/API implementation readiness: HOLD. No code, migrations, test execution or executor assignment authorized.


## API-SYNC disposition (doc.11)
Historical C01–C06 unresolved statements above are superseded by Owner SCOPE-LOCK doc.8 and docs/36–37. ARC-01–16 dispositions and residual HOLD are recorded in doc37.
