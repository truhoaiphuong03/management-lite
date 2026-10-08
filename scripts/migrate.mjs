import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

async function main() {
  const { loadDatabaseConfig, sanitizeDatabaseConfig } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );
  const { createDatabasePool, closeDatabasePool, checkDatabaseHealth } =
    await import(
      `file://${resolve(root, 'dist/packages/database/src/pool.js')}`
    );
  const { runMigrations, loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const config = loadDatabaseConfig();
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
