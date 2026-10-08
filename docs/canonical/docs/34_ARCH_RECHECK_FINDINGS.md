# ARCH-RECHECK — Final canonical cross-audit
Version: 0.1.0-doc.10 | Parent: 0.1.0-doc.9 | 2026-10-08
Status: AUDIT PASS (evidence-backed review), CANONICAL HARMONIZATION HOLD; DEV-READY HOLD. No code/migrations/tests run.

## Authority and precedence
Owner-locked PAY-02, RBAC-02, SEC-02 and C01-C06 supersede conditional or historical text in older docs. This audit is non-destructive: no policy edits. Historical documents remain traceable; discrepancies below are not silently considered fixed.

## Findings
| ID | Priority | Area | Finding | Required correction |
|---|---|---|---|---|
| ARC-01 | P0 | ATT C01 | Existing adjustments route Owner-only; no employee request route or Owner explicit decision for an open/paused shift. | Specify employee-owned correction request with reason; Owner decision with explicit corrected time, version, audit; reject self-approval; new immutable version; no payroll before approval. |
| ARC-02 | P0 | REP C02 | PATCH explicitly draft-only, while C02 permits revisions after submission. | Specify append-only submitted revision endpoint, If-Match, immutable prior submission, author/time; no overwrite. |
| ARC-03 | P0 | ACC C05 | Secret replacement route must explicitly require action-bound single-use reauth proof. | Require proof consumed transactionally, no cached secret, audit; stale proof denied. |
| ARC-04 | P0 | SCOPE C03 | Optional M08/M09 still described; release allowlist not normative. | V0.1 migration allowlist M00-M07 + core M11 guards only; no WORK, channels-as-WORK, Drive, storage feature-specific migrations/endpoints/UI. |
| ARC-05 | P1 | PAY C04 | Historical text says negative net policy unresolved. | Owner locked: any negative draft employee net blocks atomic period finalize; no clamp/carryforward; tax/settlement remain excluded. |
| ARC-06 | P0 | AUTH C06 | Login returns active_workspace and /me memberships but deterministic authorized binding not specified for multiple memberships. | No implicit switching. Require exactly one preauthorized active workspace binding for V0.1; ambiguous/no binding fail closed, not arbitrary selection; no selector. |
| ARC-07 | P0 | ATT state | Forgotten clock-out from paused state has no defined safe transition or unpaid break closure. | Explicit Owner decision must resolve open break evidence and immutable paid intervals, never infer working time; keep HOLD until transition contract is specified. |
| ARC-08 | P0 | DB integrity | Textual FK/index rules not executable SQL; cross-table approvals and payroll source eligibility require transaction guards. | Specify database guard transaction proof and concurrent race tests; do not claim DDL executed. |
| ARC-09 | P1 | API canonical | Historical 409 PRECONDITION_FAILED conflicts with newer 412; override only in appendix. | Publish single normative error registry 428 missing If-Match, 412 stale, 409 business conflict; mark legacy text historical. |
| ARC-10 | P1 | Status registry | Some state values overlap aggregate run_state and review_state. | Normative separate enums with single status owner; no overloaded needs_review in run_state. |
| ARC-11 | P1 | QA trace | Test cases define expectations but lack executed evidence, SQLSTATE/HTTP fixture artifacts. | Keep all 85 NOT RUN, attach future evidence per test, verify counts and traceability. |
| ARC-12 | P1 | Release evidence | Migration rehearsal, encryption key recovery, mail delivery and UAT unverified. | HOLD release until P0 pass and signed evidence; design PASS is not runtime PASS. |
| ARC-13 | P1 | Payroll arithmetic | Formula floor((sum_numerator+1800)/3600) assumes nonnegative numerator. | Guard nonnegative base numerator and negative net separately; ensure NUMERIC overflow-safe, half-up once. |
| ARC-14 | P1 | Workspace/RBAC | Owner correction authority and employee request require explicit separation from approval. | Owner can decide staff correction but cannot approve own shift; employee cannot approve; workspace isolation for every operation. |
| ARC-15 | P1 | Scope residue | WORK/Drive endpoints and state machines remain as reference, may be mistaken for V0.1. | Tag reference-only V0.2; release allowlist controls tests/build/migrations. |
| ARC-16 | P1 | Identity model | Global username/email and multi-membership are not fully resolved for future use. | Preserve current global user model; C06 restricts active context; defer any account model redesign. |

## Mandatory canonical API deltas (PROPOSED TECHNICAL CONTRACT, NOT APPROVED IMPLEMENTATION)
- POST /api/v1/attendance/shifts/{id}/correction-requests: shift owner submits reason and evidence, idempotency and If-Match; cannot submit corrected approved time as authoritative.
- POST /api/v1/attendance/correction-requests/{id}/decide: Owner decision with explicit clock_out_at and reason; version and authorization checks; create immutable shift version and leave it unreviewed. Separate review remains mandatory; Owner cannot self-approve. Paused-shift resolution is a P0 technical HOLD.
- POST /api/v1/reports/daily/{id}/revisions: report owner, append-only after submitted, If-Match, preserve prior submitted revision and timestamps.
- PUT /api/v1/accounts/{id}/secrets: Owner only, action/account/session-bound reauth_proof required and single-use; CSRF, If-Match, no-store, audit.
- POST /api/v1/payroll/periods/{id}/finalize: reject entire transaction if any net_vnd < 0, without clamping or partial finalize.
- POST /api/v1/auth/login: active workspace binding must be preauthorized and deterministic; multiple ambiguous memberships cannot silently select one.
- GET /api/v1/auth/me: active_workspace is explicit authorized context; never allow user-supplied workspace IDs to escalate.

## Migration and scope allowlist
V0.1: M00-M07 and only core integrity guards/indexes from M11. M08 WORK/channels, M09 Drive/storage workflow and M10 Content/Video are excluded. Core infrastructure primitives may exist only where essential for V0.1. No scope broadening.

## Test and release gates
All 85 QA-03 tests remain NOT RUN. 71 P0 must pass for release; no migration, key recovery, security tests or UAT evidence yet. API-SYNC and paused-shift correction state contract are P0 blockers to declaring implementation-ready.

## Decision Log (audit decisions, not Owner policy)
ARCH-R01 Owner-approved C01-C06 are normative; ARCH-R02 previous conditional holds are historical; ARCH-R03 API-SYNC required before DEV-READY; ARCH-R04 scope allowlist excludes WORK/Drive V0.1; ARCH-R05 QA-03 remains unexecuted.

## Result
Architecture audit: PASS (review completed). Canonical consistency: HOLD (open P0 mismatches). Runtime readiness: HOLD.
