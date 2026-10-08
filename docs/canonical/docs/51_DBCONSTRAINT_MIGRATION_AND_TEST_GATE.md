# DB-CONSTRAINT — Migration, concurrency and QA gate
Version 0.1.0-doc.17 | DESIGN ONLY

## V0.1 migration allowlist and dependencies
- M00: approved PostgreSQL extension choice; if `btree_gist` cannot be used, choose equivalent serialized enforcement with proof before deployment (not automatic policy change).
- M01: workspace/global users/audit/idempotency foundation.
- M02: membership/credential/session/invite/email outbox.
- M03: HR employees/positions.
- M04: ATT shift/break/version/approval/correction request/decision; install immutable and overlap guards in same safe release boundary.
- M05: PAY rates/periods/items/lines/adjustments/correction ledger; finalized write protection before writable release.
- M06: ACC account/secret/reauth-proof/access audit; key never in database.
- M07: REP reports/entries/revisions; no channel FK.
- M11: only necessary core integrity/index/audit/outbox/idempotency guard, installed before allowing unsafe writes; staged migrations with explicit no-write boundary.
- M08 WORK, M09 Drive, M10 Content/Video: **excluded V0.1**.
- Migration identifiers are logical groups, NOT filenames or executed scripts.

## DB acceptance scenarios (future executable tests; NOT RUN)
| ID | Priority | Expected result |
|---|---|---|
| DBT-01 | P0 | Cross-workspace FK mutation rejected for every multi-parent edge |
| DBT-02 | P0 | Concurrent clock-in same employee cannot create two open shifts |
| DBT-03 | P0 | Closed shift cannot overlap open/closed shift under concurrent writes |
| DBT-04 | P0 | Open break cannot be guessed closed by C01; unsupported evidence blocks decision |
| DBT-05 | P0 | Stale approval or version cannot be used in new payroll |
| DBT-06 | P0 | Employee cannot self-approve; Owner cannot self-approve own shift |
| DBT-07 | P0 | Payroll paid-second overlap rejected across items/periods and versions |
| DBT-08 | P0 | Rate effective ranges nonoverlap and split exact seconds, local day boundary |
| DBT-09 | P0 | Negative net in one item rolls back entire period finalize |
| DBT-10 | P0 | Finalized rows and attendance version/audit/ledger UPDATE/DELETE rejected |
| DBT-11 | P0 | Reauth proof replay/wrong session/account/action rejected atomically |
| DBT-12 | P0 | Ambiguous/revoked workspace binding fails closed |
| DBT-13 | P0 | Invite/outbox retries never persist raw token/link/secret |
| DBT-14 | P0 | Clean migration, checksum replay and restart preserve constraints |
| DBT-15 | P0 | V0.1 schema contains no WORK/Drive/Content/Video migrations or feature tables |
| DBT-16 | P0 | Encrypted off-server backup and successful restore/key recovery demonstrated before production |
| DBT-17 | P1 | DST/local midnight and hourly rate boundary arithmetic stable |
| DBT-18 | P1 | Duplicate Idempotency-Key across routes isolated and secret-free |

These are **DB-focused acceptance additions/cross-references**, not 18 executed tests and not an automatic renumbering of the 113 QA-SYNC cases. QA must deduplicate and formally integrate before release. Any schema discrepancy that requires a new business policy => STOP + ASK Owner.

## Handoff boundary
No code, migrations, repository creation, provider purchase or executor assignment. DB-CONSTRAINT is design-audit only. The next recommended gate is START-GATE (readiness decision), with DBT-01..18 recorded as future implementation acceptance evidence.
