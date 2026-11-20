-- Rollback for migration: 0044_web_customers
-- Safely removes isolated web customer tables and clears schema_migrations record.

BEGIN;

DROP TABLE IF EXISTS web_customer_sessions;
DROP TABLE IF EXISTS web_customers;

DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    DELETE FROM schema_migrations WHERE id = '0044_web_customers';
  END IF;
END $$;

COMMIT;
