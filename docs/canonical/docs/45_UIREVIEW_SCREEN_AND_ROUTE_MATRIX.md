# UI-REVIEW — V0.1 Screen and Route Inventory
Version 0.1.0-doc.15 | Screen/route names are proposed design contracts, not existing code.

| ID | Route (proposed) | Owner | Staff | Critical states and actions |
|---|---|---|---|---|
| UI01 | /login | public | public | login, invalid credentials, rate limit, expired session |
| UI02 | /activate | invited | invited | one-use invite, expired/revoked token, password setup; fake-email banner in local |
| UI03 | / | yes | yes | scoped dashboard, no cross-workspace totals |
| UI04 | /clock | yes | yes | clock-in, pause/resume, clock-out, duplicate submit, network unknown |
| UI05 | /attendance | own + all Staff | own | shift history, versions, timezone, unpaid breaks |
| UI06 | /attendance/corrections | decide others | request own | C01 request reason, Owner sets end time, pause evidence, pending/blocked |
| UI07 | /attendance/review | Staff only, not own | no | approve/reject exact current completed version, stale version conflict |
| UI08 | /reports | all read | own read | draft/submitted/revised, history |
| UI09 | /reports/new | optional admin access | yes | draft, submit, error recovery |
| UI10 | /reports/:id | all read | own | C02 new revision, immutable prior versions, stale revision |
| UI11 | /employees | yes | no | list, filters, suspended state |
| UI12 | /employees/new | yes | no | invite/create, email pending != delivered |
| UI13 | /employees/:id | yes | own limited profile only via /me | edit, suspend, roles vs positions |
| UI14 | /payroll | yes | no | period list, draft, incomplete inputs, finalized |
| UI15 | /payroll/:id | yes | no | calculation preview, negative net blocks all finalize, immutable ledger |
| UI16 | /my-pay | no | yes | own finalized amounts only; no Owner payroll |
| UI17 | /accounts | yes | no | ACC metadata Owner only, no secret in list |
| UI18 | /accounts/:id | yes | no | metadata, reauth reveal/change, expiry and no-store |
| UI19 | /audit | yes | no | redacted timeline, filter, no secret values |
| UI20 | /settings | yes | own password/session settings | workspace context read-only, logout/change password |
| UI21 | /not-found and /forbidden | context-dependent | context-dependent | no tenant information leak; safe return path |

Routes are illustrative; route registry must use a single mapping and canonical permissions. Exact URL names remain an implementation naming choice, not an authorization policy. Owner payroll eligibility false, even if Owner clocks. Owner review of own attendance unavailable. Staff never sees ACC metadata. WORK, Drive, Content and Video screens/menus/routes are V0.2 only. No workspace selector in V0.1.

## State coverage per screen
Every mutation screen: initial/loading/ready/empty/validation-error/network-error/409 conflict/412 stale/428 missing precondition/success confirmed; 401 session expired and 403 unauthorized handled centrally. Async email: queued/accepted/delivered/failed distinct. C01 correction: requested/needs-evidence/decided/version-created/awaiting-approval/rejected; do not imply payment eligibility until approved. C02: revision history with immutable previous submission. C04: show negative employee(s) and block atomic finalize, never clamp. C05: reauth one-use and action/account/session bound. C06: if active workspace ambiguous, show blocked state, never silently choose.
