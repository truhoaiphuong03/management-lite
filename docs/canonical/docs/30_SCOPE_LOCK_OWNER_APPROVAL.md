# SCOPE-LOCK — Owner-approved C01–C06
Version: 0.1.0-doc.8 | Date: 2026-10-08 | Authority: explicit Owner instruction

## OWNER APPROVAL — SCOPE-LOCK (2026-10-08, doc.8)
These six choices are explicitly Owner-approved, superseding only prior *conditional* C01–C06 entries in doc.7; PAY-02, RBAC-02 and SEC-02 remain unchanged.

| ID | Approved decision | Invariant / implementation boundary |
|---|---|---|
| C01 | Employee requests forgotten clock-out correction; Owner decides actual corrected clock-out | No automatic/inferred end time; employee provides reason, Owner records explicit time and audit; approved current immutable shift version required before payroll. Owner cannot self-approve their own attendance. |
| C02 | Employee may submit a new revision after daily report submission | Submitted prior versions remain immutable, timestamped and attributable; no overwrite. |
| C03 | WORK and Drive deferred to V0.2 | No WORK/Drive UI, endpoints, or feature-specific migrations in V0.1 release. Foundation references are design-only; generic storage abstraction may remain where core depends on it. |
| C04 | Negative net pay blocks finalize pending Owner resolution | No clamp-to-zero, silent carryforward or negative finalized item. Block atomic payroll-period finalize if any affected employee item negative; Owner must correct permissible draft inputs or defer pending separately approved policy. |
| C05 | Reauthentication mandatory for changing/replacing managed-account secret | Same SEC-02 action-scoped, short-lived, single-use mechanism; reveal continues to require reauth; audit without secret values. |
| C06 | V0.1 uses one explicitly authorized active workspace context; no workspace selector | Do not silently switch workspaces. Membership and workspace isolation remain enforced; multi-membership underlying identity not deleted. |

**Authority:** User's explicit approval in conversation. **Scope:** design only; no code, repo, migration, executor task or release approval. **Status:** C01–C06 RESOLVED/LOCKED; QA/real integration/production readiness still HOLD.

## Compatibility review
- **PAY-02 PASS:** C01 cannot bypass completed/current-version/Owner-approved attendance; C04 only adds a pre-finalize block for negative net, does not change seconds, split, rounding, Owner exclusion, or immutable finalized ledger.
- **RBAC-02 PASS:** C01 correction only Owner decides; no Owner self-approval; C02 staff edits only own report via new immutable revision; C03 excludes specialized WORK/Drive rights; C06 requires explicit active workspace binding.
- **SEC-02 PASS:** C05 strengthens secret update by mandatory reauth; existing Owner-only secret access, one-time action-scoped reauth, audit, encryption and no plaintext log stay intact. C06 retains tenant isolation.
- **API/FLOW follow-up required:** define forgotten-shift correction request, explicit Owner decision timestamp/reason, versioning and conflict responses; report revision endpoint; secret mutation reauth proof; workspace binding in session; negative payroll atomic finalize guard. These are contract/QA follow-ups, not Owner-policy HOLDs.

## Release gate
Scope policy: PASS / LOCKED. API/DDL/QA integration and production security evidence: HOLD. No code or migration executed; no Codex/Anti assignment.
