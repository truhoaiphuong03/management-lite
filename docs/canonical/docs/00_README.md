# Management Lite V0.1 — Canonical Pack
Version: 0.1.0-doc.1 | Date: 2026-10-08 | Status: DESIGN BASELINE — NOT IMPLEMENTED

## Authority
Owner approves business policy and release scope. ChatGPT acts as architect/reviewer. Executors Codex/Anti are not yet assigned. This pack is a consolidation of decisions discussed in chat, not a repository commit, migration, or evidence of working software.

## Precedence
Owner-approved decisions > canonical domain model > data dictionary > module registry > API contracts > decision log > UI/QA examples. Conflicts or unknowns: STOP + ASK, no silent assumptions. Use minimal diff, zero regression, additive-first migrations, no secret disclosure.

## Files
01_SCOPE_AND_DOMAIN.md; 02_MODULE_REGISTRY.md; 03_DATA_DICTIONARY.md; 04_RBAC.md; 05_API_CONTRACTS.md; 06_UI_DESIGN_SYSTEM.md; 07_PAYROLL_POLICY.md; 08_QA_ACCEPTANCE.md; 09_DECISION_LOG.md; 10_MIGRATION_AND_RELEASE.md; 11_OPEN_ISSUES.md; 12_DATA_FLOW.md.

## Delivery state
No code, tests, database migrations, repository edits, executor assignments or live deployments have been performed as part of DOC-01.

## DOC-02 amendment
See docs/13..17 for architecture corrections. Technical DOC-02 decisions supersede conflicting baseline notes; Owner-approved policy always takes precedence. DOC-02 is design-only, not executable DDL.

## SEC-02 addendum
See `18_SEC02_SECURITY_ARCHITECTURE.md` (version 0.1.0-doc.3). Security design baseline only; implementation and security verification HOLD.

## FLOW-02 update (0.1.0-doc.4)
See `19_FLOW02_WORKFLOW_STATE_MACHINES.md` for canonical state transitions, authority, idempotency, and STOP gates. This revision is a design-only addendum; no code or repository modification.


## DB-READY v0.1.0-doc.5
Read docs/20..23 for column contracts, FK/index/guards, migration DAG and traceability. This is design-only; no executable SQL, tests, repo changes or executor assignments.

## API-READY update (0.1.0-doc.6)
See docs/24-27 for detailed endpoint matrix, HTTP contract, concurrency and open gates. Design only; no code or test evidence.


## SCOPE-REVIEW doc.7
See docs/28_SCOPE_REVIEW_RELEASE_MATRIX.md and docs/29_SCOPE_REVIEW_DECISIONS_AND_GATES.md. V0.1 release classification PASS (design); final scope freeze and DEV-READY HOLD.

## Current canonical (2026-10-08)
Version `0.1.0-doc.8` — SCOPE-LOCK after explicit Owner approval C01–C06. See `30_SCOPE_LOCK_OWNER_APPROVAL.md`. V0.1 release scope is S01–S11; WORK/Drive full modules are V0.2. Design scope PASS; implementation and release HOLD. Older conditional C01–C06 text is retained for traceability only.


## QA-03 (0.1.0-doc.9)
Adds 31_QA03_ACCEPTANCE_MATRIX, 32_QA03_TRACEABILITY_AND_RELEASE_GATES, 33_QA03_EXECUTION_PROTOCOL. All cases NOT RUN. Owner-approved C01-C06 unchanged; WORK/Drive V0.2.

## ARCH-RECHECK doc.10
Cross-audit found 16 technical/documentary gaps (6 P0, 10 P1). See docs/34_ARCH_RECHECK_FINDINGS.md and docs/35_ARCH_RECHECK_API_SYNC_BACKLOG.md. Owner policy unchanged. Audit PASS; canonical harmonization and implementation readiness HOLD.


## API-SYNC doc.11 — normative precedence
Read `36_APISYNC_NORMATIVE_CONTRACTS.md` and `37_APISYNC_STATES_GUARDS_TRACEABILITY.md` for the current V0.1 API, status, error and migration scope. Earlier conditional HOLD text is historical where superseded; Owner PAY-02/RBAC-02/SEC-02/C01–C06 prevail. Design-only; DEV-READY HOLD.


## PRE-DEV doc.13 (2026-10-08)
Docs 40-42 define proposed environment, repository, ownership and work packets. Planning PASS, start/release HOLD. No code or executor assignment.


## Canonical doc.14 — OWNER-GATE
Owner explicitly approved environment choices G01–G05. See `43_OWNER_GATE_APPROVAL_AND_HOLDS.md` and `09_DECISION_LOG.md`. Design-only; all earlier PAY-02/RBAC-02/SEC-02/C01–C06 constraints remain. No implementation authorization.

## UI-REVIEW v0.1.0-doc.15
See docs/44–46. These are normative V0.1 UI contracts and audit gates; V0.2 screen examples in UI-02 are not V0.1 release scope. No code or UI tests executed.

## QA-SYNC doc.16
See docs/47–49. Original 85 QA-03 cases preserved; 28 additional test specifications; all NOT RUN. UI01–UI21, C01–C06 and G01–G05 traceability. No code or release authorization.


## DB-CONSTRAINT doc.17
DB-CONSTRAINT design audit docs 50–51 are normative for DB enforcement and migration scope. No executable SQL or runtime PASS. Previous Owner locks unchanged.

## START-GATE v0.1.0-doc.18
See docs/52 and docs/53. Readiness review PASS; implementation authorization HOLD pending explicit Owner approval. Release HOLD. Historical status references are superseded by this gate for current readiness only.


## HANDOFF-REVIEW doc.19
Docs 54–56 define future exclusive packet/file ownership, acceptance/rollback evidence, and remaining gates. This is design-only: no code, repo, migration or executor assignment. Owner locks and normative API-SYNC/DB-CONSTRAINT supersede historical text.
