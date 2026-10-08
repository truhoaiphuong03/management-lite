# PRE-DEV — Module ownership and future work packets
Version: 0.1.0-doc.13 | PLANNING ONLY | No assignment

## Ownership matrix
| Module | Owns | Reads through contracts | Forbidden |
|---|---|---|---|
| AUTH | users, credentials, membership, activation, session, outbox | HR employee link | plaintext login passwords, cross-workspace bypass |
| HR | employees, positions, effective assignments | AUTH membership | mutating AUTH identity/session |
| ATT | shifts, breaks, immutable versions, correction requests, reviews | HR employment context | automatic clock-out, Owner self-approval |
| REP | daily reports and append-only revisions | HR employee context | rewriting submitted revision, auto KPI approval |
| PAY | rates, periods, items, calculation lines, correction ledger | ATT approved immutable version, HR eligibility | mutating attendance, Owner payroll, negative finalize |
| ACC | managed accounts, AEAD ciphertext, contacts, secret access audit | AUTH reauth proof | revealing to Staff, plaintext logs/export |
| PLATFORM | audit, idempotency, database/migrations, observability | explicit module events | business mutation outside owner module |
| UI | AppShell, design tokens, shared controls | API contracts | role security by UI-only hiding |

## Future packets (not dispatched)
| Packet | Prerequisite | Deliverable | Evidence |
|---|---|---|---|
| PK-00 | Owner start permission, DG-03..06 plan | repo/bootstrap and environment contract | pinned toolchain, secrets exclusion, canonical checksum |
| PK-01 | PK-00 | core schema, migrations, audit, idempotency | fresh migrate/replay, FK and tenant tests |
| PK-02 | PK-01 | AUTH/HR/session/activation | session, CSRF, invitation retries, RBAC tests |
| PK-03 | PK-02 | ATT correction, immutable snapshots/reviews | C01 paused-break, overlap, concurrency, self-approval denial |
| PK-04 | PK-03 | PAY rate split, exact rounding, finalize, correction ledger | PAY-02 fixtures, negative net full-period block |
| PK-05 | PK-02 | REP immutable revisions | C02 revisions and authorization tests |
| PK-06 | PK-02 and approved key custody | ACC secrets, reauth reveal/write | C05 single-use proof, key fail-closed, leak tests |
| PK-07 | contracts and module APIs stable | unified phone-first UI | 360px, stable buttons, loading/error, a11y |
| PK-08 | PK-01..07 | end-to-end QA, backup/restore, security, UAT | all P0 PASS, Owner release approval |

## Parallelization constraints
PK-05 and PK-06 may parallelize only if DB/API contract and active files do not overlap. PK-07 design preparation may parallelize, but integration waits for stable APIs. One migration writer; one owner for each shared file; review before merge; no executor has been assigned.

## STOP triggers
Any unknown policy, key-custody risk, costs, destructive data change, owner self-review, payroll formula deviation, workspace ambiguity, secret leakage, V0.2 scope creep. Ask Owner only for genuine policy/security/cost/scope decisions.
