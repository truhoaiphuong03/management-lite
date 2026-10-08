# QA-02 — Acceptance Gates (SPECIFICATION, ZERO TESTS EXECUTED)

P0: 100% PASS within approved release scope. No cross-workspace access, secret exposure, double clock, double payroll, destructive migration, premature success UI, or missing immutable history. P1 no release-blocking core defects; P2 backlog allowed only without regression.

| Suite | Mandatory examples |
|---|---|
| AUTH | one-time activation, expiry/reissue, session revoke, CSRF, rate limits, worker retry |
| RBAC | Staff cannot Owner APIs, no IDOR, revoked assignments, no self-approval, workspace isolation |
| ATT | double clock-in, break/resume state, server timestamp, offline idempotent retry, overnight split, no overlap |
| PAY | approved seconds only, rate split, unpaid break, period-level rounding, Owner excluded, finalized immutable, correction trail |
| REP | one report/day, revision history, reported != submitted != approved |
| ACC | AEAD at rest, Owner reauth reveal, no secrets in list/log, ambiguous contact linking STOP |
| STORAGE | revision-bound receipt, stale receipt blocks Trash, Staff cannot Trash, provider unknown/recovery |
| WORK | exact revision approval, no double handoff, assignment-scoped permissions; full Content/Editor E2E deferred V0.2 |
| UI | shared AppShell/components, 360px mobile, no button jitter, loading/error/empty, keyboard/focus, no duplicate submit |
| DATA/API | composite workspace FK, exclusion indexes, 409 version/idempotency conflicts, migration failure stop |

Fixed arithmetic examples: 8h*30000=240000; 3660s*25000/3600 rounds to 25417; 8h shift with 30m break and rates 30000 then 35000 = 242500. Test concurrency, worker crash, Redis unavailable, Drive timeout, and outbox unknown states.

Executor evidence when work starts: commit SHA, exact changed files, test commands/results, Postgres constraint proofs, API permission tests, UI mobile/desktop captures, build/lint/typecheck/audit, known issues. Never claim PASS without executed tests.
