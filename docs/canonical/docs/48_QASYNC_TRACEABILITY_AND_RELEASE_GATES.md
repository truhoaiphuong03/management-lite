# QA-SYNC — Traceability, UI Inventory, Owner Gates and Release Rules

Version `0.1.0-doc.16` | DESIGN ONLY | All tests NOT RUN.

## UI01–UI21 coverage map
| Screen | Acceptance IDs |
|---|---|
| UI01 | Q3-AUTH-005, Q3-UI-001, QS-UI-015 |
| UI02 | Q3-AUTH-002, Q3-AUTH-003, QS-OPS-011 |
| UI03 | Q3-AUTH-008, QS-API-005, QS-UI-022 |
| UI04 | Q3-ATT-001..003, Q3-UI-003, QS-UI-017 |
| UI05 | Q3-ATT-004, Q3-UI-005, QS-UI-024 |
| UI06 | Q3-ATT-006..008, QS-API-001, QS-UI-018 |
| UI07 | Q3-ATT-004..005, QS-API-002, QS-UI-018 |
| UI08 | Q3-REP-001..003, QS-UI-015 |
| UI09 | Q3-REP-001, Q3-UI-007 |
| UI10 | Q3-REP-002, Q3-REP-005, QS-API-003, QS-UI-019 |
| UI11 | Q3-HR-001..003, Q3-UI-001 |
| UI12 | Q3-AUTH-004, Q3-HR-002, QS-OPS-011 |
| UI13 | Q3-HR-002..005, Q3-API-005 |
| UI14 | Q3-PAY-001, Q3-UI-001 |
| UI15 | Q3-PAY-008..010, QS-API-006, QS-UI-020 |
| UI16 | Q3-PAY-005, Q3-SCOPE-003, QS-UI-024 |
| UI17 | Q3-ACC-001, Q3-UI-005, QS-UI-024 |
| UI18 | Q3-ACC-004..006, QS-API-004, QS-UI-021 |
| UI19 | Q3-OPS-003, Q3-ACC-006 |
| UI20 | Q3-AUTH-006..008, QS-API-005, QS-UI-022 |
| UI21 | Q3-API-002, Q3-API-005, QS-UI-024 |

## C01–C06 new delta trace
| Lock | New cases |
|---|---|
| C01 | QS-API-001, QS-API-002, QS-DB-007, QS-UI-018 |
| C02 | QS-API-003, QS-UI-019 |
| C03 | QS-DB-008, QS-SCOPE-028 |
| C04 | QS-API-006, QS-UI-020 |
| C05 | QS-API-004, QS-UI-021 |
| C06 | QS-API-005, QS-DB-009, QS-UI-022 |

## G01–G05 new delta trace
| Gate | New cases | Release evidence |
|---|---|---|
| G01 | QS-OPS-013, QS-OPS-025 | Owner UAT and explicit deployment approval |
| G02 | QS-OPS-010, QS-OPS-012, QS-UI-021 | Local OS secret store fail-closed; KMS production pending |
| G03 | QS-OPS-011, QS-OPS-013, QS-OPS-025 | Fake email labeled; real provider delivery pending |
| G04 | QS-OPS-012, QS-OPS-025 | Daily encrypted off-server, 30d, restore drill |
| G05 | QS-OPS-014, QS-OPS-025 | Owner approval before any paid commitment |

## P0/P1 release gates
- Every P0 case from QA-03 and QA-SYNC must be executed and PASS with reproducible evidence. Any failing P0 blocks release.
- P1 failures triaged with evidence; no unresolved defect that compromises core workflow, accessibility, privacy, financial correctness or tenant isolation.
- UI screenshots/browser runs, API negative/concurrency tests, actual PostgreSQL constraints and migration rehearsals, local key custody, production KMS/provider/backup and restore all HOLD until proven.
- G01–G05 LOCKED means policy approved, not provider configured, no server, no email delivered, no backup taken.
- Test specifications may be drafted before coding; execution requires implementation and Owner authorization to start coding.
- QA-SYNC does not authorize repository, code, migration, provider purchases or executor assignment.
