-- Migration: 0035_printquote_financial_control_gate
-- Scope: Financial Control Gate for PrintQuote Orders — strictly separates
--        (1) expected quote costs (`expected_*`),
--        (2) operator-entered unconfirmed/confirmed actual costs (`entered_*`),
--        (3) reconciliation confirmation state (`actual_cost_confirmed`, `cost_reconciliation_status`),
--        (4) order-level paid-to-workshop note (`vendor_paid_amount`), and
--        (5) immutable audit history (`print_order_cost_history`).

ALTER TABLE print_orders
  ADD COLUMN IF NOT EXISTS actual_cost_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actual_cost_confirmed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS actual_cost_confirmed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entered_vendor_cost bigint NULL,
  ADD COLUMN IF NOT EXISTS entered_shipping_fee bigint NULL,
  ADD COLUMN IF NOT EXISTS entered_extra_cost bigint NULL,
  ADD COLUMN IF NOT EXISTS vendor_paid_amount bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'print_orders'
      AND column_name = 'cost_reconciliation_status'
  ) THEN
    ALTER TABLE print_orders
      ADD COLUMN cost_reconciliation_status text NOT NULL DEFAULT 'UNVERIFIED';

    -- Zero guesswork: preserve 100% of original legacy numbers untouched, keep
    -- actual_cost_confirmed = false, and place pre-0035 orders lacking confirmation
    -- evidence into NEEDS_REVIEW for explicit reconciliation.
    UPDATE print_orders
    SET cost_reconciliation_status = 'NEEDS_REVIEW'
    WHERE actual_cost_confirmed = false;
  END IF;
END $$;

ALTER TABLE print_orders
  DROP CONSTRAINT IF EXISTS chk_print_orders_vendor_paid_nonneg,
  DROP CONSTRAINT IF EXISTS chk_print_orders_entered_costs_nonneg,
  DROP CONSTRAINT IF EXISTS chk_print_orders_cost_reconciliation_status,
  DROP CONSTRAINT IF EXISTS chk_print_orders_confirmed_requires_all_entered;

ALTER TABLE print_orders
  ADD CONSTRAINT chk_print_orders_vendor_paid_nonneg
    CHECK (vendor_paid_amount >= 0),
  ADD CONSTRAINT chk_print_orders_entered_costs_nonneg
    CHECK (
      (entered_vendor_cost IS NULL OR entered_vendor_cost >= 0)
      AND (entered_shipping_fee IS NULL OR entered_shipping_fee >= 0)
      AND (entered_extra_cost IS NULL OR entered_extra_cost >= 0)
    ),
  ADD CONSTRAINT chk_print_orders_cost_reconciliation_status
    CHECK (
      cost_reconciliation_status IN (
        'UNVERIFIED',
        'NEEDS_REVIEW',
        'PARTIAL_ENTERED',
        'ENTERED_UNCONFIRMED',
        'CONFIRMED'
      )
    ),
  ADD CONSTRAINT chk_print_orders_confirmed_requires_all_entered
    CHECK (
      actual_cost_confirmed = false
      OR (
        cost_reconciliation_status = 'CONFIRMED'
        AND entered_vendor_cost IS NOT NULL
        AND entered_shipping_fee IS NOT NULL
        AND entered_extra_cost IS NOT NULL
      )
    );

CREATE TABLE IF NOT EXISTS print_order_cost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  order_id uuid NOT NULL,
  action text NOT NULL CHECK (
    action IN (
      'ENTERED',
      'CONFIRMED',
      'ADJUSTED',
      'UNCONFIRMED',
      'VENDOR_PAYMENT_NOTE'
    )
  ),
  before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text NULL,
  changed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_print_order_cost_history_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  CONSTRAINT fk_print_order_cost_history_order
    FOREIGN KEY (order_id) REFERENCES print_orders(id) ON DELETE RESTRICT
);

DO $$
DECLARE
  fk_rec record;
BEGIN
  FOR fk_rec IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'print_order_cost_history'::regclass
      AND c.contype = 'f'
      AND c.confdeltype = 'c'
  LOOP
    EXECUTE format(
      'ALTER TABLE print_order_cost_history DROP CONSTRAINT %I',
      fk_rec.conname
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'print_order_cost_history'::regclass
      AND conname = 'fk_print_order_cost_history_workspace'
  ) THEN
    ALTER TABLE print_order_cost_history
      ADD CONSTRAINT fk_print_order_cost_history_workspace
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'print_order_cost_history'::regclass
      AND conname = 'fk_print_order_cost_history_order'
  ) THEN
    ALTER TABLE print_order_cost_history
      ADD CONSTRAINT fk_print_order_cost_history_order
      FOREIGN KEY (order_id) REFERENCES print_orders(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- DB Guard: print_order_cost_history is strictly append-only (prohibit UPDATE, DELETE, TRUNCATE)
CREATE OR REPLACE FUNCTION prevent_print_order_cost_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'print_order_cost_history is append-only: % operation prohibited', TG_OP
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_print_order_cost_history_immutable ON print_order_cost_history;
CREATE TRIGGER trg_print_order_cost_history_immutable
  BEFORE UPDATE OR DELETE ON print_order_cost_history
  FOR EACH ROW EXECUTE FUNCTION prevent_print_order_cost_history_mutation();

DROP TRIGGER IF EXISTS trg_print_order_cost_history_no_truncate ON print_order_cost_history;
CREATE TRIGGER trg_print_order_cost_history_no_truncate
  BEFORE TRUNCATE ON print_order_cost_history
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_print_order_cost_history_mutation();

DROP INDEX IF EXISTS idx_print_orders_actual_confirmed;

CREATE INDEX IF NOT EXISTS idx_print_orders_actual_confirmed
  ON print_orders (workspace_id, actual_cost_confirmed, cost_reconciliation_status);

CREATE INDEX IF NOT EXISTS idx_print_order_cost_history_order
  ON print_order_cost_history (workspace_id, order_id, created_at DESC);

REVOKE ALL ON print_order_cost_history FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['hp_app_runtime', 'hp_app_test', 'ml_app_runtime', 'ml_app_test', 'app_runtime', 'app_test']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE ON print_orders TO %I',
        r
      );
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON print_order_cost_history FROM %I',
        r
      );
      EXECUTE format(
        'GRANT SELECT, INSERT ON print_order_cost_history TO %I',
        r
      );
    END IF;
  END LOOP;
END $$;
