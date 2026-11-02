import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const scriptPath = path.join(
  rootDir,
  'scripts',
  'deployment',
  'Invoke-OwnerReleaseToWeb.ps1',
);

function sha256Hex(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

function deriveOwnerEd25519PublicKeySha(passphrase) {
  const seed = crypto.scryptSync(
    passphrase,
    'HoaiPhuong-ManagementLite-OwnerEd25519-v2',
    32,
  );
  const pkcs8Der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed,
  ]);
  const privKey = crypto.createPrivateKey({
    key: pkcs8Der,
    format: 'der',
    type: 'pkcs8',
  });
  const pubPem = crypto
    .createPublicKey(privKey)
    .export({ type: 'spki', format: 'pem' });
  return sha256Hex(Buffer.from(pubPem, 'utf8')).toLowerCase();
}

function runPsScript(args = [], envOverrides = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
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

test('Phase 32 Task 1, 3, 4 & 5: Invoke-OwnerReleaseToWeb.ps1 fail-closed preflight, CI verification, DPAPI secret backup, transactional rollback, ACL restoration, and E2E simulation', async (t) => {
  if (process.platform !== 'win32') {
    t.diagnostic('Windows PowerShell + NTFS ACL test only');
    return;
  }

  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ml-phase32-release-gate-'),
  );

  // Set up mock GitHub Actions API server
  let mockCiMode = 'success';
  const commitSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const runId = '9988776655';

  const ghServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.includes(`/actions/runs/${runId}/jobs`)) {
      const job2Conclusion =
        mockCiMode === 'job_failed' ? 'failure' : 'success';
      res.end(
        JSON.stringify({
          total_count: 2,
          jobs: [
            {
              id: 101,
              name: 'Windows P0 Security Gate',
              status: 'completed',
              conclusion: 'success',
            },
            {
              id: 102,
              name: 'ci',
              status: 'completed',
              conclusion: job2Conclusion,
            },
          ],
        }),
      );
      return;
    }
    if (req.url?.includes(`/actions/runs/${runId}`)) {
      const conclusion = mockCiMode === 'run_failed' ? 'failure' : 'success';
      res.end(
        JSON.stringify({
          id: Number(runId),
          name: 'Management Lite Foundation CI',
          path: '.github/workflows/foundation.yml',
          head_branch: 'main',
          head_sha: commitSha,
          status: 'completed',
          conclusion,
        }),
      );
      return;
    }
    if (req.url?.includes('/actions/runs?head_sha=')) {
      const conclusion = mockCiMode === 'run_failed' ? 'failure' : 'success';
      res.end(
        JSON.stringify({
          total_count: 1,
          workflow_runs: [
            {
              id: Number(runId),
              name: 'Management Lite Foundation CI',
              path: '.github/workflows/foundation.yml',
              head_branch: 'main',
              head_sha: commitSha,
              status: 'completed',
              conclusion,
            },
          ],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'Not Found' }));
  });

  await new Promise((r) => ghServer.listen(0, '127.0.0.1', r));
  const ghPort = ghServer.address().port;
  const ghApiBase = `http://127.0.0.1:${ghPort}`;

  t.after(async () => {
    await new Promise((r) => ghServer.close(r));
    try {
      spawnSync('icacls.exe', [sandboxRoot, '/reset', '/T', '/C', '/Q'], {
        stdio: 'ignore',
      });
    } catch {
      // ignore cleanup acl errors
    }
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  });

  // Build sandbox directory layout mirroring C:\HoaiPhuong-Server
  const gateDir = path.join(sandboxRoot, 'config', 'release-gate');
  const controllersDir = path.join(gateDir, 'controllers');
  const secretsDir = path.join(sandboxRoot, 'config', 'test-secrets');
  const artifactsDir = path.join(sandboxRoot, 'artifacts-input');

  for (const d of [gateDir, controllersDir, secretsDir, artifactsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // Create mock Deploy-SemiAutoWindows.ps1 supporting $RunMigrations
  const controllerInvocationLog = path.join(
    sandboxRoot,
    'controller-invocations.jsonl',
  );
  const mockControllerPath = path.join(
    controllersDir,
    'Deploy-SemiAutoWindows.ps1',
  );
  const mockControllerContent = `param(
    [string]$CommitSha = "",
    [string]$ArtifactPath = "",
    [string]$ArtifactSha256 = "",
    [string]$CiRunId = "",
    [string]$PolicyPath = "",
    [string]$ApprovalManifestPath = "",
    [string]$ServerRoot = "",
    [switch]$RunMigrations = $false,
    [switch]$SkipMigration = $true,
    [switch]$SandboxMode = $false,
    [string]$GitHubApiBaseUrl = ""
)
$ErrorActionPreference = "Stop"
if ($RunMigrations) { $SkipMigration = $false }
$rec = [ordered]@{
    sha = $CommitSha
    artifactPath = $ArtifactPath
    artifactSha256 = $ArtifactSha256
    ciRunId = $CiRunId
    runMigrations = [bool]$RunMigrations
    skipMigration = [bool]$SkipMigration
} | ConvertTo-Json -Compress
Add-Content -LiteralPath "${controllerInvocationLog.replace(/\\/g, '\\\\')}" -Value $rec -Encoding UTF8
Write-Host "Mock controller executed successfully with RunMigrations=$RunMigrations"
exit 0
`;
  fs.writeFileSync(mockControllerPath, mockControllerContent, 'utf8');
  const mockControllerSha = sha256Hex(fs.readFileSync(mockControllerPath));

  const passphrase = 'TestOwnerPassphrase#2026!';
  const expectedPubKeySha = deriveOwnerEd25519PublicKeySha(passphrase);

  // Create initial release-gate-policy.json (in REVOKED_AWAITING_OWNER_KEY_ENROLLMENT state, matching Production)
  const revokedSha =
    '2e92bb4a96b8f60da691d309399b494b20bdbe60aa3b39c2add7313e0441931e';
  const policyPath = path.join(gateDir, 'release-gate-policy.json');
  const initialPolicy = {
    version: 1,
    key_status: 'REVOKED_AWAITING_OWNER_KEY_ENROLLMENT',
    trusted_public_key_sha256:
      'UNENROLLED_MUST_BE_SET_BY_OWNER_OUT_OF_BAND_KEYGEN_BEFORE_RELEASE',
    revoked_public_key_sha256s: [revokedSha],
  };
  fs.writeFileSync(policyPath, JSON.stringify(initialPolicy, null, 2), 'utf8');

  const gatePubKeyPath = path.join(gateDir, 'owner-approval-public.pem');
  fs.writeFileSync(gatePubKeyPath, 'UNENROLLED\n', 'utf8');

  const approvalJsonPath = path.join(gateDir, 'approved-release.json');
  fs.writeFileSync(
    approvalJsonPath,
    JSON.stringify({ status: 'previous_approval' }, null, 2),
    'utf8',
  );

  const auditLogPath = path.join(gateDir, 'approval-audit.jsonl');
  fs.writeFileSync(
    auditLogPath,
    '{"entry_hash":"1111111111111111111111111111111111111111111111111111111111111111"}\n',
    'utf8',
  );

  // Create mock api.env with sensitive keys (to test DPAPI backup)
  const apiEnvPath = path.join(secretsDir, 'api.env');
  fs.writeFileSync(
    apiEnvPath,
    'NODE_ENV=production\nACCOUNT_SECRET_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nSTORAGE_DRIVE_ENCRYPTION_KEY_HEX=fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210\n',
    'utf8',
  );

  // Create valid release artifact tar.gz, .sha256, .provenance.json, and official ci-run-receipt
  const tarPath = path.join(
    artifactsDir,
    `management-lite-full-${commitSha}.tar.gz`,
  );
  fs.writeFileSync(tarPath, `mock-tarball-content-for-${commitSha}`, 'utf8');
  const artifactSha = sha256Hex(fs.readFileSync(tarPath));
  fs.writeFileSync(
    `${tarPath}.sha256`,
    `${artifactSha}  management-lite-full-${commitSha}.tar.gz\n`,
    'utf8',
  );
  const schemaIdentity =
    '71a9cf3cc4fc3014d9f128fbdf49078ff1bf468ae202499a2bc37be35e81f285';
  const provenance = {
    schemaVersion: 2,
    commitSha,
    sha256: artifactSha,
    migrationCount: 32,
    schemaIdentity,
  };
  fs.writeFileSync(
    `${tarPath}.provenance.json`,
    JSON.stringify(provenance, null, 2),
    'utf8',
  );

  const validReceiptObj = {
    run_id: runId,
    run_attempt: 1,
    workflow_path: '.github/workflows/foundation.yml',
    head_branch: 'main',
    head_sha: commitSha,
    artifact_sha256: artifactSha,
    schema_sha256: schemaIdentity,
    status: 'completed',
    conclusion: 'success',
    generated_at_utc: '2026-11-02T05:00:00Z',
  };
  const srcReceiptFile = path.join(
    artifactsDir,
    `ci-run-receipt-${commitSha}.json`,
  );
  fs.writeFileSync(
    srcReceiptFile,
    JSON.stringify(validReceiptObj, null, 2),
    'utf8',
  );

  // 1. Test parameter & privilege guards
  const badShaRes = await runPsScript([
    '-SandboxMode',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    'not-a-valid-sha',
  ]);
  assert.notEqual(badShaRes.status, 0);
  assert.match(badShaRes.stderr + badShaRes.stdout, /REJECTED_INVALID_SHA/);

  const badTtlRes = await runPsScript([
    '-SandboxMode',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    commitSha,
    '-ExpiresInMinutes',
    '2',
  ]);
  assert.notEqual(badTtlRes.status, 0);
  assert.match(badTtlRes.stderr + badTtlRes.stdout, /REJECTED_INVALID_TTL/);

  const sandboxOnProdRes = await runPsScript([
    '-SandboxMode',
    '-ServerRoot',
    'C:\\HoaiPhuong-Server',
    '-CommitSha',
    commitSha,
  ]);
  assert.notEqual(sandboxOnProdRes.status, 0);
  assert.match(
    sandboxOnProdRes.stderr + sandboxOnProdRes.stdout,
    /SANDBOX_VIOLATION_PRODUCTION_PATH_FORBIDDEN/,
  );

  const nonAdminRes = await runPsScript([
    '-SandboxMode',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    commitSha,
    '-SimulateNonElevatedCaller',
  ]);
  assert.notEqual(nonAdminRes.status, 0);
  assert.match(
    nonAdminRes.stderr + nonAdminRes.stdout,
    /SECURITY_VIOLATION_NON_ELEVATED_TOKEN/,
  );

  // 1b. Native Win32 TokenIntegrityLevel (GetTokenInformation class 25) verification across all 5 mandatory cases:
  // Case (a): Administrator with High (S-1-16-12288) / System (S-1-16-16384) Integrity -> PASS
  const realAdminHighRes = await runPsScript([
    '-SandboxMode',
    '-DryRunPreflightOnly',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    commitSha,
    '-ExpectedControllerSha256',
    mockControllerSha,
    '-GitHubApiBaseUrl',
    ghApiBase,
    '-SandboxSimulatedIsAdmin',
    'true',
    '-SandboxSimulatedIntegritySid',
    'S-1-16-12288',
  ]);
  assert.equal(
    realAdminHighRes.status,
    0,
    `Expected Real Admin + S-1-16-12288 to PASS preflight, got: ${realAdminHighRes.stderr}\n${realAdminHighRes.stdout}`,
  );
  assert.match(realAdminHighRes.stdout, /\[PREFLIGHT-PASS\]/);

  // Case (b): Non-elevated Administrator (IsAdmin = true, Medium Integrity S-1-16-8192) -> BLOCK
  const nonElevatedAdminRes = await runPsScript([
    '-SandboxMode',
    '-DryRunPreflightOnly',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    commitSha,
    '-SandboxSimulatedIsAdmin',
    'true',
    '-SandboxSimulatedIntegritySid',
    'S-1-16-8192',
  ]);
  assert.notEqual(nonElevatedAdminRes.status, 0);
  assert.match(
    nonElevatedAdminRes.stderr + nonElevatedAdminRes.stdout,
    /SECURITY_VIOLATION_NON_ELEVATED_TOKEN/,
  );

  // Case (c): Standard User (IsAdmin = false, even if Integrity SID is Medium S-1-16-8192 or High S-1-16-12288) -> BLOCK
  const standardUserRes = await runPsScript([
    '-SandboxMode',
    '-DryRunPreflightOnly',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    commitSha,
    '-SandboxSimulatedIsAdmin',
    'false',
    '-SandboxSimulatedIntegritySid',
    'S-1-16-12288',
  ]);
  assert.notEqual(standardUserRes.status, 0);
  assert.match(
    standardUserRes.stderr + standardUserRes.stdout,
    /SECURITY_VIOLATION_NON_ELEVATED_TOKEN/,
  );

  // Case (d): Unknown / Null / Invalid Token Integrity -> BLOCK
  const unknownIntegrityRes = await runPsScript([
    '-SandboxMode',
    '-DryRunPreflightOnly',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    commitSha,
    '-SandboxSimulatedIsAdmin',
    'true',
    '-SandboxSimulatedIntegritySid',
    'UNKNOWN_OR_INVALID_SID',
  ]);
  assert.notEqual(unknownIntegrityRes.status, 0);
  assert.match(
    unknownIntegrityRes.stderr + unknownIntegrityRes.stdout,
    /SECURITY_VIOLATION_NON_ELEVATED_TOKEN/,
  );

  // Case (e): Window title spoofing ("Administrator: Windows PowerShell") on non-elevated token -> BLOCK
  // Also verifies GetTokenIntegritySid([IntPtr]::Zero) -> null and live Win32 GetTokenInformation(TokenIntegrityLevel) returns S-1-16-*
  const windowTitleSpoofRes = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `
        $Host.UI.RawUI.WindowTitle = 'Administrator: Windows PowerShell'
        try {
          & '${scriptPath.replace(/'/g, "''")}' -SandboxMode -DryRunPreflightOnly -ServerRoot '${sandboxRoot.replace(/'/g, "''")}' -ArtifactsDir '${artifactsDir.replace(/'/g, "''")}' -CommitSha '${commitSha}' -SandboxSimulatedIsAdmin 'true' -SandboxSimulatedIntegritySid 'S-1-16-8192'
          exit 0
        } catch {
          $liveId = [Security.Principal.WindowsIdentity]::GetCurrent()
          $liveSid = [ManagementLiteTokenSecurity]::GetTokenIntegritySid($liveId.Token)
          $zeroSid = [ManagementLiteTokenSecurity]::GetTokenIntegritySid([IntPtr]::Zero)
          $evalHigh = [ManagementLiteTokenSecurity]::EvaluateKernelElevation($true, 'S-1-16-12288')
          $evalSys = [ManagementLiteTokenSecurity]::EvaluateKernelElevation($true, 'S-1-16-16384')
          $evalMed = [ManagementLiteTokenSecurity]::EvaluateKernelElevation($true, 'S-1-16-8192')
          $evalStd = [ManagementLiteTokenSecurity]::EvaluateKernelElevation($false, 'S-1-16-12288')
          $evalNull = [ManagementLiteTokenSecurity]::EvaluateKernelElevation($true, $null)
          Write-Output ("SPOOF_BLOCKED_ERR=" + $_.Exception.Message)
          Write-Output ("LIVE_SID=" + $liveSid)
          Write-Output ("ZERO_SID_IS_NULL=" + ($null -eq $zeroSid))
          Write-Output ("EVAL_MATRIX=$evalHigh,$evalSys,$evalMed,$evalStd,$evalNull")
          exit 42
        }
      `,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(windowTitleSpoofRes.status, 42);
  assert.match(
    windowTitleSpoofRes.stdout,
    /SPOOF_BLOCKED_ERR=SECURITY_VIOLATION_NON_ELEVATED_TOKEN/,
  );
  assert.match(
    windowTitleSpoofRes.stdout,
    /LIVE_SID=S-1-16-(4096|8192|12288|16384)/,
  );
  assert.match(windowTitleSpoofRes.stdout, /ZERO_SID_IS_NULL=True/);
  assert.match(
    windowTitleSpoofRes.stdout,
    /EVAL_MATRIX=True,True,False,False,False/,
  );

  // 2. Test controller SHA-256 mismatch
  const badCtrlRes = await runPsScript([
    '-SandboxMode',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    commitSha,
    '-ExpectedControllerSha256',
    '0000000000000000000000000000000000000000000000000000000000000000',
  ]);
  assert.notEqual(badCtrlRes.status, 0);
  assert.match(
    badCtrlRes.stderr + badCtrlRes.stdout,
    /REJECTED_CONTROLLER_HASH_MISMATCH/,
  );

  // 3. Test missing artifact & checksum mismatch
  fs.writeFileSync(
    `${tarPath}.sha256`,
    `0000000000000000000000000000000000000000000000000000000000000000  management-lite-full-${commitSha}.tar.gz\n`,
    'utf8',
  );
  const badChecksumRes = await runPsScript([
    '-SandboxMode',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    commitSha,
    '-ExpectedControllerSha256',
    mockControllerSha,
    '-GitHubApiBaseUrl',
    ghApiBase,
  ]);
  assert.notEqual(badChecksumRes.status, 0);
  assert.match(
    badChecksumRes.stderr + badChecksumRes.stdout,
    /REJECTED_ARTIFACT_CHECKSUM_MISMATCH/,
  );
  // Restore valid sidecar
  fs.writeFileSync(
    `${tarPath}.sha256`,
    `${artifactSha}  management-lite-full-${commitSha}.tar.gz\n`,
    'utf8',
  );

  // 4. Test CI failures & synthetic receipt rejection
  fs.writeFileSync(
    srcReceiptFile,
    JSON.stringify({ ...validReceiptObj, synthetic_local: true }, null, 2),
    'utf8',
  );
  const synthRes = await runPsScript([
    '-SandboxMode',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    commitSha,
    '-ExpectedControllerSha256',
    mockControllerSha,
    '-GitHubApiBaseUrl',
    ghApiBase,
  ]);
  assert.notEqual(synthRes.status, 0);
  assert.match(
    synthRes.stderr + synthRes.stdout,
    /REJECTED_SYNTHETIC_CI_RECEIPT/,
  );
  // Restore valid receipt
  fs.writeFileSync(
    srcReceiptFile,
    JSON.stringify(validReceiptObj, null, 2),
    'utf8',
  );

  mockCiMode = 'run_failed';
  const ciRunFailRes = await runPsScript([
    '-SandboxMode',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    commitSha,
    '-ExpectedControllerSha256',
    mockControllerSha,
    '-GitHubApiBaseUrl',
    ghApiBase,
  ]);
  assert.notEqual(ciRunFailRes.status, 0);
  assert.match(
    ciRunFailRes.stderr + ciRunFailRes.stdout,
    /REJECTED_CI_NOT_PASSED/,
  );

  mockCiMode = 'job_failed';
  const ciJobFailRes = await runPsScript([
    '-SandboxMode',
    '-ServerRoot',
    sandboxRoot,
    '-ArtifactsDir',
    artifactsDir,
    '-CommitSha',
    commitSha,
    '-ExpectedControllerSha256',
    mockControllerSha,
    '-GitHubApiBaseUrl',
    ghApiBase,
  ]);
  assert.notEqual(ciJobFailRes.status, 0);
  assert.match(
    ciJobFailRes.stderr + ciJobFailRes.stdout,
    /REJECTED_CI_JOBS_NOT_PASSED/,
  );

  mockCiMode = 'success';

  // 5. Test unenrolled policy key rejected when -EnrollNewPublicKey is not set
  const unenrolledRes = await runPsScript(
    [
      '-SandboxMode',
      '-ServerRoot',
      sandboxRoot,
      '-ArtifactsDir',
      artifactsDir,
      '-CommitSha',
      commitSha,
      '-ExpectedControllerSha256',
      mockControllerSha,
      '-GitHubApiBaseUrl',
      ghApiBase,
    ],
    { SANDBOX_TEST_OWNER_PASSPHRASE: passphrase },
  );
  assert.notEqual(unenrolledRes.status, 0);
  assert.match(
    unenrolledRes.stderr + unenrolledRes.stdout,
    /REJECTED_UNENROLLED_POLICY_KEY/,
  );

  // 6. Test transactional rollback + NTFS ACL re-locking on mid-flight failures
  const beforePolicyBytes = fs.readFileSync(policyPath, 'utf8');
  const beforePubBytes = fs.readFileSync(gatePubKeyPath, 'utf8');
  const beforeApprovalBytes = fs.readFileSync(approvalJsonPath, 'utf8');
  const beforeAuditBytes = fs.readFileSync(auditLogPath, 'utf8');
  const gateReceiptPath = path.join(
    gateDir,
    `ci-run-receipt-${commitSha}.json`,
  );

  for (const faultFlag of [
    '-SimulateSigningFailureAfterPolicyWrite',
    '-SimulateBackupFailure',
    '-SimulateMigrationFailure',
  ]) {
    const faultRes = await runPsScript(
      [
        '-SandboxMode',
        '-ServerRoot',
        sandboxRoot,
        '-ArtifactsDir',
        artifactsDir,
        '-CommitSha',
        commitSha,
        '-EnrollNewPublicKey',
        '-ExpectedControllerSha256',
        mockControllerSha,
        '-GitHubApiBaseUrl',
        ghApiBase,
        faultFlag,
      ],
      { SANDBOX_TEST_OWNER_PASSPHRASE: passphrase },
    );
    assert.notEqual(
      faultRes.status,
      0,
      `Fault injection ${faultFlag} must fail closed`,
    );

    // Prove byte-for-byte rollback of all gate files
    assert.equal(
      fs.readFileSync(policyPath, 'utf8'),
      beforePolicyBytes,
      `release-gate-policy.json must roll back after ${faultFlag}`,
    );
    assert.equal(
      fs.readFileSync(gatePubKeyPath, 'utf8'),
      beforePubBytes,
      `owner-approval-public.pem must roll back after ${faultFlag}`,
    );
    assert.equal(
      fs.readFileSync(approvalJsonPath, 'utf8'),
      beforeApprovalBytes,
      `approved-release.json must roll back after ${faultFlag}`,
    );
    assert.equal(
      fs.readFileSync(auditLogPath, 'utf8'),
      beforeAuditBytes,
      `approval-audit.jsonl must roll back after ${faultFlag}`,
    );
    assert.equal(
      fs.existsSync(gateReceiptPath),
      false,
      `gate ci-run-receipt must roll back after ${faultFlag}`,
    );

    // Prove NTFS ACL on gateDir was re-locked to RX (no Write/Modify/Delete) for current user
    const icaclsOut = spawnSync('icacls.exe', [gateDir], {
      encoding: 'utf8',
    }).stdout;
    assert.match(
      icaclsOut,
      /\(OI\)\(CI\)\(RX/i,
      `NTFS ACL must be re-locked to RX after ${faultFlag}`,
    );
  }

  // 7. Test -DryRunPreflightOnly (100% read-only verification)
  const dryRunRes = await runPsScript(
    [
      '-SandboxMode',
      '-ServerRoot',
      sandboxRoot,
      '-ArtifactsDir',
      artifactsDir,
      '-CommitSha',
      commitSha,
      '-EnrollNewPublicKey',
      '-ExpectedControllerSha256',
      mockControllerSha,
      '-GitHubApiBaseUrl',
      ghApiBase,
      '-DryRunPreflightOnly',
    ],
    { SANDBOX_TEST_OWNER_PASSPHRASE: passphrase },
  );
  assert.equal(dryRunRes.status, 0, dryRunRes.stderr + '\n' + dryRunRes.stdout);
  assert.match(dryRunRes.stdout, /\[PREFLIGHT-PASS\]/);
  assert.equal(
    fs.readFileSync(policyPath, 'utf8'),
    beforePolicyBytes,
    'DryRunPreflightOnly must not mutate release-gate-policy.json',
  );

  // 8. Test full end-to-end sandbox release execution
  const fullRes = await runPsScript(
    [
      '-SandboxMode',
      '-ServerRoot',
      sandboxRoot,
      '-ArtifactsDir',
      artifactsDir,
      '-CommitSha',
      commitSha,
      '-EnrollNewPublicKey',
      '-ExpectedControllerSha256',
      mockControllerSha,
      '-GitHubApiBaseUrl',
      ghApiBase,
    ],
    { SANDBOX_TEST_OWNER_PASSPHRASE: passphrase },
  );
  assert.equal(fullRes.status, 0, fullRes.stderr + '\n' + fullRes.stdout);

  // Verify enrolled policy key & intact revoked key list
  const updatedPolicy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  assert.equal(updatedPolicy.key_status, 'ACTIVE_OWNER_ENROLLED');
  assert.equal(updatedPolicy.trusted_public_key_sha256, expectedPubKeySha);
  assert.ok(updatedPolicy.revoked_public_key_sha256s.includes(revokedSha));

  // Verify official CI receipt copied into gateDir
  assert.equal(fs.existsSync(gateReceiptPath), true);
  const writtenReceipt = JSON.parse(fs.readFileSync(gateReceiptPath, 'utf8'));
  assert.equal(writtenReceipt.conclusion, 'success');
  assert.equal(writtenReceipt.head_sha, commitSha);
  assert.equal(writtenReceipt.artifact_sha256, artifactSha);
  assert.equal(writtenReceipt.run_id, runId);

  // Verify cryptographic signature in approved-release.json
  const signedApproval = JSON.parse(fs.readFileSync(approvalJsonPath, 'utf8'));
  assert.equal(signedApproval.status, 'APPROVED');
  assert.equal(signedApproval.approved_sha, commitSha);
  assert.equal(signedApproval.artifact_sha256, artifactSha);
  assert.equal(signedApproval.schema_sha256, schemaIdentity);
  assert.equal(signedApproval.allow_migration, true);
  assert.equal(signedApproval.signature_algorithm, 'Ed25519');

  // Verify subsequent release with WRONG passphrase fails closed with REJECTED_KEY_MISMATCH
  const wrongPassRes = await runPsScript(
    [
      '-SandboxMode',
      '-ServerRoot',
      sandboxRoot,
      '-ArtifactsDir',
      artifactsDir,
      '-CommitSha',
      commitSha,
      '-ExpectedControllerSha256',
      mockControllerSha,
      '-GitHubApiBaseUrl',
      ghApiBase,
    ],
    { SANDBOX_TEST_OWNER_PASSPHRASE: 'WrongOwnerPassphrase#9999!' },
  );
  assert.notEqual(wrongPassRes.status, 0);
  assert.match(
    wrongPassRes.stderr + wrongPassRes.stdout,
    /REJECTED_KEY_MISMATCH/,
  );

  // Verify DPAPI backup of api.env was created without leaking plaintext secrets
  const dpapiDir = path.join(sandboxRoot, 'backups', 'secrets-dpapi');
  const dpapiFiles = fs
    .readdirSync(dpapiDir)
    .filter((f) => f.endsWith('.dpapi'));
  assert.equal(dpapiFiles.length, 1, 'Must create DPAPI backup of api.env');
  const dpapiContent = fs.readFileSync(
    path.join(dpapiDir, dpapiFiles[0]),
    'utf8',
  );
  assert.equal(
    dpapiContent.includes('0123456789abcdef'),
    false,
    'DPAPI backup must be encrypted, never plaintext',
  );

  // Verify controller was invoked with -RunMigrations ($true) and without -SkipMigration
  const invocations = fs
    .readFileSync(controllerInvocationLog, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((l) => JSON.parse(l));
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].sha, commitSha);
  assert.equal(invocations[0].runMigrations, true);
  assert.equal(invocations[0].skipMigration, false);

  // Verify NTFS ACL on gateDir was re-locked after success
  const finalIcacls = spawnSync('icacls.exe', [gateDir], {
    encoding: 'utf8',
  }).stdout;
  assert.match(finalIcacls, /\(OI\)\(CI\)\(RX/i);
});
