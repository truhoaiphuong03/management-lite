import { loadExplicitDatabaseConfig } from './explicit-database.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

async function main() {
  const { sanitizeDatabaseConfig } = await import(
    pathToFileURL(resolve(root, 'dist/packages/database/src/config.js')).href
  );
  const { createDatabasePool, closeDatabasePool, checkDatabaseHealth } =
    await import(
      pathToFileURL(resolve(root, 'dist/packages/database/src/pool.js')).href
    );
  const { runMigrations, loadMigrationFiles } = await import(
    pathToFileURL(resolve(root, 'dist/packages/database/src/migrator.js')).href
  );

  const config = loadExplicitDatabaseConfig();
  console.log('Loaded database configuration:', sanitizeDatabaseConfig(config));

  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      console.error(
        `Database connection check failed: ${health.error || 'unreachable'}. Cannot run migrations.`,
      );
      process.exit(1);
    }

    console.log('Database connected. Loading migrations...');
    const migrations = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );
    console.log(`Found ${migrations.length} migration files in registry.`);

    const result = await runMigrations(pool, migrations);
    const roleCheck = await pool.query(
      `SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_test' LIMIT 1`,
    );
    if (roleCheck.rowCount && roleCheck.rowCount > 0) {
      await pool.query(
        `GRANT USAGE ON SCHEMA public TO hp_app_test; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hp_app_test; REVOKE UPDATE, DELETE ON audit_events FROM hp_app_test; REVOKE UPDATE, DELETE, TRUNCATE ON print_order_cost_history, print_workshop_job_history, print_ar_allocations, print_ar_adjustments, print_ap_allocations, print_ap_adjustments, print_order_cancellation_settlements, print_order_payments, print_legacy_ar_reconciliation_history FROM hp_app_test; REVOKE DELETE, TRUNCATE ON print_workshop_jobs, print_historical_import_batches, print_historical_import_rows, print_opening_balances, print_ar_transactions, print_ap_transactions, print_legacy_ar_reconciliations FROM hp_app_test; REVOKE ALL ON schema_migrations FROM hp_app_test; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hp_app_test;`,
      );
    }
    console.log(
      `Migrations finished successfully. Applied: ${result.appliedCount}, Previously applied: ${result.alreadyAppliedCount}`,
    );
    if (result.appliedIds.length > 0) {
      console.log('Applied IDs:', result.appliedIds);
    }
  } finally {
    await closeDatabasePool(pool);
  }
}

main().catch((err) => {
  console.error(
    'Migration runner failed:',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
