# Consolidated Decision Log

## Owner-approved, LOCKED
- HR-03: Owner/Staff authorization roles distinct from Content/Editor positions; single identity, future effective-dated multiple positions.
- ATT-01/02: server-timestamp clock-in/pause/resume/clock-out, Owner review, Owner may clock, cannot self-approve.
- PAY-021: overnight split by actual local day.
- PAY-022: rate changes split by effective interval.
- PAY-023: exact seconds.
- PAY-024: half-up once per period base pay.
- PAY-025: Owner clocks but excluded from payroll.
- PAY-026/028: only approved completed work; no inferred clock-out.
- PAY-027: finalized finance immutable, append-only correction.
- ACC-01: Owner-only managed account secrets; login credentials one-way hash; external secrets encrypted recoverably, reauth reveal.
- STO-01: Drive binaries, PostgreSQL metadata, revision-bound receipts, Owner-only conditional Trash.

## Architecture baseline (design-approved in chat; not code)
- DATA-041..054: PostgreSQL truth, UUID, snake_case, workspace isolation, UTC instants, integer VND/seconds, additive migrations, no plaintext secrets.
- API-001..010: /api/v1, standard envelopes, backend RBAC, server time, idempotency, revision-bound reviews, separate draft/finalize, durable external operations.
- UI-021..032: one dark-only Design System, mobile-first AppShell, shared components, stable buttons, async state truthfulness.
- QA-021..030: contract-linked tests, P0 gates, backend RBAC tests, payroll arithmetic, concurrent retries, UI consistency, evidence required.

## No authority to assume
Unresolved implementation-level choices and release phase boundaries are recorded in 11_OPEN_ISSUES.md. No destructive changes, unapproved spending or V0.2 expansion.

## DOC-02 technical decisions
DOC2-01..12 in 17_DOC02_DECISION_AND_TRACEABILITY.md; no Owner-approved PAY-02/RBAC-02 policy changed.

## SEC-02 technical security decisions
SEC-021..032: see `18_SEC02_SECURITY_ARCHITECTURE.md`; no Owner policy changes.

## FLOW-02 — Design decisions
FLOW-021..FLOW-030 documented in `19_FLOW02_WORKFLOW_STATE_MACHINES.md`. No changes to Owner-approved PAY-02 or RBAC-02.


## DB-READY decisions
DBR-01..DBR-12 are listed in docs/23_DBREADY_TRACEABILITY.md. They do not override PAY-02, RBAC-02 or SEC-02.

## API-READY technical decisions (0.1.0-doc.6)
API-R01..API-R14 are documented in docs/27_APIREADY_TRACEABILITY_AND_HOLDS.md; Owner-approved PAY/RBAC/SEC/scope rules remain unchanged.


## SCOPE-REVIEW doc.7
SCP-D01..SCP-D10 recorded in docs/29_SCOPE_REVIEW_DECISIONS_AND_GATES.md; no Owner policy overridden.

## OWNER APPROVAL — SCOPE-LOCK (2026-10-08, doc.8)
These six choices are explicitly Owner-approved, superseding only prior *conditional* C01–C06 entries in doc.7; PAY-02, RBAC-02 and SEC-02 remain unchanged.

| ID | Approved decision | Invariant / implementation boundary |
|---|---|---|
| C01 | Employee requests forgotten clock-out correction; Owner decides actual corrected clock-out | No automatic/inferred end time; employee provides reason, Owner records explicit time and audit; approved current immutable shift version required before payroll. Owner cannot self-approve their own attendance. |
| C02 | Employee may submit a new revision after daily report submission | Submitted prior versions remain immutable, timestamped and attributable; no overwrite. |
| C03 | WORK and Drive deferred to V0.2 | No WORK/Drive UI, endpoints, or feature-specific migrations in V0.1 release. Foundation references are design-only; generic storage abstraction may remain where core depends on it. |
| C04 | Negative net pay blocks finalize pending Owner resolution | No clamp-to-zero, silent carryforward or negative finalized item. Block atomic payroll-period finalize if any affected employee item negative; Owner must correct permissible draft inputs or defer pending separately approved policy. |
| C05 | Reauthentication mandatory for changing/replacing managed-account secret | Same SEC-02 action-scoped, short-lived, single-use mechanism; reveal continues to require reauth; audit without secret values. |
| C06 | V0.1 uses one explicitly authorized active workspace context; no workspace selector | Do not silently switch workspaces. Membership and workspace isolation remain enforced; multi-membership underlying identity not deleted. |

**Authority:** User's explicit approval in conversation. **Scope:** design only; no code, repo, migration, executor task or release approval. **Status:** C01–C06 RESOLVED/LOCKED; QA/real integration/production readiness still HOLD.


## QA-03 (design-only)
QA03-01: V0.1 test matrix is specified, not executed; no P0 waiver without Owner. QA03-02: C01-C06 tests required; C03 excludes WORK/Drive. QA03-03: immutable and security failures are release blockers. No Owner policy changed.

## ARCH-RECHECK doc.10 (audit disposition, no policy change)
ARCH-R01 C01-C06 Owner approvals remain normative. ARCH-R02 legacy conditional HOLD entries historical only. ARCH-R03 API-SYNC required before DEV-READY. ARCH-R04 WORK/Drive excluded V0.1. ARCH-R05 all QA-03 NOT RUN. See docs/34-35.


## API-SYNC doc.11 (technical harmonization, no new Owner policy)
APIS-01 employee-owned C01 request and Owner decision are distinct from review; APIS-02 C02 immutable submitted revision; APIS-03 C05 write requires single-use reauth; APIS-04 C06 preauthorized binding fail-closed; APIS-05 C04 negative net blocks entire period; APIS-06 C03 migration/API allowlist; APIS-07 error/status registry; APIS-08 cross-table transaction guards. See docs/36–37. PAY-02/RBAC-02/SEC-02 and C01–C06 unchanged.


## PRE-DEV doc.13 — Planning-only technical recommendations
PREDEV-01 repository layout proposed, not created. PREDEV-02 module/table ownership and one migration writer. PREDEV-03 entry gates DG-03..09 remain HOLD. PREDEV-04 no executor assignment or implementation permission. No change to PAY-02, RBAC-02, SEC-02, C01-C06. See docs/40-42.


## OWNER-GATE — Explicit Owner approval (2026-10-08, doc.14)

These are **LOCKED Owner decisions** G01–G05, superseding only prior pending environment options. They do not change PAY-02, RBAC-02, SEC-02 or C01–C06.

| ID | Locked decision | Boundary / remaining HOLD |
|---|---|---|
| G01 | Develop locally on Mac; deploy to server only after acceptance | Server/provider, staging, HTTPS and deployment readiness remain HOLD; no automatic server provisioning. |
| G02 | Local OS secret store; production KMS/secret manager | Provider, key versioning/rotation, backup key recovery, access controls, cost and integration evidence HOLD. Never put plaintext key in DB/repo/log/DB backup. |
| G03 | Email adapter with local fake transport; choose production email provider later | Fake transport only in development; actual employee invitations in production blocked until real provider, delivery/retry evidence and authorization are approved. |
| G04 | Encrypted daily backup off-server, retain 30 days, periodic restore verification | Backup target/provider, encryption/key custody, schedule implementation, restore cadence/RPO/RTO and restore evidence HOLD. No claim that backups exist. |
| G05 | No paid subscription, purchase or cost commitment without Owner approval | Pricing/provider selection and spending authority remain HOLD. |

**Authority:** Owner's explicit confirmation in chat. **Status:** G01–G05 policy LOCKED; implementation and production gates HOLD. **No code, repo, migration or executor assignment authorized.**

## UI-REVIEW doc.15 (design clarification only)
Single dark AppShell, shared components, V0.1 UI01–UI21 route inventory, C01–C06 UI states and no WORK/Drive/Content/Video V0.1 screens. Owner policies PAY-02/RBAC-02/SEC-02/C01–C06/G01–G05 unchanged. UI implementation remains HOLD.

## QA-SYNC 0.1.0-doc.16
QA coverage expanded without changing Owner-approved PAY-02/RBAC-02/SEC-02/C01–C06/G01–G05. QA-03 85 cases retained; 28 new acceptance cases design-only; all NOT RUN. Production evidence and coding authorization remain HOLD.


## DB-CONSTRAINT doc.17
No new Owner policy decisions. DBF-01..16 are technical enforcement requirements, not policy changes. C01–C06, G01–G05, PAY-02/RBAC-02/SEC-02 remain LOCKED.

## START-GATE 2026-10-08 (0.1.0-doc.18)
Assessment completed. No new business policy or implementation permission granted. Owner locks PAY-02/RBAC-02/SEC-02/C01-C06/G01-G05 unchanged. SG-04/05/06/08 require verification; release remains HOLD.


## HANDOFF-REVIEW 0.1.0-doc.19 (planning decision, not START-CODE)
Approved policy PAY-02/RBAC-02/SEC-02/C01–C06/G01–G05 unchanged. Handoff planning sets single-writer ownership for shared contracts, migrations, security and UI; packet boundaries are proposed and **not assigned**. Start-code, repository creation, spending and release remain separately Owner-gated.
