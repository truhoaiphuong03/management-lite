# FLOW-02 — Canonical Business Workflow
Version: 0.1.0-doc.4 | 2026-10-08 | Design PASS / implementation HOLD

## Invariants
- Preserve PAY-021..028, RBAC-02, SEC-021..032, DOC-02, UI-02, API-02. No code, no executor delegation.
- PostgreSQL truth; backend authorization; server timestamps; immutable historical revisions; Idempotency-Key and conditional version checks for critical writes.
- Distinguish auth user status, workspace membership/employment status, invite state, outbox delivery state. No client-generated time or success inference.
- V0.1 core: auth/activation, attendance and Owner review, daily reports, Owner-only accounts/secrets; payroll staged. WORK/STORAGE foundation only where explicitly approved. Full Content→Editor and Drive destructive automation V0.2/staged; design contracts not release authorization.

## AUTH / Invitation
Owner creates employee -> membership/user pending activation -> Owner queues invitation in same DB transaction as outbox -> provider delivery attempted asynchronously (queued/accepted/delivered/failed/unknown) -> staff activates via one-time 24h token -> active credential and eligible membership -> login creates opaque server session. Token reuse, expiry, reissue rejected; provider accepted != delivered. Suspend or password change revokes sessions. Reactivation requires independent employment and auth checks. No public signup. Never log token/password.

## ATT / Review
Operation state: no_open_shift -> working -> paused -> working -> completed. clock-out allowed only from working (existing ATT QA-007); no auto-clock-out. A single open shift per employee; break intervals cannot overlap; server authoritative UTC. On completed create immutable attendance_shift_version, review derived as unreviewed. Owner (not the employee/shift owner) reviews exact version: approved or rejected, audit reason on rejection. Correction creates a new immutable version and unreviewed state; historical approvals preserved but old version ineligible for future draft calculations. For already-finalized periods no in-place alteration: correction ledger and explicit trace. Forgotten clock-out remains open/needs_attention until audited resolution; do not invent time or silently mark completed. Open-shift correction mechanism needs DB-READY/API finalization before code.

## REP
Draft -> submitted; submitted edits create immutable revision and new current revision (not overwrite). One logical daily report per employee/workspace/business_date, revisions preserve submitted time, author and self-reported quantities. Owner sees reported vs submitted vs approved as separate dimensions. No automatic KPI approval. Report day determined by workspace-local date chosen/validated by server, not raw client timezone.

## PAY
Draft payroll only from completed approved current shift versions; remove unpaid breaks, segment at workspace local midnight and effective pay-rate boundaries, map segments into disjoint payroll periods, exact integer seconds, rational amount sum and one half-up rounding per employee/period base pay. Owner excluded even if clocked. Missing rate/overlap/stale approval blocks affected finalize. Owner-only calculate draft -> verify calculation_revision and source fingerprints -> finalize under transaction/version lock -> immutable period/items/lines. Repeated finalize same idempotency key returns same result; other conflicts rejected. After finalize, append-only correction entry with reason and link; no edit of finalized net, no assumed bank settlement. Negative net/tax/actual disbursement are unapproved business policies and remain STOP if requested.

## ACC / Secrets
Owner-only create/update/archive/restore managed-account metadata; no staff access even by direct API. Encrypt external secret AEAD with AAD bound to workspace/account/type/version; no plaintext logs or list/detail. Reveal: Owner active session -> reauth bound to actor/session/account/action, <=5 min single-use -> backend re-check rights -> decrypt -> no-store response -> audit metadata -> UI clears on close. Expired/replayed challenge denied. Secret update audit and optimistic version. Archive is reversible, no implicit destructive delete. Key loss fails closed.

## WORK / Content / Editor — V0.2 reference only
Owner assigns work to employee with effective position and resource-scoped grant. Content draft revision -> submission -> Owner review exact revision -> approved or changes_requested -> approved handoff -> Editor receives exact approved revision and Drive grant -> download receipt -> Editor submits video revision -> Owner review. No self approval, duplicate handoff, or implicit access based only on job position. Deliverable count excludes revisions. Full workflow is not an V0.1 release gate.

## STORAGE / Drive — staged design only
Owner assigns folder/grant -> Editor acknowledges download for exact folder_revision -> any folder revision change invalidates receipt for Trash -> Owner verifies local download and submits trash intent with revision -> Owner explicitly confirms current revision and receipts -> durable operation pending/running/unknown/completed/failed -> worker rechecks provider ACL/revision before trash -> uncertain timeout unknown, reconcile rather than claim success. Editor cannot trash. Do not treat provider operation as PostgreSQL transaction. Production enabling depends on scope and provider tests.

## Error and concurrency mapping
401 unauthenticated; 403 known forbidden; 404 conceal inaccessible resource; 409 business conflict or idempotency fingerprint mismatch; 410 expired invite; 412 stale If-Match; 422 invalid transition; 429 rate limit; 503 dependency unavailable. Critical mutations require idempotency, transactional version guard, audit and no optimistic false-success. DB errors never reveal secrets.

## UI contract
Same dark-only AppShell, design tokens and button components. Server is source of status. Stable-size loading button, disable repeat action, accessibility 44px touch targets, responsive 360px; explicit queued vs completed, unreviewed vs approved, draft vs finalized, reveal not stored. Conflict reload action; loading/error/empty states standardized.

## P0 workflow acceptance
AUTH: invite reuse/expiry/reissue; revoked session; no token leakage. ATT: double click, pause/resume, clock-out paused rejection, overlap and stale review; correction finalized immutable. PAY: midnight/rate split, one rounding, Owner exclusion, missing rate, concurrent finalize, correction ledger. ACC: staff denied, cross-workspace denied, reauth one-use and expiry, ciphertext AAD integrity, no secret logging. REP: revision history and count separation. STORAGE if enabled: ACL, revision invalidation, unknown provider response and duplicate Trash. UI: no false success, button jitter, backend permission check.

## Unresolved gates
DB-READY must close exact FK/check/index, attendance open-shift audited resolution, report revision constraints, correction ledger and state-transition DB enforcement. QA-03 must supply tests and evidence. SEC-02 deployment KMS/TLS/backup and Drive provider ACL tests remain HOLD. Scope-review if WORK/STORAGE release scope changes. No business policy invented.

## FLOW Decision Log
FLOW-021 auth/employment/invite/delivery separate; FLOW-022 attendance operational state separate from review; FLOW-023 review exact immutable shift version; FLOW-024 reports preserve revisions and distinguish counts; FLOW-025 payroll finalize immutable, correction append-only; FLOW-026 Owner-only secret reauth one-use; FLOW-027 provider operations unknown/reconciled; FLOW-028 Content/Editor full pipeline outside V0.1; FLOW-029 API and UI states use one registry; FLOW-030 design PASS not production PASS.
