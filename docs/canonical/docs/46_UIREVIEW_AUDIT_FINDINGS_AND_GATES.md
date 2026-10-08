# UI-REVIEW — Audit Findings, PASS/HOLD and Next Gates
Version 0.1.0-doc.15 | Design-only

## Findings
| ID | Severity | Finding in doc.14 | Resolution in doc.15 | Status |
|---|---|---|---|---|
| UIA-01 | P0 | Baseline screen list still included WORK/Drive/Content/Video | Mark V0.2-only, exclude V0.1 routes | PASS design |
| UIA-02 | P0 | No complete V0.1 route/screen matrix | UI01–UI21 inventory | PASS design |
| UIA-03 | P0 | C01 correction/review state not fully specified for UI | Request, evidence, Owner decision, separate approval | PASS design |
| UIA-04 | P0 | C02 submitted report revision path absent | Immutable history + new revision screen state | PASS design |
| UIA-05 | P0 | C04 negative payroll finalization error not described | Atomic block + affected employee display | PASS design |
| UIA-06 | P0 | C05 reauth for secret change omitted in UI baseline | Require scoped reauth for reveal and replace | PASS design |
| UIA-07 | P0 | C06 active workspace ambiguous UI path | No selector, explicit blocked state | PASS design |
| UIA-08 | P0 | Component visual uniformity not enforceable from baseline alone | One registry, fixed button size, state behavior | PASS design |
| UIA-09 | P1 | Accessibility/error/reduced motion not traceable to screens | Shared form, dialog, keyboard and responsive gates | PASS design |
| UIA-10 | P1 | No executable UI or screenshots | Browser/device/visual regression evidence needed | HOLD runtime |
| UIA-11 | P1 | No proven WCAG contrast, zoom or screen reader audit | Require measured test evidence | HOLD runtime |
| UIA-12 | P1 | No proven 85 QA-03 alignment to UI matrix | QA-SYNC traceability update | HOLD design follow-up |

## Nonnegotiable design locks
- Preserve PAY-02 exact seconds, split-by-local-day, rate interval and one final VND half-up rounding.
- Preserve RBAC-02: Owner/Staff roles, positions are not roles; backend authorization authoritative; Owner cannot self-approve; no Owner payroll; Staff ACC invisible.
- Preserve SEC-02 AEAD, one-use reauth, session/CSRF, no secret logging.
- Preserve C01–C06 and G01–G05 unchanged. Local fake email clearly marked simulated; no production provider assumed; backup is not claimed to run.
- One dark AppShell, common components, mobile-first, no V0.2 feature screens in V0.1.

## Release gates
DESIGN PASS: screen inventory, role matrix, navigation, interaction/state rules, component contract and mobile-first review target documented.
HOLD: actual implementation, screenshot/visual diffs, button-jitter tests, 360px/390px/430px/768px/1280px responsive tests, keyboard and WCAG, security/API and database evidence, QA-SYNC, Owner UAT, code authorization.

## Suggested next steps
1. QA-SYNC: align QA-03 cases with UI01–UI21, API-SYNC, G01–G05; no execution claims.
2. DB-CONSTRAINT: validate constraints at design level if desired.
3. START-GATE: evaluate entry-to-code prerequisites; explicit Owner authorization still required.

No code, repository creation, migration, executor assignment, paid provider or deployment.

## QA-SYNC doc.16 resolution
UIA-12 closed at design traceability level: docs/48 maps UI01–UI21 and docs/47 adds dedicated tests. Browser/visual/accessibility execution remains HOLD.
