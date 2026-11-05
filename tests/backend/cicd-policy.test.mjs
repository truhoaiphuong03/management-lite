import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('Deployment policy rejects unapproved SHA, untrusted CI and missing Owner protection', () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'management-lite-policy-qa-'),
  );
  try {
    const git = (...args) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '--quiet', '-b', 'main');
    git('config', 'user.name', 'Synthetic QA');
    git('config', 'user.email', 'synthetic@isolated.example.test');
    fs.writeFileSync(path.join(dir, 'fixture.txt'), 'synthetic');
    git('add', 'fixture.txt');
    git('commit', '--quiet', '-m', 'synthetic fixture');
    const sha = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', sha);
    const mock = path.join(dir, 'mock-api.mjs');
    fs.writeFileSync(
      mock,
      `globalThis.fetch=async url=>{const scenario=process.env.POLICY_CASE;const run={head_sha:process.env.RELEASE_SHA,head_branch:'main',event:'push',status:'completed',conclusion:'success',path:'.github/workflows/foundation.yml'};const policy={protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{login:'synthetic-owner'}}]}],deployment_branch_policy:{protected_branches:true}};if(scenario==='ci-sha')run.head_sha='0'.repeat(40);if(scenario==='ci-pr')run.event='pull_request';if(scenario==='ci-fail')run.conclusion='failure';if(scenario==='wrong-workflow')run.path='.github/workflows/other.yml';if(scenario==='no-reviewer')policy.protection_rules=[];if(scenario==='wrong-owner')policy.protection_rules[0].reviewers[0].reviewer.login='another-user';if(scenario==='extra-reviewer')policy.protection_rules[0].reviewers.push({type:'User',reviewer:{login:'another-user'}});if(scenario==='unprotected')policy.deployment_branch_policy.protected_branches=false;return {ok:scenario!=='api-denied',status:scenario==='api-denied'?403:200,json:async()=>url.includes('environments')?policy:run};};`,
    );
    const script = fileURLToPath(
      new URL(
        '../../scripts/deployment/verify-release-request.mjs',
        import.meta.url,
      ),
    );
    const base = {
      ...process.env,
      GITHUB_REPOSITORY: 'truhoaiphuong03/management-lite',
      GITHUB_REF: 'refs/heads/main',
      RELEASE_SHA: sha,
      QA_APPROVED_SHA: sha,
      CI_RUN_ID: '123',
      CD_ENABLED: 'true',
      PRODUCTION_OWNER_LOGIN: 'synthetic-owner',
      GITHUB_TOKEN: 'synthetic-test-token-not-real',
    };
    const run = (scenario, override = {}) =>
      spawnSync(
        process.execPath,
        ['--import', pathToFileURL(mock).href, script],
        {
          cwd: dir,
          encoding: 'utf8',
          env: { ...base, POLICY_CASE: scenario, ...override },
        },
      );
    assert.equal(run('valid').status, 0);
    for (const scenario of [
      'ci-sha',
      'ci-pr',
      'ci-fail',
      'wrong-workflow',
      'no-reviewer',
      'wrong-owner',
      'unprotected',
      'extra-reviewer',
      'api-denied',
    ])
      assert.notEqual(run(scenario).status, 0, scenario);
    for (const override of [
      { CD_ENABLED: 'false' },
      { QA_APPROVED_SHA: '0'.repeat(40) },
      { RELEASE_SHA: 'main' },
      { GITHUB_REF: 'refs/pull/1/merge' },
      { GITHUB_REPOSITORY: 'untrusted/repo' },
    ])
      assert.notEqual(
        run('valid', override).status,
        0,
        JSON.stringify(override),
      );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const normalizeLineEndings = (text) => String(text).replace(/\r\n?/g, '\n');

test('Option 1 CI/CD architecture: automatic CI on push/PR without deploy, mandatory Windows P0 security gate before artifact packaging, zero self-hosted runner', () => {
  const workflowsDir = fileURLToPath(
    new URL('../../.github/workflows', import.meta.url),
  );
  const files = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
  assert.deepEqual(
    files,
    ['deploy.yml', 'foundation.yml'],
    'Must have exactly two canonical workflows: foundation.yml (CI on push/PR) and deploy.yml (manual release artifact builder)',
  );

  const verifyWorkflowAndControllerContent = (lineEndingTransformer) => {
    for (const file of files) {
      const rawContent = lineEndingTransformer(
        fs.readFileSync(path.join(workflowsDir, file), 'utf8'),
      );
      const content = normalizeLineEndings(rawContent);
      assert.equal(
        content.includes('self-hosted'),
        false,
        `Workflow ${file} must not dispatch jobs to self-hosted Windows runner under Option 1`,
      );
      assert.equal(
        content.includes('windows-p0-security:') &&
          content.includes('runs-on: windows-latest') &&
          content.includes('tests/backend/windows-p0-gate.test.mjs') &&
          content.includes('needs: windows-p0-security'),
        true,
        `Workflow ${file} must run windows-p0-gate.test.mjs on windows-latest and require windows-p0-security to PASS before packaging/uploading any release artifact`,
      );
      if (file === 'foundation.yml') {
        assert.equal(
          /^\s*push\s*:/m.test(content) &&
            /^\s*pull_request\s*:/m.test(content),
          true,
          'foundation.yml must automatically run CI on both push and pull_request',
        );
        assert.equal(
          content.includes('Deploy-SemiAutoWindows.ps1'),
          false,
          'foundation.yml must never execute production/host deployment',
        );
      }
      if (file.startsWith('deploy')) {
        assert.equal(
          /^\s*push\s*:/m.test(content),
          false,
          `Deploy workflow ${file} must not trigger on push`,
        );
        assert.equal(
          content.includes("if: github.ref == 'refs/heads/main'"),
          true,
          'deploy.yml must restrict execution to refs/heads/main',
        );
        assert.equal(
          content.includes('artifact_sha256') &&
            content.includes('schema_sha256') &&
            content.includes('run_attempt') &&
            content.includes('workflow_path'),
          true,
          'deploy.yml must bind artifact_sha256, schema_sha256, run_attempt, and workflow_path in ci-run-receipt',
        );
      }
      assert.equal(
        content.includes('node-version-file: .nvmrc') &&
          content.includes('npm install --global npm@10.9.2'),
        true,
        `Workflow ${file} must lock exact Node version via .nvmrc (22.14.0) and npm@10.9.2 required by scripts/check-toolchain.mjs`,
      );
      const buildIdx = content.indexOf('npm run build\n');
      const buildWebIdx = content.indexOf('npm run build:web');
      const webDbPrepIdx = content.indexOf(
        'node scripts/deployment/ci-web-db.mjs prepare',
      );
      const testWebIdx = content.indexOf('npm run test:web');
      const webDbSentinelIdx = content.indexOf(
        'node scripts/deployment/ci-web-db.mjs verify-sentinel',
      );
      const webDbCleanupIdx = content.indexOf(
        'node scripts/deployment/ci-web-db.mjs cleanup',
      );
      assert.equal(
        buildIdx > 0 &&
          buildWebIdx > buildIdx &&
          webDbPrepIdx > buildWebIdx &&
          testWebIdx > webDbPrepIdx &&
          webDbSentinelIdx > testWebIdx &&
          webDbCleanupIdx > webDbSentinelIdx,
        true,
        `Workflow ${file} must enforce strict ordering: build -> build:web -> ci-web-db prepare -> test:web -> ci-web-db verify-sentinel -> ci-web-db cleanup`,
      );
      assert.equal(
        content.includes(
          'DATABASE_URL: postgresql://ci_test:${{ env.CI_DATABASE_PASSWORD }}@127.0.0.1:55432/web_test_ci_sentinel',
        ) &&
          content.includes(
            'TEST_DATABASE_URL: postgresql://ci_test:${{ env.CI_DATABASE_PASSWORD }}@127.0.0.1:55432/web_e2e_ci_test',
          ) &&
          content.includes("CONFIRM_ISOLATED_TEST_DB: 'true'") &&
          content.includes("CONFIRM_PRINTQUOTE_E2E_RESET: 'true'"),
        true,
        `Workflow ${file} must configure isolated TEST_DATABASE_URL (web_e2e_ci_test), sentinel DATABASE_URL (web_test_ci_sentinel), and explicit E2E confirmations for test:web`,
      );
      const usesMatches = [...content.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)];
      for (const m of usesMatches) {
        assert.match(
          m[1],
          /@[0-9a-f]{40}$/,
          `Workflow ${file} action ${m[1]} must be pinned to a full 40-char commit SHA`,
        );
      }
    }

    const controllerPath = fileURLToPath(
      new URL(
        '../../scripts/deployment/Deploy-SemiAutoWindows.ps1',
        import.meta.url,
      ),
    );
    const controllerCode = normalizeLineEndings(
      lineEndingTransformer(fs.readFileSync(controllerPath, 'utf8')),
    );
    assert.equal(
      controllerCode.includes('npm run build'),
      false,
      'Deploy-SemiAutoWindows.ps1 must never fall back to local host compilation (npm run build)',
    );
    assert.equal(
      controllerCode.includes('REJECTED_ARTIFACT_MISSING') &&
        controllerCode.includes(
          'REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED',
        ) &&
        controllerCode.includes('REJECTED_GITHUB_API_CI_VERIFICATION_FAILED') &&
        controllerCode.includes('ROLLBACK_FAILED_MANUAL_INTERVENTION') &&
        controllerCode.includes('REJECTED_BUILD_NOT_READY') &&
        controllerCode.includes('MIGRATION_FAILED_PRE_CUTOVER') &&
        controllerCode.includes('STOP_NO_GO_INCOMPATIBLE_ROLLBACK') &&
        controllerCode.includes(
          'ROLLBACK_BLOCKED_INCOMPATIBLE_SCHEMA_OR_AUTH_POLICY',
        ) &&
        controllerCode.includes('Invoke-AtomicRuntimeSwap') &&
        controllerCode.includes('UNSAFE_TAR_TYPE'),
      true,
      'Deploy-SemiAutoWindows.ps1 must enforce mandatory artifact, CI receipt, live GitHub API, build readiness, pre-cutover migration, atomic same-volume swap, TAR header symlink/hardlink rejection, and rollback STOP/NO-GO + MANUAL_INTERVENTION states',
    );
    const preCutoverMigIdx = controllerCode.indexOf(
      "phase           = 'PRE_CUTOVER_MIGRATION'",
    );
    const runtimeCutoverIdx = controllerCode.indexOf(
      "phase           = 'RUNTIME_CUTOVER'",
    );
    assert.equal(
      preCutoverMigIdx > 0 && runtimeCutoverIdx > preCutoverMigIdx,
      true,
      'Deploy-SemiAutoWindows.ps1 must execute and verify database migrations (PRE_CUTOVER_MIGRATION) strictly before switching live API/Web runtime (RUNTIME_CUTOVER)',
    );
  };

  verifyWorkflowAndControllerContent((s) => s);
  verifyWorkflowAndControllerContent((s) => s.replace(/\r\n?/g, '\n'));
  verifyWorkflowAndControllerContent((s) =>
    s.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'),
  );
});

test('P0 Release Gate Static Policy & Guard Verification (Linux & Windows): verifies all release-gate, UAC, NTFS ACL, DPAPI, GCM, SCOPED_WINDOW, and Windows test suite invariants across LF and CRLF', () => {
  const controllerPath = fileURLToPath(
    new URL(
      '../../scripts/deployment/Deploy-SemiAutoWindows.ps1',
      import.meta.url,
    ),
  );
  const approvePath = fileURLToPath(
    new URL('../../scripts/deployment/Approve-ReleaseSha.ps1', import.meta.url),
  );
  const setupPath = fileURLToPath(
    new URL(
      '../../scripts/deployment/Invoke-OwnerP0Setup.ps1',
      import.meta.url,
    ),
  );
  const verifyPatPath = fileURLToPath(
    new URL(
      '../../scripts/deployment/Verify-GitHubPatAndLiveCi.ps1',
      import.meta.url,
    ),
  );
  const windowsGateTestPath = fileURLToPath(
    new URL('./windows-p0-gate.test.mjs', import.meta.url),
  );

  const verifyStaticInvariants = (lineEndingTransformer) => {
    const readNormalized = (p) =>
      normalizeLineEndings(lineEndingTransformer(fs.readFileSync(p, 'utf8')));

    const controllerCode = readNormalized(controllerPath);
    const approveCode = readNormalized(approvePath);
    const setupCode = readNormalized(setupPath);
    const verifyPatCode = readNormalized(verifyPatPath);
    const windowsGateTestCode = readNormalized(windowsGateTestPath);

    assert.equal(
      controllerCode.includes(
        'REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION',
      ) &&
        controllerCode.includes('REJECTED_SYNTHETIC_CI_RECEIPT') &&
        controllerCode.includes('REJECTED_PRIVATE_KEY_EXPOSED_ON_HOST') &&
        controllerCode.includes('REJECTED_OUT_OF_SCOPE_LINEAGE') &&
        controllerCode.includes('REJECTED_OUT_OF_SCOPE_PATH_MODIFICATION') &&
        controllerCode.includes('REJECTED_UNAPPROVED_MIGRATION') &&
        controllerCode.includes('REJECTED_SCOPE_QUOTA_EXCEEDED') &&
        controllerCode.includes('config\\test-secrets'),
      true,
      'Deploy-SemiAutoWindows.ps1 must enforce official GitHub API in production, reject synthetic CI receipts, recursively scan config\\test-secrets for exposed private keys, and enforce SCOPED_WINDOW lineage, path, migration, and quota gates',
    );

    assert.equal(
      approveCode.includes('SECURITY_VIOLATION_RUNNER_SELF_APPROVAL') &&
        approveCode.includes('SECURITY_VIOLATION_AGENT_SELF_APPROVAL') &&
        approveCode.includes('SECURITY_VIOLATION_NON_ELEVATED_CALLER') &&
        approveCode.includes('SECURITY_VIOLATION_PRIVATE_KEY_IN_SERVER_GATE') &&
        approveCode.includes('SECURITY_VIOLATION_UAC_HIJACK_DETECTED') &&
        approveCode.includes(
          'REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION',
        ) &&
        approveCode.includes('.provenance.json'),
      true,
      'Approve-ReleaseSha.ps1 must block GitHub Actions runner self-approval, block AI agent self-signing, block non-elevated callers, block UAC registry hijacks, block server-local private keys, enforce official GitHub API on production targets, and support .provenance.json auto-discovery',
    );

    assert.equal(
      setupCode.includes('*S-1-3-4') &&
        setupCode.includes('Lock-DirectoryReadOnlyForNonElevated') &&
        setupCode.includes('Lock-ContainerOnlyNoDeleteChild') &&
        setupCode.includes('Preserve-OperationalDirectoryExplicitAcl') &&
        setupCode.includes('Test-LiveStackAndBackupHealth') &&
        setupCode.includes('Restore-P0SetupSnapshot') &&
        setupCode.includes('ConsentPromptBehaviorAdmin'),
      true,
      'Invoke-OwnerP0Setup.ps1 must enforce OWNER RIGHTS (*S-1-3-4) RX lock, parent DC removal, operational service ACL preservation, preflight/post-ACL live stack + DB backup checks, UAC hardening, and transactional rollback',
    );

    assert.equal(
      verifyPatCode.includes('FORBIDDEN_MAIN_BRANCH_PUSH') &&
        verifyPatCode.includes('SECURITY_VIOLATION_CLI_PAT_FORBIDDEN') &&
        verifyPatCode.includes('01000000d08c9ddf') &&
        verifyPatCode.includes('GCM_PLAINTEXT_LEAK_DETECTED') &&
        verifyPatCode.includes('GITHUB_PAT_EXCESSIVE_PERMISSIONS'),
      true,
      'Verify-GitHubPatAndLiveCi.ps1 must forbid pushing to main/master, forbid CLI PAT arguments, enforce DPAPI encryption + GCM WinCred without plaintext leaks, and verify minimum PAT permissions',
    );

    assert.equal(
      windowsGateTestCode.includes(
        "assert.equal(\n    process.platform,\n    'win32'",
      ) &&
        windowsGateTestCode.includes('buildIsolatedTestEnv') &&
        windowsGateTestCode.includes(
          'SECURITY_VIOLATION_RUNNER_SELF_APPROVAL',
        ) &&
        windowsGateTestCode.includes('LuaNtfsKernelVerifier') &&
        windowsGateTestCode.includes('FORBIDDEN_MAIN_BRANCH_PUSH'),
      true,
      'windows-p0-gate.test.mjs must fail closed on non-win32 platforms, explicitly test GitHub Actions runner self-approval rejection, isolate test environments via buildIsolatedTestEnv, and execute live PowerShell, NTFS ACL (LUA_TOKEN kernel), DPAPI, GCM, and SCOPED_WINDOW tests',
    );
  };

  verifyStaticInvariants((s) => s);
  verifyStaticInvariants((s) => s.replace(/\r\n?/g, '\n'));
  verifyStaticInvariants((s) =>
    s.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'),
  );
});

test('ci-web-db helper loads with zero node_modules and rejects invalid hosts/environments BEFORE connecting or mutating PostgreSQL', async () => {
  // 1. Reproduce Windows P0 pre-`npm ci` environment: copy ci-web-db.mjs to an isolated temp directory
  // outside any node_modules tree and prove both ESM import and CLI invocation succeed without `pg`.
  const srcHelper = fileURLToPath(
    new URL('../../scripts/deployment/ci-web-db.mjs', import.meta.url),
  );
  const isolatedNoDepsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'management-lite-no-node-modules-'),
  );
  try {
    const copiedHelper = path.join(isolatedNoDepsDir, 'ci-web-db.mjs');
    fs.copyFileSync(srcHelper, copiedHelper);

    const mod = await import(pathToFileURL(copiedHelper).href);
    assert.equal(typeof mod.assertDisposableGitHubCiHost, 'function');
    assert.equal(typeof mod.verifyDisposableCiPostgresCluster, 'function');

    const cliRun = spawnSync(process.execPath, [copiedHelper, 'prepare'], {
      cwd: isolatedNoDepsDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        CI: 'true',
        RUNNER_OS: 'Windows',
        CI_DATABASE_PASSWORD: 'ci-only-999-1',
      },
    });
    assert.notEqual(cliRun.status, 0);
    const combinedOut = `${cliRun.stdout || ''}\n${cliRun.stderr || ''}`;
    assert.equal(
      combinedOut.includes('Cannot find package'),
      false,
      `ci-web-db.mjs must never fail with ERR_MODULE_NOT_FOUND before preflight checks: ${combinedOut}`,
    );
    assert.match(combinedOut, /SECURITY_VIOLATION_/);
  } finally {
    fs.rmSync(isolatedNoDepsDir, { recursive: true, force: true });
  }

  const {
    prepareWebCiDatabases,
    verifySentinelUntouched,
    cleanupWebCiDatabases,
  } = await import('../../scripts/deployment/ci-web-db.mjs');

  // 2. Prove invalid host/OS/filesystem/env cases are rejected BEFORE opening any DB connection (connectAttempts === 0)
  let connectAttempts = 0;
  const forbidConnect = () => {
    connectAttempts++;
    throw new Error('UNEXPECTED_DB_CONNECTION_ATTEMPT');
  };

  const validLinuxCiEnv = {
    NODE_ENV: 'test',
    GITHUB_ACTIONS: 'true',
    CI: 'true',
    RUNNER_OS: 'Linux',
    GITHUB_RUN_ID: '41933741589',
    GITHUB_RUN_ATTEMPT: '1',
    CI_DATABASE_PASSWORD: 'ci-only-41933741589-1',
    GITHUB_WORKSPACE: '/home/runner/work/management-lite/management-lite',
    RUNNER_TEMP: '/home/runner/work/_temp',
  };

  const validLinuxPaths = new Set([
    '/home/runner/work/management-lite/management-lite',
    '/home/runner/work/_temp',
    '/proc/version',
    path.resolve('/repo', 'dist/packages/database/src/migrator.js'),
    path.resolve('/repo', 'dist/packages/database/src/config.js'),
    path.resolve('/repo', 'apps/web/dist/index.html'),
  ]);

  const preConnectionCases = [
    {
      name: 'Windows host even with forged GitHub Actions env vars',
      env: validLinuxCiEnv,
      runtime: {
        cwd: '/repo',
        platform: 'win32',
        pathExists: (p) => validLinuxPaths.has(p),
        readText: () => 'Linux version 6.8.0-1021-azure',
        createPool: forbidConnect,
      },
      pattern: /SECURITY_VIOLATION_NON_LINUX_HOST/,
    },
    {
      name: 'WSL mount exposing C:\\HoaiPhuong-Server on Linux',
      env: validLinuxCiEnv,
      runtime: {
        cwd: '/repo',
        platform: 'linux',
        pathExists: (p) =>
          p === '/mnt/c/HoaiPhuong-Server' || validLinuxPaths.has(p),
        readText: () => 'Linux version 6.8.0-1021-azure',
        createPool: forbidConnect,
      },
      pattern: /SECURITY_VIOLATION_PRODUCTION_HOST_DETECTED/,
    },
    {
      name: 'WSL2 kernel signature in /proc/version',
      env: validLinuxCiEnv,
      runtime: {
        cwd: '/repo',
        platform: 'linux',
        pathExists: (p) => validLinuxPaths.has(p),
        readText: () =>
          'Linux version 5.15.153.1-microsoft-standard-WSL2 (root@build)',
        createPool: forbidConnect,
      },
      pattern: /SECURITY_VIOLATION_WSL_HOST_FORBIDDEN/,
    },
    {
      name: 'Arbitrary password not bound to GITHUB_RUN_ID',
      env: { ...validLinuxCiEnv, CI_DATABASE_PASSWORD: 'arbitrary-password' },
      runtime: {
        cwd: '/repo',
        platform: 'linux',
        pathExists: (p) => validLinuxPaths.has(p),
        readText: () => 'Linux version 6.8.0-1021-azure',
        createPool: forbidConnect,
      },
      pattern: /SECURITY_VIOLATION_INVALID_CI_DB_TOKEN/,
    },
    {
      name: 'Missing runner workspace directory on filesystem',
      env: validLinuxCiEnv,
      runtime: {
        cwd: '/repo',
        platform: 'linux',
        pathExists: (p) =>
          p !== '/home/runner/work/management-lite/management-lite' &&
          validLinuxPaths.has(p),
        readText: () => 'Linux version 6.8.0-1021-azure',
        createPool: forbidConnect,
      },
      pattern: /SECURITY_VIOLATION_MISSING_RUNNER_FILESYSTEM/,
    },
    {
      name: 'NODE_ENV=production',
      env: { ...validLinuxCiEnv, NODE_ENV: 'production' },
      runtime: {
        cwd: '/repo',
        platform: 'linux',
        pathExists: (p) => validLinuxPaths.has(p),
        readText: () => 'Linux version 6.8.0-1021-azure',
        createPool: forbidConnect,
      },
      pattern: /SECURITY_VIOLATION_PROHIBITED_NODE_ENV/,
    },
    {
      name: 'Missing build artifacts before prepare',
      env: validLinuxCiEnv,
      runtime: {
        cwd: '/empty-unbuilt-repo',
        platform: 'linux',
        pathExists: (p) => validLinuxPaths.has(p),
        readText: () => 'Linux version 6.8.0-1021-azure',
        createPool: forbidConnect,
      },
      pattern: /Required build artifact missing/,
    },
  ];

  for (const tc of preConnectionCases) {
    await assert.rejects(
      () => prepareWebCiDatabases(tc.env, tc.runtime),
      tc.pattern,
      `prepare must reject: ${tc.name}`,
    );
    if (tc.name !== 'Missing build artifacts before prepare') {
      await assert.rejects(
        () => verifySentinelUntouched(tc.env, tc.runtime),
        tc.pattern,
        `verify-sentinel must reject: ${tc.name}`,
      );
      await assert.rejects(
        () => cleanupWebCiDatabases(tc.env, tc.runtime),
        tc.pattern,
        `cleanup must reject: ${tc.name}`,
      );
    }
  }
  assert.equal(
    connectAttempts,
    0,
    'Zero PostgreSQL connection attempts may occur when preflight validation fails',
  );

  // 3. Prove server-side PostgreSQL cluster checks reject Production/Windows clusters on port 55432
  // BEFORE any CREATE DATABASE or DROP DATABASE statement is ever issued!
  const buildMockPoolRuntime = (overrides) => {
    const executedSql = [];
    let ended = false;
    const runtime = {
      cwd: '/repo',
      platform: 'linux',
      pathExists: (p) => validLinuxPaths.has(p),
      readText: () => 'Linux version 6.8.0-1021-azure',
      createPool: () => ({
        query: async (sql) => {
          executedSql.push(String(sql).trim());
          if (sql.includes('SELECT current_user AS usr')) {
            return {
              rows: [
                {
                  usr: overrides.usr ?? 'ci_test',
                  db: overrides.db ?? 'postgres',
                  ver:
                    overrides.ver ??
                    'PostgreSQL 18.1 (Debian 18.1-1.pgdg120+1) on x86_64-pc-linux-gnu, compiled by gcc',
                },
              ],
            };
          }
          if (sql.includes('FROM pg_roles')) {
            return { rows: overrides.roles ?? [] };
          }
          if (sql.includes('FROM pg_database')) {
            return { rows: overrides.databases ?? [] };
          }
          if (sql.includes('FROM pg_tables')) {
            return { rows: [{ cnt: overrides.publicTables ?? 0 }] };
          }
          return { rows: [] };
        },
        end: async () => {
          ended = true;
        },
      }),
    };
    return { runtime, executedSql, isEnded: () => ended };
  };

  const clusterRejectionCases = [
    {
      name: 'Windows PostgreSQL binary listening on port 55432',
      overrides: {
        ver: 'PostgreSQL 18.6, compiled by Visual C++ build 1942, 64-bit',
      },
      pattern: /SECURITY_VIOLATION_NON_LINUX_POSTGRES/,
    },
    {
      name: 'Production role hp_test_admin present in pg_roles',
      overrides: { roles: [{ rolname: 'hp_test_admin' }] },
      pattern: /SECURITY_VIOLATION_PRODUCTION_ROLE_PRESENT/,
    },
    {
      name: 'Production database management_lite present in pg_database',
      overrides: { databases: [{ datname: 'management_lite' }] },
      pattern: /SECURITY_VIOLATION_PRODUCTION_DB_PRESENT/,
    },
    {
      name: 'Unexpected connected user',
      overrides: { usr: 'postgres' },
      pattern: /SECURITY_VIOLATION_UNEXPECTED_PG_IDENTITY/,
    },
    {
      name: 'Non-empty postgres.public schema',
      overrides: { publicTables: 3 },
      pattern: /SECURITY_VIOLATION_NON_EMPTY_ADMIN_DB/,
    },
  ];

  for (const tc of clusterRejectionCases) {
    for (const fn of [prepareWebCiDatabases, cleanupWebCiDatabases]) {
      const mock = buildMockPoolRuntime(tc.overrides);
      await assert.rejects(
        () => fn(validLinuxCiEnv, mock.runtime),
        tc.pattern,
        `${fn.name} must reject cluster: ${tc.name}`,
      );
      const ddlExecuted = mock.executedSql.filter((q) =>
        /\b(?:CREATE|DROP)\s+DATABASE\b/i.test(q),
      );
      assert.deepEqual(
        ddlExecuted,
        [],
        `Zero CREATE/DROP DATABASE statements may execute when cluster check fails (${tc.name})`,
      );
      assert.equal(mock.isEnded(), true, 'Pool must be closed on rejection');
    }
  }

  // 4. Verify positive Linux CI container happy path executes verify -> DDL -> migrate -> sentinel -> cleanup cleanly
  const happyMock = buildMockPoolRuntime({});
  let migratedCount = 0;
  const happyRuntime = {
    ...happyMock.runtime,
    databaseConfigModule: {
      loadTestDatabaseConfig: (e) => ({
        connectionString: e.TEST_DATABASE_URL,
      }),
      assertSafeTestDatabase: () => {},
    },
    databasePoolModule: {
      createDatabasePool: () => ({
        end: async () => {},
      }),
    },
    migratorModule: {
      loadMigrationFiles: () => [{ id: '0001_init' }],
      runMigrations: async () => {
        migratedCount++;
        return { appliedCount: 36, alreadyAppliedCount: 0 };
      },
    },
  };

  await prepareWebCiDatabases(validLinuxCiEnv, happyRuntime);
  assert.equal(migratedCount, 1);
  await verifySentinelUntouched(validLinuxCiEnv, happyRuntime);
  await cleanupWebCiDatabases(validLinuxCiEnv, happyRuntime);

  const happyDdl = happyMock.executedSql.filter((q) =>
    /\b(?:CREATE|DROP)\s+DATABASE\b/i.test(q),
  );
  assert.deepEqual(happyDdl, [
    'DROP DATABASE IF EXISTS web_test_ci_sentinel WITH (FORCE)',
    'DROP DATABASE IF EXISTS web_e2e_ci_test WITH (FORCE)',
    'CREATE DATABASE web_test_ci_sentinel',
    'CREATE DATABASE web_e2e_ci_test',
    'DROP DATABASE IF EXISTS web_e2e_ci_test WITH (FORCE)',
    'DROP DATABASE IF EXISTS web_test_ci_sentinel WITH (FORCE)',
  ]);
});

test('Rollback-Release.ps1 -Simulation fails closed with non-zero exit code, stderr diagnostics, and unchanged pointer across missing-Get-FileHash and normal Windows module environments', async (t) => {
  const crypto = await import('node:crypto');
  const psCandidates =
    process.platform === 'win32' ? ['powershell.exe'] : ['pwsh'];
  const psExe = psCandidates.find(
    (bin) =>
      spawnSync(bin, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion'], {
        encoding: 'utf8',
        timeout: 10_000,
      }).status === 0,
  );
  if (!psExe) {
    t.skip('PowerShell executable not available on this host');
    return;
  }

  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'management-lite-rb-exitcode-qa-'),
  );
  try {
    const rbScript = fileURLToPath(
      new URL('../../scripts/deployment/Rollback-Release.ps1', import.meta.url),
    );
    const managedRoot = path.join(tmpDir, 'managed-root');
    fs.mkdirSync(path.join(managedRoot, 'releases'), { recursive: true });
    fs.mkdirSync(path.join(managedRoot, 'backups'), { recursive: true });
    fs.writeFileSync(
      path.join(managedRoot, '.management-lite-managed-root'),
      'isolated-rb-exitcode-test\n',
    );

    const createReleaseFixture = (
      sha,
      schemaIdentity,
      { tamper = false } = {},
    ) => {
      const relDir = path.join(managedRoot, 'releases', sha);
      fs.mkdirSync(path.join(relDir, 'dist'), { recursive: true });
      const fileBytes = Buffer.from(`// synthetic runtime ${sha}\n`, 'utf8');
      const digest = crypto
        .createHash('sha256')
        .update(fileBytes)
        .digest('hex');
      fs.writeFileSync(
        path.join(relDir, 'dist', 'app.js'),
        tamper
          ? Buffer.from('// tampered after manifest\n', 'utf8')
          : fileBytes,
      );
      fs.writeFileSync(
        path.join(relDir, 'release.json'),
        JSON.stringify(
          {
            sha,
            platform: 'win32',
            arch: 'x64',
            node: '22.14.0',
            schemaIdentity,
            authPolicyVersion: 'auth-remember-01',
            files: [
              {
                path: 'dist/app.js',
                size: fileBytes.length,
                sha256: digest,
              },
            ],
          },
          null,
          2,
        ),
      );
      return relDir;
    };

    const activeSha = 'a'.repeat(40);
    const validTargetSha = 'b'.repeat(40);
    const tamperedTargetSha = 'c'.repeat(40);
    const badSchemaTargetSha = 'd'.repeat(40);

    const activeDir = createReleaseFixture(activeSha, 'schema-0036');
    const validTargetDir = createReleaseFixture(validTargetSha, 'schema-0036');
    createReleaseFixture(tamperedTargetSha, 'schema-0036', { tamper: true });
    createReleaseFixture(badSchemaTargetSha, 'schema-0035-old');

    const pointerFile = path.join(managedRoot, 'simulation-current.txt');
    const stateFile = path.join(managedRoot, 'deployment-state.json');
    fs.writeFileSync(pointerFile, activeDir);

    const cfgPath = path.join(tmpDir, 'sim-config.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          Enabled: true,
          Environment: 'staging',
          AllowSimulation: true,
          Root: managedRoot,
          SimulationSchema: 'schema-0036',
          SimulationAuthPolicy: 'auth-remember-01',
        },
        null,
        2,
      ),
    );

    const readPointer = () => fs.readFileSync(pointerFile, 'utf8').trim();

    // 1. Environment missing Get-FileHash (Utility Get-FileHash unavailable + autoloading disabled)
    const missingGetFileHashCmd = [
      'Import-Module Microsoft.PowerShell.Management, Microsoft.PowerShell.Utility -ErrorAction SilentlyContinue',
      '$uDll = [Microsoft.PowerShell.Commands.ConvertFromJsonCommand].Assembly.Location',
      'Remove-Module Microsoft.PowerShell.Utility -Force -ErrorAction SilentlyContinue',
      'Remove-Item Function:\\Get-FileHash -ErrorAction SilentlyContinue',
      "if ($PSVersionTable.PSEdition -eq 'Desktop' -and $uDll) { Import-Module $uDll -ErrorAction SilentlyContinue }",
      "$PSModuleAutoLoadingPreference = 'None'",
      `& '${rbScript.replace(/'/g, "''")}' -ConfigPath '${cfgPath.replace(/'/g, "''")}' -Sha '${validTargetSha}' -Simulation`,
    ].join('; ');
    const resNoHash = spawnSync(
      psExe,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        missingGetFileHashCmd,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
    assert.notEqual(
      resNoHash.status,
      0,
      `Missing Get-FileHash must never exit 0 (stdout=${resNoHash.stdout} stderr=${resNoHash.stderr})`,
    );
    assert.match(resNoHash.stderr, /Get-FileHash/);
    assert.match(resNoHash.stderr, /ROLLBACK_FAILED_CLOSED/);
    assert.equal(
      readPointer(),
      activeDir,
      'Pointer must remain unchanged when Get-FileHash is unavailable',
    );
    assert.equal(fs.existsSync(stateFile), false);

    // 2. Environment with zero auto-loaded modules at all ($PSModuleAutoLoadingPreference = 'None')
    const zeroModulesCmd = [
      "$PSModuleAutoLoadingPreference = 'None'",
      `& '${rbScript.replace(/'/g, "''")}' -ConfigPath '${cfgPath.replace(/'/g, "''")}' -Sha '${validTargetSha}' -Simulation`,
    ].join('; ');
    const resZeroMod = spawnSync(
      psExe,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', zeroModulesCmd],
      { encoding: 'utf8', timeout: 15_000 },
    );
    assert.notEqual(resZeroMod.status, 0);
    assert.match(resZeroMod.stderr, /ROLLBACK_FAILED_CLOSED/);
    assert.equal(readPointer(), activeDir);
    assert.equal(fs.existsSync(stateFile), false);

    // 3. Normal Windows module environment: file hash mismatch must exit non-zero & preserve pointer
    const resBadHash = spawnSync(
      psExe,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        rbScript,
        '-ConfigPath',
        cfgPath,
        '-Sha',
        tamperedTargetSha,
        '-Simulation',
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
    assert.notEqual(resBadHash.status, 0);
    assert.match(resBadHash.stderr, /integrity failure/i);
    assert.equal(readPointer(), activeDir);
    assert.equal(fs.existsSync(stateFile), false);

    // 4. Normal Windows module environment: schema mismatch must exit non-zero & preserve pointer
    const resBadSchema = spawnSync(
      psExe,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        rbScript,
        '-ConfigPath',
        cfgPath,
        '-Sha',
        badSchemaTargetSha,
        '-Simulation',
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
    assert.notEqual(resBadSchema.status, 0);
    assert.match(
      resBadSchema.stderr,
      /Schema mismatch; migration is manual only/,
    );
    assert.equal(readPointer(), activeDir);
    assert.equal(fs.existsSync(stateFile), false);

    // 5. Normal Windows module environment: valid rollback succeeds with exit code 0, clean stderr, and switches pointer
    const resValid = spawnSync(
      psExe,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        rbScript,
        '-ConfigPath',
        cfgPath,
        '-Sha',
        validTargetSha,
        '-Simulation',
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
    assert.equal(
      resValid.status,
      0,
      `Valid rollback in normal module environment must exit 0 (stderr=${resValid.stderr})`,
    );
    assert.equal(resValid.stderr.trim(), '');
    assert.equal(
      path.resolve(readPointer()),
      path.resolve(validTargetDir),
      'Valid rollback must update simulation-current.txt to target release',
    );
    const recordedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(recordedState.status, 'manual_rollback_completed');
    assert.equal(recordedState.sha, validTargetSha);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
