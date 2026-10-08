# QA-SYNC — Delta Acceptance Matrix (DESIGN ONLY)

Version `0.1.0-doc.16` · Parent `0.1.0-doc.15` · No tests executed.

Existing QA-03 cases retained: **85**. New explicit cases: **28**. Combined: **113**. All **NOT RUN**.

| ID | Priority | Owner / domain | Test assertion | Trace | Status |
|---|---|---|---|---|---|
| QS-API-001 | P0 | ATT | C01 paused forgotten clock-out requires explicit break-end evidence; otherwise blocked, no guessed payable seconds | C01; API-SYNC; UI06 | NOT RUN |
| QS-API-002 | P0 | ATT | C01 Owner decision and subsequent independent attendance approval cannot collapse into one transaction/approval | C01; RBAC-02; UI06/UI07 | NOT RUN |
| QS-API-003 | P0 | REP | C02 submitted revision concurrent If-Match stale and duplicate Idempotency-Key preserve exactly one new immutable revision | C02; UI10 | NOT RUN |
| QS-API-004 | P0 | ACC | C05 secret replace requires fresh one-use action/account/session scoped reauth, rejects proof for reveal or other account | C05; SEC-02; UI18 | NOT RUN |
| QS-API-005 | P0 | AUTH | C06 multiple membership without explicit authorized active workspace fails closed and does not leak membership details | C06; UI03/UI20 | NOT RUN |
| QS-API-006 | P0 | PAY | C04 negative net blocks atomic period finalize, including concurrent finalize/recalculation, with zero partial writes | C04; PAY-02; UI15 | NOT RUN |
| QS-DB-007 | P0 | ATT | C01 attendance correction decision produces immutable new version; approval targets current version and excludes open/paused versions | C01; PAY-02 | NOT RUN |
| QS-DB-008 | P0 | DB | Migration allowlist M00-M07 and M11 excludes M08-M10 WORK/Drive/Content-Video from V0.1 schema and grants | C03; G01 | NOT RUN |
| QS-DB-009 | P0 | DB | Cross-workspace composite FK and tenant isolation verified with two workspaces and concurrent requests | C06; RBAC-02 | NOT RUN |
| QS-OPS-010 | P0 | OPS | G02 Mac OS secret store available to local API; missing/locked store fails closed with no plaintext fallback | G02; SEC-02 | NOT RUN |
| QS-OPS-011 | P0 | AUTH | G03 fake email adapter is local-only, visibly simulated; no false real delivery or bypass of hashed invite token | G03; SEC-02; UI02/UI12 | NOT RUN |
| QS-OPS-012 | P0 | OPS | G04 daily encrypted off-server backup, 30-day retention and restore drill verify ciphertext plus independent key recovery | G04; SEC-02 | NOT RUN |
| QS-OPS-013 | P0 | OPS | G01 deployment gate prevents production release before Owner UAT; local fake provider cannot be deployed as real email | G01; G03 | NOT RUN |
| QS-OPS-014 | P0 | OPS | G05 no paid provider provisioning or cost commitment without explicit Owner approval evidence | G05 | NOT RUN |
| QS-UI-015 | P0 | UI | UI01-UI21 share single AppShell/tokens/components, no module-local duplicate button/dialog/toast or shell | UI-REVIEW; C03 | NOT RUN |
| QS-UI-016 | P0 | UI | Mobile 360/390/430, tablet 768, desktop 1280: no overflow, table-to-card retains actions and amounts | UI-REVIEW | NOT RUN |
| QS-UI-017 | P0 | UI | AppButton loading preserves dimensions and spinner width under rapid repeat taps, reduced motion and async failure | UI-REVIEW | NOT RUN |
| QS-UI-018 | P0 | ATT | C01 UI06 paused correction displays needs-evidence/blocked, Owner decision, independent review and payroll exclusion | C01; UI06/UI07 | NOT RUN |
| QS-UI-019 | P0 | REP | C02 UI10 displays immutable submitted revision timeline and stale revision recovery without data loss | C02; UI10 | NOT RUN |
| QS-UI-020 | P0 | PAY | C04 UI15 identifies negative employee and blocks all finalize, no success toast before server commit | C04; UI15 | NOT RUN |
| QS-UI-021 | P0 | ACC | C05 UI18 reauth for both reveal/change; clear secret on close/error; no telemetry, toast, browser storage | C05; SEC-02; UI18 | NOT RUN |
| QS-UI-022 | P0 | AUTH | C06 UI03/UI20 ambiguous workspace blocked; no selector or silent switch; direct URL permission denied | C06; UI03/UI20 | NOT RUN |
| QS-UI-023 | P1 | UI | UI01-UI21 keyboard navigation, focus restoration, visible errors, 200% zoom, screen reader and reduced motion | UI-REVIEW | NOT RUN |
| QS-UI-024 | P0 | UI | UI navigation Owner/Staff permissions and deep links: Staff ACC hidden and backend 403/404; Owner no self-approval or own pay | RBAC-02; UI05/UI07/UI16/UI17/UI18 | NOT RUN |
| QS-OPS-025 | P1 | OPS | Production email provider, KMS, server and backup target remain HOLD until selected, cost approved, integrated and tested | G01-G05 | NOT RUN |
| QS-QA-026 | P0 | QA | Every V0.1 route UI01-UI21 mapped to at least one acceptance case; each mutation has success, 401/403, 409/412/428 and offline state where applicable | UI-REVIEW; API-SYNC | NOT RUN |
| QS-QA-027 | P0 | QA | All release P0 cases have executed reproducible evidence with commit, commands, database/API/UI logs and Owner UAT; spec-only cannot PASS | QA-03; G01 | NOT RUN |
| QS-SCOPE-028 | P0 | SCOPE | No WORK/Drive/Content/Video V0.2 routes, endpoint registrations, tables, migrations or hidden flags enabled in V0.1 | C03; UI-REVIEW | NOT RUN |

## Execution evidence contract
Each case: fixture, actor and workspace, request/actions, expected HTTP and DB/audit, actual, screenshot/trace, commit SHA, tester, timestamp. Failed/blocked outcomes must assert zero unauthorized side effects. Do not infer pass from design.

## Scope and precedence
Owner locks PAY-02/RBAC-02/SEC-02/C01-C06/G01-G05 remain authoritative. API-SYNC docs/36-37, UI-REVIEW docs/44-46 supersede contradictory historical examples. WORK/Drive/Content/Video excluded from V0.1. No test scripts or product code created.
