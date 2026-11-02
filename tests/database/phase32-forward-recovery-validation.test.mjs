import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const ML_TEST_ROOT = 'C:\\ML-Test';
const PG_BIN_DIR = path.join(ML_TEST_ROOT, 'pgsql', 'bin');
const PG_DATA_DIR = path.join(ML_TEST_ROOT, 'pgdata');
const ADMIN_PW_FILE = path.join(ML_TEST_ROOT, 'secrets', 'admin.pw');

const invokeScriptPath = path.join(
  rootDir,
  'scripts',
  'deployment',
  'Invoke-OwnerReleaseToWeb.ps1',
);
const controllerScriptPath = path.join(
  rootDir,
  'scripts',
  'deployment',
  'Deploy-SemiAutoWindows.ps1',
);

function sha256Hex(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

function readJsonNoBom(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

async function ensureIsolatedPostgres55433() {
  const pgIsReady = path.join(PG_BIN_DIR, 'pg_isready.exe');
  const check = spawnSync(pgIsReady, ['-h', '127.0.0.1', '-p', '55433'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (check.status === 0) {
    return { startedByTest: false };
  }
  const postgresExe = path.join(PG_BIN_DIR, 'postgres.exe');
  const child = spawn(postgresExe, ['-D', PG_DATA_DIR], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const ready = spawnSync(pgIsReady, ['-h', '127.0.0.1', '-p', '55433'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    if (ready.status === 0) {
      return { startedByTest: true };
    }
  }
  throw new Error('Failed to start isolated PostgreSQL on 127.0.0.1:55433');
}

function stopIsolatedPostgres55433() {
  const pgCtl = path.join(PG_BIN_DIR, 'pg_ctl.exe');
  if (fs.existsSync(pgCtl)) {
    spawnSync(pgCtl, ['-D', PG_DATA_DIR, 'stop', '-m', 'fast'], {
      encoding: 'utf8',
      timeout: 10000,
    });
  }
}

function runPsFile(filePath, args = [], envOverrides = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        filePath,
        ...args,
      ],
      {
        cwd: rootDir,
        env: { ...process.env, ...envOverrides },
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

test('Phase 32 Final Recovery Safety Validation: Post-Migration 0032 Cutover Failure, Blocked Incompatible Rollback, Watermark/Audit Sync, and Safe Forward Recovery on Isolated PostgreSQL :55433', async (t) => {
  if (process.platform !== 'win32') {
    t.diagnostic('Windows PowerShell + isolated PostgreSQL :55433 test only');
    return;
  }

  const pgState = await ensureIsolatedPostgres55433();
  const adminPass = fs.readFileSync(ADMIN_PW_FILE, 'utf8').trim();
  const testDbName = `ml_p32_fwd_rec_${Date.now()}`;
  const adminUrl = `postgresql://ml_test_admin:${encodeURIComponent(adminPass)}@127.0.0.1:55433/postgres`;
  const testDbUrl = `postgresql://ml_test_admin:${encodeURIComponent(adminPass)}@127.0.0.1:55433/${testDbName}`;

  const adminClient = new pg.Client({ connectionString: adminUrl });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE "${testDbName}"`);
  await adminClient.end();

  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ml-p32-fwd-recovery-'),
  );

  // Mock GitHub Actions API + Mock App Smoke Server
  const runId = '41397721534';
  let targetSha = '';

  const mockServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/health') {
      res.end(
        JSON.stringify({
          success: true,
          data: { status: 'pass', sha: targetSha, version: '0.7.2' },
        }),
      );
      return;
    }
    if (req.url === '/api/v1/ready') {
      res.end(JSON.stringify({ success: true, data: { status: 'ready' } }));
      return;
    }
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><body>Management Lite</body></html>');
      return;
    }
    if (req.url?.includes(`/actions/runs/${runId}/jobs`)) {
      res.end(
        JSON.stringify({
          total_count: 2,
          jobs: [
            {
              id: 1,
              name: 'Windows P0 Security Gate',
              status: 'completed',
              conclusion: 'success',
            },
            {
              id: 2,
              name: 'ci',
              status: 'completed',
              conclusion: 'success',
            },
          ],
        }),
      );
      return;
    }
    if (
      req.url?.includes(`/actions/runs/${runId}`) ||
      req.url?.includes('/actions/runs?head_sha=')
    ) {
      const runObj = {
        id: Number(runId),
        run_attempt: 1,
        name: 'Management Lite Foundation CI',
        path: '.github/workflows/foundation.yml',
        head_branch: 'main',
        head_sha: targetSha,
        status: 'completed',
        conclusion: 'success',
        event: 'push',
        html_url: `https://github.com/truhoaiphuong03/management-lite/actions/runs/${runId}`,
      };
      if (req.url?.includes('/actions/runs?head_sha=')) {
        res.end(JSON.stringify({ total_count: 1, workflow_runs: [runObj] }));
      } else {
        res.end(JSON.stringify(runObj));
      }
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'Not Found' }));
  });

  await new Promise((r) => mockServer.listen(0, '127.0.0.1', r));
  const mockPort = mockServer.address().port;
  const mockBaseUrl = `http://127.0.0.1:${mockPort}`;

  t.after(async () => {
    await new Promise((r) => mockServer.close(r));
    try {
      spawnSync('icacls.exe', [sandboxRoot, '/reset', '/T', '/C', '/Q'], {
        stdio: 'ignore',
      });
    } catch {
      // ignore cleanup acl error
    }
    fs.rmSync(sandboxRoot, { recursive: true, force: true });

    const dropClient = new pg.Client({ connectionString: adminUrl });
    await dropClient.connect();
    await dropClient.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [testDbName],
    );
    await dropClient.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
    await dropClient.end();

    if (pgState.startedByTest || true) {
      stopIsolatedPostgres55433();
    }
  });

  // 1. Apply migrations 0001..0031 (31 migrations) on isolated :55433 DB and seed fake employees
  const { loadMigrationFiles, runMigrations } = await import(
    pathToFileURL(
      path.join(rootDir, 'dist', 'packages', 'database', 'src', 'migrator.js'),
    ).href
  );
  const { createDatabasePool, closeDatabasePool } = await import(
    pathToFileURL(
      path.join(rootDir, 'dist', 'packages', 'database', 'src', 'pool.js'),
    ).href
  );
  const migrationsSrcDir = path.join(
    rootDir,
    'packages',
    'database',
    'src',
    'migrations',
  );
  const allCatalogMigs = loadMigrationFiles(migrationsSrcDir);
  assert.ok(allCatalogMigs.length >= 32);
  const all32Migs = allCatalogMigs.slice(0, 32);
  const first31Migs = all32Migs.slice(0, 31);

  const schemaId31 = sha256Hex(
    JSON.stringify(
      first31Migs.map((m) => ({ id: m.id, checksum: m.checksum })),
    ),
  );
  const schemaId32 = sha256Hex(
    JSON.stringify(all32Migs.map((m) => ({ id: m.id, checksum: m.checksum }))),
  );

  const dbPool = createDatabasePool({
    connectionString: testDbUrl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  try {
    const mig31Res = await runMigrations(dbPool, first31Migs);
    assert.equal(mig31Res.appliedCount, 31);

    // Seed fake workspace & 3 fake employees (NV001, NV002, ADM01)
    const wsRes = await dbPool.query(
      `INSERT INTO workspaces (name, status) VALUES ('Fake Test Workspace', 'active') RETURNING id`,
    );
    const wsId = wsRes.rows[0].id;
    for (const [code, name, role] of [
      ['NV001', 'Fake Staff One', 'staff'],
      ['NV002', 'Fake Staff Two', 'staff'],
      ['ADM01', 'Fake Admin One', 'owner'],
    ]) {
      const uId = crypto.randomUUID();
      const empId = crypto.randomUUID();
      await dbPool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status)
         VALUES ($1, $2, $3, 'active')`,
        [uId, code.toLowerCase(), `${code.toLowerCase()}@example.test`],
      );
      await dbPool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')`,
        [wsId, uId, role],
      );
      await dbPool.query(
        `INSERT INTO employees (
           id, workspace_id, user_id, employee_code, full_name, employment_status,
           is_payroll_eligible, position_title
         ) VALUES ($1, $2, $3, $4, $5, 'active', true, 'Media')`,
        [empId, wsId, uId, code, name],
      );
    }
  } finally {
    await closeDatabasePool(dbPool);
  }

  // 2. Build sandbox server layout + Git repo in TargetDir with Commit 1 (31 migs) & Commit 2 (32 migs)
  const gateDir = path.join(sandboxRoot, 'config', 'release-gate');
  const controllersDir = path.join(gateDir, 'controllers');
  const secretsDir = path.join(sandboxRoot, 'config', 'test-secrets');
  const sandboxDbDir = path.join(sandboxRoot, 'config', 'sandbox-db');
  const reportsDir = path.join(sandboxRoot, 'reports');
  const logsDir = path.join(sandboxRoot, 'logs');
  const backupsDir = path.join(sandboxRoot, 'backups');
  const targetDir = path.join(sandboxRoot, 'apps', 'management-lite');
  const artifactsDir = path.join(sandboxRoot, 'artifacts-input');

  for (const d of [
    gateDir,
    controllersDir,
    secretsDir,
    sandboxDbDir,
    reportsDir,
    logsDir,
    backupsDir,
    targetDir,
    artifactsDir,
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // Copy real repo controller into sandbox controllersDir
  const sandboxControllerPath = path.join(
    controllersDir,
    'Deploy-SemiAutoWindows.ps1',
  );
  fs.copyFileSync(controllerScriptPath, sandboxControllerPath);
  const controllerSha = sha256Hex(fs.readFileSync(sandboxControllerPath));

  // Create isolated pgpass.conf for :55433
  const pgPassPath = path.join(sandboxDbDir, 'pgpass.conf');
  fs.writeFileSync(
    pgPassPath,
    `127.0.0.1:55433:*:ml_test_admin:${adminPass}\n`,
    'utf8',
  );

  // Create fake api.env for DPAPI backup test
  fs.writeFileSync(
    path.join(secretsDir, 'api.env'),
    'NODE_ENV=test\nACCOUNT_SECRET_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nSTORAGE_DRIVE_ENCRYPTION_KEY_HEX=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n',
    'utf8',
  );

  // Initialize Git repo in targetDir with Commit 1 (v0.7.0, 31 migrations) and Commit 2 (v0.7.2, 32 migrations)
  execFileSync('git', ['init'], { cwd: targetDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.test'], {
    cwd: targetDir,
    stdio: 'ignore',
  });
  execFileSync('git', ['config', 'user.name', 'Sandbox Test'], {
    cwd: targetDir,
    stdio: 'ignore',
  });

  const migTargetDir = path.join(
    targetDir,
    'packages',
    'database',
    'src',
    'migrations',
  );
  fs.mkdirSync(migTargetDir, { recursive: true });
  for (const m of first31Migs) {
    fs.copyFileSync(
      path.join(migrationsSrcDir, `${m.id}.sql`),
      path.join(migTargetDir, `${m.id}.sql`),
    );
  }
  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify({ name: 'management-lite', version: '0.7.0' }, null, 2),
    'utf8',
  );
  execFileSync('git', ['add', '-A'], { cwd: targetDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'v0.7.0 baseline (31 migrations)'], {
    cwd: targetDir,
    stdio: 'ignore',
  });
  const prevSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: targetDir,
    encoding: 'utf8',
  }).trim();

  // Add 0032 migration to create Commit 2 (targetSha)
  const mig32 = all32Migs[31];
  fs.copyFileSync(
    path.join(migrationsSrcDir, `${mig32.id}.sql`),
    path.join(migTargetDir, `${mig32.id}.sql`),
  );
  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify({ name: 'management-lite', version: '0.7.2' }, null, 2),
    'utf8',
  );
  execFileSync('git', ['add', '-A'], { cwd: targetDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'v0.7.2 target (32 migrations)'], {
    cwd: targetDir,
    stdio: 'ignore',
  });
  targetSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: targetDir,
    encoding: 'utf8',
  }).trim();

  // Checkout prevSha as initial live state
  execFileSync('git', ['checkout', '-f', prevSha], {
    cwd: targetDir,
    stdio: 'ignore',
  });

  // Populate initial v0.7.0 runtime files in targetDir/dist and targetDir/apps/web/dist
  fs.mkdirSync(path.join(targetDir, 'dist', 'apps', 'api', 'src', 'auth'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(targetDir, 'apps', 'web', 'dist'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(targetDir, 'dist', 'apps', 'api', 'src', 'main.js'),
    '// v0.7.0 main\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(targetDir, 'dist', 'apps', 'api', 'src', 'auth', 'service.js'),
    '// remember_me getRememberMeMaxAgeSeconds\n'.repeat(5),
    'utf8',
  );
  fs.writeFileSync(
    path.join(targetDir, 'dist', 'release-version.json'),
    JSON.stringify(
      {
        version: '0.7.0',
        sha: prevSha,
        schemaIdentity: schemaId31,
        migrationCount: 31,
        maxMigrationId: first31Migs[30].id,
        authPolicyVersion: 'auth-remember-01',
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    path.join(targetDir, 'apps', 'web', 'dist', 'index.html'),
    '<!doctype html><html><body>v0.7.0</body></html>',
    'utf8',
  );
  fs.writeFileSync(
    path.join(targetDir, 'apps', 'web', 'dist', 'release-version.json'),
    JSON.stringify({ version: '0.7.0', sha: prevSha }, null, 2),
    'utf8',
  );

  // Create junction to workspace node_modules in targetDir so staged migrator can import 'pg'
  fs.symlinkSync(
    path.join(rootDir, 'node_modules'),
    path.join(targetDir, 'node_modules'),
    'junction',
  );

  // 3. Build genuine targetSha release bundle (.tar.gz + .sha256 + .provenance.json + ci-run-receipt)
  const bundleBuildDir = path.join(sandboxRoot, 'bundle-build');
  fs.mkdirSync(
    path.join(bundleBuildDir, 'dist', 'apps', 'api', 'src', 'auth'),
    {
      recursive: true,
    },
  );
  fs.mkdirSync(
    path.join(
      bundleBuildDir,
      'dist',
      'packages',
      'database',
      'src',
      'migrations',
    ),
    { recursive: true },
  );
  fs.mkdirSync(path.join(bundleBuildDir, 'web'), { recursive: true });
  fs.mkdirSync(path.join(bundleBuildDir, 'migrations'), { recursive: true });

  // Copy real compiled database migrator & pool into bundle
  fs.cpSync(
    path.join(rootDir, 'dist', 'packages', 'database', 'src'),
    path.join(bundleBuildDir, 'dist', 'packages', 'database', 'src'),
    { recursive: true },
  );
  fs.writeFileSync(
    path.join(
      bundleBuildDir,
      'dist',
      'packages',
      'database',
      'src',
      'migrations',
      'catalog.js',
    ),
    `export const EMBEDDED_MIGRATIONS = ${JSON.stringify(all32Migs, null, 2)};\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(bundleBuildDir, 'dist', 'apps', 'api', 'src', 'main.js'),
    '// v0.7.2 main\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(
      bundleBuildDir,
      'dist',
      'apps',
      'api',
      'src',
      'auth',
      'service.js',
    ),
    '// remember_me getRememberMeMaxAgeSeconds\n'.repeat(5),
    'utf8',
  );
  fs.writeFileSync(
    path.join(bundleBuildDir, 'dist', 'release-version.json'),
    JSON.stringify(
      {
        version: '0.7.2',
        sha: targetSha,
        schemaIdentity: schemaId32,
        migrationCount: 32,
        maxMigrationId: '0032_employee_sub_permissions',
        authPolicyVersion: 'auth-remember-01',
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    path.join(bundleBuildDir, 'web', 'index.html'),
    '<!doctype html><html><body>v0.7.2</body></html>',
    'utf8',
  );
  fs.writeFileSync(
    path.join(bundleBuildDir, 'web', 'release-version.json'),
    JSON.stringify({ version: '0.7.2', sha: targetSha }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(bundleBuildDir, 'package.json'),
    JSON.stringify(
      { name: 'management-lite', version: '0.7.2', type: 'module' },
      null,
      2,
    ),
    'utf8',
  );

  for (const m of all32Migs) {
    fs.copyFileSync(
      path.join(migrationsSrcDir, `${m.id}.sql`),
      path.join(bundleBuildDir, 'migrations', `${m.id}.sql`),
    );
  }

  const bundleFiles = [];
  const collectFiles = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectFiles(full);
      else {
        const rel = path.relative(bundleBuildDir, full).replace(/\\/g, '/');
        bundleFiles.push({
          path: rel,
          sha256: sha256Hex(fs.readFileSync(full)),
        });
      }
    }
  };
  collectFiles(bundleBuildDir);

  const manifestObj = {
    type: 'full',
    version: '0.7.2',
    sha: targetSha,
    schemaIdentity: schemaId32,
    migrations: all32Migs.map((m) => ({ id: m.id, checksum: m.checksum })),
    files: bundleFiles,
  };
  fs.writeFileSync(
    path.join(bundleBuildDir, 'manifest.json'),
    JSON.stringify(manifestObj, null, 2),
    'utf8',
  );

  const tarPath = path.join(
    artifactsDir,
    `management-lite-full-${targetSha}.tar.gz`,
  );
  execFileSync('tar', ['-czf', tarPath, '-C', bundleBuildDir, '.']);
  const artifactSha = sha256Hex(fs.readFileSync(tarPath));

  fs.writeFileSync(
    `${tarPath}.sha256`,
    `${artifactSha}  management-lite-full-${targetSha}.tar.gz\n`,
    'utf8',
  );
  fs.writeFileSync(
    `${tarPath}.provenance.json`,
    JSON.stringify(
      {
        schemaVersion: 2,
        commitSha: targetSha,
        sha256: artifactSha,
        migrationCount: 32,
        maxMigrationId: '0032_employee_sub_permissions',
        schemaIdentity: schemaId32,
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    path.join(artifactsDir, `ci-run-receipt-${targetSha}.json`),
    JSON.stringify(
      {
        run_id: runId,
        run_attempt: 1,
        workflow_path: '.github/workflows/foundation.yml',
        head_branch: 'main',
        head_sha: targetSha,
        event: 'push',
        repository: 'truhoaiphuong03/management-lite',
        artifact_sha256: artifactSha,
        schema_sha256: schemaId32,
        status: 'completed',
        conclusion: 'success',
        generated_at_utc: '2026-11-02T06:09:40.930Z',
        workflow_run_url: `https://github.com/truhoaiphuong03/management-lite/actions/runs/${runId}`,
      },
      null,
      2,
    ),
    'utf8',
  );

  // 4. Initialize release-gate state (sequence = 1, REVOKED_AWAITING_OWNER_KEY_ENROLLMENT)
  const policyPath = path.join(gateDir, 'release-gate-policy.json');
  const approvalJsonPath = path.join(gateDir, 'approved-release.json');
  const auditLogPath = path.join(gateDir, 'approval-audit.jsonl');
  const watermarkPath = path.join(reportsDir, 'approval-watermark.json');
  const stateJournalPath = path.join(reportsDir, 'deployment-state.json');
  const currentShaPath = path.join(reportsDir, 'current-live-sha.txt');

  fs.writeFileSync(currentShaPath, `${prevSha}\n`, 'utf8');
  fs.writeFileSync(
    policyPath,
    JSON.stringify(
      {
        version: 1,
        repository: 'truhoaiphuong03/management-lite',
        allowed_approvers: ['Owner', 'truhoaiphuong03'],
        require_independent_ci_receipt: true,
        require_github_api_verification: true,
        github_api_base_url: mockBaseUrl,
        allowed_ci_events: ['workflow_dispatch', 'push'],
        allowed_workflow_paths: [
          '.github/workflows/deploy.yml',
          '.github/workflows/foundation.yml',
        ],
        allowed_source_branch: 'main',
        key_status: 'REVOKED_AWAITING_OWNER_KEY_ENROLLMENT',
        revoked_public_key_sha256s: [
          '2e92bb4a96b8f60da691d309399b494b20bdbe60aa3b39c2add7313e0441931e',
        ],
        trusted_public_key_sha256: 'REVOKED_AWAITING_OWNER_KEY',
        trusted_public_key_pem: '',
      },
      null,
      2,
    ),
    'utf8',
  );

  const seq1Hash = sha256Hex('seq1-genesis-entry');
  fs.writeFileSync(
    auditLogPath,
    JSON.stringify({
      timestamp_utc: '2026-10-15T14:50:30.244Z',
      sequence: 1,
      approval_mode: 'SINGLE_SHA',
      approved_sha: prevSha,
      workflow_path: '.github/workflows/deploy.yml',
      source_branch: 'main',
      approved_by: 'Owner',
      windows_principal: 'SANDBOX\\TEST',
      allow_migration: true,
      prev_audit_hash: '0'.repeat(64),
      entry_hash: seq1Hash,
    }) + '\n',
    'utf8',
  );
  fs.writeFileSync(
    watermarkPath,
    JSON.stringify(
      {
        updated_at_utc: '2026-10-15T14:50:52.659Z',
        last_sha: prevSha,
        last_sequence: 1,
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    stateJournalPath,
    JSON.stringify(
      {
        previous_sha: '0'.repeat(40),
        status: 'COMPLETED',
        sequence: 1,
        completed_at_utc: '2026-10-15T14:51:00.576Z',
        sha: prevSha,
      },
      null,
      2,
    ),
    'utf8',
  );

  const fakeOwnerPassphrase = 'FakeOwnerTestPassphrase#2026!';
  const commonInvokeArgs = [
    '-SandboxMode',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    targetSha,
    '-ExpectedControllerSha256',
    controllerSha,
    '-GitHubApiBaseUrl',
    mockBaseUrl,
    '-SandboxDbPort',
    '55433',
    '-SandboxDbUser',
    'ml_test_admin',
    '-SandboxDbTarget',
    testDbName,
    '-SandboxPgPassFilePath',
    pgPassPath,
    '-SandboxPgBinDir',
    PG_BIN_DIR,
    '-SandboxHealthUrl',
    `${mockBaseUrl}/api/v1/health`,
    '-SandboxReadyUrl',
    `${mockBaseUrl}/api/v1/ready`,
    '-SandboxWebUrl',
    `${mockBaseUrl}/`,
  ];

  // =========================================================================
  // TASK 1: Run Migration 0032 (Succeeds) + Simulate Runtime Cutover Failure
  // =========================================================================
  const cutoverFailRes = await runPsFile(
    invokeScriptPath,
    [
      ...commonInvokeArgs,
      '-EnrollNewPublicKey',
      '-SimulateCutoverHealthFailure',
    ],
    {
      SANDBOX_TEST_OWNER_PASSPHRASE: fakeOwnerPassphrase,
      CONFIRM_ISOLATED_TEST_DB: 'true',
    },
  );

  assert.notEqual(
    cutoverFailRes.status,
    0,
    'Simulated post-migration cutover failure must exit non-zero',
  );
  assert.match(
    cutoverFailRes.stdout + cutoverFailRes.stderr,
    /STOP_NO_GO_INCOMPATIBLE_ROLLBACK/,
    'Controller must block code-only rollback when DB has 32 migrations vs 31 in snapshot',
  );
  assert.match(
    cutoverFailRes.stdout + cutoverFailRes.stderr,
    /\[AUDIT-PRESERVED\]/,
    'Invoke-OwnerReleaseToWeb.ps1 must preserve sequence=2 in approval-audit.jsonl once watermark advanced',
  );

  // Verify DB on :55433 has 32 migrations applied and fake employee data intact
  const verifyPool = new pg.Pool({ connectionString: testDbUrl, max: 2 });
  try {
    const migRows = await verifyPool.query(
      'SELECT id, checksum FROM schema_migrations ORDER BY id ASC',
    );
    assert.equal(
      migRows.rows.length,
      32,
      'DB must have 32 migrations after pre-cutover migration',
    );
    assert.equal(migRows.rows[31].id, '0032_employee_sub_permissions');

    const empRows = await verifyPool.query(
      'SELECT employee_code, sub_role, sub_permissions FROM employees ORDER BY employee_code ASC',
    );
    assert.equal(empRows.rows.length, 3, 'All 3 fake employees must be intact');
    assert.deepEqual(
      empRows.rows.map((r) => r.employee_code),
      ['ADM01', 'NV001', 'NV002'],
    );
  } finally {
    await verifyPool.end();
  }

  // Verify deployment-state.json, approval-watermark.json, and approval-audit.jsonl
  const journalAfterFail = readJsonNoBom(stateJournalPath);
  assert.equal(journalAfterFail.status, 'STOP_NO_GO_INCOMPATIBLE_ROLLBACK');
  assert.equal(journalAfterFail.db_migration_count, 32);
  assert.equal(journalAfterFail.snapshot_migration_count, 31);
  assert.equal(journalAfterFail.db_schema_identity, schemaId32);
  assert.equal(journalAfterFail.snapshot_schema_identity, schemaId31);

  const wmAfterFail = readJsonNoBom(watermarkPath);
  assert.equal(
    wmAfterFail.last_sequence,
    2,
    'Watermark must be at sequence 2 after pre-cutover migration',
  );
  assert.equal(wmAfterFail.last_sha, targetSha);

  const auditLinesAfterFail = fs
    .readFileSync(auditLogPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .map((l) => JSON.parse(l.replace(/^\uFEFF/, '')));
  assert.equal(
    auditLinesAfterFail.length,
    2,
    'approval-audit.jsonl must have 2 entries synchronized with watermark sequence=2',
  );
  assert.equal(auditLinesAfterFail[0].sequence, 1);
  assert.equal(auditLinesAfterFail[1].sequence, 2);
  assert.equal(auditLinesAfterFail[1].prev_audit_hash, seq1Hash);

  // Verify current-live-sha.txt was NOT switched to targetSha on failed cutover
  assert.equal(fs.readFileSync(currentShaPath, 'utf8').trim(), prevSha);

  // =========================================================================
  // TASK 1 & 2: Verify Blocked Rollback, Anti-Replay, and Security Guards
  // =========================================================================

  // Guard A: -RecoverInterrupted is blocked when state is STOP_NO_GO_INCOMPATIBLE_ROLLBACK
  const recoverInterruptedRes = await runPsFile(
    controllerScriptPath,
    [
      '-CommitSha',
      targetSha,
      '-RecoverInterrupted',
      '-SandboxMode',
      '-ServerRoot',
      sandboxRoot,
      '-PolicyPath',
      policyPath,
      '-ApprovalManifestPath',
      approvalJsonPath,
      '-DbPort',
      '55433',
      '-DbUser',
      'ml_test_admin',
      '-DbTarget',
      testDbName,
      '-PgPassFilePath',
      pgPassPath,
      '-PgBinDir',
      PG_BIN_DIR,
    ],
    { CONFIRM_ISOLATED_TEST_DB: 'true' },
  );
  assert.notEqual(recoverInterruptedRes.status, 0);
  assert.match(
    recoverInterruptedRes.stdout + recoverInterruptedRes.stderr,
    /STOP_NO_GO_INCOMPATIBLE_ROLLBACK/,
  );

  // Guard B: Replaying sequence=2 manifest directly on controller with -Force is blocked by Anti-Replay Watermark
  const replaySeq2Res = await runPsFile(
    controllerScriptPath,
    [
      '-CommitSha',
      targetSha,
      '-ArtifactPath',
      tarPath,
      '-ArtifactSha256',
      artifactSha,
      '-CiRunId',
      runId,
      '-Force',
      '-RunMigrations',
      '-SandboxMode',
      '-ServerRoot',
      sandboxRoot,
      '-PolicyPath',
      policyPath,
      '-ApprovalManifestPath',
      approvalJsonPath,
      '-GitHubApiBaseUrl',
      mockBaseUrl,
      '-DbPort',
      '55433',
      '-DbUser',
      'ml_test_admin',
      '-DbTarget',
      testDbName,
      '-PgPassFilePath',
      pgPassPath,
      '-PgBinDir',
      PG_BIN_DIR,
    ],
    { CONFIRM_ISOLATED_TEST_DB: 'true' },
  );
  assert.notEqual(replaySeq2Res.status, 0);
  assert.match(
    replaySeq2Res.stdout + replaySeq2Res.stderr,
    /Approval replay detected \(sequence 2 <= watermark 2\)/,
  );

  // Guard C: Calling Invoke-OwnerReleaseToWeb.ps1 WITHOUT -Force is blocked before signing
  const noForceRes = await runPsFile(invokeScriptPath, commonInvokeArgs, {
    SANDBOX_TEST_OWNER_PASSPHRASE: fakeOwnerPassphrase,
    CONFIRM_ISOLATED_TEST_DB: 'true',
  });
  assert.notEqual(noForceRes.status, 0);
  assert.match(
    noForceRes.stdout + noForceRes.stderr,
    /REJECTED_STOP_NO_GO_REQUIRES_FORWARD_RECOVERY/,
  );

  // Guard D: Calling Invoke-OwnerReleaseToWeb.ps1 -Force with WRONG passphrase is blocked and rolls back sequence=3
  const wrongPassForwardRes = await runPsFile(
    invokeScriptPath,
    [...commonInvokeArgs, '-Force'],
    {
      SANDBOX_TEST_OWNER_PASSPHRASE: 'WrongFakePassphrase#9999!',
      CONFIRM_ISOLATED_TEST_DB: 'true',
    },
  );
  assert.notEqual(wrongPassForwardRes.status, 0);
  assert.match(
    wrongPassForwardRes.stdout + wrongPassForwardRes.stderr,
    /REJECTED_KEY_MISMATCH/,
  );
  assert.equal(
    fs.readFileSync(auditLogPath, 'utf8').trim().split(/\r?\n/).length,
    2,
    'Failed signing with wrong passphrase must roll back approval-audit.jsonl to 2 entries',
  );

  // Guard E: Manual watermark tampering is detected and rejected fail-closed
  const validWatermarkRaw = fs.readFileSync(watermarkPath, 'utf8');
  fs.writeFileSync(
    watermarkPath,
    JSON.stringify({ ...wmAfterFail, last_sequence: 1 }, null, 2),
    'utf8',
  );
  const tamperedWmRes = await runPsFile(
    invokeScriptPath,
    [...commonInvokeArgs, '-Force'],
    {
      SANDBOX_TEST_OWNER_PASSPHRASE: fakeOwnerPassphrase,
      CONFIRM_ISOLATED_TEST_DB: 'true',
    },
  );
  assert.notEqual(tamperedWmRes.status, 0);
  assert.match(
    tamperedWmRes.stdout + tamperedWmRes.stderr,
    /REJECTED_WATERMARK_AUDIT_DESYNC/,
    'Manual watermark tampering must be rejected fail-closed',
  );
  fs.writeFileSync(watermarkPath, validWatermarkRaw, 'utf8');

  // Guard F: Manual audit log tampering (forging/corrupting entry_hash on entry[0] OR tail entry[1]) is rejected fail-closed
  spawnSync('icacls.exe', [gateDir, '/reset', '/T', '/C', '/Q'], {
    stdio: 'ignore',
  });
  const validAuditRaw = fs.readFileSync(auditLogPath, 'utf8');
  const forgedEntry1 = {
    ...auditLinesAfterFail[0],
    entry_hash: 'f'.repeat(64),
  };
  fs.writeFileSync(
    auditLogPath,
    `${JSON.stringify(forgedEntry1)}\n${JSON.stringify(auditLinesAfterFail[1])}\n`,
    'utf8',
  );
  const tamperedAuditRes = await runPsFile(
    invokeScriptPath,
    [...commonInvokeArgs, '-Force'],
    {
      SANDBOX_TEST_OWNER_PASSPHRASE: fakeOwnerPassphrase,
      CONFIRM_ISOLATED_TEST_DB: 'true',
    },
  );
  assert.notEqual(tamperedAuditRes.status, 0);
  assert.match(
    tamperedAuditRes.stdout + tamperedAuditRes.stderr,
    /AUDIT_CHAIN_LINK_BROKEN/,
    'Manual audit log tampering on entry[0] must be rejected fail-closed with AUDIT_CHAIN_LINK_BROKEN',
  );

  // Also test forging the tail entry (entry[1]) while keeping entry[1].prev_audit_hash valid
  spawnSync('icacls.exe', [gateDir, '/reset', '/T', '/C', '/Q'], {
    stdio: 'ignore',
  });
  const forgedEntry2 = {
    ...auditLinesAfterFail[1],
    entry_hash: 'e'.repeat(64),
  };
  fs.writeFileSync(
    auditLogPath,
    `${JSON.stringify(auditLinesAfterFail[0])}\n${JSON.stringify(forgedEntry2)}\n`,
    'utf8',
  );
  const tamperedTailAuditRes = await runPsFile(
    invokeScriptPath,
    [...commonInvokeArgs, '-Force'],
    {
      SANDBOX_TEST_OWNER_PASSPHRASE: fakeOwnerPassphrase,
      CONFIRM_ISOLATED_TEST_DB: 'true',
    },
  );
  assert.notEqual(tamperedTailAuditRes.status, 0);
  assert.match(
    tamperedTailAuditRes.stdout + tamperedTailAuditRes.stderr,
    /AUDIT_CHAIN_LINK_BROKEN/,
    'Manual audit log tampering on tail entry[1] must be rejected fail-closed with AUDIT_CHAIN_LINK_BROKEN',
  );

  spawnSync('icacls.exe', [gateDir, '/reset', '/T', '/C', '/Q'], {
    stdio: 'ignore',
  });
  fs.writeFileSync(auditLogPath, validAuditRaw, 'utf8');

  // =========================================================================
  // TASK 2: Execute Legitimate Forward Recovery (sequence = 3, -Force, Zero Manual Edits)
  // =========================================================================
  const forwardRecoveryRes = await runPsFile(
    invokeScriptPath,
    [...commonInvokeArgs, '-Force'],
    {
      SANDBOX_TEST_OWNER_PASSPHRASE: fakeOwnerPassphrase,
      CONFIRM_ISOLATED_TEST_DB: 'true',
    },
  );
  assert.equal(
    forwardRecoveryRes.status,
    0,
    `Forward recovery must succeed cleanly:\n${forwardRecoveryRes.stdout}\n${forwardRecoveryRes.stderr}`,
  );
  assert.match(forwardRecoveryRes.stdout, /DEPLOY SUCCESSFUL/);

  // Verify final watermark (sequence = 3), audit chain (1 -> 2 -> 3), and COMPLETED journal
  const wmFinal = readJsonNoBom(watermarkPath);
  assert.equal(wmFinal.last_sequence, 3);
  assert.equal(wmFinal.last_sha, targetSha);

  const auditLinesFinal = fs
    .readFileSync(auditLogPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .map((l) => JSON.parse(l.replace(/^\uFEFF/, '')));
  assert.equal(
    auditLinesFinal.length,
    3,
    'approval-audit.jsonl must have 3 unbroken entries (sequence 1 -> 2 -> 3)',
  );
  assert.equal(auditLinesFinal[0].sequence, 1);
  assert.equal(auditLinesFinal[1].sequence, 2);
  assert.equal(auditLinesFinal[2].sequence, 3);
  assert.equal(
    auditLinesFinal[1].prev_audit_hash,
    auditLinesFinal[0].entry_hash,
  );
  assert.equal(
    auditLinesFinal[2].prev_audit_hash,
    auditLinesFinal[1].entry_hash,
  );

  const journalFinal = readJsonNoBom(stateJournalPath);
  assert.equal(journalFinal.status, 'COMPLETED');
  assert.equal(journalFinal.sequence, 3);
  assert.equal(journalFinal.sha, targetSha);

  // Verify live runtime pointers & release-version.json files in targetDir
  assert.equal(
    fs
      .readFileSync(currentShaPath, 'utf8')
      .replace(/^\uFEFF/, '')
      .trim(),
    targetSha,
  );
  const finalApiVer = readJsonNoBom(
    path.join(targetDir, 'dist', 'release-version.json'),
  );
  const finalWebVer = readJsonNoBom(
    path.join(targetDir, 'apps', 'web', 'dist', 'release-version.json'),
  );
  assert.equal(finalApiVer.sha, targetSha);
  assert.equal(finalApiVer.version, '0.7.2');
  assert.equal(finalWebVer.sha, targetSha);
  assert.equal(finalWebVer.version, '0.7.2');
});
