// Provision, pre-migrate, sentinel-verify, and clean up isolated PostgreSQL
// databases for `npm run test:web` on GitHub-hosted disposable CI containers.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const WEB_CI_SENTINEL_DB = 'web_test_ci_sentinel';
export const WEB_CI_TEST_DB = 'web_e2e_ci_test';

export function assertDisposableGitHubCiEnv(env = process.env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.CI !== 'true' ||
    !env.CI_DATABASE_PASSWORD?.trim()
  ) {
    throw new Error(
      'ci-web-db.mjs is restricted to GitHub-hosted disposable CI containers (requires GITHUB_ACTIONS=true, CI=true, and CI_DATABASE_PASSWORD).',
    );
  }
}

export function assertBuildArtifactsReady(cwd = process.cwd()) {
  const migratorPath = path.resolve(
    cwd,
    'dist/packages/database/src/migrator.js',
  );
  const configPath = path.resolve(cwd, 'dist/packages/database/src/config.js');
  const webIndexPath = path.resolve(cwd, 'apps/web/dist/index.html');

  for (const requiredFile of [migratorPath, configPath, webIndexPath]) {
    if (!fs.existsSync(requiredFile)) {
      throw new Error(
        `Required build artifact missing before web E2E DB setup: ${path.relative(cwd, requiredFile)}. Run "npm run build" and "npm run build:web" first.`,
      );
    }
  }
}

function buildAdminUrl(env) {
  const host = env.CI_POSTGRES_HOST?.trim() || '127.0.0.1';
  const port = env.CI_POSTGRES_PORT?.trim() || '55432';
  const user = env.CI_POSTGRES_USER?.trim() || 'ci_test';
  const adminUrl = new URL(`postgresql://${user}@${host}:${port}/postgres`);
  adminUrl.password = env.CI_DATABASE_PASSWORD;
  return adminUrl;
}

async function prepareWebCiDatabases(env = process.env, cwd = process.cwd()) {
  assertDisposableGitHubCiEnv(env);
  assertBuildArtifactsReady(cwd);

  const adminUrl = buildAdminUrl(env);
  const adminPool = new pg.Pool({ connectionString: adminUrl.href, max: 2 });

  try {
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${WEB_CI_SENTINEL_DB} WITH (FORCE)`,
    );
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${WEB_CI_TEST_DB} WITH (FORCE)`,
    );
    await adminPool.query(`CREATE DATABASE ${WEB_CI_SENTINEL_DB}`);
    await adminPool.query(`CREATE DATABASE ${WEB_CI_TEST_DB}`);
  } finally {
    await adminPool.end();
  }

  const sentinelUrl = new URL(adminUrl.href);
  sentinelUrl.pathname = `/${WEB_CI_SENTINEL_DB}`;

  const testUrl = new URL(adminUrl.href);
  testUrl.pathname = `/${WEB_CI_TEST_DB}`;

  const { loadTestDatabaseConfig, assertSafeTestDatabase } =
    await import('../../dist/packages/database/src/config.js');
  const { createDatabasePool } =
    await import('../../dist/packages/database/src/pool.js');
  const { runMigrations, loadMigrationFiles } =
    await import('../../dist/packages/database/src/migrator.js');

  const verifyEnv = {
    ...env,
    NODE_ENV: 'test',
    DATABASE_URL: sentinelUrl.href,
    TEST_DATABASE_URL: testUrl.href,
    CONFIRM_ISOLATED_TEST_DB: 'true',
  };
  const dbConfig = loadTestDatabaseConfig(verifyEnv);
  assertSafeTestDatabase(dbConfig, verifyEnv);

  const testPool = createDatabasePool(dbConfig);
  try {
    const result = await runMigrations(
      testPool,
      loadMigrationFiles(path.resolve(cwd, 'packages/database/src/migrations')),
    );
    console.log(
      `[ci-web-db] Prepared isolated DB "${WEB_CI_TEST_DB}" (applied=${result.appliedCount}, alreadyApplied=${result.alreadyAppliedCount}) and empty sentinel "${WEB_CI_SENTINEL_DB}".`,
    );
  } finally {
    await testPool.end();
  }
}

async function verifySentinelUntouched(env = process.env) {
  assertDisposableGitHubCiEnv(env);
  const adminUrl = buildAdminUrl(env);
  const sentinelUrl = new URL(adminUrl.href);
  sentinelUrl.pathname = `/${WEB_CI_SENTINEL_DB}`;

  const sentinelPool = new pg.Pool({
    connectionString: sentinelUrl.href,
    max: 2,
  });
  try {
    const res = await sentinelPool.query(
      "SELECT count(*)::int AS cnt FROM pg_tables WHERE schemaname = 'public'",
    );
    const tableCount = Number(res.rows[0]?.cnt ?? 0);
    if (tableCount !== 0) {
      throw new Error(
        `Fail-closed violation: sentinel DATABASE_URL ("${WEB_CI_SENTINEL_DB}") received ${tableCount} public table(s) during test:web.`,
      );
    }
    console.log(
      `[ci-web-db] Verified sentinel "${WEB_CI_SENTINEL_DB}" untouched (0 public tables).`,
    );
  } finally {
    await sentinelPool.end();
  }
}

async function cleanupWebCiDatabases(env = process.env) {
  assertDisposableGitHubCiEnv(env);
  const adminUrl = buildAdminUrl(env);
  const adminPool = new pg.Pool({ connectionString: adminUrl.href, max: 2 });
  try {
    for (const dbName of [
      WEB_CI_TEST_DB,
      WEB_CI_SENTINEL_DB,
      'management_lite_printquote_ci_test',
    ]) {
      await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    }
    console.log(
      `[ci-web-db] Dropped disposable web CI databases (${WEB_CI_TEST_DB}, ${WEB_CI_SENTINEL_DB}).`,
    );
  } finally {
    await adminPool.end();
  }
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    );

if (isMainModule) {
  const action = (process.argv[2] || '').trim();
  if (action === 'prepare') {
    await prepareWebCiDatabases();
  } else if (action === 'verify-sentinel') {
    await verifySentinelUntouched();
  } else if (action === 'cleanup') {
    await cleanupWebCiDatabases();
  } else {
    throw new Error(
      `Unknown ci-web-db action "${action}". Expected: prepare | verify-sentinel | cleanup`,
    );
  }
}
