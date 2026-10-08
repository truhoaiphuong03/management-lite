# Open Issues / STOP Gates

| ID | Issue | Required action |
|---|---|---|
| OI-01 | DATA-04 is a field-level baseline, not full executable DDL | Complete nullable/default/CHECK/FK/index/delete rules in ARCH-REVIEW |
| OI-02 | Exact attendance correction and approval-version model | Define immutable shift snapshots and reviewer authority; no Owner self-approval |
| OI-03 | Payroll correction after finalize and settlement reference | Define append-only ledger and no retroactive mutation before implementation |
| OI-04 | Negative net pay, tax/mandatory deductions | Business-policy decision if in scope; do not invent |
| OI-05 | Global uniqueness of username/email vs multi-workspace identity | Confirm auth product model; preserve existing baseline until review |
| OI-06 | Activation outbox retry after uncertain provider acceptance | Specify token invalidation, delivery status and recovery tests |
| OI-07 | Resource access polymorphic FK and Drive ACL reconciliation | Define enforceable integrity, revocation semantics |
| OI-08 | Work/Content/Video/Drive full workflow is V0.2 or staged | Keep full pipeline out of V0.1 implementation unless Owner approves |
| OI-09 | Secret encryption key rotation, nonce handling, reauth TTL | SEC-02 before code |
| OI-10 | Timezone changes and boundary cases (DST, rate effective midnight) | Define reproducible tests and period semantics |
| OI-11 | Database row-level security vs service-level workspace enforcement | Select defense-in-depth implementation during ARCH-REVIEW |
| OI-12 | Full canonical OpenAPI schemas and migration filenames | DEV-READY after architecture review |

Unknown/conflict = STOP + ASK. No issue in this list grants permission to change approved PAY-02 policy.

## DOC-02 review status
AR-01..20 have design dispositions in 13_DOC02_ARCH_REMEDIATION.md. Remaining gates: SEC-02, FLOW-02, executable DDL and test evidence, precise V0.1 WORK/STORAGE release scope, Owner-only policy decisions if later in scope.

## SEC-02 remaining deployment gates
KMS/provider choice and costs, TLS/cookie domain, rotation and backup recovery evidence, real provider ACL, P0 security test evidence remain HOLD.

## FLOW-02 remaining HOLD gates
Exact open-shift correction authority/endpoint, state transition constraints, ledger SQL and provider ACL evidence require DB-READY/QA-03. Full Content→Editor remains V0.2.


## DB-READY remaining gates
See docs/22_DBREADY_MIGRATION_DAG.md and docs/23_DBREADY_TRACEABILITY.md. No code, no actual PostgreSQL validation, scope gate for optional WORK/Drive, API-READY, production security evidence.

## API-READY unresolved gates
See docs/27_APIREADY_TRACEABILITY_AND_HOLDS.md H01-H08. Do not invent open-shift correction or post-submit report policy. Optional WORK/Drive requires scope review.


## SCOPE-REVIEW doc.7
Owner choices C01–C06 remain conditional. See docs/28_SCOPE_REVIEW_RELEASE_MATRIX.md. No optional WORK/Drive migrations until explicit scope approval.

## SCOPE-LOCK update (doc.8)
C01–C06 **CLOSED by explicit Owner approval**, see `30_SCOPE_LOCK_OWNER_APPROVAL.md`. Previous conditional references in this file and earlier docs are historical. API HOLD H01/H02/H04/H07/H08 now have approved business dispositions but need API contract/test updates; H03 negative net case is blocked for finalize, while tax, insurance and settlement remain out of V0.1. Remaining HOLD: QA-03, API/schema verification, email provider delivery, encryption key custody/recovery, migration/rollback rehearsal, security evidence and DEV-READY. No WORK/Drive feature-specific migration in V0.1.


## QA-03 remaining gates
All QA-03 cases NOT RUN; implementation, Postgres migrations, email, security key custody, backup/restore, UI and Owner UAT evidence remain HOLD. Historical C01-C06 business choices are LOCKED per doc.8, not open policy items.

## ARCH-RECHECK doc.10 open technical gates
API-SYNC required for ARC-01/02/03/06/07 and release migration allowlist ARC-04. Paused-shift forgotten clock-out correction requires explicit transition without invented paid seconds. DB enforcement, real security, migrations and QA execution remain HOLD. Historical C01-C06 are not unresolved policy questions.


## API-SYNC residual HOLD (doc.11)
ARC-01–07,09–10,13–16 design-level contracts reconciled; ARC-08 requires executable guards and race tests; ARC-11–12 require actual QA/security/migration evidence. C01 insufficient evidence on open paused break => fail closed, no inferred work. Active workspace binding provisioning is an operational precondition; no UI selector. DEV-READY HOLD.


## PRE-DEV doc.13 outstanding entry gates
Runtime/PostgreSQL compatibility pin, production provider and cost, AEAD key custody/recovery, email provider, workspace binding, UI inventory, QA-SYNC, and explicit Owner permission remain HOLD. Planning documents are not code authorization.


## OWNER-GATE doc.14 — locked decisions vs implementation HOLD
G01–G05 are now **LOCKED**; see `43_OWNER_GATE_APPROVAL_AND_HOLDS.md`. Historical PRE-DEV text describing their choice as pending is superseded only on these points. HOLD: exact runtime/PG version and compatibility; production server/provider and HTTPS; KMS provider, key custody/rotation/recovery; production email provider and end-to-end delivery; off-server encrypted backup target and verified restore; workspace provisioning; UI inventory; QA-SYNC and 85 QA cases NOT RUN; explicit authorization to start code; no spending without Owner approval.

## UI-REVIEW doc.15 remaining HOLD
UIA-10 visual/browser/mobile interaction evidence; UIA-11 measured accessibility/contrast evidence; UIA-12 QA-SYNC traceability; all implementation and Owner START authorization remain HOLD.

## QA-SYNC remaining HOLD (doc.16)
- No QA-03 or QA-SYNC case executed. DB constraints, API concurrency, browser accessibility, UI jitter and cross-workspace tests require actual implementation.
- G02 local secret store and production KMS, G03 real email, G04 encrypted off-server backup/restore, G01 production approval and G05 cost approval need runtime evidence before release.
- Historical QA-02 references to WORK/Drive are V0.2 only, not V0.1 release scope.


## DB-CONSTRAINT doc.17
HOLD: DBF-01..10 and DBF-12..16 require implementation/verification; DBF-11 historical wording reconciled. DBT-01..18 NOT RUN. Production release and executor assignment remain HOLD.

## START-GATE open entry issues
SG-04 repository identity/access, SG-05 Mac toolchain/PostgreSQL, SG-06 local secret-store capability, SG-08 packet ownership; production KMS/provider and backup/restore evidence remain HOLD. QA-SYNC 113 cases plus 18 DBT objectives require deduplication and execution.


## HANDOFF-REVIEW open gates
HRV-01 repo/base SHA; HRV-02/03 future owner nomination; HRV-04 DB runtime; HRV-05 rollback/restore proof; HRV-06 explicit START-CODE; HRV-07 QA/DBT dedupe and execution; HRV-08 secret store/email/backup evidence. All HOLD as applicable; see docs 54–56.
