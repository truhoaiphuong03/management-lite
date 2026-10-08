# DOC-02 — Decision and traceability log
Status: technical remediation DESIGN LOCK, implementation readiness HOLD. No Owner business policy changed.

| ID | Technical decision | References |
|---|---|---|
| DOC2-01 | Immutable attendance shift versions and version-bound approval | AR-01, PAY-026, QA-02 |
| DOC2-02 | Exact worked interval partition; one source allocation | AR-03, PAY-021..024 |
| DOC2-03 | Immutable finalized payroll + separate correction ledger | AR-02, PAY-027 |
| DOC2-04 | Composite workspace FKs, restrictive delete, guarded resource grants | AR-04/08/10, RBAC-02 |
| DOC2-05 | 412 precondition mismatch vs 409 business conflict | AR-07/15, API-02 |
| DOC2-06 | Separate activation invite state from provider email state | AR-05, AUTH-04 |
| DOC2-07 | Two-phase revision-bound Drive Trash with reconciliation | AR-06/19, STO-01 |
| DOC2-08 | Channel metadata owned by WORK foundation; ACC secrets Owner-only | AR-12, Module Registry |
| DOC2-09 | Freeze timezone in payroll snapshot, never reinterpret finalized history | AR-18, PAY-02 |
| DOC2-10 | Status registry and version-bound work reviews | AR-14/16, UI-02 |
| DOC2-11 | Migration DAG respects FK and defers specialized Content/Video to V0.2 | AR-17, Scope |
| DOC2-12 | No DEV-READY PASS without executable DDL, SEC-02 and P0 evidence | AR-08/19, QA-02 |

### Outstanding policy STOP/ASK
Negative net pay, taxes/insurance, settlement, and Owner compensation/approval are NOT decided here and must not be inferred.
