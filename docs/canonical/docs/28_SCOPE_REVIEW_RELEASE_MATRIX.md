# SCOPE-REVIEW — Release Matrix V0.1 (doc.7)

Status: **PASS scope classification / HOLD final release freeze**. This document does not override Owner decisions or authorize implementation.

## V0.1 REQUIRED (design baseline, implementation not begun)
| ID | Capability | Acceptance boundary | Owner/Staff |
|---|---|---|---|
| S01 | Owner bootstrap | Restricted one-time setup, no public signup | Owner |
| S02 | Login/logout/session | Secure cookie, CSRF, lock/revoke, password change | Both |
| S03 | Employee invitation | Owner creates employee, queues email, staff activates one-time token and sets password | Owner/Staff |
| S04 | Employee profiles | Employment status and effective-dated professional positions; not new auth roles | Owner |
| S05 | Attendance | Clock-in, unpaid pause/resume, clock-out, multiple shifts per day; server timestamps | Both |
| S06 | Attendance review | Owner approves/rejects versioned completed Staff shift; cannot self-approve | Owner |
| S07 | Daily reports | Draft, submit, revisions retained; self-reported counts distinct from verified counts | Staff/Owner |
| S08 | Payroll | Approved seconds, effective hourly rates, draft/recalculate/finalize, audit, immutable final and correction ledger | Owner; excludes Owner pay |
| S09 | Managed accounts | Owner-only social/email account metadata, encrypted recoverable secrets, reauth/reveal, contact links | Owner |
| S10 | Unified UI | Phone-first dark AppShell, shared components, stable buttons, loading/error/empty states | Both |
| S11 | Foundation | Workspace isolation, audit, transactional outbox, idempotency, migration and security gates | Backend |

Required means included in the **V0.1 product goal**, not that implementation is complete or safe to release.

## NOT IN V0.1 DEFAULT RELEASE (V0.2 / later)
| ID | Capability | Target |
|---|---|---|
| D01 | Content script drafting, revision and Owner approval pipeline | V0.2 |
| D02 | Content→Editor handoff, Editor video submission and approval | V0.2 |
| D03 | Advanced Google Drive assigned folder access, receipts, revision invalidation, Trash reconciliation | V0.2 unless Owner explicitly opts in |
| D04 | Advanced KPI scoring/automation and verified production metrics | Later |
| D05 | Automated Mac/Windows archive, Drive deletion/cleanup automation | Later, explicit approval |
| D06 | Payroll settlement, bank integration, statutory tax/insurance engine | Later, separate policy |
| D07 | Multi-workspace selector UI and workspace administration expansion | Later; secure binding in core still required |
| D08 | Public registration, Staff secret visibility, Owner self-approval, Owner payroll | Prohibited by current policies, not backlog |

## CONDITIONAL / REQUIRES OWNER CHOICE
| ID | Choice | Safe default until decision |
|---|---|---|
| C01 | Forgotten open shift: who proposes corrected clock-out, supporting evidence and approval | No inferred clock-out; unresolved shifts excluded from payroll |
| C02 | Staff may revise submitted daily report directly or must request Owner reopen | Preserve submitted version; do not permit post-submit edit until approved |
| C03 | Foundational WORK assignments and basic assigned Drive folder access in V0.1 | No WORK/Drive UI or migrations in release by default; design retained |
| C04 | Handling negative net payroll | Block finalize of affected payroll item; no automatic carryover |
| C05 | Reauth requirement for updating/replacing managed-account secrets | Require reauth as security-hardening pending Owner UX approval; reveal always reauth |
| C06 | If multiple workspace memberships exist, expose selector in V0.1? | Scope session to explicit authorized workspace, do not silently switch; UI expansion deferred |

Do not treat safe defaults as approved business policies. STOP+ASK when affected use case is needed.

## Release minimum
S01–S11 implemented and independently verified; all in-scope P0 security, tenant, payroll, attendance and migration tests PASS; actual DB migration and rollback/recovery rehearsals; real email delivery; secret key custody/backup evidence; Owner acceptance. Design-only PASS is not runtime PASS.

## Approved resolution (doc.8)
C01–C06 in the preceding CONDITIONAL table are **historical pre-approval choices**, not current HOLDs. The Owner has approved all six; see `30_SCOPE_LOCK_OWNER_APPROVAL.md` for authoritative decisions. WORK and Drive are deferred to V0.2; V0.1 release includes S01–S11 only. Negative payroll blocks entire atomic period finalization pending Owner resolution; do not alter PAY-02 calculation or finalized records.
