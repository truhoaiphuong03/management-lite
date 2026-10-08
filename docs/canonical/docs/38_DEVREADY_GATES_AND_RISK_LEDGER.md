# DEV-READY — Architecture and implementation-entry gate
Version: 0.1.0-doc.12 | 2026-10-08 | DESIGN ONLY | No code, no assignment

## Verdict
- DOCUMENTATION/SCOPE: PASS, conditional on authoritative doc.11 API-SYNC supersession.
- UNATTENDED IMPLEMENTATION START: HOLD; release: HOLD. No executable migrations, application, security validation, or QA run.
- A limited, explicitly Owner-authorized implementation phase may start only after entry gate checks; this document is not that authorization.

## Locked requirements
PAY-02, RBAC-02, SEC-02, C01–C06 unchanged. V0.1 includes AUTH/HR/ATT/REP/PAY/ACC, unified dark mobile UI, core audit/outbox/idempotency. WORK/Drive/Content/Video are V0.2 and must not leak into V0.1 migrations, UI or endpoints.

## Entry gates (before coding assignment)
| ID | Gate | Status | Evidence required |
|---|---|---|---|
| DG-01 | Canonical integrity, provenance, precedence | PASS document; verify on handoff | SHA manifest, doc.11 normative contracts override historical conditionals |
| DG-02 | Owner scope/business policy | PASS | doc.8 approval C01–C06, PAY/RBAC/SEC |
| DG-03 | DB implementation choices | HOLD | Exact executable schema strategy, PostgreSQL target/extension compatibility, transactional guard ownership, migrations naming and replay plan |
| DG-04 | Secrets key custody and recovery | HOLD | Owner-approved deployment secret store, backup/restore, key rotation, TLS origin, no default key |
| DG-05 | Workspace provisioning | HOLD operational | Deterministic preauthorized active binding, fail closed on zero/multiple |
| DG-06 | External email provider | HOLD operational | Credentials, retry/reconciliation plan, no delivered claim from accepted |
| DG-07 | UI design acceptance | PASS baseline, HOLD full inventory | Screens/components for every V0.1 route and state, stable controls |
| DG-08 | QA protocol | PASS specification; NOT RUN | 85 test cases and additions from doc.11, evidence templates |
| DG-09 | Owner permission to begin coding/assign | HOLD | Explicit Owner go-ahead, separate from this review |

## Release gates (after implementation)
- Fresh migrate/replay/checksum and real FK/exclusion/immutable-guard/concurrency tests PASS.
- All in-scope P0 tests PASS; no critical/high security vulnerabilities; session/CSRF/reauth/tenant isolation proven.
- Deterministic PAY-02 fixtures incl midnight/rate splits, one rounding, negative net full-period block.
- Email activation, outbox retries and failed/unknown states tested with provider; no false success.
- Key custody, encrypted backup/restore and rotation tested; production TLS/cookies and secret-redaction tested.
- 360px UI, keyboard, no button jitter, loading/error/empty states, mobile Owner UAT PASS.
- Owner signs release checkpoint; no real-data destructive migration or automatic rollback.

## Residual issue ledger
| ID | Severity | Blocker | Disposition |
|---|---|---|---|
| DR-01 | P0 | No executable DDL or DB guard proof (ARC-08) | Implement and test in controlled future phase |
| DR-02 | P0 | 85 QA cases NOT RUN (ARC-11) | Run on application, not a documentation failure |
| DR-03 | P0 | No deployment/security/email/restore/UAT evidence (ARC-12) | Operational release HOLD |
| DR-04 | P0 | Key custody and environment unspecified | Owner approval if provider, costs, security tradeoff |
| DR-05 | P0 | C01 paused open break evidence may be insufficient | Fail closed; request stays pending; no guessed paid seconds |
| DR-06 | P1 | Active workspace binding provisioning unproven | Implement fail-closed provisioning, no selector |
| DR-07 | P1 | Historical open-issue wording conflicts with doc.11 | Precedence: doc.11 normative + doc.8 decisions; mark legacy as historical |
| DR-08 | P1 | Migration DAG older optional M08/M09 language | doc.11 V0.1 allowlist supersedes |
| DR-09 | P1 | QA matrix predates API-SYNC | Add focused tests for C01 paused-break, idempotent secret-write without stored proof, workspace ambiguous binding |

## Hard STOP rules
No automatic clock-out, Owner self-approval, negative-pay clamping, plaintext secrets, silent workspace selection, V0.2 migration, financial history mutation, or silent policy invention. Unknown/conflict = STOP and seek Owner decision only if genuinely a business/security/cost tradeoff.
