# Windows staging build handoff — 2026-10-12

Purpose: independent Windows staging testing. **QA_HOLD / RELEASE_HOLD.** No production approval, deployment runner, CD enablement, DNS change, migration, bootstrap or account update is included.

## Provenance and transfer

- Repository: `truhoaiphuong03/management-lite` (private, verified via GitHub).
- Application QA baseline: `e2bedec14714709cf5db2a0c0782f4bb9c3cb941`, branch `codex/set002-retest-b6b16fd`.
- Infrastructure baseline: `89d18fcb1721f012cfc4d28e6372e4e383e664e6`, branch `codex/cicd-windows-design-20261012`. Its application directories, package manifest and lockfile match the application QA baseline exactly. It is a design commit, not application acceptance.
- The actual bundle commit, outer ZIP checksum and file inventory are in `CODEX-WINDOWS-STAGING-BUILD-HANDOFF.md` and the adjacent artifact metadata. Pin the bundle SHA, not the subsequent documentation commit.
- Local build: Node **22.14.0**, npm **10.9.2**. JavaScript and Web compiled on macOS. Runtime dependencies resolved separately with `npm ci --omit=dev --ignore-scripts --os=win32 --cpu=x64 --no-audit --no-fund`; native `.node`/DLL files checked for Windows PE AMD64. No Mac `node_modules` is shipped.
- **Windows runtime NOT TESTED.** Prebuilt native modules require the offline Windows smoke below. Package installation hooks were deliberately not run during cross-resolution.
- No matching GitHub CI run or artifact ID exists. Both metadata fields are `null`, not invented IDs. No branch was pushed: tracked audit documentation and reachable history still contain a legacy exposed Staff credential. Removing a file from the current tree would not remove that history.
- Transfer the ZIP and checksum via Owner's existing private file transfer (RDP file copy, USB or authenticated private storage); compare SHA-256 with the trusted Mac handoff before extracting. Do not transfer the repository, `.env`, audit directory, Mac dependencies or database dumps.

## Windows prerequisites — verify without changing Stage 5

Owner reports Windows 64 bit, `C:\HoaiPhuong-Staging`, PostgreSQL loopback `55433`, roles `hp_stage_db`/`hp_stage_app`, ports `3201/3202/3203`, 11/11 Stage 5 groups PASS. This is **Owner-reported evidence**, not this Mac's inspection. Windows AMD64 architecture, Node version, service names, service executable arguments, gateway implementation, database name/system identifier, installed schema and backup status still require Windows readback. If Windows reports ARM64, this x64 package is blocked pending a compatible runtime/build.

1. Verify Node `22.14.0` x64, available disk space, and ownership of ports 3201/3202/3203. Reuse the confirmed Stage 5 services; do not start duplicate listeners.
2. Record current service arguments/release directory, staging database identity and staging backup/restore proof before switching any staging service. Keep production services and databases untouched.
3. Compare `staging-manifest.json.migrations` with staging `schema_migrations` **read-only**, including id/checksum. AUDIT-005 immutability migration must be present. Do not run `npm run migrate` or bootstrap automatically. A mismatch requires a separate controlled staging migration decision and backup; no migration SQL/runner is in this bundle.
4. Create a new `C:\HoaiPhuong-Staging\releases\<FULL_BUNDLE_SHA>` directory only after checksum verification. Never extract over an existing release/current/config directory. Inspect ZIP entry names: no absolute paths, `..`, links or config files.
5. Run `Verify-StagingBundle.ps1` from the extracted bundle with the expected SHA. It checks repo, SHA, staging purpose, every payload digest, and rejects missing/extra files and links. ZIP digest is the trust anchor; the manifest alone is not a signature.
6. Run the native smoke before any API process or database connection:

```powershell
node .\scripts\deployment\smoke-windows-native.mjs
```

This checks real Argon2 hashing/verification and sharp PNG encoding/decoding in memory. It does not connect to a database or provider. Any missing DLL/platform error blocks API startup.

## Environment contract — values remain on Windows

Keep an ACL-protected staging env file outside every release, e.g. `C:\HoaiPhuong-Staging\config\staging.env`. Do not copy a Mac env or put this file into Git/artifacts/logs.

| Variable                         | Requirement                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | Explicit staging connection, PostgreSQL loopback 55433, user `hp_stage_app`; secret value entered on Windows                        |
| `APPROVED_STAGING_DATABASE_NAME` | Exact database name independently confirmed from Stage 5; checked against URL                                                       |
| `NODE_ENV`                       | `staging` for this loopback HTTP QA setup; cookies are not production HTTPS cookies                                                 |
| `HOST`, `PORT`                   | Loopback API bind, 3202                                                                                                             |
| `CSRF_SECRET`                    | Explicit strong staging-only secret; never use the development default                                                              |
| `ACCOUNT_SECRET_KEY`             | Existing stable staging encryption key; never replace it as part of build handoff; never copy/change production key                 |
| `ALLOWED_ORIGINS`                | Exact staging gateway origin on loopback 3203; no wildcard                                                                          |
| `TRUSTED_PROXIES`                | Confirmed loopback gateway only                                                                                                     |
| `SESSION_COOKIE_NAME`            | Optional staging-specific cookie name                                                                                               |
| `FIN_RECEIPT_DIR`                | Optional private QA receipts only under `C:\HoaiPhuong-Staging\shared\receipts\`; omit initially if receipt testing is not approved |

`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` and pool limits are source-supported alternatives, but this staging launcher **requires explicit `DATABASE_URL`** and rejects fallback. `TEST_DATABASE_URL` is for a separate disposable test database and is unnecessary for application startup. Never run test suites against the Stage 5 application database. No Owner/bootstrap password or real Drive/Gemini credential is needed to install/verify this artifact. FILE still uses the existing mock provider; real Drive acceptance remains pending. Avoid external AI credentials during initial smoke.

## Start and gateway contract — manual staging operator only

Run from the **verified release directory** with the existing approved Windows service wrapper, preserving its service identity/ACLs and env loading. These are executable arguments to review on Windows, not commands already executed:

```powershell
# Separate processes / existing service wrappers; check ports first.
node --env-file=C:\HoaiPhuong-Staging\config\staging.env .\scripts\deployment\staging-runtime.mjs api
node .\scripts\deployment\staging-runtime.mjs web
node .\scripts\deployment\staging-runtime.mjs gateway
```

The optional built-in Web server binds only loopback 3201, serves `web/`, handles SPA routes, and denies hidden files. The optional loopback gateway binds 3203, routes `/api/*` to API 3202 and other routes to Web 3201, preserving `/api/v1` and cookies. If Stage 5 already has a gateway, configure that existing gateway equivalently and **do not start the optional gateway**. The helper does not install or stop Windows Services, listen publicly, provide HTTPS or configure DNS. Production must use its separately approved HTTPS configuration.

Read-only checks (expected results):

- `http://127.0.0.1:3202/api/v1/health`: HTTP 200, success envelope, service alive.
- `http://127.0.0.1:3202/api/v1/ready`: HTTP 200 only with staging DB connected; 503 blocks acceptance.
- `http://127.0.0.1:3203/api/v1/health` and `/ready`: same API checks through gateway.
- `http://127.0.0.1:3203/release-version.json`: exact bundle SHA.
- Web `/`, `/login`, `/settings`: HTML and correct asset MIME; missing assets/`.env` must not return file content.
- Unauthenticated `/api/v1/auth/me`: 401. Owner/Staff acceptance uses synthetic Windows staging accounts provisioned separately; never the real Owner.

Native smoke, readiness, Windows gateway/UI/RBAC/ACC/FIN acceptance and backup/restore are **NOT TESTED in this Mac build handoff**. Keep the known ACC background expiry defect visible; do not accept secret expiry based solely on a foreground check.

## Rollback and read-only GitHub download plan

Before switching, record the old verified release path and service arguments. On staging failure, the Windows operator stops only the confirmed staging Web/API/gateway processes they own, restores the previous release arguments/path and unchanged staging env/key, starts those same staging services, and repeats the read-only smoke. Preserve failed release/logs for diagnosis. This bundle applies no schema change, so rollback is code-only. Never automatically restore a database or rotate a key; those require a separate data recovery decision. If no prior build exists, stop only the newly started staging processes and restore the pre-install Stage 5 configuration.

For a future **secrets-cleared** hosted build, use GitHub-hosted Windows x64 only, checkout the full SHA, read-only `contents` token, upload an immutable artifact and record run ID/artifact ID plus inner ZIP checksum. No self-hosted production job, deploy step, environment secret, `workflow_run` CD or Windows remote command is needed. A branch push trigger can build on a dedicated branch; `workflow_dispatch` requires the workflow on the default branch, so do not merge main just to enable a download.

Windows may download with an authenticated account having repository read access, or a repo-restricted token with **Actions: read / Contents: read**, entered privately on Windows. Example after real IDs exist:

```powershell
gh api repos/truhoaiphuong03/management-lite/actions/runs/RUN_ID
gh api repos/truhoaiphuong03/management-lite/actions/artifacts/ARTIFACT_ID
gh run download RUN_ID --repo truhoaiphuong03/management-lite --name EXACT_ARTIFACT_NAME --dir C:\HoaiPhuong-Staging\downloads\RUN_ID
```

Validate run head SHA, repo, branch, event, successful required checks, artifact ID/name, workflow_run linkage, expiry and checksum against the trusted handoff. Verify the **inner application ZIP** checksum; GitHub upload artifact digest may describe the outer transport archive. Never download “latest”, execute downloaded workflow YAML/scripts on production, give Windows write/deploy rights, or paste tokens into commands/logs. If GitHub is unavailable, use the same checksum-verified private ZIP transfer and manual staging-only runbook.

References: [GitHub artifact downloads](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts), [manual workflow requirement](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [GitHub CLI download](https://cli.github.com/manual/gh_run_download). Local npm 10.9.2 `npm help install` confirms `--os`/`--cpu` overrides native module resolution; this is not Windows execution evidence.
