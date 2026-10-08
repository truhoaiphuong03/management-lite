# SCOPE-REVIEW — Decisions, Traceability, HOLD gates

## Precedence
Owner-approved PAY-021..028, RBAC-02, SEC-02 and prior Owner scope > design suggestions. V0.1 minimum stays AUTH/HR/ATT/REP/PAY/ACC/shared UI. Full Content→Editor remains V0.2.

## Scope decisions
SCP-D01 Preserve S01–S11 as V0.1 goal; no staged release that silently drops payroll or accounts.
SCP-D02 Full Content/Video and advanced Drive workflows V0.2; no optional migrations by default.
SCP-D03 WORK foundation and basic Drive remain conditional, not automatically included.
SCP-D04 No public signup; Owner and Staff only; Content/Editor are positions.
SCP-D05 Owner attendance allowed but Owner payroll and self-approval prohibited.
SCP-D06 PAY-02 formula, snapshots, rounding, finalized immutability preserved.
SCP-D07 Staff has no ACC metadata/secret access; SEC-02 controls required.
SCP-D08 All external integrations must distinguish queued/unknown from completed.
SCP-D09 Keep C01–C06 as unresolved Owner/business or UX gates; no silent choice.
SCP-D10 No code, no migration, no executor task, no release approval.

## Traceability
- AR-01/03, PAY-02 -> S05/S06/S08; AR-02 -> S08; AR-04/09/10 -> S11.
- SEC-T01..T12, RBAC-02 -> S02/S03/S09/S11.
- API-R01..R14 -> S01..S11, optional D01..D03.
- API HOLD H01 -> C01; H02 -> C02; H03 -> C04/D06; H04 -> C03; H05/H06 -> release test gates; H07 -> C06; H08 -> C05.

## Gate status
Scope classification: PASS (design). Final scope freeze: HOLD pending C01/C02/C03 and any Owner-sensitive choices that affect the first release. Security deployment, actual DDL/API tests, QA-03, migration evidence and DEV-READY: HOLD. Owner approval required for any irreversible or policy-affecting change.

## SCOPE-LOCK override (doc.8)
SCP-D03 and SCP-D09 were provisional; they are superseded by Owner-approved C01–C06 in `30_SCOPE_LOCK_OWNER_APPROVAL.md`. Final V0.1 feature boundary S01–S11 is now **LOCKED (design)**. The old gate sentence about C01/C02/C03 being unresolved is historical. Runtime release gates remain HOLD.
