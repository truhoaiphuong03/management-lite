-- Rollback script for 0036_printquote_ar_ap_ledger
-- Fails closed (`ROLLBACK_BLOCKED`) if any post-0036 financial records or reconciliation actions exist:
--   - any workshop jobs or workshop job history rows,
--   - any opening balances or confirmed historical import rows,
--   - any AR transactions (including confirmed legacy reconciliations or post-0036 receipts/refunds),
--   - any AR/AP adjustments or AP transactions/allocations,
--   - any legacy AR reconciliation row moved out of untouched `PENDING` state (`CONFIRMED`, `ON_HOLD`, `POSTED_DIRECT`)
--     or any post-migration reconciliation history (`CUSTOMER_LINKED`, `BALANCE_DISCREPANCY_RESOLVED`, `HELD`, `CONFIRMED_TO_AR`),
--   - any order cancellation settlements or non-zero AR adjustments on `print_orders`.
-- When only untouched `PENDING` (`QUEUED_BY_MIGRATION`) rows exist, those queue records can be safely torn down
-- because 100% of authoritative legacy rows in `print_orders` and `print_order_payments` remain untouched.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.print_workshop_jobs') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM print_workshop_jobs LIMIT 1) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_workshop_jobs contains workshop job records';
    END IF;
  END IF;

  IF to_regclass('public.print_workshop_job_history') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM print_workshop_job_history LIMIT 1) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_workshop_job_history contains audit records';
    END IF;
  END IF;

  IF to_regclass('public.print_opening_balances') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM print_opening_balances LIMIT 1) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_opening_balances contains opening balance records';
    END IF;
  END IF;

  IF to_regclass('public.print_historical_import_batches') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM print_historical_import_batches WHERE status = 'CONFIRMED' LIMIT 1
    ) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_historical_import_batches contains confirmed imports';
    END IF;
  END IF;

  IF to_regclass('public.print_ar_transactions') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM print_ar_transactions LIMIT 1) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_ar_transactions contains confirmed or post-0036 customer receivable transactions';
    END IF;
  END IF;

  IF to_regclass('public.print_legacy_ar_reconciliations') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM print_legacy_ar_reconciliations
      WHERE status <> 'PENDING'
         OR posted_ar_transaction_id IS NOT NULL
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_legacy_ar_reconciliations contains confirmed or held reconciliation decisions';
    END IF;
  END IF;

  IF to_regclass('public.print_legacy_ar_reconciliation_history') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM print_legacy_ar_reconciliation_history
      WHERE action <> 'QUEUED_BY_MIGRATION'
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_legacy_ar_reconciliation_history contains post-migration reconciliation audit records';
    END IF;
  END IF;

  IF to_regclass('public.print_ar_adjustments') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM print_ar_adjustments LIMIT 1) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_ar_adjustments contains receivable adjustments';
    END IF;
  END IF;

  IF to_regclass('public.print_ap_transactions') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM print_ap_transactions LIMIT 1) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_ap_transactions contains workshop payable transactions';
    END IF;
  END IF;

  IF to_regclass('public.print_ap_adjustments') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM print_ap_adjustments LIMIT 1) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_ap_adjustments contains payable adjustments';
    END IF;
  END IF;

  IF to_regclass('public.print_order_cancellation_settlements') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM print_order_cancellation_settlements LIMIT 1) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_order_cancellation_settlements contains settlement records';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'print_orders'
      AND column_name = 'net_ar_adjustment_amount'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM print_orders
      WHERE net_ar_adjustment_amount <> 0
         OR agreed_customer_refund_amount <> 0
         OR refunded_after_cancel_amount <> 0
         OR retained_cancellation_fee <> 0
         OR ledger_scope <> 'GENERAL'
         OR legacy_balance_discrepancy_resolved = true
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_orders contains post-0036 financial adjustments or scope assignments';
    END IF;
  END IF;
END $$;

-- Remove append-only triggers before dropping 0036 tables
DROP TRIGGER IF EXISTS trg_print_order_payments_append_only ON print_order_payments;
DROP TRIGGER IF EXISTS trg_print_order_payments_no_truncate ON print_order_payments;
DROP TRIGGER IF EXISTS trg_print_legacy_ar_reconciliation_history_append_only ON print_legacy_ar_reconciliation_history;
DROP TRIGGER IF EXISTS trg_print_legacy_ar_reconciliation_history_no_truncate ON print_legacy_ar_reconciliation_history;
DROP TRIGGER IF EXISTS trg_print_legacy_ar_recon_guard ON print_legacy_ar_reconciliations;
DROP TRIGGER IF EXISTS trg_print_legacy_ar_recon_no_truncate ON print_legacy_ar_reconciliations;

DROP TABLE IF EXISTS print_legacy_ar_reconciliation_history;
DROP TABLE IF EXISTS print_legacy_ar_reconciliations;
DROP TABLE IF EXISTS print_order_cancellation_settlements;
DROP TABLE IF EXISTS print_ap_adjustments;
DROP TABLE IF EXISTS print_ap_allocations;
DROP TABLE IF EXISTS print_ap_transactions;
DROP TABLE IF EXISTS print_ar_adjustments;
DROP TABLE IF EXISTS print_ar_allocations;
DROP TABLE IF EXISTS print_ar_transactions;
DROP TABLE IF EXISTS print_opening_balances;
DROP TABLE IF EXISTS print_historical_import_rows;
DROP TABLE IF EXISTS print_historical_import_batches;
DROP TABLE IF EXISTS print_workshop_job_history;
DROP TABLE IF EXISTS print_workshop_jobs;

DROP FUNCTION IF EXISTS guard_print_legacy_ar_reconciliation_mutation();
DROP FUNCTION IF EXISTS guard_print_opening_balance_mutation();
DROP FUNCTION IF EXISTS guard_print_ar_ap_tx_mutation();
DROP FUNCTION IF EXISTS prevent_print_ledger_append_only_mutation();

ALTER TABLE print_orders
  DROP CONSTRAINT IF EXISTS chk_print_orders_legacy_ar_recon_status,
  DROP CONSTRAINT IF EXISTS chk_print_orders_cancel_amounts_nonneg,
  DROP CONSTRAINT IF EXISTS chk_print_orders_cancel_settlement_status,
  DROP CONSTRAINT IF EXISTS chk_print_orders_valid_receivable_nonneg,
  DROP CONSTRAINT IF EXISTS chk_print_orders_ledger_scope;

ALTER TABLE print_orders
  DROP COLUMN IF EXISTS legacy_ar_reconciliation_status,
  DROP COLUMN IF EXISTS legacy_balance_discrepancy_resolved,
  DROP COLUMN IF EXISTS pre0036_deposit_paid_snapshot,
  DROP COLUMN IF EXISTS pre0036_remaining_debt_snapshot,
  DROP COLUMN IF EXISTS pre0036_total_paid_snapshot,
  DROP COLUMN IF EXISTS legacy_vendor_paid_reconciled_by,
  DROP COLUMN IF EXISTS legacy_vendor_paid_reconciled_at,
  DROP COLUMN IF EXISTS legacy_vendor_paid_reconciled,
  DROP COLUMN IF EXISTS retained_cancellation_fee,
  DROP COLUMN IF EXISTS refunded_after_cancel_amount,
  DROP COLUMN IF EXISTS agreed_customer_refund_amount,
  DROP COLUMN IF EXISTS cancellation_settlement_status,
  DROP COLUMN IF EXISTS valid_receivable_amount,
  DROP COLUMN IF EXISTS net_ar_adjustment_amount,
  DROP COLUMN IF EXISTS ledger_scope;

DELETE FROM schema_migrations
WHERE id = '0036_printquote_ar_ap_ledger';

COMMIT;
