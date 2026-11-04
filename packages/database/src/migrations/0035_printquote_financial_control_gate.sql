-- Migration: 0035_printquote_financial_control_gate
-- Scope: Financial Control Gate for PrintQuote Orders — explicitly separates
--        (1) expected quote costs, (2) confirmed actual workshop/shipping costs,
--        and (3) actual cash paid to vendors (`vendor_paid_amount`).

ALTER TABLE print_orders
  ADD COLUMN IF NOT EXISTS actual_cost_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actual_cost_confirmed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS actual_cost_confirmed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_paid_amount bigint NOT NULL DEFAULT 0;

ALTER TABLE print_orders
  DROP CONSTRAINT IF EXISTS chk_print_orders_vendor_paid_nonneg;

ALTER TABLE print_orders
  ADD CONSTRAINT chk_print_orders_vendor_paid_nonneg
    CHECK (vendor_paid_amount >= 0);

-- Safe backfill: only mark existing orders as confirmed if an operator had already
-- recorded an actual cost that differs from the initial quote estimate.
UPDATE print_orders
SET actual_cost_confirmed = true,
    actual_cost_confirmed_at = COALESCE(actual_cost_confirmed_at, updated_at)
WHERE actual_cost_confirmed = false
  AND (
    actual_vendor_cost <> expected_vendor_cost
    OR actual_shipping_fee <> expected_shipping_fee
    OR actual_extra_cost <> expected_extra_cost
  );

CREATE INDEX IF NOT EXISTS idx_print_orders_actual_confirmed
  ON print_orders (workspace_id, actual_cost_confirmed);

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['hp_app_runtime', 'hp_app_test', 'ml_app_runtime', 'ml_app_test', 'app_runtime', 'app_test']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON print_orders TO %I',
        r
      );
    END IF;
  END LOOP;
END $$;
