-- Rollback script for 0035_printquote_financial_control_gate
-- Fails closed if any order has entered/confirmed actual costs, recorded vendor payments,
-- or immutable cost reconciliation audit history rows.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'print_orders'
      AND column_name = 'actual_cost_confirmed'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM print_orders
      WHERE actual_cost_confirmed = true
         OR vendor_paid_amount > 0
         OR entered_vendor_cost IS NOT NULL
         OR entered_shipping_fee IS NOT NULL
         OR entered_extra_cost IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_orders contains entered/confirmed actual costs or vendor_paid_amount > 0';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'print_order_cost_history'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM print_order_cost_history
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_order_cost_history contains reconciliation audit records';
    END IF;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_print_order_cost_history_no_truncate ON print_order_cost_history;
DROP TRIGGER IF EXISTS trg_print_order_cost_history_immutable ON print_order_cost_history;
DROP INDEX IF EXISTS idx_print_order_cost_history_order;
DROP TABLE IF EXISTS print_order_cost_history;
DROP FUNCTION IF EXISTS prevent_print_order_cost_history_mutation();

DROP INDEX IF EXISTS idx_print_orders_actual_confirmed;

ALTER TABLE print_orders
  DROP CONSTRAINT IF EXISTS chk_print_orders_confirmed_requires_all_entered,
  DROP CONSTRAINT IF EXISTS chk_print_orders_cost_reconciliation_status,
  DROP CONSTRAINT IF EXISTS chk_print_orders_entered_costs_nonneg,
  DROP CONSTRAINT IF EXISTS chk_print_orders_vendor_paid_nonneg;

ALTER TABLE print_orders
  DROP COLUMN IF EXISTS cost_reconciliation_status,
  DROP COLUMN IF EXISTS entered_extra_cost,
  DROP COLUMN IF EXISTS entered_shipping_fee,
  DROP COLUMN IF EXISTS entered_vendor_cost,
  DROP COLUMN IF EXISTS vendor_paid_amount,
  DROP COLUMN IF EXISTS actual_cost_confirmed_by,
  DROP COLUMN IF EXISTS actual_cost_confirmed_at,
  DROP COLUMN IF EXISTS actual_cost_confirmed;

DELETE FROM schema_migrations
WHERE id = '0035_printquote_financial_control_gate';

COMMIT;
