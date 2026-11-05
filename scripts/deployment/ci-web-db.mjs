// Provision, pre-migrate, sentinel-verify, and clean up isolated PostgreSQL
// databases for `npm run test:web` on GitHub-hosted disposable Linux CI containers.
// IMPORTANT: Keep top-level imports strictly restricted to Node.js built-ins so
// pre-install security gates (e.g. Windows P0 before `npm ci`) can import and
// audit this module without `node_modules` installed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WEB_CI_SENTINEL_DB = 'web_test_ci_sentinel';
export const WEB_CI_TEST_DB = 'web_e2e_ci_test';
export const ALLOWED_DISPOSABLE_CI_DBS = Object.freeze([
  WEB_CI_TEST_DB,
  WEB_CI_SENTINEL_DB,
]);

const PRODUCTION_FILESYSTEM_MARKERS = Object.freeze([
  'C:\\HoaiPhuong-Server',
  '/c/HoaiPhuong-Server',
  '/mnt/c/HoaiPhuong-Server',
]);

const PROHIBITED_ROLES = Object.freeze(['hp_test_admin', 'hp_owner_admin']);
const PROHIBITED_DATABASES = Object.freeze([
  'management_lite',
  'management_lite_prod',
  'management_lite_staging',
  'management_lite_test',
]);

export function assertAllowedCiDbIdentifier(dbName) {
  if (!ALLOWED_DISPOSABLE_CI_DBS.includes(dbName)) {
    throw new Error(
      `SECURITY_VIOLATION_DISALLOWED_DB_NAME: "${dbName}" is not in the disposable CI database allowlist.`,
    );
  }
}

/**
 * Multi-factor preflight verification BEFORE loading `pg` or opening any TCP socket.
 * Never relies solely on user-settable environment variables:
 * 1. Compiled Node runtime platform MUST be 'linux' (blocks Windows Production at binary level).
 * 2. Host filesystem MUST NOT contain HoaiPhuong-Server (native or WSL mount) or WSL kernel markers.
 * 3. GitHub-hosted Linux runner directories (GITHUB_WORKSPACE, RUNNER_TEMP) MUST exist on disk.
 * 4. CI_DATABASE_PASSWORD MUST match the disposable run-bound token `ci-only-<run_id>-<run_attempt>`.
 */
export function assertDisposableGitHubCiHost(env = process.env, runtime = {}) {
  const platform = runtime.platform ?? process.platform;
  const pathExists = runtime.pathExists ?? fs.existsSync;
  const readText = runtime.readText ?? ((p) => fs.readFileSync(p, 'utf8'));

  if (platform !== 'linux') {
    throw new Error(
      `SECURITY_VIOLATION_NON_LINUX_HOST: ci-web-db.mjs is restricted to Linux GitHub-hosted CI containers (got platform="${platform}"). Execution on Windows/macOS hosts is strictly prohibited.`,
    );
  }

  for (const marker of PRODUCTION_FILESYSTEM_MARKERS) {
    if (pathExists(marker)) {
      throw new Error(
        `SECURITY_VIOLATION_PRODUCTION_HOST_DETECTED: Production directory marker "${marker}" exists on this machine. Aborting before any database connection.`,
      );
    }
  }

  if (pathExists('/proc/version')) {
    const procVersion = String(readText('/proc/version') || '');
    if (/microsoft-standard-wsl|\bwsl2?\b/i.test(procVersion)) {
      throw new Error(
        'SECURITY_VIOLATION_WSL_HOST_FORBIDDEN: WSL kernel detected in /proc/version. ci-web-db.mjs cannot execute on Windows Subsystem for Linux.',
      );
    }
  }

  const nodeEnv = (env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    throw new Error(
      `SECURITY_VIOLATION_PROHIBITED_NODE_ENV: NODE_ENV="${nodeEnv}" is prohibited for CI test DB provisioning.`,
    );
  }

  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.CI !== 'true' ||
    env.RUNNER_OS !== 'Linux'
  ) {
    throw new Error(
      'SECURITY_VIOLATION_NOT_GITHUB_LINUX_CI: Requires GITHUB_ACTIONS=true, CI=true, and RUNNER_OS=Linux on a GitHub-hosted runner.',
    );
  }

  const runId = (env.GITHUB_RUN_ID || '').trim();
  const runAttempt = (env.GITHUB_RUN_ATTEMPT || '1').trim();
  if (!/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt)) {
    throw new Error(
      'SECURITY_VIOLATION_INVALID_GITHUB_RUN_METADATA: Numeric GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT are required.',
    );
  }

  const expectedPassword = `ci-only-${runId}-${runAttempt}`;
  if (
    !env.CI_DATABASE_PASSWORD ||
    env.CI_DATABASE_PASSWORD !== expectedPassword
  ) {
    throw new Error(
      'SECURITY_VIOLATION_INVALID_CI_DB_TOKEN: CI_DATABASE_PASSWORD does not match the disposable run-bound format ci-only-<run_id>-<run_attempt>.',
    );
  }

  const workspaceDir = (env.GITHUB_WORKSPACE || '').trim();
  const runnerTempDir = (env.RUNNER_TEMP || '').trim();
  if (
    !workspaceDir.startsWith('/') ||
    !runnerTempDir.startsWith('/') ||
    /^\/(?:mnt\/)?[a-zA-Z]\//.test(workspaceDir) ||
    /^\/(?:mnt\/)?[a-zA-Z]\//.test(runnerTempDir) ||
    !pathExists(workspaceDir) ||
    !pathExists(runnerTempDir)
  ) {
    throw new Error(
      'SECURITY_VIOLATION_MISSING_RUNNER_FILESYSTEM: Valid existing Linux GITHUB_WORKSPACE and RUNNER_TEMP directories are required.',
    );
  }
}

export { assertDisposableGitHubCiHost as assertDisposableGitHubCiEnv };

export function assertBuildArtifactsReady(
  cwd = process.cwd(),
  pathExists = fs.existsSync,
) {
  const migratorPath = path.resolve(
    cwd,
    'dist/packages/database/src/migrator.js',
  );
  const configPath = path.resolve(cwd, 'dist/packages/database/src/config.js');
  const webIndexPath = path.resolve(cwd, 'apps/web/dist/index.html');

  for (const requiredFile of [migratorPath, configPath, webIndexPath]) {
    if (!pathExists(requiredFile)) {
      throw new Error(
        `Required build artifact missing before web E2E DB setup: ${path.relative(cwd, requiredFile)}. Run "npm run build" and "npm run build:web" first.`,
      );
    }
  }
}

function buildFixedCiAdminUrl(env) {
  // Hard-locked to the disposable CI service container endpoint — no host/port/user env overrides.
  const adminUrl = new URL('postgresql://ci_test@127.0.0.1:55432/postgres');
  adminUrl.password = env.CI_DATABASE_PASSWORD;
  return adminUrl;
}

async function createPgPool(connectionString, runtime = {}) {
  if (typeof runtime.createPool === 'function') {
    return runtime.createPool(connectionString);
  }
  const pgMod = await import('pg');
  const PoolCtor = pgMod.default?.Pool ?? pgMod.Pool;
  return new PoolCtor({ connectionString, max: 2 });
}

/**
 * Server-side PostgreSQL identity check executed via read-only SELECTs
 * STRICTLY BEFORE any CREATE DATABASE or DROP DATABASE statement.
 * Rejects immediately if port 55432 belongs to Windows PostgreSQL, has
 * Production roles/databases, or is anything other than the clean CI container.
 */
export async function verifyDisposableCiPostgresCluster(adminPool) {
  const identityRes = await adminPool.query(
    'SELECT current_user AS usr, current_database() AS db, version() AS ver',
  );
  const row = identityRes.rows?.[0] || {};
  const currentUser = String(row.usr || '').trim();
  const currentDb = String(row.db || '').trim();
  const serverVersion = String(row.ver || '').trim();

  if (currentUser !== 'ci_test' || currentDb !== 'postgres') {
    throw new Error(
      `SECURITY_VIOLATION_UNEXPECTED_PG_IDENTITY: Expected ci_test@postgres on disposable CI container, got ${currentUser}@${currentDb}.`,
    );
  }

  if (
    !/linux/i.test(serverVersion) ||
    /windows|mingw|visual c\+\+|msvc/i.test(serverVersion)
  ) {
    throw new Error(
      `SECURITY_VIOLATION_NON_LINUX_POSTGRES: Target PostgreSQL server version does not match a Linux CI container ("${serverVersion}"). Refusing all DDL.`,
    );
  }

  const roleRes = await adminPool.query(
    'SELECT rolname FROM pg_roles WHERE lower(rolname) = ANY($1::text[])',
    [PROHIBITED_ROLES],
  );
  if ((roleRes.rows?.length ?? 0) > 0) {
    throw new Error(
      `SECURITY_VIOLATION_PRODUCTION_ROLE_PRESENT: Target PostgreSQL cluster contains production role(s): ${roleRes.rows.map((r) => r.rolname).join(', ')}. Refusing all DDL.`,
    );
  }

  const dbRes = await adminPool.query(
    'SELECT datname FROM pg_database WHERE datistemplate = false AND lower(datname) = ANY($1::text[])',
    [PROHIBITED_DATABASES],
  );
  if ((dbRes.rows?.length ?? 0) > 0) {
    throw new Error(
      `SECURITY_VIOLATION_PRODUCTION_DB_PRESENT: Target PostgreSQL cluster contains protected database(s): ${dbRes.rows.map((r) => r.datname).join(', ')}. Refusing all DDL.`,
    );
  }

  const publicTablesRes = await adminPool.query(
    "SELECT count(*)::int AS cnt FROM pg_tables WHERE schemaname = 'public'",
  );
  const publicTableCount = Number(publicTablesRes.rows?.[0]?.cnt ?? 0);
  if (publicTableCount !== 0) {
    throw new Error(
      `SECURITY_VIOLATION_NON_EMPTY_ADMIN_DB: Expected 0 public tables in disposable CI postgres database, found ${publicTableCount}. Refusing all DDL.`,
    );
  }
}

export async function prepareWebCiDatabases(env = process.env, runtime = {}) {
  const cwd = runtime.cwd ?? process.cwd();
  assertDisposableGitHubCiHost(env, runtime);
  assertBuildArtifactsReady(cwd, runtime.pathExists ?? fs.existsSync);

  for (const dbName of ALLOWED_DISPOSABLE_CI_DBS) {
    assertAllowedCiDbIdentifier(dbName);
  }

  const adminUrl = buildFixedCiAdminUrl(env);
  const adminPool = await createPgPool(adminUrl.href, runtime);

  try {
    await verifyDisposableCiPostgresCluster(adminPool);
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

  const configModUrl = pathToFileURL(
    path.resolve(cwd, 'dist/packages/database/src/config.js'),
  ).href;
  const poolModUrl = pathToFileURL(
    path.resolve(cwd, 'dist/packages/database/src/pool.js'),
  ).href;
  const migratorModUrl = pathToFileURL(
    path.resolve(cwd, 'dist/packages/database/src/migrator.js'),
  ).href;

  const { loadTestDatabaseConfig, assertSafeTestDatabase } =
    runtime.databaseConfigModule ?? (await import(configModUrl));
  const { createDatabasePool } =
    runtime.databasePoolModule ?? (await import(poolModUrl));
  const { runMigrations, loadMigrationFiles } =
    runtime.migratorModule ?? (await import(migratorModUrl));

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

export async function verifySentinelUntouched(env = process.env, runtime = {}) {
  assertDisposableGitHubCiHost(env, runtime);

  const adminUrl = buildFixedCiAdminUrl(env);
  const adminPool = await createPgPool(adminUrl.href, runtime);
  try {
    await verifyDisposableCiPostgresCluster(adminPool);
  } finally {
    await adminPool.end();
  }

  const sentinelUrl = new URL(adminUrl.href);
  sentinelUrl.pathname = `/${WEB_CI_SENTINEL_DB}`;

  const sentinelPool = await createPgPool(sentinelUrl.href, runtime);
  try {
    const res = await sentinelPool.query(
      "SELECT count(*)::int AS cnt FROM pg_tables WHERE schemaname = 'public'",
    );
    const tableCount = Number(res.rows?.[0]?.cnt ?? 0);
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

export async function cleanupWebCiDatabases(env = process.env, runtime = {}) {
  assertDisposableGitHubCiHost(env, runtime);

  const adminUrl = buildFixedCiAdminUrl(env);
  const adminPool = await createPgPool(adminUrl.href, runtime);
  try {
    await verifyDisposableCiPostgresCluster(adminPool);
    for (const dbName of ALLOWED_DISPOSABLE_CI_DBS) {
      assertAllowedCiDbIdentifier(dbName);
      await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    }
    console.log(
      `[ci-web-db] Dropped disposable web CI databases (${ALLOWED_DISPOSABLE_CI_DBS.join(', ')}).`,
    );
  } finally {
    await adminPool.end();
  }
}

const isMainModule = (() => {
  if (!process.argv[1]) return false;
  const selfPath = fileURLToPath(import.meta.url);
  try {
    return (
      fs.realpathSync.native(path.resolve(process.argv[1])) ===
      fs.realpathSync.native(selfPath)
    );
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(selfPath);
  }
})();

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
