# OWNER-GATE — Environment Decisions and Remaining Holds

Version: `0.1.0-doc.14` | Parent: `0.1.0-doc.13` | Status: **PASS Owner decision lock / HOLD implementation and production** | Date: 2026-10-08

## 1. Explicit Owner-approved choices

| ID | Status | Canonical selection | Non-negotiable guard |
|---|---|---|---|
| G01 | LOCKED | Mac local development, server deployment only after acceptance | No automatic provisioning or production release |
| G02 | LOCKED | OS secret store locally; production KMS/secret manager | AEAD and reauth per SEC-02; encryption keys outside database, repository, logs and DB backups |
| G03 | LOCKED | Email adapter; fake delivery locally, production provider selected later | No real invitation delivery claims from fake adapter; durable outbox and activation semantics unchanged |
| G04 | LOCKED | Encrypted daily backups stored off-server, 30-day retention, periodic restore verification | Recovery must be tested; key recovery independent from DB backup |
| G05 | LOCKED | No paid-service commitment without explicit Owner approval | No unapproved provider subscription, procurement or costs |

## 2. Interpretation and boundaries

- G01 defines deployment **sequence**, not the selected production provider or staging topology.
- G02 defines **class of secret custody**, not a specific KMS, local API, rotation interval or billing. Local OS secret store must be compatible with headless API process and recoverable dev setup; unresolved implementation must STOP rather than fall back to plaintext.
- G03 fake adapter is **local-only** and may simulate accepted/rejected/delivered states for testing, clearly labeled as simulated. Production staff activation remains HOLD until actual provider integration and delivery/retry evidence.
- G04 is a **required future control**, not proof backups are running. Off-server means an independently recoverable target, not another directory on the same host. Restore testing frequency and recovery targets must be documented and approved as operational choices before go-live.
- G05 requires Owner approval for **any cost commitment**; design can evaluate options without buying them.

## 3. Gate register

| Gate | Status | Evidence required |
|---|---|---|
| Environment policy G01–G05 | PASS LOCKED | Explicit Owner confirmation |
| PAY-02 / RBAC-02 / SEC-02 / C01–C06 unchanged | PASS document integrity | Existing normative documents remain byte-identical to parent |
| Development toolchain | HOLD | Runtime/PG version compatibility and reproducible setup |
| Local key store and secret recovery | HOLD | OS integration test, no plaintext fallback, access and recovery tests |
| Production KMS and server | HOLD | Provider selection, cost approval, TLS and KMS integration |
| Real email | HOLD | Provider approval, delivery, retry, outbox and activation tests |
| Backup and restore | HOLD | Encryption, off-server retention job, restore drill, key recovery |
| Workspace binding and tenant isolation | HOLD | Provisioning contract and integration tests |
| UI and QA sync | HOLD | Screen inventory, updated acceptance tests, execution evidence |
| Start coding | HOLD | Explicit Owner authorization, not implied by this approval |
| Production go-live | HOLD | All P0 tests, security, migration, backup/restore and Owner UAT |

## 4. Next design-only steps

1. UI-REVIEW: finalize single AppShell, mobile-first screen inventory, states, permissions and visual consistency.
2. QA-SYNC: reconcile QA-03 with API-SYNC, PRE-DEV and G01–G05; define local fake-email and backup/recovery test obligations.
3. START-GATE: determine coding entry conditions and request explicit Owner authorization.

No code, migration, repo creation, executor task, payment or provider activation is authorized by this document.
