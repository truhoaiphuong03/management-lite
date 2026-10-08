# API-SYNC — Status ownership, transaction guards, traceability and residual HOLD
Version: 0.1.0-doc.11 | DESIGN ONLY

## Single-owner state registry
- AUTH.user_status: `pending_activation|active|suspended`; AUTH.invite_status: `queued|issued|used|revoked|expired`; AUTH.email_delivery_status: `queued|accepted|failed|unknown` (provider accepted != delivered); membership status separate.
- ATT.shift_run_state: `working|paused|completed`; ATT.review_state (per immutable shift version): `unreviewed|approved|rejected`; ATT.correction_request_status: `pending|accepted|rejected`; **never** use `needs_review` as run_state.
- REP.report_status: `draft|submitted`; revisions append-only; no separate approval state invented.
- PAY.period_status: `draft|finalized`; post-finalize correction ledger append-only; no settlement state in V0.1.
- ACC.account_status: `active|archived`; secret access proof `issued|consumed|expired|revoked` with atomic consumption.
- WORK/Drive states V0.2 reference-only.

## Transaction/integrity contract
1. C01 request: row lock shift and active request; unique pending request/shift, check workspace membership and shift owner; never update approved/finalized source in place.
2. C01 decision: row lock request, shift, open break; validate explicit Owner timestamp and every break end; half-open `[start,end)` segments, nonoverlap, server-recorded evidence; create immutable version; current review reset; audit and request decision commit together. If any ambiguity => fail closed; no auto-closure of open break. **Business meaning of unsupported/missing evidence remains HOLD for that individual request, not an authorization to fabricate time.**
3. ATT review: verify completed/current immutable version, no self-approval, no other concurrent review, and prevent stale payroll source.
4. REP revision: row lock report, check submitted state and version, insert new revision and update pointer atomically; unique `(workspace_id,report_id,revision_number)`.
5. ACC secret write: account version and reauth proof consumed atomically with AEAD ciphertext update; no secrets in logs/idempotency/audit; key absent => fail closed.
6. PAY finalize: lock period and all calculation source version references; re-evaluate approved state, source freshness, nonnegative net, missing rate, duplicate interval, exact NUMERIC bounds; commit all items + finalized period or none.
7. Workspace: authenticated session's explicit authorized binding is checked for every query/mutation; composite FK and scoped SQL; never infer from arbitrary request field.
8. Index/constraints: unique open shift/employee, unique active correction request/shift, exclusion overlapping shift/rate ranges, one approved review/current version, one report/employee/day, unique revision sequence, one finalized item/employee/period, idempotency uniqueness by workspace/actor/route/key. Cross-table constraints require transactional service guards and concurrency tests; declarative CHECK alone insufficient.

## Error registry (normative)
| HTTP | code | meaning |
|---|---|---|
| 400 | VALIDATION_ERROR | malformed payload |
| 401 | UNAUTHENTICATED | no valid session |
| 403 | FORBIDDEN / REAUTH_REQUIRED | authorization / missing proof |
| 404 | NOT_FOUND | absent or hidden workspace resource |
| 409 | CONFLICT / WORKSPACE_CONTEXT_UNRESOLVED | business or binding conflict |
| 410 | INVITE_EXPIRED | activation invalidated |
| 412 | PRECONDITION_FAILED | stale If-Match |
| 422 | INVALID_TRANSITION / BREAK_RESOLUTION_REQUIRED / NEGATIVE_NET_PAY | invalid business state |
| 428 | PRECONDITION_REQUIRED | missing mandatory If-Match |
| 429 | RATE_LIMITED | throttled |
| 503 | DEPENDENCY_UNAVAILABLE | unavailable external service |

## ARC disposition
| ID | Disposition | Evidence in this canonical |
|---|---|---|
| ARC-01 | RESOLVED design | Employee request + Owner decision routes in doc36 |
| ARC-02 | RESOLVED design | Submitted report revision in doc36 |
| ARC-03 | RESOLVED design | Action-scoped proof in doc36 |
| ARC-04 | RESOLVED design | Explicit migration/endpoint allowlist in doc36 |
| ARC-05 | RESOLVED design | Negative net atomic blocker in doc36 |
| ARC-06 | RESOLVED design; provisioning precondition | Explicit authorized binding, fail closed in doc36 |
| ARC-07 | RESOLVED safety contract; evidence-specific HOLD | Paused break explicit evidence, no inference in doc36–37 |
| ARC-08 | SPECIFIED; runtime HOLD | Transaction guards in doc37; no executable DDL or concurrency test |
| ARC-09 | RESOLVED design | Normative error registry in doc37 |
| ARC-10 | RESOLVED design | Separated status registry in doc37 |
| ARC-11 | NOT RUN | QA-03 85 test cases, all unexecuted |
| ARC-12 | HOLD release | No migration/security/email/UAT evidence |
| ARC-13 | RESOLVED design | Nonnegative base and negative net separately, doc36–37 |
| ARC-14 | RESOLVED design | Request/decision/review roles separated, doc36 |
| ARC-15 | RESOLVED design | V0.2 references explicitly excluded, doc36 |
| ARC-16 | RESOLVED design for V0.1 | Global user model unchanged; C06 active binding only |

## Required QA additions (specification only)
- C01 open `working` and `paused`, missing break evidence, contradictory end time, double request, Owner self-approval, stale If-Match, concurrent decisions, prior finalized source.
- C02 concurrent revisions, historical immutability, nonowner editing, draft vs submitted routes.
- C03 release artifact endpoint/route/migration denylist, including M08–M10.
- C04 negative employee net blocks all-period finalize; no partial commit; missing rate and stale approval races.
- C05 wrong account/action/session proof, replay, expiry, proof atomicity and no plaintext in caches/logs.
- C06 zero/multiple eligible bindings, revoked binding, cross-workspace request ID, no implicit context selection.
- All 85 existing QA-03 cases remain **NOT RUN**; mapping above adds coverage targets but does not fabricate new executed cases or renumber the canonical 85.

## Residual HOLD
- Implementation SQL/DB constraint rehearsal and concurrency evidence; OpenAPI generated contract validation; email/key recovery; full QA-03 execution and Owner UAT.
- Actual operational procedure to provision unique preauthorized workspace binding needs documented administrator setup before login rollout. No workspace selector in V0.1.
- C01 individual requests with unverifiable open break endpoints must remain pending/rejected without invented paid time. If Owner requires a different policy for evidence-poor cases, STOP+ASK.
- DEV-READY and production release remain HOLD. No application code, DB migration, repository modification or executor assignment authorized.
