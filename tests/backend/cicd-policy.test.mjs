import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
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

test('Option 1 CI/CD architecture: automatic CI on push/PR without deploy, single artifact builder, zero self-hosted runner', () => {
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
  for (const file of files) {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    assert.equal(
      content.includes('self-hosted'),
      false,
      `Workflow ${file} must not dispatch jobs to self-hosted Windows runner under Option 1`,
    );
    if (file === 'foundation.yml') {
      assert.equal(
        /^\s*push\s*:/m.test(content) && /^\s*pull_request\s*:/m.test(content),
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
  const controllerCode = fs.readFileSync(controllerPath, 'utf8');
  assert.equal(
    controllerCode.includes('npm run build'),
    false,
    'Deploy-SemiAutoWindows.ps1 must never fall back to local host compilation (npm run build)',
  );
  assert.equal(
    controllerCode.includes('REJECTED_ARTIFACT_MISSING') &&
      controllerCode.includes('REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED') &&
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
});

test('P0 Release Gate Hardening: blocks non-official GitHub API in production, blocks synthetic CI receipts, blocks test-secrets/server private keys, blocks AI agent self-signing, and supports 1-command Owner approval discovery', async () => {
  const http = await import('node:http');
  const controllerPath = fileURLToPath(
    new URL(
      '../../scripts/deployment/Deploy-SemiAutoWindows.ps1',
      import.meta.url,
    ),
  );
  const approvePath = fileURLToPath(
    new URL('../../scripts/deployment/Approve-ReleaseSha.ps1', import.meta.url),
  );
  const controllerCode = fs.readFileSync(controllerPath, 'utf8');
  const approveCode = fs.readFileSync(approvePath, 'utf8');

  // 1. Static guard verification
  assert.equal(
    controllerCode.includes('REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION') &&
      controllerCode.includes('REJECTED_SYNTHETIC_CI_RECEIPT') &&
      controllerCode.includes('REJECTED_PRIVATE_KEY_EXPOSED_ON_HOST') &&
      controllerCode.includes('config\\test-secrets'),
    true,
    'Deploy-SemiAutoWindows.ps1 must enforce official GitHub API in production, reject synthetic CI receipts, and recursively scan config\\test-secrets for exposed private keys',
  );
  assert.equal(
    approveCode.includes('SECURITY_VIOLATION_AGENT_SELF_APPROVAL') &&
      approveCode.includes('SECURITY_VIOLATION_PRIVATE_KEY_IN_SERVER_GATE') &&
      approveCode.includes('REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION') &&
      approveCode.includes('.provenance.json'),
    true,
    'Approve-ReleaseSha.ps1 must block AI agent self-signing, block server-local private keys, enforce official GitHub API on production targets, and support .provenance.json auto-discovery',
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

  // Local mock server for sandbox ceremony verification
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
        env: {
          ...process.env,
          PAGER: '',
          ANTIGRAVITY_AGENT: '',
          ANTIGRAVITY_CLI_ALIAS: '',
          CODEX_CI: '',
          CODEX_SANDBOX: '',
          CLAUDE_CODE: '',
          CURSOR_TRACE_ID: '',
          ...envOverrides,
        },
      },
    );

  try {
    // 2. Block AI Agent self-signing / key generation under Owner identity
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
      `${agentAttempt.stdout}\n${agentAttempt.stderr}`,
      /SECURITY_VIOLATION_AGENT_SELF_APPROVAL/,
    );
    assert.equal(
      fs.existsSync(externalPrivKey),
      false,
      'AI Agent attempt must not generate private key file',
    );

    // 3. Block private key stored in config/test-secrets during Approve-ReleaseSha.ps1
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

    // 4. 1-Command Owner Ceremony: generate offline keypair and sign via -ArtifactPath auto-discovery
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

    // 5. Block deployment if any private key exists under server config/test-secrets
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

    // 6. Block synthetic/self-created CI receipt (missing generated_at_utc in production mode)
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

    // 7. Hard-lock official https://api.github.com in production mode (reject CLI -GitHubApiBaseUrl and policy github_api_base_url overrides)
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

    // Also test policy github_api_base_url override rejection in production mode
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

    // 8. OS Kernel Token Elevation Gate: blocks non-elevated caller EVEN WHEN ALL AI Agent env vars are cleared
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

    // 9. One-Time Scoped Approval (SCOPED_WINDOW): enforces baseline lineage, blocks controller/workflow tampering, and enforces max_deployments quota
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

    // Create unrelated commit on orphan branch to test REJECTED_OUT_OF_SCOPE_LINEAGE
    gitTarget('checkout', '--quiet', '--orphan', 'unrelated-branch');
    fs.writeFileSync(
      path.join(targetRepoDir, 'apps', 'web', 'feature.txt'),
      'unrelated',
    );
    gitTarget('add', '.');
    gitTarget('commit', '--quiet', '-m', 'unrelated commit');
    const unrelatedSha = gitTarget('rev-parse', 'HEAD');

    // Switch back to main and create a commit touching scripts/deployment/ to test REJECTED_OUT_OF_SCOPE_PATH_MODIFICATION
    gitTarget('checkout', '--quiet', 'main');
    fs.writeFileSync(
      path.join(targetRepoDir, 'scripts', 'deployment', 'tamper.ps1'),
      '# tamper',
    );
    gitTarget('add', '.');
    gitTarget('commit', '--quiet', '-m', 'tamper controller commit');
    const tamperControllerSha = gitTarget('rev-parse', 'HEAD');

    // Reset main back to baselineSha so targetRepoDir HEAD is at baselineSha
    gitTarget('checkout', '--quiet', '-f', baselineSha);

    // Sign One-Time Scoped Approval (SCOPED_WINDOW) for baselineSha with MaxDeployments = 2 (default allow_migration = false)
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

    // Helper to write CI receipt for a given SHA under sandbox test
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
            env: {
              ...process.env,
              PAGER: '',
              ANTIGRAVITY_AGENT: '',
              ANTIGRAVITY_CLI_ALIAS: '',
              CODEX_CI: '',
              CODEX_SANDBOX: '',
              CLAUDE_CODE: '',
              CURSOR_TRACE_ID: '',
              ...envOverrides,
            },
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

    // 9A. Reject commit that is NOT a descendant of baselineSha (REJECTED_OUT_OF_SCOPE_LINEAGE)
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

    // 9B. Reject commit that modifies scripts/deployment/* during scoped approval (REJECTED_OUT_OF_SCOPE_PATH_MODIFICATION)
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

    // 9C. Reject commit that touches database/migrations/* when default allow_migration is false (REJECTED_UNAPPROVED_MIGRATION)
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

    // 9D. Live https://api.github.com SCOPED_WINDOW check (zero loopback mock, zero synthetic receipt -> fails closed when run does not exist on official GitHub API)
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

    // 9E. Reject when scoped_deployments_used reaches max_deployments (REJECTED_SCOPE_QUOTA_EXCEEDED)
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
  // Pre-seed explicit service ACE on logs (LOCAL SERVICE:(OI)(CI)(M)) to verify Invoke-OwnerP0Setup.ps1 preserves it via /inheritance:d
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

  // 1. Transactional rollback on error preserves original policy, manifest, and temporary key
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
    { encoding: 'utf8' },
  );
  assert.notEqual(rbRes.status, 0);
  assert.match(
    `${rbRes.stdout}\n${rbRes.stderr}`,
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

  // 2. Full setup succeeds, defaults MaxDeployments=10, ExpiresInHours=168, allow_migration=false, deletes temp key, synthetic receipt & legacy plaintext token, and locks NTFS ACLs
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
    { encoding: 'utf8' },
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

  // 3. Live OS account verification: overwrite, delete, rename dir, icacls self-grant, and service/immutable-controller tampering all blocked
  assert.throws(() => fs.writeFileSync(polFile, '{}', 'utf8'), /EPERM|EACCES/);
  assert.throws(() => fs.writeFileSync(manFile, '{}', 'utf8'), /EPERM|EACCES/);
  assert.throws(() => fs.unlinkSync(polFile), /EPERM|EACCES/);
  assert.throws(
    () =>
      fs.renameSync(
        path.join(sbServer, 'config/release-gate'),
        path.join(sbServer, 'config/gate-hijack'),
      ),
    /EPERM|EACCES/,
  );
  assert.throws(
    () =>
      fs.renameSync(
        path.join(sbServer, 'config'),
        path.join(sbServer, 'config-hijack'),
      ),
    /EPERM|EACCES/,
  );
  assert.throws(
    () => fs.writeFileSync(svcFile, 'hijack', 'utf8'),
    /EPERM|EACCES/,
  );
  assert.throws(
    () => fs.writeFileSync(webScriptFile, 'hijack', 'utf8'),
    /EPERM|EACCES/,
  );
  assert.throws(
    () =>
      fs.writeFileSync(
        path.join(
          sbServer,
          'config/release-gate/controllers/Deploy-SemiAutoWindows.ps1',
        ),
        'hijack',
        'utf8',
      ),
    /EPERM|EACCES/,
  );
  const icaclsBypass = spawnSync(
    'icacls.exe',
    [
      path.join(sbServer, 'config/release-gate'),
      '/grant',
      `${process.env.USERNAME || 'ADMIN'}:(OI)(CI)F`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    icaclsBypass.status,
    5,
    'icacls self-grant must fail with Access Denied (5)',
  );

  // 4. Operational continuity verification:
  // 4a. Locked script in scripts/ remains executable by Node/PowerShell (Read & Execute)
  const execWebScript = spawnSync(process.execPath, [webScriptFile], {
    encoding: 'utf8',
  });
  assert.equal(execWebScript.status, 0);
  assert.equal(execWebScript.stdout, 'WEB_SERVICE_OK');

  // 4b. logs/ preserves explicit NT AUTHORITY\LOCAL SERVICE:(OI)(CI)(M) for WinSW service log rotation & backups
  const logsAclOut = spawnSync('icacls.exe', [path.join(sbServer, 'logs')], {
    encoding: 'utf8',
  });
  assert.match(logsAclOut.stdout, /LOCAL SERVICE:\(OI\)\(CI\)\(M\)/i);

  // 4c. apps/management-lite (including scripts/deployment inside Git working tree), logs, backups, reports, and config/npm-cache remain writable for git checkout/rollback and backups
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

  // 1. Approve-ReleaseSha.ps1 rejects MaxDeployments > 10 and ExpiresInHours > 168 (7 days)
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
    { encoding: 'utf8' },
  );
  assert.equal(genRes.status, 0);

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
    { encoding: 'utf8' },
  );
  assert.notEqual(overDeploysRes.status, 0);
  assert.match(
    `${overDeploysRes.stdout}\n${overDeploysRes.stderr}`,
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
    { encoding: 'utf8' },
  );
  assert.notEqual(overDaysRes.status, 0);
  assert.match(
    `${overDaysRes.stdout}\n${overDaysRes.stderr}`,
    /Maximum allowed duration is 7 days/,
  );

  // 2. Mock GitHub API to verify minimum PAT permission enforcement (rejects delete_repo scope, rejects missing push permission, accepts minimal fine-grained PAT and stores DPAPI ciphertext)
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
      '/repos/truhoaiphuong03/management-lite/actions/workflows/deploy.yml'
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 1001,
          name: 'Management Lite Build & Release Artifact',
          path: '.github/workflows/deploy.yml',
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
    const runPsCmdAsync = (cmd) =>
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
          { encoding: 'utf8' },
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

    // 2a. Reject token with excessive scopes (delete_repo)
    tokenMode = 'EXCESSIVE_CLASSIC_SCOPE';
    const excRes = await runPsCmdAsync(
      `$sec = ConvertTo-SecureString 'ghp_test_excessive' -AsPlainText -Force; & '${setupScript}' -ServerRoot '${sbServer}' -OwnerVaultDir '${sbVault}' -DevRepoDir '${devRepoDir}' -GitHubApiBaseUrl '${apiUrl}' -GitHubPatSecure $sec -SandboxMode`,
    );
    assert.notEqual(excRes.status, 0);
    assert.match(
      `${excRes.stdout}\n${excRes.stderr}`,
      /GITHUB_PAT_EXCESSIVE_PERMISSIONS/,
    );

    // 2b. Reject token lacking push (Contents: Read & Write) permission
    tokenMode = 'MISSING_PUSH';
    const noPushRes = await runPsCmdAsync(
      `$sec = ConvertTo-SecureString 'github_pat_no_push' -AsPlainText -Force; & '${setupScript}' -ServerRoot '${sbServer}' -OwnerVaultDir '${sbVault}' -DevRepoDir '${devRepoDir}' -GitHubApiBaseUrl '${apiUrl}' -GitHubPatSecure $sec -SandboxMode`,
    );
    assert.notEqual(noPushRes.status, 0);
    assert.match(
      `${noPushRes.stdout}\n${noPushRes.stderr}`,
      /GITHUB_PAT_INSUFFICIENT_PUSH_PERMISSION/,
    );

    // 2c. Accept valid minimum-scope Fine-Grained PAT and store DPAPI ciphertext (never plaintext)
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
  } finally {
    await new Promise((resolve) => mockGh.close(resolve));
  }
});
