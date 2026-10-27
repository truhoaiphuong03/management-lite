// Selected CI gate, not the full 90-file acceptance suite.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.CI !== 'true' ||
  !process.env.CI_DATABASE_PASSWORD
)
  throw new Error('GitHub-hosted disposable CI only');
const base = new URL('postgresql://ci_test@127.0.0.1:55432/postgres');
base.password = process.env.CI_DATABASE_PASSWORD;
const admin = new pg.Pool({ connectionString: base.href });
try {
  const id = (
    await admin.query(
      'SELECT system_identifier::text AS id FROM pg_control_system()',
    )
  ).rows[0].id;
  const sentinel = 'backend_test_ci_sentinel';
  await admin.query(`CREATE DATABASE ${sentinel}`);
  const baseline = new URL(base);
  baseline.pathname = '/' + sentinel;
  const files = [
    ...fs
      .readdirSync('tests/foundation')
      .filter((f) => f.endsWith('.test.mjs'))
      .map((f) => 'tests/foundation/' + f),
    ...fs
      .readdirSync('tests/security')
      .filter((f) => f.endsWith('.test.mjs'))
      .map((f) => 'tests/security/' + f),
    'tests/backend/cicd-policy.test.mjs',
    'tests/backend/bridge-safety.test.mjs',
    'tests/backend/bridge-sso.test.mjs',
    'tests/web/bridge-sync-mounted.test.mjs',
    'tests/backend/bridge-postgres.test.mjs',
    'tests/web/auth-request-retry.test.mjs',
    'tests/web/cp22-04-extensions.test.mjs',
    'tests/backend/auth.test.mjs',
    'tests/backend/accounts.test.mjs',
    'tests/backend/function-verification.test.mjs',
    'tests/backend/timesheet-postgres.test.mjs',
    'tests/backend/att-mvp.test.mjs',
    'tests/backend/rep-mvp.test.mjs',
    'tests/backend/work.test.mjs',
    'tests/backend/schedule.test.mjs',
    'tests/backend/work-e2e.test.mjs',
    'tests/backend/work-schedule-links.test.mjs',
    'tests/backend/payroll.test.mjs',
    'tests/backend/storage.test.mjs',
    'tests/backend/storage-provider-safety.test.mjs',
    'tests/backend/emp-mvp.test.mjs',
    'tests/backend/issue-cp22-fixes.test.mjs',
    'tests/backend/owner-self-lockout.test.mjs',
    'tests/backend/admin-login.test.mjs',
    'tests/database/config.test.mjs',
    'tests/database/migrator.test.mjs',
    'tests/database/integration.test.mjs',
    'tests/database/attendance-version-qa.test.mjs',
    'tests/database/audit-upgrade-qa.test.mjs',
    'tests/web/settings-screen.test.mjs',
  ];
  // Suites that expect an already migrated database (they do not migrate themselves).
  const premigrated = new Set([
    'tests/backend/att-mvp.test.mjs',
    'tests/backend/rep-mvp.test.mjs',
    'tests/backend/work.test.mjs',
    'tests/backend/schedule.test.mjs',
  ]);
  for (let i = 0; i < files.length; i++) {
    const name = 'backend_test_ci_' + i;
    await admin.query(`CREATE DATABASE ${name}`);
    const target = new URL(base);
    target.pathname = '/' + name;
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: baseline.href,
      TEST_DATABASE_URL: target.href,
      CONFIRM_ISOLATED_TEST_DB: 'true',
      VERIFY_QA_SYSTEM_IDENTIFIER: id,
      ACCOUNT_SECRET_KEY: crypto.randomBytes(32).toString('hex'),
    };
    delete env.CSRF_SECRET;
    if (premigrated.has(files[i])) {
      const pre = new pg.Pool({ connectionString: target.href });
      try {
        const { runMigrations, loadMigrationFiles } = await import(
          '../../dist/packages/database/src/migrator.js'
        );
        await runMigrations(
          pre,
          loadMigrationFiles('packages/database/src/migrations'),
        );
      } finally {
        await pre.end();
      }
    }
    const run = spawnSync(process.execPath, ['--test', files[i]], {
      env,
      encoding: 'utf8',
      timeout: 240000,
    });
    const log = ((run.stdout ?? '') + (run.stderr ?? ''))
      .replaceAll(env.ACCOUNT_SECRET_KEY, '[REDACTED]')
      .replaceAll(process.env.CI_DATABASE_PASSWORD, '[REDACTED]')
      .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/g, '[DATABASE_URL_REDACTED]');
    process.stdout.write(log);
    if (run.error || run.status !== 0 || /^# skipped [1-9]/m.test(log))
      throw new Error(`Selected CI suite failed/skipped: ${files[i]}`);
  }
  const check = new pg.Pool({ connectionString: baseline.href });
  try {
    if (
      Number(
        (
          await check.query(
            "SELECT count(*) FROM pg_tables WHERE schemaname='public'",
          )
        ).rows[0].count,
      ) !== 0
    )
      throw new Error('Sentinel writes detected');
  } finally {
    await check.end();
  }
} finally {
  await admin.end();
}
