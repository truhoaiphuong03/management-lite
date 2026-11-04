-- Migration: 0034_printquote_workshop_stages_v2
-- Scope: Additive PrintQuote V2 Workshop Pricing (BASE_PRINT vs FINISHING, optional vendor, PER_SQM area pricing,
--        included_stages anti-double-charge metadata, price item change history, and PENDING_COST draft state).
-- Zero sample/fake data is inserted. Existing quotes and price items remain 100% intact.

-- 1. Allow optional vendor_id (ON DELETE SET NULL) and expand print_vendor_price_items
ALTER TABLE print_vendor_price_items
  DROP CONSTRAINT IF EXISTS print_vendor_price_items_vendor_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_print_vendor_price_items_vendor;

ALTER TABLE print_vendor_price_items
  ALTER COLUMN vendor_id DROP NOT NULL;

ALTER TABLE print_vendor_price_items
  ADD CONSTRAINT fk_print_vendor_price_items_vendor
    FOREIGN KEY (vendor_id) REFERENCES print_vendors(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_print_vendor_price_items_workspace_general_code
  ON print_vendor_price_items (workspace_id, code)
  WHERE vendor_id IS NULL;

ALTER TABLE print_vendor_price_items
  DROP CONSTRAINT IF EXISTS print_vendor_price_items_pricing_mode_check,
  DROP CONSTRAINT IF EXISTS chk_print_vendor_price_items_pricing_mode,
  DROP CONSTRAINT IF EXISTS print_vendor_price_items_default_profit_scope_check,
  DROP CONSTRAINT IF EXISTS chk_print_vendor_price_items_default_profit_scope;

ALTER TABLE print_vendor_price_items
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'BASE_PRINT',
  ADD COLUMN IF NOT EXISTS included_stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS structured_spec jsonb NULL,
  ADD COLUMN IF NOT EXISTS conditions_note text NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE print_vendor_price_items
  DROP CONSTRAINT IF EXISTS chk_print_vendor_price_items_item_type;

ALTER TABLE print_vendor_price_items
  ADD CONSTRAINT chk_print_vendor_price_items_item_type
    CHECK (item_type IN ('BASE_PRINT', 'FINISHING')),
  ADD CONSTRAINT chk_print_vendor_price_items_pricing_mode
    CHECK (pricing_mode IN ('PER_UNIT', 'PER_SQM', 'TOTAL_BATCH')),
  ADD CONSTRAINT chk_print_vendor_price_items_default_profit_scope
    CHECK (default_profit_scope IN ('PER_UNIT', 'PER_SQM', 'TOTAL_BATCH'));

CREATE INDEX IF NOT EXISTS idx_print_vendor_price_items_type_active
  ON print_vendor_price_items (workspace_id, item_type, is_active);

-- 2. Immutable Workshop Price Change History (audit trail of who changed what and when)
CREATE TABLE IF NOT EXISTS print_vendor_price_item_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  price_item_id uuid NOT NULL REFERENCES print_vendor_price_items(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  action text NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'DEACTIVATED', 'RESTORED')),
  before_json jsonb NULL,
  after_json jsonb NOT NULL,
  change_note text NULL,
  changed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_vendor_price_item_history_lookup
  ON print_vendor_price_item_history (workspace_id, price_item_id, version DESC, changed_at DESC);

-- 3. Support "Chờ giá xưởng" (PENDING_COST) drafts on print_quotes and print_quote_versions
ALTER TABLE print_quotes
  ADD COLUMN IF NOT EXISTS pricing_status text NOT NULL DEFAULT 'COMPLETE',
  ADD COLUMN IF NOT EXISTS pending_cost_summary jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE print_quotes
  ALTER COLUMN customer_pdf_json DROP NOT NULL;

ALTER TABLE print_quotes
  DROP CONSTRAINT IF EXISTS chk_print_quotes_pricing_status;

ALTER TABLE print_quotes
  ADD CONSTRAINT chk_print_quotes_pricing_status
    CHECK (
      (pricing_status = 'COMPLETE' AND customer_pdf_json IS NOT NULL)
      OR (pricing_status = 'PENDING_COST' AND status = 'DRAFT')
    );

CREATE INDEX IF NOT EXISTS idx_print_quotes_pricing_status
  ON print_quotes (workspace_id, pricing_status, status);

ALTER TABLE print_quote_versions
  ADD COLUMN IF NOT EXISTS pricing_status text NOT NULL DEFAULT 'COMPLETE',
  ADD COLUMN IF NOT EXISTS pending_cost_summary jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE print_quote_versions
  ALTER COLUMN customer_pdf_json DROP NOT NULL;

ALTER TABLE print_quote_versions
  DROP CONSTRAINT IF EXISTS chk_print_quote_versions_pricing_status;

ALTER TABLE print_quote_versions
  ADD CONSTRAINT chk_print_quote_versions_pricing_status
    CHECK (
      (pricing_status = 'COMPLETE' AND customer_pdf_json IS NOT NULL)
      OR (pricing_status = 'PENDING_COST' AND status = 'DRAFT')
    );

-- 4. Grant table permissions across runtime/test DB roles
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['hp_app_runtime', 'hp_app_test', 'ml_app_runtime', 'ml_app_test', 'app_runtime', 'app_test']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON print_vendor_price_item_history, print_vendor_price_items, print_quotes, print_quote_versions TO %I',
        r
      );
    END IF;
  END LOOP;
END $$;
