# RBAC-02 — Access Contract

Roles: owner, staff. Positions: content_creator, video_editor, extensible effective-dated. Authorization requires valid session, active workspace membership, active employee when relevant, permission, resource scope, valid workflow state, and audit. Default deny; hidden cross-workspace or unassigned resources return 404 where appropriate.

| Resource | Owner | Staff | Content / Editor |
|---|---|---|---|
| Employee administration | CRUD + suspend | own limited read | same as Staff |
| Attendance | own clock, review other Staff | own clock/read | same as Staff |
| Payroll | rates, calculate, finalize, read all; no Owner pay | own pay | same as Staff |
| Reports | read all | own create/edit/read | same as Staff |
| Work | create, assign, review, handoff | assigned read/submit | assignment AND appropriate position (or explicitly approved scoped exception) |
| Accounts / secrets | manage; reveal after reauth | none | none |
| Drive | manage; conditional trash | assigned access/receipt | assigned access/receipt only |
| Audit | read all | none | none |

Owner cannot approve their own attendance; Owner payroll eligibility false in V0.1. A UI PermissionGate is not security. Backend enforces all rules. Position alone never grants access to all channel files. Revocation effective on subsequent requests, even with existing sessions.
