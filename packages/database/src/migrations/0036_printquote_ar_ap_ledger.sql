-- Migration: 0036_printquote_ar_ap_ledger
-- Scope: Print-only AR (Customer Receivables), AP (Workshop Payables), Multi-Workshop Jobs,
--        Cancelled Order Settlement, Opening Balances & Historical Google Sheet Reconciliation.
-- Boundary: Strictly isolated inside print_* tables. Zero link or sync with /finance (fin_*).

-- ============================================================================
-- 1. ADDITIVE COLUMNS ON print_orders
-- ============================================================================

ALTER TABLE print_orders
  ADD COLUMN IF NOT EXISTS ledger_scope text NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS net_ar_adjustment_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valid_receivable_amount bigint NULL,
  ADD COLUMN IF NOT EXISTS cancellation_settlement_status text NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN IF NOT EXISTS agreed_customer_refund_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_after_cancel_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retained_cancellation_fee bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_vendor_paid_reconciled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS legacy_vendor_paid_reconciled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS legacy_vendor_paid_reconciled_by uuid NULL REFERENCES users(id) ON DELETE SET NULL;

-- Populate deterministic defaults on pre-0036 orders without guessing refunds or AP payouts:
UPDATE print_orders
SET
  valid_receivable_amount = CASE
    WHEN production_status = 'CANCELLED' THEN 0
    ELSE total_quote_amount
  END,
  cancellation_settlement_status = CASE
    WHEN production_status <> 'CANCELLED' THEN 'NOT_APPLICABLE'
    WHEN total_paid_amount > 0
      OR vendor_paid_amount > 0
      OR COALESCE(entered_vendor_cost, 0) > 0
      OR COALESCE(actual_vendor_cost, 0) > 0
    THEN 'PENDING_SETTLEMENT'
    ELSE 'SETTLED'
  END,
  legacy_vendor_paid_reconciled = CASE
    WHEN vendor_paid_amount > 0 THEN false
    ELSE true
  END
WHERE valid_receivable_amount IS NULL;

ALTER TABLE print_orders
  ALTER COLUMN valid_receivable_amount SET NOT NULL,
  ALTER COLUMN valid_receivable_amount SET DEFAULT 0;

ALTER TABLE print_orders
  DROP CONSTRAINT IF EXISTS chk_print_orders_ledger_scope,
  DROP CONSTRAINT IF EXISTS chk_print_orders_valid_receivable_nonneg,
  DROP CONSTRAINT IF EXISTS chk_print_orders_cancel_settlement_status,
  DROP CONSTRAINT IF EXISTS chk_print_orders_cancel_amounts_nonneg;

ALTER TABLE print_orders
  ADD CONSTRAINT chk_print_orders_ledger_scope
    CHECK (ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')),
  ADD CONSTRAINT chk_print_orders_valid_receivable_nonneg
    CHECK (valid_receivable_amount >= 0),
  ADD CONSTRAINT chk_print_orders_cancel_settlement_status
    CHECK (cancellation_settlement_status IN ('NOT_APPLICABLE', 'PENDING_SETTLEMENT', 'SETTLED')),
  ADD CONSTRAINT chk_print_orders_cancel_amounts_nonneg
    CHECK (
      agreed_customer_refund_amount >= 0
      AND refunded_after_cancel_amount >= 0
      AND retained_cancellation_fee >= 0
      AND refunded_after_cancel_amount <= agreed_customer_refund_amount
    );

-- ============================================================================
-- 2. MULTI-WORKSHOP JOBS (print_workshop_jobs & print_workshop_job_history)
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_workshop_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  job_code text NOT NULL,
  order_id uuid NOT NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  vendor_id uuid NULL REFERENCES print_vendors(id) ON DELETE RESTRICT,
  vendor_name text NULL,
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')),
  title text NOT NULL,
  source_line_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  job_status text NOT NULL DEFAULT 'ORDERED' CHECK (
    job_status IN ('DRAFT', 'ORDERED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
  ),
  cost_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (
    cost_status IN ('UNVERIFIED', 'ENTERED_UNCONFIRMED', 'CONFIRMED')
  ),
  expected_cost bigint NOT NULL DEFAULT 0 CHECK (expected_cost >= 0),
  entered_cost bigint NULL CHECK (entered_cost IS NULL OR entered_cost >= 0),
  confirmed_cost bigint NULL CHECK (confirmed_cost IS NULL OR confirmed_cost >= 0),
  confirmed_at timestamptz NULL,
  confirmed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  net_ap_adjustment_amount bigint NOT NULL DEFAULT 0,
  valid_payable_amount bigint NOT NULL DEFAULT 0 CHECK (valid_payable_amount >= 0),
  allocated_paid_amount bigint NOT NULL DEFAULT 0 CHECK (allocated_paid_amount >= 0),
  remaining_payable_amount bigint NOT NULL DEFAULT 0 CHECK (remaining_payable_amount >= 0),
  vendor_overpaid_credit_amount bigint NOT NULL DEFAULT 0 CHECK (vendor_overpaid_credit_amount >= 0),
  ordered_at timestamptz NULL,
  due_date date NULL,
  note text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, job_code),
  CONSTRAINT chk_print_workshop_jobs_confirmed_consistency CHECK (
    (cost_status <> 'CONFIRMED' AND confirmed_cost IS NULL)
    OR (cost_status = 'CONFIRMED' AND confirmed_cost IS NOT NULL AND entered_cost IS NOT NULL AND vendor_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_workshop_jobs_order
  ON print_workshop_jobs (workspace_id, order_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_print_workshop_jobs_vendor
  ON print_workshop_jobs (workspace_id, vendor_id, cost_status, remaining_payable_amount);

CREATE TABLE IF NOT EXISTS print_workshop_job_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  workshop_job_id uuid NOT NULL REFERENCES print_workshop_jobs(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (
    action IN (
      'CREATED',
      'UPDATED',
      'VENDOR_ASSIGNED',
      'COST_ENTERED',
      'COST_CONFIRMED',
      'COST_ADJUSTED',
      'COST_UNCONFIRMED',
      'CANCELLED'
    )
  ),
  before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NULL,
  changed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_workshop_job_history_job
  ON print_workshop_job_history (workspace_id, workshop_job_id, created_at DESC);

-- ============================================================================
-- 3. HISTORICAL SHEET IMPORT BATCHES & OPENING BALANCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_historical_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  batch_code text NOT NULL,
  source_sheet_name text NOT NULL,
  source_tab_name text NOT NULL,
  default_ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    default_ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  raw_payload text NOT NULL,
  status text NOT NULL DEFAULT 'PREVIEW' CHECK (
    status IN ('PREVIEW', 'CONFIRMED', 'CANCELLED')
  ),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  ready_rows_count integer NOT NULL DEFAULT 0 CHECK (ready_rows_count >= 0),
  needs_confirmation_rows_count integer NOT NULL DEFAULT 0 CHECK (needs_confirmation_rows_count >= 0),
  duplicate_rows_count integer NOT NULL DEFAULT 0 CHECK (duplicate_rows_count >= 0),
  imported_rows_count integer NOT NULL DEFAULT 0 CHECK (imported_rows_count >= 0),
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, batch_code)
);

CREATE TABLE IF NOT EXISTS print_historical_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES print_historical_import_batches(id) ON DELETE RESTRICT,
  source_row_number integer NOT NULL CHECK (source_row_number >= 1),
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  counterparty_role text NOT NULL DEFAULT 'UNKNOWN' CHECK (
    counterparty_role IN ('CUSTOMER', 'VENDOR', 'UNKNOWN')
  ),
  counterparty_name text NULL,
  matched_customer_id uuid NULL REFERENCES print_customers(id) ON DELETE SET NULL,
  matched_vendor_id uuid NULL REFERENCES print_vendors(id) ON DELETE SET NULL,
  raw_amount_text text NULL,
  parsed_amount bigint NULL CHECK (parsed_amount IS NULL OR parsed_amount >= 0),
  raw_goods_total_text text NULL,
  parsed_goods_total bigint NULL CHECK (parsed_goods_total IS NULL OR parsed_goods_total >= 0),
  voucher_code text NULL,
  occurred_date text NULL,
  note text NULL,
  raw_cells_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_status text NOT NULL DEFAULT 'NEEDS_CONFIRMATION' CHECK (
    row_status IN ('READY', 'NEEDS_CONFIRMATION', 'DUPLICATE', 'IMPORTED', 'SKIPPED')
  ),
  suggested_resolution text NOT NULL DEFAULT 'UNDECIDED' CHECK (
    suggested_resolution IN (
      'UNDECIDED',
      'IMPORT_OPENING_RECEIVABLE',
      'IMPORT_OPENING_PAYABLE',
      'IMPORT_CUSTOMER_ADVANCE',
      'IMPORT_VENDOR_ADVANCE',
      'HOLD_FOR_REVIEW',
      'SKIP'
    )
  ),
  owner_resolution text NOT NULL DEFAULT 'UNDECIDED' CHECK (
    owner_resolution IN (
      'UNDECIDED',
      'IMPORT_OPENING_RECEIVABLE',
      'IMPORT_OPENING_PAYABLE',
      'IMPORT_CUSTOMER_ADVANCE',
      'IMPORT_VENDOR_ADVANCE',
      'HOLD_FOR_REVIEW',
      'SKIP'
    )
  ),
  row_fingerprint text NOT NULL,
  imported_entity_type text NULL,
  imported_entity_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_print_hist_import_rows_imported_fp
  ON print_historical_import_rows (workspace_id, row_fingerprint)
  WHERE row_status = 'IMPORTED';

CREATE INDEX IF NOT EXISTS idx_print_hist_import_rows_batch
  ON print_historical_import_rows (batch_id, source_row_number ASC);

CREATE TABLE IF NOT EXISTS print_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  doc_code text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('CUSTOMER_RECEIVABLE', 'VENDOR_PAYABLE')),
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  customer_id uuid NULL REFERENCES print_customers(id) ON DELETE RESTRICT,
  customer_name text NULL,
  vendor_id uuid NULL REFERENCES print_vendors(id) ON DELETE RESTRICT,
  vendor_name text NULL,
  original_amount bigint NOT NULL CHECK (original_amount > 0),
  net_adjustment_amount bigint NOT NULL DEFAULT 0,
  valid_amount bigint NOT NULL CHECK (valid_amount >= 0),
  allocated_settled_amount bigint NOT NULL DEFAULT 0 CHECK (allocated_settled_amount >= 0),
  remaining_amount bigint NOT NULL CHECK (remaining_amount >= 0),
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,
  reference_code text NULL,
  source_sheet_name text NULL,
  source_tab_name text NULL,
  source_row_number integer NULL,
  import_row_id uuid NULL REFERENCES print_historical_import_rows(id) ON DELETE RESTRICT,
  note text NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, doc_code),
  CONSTRAINT chk_print_opening_balances_counterparty CHECK (
    (direction = 'CUSTOMER_RECEIVABLE' AND customer_name IS NOT NULL AND vendor_id IS NULL)
    OR (direction = 'VENDOR_PAYABLE' AND vendor_id IS NOT NULL AND vendor_name IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_opening_balances_scope
  ON print_opening_balances (workspace_id, direction, ledger_scope, remaining_amount);

-- ============================================================================
-- 4. CUSTOMER RECEIVABLES LEDGER (print_ar_*)
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_ar_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  tx_code text NOT NULL,
  customer_id uuid NULL REFERENCES print_customers(id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  tx_kind text NOT NULL CHECK (tx_kind IN ('RECEIPT', 'REFUND', 'REVERSAL')),
  receipt_subtype text NULL CHECK (
    receipt_subtype IS NULL
    OR receipt_subtype IN ('DEPOSIT', 'INSTALLMENT', 'FINAL', 'ADVANCE', 'OPENING_ADVANCE')
  ),
  amount bigint NOT NULL CHECK (amount > 0),
  allocated_amount bigint NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  refunded_unallocated_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_unallocated_amount >= 0),
  unallocated_amount bigint NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
  payment_method text NOT NULL DEFAULT 'BANK_TRANSFER' CHECK (
    payment_method IN ('BANK_TRANSFER', 'CASH', 'QR_VIETQR', 'OTHER')
  ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reference_code text NULL,
  attachment_url text NULL,
  note text NULL,
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOIDED')),
  reversal_of_tx_id uuid NULL REFERENCES print_ar_transactions(id) ON DELETE RESTRICT,
  void_reason text NULL,
  voided_at timestamptz NULL,
  voided_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  related_order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  legacy_order_payment_id uuid NULL UNIQUE,
  source_sheet_name text NULL,
  source_tab_name text NULL,
  source_row_number integer NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, tx_code),
  CONSTRAINT chk_print_ar_tx_conservation
    CHECK (allocated_amount + refunded_unallocated_amount + unallocated_amount = amount),
  CONSTRAINT chk_print_ar_tx_void_reason
    CHECK (status = 'POSTED' OR (status = 'VOIDED' AND void_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_print_ar_tx_customer
  ON print_ar_transactions (workspace_id, customer_id, ledger_scope, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_print_ar_tx_ref
  ON print_ar_transactions (workspace_id, reference_code)
  WHERE reference_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS print_ar_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  ar_transaction_id uuid NOT NULL REFERENCES print_ar_transactions(id) ON DELETE RESTRICT,
  order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  opening_balance_id uuid NULL REFERENCES print_opening_balances(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (
    direction IN ('APPLY', 'UNAPPLY_REVERSAL', 'REFUND_RELEASE')
  ),
  amount bigint NOT NULL CHECK (amount > 0),
  note text NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_print_ar_alloc_target CHECK (
    (order_id IS NOT NULL AND opening_balance_id IS NULL)
    OR (order_id IS NULL AND opening_balance_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_ar_alloc_order
  ON print_ar_allocations (workspace_id, order_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_print_ar_alloc_tx
  ON print_ar_allocations (workspace_id, ar_transaction_id, created_at ASC);

CREATE TABLE IF NOT EXISTS print_ar_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  adj_code text NOT NULL,
  order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  opening_balance_id uuid NULL REFERENCES print_opening_balances(id) ON DELETE RESTRICT,
  customer_id uuid NULL REFERENCES print_customers(id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  adjustment_type text NOT NULL CHECK (
    adjustment_type IN (
      'DISCOUNT',
      'RETURN_CREDIT',
      'SURCHARGE',
      'CANCELLATION_SETTLEMENT',
      'REVERSAL'
    )
  ),
  delta_amount bigint NOT NULL CHECK (delta_amount <> 0),
  reference_code text NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, adj_code),
  CONSTRAINT chk_print_ar_adj_target CHECK (
    (order_id IS NOT NULL AND opening_balance_id IS NULL)
    OR (order_id IS NULL AND opening_balance_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_ar_adj_order
  ON print_ar_adjustments (workspace_id, order_id, created_at DESC);

-- ============================================================================
-- 5. WORKSHOP PAYABLES LEDGER (print_ap_*) & CANCELLATION SETTLEMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_ap_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  tx_code text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES print_vendors(id) ON DELETE RESTRICT,
  vendor_name text NOT NULL,
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  tx_kind text NOT NULL CHECK (tx_kind IN ('PAYOUT', 'VENDOR_REFUND', 'REVERSAL')),
  payout_subtype text NULL CHECK (
    payout_subtype IS NULL
    OR payout_subtype IN ('ADVANCE', 'JOB_PAYMENT', 'SETTLEMENT', 'OPENING_ADVANCE')
  ),
  amount bigint NOT NULL CHECK (amount > 0),
  allocated_amount bigint NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  refunded_unallocated_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_unallocated_amount >= 0),
  unallocated_amount bigint NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
  payment_method text NOT NULL DEFAULT 'BANK_TRANSFER' CHECK (
    payment_method IN ('BANK_TRANSFER', 'CASH', 'QR_VIETQR', 'OTHER')
  ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reference_code text NULL,
  attachment_url text NULL,
  note text NULL,
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOIDED')),
  reversal_of_tx_id uuid NULL REFERENCES print_ap_transactions(id) ON DELETE RESTRICT,
  void_reason text NULL,
  voided_at timestamptz NULL,
  voided_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  reconciled_from_order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  source_sheet_name text NULL,
  source_tab_name text NULL,
  source_row_number integer NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, tx_code),
  CONSTRAINT chk_print_ap_tx_conservation
    CHECK (allocated_amount + refunded_unallocated_amount + unallocated_amount = amount),
  CONSTRAINT chk_print_ap_tx_void_reason
    CHECK (status = 'POSTED' OR (status = 'VOIDED' AND void_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_print_ap_tx_vendor
  ON print_ap_transactions (workspace_id, vendor_id, ledger_scope, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_print_ap_tx_ref
  ON print_ap_transactions (workspace_id, reference_code)
  WHERE reference_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS print_ap_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  ap_transaction_id uuid NOT NULL REFERENCES print_ap_transactions(id) ON DELETE RESTRICT,
  workshop_job_id uuid NULL REFERENCES print_workshop_jobs(id) ON DELETE RESTRICT,
  order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  opening_balance_id uuid NULL REFERENCES print_opening_balances(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (
    direction IN ('APPLY', 'UNAPPLY_REVERSAL', 'VENDOR_REFUND_RELEASE')
  ),
  amount bigint NOT NULL CHECK (amount > 0),
  note text NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_print_ap_alloc_target CHECK (
    (workshop_job_id IS NOT NULL AND opening_balance_id IS NULL)
    OR (workshop_job_id IS NULL AND opening_balance_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_ap_alloc_job
  ON print_ap_allocations (workspace_id, workshop_job_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_print_ap_alloc_tx
  ON print_ap_allocations (workspace_id, ap_transaction_id, created_at ASC);

CREATE TABLE IF NOT EXISTS print_ap_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  adj_code text NOT NULL,
  workshop_job_id uuid NULL REFERENCES print_workshop_jobs(id) ON DELETE RESTRICT,
  order_id uuid NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  opening_balance_id uuid NULL REFERENCES print_opening_balances(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES print_vendors(id) ON DELETE RESTRICT,
  vendor_name text NOT NULL,
  ledger_scope text NOT NULL DEFAULT 'GENERAL' CHECK (
    ledger_scope IN ('GENERAL', 'RIENG', 'HVGROUP')
  ),
  adjustment_type text NOT NULL CHECK (
    adjustment_type IN ('DISCOUNT', 'DEFECT_DEDUCTION', 'SURCHARGE', 'REVERSAL')
  ),
  delta_amount bigint NOT NULL CHECK (delta_amount <> 0),
  reference_code text NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, adj_code),
  CONSTRAINT chk_print_ap_adj_target CHECK (
    (workshop_job_id IS NOT NULL AND opening_balance_id IS NULL)
    OR (workshop_job_id IS NULL AND opening_balance_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_print_ap_adj_job
  ON print_ap_adjustments (workspace_id, workshop_job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS print_order_cancellation_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES print_orders(id) ON DELETE RESTRICT,
  customer_paid_holding_snapshot bigint NOT NULL CHECK (customer_paid_holding_snapshot >= 0),
  agreed_customer_refund_amount bigint NOT NULL CHECK (agreed_customer_refund_amount >= 0),
  retained_cancellation_fee bigint NOT NULL CHECK (retained_cancellation_fee >= 0),
  incurred_vendor_cost_snapshot bigint NOT NULL DEFAULT 0 CHECK (incurred_vendor_cost_snapshot >= 0),
  vendor_paid_snapshot bigint NOT NULL DEFAULT 0 CHECK (vendor_paid_snapshot >= 0),
  reference_code text NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  settled_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_print_cancel_settlement_sum CHECK (
    agreed_customer_refund_amount + retained_cancellation_fee = customer_paid_holding_snapshot
  )
);

CREATE INDEX IF NOT EXISTS idx_print_cancel_settlements_order
  ON print_order_cancellation_settlements (workspace_id, order_id, created_at DESC);

-- ============================================================================
-- 6. IDEMPOTENT 1-TO-1 MIGRATION OF EXISTING print_order_payments -> AR LEDGER
--    (NOTE: vendor_paid_amount on print_orders is NEVER auto-converted to AP!)
-- ============================================================================

INSERT INTO print_ar_transactions (
  workspace_id,
  tx_code,
  customer_id,
  customer_name,
  ledger_scope,
  tx_kind,
  receipt_subtype,
  amount,
  allocated_amount,
  refunded_unallocated_amount,
  unallocated_amount,
  payment_method,
  occurred_at,
  reference_code,
  note,
  status,
  related_order_id,
  legacy_order_payment_id,
  recorded_by,
  created_at
)
SELECT
  p.workspace_id,
  'PT-MIG-' || upper(substr(replace(p.id::text, '-', ''), 1, 12)),
  o.customer_id,
  o.customer_name,
  o.ledger_scope,
  CASE WHEN p.payment_type = 'REFUND' THEN 'REFUND' ELSE 'RECEIPT' END,
  CASE WHEN p.payment_type = 'REFUND' THEN NULL ELSE p.payment_type END,
  p.amount,
  p.amount,
  0,
  0,
  p.payment_method,
  p.paid_at,
  p.reference_code,
  p.note,
  'POSTED',
  p.order_id,
  p.id,
  p.recorded_by,
  p.created_at
FROM print_order_payments p
JOIN print_orders o ON o.id = p.order_id
WHERE NOT EXISTS (
  SELECT 1
  FROM print_ar_transactions existing
  WHERE existing.legacy_order_payment_id = p.id
);

INSERT INTO print_ar_allocations (
  workspace_id,
  ar_transaction_id,
  order_id,
  direction,
  amount,
  note,
  recorded_by,
  created_at
)
SELECT
  tx.workspace_id,
  tx.id,
  tx.related_order_id,
  CASE WHEN tx.tx_kind = 'REFUND' THEN 'REFUND_RELEASE' ELSE 'APPLY' END,
  tx.amount,
  tx.note,
  tx.recorded_by,
  tx.created_at
FROM print_ar_transactions tx
WHERE tx.legacy_order_payment_id IS NOT NULL
  AND tx.related_order_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM print_ar_allocations alloc
    WHERE alloc.ar_transaction_id = tx.id
  );

-- Harden print_order_payments foreign keys from CASCADE to RESTRICT
DO $$
DECLARE
  fk_rec record;
BEGIN
  FOR fk_rec IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'print_order_payments'::regclass
      AND c.contype = 'f'
      AND c.confdeltype = 'c'
  LOOP
    EXECUTE format(
      'ALTER TABLE print_order_payments DROP CONSTRAINT %I',
      fk_rec.conname
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'print_order_payments'::regclass
      AND conname = 'fk_print_order_payments_workspace_restrict'
  ) THEN
    ALTER TABLE print_order_payments
      ADD CONSTRAINT fk_print_order_payments_workspace_restrict
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'print_order_payments'::regclass
      AND conname = 'fk_print_order_payments_order_restrict'
  ) THEN
    ALTER TABLE print_order_payments
      ADD CONSTRAINT fk_print_order_payments_order_restrict
      FOREIGN KEY (order_id) REFERENCES print_orders(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ============================================================================
-- 7. IMMUTABLE / APPEND-ONLY TRIGGERS & ROLE PRIVILEGES
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_print_ledger_append_only_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % operation prohibited', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_print_ar_ap_tx_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% cannot be deleted; use VOID/REVERSAL instead', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id
      OR NEW.workspace_id <> OLD.workspace_id
      OR NEW.tx_code <> OLD.tx_code
      OR NEW.ledger_scope <> OLD.ledger_scope
      OR NEW.tx_kind <> OLD.tx_kind
      OR NEW.amount <> OLD.amount
      OR NEW.payment_method <> OLD.payment_method
      OR NEW.occurred_at <> OLD.occurred_at
      OR (OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED')
    THEN
      RAISE EXCEPTION '% core financial fields are immutable after posting', TG_TABLE_NAME
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_print_opening_balance_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'print_opening_balances cannot be deleted; use AR/AP adjustment instead'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id
      OR NEW.workspace_id <> OLD.workspace_id
      OR NEW.doc_code <> OLD.doc_code
      OR NEW.direction <> OLD.direction
      OR NEW.ledger_scope <> OLD.ledger_scope
      OR NEW.original_amount <> OLD.original_amount
    THEN
      RAISE EXCEPTION 'print_opening_balances core fields are immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'print_workshop_job_history',
    'print_ar_allocations',
    'print_ar_adjustments',
    'print_ap_allocations',
    'print_ap_adjustments',
    'print_order_cancellation_settlements',
    'print_order_payments'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_append_only ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_print_ledger_append_only_mutation()',
      tbl,
      tbl
    );
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_no_truncate ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION prevent_print_ledger_append_only_mutation()',
      tbl,
      tbl
    );
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tbl);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_print_ar_transactions_guard ON print_ar_transactions;
CREATE TRIGGER trg_print_ar_transactions_guard
  BEFORE UPDATE OR DELETE ON print_ar_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_print_ar_ap_tx_mutation();

DROP TRIGGER IF EXISTS trg_print_ar_transactions_no_truncate ON print_ar_transactions;
CREATE TRIGGER trg_print_ar_transactions_no_truncate
  BEFORE TRUNCATE ON print_ar_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_print_ledger_append_only_mutation();

DROP TRIGGER IF EXISTS trg_print_ap_transactions_guard ON print_ap_transactions;
CREATE TRIGGER trg_print_ap_transactions_guard
  BEFORE UPDATE OR DELETE ON print_ap_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_print_ar_ap_tx_mutation();

DROP TRIGGER IF EXISTS trg_print_ap_transactions_no_truncate ON print_ap_transactions;
CREATE TRIGGER trg_print_ap_transactions_no_truncate
  BEFORE TRUNCATE ON print_ap_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_print_ledger_append_only_mutation();

DROP TRIGGER IF EXISTS trg_print_opening_balances_guard ON print_opening_balances;
CREATE TRIGGER trg_print_opening_balances_guard
  BEFORE UPDATE OR DELETE ON print_opening_balances
  FOR EACH ROW EXECUTE FUNCTION guard_print_opening_balance_mutation();

DROP TRIGGER IF EXISTS trg_print_opening_balances_no_truncate ON print_opening_balances;
CREATE TRIGGER trg_print_opening_balances_no_truncate
  BEFORE TRUNCATE ON print_opening_balances
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_print_ledger_append_only_mutation();

REVOKE ALL ON
  print_workshop_jobs,
  print_historical_import_batches,
  print_historical_import_rows,
  print_opening_balances,
  print_ar_transactions,
  print_ap_transactions
FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['hp_app_runtime', 'hp_app_test', 'ml_app_runtime', 'ml_app_test', 'app_runtime', 'app_test']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- State tables allowing controlled INSERT + UPDATE (no DELETE/TRUNCATE on financial headers)
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE ON print_workshop_jobs, print_historical_import_batches, print_historical_import_rows, print_opening_balances, print_ar_transactions, print_ap_transactions TO %I',
        r
      );
      EXECUTE format(
        'REVOKE DELETE, TRUNCATE ON print_workshop_jobs, print_historical_import_batches, print_historical_import_rows, print_opening_balances, print_ar_transactions, print_ap_transactions FROM %I',
        r
      );

      -- Strictly append-only tables: SELECT + INSERT only!
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON print_workshop_job_history, print_ar_allocations, print_ar_adjustments, print_ap_allocations, print_ap_adjustments, print_order_cancellation_settlements, print_order_payments FROM %I',
        r
      );
      EXECUTE format(
        'GRANT SELECT, INSERT ON print_workshop_job_history, print_ar_allocations, print_ar_adjustments, print_ap_allocations, print_ap_adjustments, print_order_cancellation_settlements, print_order_payments TO %I',
        r
      );
    END IF;
  END LOOP;
END $$;
