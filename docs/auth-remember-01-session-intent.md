# AUTH-REMEMBER-01: explicit session intent

Session lifetime is not evidence of Remember Me consent. The former `> 24 hours`
heuristic misclassifies the supported 1-day Remember Me override, and could treat
a long-lived standard row as remembered. Login now writes `auth_sessions.remember_me`
explicitly. Resolve and refresh use that field, never the duration.

- `false`: standard session requires both idle and absolute expiry to be strictly
  later than the request timestamp. Refresh cannot revive an idle-expired session.
- `true`: Remember Me may recover idle expiry before the absolute deadline.
  Resolve still requires unexpired idle; the client can refresh then retry.
  Activity and refresh never extend the original absolute deadline. Default 30-day
  and supported 1-90 day cookie configuration remain unchanged.
- `NULL`: legacy/unknown intent fails closed at both resolve and refresh without
  mutating session timestamps. A fresh successful login is required. Do not
  backfill intent using duration, current configuration or client claims.

Migration 0023 is additive and leaves existing rows NULL. This deliberately
invalidates legacy authentication at the application layer, including previously
remembered sessions. Session records, audit history and business data are retained.
Test fixture writers that need active sessions must explicitly supply true/false.

Future deployment requires a separately approved, coordinated schema/application
release: apply the migration before starting this code, avoid old/new auth writers
running together, and communicate the mandatory re-login. Old binaries issue NULL
rows and still contain the heuristic; rolling back only the binary is not a safe
policy rollback. Migration takes an ALTER TABLE lock; lock wait and deployment
duration have not been measured on production. No production migration or deploy
is authorized by DEV acceptance.

Regression evidence covers the exact idle/absolute deadlines, repeated refresh,
30-day defaults, lifetimes below/at/above 24 hours, explicit standard long lifetime,
legacy NULL rejection, login persistence at the 1-day override, HTTP cookie
behavior, revocation and credential invalidation. Request-time expiry and existing
concurrency semantics are retained; these tests do not prove every interleaving or
clock-skew scenario.
