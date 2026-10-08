# Data Dictionary — Schema Baseline (not executable DDL)

## Shared conventions
UUID PK; workspace_id UUID on workspace-owned tables; timestamptz UTC for instants; date for workspace-local business dates; bigint for VND and duration seconds; snake_case; explicit status constraints; composite (workspace_id,id) parent unique keys + workspace-safe child foreign keys; history and finalized finance immutable. No floating point payroll.

## Tables and essential columns
| Table | Essential columns | Constraints / notes |
|---|---|---|
| workspaces | id, name, timezone, status, created_at | timezone defaults Asia/Ho_Chi_Minh |
| users | id, username_normalized, email_normalized, status, version | global unique username/email (technical baseline) |
| user_credentials | user_id, password_hash, credential_version, password_changed_at | Argon2id; never recoverable |
| workspace_memberships | id, workspace_id, user_id, role, status, version | unique(workspace_id,user_id); role owner/staff |
| activation_invites | id, workspace_id, user_id, token_hash, status, expires_at, used_at | one active queued/issued invite; token single-use |
| auth_sessions | id, workspace_id, user_id, session_token_hash, expires_at, revoked_at | no raw session tokens |
| employees | id, workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version | unique workspace/user, workspace/employee_code; Owner false |
| job_positions | id, workspace_id, code, name, is_active | unique workspace/code |
| employee_positions | id, workspace_id, employee_id, position_id, is_primary, started_on, ended_on | nonoverlap effective ranges; max one primary |
| attendance_shifts | id, workspace_id, employee_id, clock_in_at, clock_out_at, status, worked_seconds, version | partial unique open shift per employee |
| attendance_breaks | id, workspace_id, shift_id, started_at, ended_at | partial unique open break per shift; nonoverlap |
| attendance_approvals | id, workspace_id, shift_id, shift_version, reviewer_user_id, decision, reviewed_at | append-only; no self-approval |
| attendance_adjustments | id, workspace_id, shift_id, old_values, new_values, reason, actor_user_id, created_at | proposed schema; audited corrections, no silent edit |
| pay_rates | id, workspace_id, employee_id, hourly_rate_vnd, effective_from, effective_to | nonoverlap effective ranges |
| payroll_periods | id, workspace_id, starts_on, ends_on, status, finalized_at, finalized_by, version | nonoverlap periods; finalized immutable |
| payroll_items | id, workspace_id, period_id, employee_id, approved_seconds, base_pay_vnd, bonus_vnd, allowance_vnd, advance_vnd, deduction_vnd, net_amount_vnd | unique(period,employee), no Owner item |
| payroll_calculation_lines | id, workspace_id, payroll_item_id, shift_id, segment_start_at, segment_end_at, seconds, rate_id, numerator_vnd_seconds | exact calculation trace; proposed |
| payroll_adjustments | id, workspace_id, payroll_item_id, adjustment_type, amount_vnd, reason, created_by, created_at | append-only; after-finalize correction needs separately linked settlement workflow |
| daily_reports | id, workspace_id, employee_id, report_date, notes, version | unique employee/day/workspace |
| daily_report_entries | id, workspace_id, report_id, channel_id, work_type, reported_count, notes | unique report/channel/work_type; count >=0 |
| daily_report_revisions | id, workspace_id, report_id, revision_number, snapshot, edited_by, edited_at | append-only; versioned snapshot schema |
| channels | id, workspace_id, name, platform, managed_account_id, status | no secrets; workspace-safe account FK |
| work_items | id, workspace_id, work_type, title, channel_id, status, due_at, created_by, version | canonical work root |
| work_assignments | id, workspace_id, work_item_id, employee_id, stage, status, assigned_at | resource-scoped rights |
| work_submissions | id, workspace_id, assignment_id, revision_number, submitted_by, submitted_at | unique assignment/revision |
| work_reviews | id, workspace_id, submission_id, reviewer_user_id, decision, feedback, reviewed_at | review exact submission |
| work_handoffs | id, workspace_id, from_assignment_id, to_assignment_id, source_submission_id | approved source; dedupe |
| content_documents / content_revisions | workspace_id, work_item_id/document_id, revision_number, body | V0.2 specialized |
| video_deliverables / video_submissions | workspace_id, work_item_id/deliverable_id, revision_number, storage_file_id | V0.2 specialized; count deliverables not revisions |
| managed_accounts | id, workspace_id, platform, platform_account_id, username, status, notes | Owner only |
| account_secrets | id, workspace_id, account_id, secret_type, ciphertext, nonce, key_version | AEAD key outside DB; one current secret/type |
| contact_points | id, workspace_id, type, normalized_value, display_value | unique workspace/type/value |
| account_contact_links / account_relationships | workspace_id, account_id/contact_point_id or source_account_id/target_account_id, relationship_type | workspace-safe; no self links |
| secret_access_events | id, workspace_id, actor_user_id, account_id, action, created_at | never include secret |
| storage_folders | id, workspace_id, provider, provider_folder_id, status, current_revision_id | unique provider folder identity |
| storage_files | id, workspace_id, folder_id, provider_file_id, provider_revision_id, status | stable provider file ID |
| folder_revisions | id, workspace_id, folder_id, revision_number, snapshot_hash, created_at | unique folder/revision |
| folder_receipts | id, workspace_id, folder_revision_id, confirmed_by, confirmed_at, receipt_type | receipt exact revision |
| storage_operations | id, workspace_id, folder_id, operation_type, status, requested_by, created_at | durable reconciliation |
| resource_access_grants | id, workspace_id, resource_type, resource_id, employee_id, access_level, expires_at, revoked_at | polymorphic FK needs guarded validation |
| email_outbox / email_delivery_attempts | workspace_id, invite_id/outbox_id, status, attempts, provider_message_id | no plaintext activation link |
| idempotency_records | workspace_id, actor_user_id, operation_key, request_fingerprint, status, expires_at | unique workspace/actor/key |
| audit_events | workspace_id, actor_user_id, action, entity_type, entity_id, metadata, created_at | immutable sanitized audit |

## Important design debt
This is a dictionary, NOT complete column-by-column DDL. Audit FK cycles, state CHECK values, indexes, referential delete policies, payroll adjustment settlement, outbox concurrency, and polymorphic grants before migrations. DATA-04 originally omitted some audit and history columns; do not infer they are optional.

## DOC-02 schema amendment
See 14_SCHEMA_FK_AND_SNAPSHOTS.md for attendance_shift_versions, payroll_correction_entries, composite FKs, period timezone snapshots, exact calculation lines and deletion constraints. Existing baseline fields remain unless explicitly corrected.
