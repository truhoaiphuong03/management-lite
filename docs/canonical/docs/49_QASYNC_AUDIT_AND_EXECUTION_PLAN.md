# QA-SYNC — Audit, Gap Register and Execution Protocol

Version `0.1.0-doc.16` | PASS specification / HOLD runtime

## Audit findings
| ID | Observation | Resolution | State |
|---|---|---|
| QS-A01 | 85 legacy QA-03 tests lacked explicit API-SYNC C01 paused evidence | QS-API-001/002 and QS-DB-007 | PASS design |
| QS-A02 | C02 concurrency/revision insufficiently explicit | QS-API-003 and QS-UI-019 | PASS design |
| QS-A03 | C05 secret change proof binding needed explicit regression | QS-API-004 and QS-UI-021 | PASS design |
| QS-A04 | C04 atomic negative payroll and concurrency | QS-API-006 and QS-UI-020 | PASS design |
| QS-A05 | C06 multiple memberships fail-closed | QS-API-005 and QS-UI-022 | PASS design |
| QS-A06 | G01-G05 were not individually acceptance-traced | QS-OPS-010..014 and QS-OPS-025 | PASS design |
| QS-A07 | 21 UI screens lacked complete trace map | docs/48 maps UI01-UI21 | PASS design |
| QS-A08 | UI accessibility, responsive, button jitter need expanded tests | QS-UI-015..024 | PASS design |
| QS-A09 | V0.2 migration exclusion needs allowlist test | QS-DB-008 and QS-SCOPE-028 | PASS design |
| QS-A10 | Runtime QA, SQL constraints, email/KMS/restore untested | Require execution artifacts; never claim PASS | HOLD runtime |

## Test execution layers (future, NOT RUN)
1. DB: PostgreSQL composite FK, exclusion, immutability, migration allowlist, rollback, recovery.
2. API: all status codes, Idempotency-Key/If-Match, CSRF, sessions, scoped reauth, fail-closed workspace.
3. Concurrency: clock-in, paused correction/approval, report revisions, negative finalize, one-use reauth, outbox retry.
4. UI: 21 screens, 360/390/430/768/1280px, 200% zoom, keyboard/screen reader, stable buttons, role-specific nav.
5. OPS: local fake email clearly simulated, OS secret store, real production email/KMS after Owner-approved provider, encrypted daily off-server 30d backups and restore drills.
6. Release: all P0 executed PASS, no critical P1, Owner UAT, explicit separate go-live authorization.

## Current HOLD
No repository, application, database migrations, test automation, provider integration, screenshots, or execution evidence exists in this canonical. G01-G05 are policies, not running services. START-GATE and coding authorization remain HOLD.

## Historical QA-02 V0.2 references
docs/08 includes WORK/Drive/storage examples from earlier design; they are historical/V0.2-only. They do NOT create V0.1 release obligations or routes. docs/31 + docs/47-48 are the current V0.1 QA contract.
