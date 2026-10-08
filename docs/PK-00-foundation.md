# PK-00 foundation

Owner authorized START-CODE for PK-00 only in the 2026-10-08 chat, including branch push and Draft PR. This explicit instruction supersedes historical NO DISPATCH text. Codex is the sole foundation writer for this change window: root configuration, CI, app/package placeholders, foundation tests and provenance documentation. No parallel writer is assigned. Shared contracts contain no DTOs or domain policy.

Repository: https://github.com/truhoaiphuong03/management-lite (private). Baseline: `8b3229f2d440b838099195eb03433eb884ead7db`. Branch: `work/pk-00-foundation`. Canonical: `0.1.0-doc.19`; manifest SHA-256: `b3893a826e359a95b0a8fa0a8a15dfc4c2109f43c011284e06898c969830b436`. Canonical files are preserved byte-for-byte; read docs 40–43 and 52–56 under `canonical/docs/`.

## Reproducible setup

Use Node 22.14.0 and npm 10.9.2 (existing Mac versions). Runtime pins, engine-strict and preinstall fail on incompatible versions. No global local-machine upgrade is required. npm workspaces manage eight private ESM placeholders. There are no runtime dependencies. TypeScript 5.9.3, ESLint 10.12.0, typescript-eslint 8.71.1 and Prettier 3.9.9 are exact development pins; package-lock.json fixes transitives. Test runner is built into Node.

Run `npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, `npm run canonical:verify`, and `npm audit --audit-level=high`. `npm run verify` combines formatting, lint, typecheck and build-backed smoke tests. Build emits ESM and declarations into ignored dist/. Apps are importable empty skeletons; they do not start servers.

CI executes on Linux and macOS with read-only repository permissions and SHA-pinned official actions. npm is pinned only inside ephemeral CI runners. GitHub-hosted CI consumption is subject to the account's included quota; no paid subscription or runner is provisioned. CI success must be verified from actual runs.

## Acceptance and deferred gates

PK00-F01: all eight compiled placeholders import with no business exports. PK00-F02: manifest and all 57 canonical hashes match. PK00-F03: strict compiler rejects invalid assignment. PK00-F04: dotenv, keys, secrets and generated outputs are Git-ignored. These are foundation tests, not the 113 business QA cases or DBT cases.

SG-04: isolated private repository, clean baseline and access verified. SG-08: sole foundation writer and review via Draft PR, no merge. SG-05: Node/npm compatible and tested; PostgreSQL, btree_gist and migration evidence HOLD before PK-01. SG-06/G02: OS secret-store capability and recovery tests HOLD before security implementation; no secret adapter is created. SG-07/G03: future email must use a fake local adapter and synthetic recipients, with delivery explicitly simulated; no adapter implemented in PK-00.

Business modules, AppShell/business UI, schema/migrations, PostgreSQL/Redis, secret custody, production KMS/email/TLS/backup, UAT and release remain HOLD. Module and infrastructure implementation directories are deliberately deferred to their separately authorized packets. Shared schema/security/UI writers must be nominated before later implementation. No business QA PASS is claimed.

## Review and recovery

Review the additive diff and test evidence before merge. Keep the PR draft until Owner/reviewer acceptance. Reject the unmerged PR or use a separately reviewed revert if recovery is needed; preserve history, never reset or force-push main. Stop for writer overlap, modified canonical policy, unknown credentials, costs, destructive changes or scope expansion. No PK-01 authorization follows from this packet.
