# Scope & Domain Model — V0.1

## MVP priority
1. Owner bootstrap and sign-in; Owner creates Staff, invitation email and staff password activation.
2. Staff/Owner clock-in, unpaid pause/resume, clock-out; Owner reviews Staff attendance.
3. Staff daily work report; Owner review/summary.
4. Owner-only managed account metadata, encrypted recoverable external account secrets, contact linking and secure reveal.
5. Payroll from approved seconds with Owner excluded; staged release gate.
6. Foundational work assignments and assigned Drive access only where explicitly approved.

Full Content script approval → Editor video approval pipeline belongs to V0.2. Advanced KPI belongs to later phases.

## Domain relationships
User 1—N WorkspaceMembership; Workspace 1—N Employee; Employee N—M JobPosition via EmployeePosition; Employee 1—N AttendanceShift 1—N AttendanceBreak and approvals; Employee 1—N DailyReport; Workspace 1—N WorkItem 1—N WorkAssignment 1—N WorkSubmission; WorkSubmission 1—N WorkReview; WorkItem → specialized ContentDocument / VideoDeliverable (V0.2); ManagedAccount N—M ContactPoint; StorageFolder 1—N FolderRevision 1—N FolderReceipt; PayrollPeriod 1—N PayrollItem 1—N PayrollCalculationLine.

## Canonical identity
Owner and Staff are authorization roles. Content Creator and Video Editor are job positions, not roles. One User and one Employee per workspace; future multiple effective-dated positions. An assignment and suitable professional position or explicitly approved scoped exception are required to work on specialist material. Workspace boundary enforced in backend and database.
