# HANDOFF-REVIEW — Packet Ownership and Dependencies (NORMATIVE HANDOFF PLAN)
Version 0.1.0-doc.19 | DESIGN ONLY | NO DISPATCH

## Authorization boundary
No repo creation, code, migration, executor assignment or payment is authorized. Owner approval for START-CODE must be separate. All path assignments below are **proposed exclusive ownership for future work**, not assignments to Codex or Anti. Repo paths are conceptual until a repository exists. Locked PAY-02/RBAC-02/SEC-02/C01–C06/G01–G05 prevail over historical wording.

## Exclusive ownership / permitted paths / acceptance
| Packet | Dependency | Exclusive future write scope | Shared change process | Required evidence / STOP |
|---|---|---|---|---|
| PK-00 foundation | Explicit Owner START-CODE + SG-04..08 evidence | root config, CI, apps skeleton, packages scaffolding | one designated foundation writer; no business tables | pinned runtime, clean base, CI commands, secrets ignored, no old repo touched |
| PK-01 DB/platform | PK-00 | packages/database, infrastructure/migrations, audit/outbox/idempotency platform | **sole migration and schema writer**; schema contract changes via review | clean migration/replay/checksum, tenant FK, concurrency, immutable guards; stop on destructive operation |
| PK-02 AUTH/HR | PK-01 | modules/auth, modules/hr, API route adapters in owned namespaces | shared contracts only through contract-owner review | RBAC, invitation, CSRF, session, staff activation, workspace isolation |
| PK-03 ATT | PK-02 | modules/attendance, owned API routes | any schema delta requested through PK-01 migration owner | immutable shift version, C01 paused-break evidence, Owner no self-approval, overlap tests |
| PK-04 PAY | PK-03 | modules/payroll, owned API routes | schema through PK-01; read ATT approved snapshot contract only | PAY-02 fixtures, exact seconds/one rounding, negative net atomic block, immutable ledger |
| PK-05 REP | PK-02 | modules/reports, owned API routes | shared contract via reviewer; no ATT/PAY write | C02 revision history and concurrent edits tests |
| PK-06 ACC | PK-02 + G02 local secret-store check | modules/accounts, security adapter owned interfaces | security/reauth shared interfaces single writer; schema via PK-01 | SEC-02 AEAD, C05 reauth on reveal/write, zero secret leaks, fail closed |
| PK-07 UI | stable owned API contracts; may plan earlier | apps/web, packages/ui | **sole shared AppShell/tokens/component writer**; module pages must consume components | UI21 coverage, 360/390/430/768/1280 widths, no jitter, role access, a11y |
| PK-08 QA/release evidence | PK-01..07 | tests, evidence reports, runbooks | no production mutation without Owner approval | 113 QA + DBT dedupe, P0 all pass, restore, key recovery, UAT; release separately gated |

## Cross-module ownership rules
- Shared contracts: `packages/contracts` has **one nominated writer per change window**, independent reviewers approve compatibility; modules cannot edit it opportunistically.
- Schema/migrations: `packages/database` and `infrastructure/migrations` have one nominated writer; module author proposes changes via interface request, no direct migration edits.
- Shared security/OS secret-store adapter: one nominated security owner; ACC consumes the contract. Do not duplicate crypto implementation.
- Shared UI: one nominated design-system writer; module screens use tokens and components, no independent theme/button implementations.
- PLATFORM audit/outbox/idempotency owns infrastructure mechanics, business module owns domain decision; no cross-module direct writes.
- One active owner per path, no parallel PRs editing same shared files. No cherry-pick or merge without conflict review.

## Parallel windows
PK-05 and PK-06 may proceed in parallel **only after** PK-02 and explicit disjoint paths/contracts. PK-07 design preparation may parallelize but API integration waits for stable contracts. PK-03 precedes PK-04. PK-01 migration owner serializes all database schema changes.

## V0.1 scope fence
Only AUTH, HR, ATT, REP, PAY, ACC, PLATFORM and unified UI. M00–M07 plus necessary M11 guards only. M08 WORK, M09 Drive, M10 Content/Video and their UI/endpoints are V0.2; never scaffold feature-specific migrations in V0.1.
