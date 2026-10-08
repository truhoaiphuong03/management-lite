# ARCH-RECHECK — API-SYNC backlog

Version 0.1.0-doc.10 | DESIGN ONLY

- **ARC-01 P0** — Specify employee-owned correction request with reason; Owner decision with explicit corrected time, version, audit; reject self-approval; new immutable version; no payroll before approval.
- **ARC-02 P0** — Specify append-only submitted revision endpoint, If-Match, immutable prior submission, author/time; no overwrite.
- **ARC-03 P0** — Require proof consumed transactionally, no cached secret, audit; stale proof denied.
- **ARC-04 P0** — V0.1 migration allowlist M00-M07 + core M11 guards only; no WORK, channels-as-WORK, Drive, storage feature-specific migrations/endpoints/UI.
- **ARC-05 P1** — Owner locked: any negative draft employee net blocks atomic period finalize; no clamp/carryforward; tax/settlement remain excluded.
- **ARC-06 P0** — No implicit switching. Require exactly one preauthorized active workspace binding for V0.1; ambiguous/no binding fail closed, not arbitrary selection; no selector.
- **ARC-07 P0** — Explicit Owner decision must resolve open break evidence and immutable paid intervals, never infer working time; keep HOLD until transition contract is specified.
- **ARC-08 P0** — Specify database guard transaction proof and concurrent race tests; do not claim DDL executed.
- **ARC-09 P1** — Publish single normative error registry 428 missing If-Match, 412 stale, 409 business conflict; mark legacy text historical.
- **ARC-10 P1** — Normative separate enums with single status owner; no overloaded needs_review in run_state.
- **ARC-11 P1** — Keep all 85 NOT RUN, attach future evidence per test, verify counts and traceability.
- **ARC-12 P1** — HOLD release until P0 pass and signed evidence; design PASS is not runtime PASS.
- **ARC-13 P1** — Guard nonnegative base numerator and negative net separately; ensure NUMERIC overflow-safe, half-up once.
- **ARC-14 P1** — Owner can decide staff correction but cannot approve own shift; employee cannot approve; workspace isolation for every operation.
- **ARC-15 P1** — Tag reference-only V0.2; release allowlist controls tests/build/migrations.
- **ARC-16 P1** — Preserve current global user model; C06 restricts active context; defer any account model redesign.

Do not implement or assign executors before Owner authorization.
