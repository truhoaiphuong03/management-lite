# API-READY — State transitions, concurrency, external providers
## State transition contracts
AUTH user pending_activation->active on single-use token; active->suspended by Owner; suspended->active only via authorized reactivate. Membership and employment status independent; active user alone does not imply active membership. Session revoked after suspension/password change.
ATT run working->paused->working->completed; clock-out from paused 422. Review unreviewed->approved|rejected for exact immutable shift_version; correction creates new version unreviewed. Never edit version already used in finalized payroll. Reviewer != employee user, including Owner self.
REP draft->submitted; edits to draft create immutable revisions; post-submit edits require explicit reopen/revision workflow, not silent PATCH.
PAY draft->finalized only; never finalized->draft. Calculate draft-only; atomic finalize freezes source version IDs, calculation revision and timezone. Post-finalize correction separate append-only ledger.
ACC active<->archived; reveal does not change account status; reauth proof consumed on reveal; never leak through list/detail.
DRIVE OPTIONAL: trash request pending->running->completed or unknown->reconciled->completed|failed; actual ACL/revision/receipts checked immediately before external mutation. Full Drive not a V0.1 release dependency unless scope gate approves.

## Database transaction and concurrency matrix
Clock-in: lock employee/open shift key, DB uniqueness for open shift, insert shift + audit + idempotency in one transaction. Pause/resume/clock-out: lock shift, If-Match, server timestamp, state transition + break + snapshot + audit atomically. Review: lock shift and version; reviewer authority, unique review/version, audit atomically. Adjust: lock shift, append version/adjustment, invalidate current review for future calculation; historical approvals remain immutable. Calculate: consistent read of approved snapshots/rates, revisioned draft, exact numerator, no double segments; stale inputs invalidate calculation. Finalize: lock period, verify source revisions and eligibility, write immutable snapshots and period finalized atomically. Secrets: verify reauth proof atomically consumed, recheck permission and key version, decrypt only for response; never persist plaintext. Activation: consume invite, set credential hash and user state in one transaction; email outbox separate delivery. External provider: transaction persists intent/outbox; worker does operation and reconciles ambiguous results.

## Error and replay tests
Concurrent double clock-in => one shift; second identical idempotency request replay, different key conflicts. Concurrent approve same version => one decision. Calculate vs adjustment => finalize must detect stale source. Two finalize requests => one snapshot, safe replay. Concurrent secret reveals with same proof => one success only. Invite resend vs activation => no use of revoked token. Trash vs folder revision change => no provider trash if receipt stale. Idempotency records MUST NEVER cache plaintext secret, passwords, activation links, or reauth proofs.

## External endpoints (design only, OPTIONAL scope)
GET/POST /storage/folders; GET /storage/folders/{id}/files; POST /storage/folders/{id}/receipts; POST /storage/folders/{id}/trash-requests; POST /storage/trash-requests/{id}/confirm; GET /storage/operations/{id}. Owner Trash requires version precondition, two-step confirmation, latest receipt and ACL recheck. Worker ambiguous timeout => unknown, not completed.
WORK foundation OPTIONAL: GET/POST /work-items, GET /work-items/{id}, GET /work-items/{id}/history, POST /work-items/{id}/assignments. Full Content/Video submit/review/handoff V0.2. No endpoint here authorizes an unapproved scope expansion.


## Normative state/guard supplement (doc.11)
See docs/37: shift run_state excludes needs_review; review state separate; Owner correction decision never equals approval; paused open breaks require explicit evidence-supported end; atomic reauth proof consumption and payroll finalize; no inferred paid seconds.
