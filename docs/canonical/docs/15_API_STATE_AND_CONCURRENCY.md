# DOC-02 — API contract amendments
Base /api/v1; snake_case; standard success/error envelope with meta.request_id. All sensitive mutations authenticated, CSRF-protected, workspace-scoped, audited and rate-limited.

## Mutations and reads
- POST /attendance/shifts/{id}/adjustments: Owner-authorized correction proposal; reason required; expected shift version; creates immutable new shift version and invalidates previous approval for future calculation; cannot mutate finalized payroll. Returns 201 + new version.
- POST /attendance/shifts/{id}/reviews: {shift_version_id,decision,reason?,expected_version}; reviewer cannot be shift owner; terminal decision for exact version; idempotency required.
- GET /attendance/shifts/{id}/versions: authorized history; no hidden cross-workspace data.
- GET /payroll/periods/{id}/items/{item_id}/calculation-lines: Owner or employee self only, scoped and redacted; returns exact segment boundaries, seconds, rate snapshot and amount basis.
- POST /payroll/periods/{id}/calculate: draft-only, idempotency key and expected version; recalculates from approved snapshots, no finalize; returns calculation_revision and errors.
- POST /payroll/periods/{id}/finalize: Owner-only, idempotency key + If-Match; locks period and source version references; fails atomically on stale input, missing rate, overlap or unresolved correction; creates immutable snapshot.
- POST /payroll/adjustments: Owner-only signed correction entry with reason and original item link; append-only. If original is finalized, do not rewrite item or silently disburse correction.
- POST /storage/folders/{id}/trash-requests: Owner-only intent with exact folder_revision_id and required receipts; return pending state.
- POST /storage/trash-requests/{id}/confirm: Owner-only re-confirmation with If-Match; worker must re-check revision/receipts/ACL before provider operation; ambiguous timeout => unknown and reconcile, never success.

## Error codes
400 VALIDATION_ERROR; 401 UNAUTHENTICATED; 403 FORBIDDEN/REAUTH_REQUIRED; 404 NOT_FOUND (conceal inaccessible resource); 409 BUSINESS_CONFLICT/IDEMPOTENCY_CONFLICT; 410 INVITE_EXPIRED; 412 PRECONDITION_FAILED (If-Match/version); 422 INVALID_STATE_TRANSITION; 429 RATE_LIMITED; 500 INTERNAL_ERROR; 503 DEPENDENCY_UNAVAILABLE. Never expose stack trace or secrets.

## Idempotency and race safety
- Same key + same fingerprint => same committed result; same key + different fingerprint => 409; in-progress concurrent replay waits/returns retriable in-progress state, not double mutation.
- Version check inside transaction, not only request validation; update row under lock or compare-and-swap.
- Outbox enqueue occurs in same transaction as durable business state; provider delivery is separate, retries and unknown acceptance reconciled.
- Reauth authorization is short-lived and tied to session + actor + action; exact TTL and key rotation await SEC-02.

## Canonical status registry
Auth: pending_activation/active/suspended; employment: invited/active/suspended/terminated (employment and auth status independent); attendance operation: working/paused/completed; attendance review: unreviewed/approved/rejected/needs_review; report: draft/submitted; payroll: draft/finalized; invite: queued/issued/used/revoked/expired; external operation: pending/running/unknown/completed/failed. Review status may be derived from approval history rather than duplicated in shift row.
