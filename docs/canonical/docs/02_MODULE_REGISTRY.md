# Module Registry

| Module | Owns | May read | Must not mutate |
|---|---|---|---|
| AUTH | users, credentials, memberships, invites, sessions | HR status for authorization | payroll, reports, accounts |
| HR | employees, job_positions, employee_positions | AUTH identity | credentials |
| ATT | attendance_shifts, breaks, approvals, adjustments | HR membership | payroll finalized |
| REP | daily_reports, entries, revisions | HR, channel references | approved deliverable counts |
| PAY | rates, periods, items, calculation lines, adjustments | ATT approved snapshot, HR eligibility | ATT original records |
| ACC | managed_accounts, secrets, contacts, links | Owner membership | login credentials |
| WORK | work_items, assignments, submissions, reviews, handoffs | HR, channels | HR positions |
| CONTENT/VIDEO (V0.2) | specialized revisions/deliverables | WORK approved submissions | WORK canonical identity |
| STORAGE | folders, files, revisions, receipts, operations, grants | WORK assignments | WORK submissions |
| DASH | no authoritative business rows | module read models | all module-owned truth |
| AUDIT/OUTBOX | audit, email outbox, idempotency | operation metadata | business state outside transactions |

All inter-module writes through owned service/contracts, not cross-module direct mutation. PostgreSQL source of truth; Redis cache-only; Drive binary storage with PostgreSQL metadata; Mac/Windows archive is manual in V0.1.

## DOC-02 ownership correction
WORK foundation owns channels metadata; ACC owns managed accounts and all account secrets. PAY owns payroll_correction_entries. ATT owns immutable shift versions. STORAGE grants must have DB-verifiable target references. Module cross-reads never grant cross-module writes.
