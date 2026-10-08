# PRE-DEV — Environment and repository design
Version: 0.1.0-doc.13 | DESIGN ONLY | 2026-10-08

## Authority and boundaries
Source: doc.12; PAY-02/RBAC-02/SEC-02 and Owner C01–C06 unchanged. No application code, repository changes, executor assignments or production commitments. WORK/Drive/Content/Video excluded from V0.1.

## Environment matrix
| Area | Local | Staging | Production | Gate |
|---|---|---|---|---|
| OS | Mac/Windows supported design | TBD | TBD | Owner chooses deployment cost/provider |
| Runtime | Node.js 22 LTS proposed, version to verify | Pin and test | Same validated pin | DG-03 HOLD |
| DB | PostgreSQL, version to verify | Isolated real instance | Managed or self-hosted TBD | Migrations fresh/replay/rollback rehearsal |
| Redis | Optional cache only | Optional | Optional | Redis outage cannot bypass RBAC or truth |
| TLS/session | localhost exception for dev cookies only | HTTPS | HTTPS required | DG-04 HOLD |
| Secrets | env/key adapter; never commit secrets | protected secret store | protected secret store/KMS TBD | Owner approval for provider/cost/security tradeoff |
| Email | fake transport with outbox tests | sandbox/provider | provider TBD | accepted != delivered |
| Backup | test restore with synthetic data | encrypted restore drill | encrypted retention and recovery TBD | No real data before approval |

## Proposed repository topology (not created)
```text
management-lite/
  apps/web/                  # single AppShell and V0.1 routes
  apps/api/                  # HTTP adapters and composition
  packages/contracts/       # DTOs, status/error registry, no business logic
  packages/domain/          # shared types and invariants only
  packages/database/        # typed DB access, migration runner
  packages/security/        # session, CSRF, AEAD adapter, reauth
  packages/ui/              # shared tokens/components
  packages/test-support/    # fixtures, fakes, assertions
  modules/auth/
  modules/hr/
  modules/attendance/
  modules/reports/
  modules/payroll/
  modules/accounts/
  infrastructure/migrations/
  infrastructure/email/
  infrastructure/observability/
  docs/canonical/
  tests/integration/
  tests/security/
  tests/e2e/
```
Do not create modules/work, modules/drive, modules/content, modules/video or feature-specific migrations in V0.1.

## Naming and ownership
- TypeScript/JavaScript identifiers camelCase; exported classes/types PascalCase; DB/API JSON snake_case; stable UUIDs.
- Workspace composite FK and backend scoping; one explicitly authorized active workspace context, no selector; ambiguous binding fails closed.
- Migrations single-writer ownership; all schema changes additive-first; immutable history and no destructive reset.
- No secrets in git, telemetry, errors, CI artifacts or test fixtures.
- API route handlers delegate to module services; module service owns its tables; cross-module mutation via owner service/contract.

## CI and review gate (future)
Lockfile/install reproducibility; typecheck; lint; unit/integration; migration fresh/replay/checksum; security scans; API contract diff; UI 360px and accessibility; test reports attached to PR. A passing build alone is not release approval.

## Operational holds
DG-03 executable DB strategy; DG-04 key custody, TLS, backup/restore; DG-05 workspace provisioning; DG-06 email provider; DG-07 full UI inventory; DG-08 QA reconciliation; DG-09 explicit Owner start approval. No environment is claimed verified.
