# API-READY — Protocol, envelope and errors
Version: 0.1.0-doc.6. DESIGN ONLY. All routes are relative to `/api/v1`. HTTPS required outside loopback; UTF-8 JSON, snake_case, UUID, UTC ISO 8601 timestamps, date `YYYY-MM-DD`, VND integer, duration seconds integer. No client-supplied authoritative clock-in/out time.

## Envelopes
Success: `{ "success":true, "data":{}, "meta":{"request_id":"uuid"} }`. Error: `{ "success":false, "error":{"code":"VALIDATION_ERROR","message":"Safe message","details":[]}, "meta":{"request_id":"uuid"} }`. Collection: `data.items[]`, `data.next_cursor` (null if no next page); stable cursor sort with deterministic tie-breaker; page limit server capped. Empty success 200 with items []; creation 201; async accepted 202; logout 204 no JSON body (explicit exception).

## Required headers and concurrency
`Idempotency-Key` opaque unique per actor/workspace/operation on every state-changing POST/PUT/PATCH (except login, reauth and activation, which have replay-specific protections). Canonical request fingerprint includes method, route target, normalized body, actor and workspace. Replay same key/fingerprint returns recorded status/body; different fingerprint 409 IDEMPOTENCY_CONFLICT; in-progress replay must not run mutation twice. Keys retained at least for defined retry horizon (24h design default; retention must be consistent with operation safety); completed durable operations also have DB uniqueness constraints.
`If-Match: "<version>"` mandatory on edits, reviews, finalize, archive/restore, secret replacement, and Trash confirmation. Missing header 428 PRECONDITION_REQUIRED; stale 412 PRECONDITION_FAILED; business state conflict 409 BUSINESS_CONFLICT; invalid transition 422 INVALID_STATE_TRANSITION. Validation 400, unauthenticated 401, forbidden 403, concealed resource 404, expired invite 410, rate limit 429, unavailable dependency 503, unexpected sanitized error 500. `REAUTH_REQUIRED` uses 403; `REAUTH_EXPIRED` uses 403. No stack trace, secret, token, key material or raw provider error.

## Security
Secure HttpOnly SameSite cookie, server session, CSRF header + Origin check for cookie-authenticated mutations. Rate limit auth, activation, reauth, reveal. Authorization must be evaluated server-side per request, workspace scoped; concealed inaccessible resources 404. All writes audit actor, workspace, request_id, entity and version; sensitive request/response fields redacted. Secret reveal response `Cache-Control: no-store` and never recorded in idempotency response cache. Reauth proof session-bound, account/action-bound, single-use, <=5 minutes; token not logged.

## Validation
Unknown request fields rejected for security-critical mutations; enum values exact; non-negative seconds/VND where specified; no floats for money; timestamps client-supplied only for correction proposal and must be explicitly marked proposed, not authoritative. All API version fields are optimistic concurrency versions; immutable revision IDs are separate. Use structured error details with field/path and safe reason. Transaction rollback is atomic for DB writes, external provider operations use outbox/reconciliation.


## Normative API-SYNC error override (doc.11)
See docs/37. Missing required If-Match = 428 PRECONDITION_REQUIRED; stale = 412 PRECONDITION_FAILED; semantic conflict = 409 CONFLICT. Legacy contradictory 409/precondition examples are historical.
