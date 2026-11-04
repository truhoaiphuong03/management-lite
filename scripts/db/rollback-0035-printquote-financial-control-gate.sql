-- Rollback script for 0035_printquote_financial_control_gate
-- Fails closed if any order has confirmed actual costs or recorded vendor payments.

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
      WHERE actual_cost_confirmed = true OR vendor_paid_amount > 0
    ) THEN
      RAISE EXCEPTION 'ROLLBACK_BLOCKED: print_orders contains confirmed actual costs or vendor_paid_amount > 0';
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_print_orders_actual_confirmed;

ALTER TABLE print_orders
  DROP CONSTRAINT IF EXISTS chk_print_orders_vendor_paid_nonneg;

ALTER TABLE print_orders
  DROP COLUMN IF EXISTS vendor_paid_amount,
  DROP COLUMN IF EXISTS actual_cost_confirmed_by,
  DROP COLUMN IF EXISTS actual_cost_confirmed_at,
  DROP COLUMN IF EXISTS actual_cost_confirmed;

DELETE FROM schema_migrations
WHERE id = '0035_printquote_financial_control_gate';

COMMIT;
