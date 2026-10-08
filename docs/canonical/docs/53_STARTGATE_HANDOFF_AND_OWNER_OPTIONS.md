# START-GATE — Owner decision options and handoff checklist
Version 0.1.0-doc.18 | Not an implementation authorization

## Choice A: Approve foundation-only implementation later
Requires Owner explicit message authorizing code, naming new repository, and scope P0/P1. Verify SG-04/05/06/08 before touching code. No production release.

## Choice B: HANDOFF-REVIEW (recommended)
Audit each packet for inputs, owned paths, exclusive migration/contract writers, verification outputs, STOP triggers, rollback and anti-regression; no dispatch.

## Choice C: QA-FINAL
Deduplicate 113 QA-SYNC scenarios and DBT-01..18; assign stable test IDs, fixture, expected state, priority, module and evidence format.

## Choice D: TOOLCHAIN-VERIFY
Read-only verification of actual Mac/runtime/repository state when user provides access; do not create files, databases or install software without explicit permission.

## STOP/ASK
Unknown repository or existing data; migration destructive or unsupported PostgreSQL exclusion strategy; unprotected encryption keys; cross-module ownership conflict; paid service; changes to locked Owner policy.

## Handoff evidence format
Packet ID; canonical SHA; base commit; allowed paths; contract version; migration set; test commands and results; security check; rollback; blockers; reviewer decision PASS/HOLD.
