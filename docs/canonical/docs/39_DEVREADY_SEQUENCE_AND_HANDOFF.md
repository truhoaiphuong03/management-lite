# DEV-READY — Sequencing and evidence handoff (NOT an assignment)
Version: 0.1.0-doc.12 | No executor dispatched

| Stage | Future work packet | Depends on | Required proof | Release boundary |
|---|---|---|---|---|
| P0 | Verify canonical and choose deployment/key/email assumptions | Owner approval where necessary | manifest, explicit env and security choices | No code yet |
| P1 | Repository scaffolding, core schema, migration runner, audit/idempotency | P0 | fresh migrate, replay, schema tests | M00–M03 core only |
| P2 | Auth/session/invitation + HR | P1 | auth/tenant/activation tests | no public signup |
| P3 | ATT snapshots, correction requests, reviews | P2 | overlap, paused break, self-review denial, concurrency | no inferred time |
| P4 | PAY rates, exact calculation, finalized ledger | P3 | PAY-02 fixtures, atomic negative-net block | immutable finalize |
| P5 | REP revisions + ACC AEAD and reauth | P2 | immutable revisions, key failure, reveal/write proofs | no secret leakage |
| P6 | Unified phone-first UI | P2–P5 APIs | 360px, stable buttons, a11y, error states | shared AppShell |
| P7 | Integration, backup/restore, security and Owner UAT | P1–P6 | all in-scope P0 PASS | release decision by Owner |

Parallel work allowed only after boundaries and file ownership are explicitly defined; no overlap in active schema/contracts. Codex/Anti have NOT been assigned. No estimates can be justified without runtime/repository and staffing evidence.

## Test status
85 QA-03 cases defined, 0 executed; API-SYNC supplemental cases require QA matrix reconciliation before release. PASS here denotes documentation only, not application behavior.
