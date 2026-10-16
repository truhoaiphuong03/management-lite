import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function buildIsolatedTestEnv(overrides = {}) {
  const cleanEnv = { ...process.env };
  for (const key of Object.keys(cleanEnv)) {
    const upper = key.toUpperCase();
    if (upper.startsWith('GITHUB_') || upper.startsWith('RUNNER_')) {
      delete cleanEnv[key];
    }
  }
  for (const key of [
    'GITHUB_ACTIONS',
    'GITHUB_EVENT_NAME',
    'RUNNER_TRACKING_ID',
    'GITHUB_WORKFLOW',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_NUMBER',
    'GITHUB_ACTOR',
    'CI',
    'PAGER',
    'ANTIGRAVITY_AGENT',
    'ANTIGRAVITY_CLI_ALIAS',
    'CODEX_CI',
    'CODEX_SANDBOX',
    'CLAUDE_CODE',
    'CURSOR_TRACE_ID',
  ]) {
    delete cleanEnv[key];
    cleanEnv[key] = '';
  }
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
  cleanEnv.PSModulePath = [
    path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
    path.join(progFiles, 'WindowsPowerShell', 'Modules'),
  ].join(';');
  return {
    ...cleanEnv,
    ...overrides,
  };
}

function normalizePsOutput(stdout = '', stderr = '') {
  return `${stdout}\n${stderr}`.replace(/\r\n?/g, '\n');
}

test('P0 Release Gate Hardening (Windows PowerShell Runtime): blocks non-official GitHub API in production, blocks synthetic CI receipts, blocks test-secrets/server private keys, blocks AI agent self-signing, and supports 1-command Owner approval discovery', async () => {
  assert.equal(
    process.platform,
    'win32',
    'windows-p0-gate.test.mjs requires a real Windows OS environment (never faked or skipped)',
  );

  const controllerPath = fileURLToPath(
    new URL(
      '../../scripts/deployment/Deploy-SemiAutoWindows.ps1',
      import.meta.url,
    ),
  );
  const approvePath = fileURLToPath(
    new URL('../../scripts/deployment/Approve-ReleaseSha.ps1', import.meta.url),
  );

  const tmpRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ml-p0-gate-hardening-'),
  );
  const serverRoot = path.join(tmpRoot, 'server');
  const gateDir = path.join(serverRoot, 'config', 'release-gate');
  const testSecretsKeyDir = path.join(
    serverRoot,
    'config',
    'test-secrets',
    'owner-ed25519',
  );
  const reportsDir = path.join(serverRoot, 'reports');
  const logsDir = path.join(serverRoot, 'logs');
  const externalKeyDir = path.join(tmpRoot, 'owner-external-usb');
  const bundleDir = path.join(tmpRoot, 'bundles');

  for (const d of [
    gateDir,
    testSecretsKeyDir,
    reportsDir,
    logsDir,
    externalKeyDir,
    bundleDir,
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }

  const sha = 'a'.repeat(40);
  const artifactSha = 'b'.repeat(64);
  const schemaSha = 'c'.repeat(64);
  const bundlePath = path.join(bundleDir, `management-lite-full-${sha}.tar.gz`);
  fs.writeFileSync(bundlePath, 'synthetic-bundle-bytes');
  fs.writeFileSync(
    `${bundlePath}.provenance.json`,
    JSON.stringify(
      {
        sha,
        sha256: artifactSha,
        schemaIdentity: schemaSha,
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    path.join(reportsDir, 'approval-watermark.json'),
    JSON.stringify({ last_sequence: 4 }, null, 2),
    'utf8',
  );

  const policyPath = path.join(gateDir, 'release-gate-policy.json');
  const manifestPath = path.join(gateDir, 'approved-release.json');
  const auditLogPath = path.join(gateDir, 'approval-audit.jsonl');
  const externalPrivKey = path.join(
    externalKeyDir,
    'owner-approval-private.pem',
  );
  const latestDeployJson = path.join(reportsDir, 'latest-deployment.json');

  let currentMockSha = sha;
  let currentMockRunId = 99001;
  const mockServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: currentMockRunId,
        run_attempt: 1,
        head_sha: currentMockSha,
        head_branch: 'main',
        status: 'completed',
        conclusion: 'success',
        event: 'workflow_dispatch',
        path: '.github/workflows/deploy.yml',
        html_url: `https://github.com/truhoaiphuong03/management-lite/actions/runs/${currentMockRunId}`,
      }),
    );
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockServer.address().port;
  const mockApiUrl = `http://127.0.0.1:${mockPort}`;

  const runPs = (script, args, envOverrides = {}) =>
    spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      {
        cwd: tmpRoot,
        encoding: 'utf8',
        env: buildIsolatedTestEnv(envOverrides),
      },
    );

  try {
    // 0. Block GitHub Actions Runner self-approval when running in GitHub Actions context (GITHUB_ACTIONS=true / RUNNER_TRACKING_ID / GITHUB_WORKFLOW)
    const runnerKeyGenAttempt = runPs(
      approvePath,
      [
        '-GenerateKeyPairOnly',
        '-KeyOutDir',
        gateDir,
        '-PrivateKeyOutPath',
        externalPrivKey,
      ],
      {
        GITHUB_ACTIONS: 'true',
        RUNNER_TRACKING_ID: 'gh-runner-self-approval-check',
        GITHUB_WORKFLOW: 'Foundation Verification',
      },
    );
    assert.notEqual(
      runnerKeyGenAttempt.status,
      0,
      'Approve-ReleaseSha.ps1 must fail when invoked in GitHub Actions runner context',
    );
    assert.match(
      normalizePsOutput(runnerKeyGenAttempt.stdout, runnerKeyGenAttempt.stderr),
      /SECURITY_VIOLATION_RUNNER_SELF_APPROVAL/,
    );
    assert.equal(
      fs.existsSync(externalPrivKey),
      false,
      'GitHub Actions runner context must never generate an Owner private key file',
    );

    const runnerSignAttempt = runPs(
      approvePath,
      [
        '-ApproveScope',
        '-BaselineSha',
        sha,
        '-PrivateKeyPath',
        externalPrivKey,
        '-PolicyPath',
        policyPath,
        '-ManifestPath',
        manifestPath,
        '-AuditLogPath',
        auditLogPath,
      ],
      {
        GITHUB_ACTIONS: 'true',
      },
    );
    assert.notEqual(
      runnerSignAttempt.status,
      0,
      'Approve-ReleaseSha.ps1 signing must fail when GITHUB_ACTIONS=true',
    );
    assert.match(
      normalizePsOutput(runnerSignAttempt.stdout, runnerSignAttempt.stderr),
      /SECURITY_VIOLATION_RUNNER_SELF_APPROVAL/,
    );
    assert.equal(
      fs.existsSync(manifestPath),
      false,
      'GitHub Actions runner context must never create an approved-release.json manifest',
    );

    // 1. Block AI Agent self-signing / key generation under Owner identity (in isolated non-runner environment)
    const agentAttempt = runPs(
      approvePath,
      [
        '-GenerateKeyPairOnly',
        '-KeyOutDir',
        gateDir,
        '-PrivateKeyOutPath',
        externalPrivKey,
        '-SimulateAgentContext',
      ],
      { PAGER: 'cat', ANTIGRAVITY_AGENT: '1' },
    );
    assert.notEqual(
      agentAttempt.status,
      0,
      'Approve-ReleaseSha.ps1 must fail when invoked in AI Agent context',
    );
    assert.match(
      normalizePsOutput(agentAttempt.stdout, agentAttempt.stderr),
      /SECURITY_VIOLATION_AGENT_SELF_APPROVAL/,
    );
    assert.equal(
      fs.existsSync(externalPrivKey),
      false,
      'AI Agent attempt must not generate private key file',
    );

    // 2. Block private key stored in config/test-secrets during Approve-ReleaseSha.ps1
    const forbiddenTestSecretKey = path.join(
      testSecretsKeyDir,
      'owner-approval-private.pem',
    );
    const badKeyPathAttempt = runPs(approvePath, [
      '-GenerateKeyPairOnly',
      '-KeyOutDir',
      gateDir,
      '-PrivateKeyOutPath',
      forbiddenTestSecretKey,
    ]);
    assert.notEqual(
      badKeyPathAttempt.status,
      0,
      'Approve-ReleaseSha.ps1 must reject private keys located in config/test-secrets',
    );
    assert.match(
      `${badKeyPathAttempt.stdout}\n${badKeyPathAttempt.stderr}`,
      /SECURITY_VIOLATION_PRIVATE_KEY_IN_SERVER_GATE/,
    );

    // 3. 1-Command Owner Ceremony: generate offline keypair and sign via -ArtifactPath auto-discovery
    const genKeyRes = runPs(approvePath, [
      '-GenerateKeyPairOnly',
      '-KeyOutDir',
      gateDir,
      '-PrivateKeyOutPath',
      externalPrivKey,
    ]);
    assert.equal(genKeyRes.status, 0, genKeyRes.stderr || genKeyRes.stdout);

    const oneCmdApprove = runPs(approvePath, [
      '-ArtifactPath',
      bundlePath,
      '-CiRunId',
      '99001',
      '-AllowMigration',
      '-PrivateKeyPath',
      externalPrivKey,
      '-PolicyPath',
      policyPath,
      '-ManifestPath',
      manifestPath,
      '-AuditLogPath',
      auditLogPath,
      '-GitHubApiBaseUrl',
      mockApiUrl,
    ]);
    assert.equal(
      oneCmdApprove.status,
      0,
      oneCmdApprove.stderr || oneCmdApprove.stdout,
    );
    const signedManifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(signedManifest.approved_sha, sha);
    assert.equal(signedManifest.artifact_sha256, artifactSha);
    assert.equal(signedManifest.schema_sha256, schemaSha);
    assert.equal(signedManifest.sequence, 5);
    assert.equal(signedManifest.approved_by, 'Owner');

    // 4. Block deployment if any private key exists under server config/test-secrets
    fs.writeFileSync(
      forbiddenTestSecretKey,
      '-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----\n',
      'utf8',
    );
    const exposedKeyDeploy = runPs(controllerPath, [
      '-CommitSha',
      sha,
      '-CiRunId',
      '99001',
      '-ArtifactPath',
      bundlePath,
      '-ArtifactSha256',
      artifactSha,
      '-ServerRoot',
      serverRoot,
      '-PolicyPath',
      policyPath,
      '-ApprovalManifestPath',
      manifestPath,
      '-SandboxMode',
    ]);
    assert.notEqual(exposedKeyDeploy.status, 0);
    const exposedDeployReport = JSON.parse(
      fs.readFileSync(latestDeployJson, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(
      exposedDeployReport.status,
      'REJECTED_PRIVATE_KEY_EXPOSED_ON_HOST',
    );
    fs.rmSync(forbiddenTestSecretKey, { force: true });

    // 5. Block synthetic/self-created CI receipt (missing generated_at_utc in production mode)
    const ciReceiptPath = path.join(gateDir, `ci-run-receipt-${sha}.json`);
    fs.writeFileSync(
      ciReceiptPath,
      JSON.stringify(
        {
          id: '99001',
          run_id: '99001',
          run_attempt: 1,
          head_sha: sha,
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
    const syntheticReceiptDeploy = runPs(controllerPath, [
      '-CommitSha',
      sha,
      '-CiRunId',
      '99001',
      '-ArtifactPath',
      bundlePath,
      '-ArtifactSha256',
      artifactSha,
      '-CiRunReceiptPath',
      ciReceiptPath,
      '-ServerRoot',
      serverRoot,
      '-PolicyPath',
      policyPath,
      '-ApprovalManifestPath',
      manifestPath,
    ]);
    assert.notEqual(syntheticReceiptDeploy.status, 0);
    const syntheticReceiptReport = JSON.parse(
      fs.readFileSync(latestDeployJson, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(
      syntheticReceiptReport.status,
      'REJECTED_SYNTHETIC_CI_RECEIPT',
    );

    // 6. Hard-lock official https://api.github.com in production mode (reject CLI -GitHubApiBaseUrl and policy github_api_base_url overrides)
    fs.writeFileSync(
      ciReceiptPath,
      JSON.stringify(
        {
          id: '99001',
          run_id: '99001',
          run_attempt: 1,
          head_sha: sha,
          head_branch: 'main',
          workflow_path: '.github/workflows/deploy.yml',
          artifact_sha256: artifactSha,
          schema_sha256: schemaSha,
          status: 'completed',
          conclusion: 'success',
          event: 'workflow_dispatch',
          repository: 'truhoaiphuong03/management-lite',
          generated_at_utc: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
    const fakeApiCliDeploy = runPs(controllerPath, [
      '-CommitSha',
      sha,
      '-CiRunId',
      '99001',
      '-ArtifactPath',
      bundlePath,
      '-ArtifactSha256',
      artifactSha,
      '-CiRunReceiptPath',
      ciReceiptPath,
      '-GitHubApiBaseUrl',
      mockApiUrl,
      '-ServerRoot',
      serverRoot,
      '-PolicyPath',
      policyPath,
      '-ApprovalManifestPath',
      manifestPath,
    ]);
    assert.notEqual(fakeApiCliDeploy.status, 0);
    const fakeApiCliReport = JSON.parse(
      fs.readFileSync(latestDeployJson, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(
      fakeApiCliReport.status,
      'REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION',
    );

    const policyObj = JSON.parse(
      fs.readFileSync(policyPath, 'utf8').replace(/^\uFEFF/, ''),
    );
    policyObj.github_api_base_url = mockApiUrl;
    fs.writeFileSync(policyPath, JSON.stringify(policyObj, null, 2), 'utf8');

    const fakeApiPolicyDeploy = runPs(controllerPath, [
      '-CommitSha',
      sha,
      '-CiRunId',
      '99001',
      '-ArtifactPath',
      bundlePath,
      '-ArtifactSha256',
      artifactSha,
      '-CiRunReceiptPath',
      ciReceiptPath,
      '-ServerRoot',
      serverRoot,
      '-PolicyPath',
      policyPath,
      '-ApprovalManifestPath',
      manifestPath,
    ]);
    assert.notEqual(fakeApiPolicyDeploy.status, 0);
    const fakeApiPolicyReport = JSON.parse(
      fs.readFileSync(latestDeployJson, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(
      fakeApiPolicyReport.status,
      'REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION',
    );

    // 7. OS Kernel Token Elevation Gate: blocks non-elevated caller EVEN WHEN ALL AI Agent env vars are cleared
    const nonElevatedAttempt = runPs(
      approvePath,
      [
        '-GenerateKeyPairOnly',
        '-KeyOutDir',
        gateDir,
        '-PrivateKeyOutPath',
        externalPrivKey,
        '-SimulateNonElevatedCaller',
      ],
      { PAGER: '', ANTIGRAVITY_AGENT: '' },
    );
    assert.notEqual(nonElevatedAttempt.status, 0);
    assert.match(
      `${nonElevatedAttempt.stdout}\n${nonElevatedAttempt.stderr}`,
      /SECURITY_VIOLATION_NON_ELEVATED_CALLER/,
    );

    // 8. One-Time Scoped Approval (SCOPED_WINDOW): enforces baseline lineage, blocks controller/workflow tampering, and enforces max_deployments quota
    const targetRepoDir = path.join(serverRoot, 'apps', 'management-lite');
    fs.mkdirSync(targetRepoDir, { recursive: true });
    const gitTarget = (...args) =>
      execFileSync('git', args, {
        cwd: targetRepoDir,
        encoding: 'utf8',
      }).trim();
    gitTarget('init', '--quiet', '-b', 'main');
    gitTarget('config', 'user.name', 'Synthetic QA');
    gitTarget('config', 'user.email', 'synthetic@isolated.example.test');
    fs.mkdirSync(path.join(targetRepoDir, 'apps', 'web'), { recursive: true });
    fs.mkdirSync(path.join(targetRepoDir, 'scripts', 'deployment'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(targetRepoDir, 'apps', 'web', 'feature.txt'),
      'baseline-v0.1.0',
    );
    gitTarget('add', '.');
    gitTarget('commit', '--quiet', '-m', 'baseline commit');
    const baselineSha = gitTarget('rev-parse', 'HEAD');

    gitTarget('checkout', '--quiet', '--orphan', 'unrelated-branch');
    fs.writeFileSync(
      path.join(targetRepoDir, 'apps', 'web', 'feature.txt'),
      'unrelated',
    );
    gitTarget('add', '.');
    gitTarget('commit', '--quiet', '-m', 'unrelated commit');
    const unrelatedSha = gitTarget('rev-parse', 'HEAD');

    gitTarget('checkout', '--quiet', 'main');
    fs.writeFileSync(
      path.join(targetRepoDir, 'scripts', 'deployment', 'tamper.ps1'),
      '# tamper',
    );
    gitTarget('add', '.');
    gitTarget('commit', '--quiet', '-m', 'tamper controller commit');
    const tamperControllerSha = gitTarget('rev-parse', 'HEAD');

    gitTarget('checkout', '--quiet', '-f', baselineSha);

    const scopeApproveRes = runPs(approvePath, [
      '-ApproveScope',
      '-BaselineSha',
      baselineSha,
      '-MaxDeployments',
      '2',
      '-ExpiresInHours',
      '168',
      '-Sequence',
      '10',
      '-PrivateKeyPath',
      externalPrivKey,
      '-PolicyPath',
      policyPath,
      '-ManifestPath',
      manifestPath,
      '-AuditLogPath',
      auditLogPath,
    ]);
    assert.equal(
      scopeApproveRes.status,
      0,
      scopeApproveRes.stderr || scopeApproveRes.stdout,
    );
    const scopedManifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(scopedManifest.approval_mode, 'SCOPED_WINDOW');
    assert.equal(scopedManifest.baseline_sha, baselineSha);
    assert.equal(scopedManifest.max_deployments, 2);
    assert.equal(scopedManifest.allow_migration, false);
    assert.equal(scopedManifest.allow_controller_changes, false);

    const writeScopedReceipt = (targetSha, runId) => {
      const p = path.join(gateDir, `ci-run-receipt-${targetSha}.json`);
      fs.writeFileSync(
        p,
        JSON.stringify(
          {
            id: String(runId),
            run_id: String(runId),
            run_attempt: 1,
            head_sha: targetSha,
            head_branch: 'main',
            workflow_path: '.github/workflows/deploy.yml',
            artifact_sha256: artifactSha,
            schema_sha256: schemaSha,
            status: 'completed',
            conclusion: 'success',
            event: 'workflow_dispatch',
            repository: 'truhoaiphuong03/management-lite',
            generated_at_utc: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );
      return p;
    };

    const { execFile } = await import('node:child_process');
    const runPsAsync = (script, args, envOverrides = {}) =>
      new Promise((resolve) => {
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            script,
            ...args,
          ],
          {
            cwd: tmpRoot,
            encoding: 'utf8',
            env: buildIsolatedTestEnv(envOverrides),
          },
          (err, stdout, stderr) => {
            resolve({
              status: err ? err.code || 1 : 0,
              stdout: stdout || '',
              stderr: stderr || '',
            });
          },
        );
      });

    currentMockSha = unrelatedSha;
    currentMockRunId = 99002;

    const unrelatedReceipt = writeScopedReceipt(unrelatedSha, 99002);
    const outOfLineageRes = await runPsAsync(controllerPath, [
      '-CommitSha',
      unrelatedSha,
      '-CiRunId',
      '99002',
      '-ArtifactPath',
      bundlePath,
      '-ArtifactSha256',
      artifactSha,
      '-CiRunReceiptPath',
      unrelatedReceipt,
      '-GitHubApiBaseUrl',
      mockApiUrl,
      '-ServerRoot',
      serverRoot,
      '-TargetDir',
      targetRepoDir,
      '-PolicyPath',
      policyPath,
      '-ApprovalManifestPath',
      manifestPath,
      '-SandboxMode',
    ]);
    assert.notEqual(outOfLineageRes.status, 0);
    const outOfLineageReport = JSON.parse(
      fs.readFileSync(latestDeployJson, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(outOfLineageReport.status, 'REJECTED_OUT_OF_SCOPE_LINEAGE');

    currentMockSha = tamperControllerSha;
    currentMockRunId = 99003;
    const tamperReceipt = writeScopedReceipt(tamperControllerSha, 99003);
    const outOfScopePathRes = await runPsAsync(controllerPath, [
      '-CommitSha',
      tamperControllerSha,
      '-CiRunId',
      '99003',
      '-ArtifactPath',
      bundlePath,
      '-ArtifactSha256',
      artifactSha,
      '-CiRunReceiptPath',
      tamperReceipt,
      '-GitHubApiBaseUrl',
      mockApiUrl,
      '-ServerRoot',
      serverRoot,
      '-TargetDir',
      targetRepoDir,
      '-PolicyPath',
      policyPath,
      '-ApprovalManifestPath',
      manifestPath,
      '-SandboxMode',
    ]);
    assert.notEqual(outOfScopePathRes.status, 0);
    const outOfScopePathReport = JSON.parse(
      fs.readFileSync(latestDeployJson, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(
      outOfScopePathReport.status,
      'REJECTED_OUT_OF_SCOPE_PATH_MODIFICATION',
    );

    execFileSync('git', ['checkout', '--quiet', '-B', 'main', baselineSha], {
      cwd: targetRepoDir,
    });
    fs.mkdirSync(path.join(targetRepoDir, 'database', 'migrations'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(targetRepoDir, 'database', 'migrations', '0099_unapproved.sql'),
      'SELECT 1;\n',
      'utf8',
    );
    execFileSync('git', ['add', 'database/migrations/0099_unapproved.sql'], {
      cwd: targetRepoDir,
    });
    execFileSync(
      'git',
      ['commit', '--quiet', '-m', 'unapproved migration change'],
      { cwd: targetRepoDir },
    );
    const unapprovedMigSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: targetRepoDir,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['checkout', '--quiet', '-f', baselineSha], {
      cwd: targetRepoDir,
    });
    currentMockSha = unapprovedMigSha;
    currentMockRunId = 99004;
    const migReceipt = writeScopedReceipt(unapprovedMigSha, 99004);
    const unapprovedMigRes = await runPsAsync(controllerPath, [
      '-CommitSha',
      unapprovedMigSha,
      '-CiRunId',
      '99004',
      '-ArtifactPath',
      bundlePath,
      '-ArtifactSha256',
      artifactSha,
      '-CiRunReceiptPath',
      migReceipt,
      '-GitHubApiBaseUrl',
      mockApiUrl,
      '-ServerRoot',
      serverRoot,
      '-TargetDir',
      targetRepoDir,
      '-PolicyPath',
      policyPath,
      '-ApprovalManifestPath',
      manifestPath,
      '-SandboxMode',
    ]);
    assert.notEqual(unapprovedMigRes.status, 0);
    const unapprovedMigReport = JSON.parse(
      fs.readFileSync(latestDeployJson, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(unapprovedMigReport.status, 'REJECTED_UNAPPROVED_MIGRATION');

    const liveGhRes = await runPsAsync(controllerPath, [
      '-CommitSha',
      tamperControllerSha,
      '-CiRunId',
      '99003',
      '-ArtifactPath',
      bundlePath,
      '-ArtifactSha256',
      artifactSha,
      '-CiRunReceiptPath',
      tamperReceipt,
      '-GitHubApiBaseUrl',
      'https://api.github.com',
      '-ServerRoot',
      serverRoot,
      '-TargetDir',
      targetRepoDir,
      '-PolicyPath',
      policyPath,
      '-ApprovalManifestPath',
      manifestPath,
      '-SandboxMode',
    ]);
    assert.notEqual(liveGhRes.status, 0);
    const liveGhReport = JSON.parse(
      fs.readFileSync(latestDeployJson, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(
      liveGhReport.status,
      'REJECTED_GITHUB_API_CI_VERIFICATION_FAILED',
    );

    currentMockSha = tamperControllerSha;
    currentMockRunId = 99003;
    fs.writeFileSync(
      path.join(reportsDir, 'approval-watermark.json'),
      JSON.stringify(
        {
          last_sequence: 10,
          approval_mode: 'SCOPED_WINDOW',
          scoped_deployments_used: 2,
          deployed_runs: [`${baselineSha}:99000`, `${baselineSha}:99001`],
        },
        null,
        2,
      ),
      'utf8',
    );
    const quotaExceededRes = await runPsAsync(controllerPath, [
      '-CommitSha',
      tamperControllerSha,
      '-CiRunId',
      '99003',
      '-ArtifactPath',
      bundlePath,
      '-ArtifactSha256',
      artifactSha,
      '-CiRunReceiptPath',
      tamperReceipt,
      '-GitHubApiBaseUrl',
      mockApiUrl,
      '-ServerRoot',
      serverRoot,
      '-TargetDir',
      targetRepoDir,
      '-PolicyPath',
      policyPath,
      '-ApprovalManifestPath',
      manifestPath,
      '-SandboxMode',
    ]);
    assert.notEqual(quotaExceededRes.status, 0);
    const quotaExceededReport = JSON.parse(
      fs.readFileSync(latestDeployJson, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(quotaExceededReport.status, 'REJECTED_SCOPE_QUOTA_EXCEEDED');
  } finally {
    await new Promise((resolve) => mockServer.close(resolve));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Live NTFS ACL isolation (OWNER RIGHTS:RX + Parent DC removal), operational continuity, and Invoke-OwnerP0Setup.ps1 transactional rollback', () => {
  assert.equal(
    process.platform,
    'win32',
    'Live NTFS ACL test requires a real Windows OS environment',
  );

  const sbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-live-acl-p0-'));
  const sbServer = path.join(sbRoot, 'server');
  const sbVault = path.join(sbRoot, 'vault');
  for (const rel of [
    'config/release-gate',
    'config/services',
    'config/test-secrets/owner-ed25519',
    'config/npm-cache',
    'scripts',
    'runner',
    'apps/management-lite/scripts/deployment',
    'apps/management-lite/dist',
    'database/postgres-test',
    'logs',
    'reports',
    'backups/management-lite',
    'releases',
    'workspace',
  ]) {
    fs.mkdirSync(path.join(sbServer, rel), { recursive: true });
  }
  spawnSync(
    'icacls.exe',
    [path.join(sbServer, 'logs'), '/grant', '*S-1-5-19:(OI)(CI)M'],
    { encoding: 'utf8' },
  );

  const polFile = path.join(
    sbServer,
    'config/release-gate/release-gate-policy.json',
  );
  const manFile = path.join(
    sbServer,
    'config/release-gate/approved-release.json',
  );
  const synFile = path.join(
    sbServer,
    'config/release-gate/ci-run-receipt-fbb69409d00f43d0c36854730332e319cedb49ec.json',
  );
  const tmpKeyFile = path.join(
    sbServer,
    'config/test-secrets/owner-ed25519/owner-approval-private.pem',
  );
  const legacyPlainPat = path.join(
    sbServer,
    'config/test-secrets/github-ci-token.txt',
  );
  const svcFile = path.join(
    sbServer,
    'config/services/HPManagementLiteApi.xml',
  );
  const webScriptFile = path.join(sbServer, 'scripts/serve-management-web.cjs');
  fs.writeFileSync(polFile, '{"old":true}', 'utf8');
  fs.writeFileSync(manFile, '{"old_manifest":true}', 'utf8');
  fs.writeFileSync(synFile, '{"synthetic_local":true}', 'utf8');
  fs.writeFileSync(tmpKeyFile, 'DUMMY-TEMP-KEY', 'utf8');
  fs.writeFileSync(legacyPlainPat, 'LEGACY-PLAINTEXT-TOKEN', 'utf8');
  fs.writeFileSync(svcFile, '<service>original</service>', 'utf8');
  fs.writeFileSync(
    webScriptFile,
    'process.stdout.write("WEB_SERVICE_OK");\n',
    'utf8',
  );

  const setupScript = fileURLToPath(
    new URL(
      '../../scripts/deployment/Invoke-OwnerP0Setup.ps1',
      import.meta.url,
    ),
  );
  const devRepoDir = fileURLToPath(new URL('../..', import.meta.url));

  // 0. When invoked inside a GitHub Actions runner context (GITHUB_ACTIONS=true), Invoke-OwnerP0Setup.ps1 must reject Owner self-approval and roll back
  const runnerSetupRes = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      setupScript,
      '-ServerRoot',
      sbServer,
      '-OwnerVaultDir',
      sbVault,
      '-DevRepoDir',
      devRepoDir,
      '-SkipGitHubPatPrompt',
      '-SandboxMode',
    ],
    {
      encoding: 'utf8',
      env: buildIsolatedTestEnv({
        GITHUB_ACTIONS: 'true',
        RUNNER_TRACKING_ID: 'gh-runner-setup-check',
        GITHUB_WORKFLOW: 'Foundation Verification',
      }),
    },
  );
  assert.notEqual(runnerSetupRes.status, 0);
  assert.match(
    normalizePsOutput(runnerSetupRes.stdout, runnerSetupRes.stderr),
    /SECURITY_VIOLATION_RUNNER_SELF_APPROVAL/,
  );
  assert.equal(
    fs
      .readFileSync(polFile, 'utf8')
      .replace(/^\uFEFF/, '')
      .trim(),
    '{"old":true}',
  );
  assert.equal(fs.existsSync(tmpKeyFile), true);

  // 1. Transactional rollback on error in isolated environment preserves original policy, manifest, and temporary key
  const rbRes = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      setupScript,
      '-ServerRoot',
      sbServer,
      '-OwnerVaultDir',
      sbVault,
      '-DevRepoDir',
      devRepoDir,
      '-SkipGitHubPatPrompt',
      '-SandboxMode',
      '-SimulateFailureAfterKeyGen',
    ],
    { encoding: 'utf8', env: buildIsolatedTestEnv() },
  );
  assert.notEqual(rbRes.status, 0);
  assert.match(
    normalizePsOutput(rbRes.stdout, rbRes.stderr),
    /P0_SETUP_FAILED_AND_ROLLED_BACK/,
  );
  assert.equal(
    fs
      .readFileSync(polFile, 'utf8')
      .replace(/^\uFEFF/, '')
      .trim(),
    '{"old":true}',
  );
  assert.equal(fs.existsSync(tmpKeyFile), true);

  // 2. Full setup in isolated environment succeeds, defaults MaxDeployments=10, ExpiresInHours=168, allow_migration=false, deletes temp key, synthetic receipt & legacy plaintext token, and locks NTFS ACLs
  const okRes = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      setupScript,
      '-ServerRoot',
      sbServer,
      '-OwnerVaultDir',
      sbVault,
      '-DevRepoDir',
      devRepoDir,
      '-SkipGitHubPatPrompt',
      '-SandboxMode',
    ],
    { encoding: 'utf8', env: buildIsolatedTestEnv() },
  );
  assert.equal(okRes.status, 0, `${okRes.stdout}\n${okRes.stderr}`);
  const manifest = JSON.parse(
    fs.readFileSync(manFile, 'utf8').replace(/^\uFEFF/, ''),
  );
  assert.equal(manifest.approval_mode, 'SCOPED_WINDOW');
  assert.equal(manifest.max_deployments, 10);
  assert.equal(manifest.allow_migration, false);
  assert.equal(manifest.allow_controller_changes, false);
  assert.equal(fs.existsSync(tmpKeyFile), false);
  assert.equal(fs.existsSync(synFile), false);
  assert.equal(fs.existsSync(legacyPlainPat), false);

  // 3. Live OS account & Windows UAC LUA_TOKEN kernel verification:
  // Impersonate a Windows UAC filtered LUA_TOKEN (CreateRestrictedToken with LUA_TOKEN | DISABLE_MAX_PRIVILEGE = 0x5)
  // so that whether this test runs under a non-elevated account (DESKTOP-8T8UHTS\ADMIN) or an elevated CI runner (windows-latest),
  // the Windows NTFS kernel evaluates the exact non-elevated user SID + OWNER RIGHTS:RX against the locked NTFS ACLs.
  const lockedControllerFile = path.join(
    sbServer,
    'config/release-gate/controllers/Deploy-SemiAutoWindows.ps1',
  );
  const gatePath = path.join(sbServer, 'config/release-gate');
  const configPath = path.join(sbServer, 'config');
  const luaVerifyPs = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
public class LuaNtfsKernelVerifier {
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool CreateRestrictedToken(IntPtr ExistingTokenHandle, uint Flags, uint DisableSidCount, IntPtr SidsToDisable, uint DeletePrivilegeCount, IntPtr PrivilegesToDelete, uint RestrictedSidCount, IntPtr SidsToRestrict, out IntPtr NewTokenHandle);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool ImpersonateLoggedOnUser(IntPtr hToken);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool RevertToSelf();
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr hObject);

  private static bool IsDenied(Action act) {
    try {
      act();
      return false;
    } catch (Exception ex) {
      return (ex is UnauthorizedAccessException) || (ex is IOException);
    }
  }

  public static string VerifyAllBlocked(string polFile, string manFile, string svcFile, string webScriptFile, string controllerFile, string gateDir, string configDir, string userName) {
    IntPtr hProc = System.Diagnostics.Process.GetCurrentProcess().Handle;
    IntPtr hTok = IntPtr.Zero;
    IntPtr hLua = IntPtr.Zero;
    if (!OpenProcessToken(hProc, 0x000A, out hTok)) return "OPEN_TOKEN_FAILED";
    if (!CreateRestrictedToken(hTok, 0x5, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out hLua)) return "CREATE_LUA_FAILED";
    if (!ImpersonateLoggedOnUser(hLua)) return "IMPERSONATE_FAILED";
    try {
      bool bPolWrite = IsDenied(() => File.WriteAllText(polFile, "{}"));
      bool bManWrite = IsDenied(() => File.WriteAllText(manFile, "{}"));
      bool bPolDel = IsDenied(() => File.Delete(polFile));
      bool bGateRen = IsDenied(() => Directory.Move(gateDir, gateDir + "-hijack"));
      bool bCfgRen = IsDenied(() => Directory.Move(configDir, configDir + "-hijack"));
      bool bSvcWrite = IsDenied(() => File.WriteAllText(svcFile, "hijack"));
      bool bWebWrite = IsDenied(() => File.WriteAllText(webScriptFile, "hijack"));
      bool bCtrlWrite = IsDenied(() => File.WriteAllText(controllerFile, "hijack"));
      bool bAclGrant = IsDenied(() => {
        DirectorySecurity ds = Directory.GetAccessControl(gateDir);
        ds.AddAccessRule(new FileSystemAccessRule(userName, FileSystemRights.FullControl, AccessControlType.Allow));
        Directory.SetAccessControl(gateDir, ds);
      });
      return string.Format("{0},{1},{2},{3},{4},{5},{6},{7},{8}", bPolWrite, bManWrite, bPolDel, bGateRen, bCfgRen, bSvcWrite, bWebWrite, bCtrlWrite, bAclGrant);
    } finally {
      RevertToSelf();
      CloseHandle(hLua);
      CloseHandle(hTok);
    }
  }
}
'@
$u = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$res = [LuaNtfsKernelVerifier]::VerifyAllBlocked('${polFile.replaceAll("'", "''")}', '${manFile.replaceAll("'", "''")}', '${svcFile.replaceAll("'", "''")}', '${webScriptFile.replaceAll("'", "''")}', '${lockedControllerFile.replaceAll("'", "''")}', '${gatePath.replaceAll("'", "''")}', '${configPath.replaceAll("'", "''")}', $u)
Write-Output "LUA_VERIFY=$res"
`;
  const luaRes = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', luaVerifyPs],
    { encoding: 'utf8', env: buildIsolatedTestEnv() },
  );
  assert.equal(luaRes.status, 0, `${luaRes.stdout}\n${luaRes.stderr}`);
  assert.match(
    luaRes.stdout,
    /LUA_VERIFY=True,True,True,True,True,True,True,True,True/,
    `Expected all 9 NTFS kernel tamper attempts to be blocked under LUA token, got: ${luaRes.stdout}`,
  );

  // 4. Operational continuity verification:
  const execWebScript = spawnSync(process.execPath, [webScriptFile], {
    encoding: 'utf8',
    env: buildIsolatedTestEnv(),
  });
  assert.equal(execWebScript.status, 0);
  assert.equal(execWebScript.stdout, 'WEB_SERVICE_OK');

  const logsAclOut = spawnSync('icacls.exe', [path.join(sbServer, 'logs')], {
    encoding: 'utf8',
    env: buildIsolatedTestEnv(),
  });
  assert.match(logsAclOut.stdout, /LOCAL SERVICE:\(OI\)\(CI\)\(M\)/i);

  fs.writeFileSync(
    path.join(sbServer, 'apps/management-lite/dist/ok.txt'),
    'ok',
    'utf8',
  );
  fs.writeFileSync(
    path.join(
      sbServer,
      'apps/management-lite/scripts/deployment/git-checkout-test.txt',
    ),
    'writable-for-git-checkout',
    'utf8',
  );
  fs.writeFileSync(path.join(sbServer, 'logs/service.log'), 'log-ok', 'utf8');
  fs.writeFileSync(
    path.join(sbServer, 'backups/management-lite/backup.dump'),
    'dump-ok',
    'utf8',
  );
  fs.writeFileSync(
    path.join(sbServer, 'config/npm-cache/cache.txt'),
    'cache-ok',
    'utf8',
  );
});

test('SCOPED_WINDOW enforces max 10 deployments / 7 days and verifies DPAPI PAT minimum permissions', async () => {
  assert.equal(
    process.platform,
    'win32',
    'DPAPI & GCM PAT verification test requires a real Windows OS environment',
  );

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-pat-dpapi-'));
  const approveScript = fileURLToPath(
    new URL('../../scripts/deployment/Approve-ReleaseSha.ps1', import.meta.url),
  );
  const setupScript = fileURLToPath(
    new URL(
      '../../scripts/deployment/Invoke-OwnerP0Setup.ps1',
      import.meta.url,
    ),
  );
  const devRepoDir = fileURLToPath(new URL('../..', import.meta.url));

  const gateDir = path.join(tmpRoot, 'gate');
  const keyVault = path.join(tmpRoot, 'vault');
  const privKey = path.join(keyVault, 'owner-approval-private.pem');
  const genRes = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      approveScript,
      '-GenerateKeyPairOnly',
      '-KeyOutDir',
      gateDir,
      '-PrivateKeyOutPath',
      privKey,
      '-SandboxMode',
    ],
    { encoding: 'utf8', env: buildIsolatedTestEnv() },
  );
  assert.equal(genRes.status, 0, `${genRes.stdout}\n${genRes.stderr}`);

  const overDeploysRes = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      approveScript,
      '-ApproveScope',
      '-BaselineSha',
      'fbb69409d00f43d0c36854730332e319cedb49ec',
      '-MaxDeployments',
      '11',
      '-PrivateKeyPath',
      privKey,
      '-PolicyPath',
      path.join(gateDir, 'release-gate-policy.json'),
      '-ManifestPath',
      path.join(gateDir, 'approved-release.json'),
      '-AuditLogPath',
      path.join(gateDir, 'approval-audit.jsonl'),
      '-SandboxMode',
    ],
    { encoding: 'utf8', env: buildIsolatedTestEnv() },
  );
  assert.notEqual(overDeploysRes.status, 0);
  assert.match(
    normalizePsOutput(overDeploysRes.stdout, overDeploysRes.stderr),
    /between 1 and 10 deployments/,
  );

  const overDaysRes = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      approveScript,
      '-ApproveScope',
      '-BaselineSha',
      'fbb69409d00f43d0c36854730332e319cedb49ec',
      '-MaxDeployments',
      '10',
      '-ExpiresInHours',
      '169',
      '-PrivateKeyPath',
      privKey,
      '-PolicyPath',
      path.join(gateDir, 'release-gate-policy.json'),
      '-ManifestPath',
      path.join(gateDir, 'approved-release.json'),
      '-AuditLogPath',
      path.join(gateDir, 'approval-audit.jsonl'),
      '-SandboxMode',
    ],
    { encoding: 'utf8', env: buildIsolatedTestEnv() },
  );
  assert.notEqual(overDaysRes.status, 0);
  assert.match(
    normalizePsOutput(overDaysRes.stdout, overDaysRes.stderr),
    /Maximum allowed duration is 7 days/,
  );

  let tokenMode = 'VALID_FINE_GRAINED';
  const mockGh = http.createServer((req, res) => {
    if (req.url === '/repos/truhoaiphuong03/management-lite') {
      if (tokenMode === 'EXCESSIVE_CLASSIC_SCOPE') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-OAuth-Scopes': 'repo, delete_repo, admin:org',
        });
        res.end(
          JSON.stringify({
            full_name: 'truhoaiphuong03/management-lite',
            private: true,
            permissions: { pull: true, push: true, admin: true },
          }),
        );
        return;
      }
      if (tokenMode === 'MISSING_PUSH') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            full_name: 'truhoaiphuong03/management-lite',
            private: true,
            permissions: { pull: true, push: false, admin: false },
          }),
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          full_name: 'truhoaiphuong03/management-lite',
          private: true,
          permissions: { pull: true, push: true, admin: false },
        }),
      );
      return;
    }
    if (
      req.url ===
        '/repos/truhoaiphuong03/management-lite/actions/workflows/deploy.yml' ||
      req.url ===
        '/repos/truhoaiphuong03/management-lite/actions/workflows/foundation.yml'
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 1001,
          name: 'Management Lite CI',
          path: req.url.endsWith('foundation.yml')
            ? '.github/workflows/foundation.yml'
            : '.github/workflows/deploy.yml',
          state: 'active',
        }),
      );
      return;
    }
    if (
      req.url.startsWith('/repos/truhoaiphuong03/management-lite/actions/runs')
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ total_count: 5, workflow_runs: [] }));
      return;
    }
    if (
      req.url.startsWith(
        '/repos/truhoaiphuong03/management-lite/actions/artifacts',
      )
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ total_count: 2, artifacts: [] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => mockGh.listen(0, '127.0.0.1', resolve));
  const port = mockGh.address().port;
  const apiUrl = `http://127.0.0.1:${port}`;

  try {
    const sbServer = path.join(tmpRoot, 'server');
    const sbVault = path.join(tmpRoot, 'owner-vault');
    for (const rel of [
      'config/release-gate',
      'config/services',
      'scripts',
      'runner',
      'apps/management-lite/scripts/deployment',
      'logs',
      'reports',
      'backups/management-lite',
    ]) {
      fs.mkdirSync(path.join(sbServer, rel), { recursive: true });
    }

    const { execFile } = await import('node:child_process');
    const runPsCmdAsync = (cmd, envOverrides = {}) =>
      new Promise((resolve) => {
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            cmd,
          ],
          { encoding: 'utf8', env: buildIsolatedTestEnv(envOverrides) },
          (error, stdout, stderr) => {
            resolve({
              status:
                error && typeof error.code === 'number'
                  ? error.code
                  : error
                    ? 1
                    : 0,
              stdout: stdout || '',
              stderr: stderr || '',
            });
          },
        );
      });

    tokenMode = 'EXCESSIVE_CLASSIC_SCOPE';
    const excRes = await runPsCmdAsync(
      `$sec = ConvertTo-SecureString 'ghp_test_excessive' -AsPlainText -Force; & '${setupScript}' -ServerRoot '${sbServer}' -OwnerVaultDir '${sbVault}' -DevRepoDir '${devRepoDir}' -GitHubApiBaseUrl '${apiUrl}' -GitHubPatSecure $sec -SandboxMode`,
    );
    assert.notEqual(excRes.status, 0);
    assert.match(
      normalizePsOutput(excRes.stdout, excRes.stderr),
      /GITHUB_PAT_EXCESSIVE_PERMISSIONS/,
    );

    tokenMode = 'MISSING_PUSH';
    const noPushRes = await runPsCmdAsync(
      `$sec = ConvertTo-SecureString 'github_pat_no_push' -AsPlainText -Force; & '${setupScript}' -ServerRoot '${sbServer}' -OwnerVaultDir '${sbVault}' -DevRepoDir '${devRepoDir}' -GitHubApiBaseUrl '${apiUrl}' -GitHubPatSecure $sec -SandboxMode`,
    );
    assert.notEqual(noPushRes.status, 0);
    assert.match(
      normalizePsOutput(noPushRes.stdout, noPushRes.stderr),
      /GITHUB_PAT_INSUFFICIENT_PUSH_PERMISSION/,
    );

    tokenMode = 'VALID_FINE_GRAINED';
    const validRes = await runPsCmdAsync(
      `$sec = ConvertTo-SecureString 'github_pat_minimal_valid_token' -AsPlainText -Force; & '${setupScript}' -ServerRoot '${sbServer}' -OwnerVaultDir '${sbVault}' -DevRepoDir '${devRepoDir}' -GitHubApiBaseUrl '${apiUrl}' -GitHubPatSecure $sec -SandboxMode`,
    );
    assert.equal(validRes.status, 0, `${validRes.stdout}\n${validRes.stderr}`);
    const dpapiFile = path.join(
      sbServer,
      'config/release-gate/github-pat.dpapi',
    );
    assert.equal(fs.existsSync(dpapiFile), true);
    const cipherContent = fs.readFileSync(dpapiFile, 'utf8').trim();
    assert.equal(
      cipherContent.includes('github_pat_minimal_valid_token'),
      false,
      'DPAPI file must never contain plaintext token',
    );
    assert.match(
      cipherContent,
      /^01000000d08c9ddf/i,
      'File must be valid Windows DPAPI blob',
    );

    const verifyPatScript = fileURLToPath(
      new URL(
        '../../scripts/deployment/Verify-GitHubPatAndLiveCi.ps1',
        import.meta.url,
      ),
    );
    const stagedDpapi = path.join(tmpRoot, 'staged-github-pat.dpapi');
    const patReport = path.join(tmpRoot, 'pat-verify-report.json');

    const mainBlockedRes = await runPsCmdAsync(
      `$sec = ConvertTo-SecureString 'github_pat_gcm_roundtrip_secret_99' -AsPlainText -Force; & '${verifyPatScript}' -SourceBranch 'main' -DpapiTokenPath '${stagedDpapi}' -ReportOutPath '${patReport}' -GitHubApiBaseUrl '${apiUrl}' -GitHubPatSecure $sec -SkipLiveCiTrigger -SandboxMode`,
    );
    assert.notEqual(mainBlockedRes.status, 0);
    assert.match(
      normalizePsOutput(mainBlockedRes.stdout, mainBlockedRes.stderr),
      /FORBIDDEN_MAIN_BRANCH_PUSH/,
    );

    const patVerifyRes = await runPsCmdAsync(
      `$sec = ConvertTo-SecureString 'github_pat_gcm_roundtrip_secret_99' -AsPlainText -Force; & '${verifyPatScript}' -DpapiTokenPath '${stagedDpapi}' -ReportOutPath '${patReport}' -GitHubApiBaseUrl '${apiUrl}' -GitHubPatSecure $sec -SkipLiveCiTrigger -SandboxMode`,
    );
    assert.equal(
      patVerifyRes.status,
      0,
      `${patVerifyRes.stdout}\n${patVerifyRes.stderr}`,
    );
    assert.equal(
      normalizePsOutput(patVerifyRes.stdout, patVerifyRes.stderr).includes(
        'github_pat_gcm_roundtrip_secret_99',
      ),
      false,
      'Token must never be printed to stdout or stderr',
    );
    const reportObj = JSON.parse(
      fs.readFileSync(patReport, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(reportObj.target_dev_branch, 'anty/dev-complete-rc');
    assert.equal(reportObj.main_branch_pushed, false);
    assert.equal(reportObj.dpapi_blob_verified, true);
    assert.equal(reportObj.gcm_wincred_verified, true);
    assert.equal(reportObj.plaintext_cred_exists, false);
    assert.equal(reportObj.token_logged_or_printed, false);
  } finally {
    await new Promise((resolve) => mockGh.close(resolve));
  }
});
