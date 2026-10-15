import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const compiled = (rel) =>
  pathToFileURL(path.resolve(repoRoot, 'dist', rel)).href;

const approveScript = path.join(
  repoRoot,
  'scripts/deployment/Approve-ReleaseSha.ps1',
);
const deployScript = path.join(
  repoRoot,
  'scripts/deployment/Deploy-SemiAutoWindows.ps1',
);
const packagerScript = path.join(
  repoRoot,
  'scripts/deployment/package-release-bundle.mjs',
);

async function runPowershell(scriptPath, args = []) {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        ...args,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return stdout;
  } catch (err) {
    const combined = `${err.message || ''}\n${err.stdout || ''}\n${err.stderr || ''}`;
    const wrapped = new Error(combined);
    wrapped.cause = err;
    throw wrapped;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .toLowerCase();
}

test('AUTH-REMEMBER-01 Cutover, Schema Preflight, Rollback Compatibility, STOP/NO-GO & Session Security Suite (10 Scenarios)', async (t) => {
  if (!process.env.TEST_DATABASE_URL || !process.env.CONFIRM_ISOLATED_TEST_DB) {
    t.skip('Explicitly confirmed sandbox database required');
    return;
  }

  const { loadTestDatabaseConfig } = await import(
    compiled('packages/database/src/config.js')
  );
  const { createDatabasePool, closeDatabasePool } = await import(
    compiled('packages/database/src/pool.js')
  );
  const { loadMigrationFiles, runMigrations } = await import(
    compiled('packages/database/src/migrator.js')
  );
  const { AuthService } = await import(
    compiled('apps/api/src/auth/service.js')
  );
  const { hashToken } = await import(
    compiled('packages/security/src/tokens.js')
  );

  const baseConfig = loadTestDatabaseConfig();
  const adminPool = createDatabasePool(baseConfig);

  const qaSuffix = crypto.randomBytes(4).toString('hex');
  const qaDbName = `management_lite_cutover_qa_${qaSuffix}_test`;
  const parsedBaseUrl = new URL(baseConfig.connectionString);
  parsedBaseUrl.pathname = `/${qaDbName}`;
  const qaDbUrl = parsedBaseUrl.toString();

  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ml-auth-cutover-qa-'),
  );
  const sandboxTarget = path.join(sandboxRoot, 'apps/management-lite');
  const gateDir = path.join(sandboxRoot, 'config/release-gate');
  const ownerKeysDir = path.join(sandboxRoot, 'owner-offline-keys');
  const bundleDir = path.join(sandboxRoot, 'bundles');
  const reportsDir = path.join(sandboxRoot, 'reports');
  const logsDir = path.join(sandboxRoot, 'logs');
  const backupsDir = path.join(sandboxRoot, 'backups/postgres');

  for (const d of [
    path.join(sandboxRoot, 'apps'),
    gateDir,
    ownerKeysDir,
    bundleDir,
    reportsDir,
    logsDir,
    backupsDir,
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }

  const policyPath = path.join(gateDir, 'release-gate-policy.json');
  const manifestPath = path.join(gateDir, 'approved-release.json');
  const auditLogPath = path.join(gateDir, 'approval-audit.jsonl');
  const ciReceiptPath = path.join(gateDir, 'ci-run-receipt.json');
  const ownerPrivKey = path.join(ownerKeysDir, 'owner-approval-private.pem');

  // Local mock server for both GitHub Actions Run API and Sandbox Smoke (/api/v1/health, /api/v1/ready, /)
  let mockGhState = {
    id: 701,
    run_attempt: 1,
    head_sha: '',
    head_branch: 'main',
    status: 'completed',
    conclusion: 'success',
    event: 'workflow_dispatch',
    path: '.github/workflows/deploy.yml',
  };

  const mockServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/repos/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockGhState));
      return;
    }
    if (req.url === '/api/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { status: 'pass' } }));
      return;
    }
    if (req.url === '/api/v1/ready') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { status: 'ready' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body>OK</body></html>');
  });

  await new Promise((resolveListen) =>
    mockServer.listen(0, '127.0.0.1', resolveListen),
  );
  const mockPort = mockServer.address().port;
  const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
  const healthUrl = `${mockBaseUrl}/api/v1/health`;
  const readyUrl = `${mockBaseUrl}/api/v1/ready`;
  const webUrl = `${mockBaseUrl}/`;

  let qaPool = null;

  try {
    // Create isolated temporary QA database on local sandbox PostgreSQL
    await adminPool.query(`CREATE DATABASE ${qaDbName};`);
    qaPool = createDatabasePool({
      connectionString: qaDbUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    const shaPre0023 = execFileSync('git', ['rev-parse', '9c38549'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .trim()
      .toLowerCase();
    const shaCompat0023 = execFileSync('git', ['rev-parse', '85d7fc7'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .trim()
      .toLowerCase();
    const shaNew = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .trim()
      .toLowerCase();

    mockGhState.head_sha = shaNew;

    // Clone repo into sandboxTarget
    execFileSync('git', ['clone', '--quiet', repoRoot, sandboxTarget], {
      cwd: repoRoot,
    });

    const seedSandboxBaseline = (baseSha) => {
      execFileSync('git', [
        '-c',
        'safe.directory=*',
        '-C',
        sandboxTarget,
        'checkout',
        '--quiet',
        '-f',
        baseSha,
      ]);
      fs.mkdirSync(path.join(sandboxTarget, 'dist/apps/api/src'), {
        recursive: true,
      });
      fs.mkdirSync(path.join(sandboxTarget, 'apps/web/dist'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(sandboxTarget, 'dist/apps/api/src/main.js'),
        `// sentinel-main-${baseSha}\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(sandboxTarget, 'apps/web/dist/index.html'),
        `<html>sentinel-web-${baseSha}</html>\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(sandboxTarget, 'dist/release-version.json'),
        JSON.stringify({ sha: baseSha, component: 'api' }, null, 2),
        'utf8',
      );
      fs.writeFileSync(
        path.join(sandboxTarget, 'apps/web/dist/release-version.json'),
        JSON.stringify({ sha: baseSha, component: 'web' }, null, 2),
        'utf8',
      );
      fs.writeFileSync(
        path.join(reportsDir, 'current-live-sha.txt'),
        baseSha,
        'utf8',
      );
      if (fs.existsSync(path.join(reportsDir, 'deployment-state.json'))) {
        fs.rmSync(path.join(reportsDir, 'deployment-state.json'), {
          force: true,
        });
      }
    };

    // Generate Owner Ed25519 keypair + policy
    await runPowershell(approveScript, [
      '-GenerateKeyPairOnly',
      '-KeyOutDir',
      ownerKeysDir,
      '-PrivateKeyOutPath',
      ownerPrivKey,
      '-GitHubApiBaseUrl',
      mockBaseUrl,
    ]);
    fs.copyFileSync(
      path.join(ownerKeysDir, 'release-gate-policy.json'),
      policyPath,
    );

    // Package verified Full Release Bundle for shaNew
    execFileSync(
      process.execPath,
      [packagerScript, '--type=full', `--out=${bundleDir}`],
      { cwd: repoRoot },
    );
    const validBundlePath = path.join(
      bundleDir,
      `management-lite-full-${shaNew}.tar.gz`,
    );
    assert.equal(
      fs.existsSync(validBundlePath),
      true,
      'Release bundle must exist',
    );
    const validBundleHash = sha256File(validBundlePath);
    const provObj = readJson(`${validBundlePath}.provenance.json`);
    const validSchemaHash = provObj.schemaIdentity.toLowerCase();
    assert.equal(provObj.authPolicyVersion, 'auth-remember-01');
    assert.equal(provObj.maxMigrationId, '0023_auth_session_remember_me');

    let seq = 1;
    const signAndPrepareReceipt = async ({
      commitSha = shaNew,
      artifactSha = validBundleHash,
      schemaSha = validSchemaHash,
      runId = String(700 + seq),
      allowMigration = false,
    } = {}) => {
      const currentSeq = seq++;
      mockGhState.id = Number(runId);
      mockGhState.head_sha = commitSha;
      fs.writeFileSync(
        ciReceiptPath,
        JSON.stringify(
          {
            id: runId,
            run_id: runId,
            run_attempt: 1,
            head_sha: commitSha,
            head_branch: 'main',
            workflow_path: '.github/workflows/deploy.yml',
            artifact_sha256: artifactSha,
            schema_sha256: schemaSha,
            status: 'completed',
            conclusion: 'success',
            event: 'workflow_dispatch',
            repository: 'truhoaiphuong03/management-lite',
          },
          null,
          2,
        ),
        'utf8',
      );
      const approveArgs = [
        '-CommitSha',
        commitSha,
        '-ArtifactSha256',
        artifactSha,
        '-SchemaSha256',
        schemaSha,
        '-CiRunId',
        runId,
        '-CiStatus',
        'SUCCESS',
        '-Sequence',
        String(currentSeq),
        '-ApprovedBy',
        'Owner',
        '-PrivateKeyPath',
        ownerPrivKey,
        '-PolicyPath',
        policyPath,
        '-ManifestPath',
        manifestPath,
        '-AuditLogPath',
        auditLogPath,
      ];
      if (allowMigration) {
        approveArgs.push('-AllowMigration');
      }
      await runPowershell(approveScript, approveArgs);
      return { runId, sequence: currentSeq };
    };

    const invokeDeploy = async ({
      commitSha = shaNew,
      artifactPath = validBundlePath,
      artifactSha = validBundleHash,
      runId,
      skipMigration = true,
      force = false,
      recoverInterrupted = false,
      simulateHealthFailure = false,
    }) => {
      const args = [
        '-CommitSha',
        commitSha,
        '-ServerRoot',
        sandboxRoot,
        '-TargetDir',
        sandboxTarget,
        '-DbTarget',
        qaDbName,
        '-HealthUrl',
        healthUrl,
        '-ReadyUrl',
        readyUrl,
        '-WebUrl',
        webUrl,
        '-SandboxMode',
      ];
      if (recoverInterrupted) {
        args.push('-RecoverInterrupted');
      } else {
        args.push(
          '-ArtifactPath',
          artifactPath,
          '-ArtifactSha256',
          artifactSha,
          '-CiRunId',
          runId,
          '-CiRunReceiptPath',
          ciReceiptPath,
          '-PolicyPath',
          policyPath,
          '-ApprovalManifestPath',
          manifestPath,
        );
        if (!skipMigration) {
          args.push('-RunMigrations');
        }
      }
      if (force) args.push('-Force');
      if (simulateHealthFailure) args.push('-SimulateHealthFailure');
      return runPowershell(deployScript, args);
    };

    // Apply migrations 0001..0022 (excluding 0023_auth_session_remember_me) to simulate pre-0023 database
    const allMigrations = loadMigrationFiles(
      path.resolve(repoRoot, 'packages/database/src/migrations'),
    );
    const pre0023Migrations = allMigrations.filter(
      (m) => m.id !== '0023_auth_session_remember_me',
    );
    assert.equal(pre0023Migrations.length, 22);
    await runMigrations(qaPool, pre0023Migrations);

    // Seed workspace, user, and a pre-0023 legacy session row (before remember_me column exists)
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const legacySessionId = crypto.randomUUID();
    const legacyToken = crypto.randomBytes(32).toString('hex');
    const nowMs = Date.parse('2026-10-15T12:00:00.000Z');
    const iso = (offsetMs) => new Date(nowMs + offsetMs).toISOString();
    const hour = 3600_000;
    const day = 24 * hour;

    await qaPool.query(
      `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, 'Cutover QA Workspace', 'UTC', 'active')`,
      [workspaceId],
    );
    await qaPool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, 'cutover_admin', 'cutover_admin@example.test', 'active')`,
      [userId],
    );
    await qaPool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, 'unused-fixture', 1)`,
      [userId],
    );
    await qaPool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
      [workspaceId, userId],
    );
    await qaPool.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1)`,
      [workspaceId, userId],
    );
    await qaPool.query(
      `INSERT INTO auth_sessions (id, workspace_id, user_id, session_token_hash, credential_version_at_issue, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, 1, $5, $5, $6, $7)`,
      [
        legacySessionId,
        workspaceId,
        userId,
        hashToken(legacyToken),
        iso(-2 * day),
        iso(28 * day),
        iso(28 * day),
      ],
    );

    // =========================================================================
    // SCENARIO 1: Migration chưa chạy (DB at 0022, SkipMigration=true -> Blocked BEFORE cutover)
    // =========================================================================
    await t.test(
      'Scenario 1: Migration chưa chạy — Preflight blocks cutover when migration 0023 has not been applied',
      async () => {
        seedSandboxBaseline(shaPre0023);
        const { runId } = await signAndPrepareReceipt({
          allowMigration: false,
        });

        await assert.rejects(async () => {
          await invokeDeploy({ runId, skipMigration: true });
        }, /Schema migration count mismatch/);

        const latest = readJson(
          path.join(reportsDir, 'latest-deployment.json'),
        );
        assert.equal(latest.status, 'REJECTED_SCHEMA_MIGRATION_MISMATCH');

        // Verify live API/Web runtime and Git HEAD were NEVER switched
        const headAfter = execFileSync(
          'git',
          ['-c', 'safe.directory=*', '-C', sandboxTarget, 'rev-parse', 'HEAD'],
          { encoding: 'utf8' },
        )
          .trim()
          .toLowerCase();
        const mainJs = fs
          .readFileSync(
            path.join(sandboxTarget, 'dist/apps/api/src/main.js'),
            'utf8',
          )
          .trim();
        const liveSha = fs
          .readFileSync(path.join(reportsDir, 'current-live-sha.txt'), 'utf8')
          .trim();
        assert.equal(headAfter, shaPre0023);
        assert.equal(mainJs, `// sentinel-main-${shaPre0023}`);
        assert.equal(liveSha, shaPre0023);
      },
    );

    // =========================================================================
    // SCENARIO 4: Build mới chưa sẵn sàng (Missing/Empty entrypoint or missing auth policy -> Blocked BEFORE migration & cutover)
    // =========================================================================
    await t.test(
      'Scenario 4: Build mới chưa sẵn sàng — Rejects unready candidate build before migration or cutover',
      async () => {
        seedSandboxBaseline(shaPre0023);
        const unreadyStage = path.join(sandboxRoot, 'unready-stage');
        fs.mkdirSync(unreadyStage, { recursive: true });
        execFileSync('tar', ['-xzf', validBundlePath, '-C', unreadyStage]);

        // Empty out dist/apps/api/src/main.js and update manifest file hash so it tests candidate build readiness
        const mainRel = 'dist/apps/api/src/main.js';
        const mainFull = path.join(unreadyStage, mainRel);
        fs.writeFileSync(mainFull, '', 'utf8');
        const mPath = path.join(unreadyStage, 'manifest.json');
        const mObj = readJson(mPath);
        for (const f of mObj.files) {
          if (f.path === mainRel) {
            f.sha256 = sha256File(mainFull);
            f.size = 0;
          }
        }
        fs.writeFileSync(mPath, JSON.stringify(mObj, null, 2), 'utf8');

        const unreadyTar = path.join(bundleDir, 'unready-build.tar.gz');
        execFileSync('tar', ['-czf', unreadyTar, '-C', unreadyStage, '.']);
        const unreadyHash = sha256File(unreadyTar);

        const { runId } = await signAndPrepareReceipt({
          artifactSha: unreadyHash,
          schemaSha: validSchemaHash,
          allowMigration: true,
        });

        await assert.rejects(async () => {
          await invokeDeploy({
            artifactPath: unreadyTar,
            artifactSha: unreadyHash,
            runId,
            skipMigration: false,
          });
        }, /Candidate build is not ready/);

        const latest = readJson(
          path.join(reportsDir, 'latest-deployment.json'),
        );
        assert.equal(latest.status, 'REJECTED_BUILD_NOT_READY');

        // Verify migration 0023 was NOT executed and live build was NOT switched
        const migCountRes = await qaPool.query(
          'SELECT count(*)::int AS cnt FROM schema_migrations',
        );
        assert.equal(migCountRes.rows[0].cnt, 22);
        const mainJs = fs
          .readFileSync(
            path.join(sandboxTarget, 'dist/apps/api/src/main.js'),
            'utf8',
          )
          .trim();
        assert.equal(mainJs, `// sentinel-main-${shaPre0023}`);
      },
    );

    // =========================================================================
    // SCENARIO 3: Migration thất bại (Pre-cutover migration fails -> Transaction rolled back, live build NOT switched)
    // =========================================================================
    await t.test(
      'Scenario 3: Migration thất bại — Rolls back failed migration transaction and never switches live API/Web build',
      async () => {
        seedSandboxBaseline(shaPre0023);
        const badMigStage = path.join(sandboxRoot, 'bad-mig-stage');
        fs.mkdirSync(badMigStage, { recursive: true });
        execFileSync('tar', ['-xzf', validBundlePath, '-C', badMigStage]);

        // Inject invalid SQL into 0023_auth_session_remember_me.sql and sync catalog.js + manifest.json
        const mig0023Rel = 'migrations/0023_auth_session_remember_me.sql';
        const mig0023Full = path.join(badMigStage, mig0023Rel);
        const badSql =
          'ALTER TABLE auth_sessions ADD COLUMN remember_me BOOLEAN NULL;\nSELECT * FROM nonexistent_table_causing_migration_failure;\n';
        fs.writeFileSync(mig0023Full, badSql, 'utf8');
        const badSqlChecksum = crypto
          .createHash('sha256')
          .update(badSql.replace(/\r\n/g, '\n').trim(), 'utf8')
          .digest('hex');

        // Update catalog.js in badMigStage so assertMigrationParity passes and runMigrations executes the SQL
        const catalogRel = 'dist/packages/database/src/migrations/catalog.js';
        const catalogFull = path.join(badMigStage, catalogRel);
        const origMig0023 = allMigrations.find(
          (m) => m.id === '0023_auth_session_remember_me',
        );
        let catalogCode = fs.readFileSync(catalogFull, 'utf8');
        catalogCode = catalogCode.replace(origMig0023.checksum, badSqlChecksum);
        fs.writeFileSync(catalogFull, catalogCode, 'utf8');

        const mPath = path.join(badMigStage, 'manifest.json');
        const mObj = readJson(mPath);
        for (const mig of mObj.migrations) {
          if (mig.id === '0023_auth_session_remember_me') {
            mig.checksum = badSqlChecksum;
          }
        }
        mObj.schemaIdentity = crypto
          .createHash('sha256')
          .update(JSON.stringify(mObj.migrations), 'utf8')
          .digest('hex');

        for (const rvRel of [
          'dist/release-version.json',
          'web/release-version.json',
        ]) {
          const rvFull = path.join(badMigStage, rvRel);
          const rv = readJson(rvFull);
          rv.schemaIdentity = mObj.schemaIdentity;
          fs.writeFileSync(rvFull, JSON.stringify(rv, null, 2), 'utf8');
        }

        for (const f of mObj.files) {
          if (
            [
              mig0023Rel,
              catalogRel,
              'dist/release-version.json',
              'web/release-version.json',
            ].includes(f.path)
          ) {
            const full = path.join(badMigStage, f.path);
            f.sha256 = sha256File(full);
            f.size = fs.statSync(full).size;
          }
        }
        fs.writeFileSync(mPath, JSON.stringify(mObj, null, 2), 'utf8');

        const badMigTar = path.join(bundleDir, 'bad-migration.tar.gz');
        execFileSync('tar', ['-czf', badMigTar, '-C', badMigStage, '.']);
        const badMigHash = sha256File(badMigTar);

        const { runId } = await signAndPrepareReceipt({
          artifactSha: badMigHash,
          schemaSha: mObj.schemaIdentity,
          allowMigration: true,
        });

        await assert.rejects(async () => {
          await invokeDeploy({
            artifactPath: badMigTar,
            artifactSha: badMigHash,
            runId,
            skipMigration: false,
          });
        }, /MIGRATION_FAILED_PRE_CUTOVER/);

        const latest = readJson(
          path.join(reportsDir, 'latest-deployment.json'),
        );
        const journal = readJson(
          path.join(reportsDir, 'deployment-state.json'),
        );
        assert.equal(latest.status, 'MIGRATION_FAILED_PRE_CUTOVER');
        assert.equal(journal.status, 'MIGRATION_FAILED_PRE_CUTOVER');

        // Verify PostgreSQL rolled back migration 0023 (still 22 migrations, no remember_me column)
        const migCountRes = await qaPool.query(
          'SELECT count(*)::int AS cnt FROM schema_migrations',
        );
        assert.equal(migCountRes.rows[0].cnt, 22);
        const colRes = await qaPool.query(
          `SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auth_sessions' AND column_name = 'remember_me'`,
        );
        assert.equal(colRes.rows[0].cnt, 0);

        // Verify live API/Web build and Git HEAD were NEVER switched!
        const headAfter = execFileSync(
          'git',
          ['-c', 'safe.directory=*', '-C', sandboxTarget, 'rev-parse', 'HEAD'],
          { encoding: 'utf8' },
        )
          .trim()
          .toLowerCase();
        const mainJs = fs
          .readFileSync(
            path.join(sandboxTarget, 'dist/apps/api/src/main.js'),
            'utf8',
          )
          .trim();
        assert.equal(headAfter, shaPre0023);
        assert.equal(mainJs, `// sentinel-main-${shaPre0023}`);
      },
    );

    // =========================================================================
    // SCENARIO 2: Migration thành công (Pre-cutover migration 0023 succeeds and verifies schema)
    // =========================================================================
    await t.test(
      'Scenario 2: Migration thành công — Applies migration 0023 before cutover and verifies post-migration schema',
      async () => {
        seedSandboxBaseline(shaPre0023);
        const { runId } = await signAndPrepareReceipt({ allowMigration: true });

        await invokeDeploy({ runId, skipMigration: false });

        // Verify migration 0023 is applied and legacy session row is preserved with remember_me = NULL
        const migCountRes = await qaPool.query(
          'SELECT count(*)::int AS cnt FROM schema_migrations',
        );
        assert.equal(migCountRes.rows[0].cnt, 23);
        const legacyRow = (
          await qaPool.query(
            'SELECT id, remember_me FROM auth_sessions WHERE id = $1',
            [legacySessionId],
          )
        ).rows[0];
        assert.equal(legacyRow.id, legacySessionId);
        assert.equal(legacyRow.remember_me, null);
      },
    );

    // =========================================================================
    // SCENARIO 5: Cutover thành công (Runtime cutover & smoke verification after schema verified)
    // =========================================================================
    await t.test(
      'Scenario 5: Cutover thành công — Switches API/Web runtime atomically and verifies running components proof',
      async () => {
        const latest = readJson(
          path.join(reportsDir, 'latest-deployment.json'),
        );
        const journal = readJson(
          path.join(reportsDir, 'deployment-state.json'),
        );
        const runningComp = readJson(
          path.join(reportsDir, 'running-components-sha.json'),
        );
        const liveSha = fs
          .readFileSync(path.join(reportsDir, 'current-live-sha.txt'), 'utf8')
          .trim();

        assert.equal(latest.status, 'SUCCESS');
        assert.equal(journal.status, 'COMPLETED');
        assert.equal(liveSha, shaNew);
        assert.equal(runningComp.api_sha, shaNew);
        assert.equal(runningComp.web_sha, shaNew);
      },
    );

    // =========================================================================
    // SCENARIO 6: Cutover thất bại (Post-cutover health/smoke check fails -> triggers rollback)
    // =========================================================================
    await t.test(
      'Scenario 6: Cutover thất bại — Detects post-cutover health check failure and aborts cutover',
      async () => {
        seedSandboxBaseline(shaCompat0023);
        const { runId } = await signAndPrepareReceipt({
          allowMigration: false,
        });

        await assert.rejects(async () => {
          await invokeDeploy({
            runId,
            skipMigration: true,
            simulateHealthFailure: true,
          });
        }, /Deployment failed and cleanly rolled back/);
      },
    );

    // =========================================================================
    // SCENARIO 7: Rollback tương thích (0023 -> 0023 compatible rollback succeeds cleanly)
    // =========================================================================
    await t.test(
      'Scenario 7: Rollback tương thích — Restores compatible 0023 release snapshot (85d7fc7) and preserves schema/auth policy',
      async () => {
        const latest = readJson(
          path.join(reportsDir, 'latest-deployment.json'),
        );
        const journal = readJson(
          path.join(reportsDir, 'deployment-state.json'),
        );
        const headAfter = execFileSync(
          'git',
          ['-c', 'safe.directory=*', '-C', sandboxTarget, 'rev-parse', 'HEAD'],
          { encoding: 'utf8' },
        )
          .trim()
          .toLowerCase();
        const mainJs = fs
          .readFileSync(
            path.join(sandboxTarget, 'dist/apps/api/src/main.js'),
            'utf8',
          )
          .trim();

        assert.equal(latest.status, 'ROLLED_BACK');
        assert.equal(journal.status, 'ROLLED_BACK');
        assert.equal(headAfter, shaCompat0023);
        assert.equal(mainJs, `// sentinel-main-${shaCompat0023}`);
      },
    );

    // =========================================================================
    // SCENARIO 8: Rollback không tương thích (0023 DB -> Pre-0023 9c38549 blocked with STOP/NO-GO + Safe Forward Recovery)
    // =========================================================================
    await t.test(
      'Scenario 8: Rollback không tương thích — Blocks code-only rollback to pre-0023 release (STOP/NO-GO) and recovers via signed forward release',
      async () => {
        seedSandboxBaseline(shaPre0023);
        const { runId } = await signAndPrepareReceipt({
          allowMigration: false,
        });

        await assert.rejects(async () => {
          await invokeDeploy({
            runId,
            skipMigration: true,
            simulateHealthFailure: true,
          });
        }, /STOP_NO_GO_INCOMPATIBLE_ROLLBACK/);

        const latest = readJson(
          path.join(reportsDir, 'latest-deployment.json'),
        );
        const journal = readJson(
          path.join(reportsDir, 'deployment-state.json'),
        );
        const headAfter = execFileSync(
          'git',
          ['-c', 'safe.directory=*', '-C', sandboxTarget, 'rev-parse', 'HEAD'],
          { encoding: 'utf8' },
        )
          .trim()
          .toLowerCase();

        assert.equal(
          latest.status,
          'ROLLBACK_BLOCKED_INCOMPATIBLE_SCHEMA_OR_AUTH_POLICY',
        );
        assert.equal(journal.status, 'STOP_NO_GO_INCOMPATIBLE_ROLLBACK');
        assert.equal(
          headAfter,
          shaNew,
          'Must NOT revert Git HEAD to incompatible pre-0023 commit',
        );

        // Attempt -RecoverInterrupted must also be blocked in STOP_NO_GO_INCOMPATIBLE_ROLLBACK state
        await assert.rejects(async () => {
          await invokeDeploy({ recoverInterrupted: true });
        }, /STOP_NO_GO_INCOMPATIBLE_ROLLBACK/);

        // Safe Forward Recovery (-Force with a newly signed 0023-compatible release bundle) restores service without data loss
        const { runId: fwdRunId } = await signAndPrepareReceipt({
          allowMigration: false,
        });
        await invokeDeploy({
          runId: fwdRunId,
          skipMigration: true,
          force: true,
        });

        const latestFwd = readJson(
          path.join(reportsDir, 'latest-deployment.json'),
        );
        const journalFwd = readJson(
          path.join(reportsDir, 'deployment-state.json'),
        );
        assert.equal(latestFwd.status, 'SUCCESS');
        assert.equal(journalFwd.status, 'COMPLETED');
      },
    );

    // =========================================================================
    // SCENARIO 9: Legacy session remember_me = NULL (Fail-Closed & Zero Mutation)
    // =========================================================================
    await t.test(
      'Scenario 9: Legacy session remember_me = NULL — Fails closed on resolveSession and refreshSession without mutating timestamps',
      async () => {
        t.mock.timers.enable({ apis: ['Date'], now: nowMs });
        try {
          const authService = new AuthService(
            qaPool,
            crypto.randomBytes(32).toString('hex'),
          );
          const beforeSnap = (
            await qaPool.query(
              'SELECT last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, remember_me FROM auth_sessions WHERE id = $1',
              [legacySessionId],
            )
          ).rows[0];
          assert.equal(beforeSnap.remember_me, null);

          assert.equal(await authService.resolveSession(legacyToken), null);
          assert.equal(
            await authService.refreshSession({ sessionToken: legacyToken }),
            null,
          );

          const afterSnap = (
            await qaPool.query(
              'SELECT last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, remember_me FROM auth_sessions WHERE id = $1',
              [legacySessionId],
            )
          ).rows[0];
          assert.deepEqual(
            afterSnap,
            beforeSnap,
            'Legacy NULL remember_me session must never be mutated',
          );
        } finally {
          t.mock.timers.reset();
        }
      },
    );

    // =========================================================================
    // SCENARIO 10: Session hết hạn và refresh (Standard vs Remembered & absolute_expires_at ceiling)
    // =========================================================================
    await t.test(
      'Scenario 10: Session hết hạn và refresh — Enforces idle expiry for standard sessions and caps remembered refresh at absolute_expires_at',
      async () => {
        t.mock.timers.enable({ apis: ['Date'], now: nowMs });
        try {
          const authService = new AuthService(
            qaPool,
            crypto.randomBytes(32).toString('hex'),
          );

          // 10a. Standard session (remember_me = false) with expired idle_expires_at cannot be refreshed
          const stdExpiredToken = crypto.randomBytes(32).toString('hex');
          const stdExpiredId = crypto.randomUUID();
          await qaPool.query(
            `INSERT INTO auth_sessions (id, workspace_id, user_id, session_token_hash, credential_version_at_issue, created_at, last_seen_at, idle_expires_at, absolute_expires_at, remember_me)
             VALUES ($1, $2, $3, $4, 1, $5, $5, $6, $7, false)`,
            [
              stdExpiredId,
              workspaceId,
              userId,
              hashToken(stdExpiredToken),
              iso(-9 * hour),
              iso(-1 * hour),
              iso(15 * hour),
            ],
          );
          assert.equal(await authService.resolveSession(stdExpiredToken), null);
          assert.equal(
            await authService.refreshSession({ sessionToken: stdExpiredToken }),
            null,
          );

          // 10b. Remembered session (remember_me = true) with expired idle_expires_at CAN refresh up to absolute_expires_at without extending absolute_expires_at
          const remIdleToken = crypto.randomBytes(32).toString('hex');
          const remIdleId = crypto.randomUUID();
          const fixedAbsIso = iso(2 * hour); // Only 2 hours remaining until absolute ceiling
          await qaPool.query(
            `INSERT INTO auth_sessions (id, workspace_id, user_id, session_token_hash, credential_version_at_issue, created_at, last_seen_at, idle_expires_at, absolute_expires_at, remember_me)
             VALUES ($1, $2, $3, $4, 1, $5, $5, $6, $7, true)`,
            [
              remIdleId,
              workspaceId,
              userId,
              hashToken(remIdleToken),
              iso(-29 * day),
              iso(-1 * hour),
              fixedAbsIso,
            ],
          );

          const refreshed = await authService.refreshSession({
            sessionToken: remIdleToken,
          });
          assert.ok(
            refreshed,
            'Remembered session within absolute window must refresh',
          );
          assert.equal(refreshed.rememberMe, true);
          assert.equal(refreshed.responseData.remember_me, true);
          assert.equal(
            new Date(refreshed.responseData.session_expires_at).getTime(),
            new Date(fixedAbsIso).getTime(),
            'absolute_expires_at must NEVER be extended on refresh',
          );
          const refreshedRow = (
            await qaPool.query(
              'SELECT idle_expires_at, absolute_expires_at FROM auth_sessions WHERE id = $1',
              [remIdleId],
            )
          ).rows[0];
          assert.equal(
            new Date(refreshedRow.absolute_expires_at).getTime(),
            new Date(fixedAbsIso).getTime(),
            'DB absolute_expires_at must NEVER be extended on refresh',
          );
          assert.equal(
            new Date(refreshedRow.idle_expires_at).getTime(),
            new Date(fixedAbsIso).getTime(),
            'idle_expires_at must be capped at absolute_expires_at',
          );

          // 10c. Remembered session past absolute_expires_at fails closed
          const remAbsExpiredToken = crypto.randomBytes(32).toString('hex');
          await qaPool.query(
            `INSERT INTO auth_sessions (id, workspace_id, user_id, session_token_hash, credential_version_at_issue, created_at, last_seen_at, idle_expires_at, absolute_expires_at, remember_me)
             VALUES ($1, $2, $3, $4, 1, $5, $5, $6, $7, true)`,
            [
              crypto.randomUUID(),
              workspaceId,
              userId,
              hashToken(remAbsExpiredToken),
              iso(-31 * day),
              iso(5 * day),
              iso(-1000),
            ],
          );
          assert.equal(
            await authService.resolveSession(remAbsExpiredToken),
            null,
          );
          assert.equal(
            await authService.refreshSession({
              sessionToken: remAbsExpiredToken,
            }),
            null,
          );
        } finally {
          t.mock.timers.reset();
        }
      },
    );
  } finally {
    if (qaPool) {
      await closeDatabasePool(qaPool);
    }
    await adminPool
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`,
        [qaDbName],
      )
      .catch(() => {});
    await adminPool
      .query(`DROP DATABASE IF EXISTS ${qaDbName};`)
      .catch(() => {});
    await closeDatabasePool(adminPool);
    await new Promise((res) => mockServer.close(res));
    try {
      execFileSync('icacls.exe', [sandboxRoot, '/reset', '/T', '/C', '/Q'], {
        stdio: 'ignore',
      });
    } catch {}
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
});
