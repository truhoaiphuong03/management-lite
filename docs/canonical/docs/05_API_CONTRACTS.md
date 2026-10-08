# API-02 — Contract Baseline

Base /api/v1; JSON UTF-8; snake_case; UUID; ISO8601 UTC; VND integer; seconds integer. Session via secure HttpOnly cookie; CSRF defense; reauth for sensitive secrets. Standard response {success:true,data:{...},meta:{request_id}} or {success:false,error:{code,message,details},meta:{request_id}}. Do not expose stack traces.

## Endpoint inventory
AUTH: POST /auth/login, /auth/logout, /auth/activate, /auth/password/change, /auth/reauth; GET /auth/me; POST /employees/{id}/activation-invites; GET /employees/{id}/activation-status.
HR: GET/POST /employees; GET/PATCH /employees/{id}; POST /employees/{id}/suspend, /employees/{id}/reactivate, /employees/{id}/positions; GET /employees/me, /job-positions.
ATT: POST /attendance/shifts, /attendance/shifts/{id}/breaks, /attendance/shifts/{id}/resume, /attendance/shifts/{id}/clock-out, /attendance/shifts/{id}/reviews; GET /attendance/me, /attendance/shifts.
REP: GET /reports/me, /reports/daily, /reports/daily/{id}/revisions; POST /reports/daily; PATCH /reports/daily/{id}.
PAY: GET /payroll/me, /payroll/periods, /payroll/rates; POST /payroll/periods, /payroll/periods/{id}/calculate, /payroll/periods/{id}/finalize, /payroll/adjustments.
ACC: GET/POST /accounts; GET/PATCH /accounts/{id}; POST /accounts/{id}/archive, /accounts/{id}/restore, /accounts/{id}/secrets/reveal; PUT /accounts/{id}/secrets; GET /contact-points; POST /accounts/{id}/contact-links.
WORK (foundation / V0.2 expansion): GET/POST /work-items; GET /work-items/{id}, /work-items/{id}/history; POST /work-items/{id}/assignments, /work-assignments/{id}/submissions, /work-submissions/{id}/reviews, /work-items/{id}/handoffs; specialized Content/Video endpoints V0.2.
STORAGE: GET/POST /storage/folders; GET /storage/folders/{id}/files; POST /storage/folders/{id}/receipts, /storage/folders/{id}/trash-requests, /storage/trash-requests/{id}/confirm; GET /storage/operations/{id}.

## Errors
400 VALIDATION_ERROR; 401 UNAUTHENTICATED; 403 FORBIDDEN / REAUTH_REQUIRED; 404 NOT_FOUND; 409 CONFLICT / VERSION_CONFLICT / PRECONDITION_FAILED / IDEMPOTENCY_CONFLICT; 410 INVITE_EXPIRED; 422 INVALID_STATE_TRANSITION; 429 RATE_LIMITED; 500 INTERNAL_ERROR; 503 DEPENDENCY_UNAVAILABLE.

## Consistency
Idempotency-Key required for employee create, invites, clock transitions, submission/review/handoff, finalize, trash. Same key+payload returns same result, same key+different payload 409. Optimistic concurrency version/If-Match for edits. Server time is authoritative. Finalize payroll locks and snapshots; Drive operations are durable and reconciled, not DB+Drive distributed transactions. Email queued != delivered.

## Payroll amendment PAY-02
Segment approved worked intervals by workspace-local midnight and effective-dated pay rate boundaries, subtract unpaid breaks, compute exact numerator sums, round half-up once per employee/period base pay. Owner excluded. Do not finalize if missing rates or stale approvals. Provide auditable calculation lines.

## DOC-02 contract amendment
See 15_API_STATE_AND_CONCURRENCY.md. HTTP If-Match mismatch is 412 PRECONDITION_FAILED (not 409). Adds attendance adjustment/history and payroll calculation line read endpoints.

## API-READY precedence
The earlier baseline error list includes outdated 409 PRECONDITION_FAILED; doc 24 supersedes: missing If-Match 428, stale If-Match 412. Secret reveal is not idempotency-cached. Explicit POST /reports/daily/{id}/submit, POST /payroll/rates and POST /payroll/corrections are added as technical contract refinements. See docs/24-27.


## API-SYNC authoritative update (doc.11)
The normative V0.1 contract is in docs/36–37. New ATT correction-request and Owner decision endpoints; REP submitted revisions; ACC secret write requires action-bound reauth; AUTH binding fail-closed; PAY negative net blocks atomic finalize. 428 missing If-Match, 412 stale, 409 semantic conflict. WORK/Drive endpoints are V0.2 REFERENCE ONLY.
