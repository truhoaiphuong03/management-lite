# QA-FINAL — V0.1 Test Reconciliation, Coverage and Release Gates

**CANONICAL DOCUMENT — DESIGN ONLY / NOT EXECUTED**

Version: `0.1.0-doc.20` | Parent: `0.1.0-doc.19` | Stage: QA-FINAL | Owner-approved documentation publication candidate.

## Authority and scope

Preserve without alteration: PAY-02, RBAC-02, SEC-02, C01–C06, G01–G05, V0.1. M08–M10 WORK/Drive/Content/Video excluded. This document adds traceability/evidence requirements, **not** policy, feature scope, implementation authority, release authorization, or an executor assignment. Source assertions remain authoritative if transcription differs. PK-01 is restricted to approved M00+M01+necessary M11, transaction helpers, idempotency, audit; M02/invite/email_outbox and new outbox platform HOLD.

## Inventory and deduplication

- 85 QA-03 cases (71 P0, 14 P1) + 28 QA-SYNC cases (26 P0, 2 P1) = **113 distinct QA IDs (97 P0, 16 P1)**.
- 18 DB-focused acceptance targets (16 P0, 2 P1) cross-reference QA. **Not 131 automatically distinct tests.** Shared fixtures/executions do not waive any assertion; a DBT is PASS only if its own evidence exists.
- All cases remain **NOT RUN** until independently evidenced; documentation reconciliation does not constitute runtime PASS.

## Complete 113-case acceptance register

| Case ID | Priority | Domain | Source assertion | Execution |
|---|---|---|---|---|
| Q3-AUTH-001 | P0 | AUTH | Owner bootstrap one-time; public registration denied | NOT RUN |
| Q3-AUTH-002 | P0 | AUTH | Invitation token hashed, 256-bit, expires, replay and reissue rejected | NOT RUN |
| Q3-AUTH-003 | P0 | AUTH | Activation atomic with credential creation and membership transition | NOT RUN |
| Q3-AUTH-004 | P0 | AUTH | Email outbox queued/accepted/delivered differentiated; provider timeout unknown and reconciled | NOT RUN |
| Q3-AUTH-005 | P0 | AUTH | Login enumeration resistant; throttle, password hash Argon2id | NOT RUN |
| Q3-AUTH-006 | P0 | AUTH | Session rotation/revocation on login, password change, suspension | NOT RUN |
| Q3-AUTH-007 | P0 | AUTH | CSRF and origin enforced; session idle/absolute expiry | NOT RUN |
| Q3-AUTH-008 | P0 | AUTH | C06 explicit single authorized workspace context, no silent switch or selector | NOT RUN |
| Q3-AUTH-009 | P1 | AUTH | Concurrent activation/invite retries deterministic | NOT RUN |
| Q3-HR-001 | P0 | HR | Employee workspace FK membership and unique employee code | NOT RUN |
| Q3-HR-002 | P0 | HR | Owner creates employee; staff cannot administer other staff | NOT RUN |
| Q3-HR-003 | P0 | HR | Suspended employee cannot use active session | NOT RUN |
| Q3-HR-004 | P1 | HR | Effective-dated positions do not grant Owner auth role | NOT RUN |
| Q3-HR-005 | P1 | HR | Employee activation and employment statuses independent | NOT RUN |
| Q3-ATT-001 | P0 | ATT | Clock-in server timestamp, no two open shifts under race | NOT RUN |
| Q3-ATT-002 | P0 | ATT | Break/resume only valid transitions; break unpaid | NOT RUN |
| Q3-ATT-003 | P0 | ATT | Clock-out only from working; no guessed end time | NOT RUN |
| Q3-ATT-004 | P0 | ATT | Completed shift immutable version; approval binds exact version | NOT RUN |
| Q3-ATT-005 | P0 | ATT | Owner cannot self-approve | NOT RUN |
| Q3-ATT-006 | P0 | ATT | C01 staff correction request has reason and original evidence; Owner explicit clock-out decision, version and audit | NOT RUN |
| Q3-ATT-007 | P0 | ATT | C01 unresolved open shift excluded from payroll; correction cannot bypass approval | NOT RUN |
| Q3-ATT-008 | P0 | ATT | Concurrent approval/correction stale version returns 412; no lost updates | NOT RUN |
| Q3-ATT-009 | P0 | ATT | No overlap across shifts/breaks/approved payable segments | NOT RUN |
| Q3-ATT-010 | P1 | ATT | Clock-in/out idempotent retry after connection loss | NOT RUN |
| Q3-REP-001 | P0 | REP | Draft and submit state transition; one logical report per employee/local day | NOT RUN |
| Q3-REP-002 | P0 | REP | C02 new post-submit revision, old version immutable and attributed | NOT RUN |
| Q3-REP-003 | P0 | REP | Staff cannot edit another employee report | NOT RUN |
| Q3-REP-004 | P1 | REP | Reported counts distinct from verified work output | NOT RUN |
| Q3-REP-005 | P1 | REP | Concurrent revision If-Match rejects stale writes | NOT RUN |
| Q3-PAY-001 | P0 | PAY | Only approved current attendance versions counted | NOT RUN |
| Q3-PAY-002 | P0 | PAY | Cross-midnight segments split on workspace-local date | NOT RUN |
| Q3-PAY-003 | P0 | PAY | Effective-dated rate boundaries split accurately | NOT RUN |
| Q3-PAY-004 | P0 | PAY | Break time excluded; exact integer seconds and rational base-pay numerator | NOT RUN |
| Q3-PAY-005 | P0 | PAY | Single half-up rounding once per employee per period | NOT RUN |
| Q3-PAY-006 | P0 | PAY | Owner excluded from payroll despite attendance | NOT RUN |
| Q3-PAY-007 | P0 | PAY | Missing rate, overlaps or stale approval blocks finalize | NOT RUN |
| Q3-PAY-008 | P0 | PAY | C04 negative net blocks entire period finalize atomically; no clamp/carryover | NOT RUN |
| Q3-PAY-009 | P0 | PAY | Finalized item/lines immutable; post-final correction append-only | NOT RUN |
| Q3-PAY-010 | P0 | PAY | Concurrent calculate/finalize idempotent and version-safe | NOT RUN |
| Q3-PAY-011 | P0 | PAY | No duplicate seconds in adjacent periods | NOT RUN |
| Q3-PAY-012 | P1 | PAY | Trace each calculation line to immutable shift snapshot and rate snapshot | NOT RUN |
| Q3-ACC-001 | P0 | ACC | Staff cannot list/detail/search managed account metadata | NOT RUN |
| Q3-ACC-002 | P0 | ACC | AEAD secret ciphertext/AAD workspace+account bound; key outside DB | NOT RUN |
| Q3-ACC-003 | P0 | ACC | Missing key and tampered/swapped ciphertext fail closed | NOT RUN |
| Q3-ACC-004 | P0 | ACC | Reveal requires fresh one-time account/action/session-scoped reauth | NOT RUN |
| Q3-ACC-005 | P0 | ACC | C05 secret update requires fresh one-time reauth, not only reveal | NOT RUN |
| Q3-ACC-006 | P0 | ACC | No plaintext secret in list, logs, telemetry, idempotency cache or backups | NOT RUN |
| Q3-ACC-007 | P0 | ACC | Archive/restore versioned; no destructive secret deletion | NOT RUN |
| Q3-ACC-008 | P1 | ACC | Ambiguous contact links never auto-resolved | NOT RUN |
| Q3-ACC-009 | P0 | ACC | Reveal response no-store and UI clears displayed secret | NOT RUN |
| Q3-API-001 | P0 | API | Uniform envelope and request_id; 204 no body | NOT RUN |
| Q3-API-002 | P0 | API | 401/403/404 hidden-resource distinction | NOT RUN |
| Q3-API-003 | P0 | API | 409 business conflict; 412 stale If-Match; 428 missing precondition | NOT RUN |
| Q3-API-004 | P0 | API | Mutations CSRF and Idempotency-Key; replay body mismatch 409 | NOT RUN |
| Q3-API-005 | P0 | API | Workspace IDOR and cross-tenant foreign keys rejected | NOT RUN |
| Q3-API-006 | P0 | API | C01 correction request/decision contract and C02 revision contract traced | NOT RUN |
| Q3-API-007 | P0 | API | C04 finalize guard and C05 secret mutation proof traced | NOT RUN |
| Q3-API-008 | P1 | API | Cursor pagination and UTC/snake_case contracts | NOT RUN |
| Q3-API-009 | P1 | API | Rate limits 429 with safe messages | NOT RUN |
| Q3-DB-001 | P0 | DB | Composite workspace FKs enforced by PostgreSQL | NOT RUN |
| Q3-DB-002 | P0 | DB | Unique and exclusion constraints prevent overlapping open shifts/rates | NOT RUN |
| Q3-DB-003 | P0 | DB | Immutable attendance versions and finalized payroll protected at DB boundary | NOT RUN |
| Q3-DB-004 | P0 | DB | Migrations ordered by dependency DAG, rollback/recovery rehearsed | NOT RUN |
| Q3-DB-005 | P0 | DB | Failed migration leaves no partially active schema | NOT RUN |
| Q3-DB-006 | P0 | DB | No V0.2 WORK/Drive feature migrations in V0.1 release | NOT RUN |
| Q3-DB-007 | P1 | DB | Indexes support self and Owner scoped queries | NOT RUN |
| Q3-DB-008 | P0 | DB | Backup restore verifies ciphertext/key-version compatibility | NOT RUN |
| Q3-UI-001 | P0 | UI | Single dark AppShell/shared components across V0.1 modules | NOT RUN |
| Q3-UI-002 | P0 | UI | 360px mobile no overflow; keyboard and focus visible | NOT RUN |
| Q3-UI-003 | P0 | UI | Stable button dimensions, no click jitter; loading disabled | NOT RUN |
| Q3-UI-004 | P0 | UI | No premature success for outbox/async operations | NOT RUN |
| Q3-UI-005 | P0 | UI | Staff account menu/URL direct access both denied | NOT RUN |
| Q3-UI-006 | P0 | UI | C01 correction, C02 revision, C04 blocked finalize and C05 reauth flows visible | NOT RUN |
| Q3-UI-007 | P1 | UI | Accessible labels and error feedback, no secret in toast | NOT RUN |
| Q3-UI-008 | P0 | UI | C06 no workspace selector; active workspace visible or explicit context | NOT RUN |
| Q3-OPS-001 | P0 | OPS | Email provider unknown/timeout reconciled without duplicate activation | NOT RUN |
| Q3-OPS-002 | P0 | OPS | Redis outage cannot bypass auth or lose source-of-truth writes | NOT RUN |
| Q3-OPS-003 | P0 | OPS | Session and audit logs redact credentials/tokens/secrets | NOT RUN |
| Q3-OPS-004 | P0 | OPS | Key rotation and encrypted restore drill before production | NOT RUN |
| Q3-OPS-005 | P0 | OPS | TLS, CSP, cookie and CSRF deployment checks | NOT RUN |
| Q3-OPS-006 | P1 | OPS | Monitoring/incident and retention runbooks approved before production | NOT RUN |
| Q3-SCOPE-001 | P0 | SCOPE | S01–S11 all have evidence; no mock data counted as product | NOT RUN |
| Q3-SCOPE-002 | P0 | SCOPE | C03 WORK/Drive APIs/UI/migrations absent from V0.1 | NOT RUN |
| Q3-SCOPE-003 | P0 | SCOPE | No Owner payroll, Owner self-approval, public signup, staff secret access | NOT RUN |
| Q3-SCOPE-004 | P1 | SCOPE | V0.2 reference documents cannot accidentally enable routes or grants | NOT RUN |
| QS-API-001 | P0 | ATT | C01 paused forgotten clock-out requires explicit break-end evidence; otherwise blocked, no guessed payable seconds | NOT RUN |
| QS-API-002 | P0 | ATT | C01 Owner decision and subsequent independent attendance approval cannot collapse into one transaction/approval | NOT RUN |
| QS-API-003 | P0 | REP | C02 submitted revision concurrent If-Match stale and duplicate Idempotency-Key preserve exactly one new immutable revision | NOT RUN |
| QS-API-004 | P0 | ACC | C05 secret replace requires fresh one-use action/account/session scoped reauth, rejects proof for reveal or other account | NOT RUN |
| QS-API-005 | P0 | AUTH | C06 multiple membership without explicit authorized active workspace fails closed and does not leak membership details | NOT RUN |
| QS-API-006 | P0 | PAY | C04 negative net blocks atomic period finalize, including concurrent finalize/recalculation, with zero partial writes | NOT RUN |
| QS-DB-007 | P0 | ATT | C01 attendance correction decision produces immutable new version; approval targets current version and excludes open/paused versions | NOT RUN |
| QS-DB-008 | P0 | DB | Migration allowlist M00-M07 and M11 excludes M08-M10 WORK/Drive/Content-Video from V0.1 schema and grants | NOT RUN |
| QS-DB-009 | P0 | DB | Cross-workspace composite FK and tenant isolation verified with two workspaces and concurrent requests | NOT RUN |
| QS-OPS-010 | P0 | OPS | G02 Mac OS secret store available to local API; missing/locked store fails closed with no plaintext fallback | NOT RUN |
| QS-OPS-011 | P0 | AUTH | G03 fake email adapter is local-only, visibly simulated; no false real delivery or bypass of hashed invite token | NOT RUN |
| QS-OPS-012 | P0 | OPS | G04 daily encrypted off-server backup, 30-day retention and restore drill verify ciphertext plus independent key recovery | NOT RUN |
| QS-OPS-013 | P0 | OPS | G01 deployment gate prevents production release before Owner UAT; local fake provider cannot be deployed as real email | NOT RUN |
| QS-OPS-014 | P0 | OPS | G05 no paid provider provisioning or cost commitment without explicit Owner approval evidence | NOT RUN |
| QS-UI-015 | P0 | UI | UI01-UI21 share single AppShell/tokens/components, no module-local duplicate button/dialog/toast or shell | NOT RUN |
| QS-UI-016 | P0 | UI | Mobile 360/390/430, tablet 768, desktop 1280: no overflow, table-to-card retains actions and amounts | NOT RUN |
| QS-UI-017 | P0 | UI | AppButton loading preserves dimensions and spinner width under rapid repeat taps, reduced motion and async failure | NOT RUN |
| QS-UI-018 | P0 | ATT | C01 UI06 paused correction displays needs-evidence/blocked, Owner decision, independent review and payroll exclusion | NOT RUN |
| QS-UI-019 | P0 | REP | C02 UI10 displays immutable submitted revision timeline and stale revision recovery without data loss | NOT RUN |
| QS-UI-020 | P0 | PAY | C04 UI15 identifies negative employee and blocks all finalize, no success toast before server commit | NOT RUN |
| QS-UI-021 | P0 | ACC | C05 UI18 reauth for both reveal/change; clear secret on close/error; no telemetry, toast, browser storage | NOT RUN |
| QS-UI-022 | P0 | AUTH | C06 UI03/UI20 ambiguous workspace blocked; no selector or silent switch; direct URL permission denied | NOT RUN |
| QS-UI-023 | P1 | UI | UI01-UI21 keyboard navigation, focus restoration, visible errors, 200% zoom, screen reader and reduced motion | NOT RUN |
| QS-UI-024 | P0 | UI | UI navigation Owner/Staff permissions and deep links: Staff ACC hidden and backend 403/404; Owner no self-approval or own pay | NOT RUN |
| QS-OPS-025 | P1 | OPS | Production email provider, KMS, server and backup target remain HOLD until selected, cost approved, integrated and tested | NOT RUN |
| QS-QA-026 | P0 | QA | Every V0.1 route UI01-UI21 mapped to at least one acceptance case; each mutation has success, 401/403, 409/412/428 and offline state where applicable | NOT RUN |
| QS-QA-027 | P0 | QA | All release P0 cases have executed reproducible evidence with commit, commands, database/API/UI logs and Owner UAT; spec-only cannot PASS | NOT RUN |
| QS-SCOPE-028 | P0 | SCOPE | No WORK/Drive/Content/Video V0.2 routes, endpoint registrations, tables, migrations or hidden flags enabled in V0.1 | NOT RUN |

## DBT-01..18 — mapping and evidence objectives

| DBT | Priority | Source acceptance assertion | QA trace (shared evidence, not automatic PASS) | Execution |
|---|---|---|---|---|
| DBT-01 | P0 | Cross-workspace FK mutation rejected for every multi-parent edge | Q3-DB-001, Q3-API-005, QS-DB-009 | NOT RUN |
| DBT-02 | P0 | Concurrent clock-in same employee cannot create two open shifts | Q3-ATT-001, Q3-DB-002 | NOT RUN |
| DBT-03 | P0 | Closed shift cannot overlap open/closed shift under concurrent writes | Q3-ATT-009, Q3-DB-002 | NOT RUN |
| DBT-04 | P0 | Open break cannot be guessed closed by C01; unsupported evidence blocks decision | Q3-ATT-006, Q3-ATT-007, QS-API-001 | NOT RUN |
| DBT-05 | P0 | Stale approval or version cannot be used in new payroll | Q3-ATT-004, Q3-ATT-008, Q3-PAY-001, Q3-PAY-007 | NOT RUN |
| DBT-06 | P0 | Employee cannot self-approve; Owner cannot self-approve own shift | Q3-ATT-005, Q3-HR-002, QS-API-002 | NOT RUN |
| DBT-07 | P0 | Payroll paid-second overlap rejected across items/periods and versions | Q3-PAY-011, Q3-ATT-009 | NOT RUN |
| DBT-08 | P0 | Rate effective ranges nonoverlap and split exact seconds, local day boundary | Q3-PAY-002, Q3-PAY-003, Q3-PAY-004, Q3-DB-002 | NOT RUN |
| DBT-09 | P0 | Negative net in one item rolls back entire period finalize | Q3-PAY-008, Q3-PAY-010, QS-API-006 | NOT RUN |
| DBT-10 | P0 | Finalized rows and attendance version/audit/ledger UPDATE/DELETE rejected | Q3-DB-003, Q3-PAY-009, Q3-OPS-003 | NOT RUN |
| DBT-11 | P0 | Reauth proof replay/wrong session/account/action rejected atomically | Q3-ACC-004, Q3-ACC-005, QS-API-004 | NOT RUN |
| DBT-12 | P0 | Ambiguous/revoked workspace binding fails closed | Q3-AUTH-008, QS-API-005 | NOT RUN |
| DBT-13 | P0 | Invite/outbox retries never persist raw token/link/secret | Q3-AUTH-002, Q3-AUTH-004, Q3-ACC-006, Q3-OPS-001 | NOT RUN |
| DBT-14 | P0 | Clean migration, checksum replay and restart preserve constraints | Q3-DB-004, Q3-DB-005 | NOT RUN |
| DBT-15 | P0 | V0.1 schema contains no WORK/Drive/Content/Video migrations or feature tables | Q3-DB-006, QS-DB-008, QS-SCOPE-028 | NOT RUN |
| DBT-16 | P0 | Encrypted off-server backup and successful restore/key recovery demonstrated before production | Q3-DB-008, Q3-OPS-004, QS-OPS-012 | NOT RUN |
| DBT-17 | P1 | DST/local midnight and hourly rate boundary arithmetic stable | Q3-PAY-002, Q3-PAY-003, Q3-PAY-004 | NOT RUN |
| DBT-18 | P1 | Duplicate Idempotency-Key across routes isolated and secret-free | Q3-API-004, QS-DB-009 | NOT RUN |

## Overlap policy

- Workspace isolation: Q3-AUTH-008, Q3-API-005, QS-API-005, QS-DB-009; distinguish AUTH, API, DB boundaries.
- C01 correction: Q3-ATT-006/007/008, QS-API-001/002, QS-DB-007; distinguish evidence, Owner decision and independent approval.
- Payroll negative-net: Q3-PAY-008/010 and QS-API-006; same scenario may provide distinct rollback, concurrency and API evidence.
- Reauth: Q3-ACC-004/005 and QS-API-004; reveal and replace proofs are not interchangeable.
- V0.2 exclusion: Q3-DB-006, Q3-SCOPE-002, QS-DB-008, QS-SCOPE-028; check migrations, schema, routes, grants and flags.
- Backup/restore: Q3-DB-008, Q3-OPS-004, QS-OPS-012; same drill may satisfy independent conditions only with recorded proof.
- UI consistency: Q3-UI-001/002/003 and QS-UI-015/016/017; verify each viewport and interaction.
- Invite/outbox: Q3-AUTH-002/004, Q3-OPS-001, QS-OPS-011; token secrecy, delivery state and fake provider are separate.

## GAP register — closure required before final QA lock

- GAP-01 P0: inventory every cross-workspace multi-parent FK and assert rejection/SQLSTATE, not one example.
- GAP-02 P0: deterministic concurrent transaction barriers, winner/loser, zero partial writes for clock-in, shift overlap, approval, payroll, proof and idempotency.
- GAP-03 P0: DBT-13 M02 invite/email_outbox remains HOLD under PK-01; do not substitute unapproved metadata outbox.
- GAP-04 P0: encrypted off-server restore and independent key recovery evidence; file existence alone insufficient.
- GAP-05 P1: explicit DST and idempotency actor/workspace/route fixtures, secret-free fingerprints.
- GAP-06 P0: QS-QA-026 per-route mutation matrix including applicable 401/403/409/412/428, offline and no forbidden side effects.
- GAP-07 P0: per-case reproducible evidence manifest, sanitized logs, commit SHA, tester/date, Owner UAT and release gates; design alone cannot PASS.

## Required fixtures, assertions and evidence

For each QA and DBT: case ID, source canonical and commit SHA, isolated fixture, workspace A/B, actor/role, preconditions, request/operation, expected HTTP/SQLSTATE and DB/audit effects, actual result, concurrency barrier/transaction outcome where relevant, sanitized evidence path, tester, timestamp, environment and rerun commands. Negative paths must prove **zero forbidden side effects**. For PAY-02 use exact integer seconds, rational arithmetic and single employee-period half-up rounding; local midnight/DST fixtures must be independently verified. For database guards test using least-privileged application role, not superuser. For security ensure no raw token, password, secret or activation URL in logs, backup, outbox or fixtures.

## PASS/HOLD and release gates

- **QA-FINAL DESIGN PASS** requires full 113+18 inventory, valid traceability, no silently changed Owner policy, gap-specific fixtures/expected results and consistent manifest. Design PASS is not execution PASS.
- **Runtime QA PASS** requires all 97 P0 QA cases and 16 P0 DBT objectives executed PASS with reproducible evidence; P1 assessed with no unresolved blocking privacy, financial, tenant-isolation, accessibility or workflow defect. No automatic P0 waiver.
- G01–G05 remain separate release gates: Owner UAT and explicit go-live approval, local secret store fail-closed, production email/KMS/provider approval where applicable, encrypted off-server backup/restore and cost authorization. Production release HOLD until independently satisfied.
- The doc.20 publication changes only this documentation and its SHA-256 manifest. It does not authorize PK-02, outbox, code, migrations, paid services or PR merge.

## Precedence and handoff

Owner locks > API-SYNC docs/36–37 > UI-REVIEW docs/44–46 > DB-CONSTRAINT docs/50–51 > QA-SYNC docs/47–49 > historical examples. STOP+ASK for a policy conflict; no silent reinterpretation. Original 57 doc.19 files remain byte-identical.
