# QA-03 — Traceability and Coverage

Version 0.1.0-doc.9 | design only | all tests NOT RUN.

## Owner scope decision coverage
| Decision | Mandatory test cases | Failure to prevent |
|---|---|---|
| C01 | Q3-ATT-006,007,008; Q3-API-006; Q3-UI-006 | Invented clock-out, self-approval, unapproved payroll |
| C02 | Q3-REP-002,003,005; Q3-API-006; Q3-UI-006 | Overwritten submitted report |
| C03 | Q3-DB-006, Q3-SCOPE-002,003 | V0.2 WORK/Drive leaked into release |
| C04 | Q3-PAY-008,009,010; Q3-API-007; Q3-UI-006 | Negative or partially finalized payroll |
| C05 | Q3-ACC-004,005,006; Q3-API-007; Q3-UI-006 | Secret update without reauth |
| C06 | Q3-AUTH-008, Q3-API-005, Q3-UI-008 | Silent workspace switching or cross-tenant access |

## Previous review coverage
- AR-01..03: ATT snapshots and PAY segments, no overlap: Q3-ATT-004,008,009; Q3-PAY-001..011.
- AR-04..08: DB FK, activation, async boundaries, concurrency, migrations: Q3-DB-001..006; Q3-AUTH-002..004; Q3-API-003..005.
- AR-09..20: workspace identity, states, report revisions, channels/WORK deferred, timezone, ACL deferred, API trace: Q3-AUTH-008; Q3-HR-001..005; Q3-REP-001..005; Q3-SCOPE-002..003; Q3-API-006..007.
- SEC-T01..T12: ACC, AUTH, API, DB and OPS suites; Drive ACL/T11 deferred because C03 places Drive in V0.2. No production Drive operations authorized.
- PAY-02: Q3-PAY-001..012, Q3-ATT-004..010, deterministic fixtures.
- RBAC-02: Q3-HR, Q3-API-002,005, Q3-ACC-001, Q3-ATT-005.
- SEC-02: Q3-AUTH, Q3-ACC, Q3-OPS, Q3-API.

## STOP/ASK items, not new business policy
- Clarify acceptance detail for C01 when a forgotten shift remains in `paused` state: no guessed clock-out; define explicit resolution transition before implementation.
- Confirm C04 allowed resolution method only when encountered; no automatic writeoff, carryforward, or negative finalization.
- Provider-specific email delivery, key custody, backup retention and deployment costs remain environment-dependent; require Owner approval where costs or security tradeoffs arise.
- API-READY prior text may still contain historical HOLD labels for C01–C06; SCOPE-LOCK doc.8 supersedes them. API contract harmonization must be verified in ARCH-RECHECK.

## QA-SYNC doc.16
See docs/48 for updated 21-screen matrix, six Owner scope decisions and five environment decisions; docs/47 extends the 85 baseline with 28 NOT RUN cases.
