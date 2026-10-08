# PAY-02 — OWNER-APPROVED POLICY (LOCKED)

PAY-021: Split overnight shifts by actual local calendar day in workspace timezone (default Asia/Ho_Chi_Minh). Use half-open intervals [start,end) to avoid double counting.
PAY-022: Split approved worked intervals by effective-dated hourly rates, including changes mid-shift.
PAY-023: Store and calculate exact whole seconds; no per-shift hour rounding.
PAY-024: Sum exact base-pay rational amounts per employee and payroll period; round half-up ONCE to whole VND on that period's nonnegative base pay. Bonus/allowance/advance/deduction are integer VND.
PAY-025: Owner can clock but is not payroll eligible in V0.1. Do not create Owner payroll items.
PAY-026: Only completed, approved, current-version shifts count. Unpaid breaks excluded. No inferred clock-out.
PAY-027: Finalized payroll is immutable; later corrections require append-only linked adjustments/settlement workflow.
PAY-028: No overlapping counted seconds or payroll periods; missing rate stops affected calculation/finalization.

Formula: net_amount_vnd = rounded_base_pay_vnd + bonus_vnd + allowance_vnd - advance_vnd - deduction_vnd. Trace every calculation line to shift, approved version, interval and rate. Example 08:00–16:00, break 12:00–12:30, rates 30k/hr until 12:00 then 35k/hr: 120000 + 122500 = 242500 VND.

## Still needs engineering-level resolution
Handling corrected attendance after finalized periods; authoritative versioning of shift approval; payroll adjustments and settlement across periods; timezone changes; negative net pay; statutory deductions/tax (out of scope unless Owner authorizes). Do not invent policy.
