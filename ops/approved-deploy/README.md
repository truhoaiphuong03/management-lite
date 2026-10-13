# Approved Windows release preparation — production disabled

Pushes to `main` never deploy to Windows. This proposal builds release candidates on GitHub-hosted runners and supplies a tested sandbox controller library. It does **not** install a runner, poller, production service adapter, signing key, credential or migration job.

## Proposed release process

1. Finish QA on MacBook and merge the approved source to protected `main`.
2. Run **Approved release candidate** manually on `main`, entering its exact 40-character HEAD SHA. The workflow rejects a different SHA or branch, runs real PostgreSQL integration tests on an isolated hosted Linux database, rejects skipped checks, and builds/packages on hosted Windows.
3. Review the successful run and immutable artifact. The release approver signs a JSON payload binding repository ID `1410248474`, source SHA, source branch, workflow path, run ID/attempt, artifact ID/digest, schema digest, environment, increasing sequence and expiry. Keep the private signing key off the deployment worker. Never infer approval from an artifact's own manifest or a successful push.
4. A future least-privilege pull worker reads approved requests, revalidates GitHub metadata using `github-evidence.mjs`, downloads only that artifact and verifies the approved digest. Keep its read-only GitHub App credential in a protected host credential store; do not place credentials in repository files or log Authorization headers.
5. The fixed host controller checks inventory/paths, CI, approval signature/expiry/replay, disk reserve, backup/isolated restore and schema compatibility. It stops only the managed application, switches the release target and checks Web/API/readiness/version. On failure it restores the previous compatible application release once. It never automatically restores production DB or runs migrations.

The executable `deploy()` in this proposal is **sandbox-only**: both a `SANDBOX_ONLY` marker and `policy.environment === 'sandbox'` are mandatory. A production policy toggle alone cannot activate it. The adapter functions in a real host must be Administrator-owned and fixed, never accepted from artifacts or workflow commands.

## Files

- `deploy-core.mjs`: signed approval, CI identity, payload integrity, lock, durable journal/watermark and application rollback state machine.
- `github-evidence.mjs`: authenticated read-only run/artifact/source/job metadata checks. Missing API permissions or incomplete job pagination fail closed. No production credential is provisioned by this proposal.
- `Expand-ReleaseSafely.ps1`: prevalidation before extraction; rejects traversal, ADS, device names, duplicate paths, file/directory collisions, secrets, DB dumps, links and excessive size/ratio.
- `package-release.mjs`: packages compiled API/Web and installed lockfile runtime dependencies, with a per-file hash inventory and schema digest; excludes server configuration, source secrets and DB/upload data.
- `production-policy.json`: disabled template, no trusted public key or production activation.
- `gate-tests.mjs`, `extraction-tests.ps1`: synthetic approval and hostile archive tests; no production access.

## Activation prerequisites — still required

- Owner explicitly approves activation after reviewing exact candidate evidence. No approval is implied by merging this proposal.
- Protect `main`, require relevant CI, restrict workflow edits/release approval. The repository is private: GitHub environment required-reviewer availability depends on the account's plan. A signed off-worker approval can be used without claiming unavailable environment protection exists.
- Provision a dedicated non-admin worker identity. Separate the download/incoming area from administrator-owned controller/policy/approval trust and from the application service identity. Limit any broker to named Web/API service controls and an immutable release pointer; never give a general shell or administrative token to a workflow. The sandbox uses the existing non-admin `hp_stage_app`; no new account/runner is installed.
- Add a protected polling service/transport, read-only GitHub credential rotation, signing/enrollment tooling, replay-safe queue and a production host service adapter. These are intentionally **not installed or enabled**.
- Convert existing fixed-path Windows Web/API services to the reviewed release layout during an approved maintenance window. Keep gateway, Tunnel, DB, uploads and secrets outside the switch. Add a real version endpoint tying both application services to the same release SHA. The sandbox's host-side version proof is not an application production version endpoint.
- Verify a current encrypted backup on an independent destination and a restore drill. Same-disk dumps are insufficient for production recovery.
- Use a migration change process. This controller rejects automatic migrations and schema digest changes. A separately reviewed expand/contract migration must keep old and new applications compatible; otherwise block automatic rollback and require a maintenance/recovery plan.
- Pin the hosted PostgreSQL image digest; review patched Node/runtime versions against the application's existing strict toolchain contract. Do not silently replace the application's pinned runtime on the live server.
- Test actual signed GitHub artifact download, same-SHA CI, deployment, process failure, interrupted switch recovery and rollback with the final production candidate in isolated staging. Synthetic provenance tests do not prove a GitHub-to-Windows deployment.

Interrupted `SWITCHING`/`ROLLING_BACK` state blocks a subsequent deployment for operator recovery review. It does not guess that a crash completed successfully. Immutable releases and backups are retained; there is no cleanup job.

## Validation

Run `node --test ops/approved-deploy/gate-tests.mjs` and `pwsh -NoProfile -File ops/approved-deploy/extraction-tests.ps1`. The controller CI workflow uses hosted Windows only and has no server secrets. The release workflow has no production job and only responds to manual dispatch.

Local Windows acceptance evidence is supplied separately: real sandbox Web/API and PostgreSQL backup/restore tests, with synthetic CI metadata and an ephemeral sandbox-only approval key. It is not a production release approval.

Official references: [GitHub environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments), [private-repository reviewer availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments), [self-hosted runner security](https://docs.github.com/en/actions/reference/security/secure-use).
