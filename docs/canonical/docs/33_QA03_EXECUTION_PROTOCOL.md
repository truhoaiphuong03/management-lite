# QA-03 — Execution Protocol and Negative Testing

**No execution authorized by this document.** This is an executable-test *plan*, not test code.

## Test layers
1. Schema: migration up/down rehearsal, FK, exclusion, immutable triggers/permissions, transaction rollback, restore.
2. Service: transition table and invariants, pure payroll arithmetic, revision history, status registry.
3. API: request schema, error envelope, CSRF, session, authorization, If-Match, idempotency, rate limits.
4. Concurrency: parallel clock-in, shift correction vs approval, report revision, finalize vs rate change, reveal proof replay, invite reuse.
5. Integration: actual email provider, outbox retry/unknown, Redis-down, key rotation and restore; Drive is V0.2, exclude from V0.1 tests except ensure absent.
6. UI/UAT: 360px, desktop, Owner/Staff, keyboard, buttons no jitter, no premature success, real end-to-end workflows.

## Negative-case template
Given authenticated actor and isolated fixture; When request fails/competes; Then assert HTTP code, no forbidden DB changes, no leaked data, stable audit trail, retry semantics and UI recovery. Capture transaction ID/request ID and sanitized artifacts.

## Coverage policy
- All P0 must have automation and/or repeatable integration evidence; P1 risk-based; no test counts fabricated.
- Distinguish `DESIGN SPECIFIED`, `IMPLEMENTED`, `TEST EXECUTED`, `PASS VERIFIED`.
- QA-03 document approval does not authorize coding or release.
