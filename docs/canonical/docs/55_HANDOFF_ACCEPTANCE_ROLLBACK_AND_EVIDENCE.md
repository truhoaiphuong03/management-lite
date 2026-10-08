# HANDOFF-REVIEW — Acceptance, Recovery, Rollback and Evidence
Version 0.1.0-doc.19 | DESIGN ONLY | NO EXECUTION

## Per-packet acceptance contract
Each future packet requires: (1) exact canonical version + SHA manifest; (2) Owner-authorized packet ID and bounded objective; (3) verified repository URL/path, branch, base SHA and clean status; (4) allowed paths and forbidden paths; (5) contract/schema ownership; (6) applicable QA case IDs + fixture/expected outcomes; (7) exact test commands and exit codes; (8) diff + dependency/security audit + data protection evidence; (9) rollback/recovery plan and triggers; (10) Reviewer PASS/HOLD and Owner checkpoint when required. Missing item => HOLD, not assumed PASS.

## Rollback classes — no destructive shortcuts
| Class | Allowed recovery concept | Mandatory STOP |
|---|---|---|
| Documentation/contract | Revert only reviewable documentation diff; preserve Owner locks and history | Any change to approved policy without Owner decision |
| Unmerged code | Revert branch commit or reject PR; preserve audit trail | No force-push shared branch without approval |
| Schema additive migration | Prefer forward-fix with new versioned migration; test clean install and replay | DROP, rename, data rewrite, irreversible change, unknown preexisting data |
| Applied migration with data | Restore to isolated environment to verify; require explicit Owner-reviewed recovery plan and backup | Never silently down-migrate or restore production |
| Attendance approved versions | Compensating version + re-review; immutable history preserved | Direct UPDATE/DELETE of approved historical version |
| Finalized payroll | Append-only correction ledger; no negative-net finalize | Direct edit/recalculate finalized financial records |
| Account secrets | Versioned ciphertext/key rotation and scoped reauth; verify key recovery | Plaintext fallback, secret in logs/fixtures/backup |
| Production incident | Isolate, preserve evidence, restore only from verified encrypted off-server backup and key custody | Automated destructive rollback or data overwrite |

## Evidence templates
`PACKET_ID`, `OWNER_AUTHORIZATION_REF`, `CANONICAL_VERSION`, `MANIFEST_SHA256`, `REPO`, `BASE_SHA`, `HEAD_SHA`, `BRANCH`, `CHANGED_PATHS`, `CONTRACT_CHANGE`, `MIGRATION_IDS`, `TEST_CASE_IDS`, `COMMANDS_AND_EXIT_CODES`, `SECURITY_REVIEW`, `DB_INTEGRITY`, `ROLLBACK_OR_FORWARD_FIX`, `OPEN_HOLDS`, `REVIEWER_VERDICT`, `OWNER_CHECKPOINT`.

## Gates
- Design handoff: PASS when packet boundaries and evidence/rollback requirements are written, not when runtime tested.
- START-CODE: HOLD until Owner explicit permission + SG-04/05/06/08 verified.
- DB/APP: HOLD until migrations/guards/transaction checks actually run.
- QA: 113 cases NOT RUN; DBT-01..18 require dedupe against QA-SYNC before declaring total test count.
- Security/production: HOLD pending G02 local integration, production KMS/provider approval, email delivery, G04 backup/restore drill, TLS, UAT, all P0 PASS.

## Review escalation
Unknown/conflict => STOP + ASK only for genuine policy, irreversible change, security/cost or scope. Otherwise Reviewer resolves technical detail within locked contracts and documents minimal diff. No executor assignment in this package.
