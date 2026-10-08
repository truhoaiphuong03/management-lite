# DB-READY — AR-01..AR-20 closure and Decision Log
| Finding | Design resolution | Verification |
|---|---|---|
| AR-01 | immutable shift versions; approval FK version | DB immutability, stale approval |
| AR-02 | correction ledger separate from finalized payroll | deny UPDATE finalized, ledger audit |
| AR-03 | [) segments, coverage guard, no duplicate seconds | overlap/concurrency test |
| AR-04 | typed resource grants or DB validated registry | dangling grant FK test |
| AR-05 | invitation state separate from outbox, token hashed | replay/expiry/retry test |
| AR-06 | two-step Trash/reconcile (optional Drive) | timeout/revision race test |
| AR-07 | If-Match, idempotency, transactional locks | concurrent mutation test |
| AR-08 | FK DAG and migration gate | fresh/replay migration test |
| AR-09 | global users + workspace membership | multi-workspace isolation |
| AR-10 | employee composite membership FK | mismatched membership test |
| AR-11 | employment vs auth states separate | invite/activation test |
| AR-12 | WORK reads account metadata, not secrets | permission tests |
| AR-13 | report draft/submitted + revisions | history test |
| AR-14 | status registry and CHECK | invalid state test |
| AR-15 | 412 precondition vs 409 conflict | API contract test |
| AR-16 | submission decision bound to revision (V0.2) | deferred |
| AR-17 | dependency DAG; specialized V0.2 deferred | migration review |
| AR-18 | timezone snapshot pinned | boundary tests |
| AR-19 | Drive ACL reconciliation (optional) | deferred until release |
| AR-20 | adjustment/calc trace endpoints required | API-READY gate |

## Decisions DBR-01..DBR-12 (technical, no Owner policy change)
DBR-01 tenant composite FK; DBR-02 append-only approved shift versions; DBR-03 run/review states distinct; DBR-04 immutable finalized payroll; DBR-05 correction ledger separate from settlement; DBR-06 half-open time/date intervals; DBR-07 exact numerator arithmetic and once-per-period rounding; DBR-08 explicit unique/exclusion constraints; DBR-09 no unverified polymorphic grants; DBR-10 staged FK migration DAG; DBR-11 secret encryption metadata, external key; DBR-12 defer V0.2 and optional WORK/Drive pending scope lock.

## Known unresolved before DEV-READY PASS
- No executable DDL or PostgreSQL tests (deliberate: Owner said no code).
- API-READY needs field-level request/response for adjustment and calculation trace.
- SCOPE-REVIEW needs explicit V0.1 release choice for optional WORK/Drive foundation.
- Security deployment requires real key management/backup/restore proof.
- Negative net pay is an Owner policy decision only if in scope; never invent handling.
