# START-GATE — Decision and readiness evidence
Version: 0.1.0-doc.18 | 2026-10-08 | DESIGN REVIEW ONLY

## Decision
**PASS: readiness assessment and scoped implementation planning. HOLD: authorization to begin coding or dispatch executors. HOLD: production/release.** No authorization is inferred from this document. Owner must issue separate explicit START approval.

## Immutable Owner locks
PAY-02, RBAC-02, SEC-02, C01–C06, G01–G05 and V0.1 scope unchanged. M08 WORK, M09 Drive, M10 Content/Video excluded. No paid provider selection without Owner approval.

## Entry gate — can implementation start after explicit Owner approval?
| ID | Gate | Status | Evidence / disposition |
|---|---|---|---|
| SG-01 | Canonical document baseline and manifest | PASS design | doc.17 baseline audited, doc.18 supplements only |
| SG-02 | Owner policies and module ownership | PASS design | Owner locks + PRE-DEV boundaries |
| SG-03 | API/workflow/DB/UI acceptance contracts | PASS with conditions | DBF guards specified, no executable proof |
| SG-04 | Repository identity, access and clean baseline | HOLD | No repo created or verified; choose isolated management-lite repository |
| SG-05 | Local Mac toolchain versions, PostgreSQL capabilities and migrations | HOLD | Verify installed versions, extension permissions and migration strategy before DB coding |
| SG-06 | OS secret-store adapter and key recovery test plan | HOLD | Design approved G02; actual availability unverified |
| SG-07 | Email fake adapter/outbox boundary | PASS design | G03; no real email delivery claim |
| SG-08 | Work packet owners, shared-file locking, review and rollback | HOLD | packets proposed, no executor assigned or file ownership approved |
| SG-09 | QA coverage | PASS test specification; NOT RUN | 113 cases + DBT-01..18 need dedupe; no runtime test results |
| SG-10 | Production KMS, email provider, HTTPS, backup/restore | HOLD production | Not a prerequisite to scaffold locally with synthetic data; mandatory before production |

## Minimum safe start prerequisites (no code until explicit Owner authorization)
1. Owner explicitly approves **START-CODE** and identifies intended repository/project; do not conflate START-GATE review with authorization.
2. Confirm a new isolated repository (not the older management-system or V4 repo), clean initial baseline, access and branch/PR controls.
3. Verify Mac local Node/npm/PostgreSQL toolchain, database isolation, `btree_gist` support or stop for reviewed equivalent. No destructive DB action.
4. Define first work packet and single-writer ownership of shared contracts, schema and migrations.
5. Define local fake email, no real recipients, synthetic data, no plaintext secret fixtures, secret-store capability check and fail-closed behavior.
6. Establish CI/test commands, migration rollback/recovery strategy and evidence template before implementing business modules.

The Owner may authorize a *limited foundation-only scaffold* once items 1–6 are satisfied, while production prerequisites remain HOLD. Such approval must be explicit, scoped, and does not approve release or payment.

## Execution sequence (future, not dispatched)
P0 repo/toolchain/CI; P1 core DB and integrity guards; P2 AUTH+HR; P3 ATT; P4 PAY; P5 REP and ACC with distinct ownership; P6 unified UI; P7 integrated QA, production controls, restore and Owner UAT. No overlapping schema/contracts changes. At each packet require diff, tests, risk assessment, rollback, Owner review where policy/expense/security changes.

## Release gate (separate from START-CODE)
All applicable P0 tests pass; reconcile 113 QA cases and 18 DBT targets; enforce migrations and cross-tenant integrity; verify session/CSRF/reauth/AEAD, backup and restore with key recovery, email delivery, UI accessibility, Owner UAT. Production provider/expense decisions separately approved. Until then: RELEASE HOLD.

## Explicit non-actions
No code, repo creation, migration execution, purchases, production deployment, or Codex/Anti assignment occurred.
