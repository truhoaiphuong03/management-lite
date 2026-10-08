# QA-03 — V0.1 Acceptance Matrix (DESIGN ONLY)

Canonical 0.1.0-doc.9; inherits SCOPE-LOCK 0.1.0-doc.8. All cases are **NOT RUN**. No application code, database, environment, provider, or CI tests have been executed.

## Acceptance rules
- P0 100% PASS with reproducible evidence to consider release; no waived P0 without explicit Owner approval. P1 blocking defects resolved; P2 backlog only if non-regressive.
- For each case record: case ID, preconditions/fixtures, actor/workspace, action, expected HTTP + DB effects, audit, actual result, evidence link, commit SHA, tester/date. Never mark PASS from design text.
- Test isolation: workspace A/B, Owner A, Staff A/B, suspended Staff, multiple memberships, expired session, stale version, failed email provider, Redis-down, encryption key missing.
- Each mutation tested for unauthorized access, wrong workspace, stale If-Match, duplicate idempotency, and concurrent requests where applicable.

## Case register
| ID | Severity | Module | Acceptance assertion | Status |
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

## Deterministic arithmetic fixtures
1. 8h at 30,000 VND/h -> 240,000 VND.
2. 3,660 seconds at 25,000 VND/h -> exact 25,416 + 2/3 VND -> 25,417 after half-up once per employee/period.
3. A shift with 30-minute unpaid break and a rate boundary must be split into non-overlapping half-open segments; fixture expected result must be independently derived and verified against locked PAY-02, not blindly copied.
4. Local-midnight and DST/timezone changes: use stored workspace timezone snapshot and UTC boundaries; verify local date segments without overlap.
5. For multiple fractional lines, sum exact rational amounts then round once; demonstrate that per-line rounding would differ and is rejected.
6. C04: one employee negative net means no payroll period finalized and no partial item finalized; owner must resolve legitimate draft inputs.

## Evidence requirements
Postgres constraint proof (SQLSTATE and rollback), concurrency barrier traces, source snapshots, API request/response sanitized captures, security scans, real email delivery/unknown reconciliation, key-rotation and restore drill, mobile/desktop UI captures, build/typecheck/lint/audit and signed Owner UAT. All remain HOLD until executed.


## API-SYNC test extensions (doc.11; not executed)
Keep existing 85 canonical cases NOT RUN. Additional coverage targets and ARC traceability are in docs/37; do not mark any case PASS or silently increase counted cases.

## QA-SYNC doc.16 additive extension
The original 85 cases above remain unchanged and NOT RUN. See docs/47 for 28 new explicitly numbered cases and docs/48 for UI01–UI21 and G01–G05 traceability. Combined 113 cases, all NOT RUN.
