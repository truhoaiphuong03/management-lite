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

## Release Controller Cutover & Rollback Enforcement (`AUTH-REMEMBER-01-CUTOVER-FALLBACK`)

The canonical Windows host release controller (`scripts/deployment/Deploy-SemiAutoWindows.ps1`)
and release packager (`scripts/deployment/package-release-bundle.mjs`) enforce the
following fail-closed invariants:

1. **Candidate Build Readiness Gate (`REJECTED_BUILD_NOT_READY`)**:
   Before any snapshot, migration, or runtime cutover, the controller verifies that
   all required API, Web, migrator, and auth service artifacts exist, are non-empty,
   match `manifest.json` SHA-256 digests, and implement `auth-remember-01`
   (`resolveRememberMePolicy` and explicit `remember_me` persistence) whenever
   migration `0023_auth_session_remember_me` is present.
2. **Pre-Cutover Database Schema Preflight (`REJECTED_SCHEMA_MIGRATION_MISMATCH`)**:
   Before touching live files or Git `HEAD`, the controller queries PostgreSQL
   `schema_migrations` and `information_schema.columns` read-only:
   - Rejects if the database has more migrations applied than the candidate bundle,
     or if any applied migration ID/checksum drifts from the bundle manifest.
   - When `-SkipMigration` is active, requires 1:1 migration parity (`23/23`) and
     verifies that `auth_sessions.remember_me` exists in `information_schema.columns`.
     If migration `0023` has not run yet, cutover is blocked immediately.
3. **Migrate & Verify Strictly Before Runtime Cutover (`MIGRATION_FAILED_PRE_CUTOVER`)**:
   When `-SkipMigration:$false` is approved in the Owner-signed Ed25519 manifest,
   database migrations are executed from the verified staging bundle **before**
   `git checkout` and **before** `Invoke-AtomicRuntimeSwap` (`dist` and `apps/web/dist`).
   Post-migration verification confirms `23/23` applied migrations and the presence
   of `auth_sessions.remember_me` before switching live API/Web files. If migration
   fails, PostgreSQL rolls back the migration transaction, the controller records
   `MIGRATION_FAILED_PRE_CUTOVER`, and the live API/Web build is never switched.
4. **Rollback Schema & Auth Policy Compatibility Gate (`STOP_NO_GO_INCOMPATIBLE_ROLLBACK`)**:
   Each pre-deploy snapshot records `previous_schema_identity`, `previous_migration_count`,
   `previous_has_0023`, and `previous_auth_policy` in `rollback-metadata.json`.
   Before `Restore-VerifiedSnapshot` restores any snapshot (on post-cutover health
   failure or `-RecoverInterrupted`), it compares the snapshot against the active
   database state:
   - **Compatible Rollback (`ROLLED_BACK`)**: If the snapshot matches the active
     database schema and supports `auth-remember-01` (e.g., rolling back between
     two `0023`-compatible builds), atomic code rollback proceeds normally.
   - **Incompatible Rollback Blocked (`STOP/NO-GO`)**: If the database has `0023`
     applied (`auth-remember-01`) but the snapshot is pre-`0023` (`legacy-pre-0023`
     or schema mismatch), code-only rollback is **blocked** (`ROLLBACK_BLOCKED_INCOMPATIBLE_SCHEMA_OR_AUTH_POLICY`
     in `latest-deployment.json`, `STOP_NO_GO_INCOMPATIBLE_ROLLBACK` in `deployment-state.json`).
     The controller refuses to restore the legacy binary, stops `HPManagementLiteApi`
     in production mode so an unhealthy build cannot serve traffic, preserves 100%
     of database data and pre-deploy backups, and requires **Safe Forward Recovery**
     (deploying a newly signed `0023`-compatible release bundle with `-Force` and
     `-SkipMigration`) or an explicit Owner-approved full maintenance restore.

Regression evidence covers the exact idle/absolute deadlines, repeated refresh,
30-day defaults, lifetimes below/at/above 24 hours, explicit standard long lifetime,
legacy NULL rejection, login persistence at the 1-day override, HTTP cookie
behavior, revocation, credential invalidation, and all 10 cutover/migration/rollback/STOP-NO-GO
scenarios. Request-time expiry and existing concurrency semantics are retained;
these tests do not prove every interleaving or clock-skew scenario.
