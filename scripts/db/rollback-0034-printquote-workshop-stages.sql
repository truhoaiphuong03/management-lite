-- Rollback Script for Migration: 0034_printquote_workshop_stages_v2
-- Safety pre-check: aborts inside transaction if any row actively depends on 0034-only states
-- (such as PENDING_COST drafts, PER_SQM catalog items, or vendor-less catalog items) unless cleaned first.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM print_quotes WHERE pricing_status = 'PENDING_COST' OR customer_pdf_json IS NULL) THEN
    RAISE EXCEPTION 'Rollback aborted: print_quotes contains PENDING_COST drafts with NULL customer_pdf_json.';
  END IF;
  IF EXISTS (SELECT 1 FROM print_quote_versions WHERE pricing_status = 'PENDING_COST' OR customer_pdf_json IS NULL) THEN
    RAISE EXCEPTION 'Rollback aborted: print_quote_versions contains PENDING_COST versions with NULL customer_pdf_json.';
  END IF;
  IF EXISTS (SELECT 1 FROM print_vendor_price_items WHERE vendor_id IS NULL) THEN
    RAISE EXCEPTION 'Rollback aborted: print_vendor_price_items contains general workshop items with vendor_id IS NULL.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM print_vendor_price_items
    WHERE pricing_mode = 'PER_SQM' OR default_profit_scope = 'PER_SQM'
  ) THEN
    RAISE EXCEPTION 'Rollback aborted: print_vendor_price_items contains PER_SQM items.';
  END IF;
END $$;

-- 1. Revert print_quote_versions
ALTER TABLE print_quote_versions
  DROP CONSTRAINT IF EXISTS chk_print_quote_versions_pricing_status;

ALTER TABLE print_quote_versions
  ALTER COLUMN customer_pdf_json SET NOT NULL;

ALTER TABLE print_quote_versions
  DROP COLUMN IF EXISTS pending_cost_summary,
  DROP COLUMN IF EXISTS pricing_status;

-- 2. Revert print_quotes
DROP INDEX IF EXISTS idx_print_quotes_pricing_status;

ALTER TABLE print_quotes
  DROP CONSTRAINT IF EXISTS chk_print_quotes_pricing_status;

ALTER TABLE print_quotes
  ALTER COLUMN customer_pdf_json SET NOT NULL;

ALTER TABLE print_quotes
  DROP COLUMN IF EXISTS pending_cost_summary,
  DROP COLUMN IF EXISTS pricing_status;

-- 3. Drop print_vendor_price_item_history
DROP TABLE IF EXISTS print_vendor_price_item_history;

-- 4. Revert print_vendor_price_items
DROP INDEX IF EXISTS idx_print_vendor_price_items_type_active;
DROP INDEX IF EXISTS uq_print_vendor_price_items_workspace_general_code;

ALTER TABLE print_vendor_price_items
  DROP CONSTRAINT IF EXISTS chk_print_vendor_price_items_item_type,
  DROP CONSTRAINT IF EXISTS chk_print_vendor_price_items_pricing_mode,
  DROP CONSTRAINT IF EXISTS chk_print_vendor_price_items_default_profit_scope,
  DROP CONSTRAINT IF EXISTS fk_print_vendor_price_items_vendor;

ALTER TABLE print_vendor_price_items
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS conditions_note,
  DROP COLUMN IF EXISTS structured_spec,
  DROP COLUMN IF EXISTS included_stages,
  DROP COLUMN IF EXISTS item_type;

ALTER TABLE print_vendor_price_items
  ALTER COLUMN vendor_id SET NOT NULL;

ALTER TABLE print_vendor_price_items
  ADD CONSTRAINT print_vendor_price_items_vendor_id_fkey
    FOREIGN KEY (vendor_id) REFERENCES print_vendors(id) ON DELETE CASCADE,
  ADD CONSTRAINT print_vendor_price_items_pricing_mode_check
    CHECK (pricing_mode IN ('PER_UNIT', 'TOTAL_BATCH')),
  ADD CONSTRAINT print_vendor_price_items_default_profit_scope_check
    CHECK (default_profit_scope IN ('PER_UNIT', 'TOTAL_BATCH'));

-- 5. Remove migration tracking entry
DELETE FROM schema_migrations WHERE id = '0034_printquote_workshop_stages_v2';

COMMIT;
