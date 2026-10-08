# Migration & Release Readiness

## Proposed migration dependency order (not SQL)
M01 foundation workspaces/users/credentials/memberships; M02 auth invites/sessions/outbox; M03 HR; M04 attendance; M05 payroll; M06 accounts/secrets/contacts; M07 channels/work foundation; M08 specialized content/video (V0.2); M09 reports; M10 storage; M11 audit/idempotency/index/guards. Reorder by actual FK dependency graph; resolve cycles by deferred FK creation.

## Mandatory guards
Version/checksum migration tracking; no destructive rename/drop/reset; transaction where supported; backup and restore plan for risk; no production seed data; schema compatibility tests; explicit composite workspace FK, unique and exclusion constraints, referential delete policy, immutable finalized finance enforcement. Never apply migration until architecture review and Owner release checkpoint.

## Delivery stages
Design pack → ARCH-REVIEW (resolve conflicts) → SEC-02 (threat model) → DEV-READY task packets → repository/bootstrap → AUTH+HR → ATT+REP → ACC secrets → PAY → optional foundational WORK/STORAGE → V0.2 Content/Video. Each stage needs contract tests and P0 evidence before PASS. No executor assignments in this pack.

## DOC-02 migration amendment
See 16_MIGRATION_DAG_AND_QA.md for dependency-aware DAG and gates. No executable migrations created.


## V0.1 scope gate (doc.11)
Release excludes WORK/Drive/Content/Video endpoints, UI and feature-specific migrations. Allowlist M00–M07 plus essential M11 core guards; verify in build/migration checks.
