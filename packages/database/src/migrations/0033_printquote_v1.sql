-- Migration: 0033_printquote_v1
-- Scope: Additive tables for MGL-PRINTQUOTE V1 (vendors, price catalog, customers, quotes, quote versions, orders, order payments).

CREATE TABLE IF NOT EXISTS print_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  phone text NULL,
  address text NULL,
  bank_name text NULL,
  bank_account_number text NULL,
  bank_account_holder text NULL,
  note text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_vendors_workspace_code UNIQUE (workspace_id, code)
);

CREATE INDEX IF NOT EXISTS idx_print_vendors_workspace
  ON print_vendors (workspace_id, is_active, name);

CREATE TABLE IF NOT EXISTS print_vendor_price_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES print_vendors(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  category text NULL,
  specification text NULL,
  unit text NOT NULL DEFAULT 'tờ',
  pricing_mode text NOT NULL DEFAULT 'PER_UNIT' CHECK (pricing_mode IN ('PER_UNIT', 'TOTAL_BATCH')),
  unit_cost bigint NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  batch_quantity integer NOT NULL DEFAULT 1 CHECK (batch_quantity > 0),
  batch_total_cost bigint NOT NULL DEFAULT 0 CHECK (batch_total_cost >= 0),
  default_profit_mode text NOT NULL DEFAULT 'FIXED_AMOUNT' CHECK (default_profit_mode IN ('FIXED_AMOUNT', 'PERCENTAGE')),
  default_profit_scope text NOT NULL DEFAULT 'PER_UNIT' CHECK (default_profit_scope IN ('PER_UNIT', 'TOTAL_BATCH')),
  default_profit_value numeric(12,2) NOT NULL DEFAULT 0 CHECK (default_profit_value >= 0),
  note text NULL,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_vendor_price_items_workspace_code UNIQUE (workspace_id, vendor_id, code)
);

CREATE INDEX IF NOT EXISTS idx_print_vendor_price_items_lookup
  ON print_vendor_price_items (workspace_id, vendor_id, is_active);

CREATE TABLE IF NOT EXISTS print_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  company_name text NULL,
  phone text NULL,
  email text NULL,
  address text NULL,
  tax_code text NULL,
  note text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_customers_workspace_code UNIQUE (workspace_id, code)
);

CREATE INDEX IF NOT EXISTS idx_print_customers_workspace
  ON print_customers (workspace_id, is_active, name);

CREATE TABLE IF NOT EXISTS print_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_code text NOT NULL,
  title text NOT NULL,
  customer_id uuid NULL REFERENCES print_customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text NULL,
  customer_address text NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'APPROVED', 'FINALIZED', 'CONVERTED', 'CANCELLED')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  include_shipping_in_unit_price boolean NOT NULL DEFAULT true,
  shipping_allocation_strategy text NOT NULL DEFAULT 'PROPORTIONAL_BY_BASE_AMOUNT' CHECK (shipping_allocation_strategy IN ('PROPORTIONAL_BY_BASE_AMOUNT', 'PROPORTIONAL_BY_QUANTITY', 'EQUAL_SPLIT')),
  rounding_mode text NOT NULL DEFAULT 'NEAREST' CHECK (rounding_mode IN ('NEAREST', 'FLOOR', 'CEIL')),
  rounding_step integer NOT NULL DEFAULT 1 CHECK (rounding_step > 0),
  total_quantity integer NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  total_vendor_cost bigint NOT NULL DEFAULT 0 CHECK (total_vendor_cost >= 0),
  total_profit bigint NOT NULL DEFAULT 0 CHECK (total_profit >= 0),
  shipping_fee bigint NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  total_extra_cost bigint NOT NULL DEFAULT 0 CHECK (total_extra_cost >= 0),
  total_quote_amount bigint NOT NULL DEFAULT 0 CHECK (total_quote_amount >= 0),
  total_rounding_adjustment bigint NOT NULL DEFAULT 0,
  single_product_final_unit_price bigint NULL,
  lines_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot_json jsonb NOT NULL,
  customer_pdf_json jsonb NOT NULL,
  integrity_hash text NOT NULL,
  valid_until date NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  finalized_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_quotes_workspace_code UNIQUE (workspace_id, quote_code)
);

CREATE INDEX IF NOT EXISTS idx_print_quotes_workspace_created
  ON print_quotes (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS print_quote_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES print_quotes(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number >= 1),
  status text NOT NULL,
  total_quantity integer NOT NULL DEFAULT 0,
  total_vendor_cost bigint NOT NULL DEFAULT 0,
  total_profit bigint NOT NULL DEFAULT 0,
  shipping_fee bigint NOT NULL DEFAULT 0,
  total_extra_cost bigint NOT NULL DEFAULT 0,
  total_quote_amount bigint NOT NULL DEFAULT 0,
  total_rounding_adjustment bigint NOT NULL DEFAULT 0,
  snapshot_json jsonb NOT NULL,
  customer_pdf_json jsonb NOT NULL,
  integrity_hash text NOT NULL,
  change_note text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_quote_versions_number UNIQUE (quote_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_print_quote_versions_lookup
  ON print_quote_versions (workspace_id, quote_id, version_number DESC);

CREATE TABLE IF NOT EXISTS print_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  order_code text NOT NULL,
  quote_id uuid NOT NULL REFERENCES print_quotes(id) ON DELETE RESTRICT,
  quote_code text NOT NULL,
  quote_version integer NOT NULL DEFAULT 1,
  customer_id uuid NULL REFERENCES print_customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text NULL,
  customer_address text NULL,
  vendor_id uuid NULL REFERENCES print_vendors(id) ON DELETE SET NULL,
  vendor_name text NULL,
  title text NOT NULL,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  print_ordered_at date NULL,
  due_date date NULL,
  completed_at timestamptz NULL,
  delivered_at timestamptz NULL,
  production_status text NOT NULL DEFAULT 'PENDING' CHECK (production_status IN ('PENDING', 'PREPRESS', 'PRINTING', 'FINISHING', 'COMPLETED', 'CANCELLED')),
  delivery_status text NOT NULL DEFAULT 'NOT_SHIPPED' CHECK (delivery_status IN ('NOT_SHIPPED', 'PACKING', 'SHIPPING', 'DELIVERED', 'RETURNED')),
  payment_status text NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'PAID')),
  total_quote_amount bigint NOT NULL DEFAULT 0 CHECK (total_quote_amount >= 0),
  expected_vendor_cost bigint NOT NULL DEFAULT 0 CHECK (expected_vendor_cost >= 0),
  expected_shipping_fee bigint NOT NULL DEFAULT 0 CHECK (expected_shipping_fee >= 0),
  expected_extra_cost bigint NOT NULL DEFAULT 0 CHECK (expected_extra_cost >= 0),
  expected_profit bigint NOT NULL DEFAULT 0,
  actual_vendor_cost bigint NOT NULL DEFAULT 0 CHECK (actual_vendor_cost >= 0),
  actual_shipping_fee bigint NOT NULL DEFAULT 0 CHECK (actual_shipping_fee >= 0),
  actual_extra_cost bigint NOT NULL DEFAULT 0 CHECK (actual_extra_cost >= 0),
  actual_profit bigint NOT NULL DEFAULT 0,
  deposit_required bigint NOT NULL DEFAULT 0 CHECK (deposit_required >= 0),
  deposit_paid bigint NOT NULL DEFAULT 0 CHECK (deposit_paid >= 0),
  total_paid_amount bigint NOT NULL DEFAULT 0 CHECK (total_paid_amount >= 0),
  remaining_debt_amount bigint NOT NULL DEFAULT 0 CHECK (remaining_debt_amount >= 0),
  snapshot_json jsonb NOT NULL,
  integrity_hash text NOT NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_orders_workspace_code UNIQUE (workspace_id, order_code),
  CONSTRAINT uq_print_orders_workspace_quote UNIQUE (workspace_id, quote_id)
);

CREATE INDEX IF NOT EXISTS idx_print_orders_workspace_created
  ON print_orders (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS print_code_counters (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  counter_key text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, counter_key)
);

CREATE TABLE IF NOT EXISTS print_order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES print_orders(id) ON DELETE CASCADE,
  payment_type text NOT NULL DEFAULT 'INSTALLMENT' CHECK (payment_type IN ('DEPOSIT', 'INSTALLMENT', 'FINAL', 'REFUND')),
  amount bigint NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'BANK_TRANSFER' CHECK (payment_method IN ('BANK_TRANSFER', 'CASH', 'QR_VIETQR', 'OTHER')),
  paid_at timestamptz NOT NULL DEFAULT now(),
  reference_code text NULL,
  note text NULL,
  recorded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_order_payments_order
  ON print_order_payments (workspace_id, order_id, paid_at ASC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      print_vendors,
      print_vendor_price_items,
      print_customers,
      print_quotes,
      print_quote_versions,
      print_orders,
      print_code_counters,
      print_order_payments
    TO hp_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_test') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      print_vendors,
      print_vendor_price_items,
      print_customers,
      print_quotes,
      print_quote_versions,
      print_orders,
      print_code_counters,
      print_order_payments
    TO hp_app_test;
  END IF;
END $$;
