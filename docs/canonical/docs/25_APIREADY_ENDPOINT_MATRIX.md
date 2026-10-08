# API-READY — Endpoint matrix (V0.1 core)
Each row: METHOD path | authorization | request essential fields | result / state | concurrency. All routes `/api/v1` and envelopes per doc 24. `self` means authenticated actor's employee membership. Owner-only requires active Owner membership; active Staff may access only self. For scoped resource mismatch use 404. Mutation requires CSRF and audit; POST uses Idempotency-Key unless marked authentication-only.

## AUTH
- POST /auth/login | anonymous | `{identifier,password}` | 200 `{user,active_workspace,session_expires_at}`; rotates session; 401 generic bad credentials | login replay controls, rate limit, no idempotency cache.
- POST /auth/logout | authenticated | `{}` | 204 session revoked | CSRF; repeat safe.
- GET /auth/me | authenticated | none | 200 `{user,memberships,active_workspace,permissions}` without secrets.
- POST /auth/activate | anonymous invite | `{token,new_password}` | 200 activation used atomically, no auto-login assumption | single-use hash, 410 expired/revoked, replay denied.
- POST /auth/password/change | authenticated | `{current_password,new_password}` | 200 credential version increments, old sessions revoked | rate limit, CSRF, no secret echo.
- POST /auth/reauth | Owner only | `{password,action,account_id}` | 200 `{reauth_proof,expires_at}` | bound to session/account/action, 5min max, proof never logged, not reusable.
- POST /employees/{id}/activation-invites | Owner | `{}` | 202 `{invite_id,delivery_status:"queued"}` | idempotency; revoke prior usable invite atomically; provider accepted != delivered.
- GET /employees/{id}/activation-status | Owner | none | 200 `{activation_status,invite_status,delivery_status}` | no token.

## HR
- GET /employees | Owner | cursor,limit,status | 200 paged redacted list.
- POST /employees | Owner | `{employee_code,full_name,email,positions?}` | 201 `{id,employment_status:"invited",version}` | idempotency, unique code; no plaintext password.
- GET /employees/{id} | Owner or self | none | 200 scoped employee profile; staff sees only allowed fields.
- PATCH /employees/{id} | Owner | `{full_name?,employment_fields?}` | 200 updated version | If-Match, deny role escalation fields.
- POST /employees/{id}/suspend | Owner | `{reason}` | 200 suspended + revocation | If-Match, idempotency; cannot silently remove last Owner.
- POST /employees/{id}/reactivate | Owner | `{reason}` | 200 reactivated only when auth conditions valid | If-Match, idempotency.
- POST /employees/{id}/positions | Owner | `{position_id,started_on,ended_on?,is_primary}` | 201 effective-dated assignment | If-Match employee; reject overlap.
- GET /employees/me | self | none | 200 own employee.
- GET /job-positions | Owner/Staff | none | 200 active positions metadata, no implied permissions.

## ATT
- POST /attendance/shifts | self | `{}` | 201 `{shift_id,run_state:"working",clock_in_at,version}` | server time, one open shift, idempotency.
- POST /attendance/shifts/{id}/breaks | shift owner | `{}` | 201 `{break_id,started_at,run_state:"paused",version}` | server time, only working, If-Match.
- POST /attendance/shifts/{id}/resume | shift owner | `{}` | 200 `{ended_at,run_state:"working",version}` | server time, only paused, If-Match.
- POST /attendance/shifts/{id}/clock-out | shift owner | `{}` | 200 `{clock_out_at,run_state:"completed",shift_version_id,version}` | only working; server time; creates immutable snapshot; If-Match.
- GET /attendance/me | self | `{from_date?,to_date?,cursor?}` | 200 own shifts with separate run/review states.
- GET /attendance/shifts | Owner | filters,cursor | 200 workspace-scoped shifts.
- GET /attendance/shifts/{id}/versions | Owner or self | none | 200 immutable versions and redacted reviews.
- POST /attendance/shifts/{id}/reviews | Owner, never own shift | `{shift_version_id,decision:"approved"|"rejected",reason?}` | 201 immutable review; one decision/version | If-Match shift; idempotency; reject if version stale; reason required for rejection.
- POST /attendance/shifts/{id}/adjustments | Owner | `{reason,proposed_clock_in_at?,proposed_clock_out_at?,proposed_breaks?}` | 201 `{adjustment_id,new_shift_version_id,review_state:"unreviewed"}` | If-Match; cannot rewrite finalized sources; OPEN-SHIFT correction authorization and evidence remain HOLD (see doc 27).

## REP
- GET /reports/me | self | date range,cursor | 200 own reports.
- GET /reports/daily | Owner | date range,employee_id,cursor | 200 scoped reports.
- POST /reports/daily | self | `{report_date,entries:[{work_type,reported_count,notes?}]}` | 201 draft report + revision | idempotency, one employee/day.
- PATCH /reports/daily/{id} | report owner, draft only | `{entries}` | 200 new immutable revision | If-Match.
- POST /reports/daily/{id}/submit | report owner | `{}` | 200 submitted with timestamp and revision | If-Match/idempotency; added explicit endpoint missing in API-02.
- GET /reports/daily/{id}/revisions | Owner or report owner | none | 200 revision history; submitted changes require new revision workflow (see doc 27).

## PAY
- GET /payroll/me | staff self only | period filters | 200 own finalized items; Owner has no own payroll.
- GET /payroll/periods | Owner | cursor,status | 200 periods.
- POST /payroll/periods | Owner | `{starts_on,ends_on}` | 201 draft period with timezone snapshot | idempotency, reject overlaps.
- GET /payroll/rates | Owner | employee_id,date filters | 200 effective rates.
- POST /payroll/rates | Owner | `{employee_id,hourly_rate_vnd,effective_from,effective_to?}` | 201 rate; no overlap | idempotency; effective dating; historical finalized snapshots immutable.
- POST /payroll/periods/{id}/calculate | Owner | `{}` | 200 `{calculation_revision,items,blocking_errors}` (if blocking errors, no valid finalization) | If-Match + idempotency; exact integer numerator, single half-up round/employee/period.
- GET /payroll/periods/{id}/items/{item_id}/calculation-lines | Owner or employee self | cursor | 200 source version, segment, rate snapshot and numerator, no unrelated employee data.
- POST /payroll/periods/{id}/finalize | Owner | `{}` | 200 `{status:"finalized",finalized_at,snapshot_hash}` | If-Match, idempotency, one atomic transaction; missing rate/stale approval/overlap/negative net HOLD.
- POST /payroll/adjustments | Owner | `{payroll_item_id,adjustment_type,amount_vnd,reason}` | 201 draft-period adjustment | If-Match item; immutable provenance.
- POST /payroll/corrections | Owner | `{original_payroll_item_id,amount_vnd,reason,evidence_reference?}` | 201 signed append-only correction, no rewrite/disbursement | idempotency; correction posting semantics HOLD if user asks actual payout.

## ACC
- GET /accounts | Owner | cursor,platform,status | 200 metadata only, never secrets.
- POST /accounts | Owner | `{platform,username?,platform_account_id?,notes?}` | 201 account metadata | idempotency.
- GET /accounts/{id} | Owner | none | 200 metadata only.
- PATCH /accounts/{id} | Owner | metadata patch | 200 new version | If-Match.
- POST /accounts/{id}/archive | Owner | `{reason?}` | 200 archived | If-Match/idempotency; no deletion.
- POST /accounts/{id}/restore | Owner | `{}` | 200 active | If-Match/idempotency.
- PUT /accounts/{id}/secrets | Owner | `{secret_type,secret_value,reauth_proof}` | 200 `{secret_version,updated_at}` no plaintext | If-Match account, idempotency metadata only; proof single-use; ciphertext AEAD AAD-bound.
- POST /accounts/{id}/secrets/reveal | Owner | `{secret_type,reauth_proof}` | 200 `{secret_value}` only here | single-use proof, no idempotency replay caching, no-store, audited, rate-limited.
- GET /contact-points | Owner | filters,cursor | 200 normalized metadata.
- POST /accounts/{id}/contact-links | Owner | `{contact_point_id,relationship_type}` | 201 typed link | idempotency, composite FK; ambiguous email no auto-link.


## Normative API-SYNC endpoint matrix supplement (doc.11)
See docs/36 for full request/response, authorization and concurrency contracts: POST /attendance/shifts/{id}/correction-requests; POST /attendance/correction-requests/{id}/decide; POST /reports/daily/{id}/revisions; PUT /accounts/{id}/secrets; POST /payroll/periods/{id}/finalize; POST /auth/login; GET /auth/me. All WORK/Drive endpoints above are V0.2 REFERENCE ONLY, NOT V0.1.
