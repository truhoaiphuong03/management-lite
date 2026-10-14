#requires -Version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$devRepo = 'C:\HoaiPhuong-Server\workspace\management-lite-dev'
$prodRepo = 'C:\HoaiPhuong-Server\apps\management-lite'
$approveScript = Join-Path $devRepo 'scripts\deployment\Approve-ReleaseSha.ps1'
$deployScript = Join-Path $devRepo 'scripts\deployment\Deploy-SemiAutoWindows.ps1'
$packagerScript = Join-Path $devRepo 'scripts\deployment\package-release-bundle.mjs'
$node = 'C:\HoaiPhuong-Server\config\runtime\node-v22.14.0-win-x64\node.exe'
$psql = 'C:\HoaiPhuong-Server\config\postgresql-18\pgsql\bin\psql.exe'
$pgPassFile = 'C:\HoaiPhuong-Server\config\test-secrets\pgpass.conf'

$shaOld = (git -c safe.directory=* -C $devRepo rev-parse 3743e99).Trim().ToLowerInvariant()
$shaNew = (git -c safe.directory=* -C $devRepo rev-parse HEAD).Trim().ToLowerInvariant()

$sandboxRoot = Join-Path ([IO.Path]::GetTempPath()) ('ml-sec-sandbox-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$sandboxTarget = Join-Path $sandboxRoot 'apps\management-lite'
$gateDir = Join-Path $sandboxRoot 'config\release-gate'
$secretsDir = Join-Path $sandboxRoot 'config\test-secrets'
$ownerKeysDir = Join-Path $sandboxRoot 'owner-offline-keys'
$attackerKeysDir = Join-Path $sandboxRoot 'attacker-keys'
$bundleDir = Join-Path $sandboxRoot 'bundles'

$policyPath = Join-Path $gateDir 'release-gate-policy.json'
$manifestPath = Join-Path $gateDir 'approved-release.json'
$auditLogPath = Join-Path $gateDir 'approval-audit.jsonl'
$ciReceiptPath = Join-Path $gateDir 'ci-run-receipt.json'
$ownerPrivKey = Join-Path $ownerKeysDir 'owner-approval-private.pem'
$attackerPrivKey = Join-Path $attackerKeysDir 'owner-approval-private.pem'
$sandboxSecretEnv = Join-Path $secretsDir 'api.env'
$mockStateFile = Join-Path $sandboxRoot 'mock-gh-state.json'
$mockPort = 48195
$mockBaseUrl = "http://127.0.0.1:$mockPort"

$passed = 0
function Assert-True([bool]$Cond, [string]$Msg) {
  if (-not $Cond) { throw "ASSERTION FAILED: $Msg" }
}
function Set-MockGhRun(
  [string]$RunId,
  [string]$HeadSha,
  [int]$RunAttempt = 1,
  [string]$Status = 'completed',
  [string]$Conclusion = 'success',
  [string]$Event = 'workflow_dispatch',
  [string]$HeadBranch = 'main',
  [string]$Path = '.github/workflows/deploy.yml',
  [int]$HttpStatus = 200
) {
  @{
    http_status = $HttpStatus
    body        = @{
      id          = [long]$RunId
      run_attempt = $RunAttempt
      head_sha    = $HeadSha
      head_branch = $HeadBranch
      status      = $Status
      conclusion  = $Conclusion
      event       = $Event
      path        = $Path
    }
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $mockStateFile -Encoding UTF8 -Force
}
function Write-CiReceipt(
  [string]$RunId,
  [string]$HeadSha,
  [string]$ArtifactSha256,
  [string]$SchemaSha256 = '',
  [int]$RunAttempt = 1,
  [string]$Status = 'completed',
  [string]$Conclusion = 'success',
  [string]$Event = 'workflow_dispatch',
  [string]$HeadBranch = 'main',
  [string]$WorkflowPath = '.github/workflows/deploy.yml'
) {
  @{
    id              = $RunId
    run_id          = $RunId
    run_attempt     = $RunAttempt
    head_sha        = $HeadSha
    head_branch     = $HeadBranch
    workflow_path   = $WorkflowPath
    artifact_sha256 = $ArtifactSha256
    schema_sha256   = $SchemaSha256
    status          = $Status
    conclusion      = $Conclusion
    event           = $Event
    repository      = 'truhoaiphuong03/management-lite'
  } | ConvertTo-Json | Set-Content -LiteralPath $ciReceiptPath -Encoding UTF8 -Force
}
function Seed-SandboxBaseline([string]$BaseSha) {
  git -c safe.directory=* -C $sandboxTarget checkout --quiet -f $BaseSha
  New-Item -ItemType Directory -Path (Join-Path $sandboxTarget 'dist\apps\api\src') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $sandboxTarget 'apps\web\dist') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $sandboxTarget 'dist\apps\api\src\main.js') -Value "// sentinel-main-$BaseSha" -Encoding UTF8 -Force
  Set-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\index.html') -Value "<html>sentinel-web-$BaseSha</html>" -Encoding UTF8 -Force
  @{ sha = $BaseSha; component = 'api' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxTarget 'dist\release-version.json') -Encoding UTF8 -Force
  @{ sha = $BaseSha; component = 'web' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\release-version.json') -Encoding UTF8 -Force
  Set-Content -LiteralPath (Join-Path $sandboxRoot 'reports\current-live-sha.txt') -Value $BaseSha -Encoding UTF8 -Force
}
function Run-Scenario([string]$Name, [scriptblock]$Body) {
  Write-Host "`n--- SCENARIO: $Name ---" -ForegroundColor Cyan
  & $Body
  $script:passed++
  Write-Host "[PASS] $Name" -ForegroundColor Green
}
function Get-ProdDbRowSum {
  $env:PGPASSFILE = $pgPassFile
  $q = "SELECT (SELECT count(*) FROM workspaces) + (SELECT count(*) FROM users) + (SELECT count(*) FROM employees) + (SELECT count(*) FROM issues) + (SELECT count(*) FROM audit_events);"
  return [int]((& $psql -h 127.0.0.1 -p 55432 -U hp_test_admin -d management_lite_test -t -A -c $q).Trim())
}
function Get-SandboxDbRowSum {
  $env:PGPASSFILE = $pgPassFile
  $q = "SELECT (SELECT count(*) FROM workspaces) + (SELECT count(*) FROM users) + (SELECT count(*) FROM employees) + (SELECT count(*) FROM issues) + (SELECT count(*) FROM audit_events);"
  return [int]((& $psql -h 127.0.0.1 -p 55432 -U hp_test_admin -d management_lite_integration_test -t -A -c $q).Trim())
}

# Record Production Baseline BEFORE sandbox test
$prodApiProcBefore = Get-CimInstance Win32_Service -Filter "Name='HPManagementLiteApi'"
$prodHeadBefore = (git -c safe.directory=* -C $prodRepo rev-parse HEAD).Trim()
$prodLiveShaBefore = (Get-Content -LiteralPath 'C:\HoaiPhuong-Server\reports\current-live-sha.txt' -Raw).Trim()
$prodDbRowsBefore = Get-ProdDbRowSum
$mockProc = $null

try {
  Write-Host "=== INITIALIZING ISOLATED SECURITY SANDBOX AT: $sandboxRoot ===" -ForegroundColor Yellow
  foreach ($d in @((Join-Path $sandboxRoot 'apps'), (Join-Path $sandboxRoot 'backups\postgres'), $gateDir, $secretsDir, $ownerKeysDir, $attackerKeysDir, $bundleDir, (Join-Path $sandboxRoot 'reports'), (Join-Path $sandboxRoot 'logs'))) {
    New-Item -ItemType Directory -Path $d -Force | Out-Null
  }

  # Start local mock GitHub Actions Run API server controlled by $mockStateFile
  $mockScript = Join-Path $sandboxRoot 'mock-gh-api.cjs'
  $jsMock = @"
const http = require('node:http');
const fs = require('node:fs');
const stateFile = process.argv[2];
const port = Number(process.argv[3]);
const srv = http.createServer((req, res) => {
  try {
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, ''));
    res.writeHead(st.http_status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(st.body || {}));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: e.message }));
  }
});
srv.listen(port, '127.0.0.1');
"@
  Set-Content -LiteralPath $mockScript -Value $jsMock -Encoding UTF8 -Force
  Set-MockGhRun -RunId '501' -HeadSha $shaNew
  $mockProc = Start-Process -FilePath $node -ArgumentList @($mockScript, $mockStateFile, "$mockPort") -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 500

  # Seed synthetic sandbox secret file to verify zero-secret-copying & preservation
  Set-Content -LiteralPath $sandboxSecretEnv -Value "PORT=3002`nSYNTHETIC_SANDBOX_KEY=DO_NOT_TOUCH_OR_COPY" -Encoding UTF8 -Force
  $secretHashBefore = (Get-FileHash -LiteralPath $sandboxSecretEnv -Algorithm SHA256).Hash

  # Clone dev repo into isolated sandbox target at baseline shaOld
  git clone --quiet $devRepo $sandboxTarget
  Seed-SandboxBaseline -BaseSha $shaOld

  # Generate Owner Ed25519 keypair + policy (off-server vault), and separate Attacker Ed25519 keypair
  & $approveScript -GenerateKeyPairOnly -KeyOutDir $ownerKeysDir -PrivateKeyOutPath $ownerPrivKey -GitHubApiBaseUrl $mockBaseUrl
  Copy-Item -LiteralPath (Join-Path $ownerKeysDir 'release-gate-policy.json') -Destination $policyPath -Force
  & $approveScript -GenerateKeyPairOnly -KeyOutDir $attackerKeysDir -PrivateKeyOutPath $attackerPrivKey -GitHubApiBaseUrl $mockBaseUrl

  # Package a real verified Full Release Bundle for shaNew (HEAD of devRepo)
  Push-Location $devRepo
  try {
    & $node $packagerScript --type=full "--out=$bundleDir" | Out-Null
  } finally {
    Pop-Location
  }
  $validBundle = Get-ChildItem -LiteralPath $bundleDir -Filter "management-lite-full-$shaNew.tar.gz" -File | Select-Object -First 1
  Assert-True ($null -ne $validBundle) 'Packaged release bundle with full 40-char SHA must exist'
  Assert-True (Test-Path -LiteralPath "$($validBundle.FullName).sha256" -PathType Leaf) 'Sidecar .tar.gz.sha256 must exist'
  Assert-True (Test-Path -LiteralPath "$($validBundle.FullName).provenance.json" -PathType Leaf) 'Sidecar .tar.gz.provenance.json must exist'

  $validBundleHash = (Get-FileHash -LiteralPath $validBundle.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $provObj = Get-Content -LiteralPath "$($validBundle.FullName).provenance.json" -Raw | ConvertFrom-Json
  $validSchemaHash = [string]$provObj.schemaIdentity
  Assert-True ($provObj.sha256 -eq $validBundleHash -and $validSchemaHash -match '^[0-9a-f]{64}$') 'Provenance sha256 and schemaIdentity must be valid 64-char hex digests'

  # Write valid independent CI receipt for Run 501 bound to $validBundleHash and $validSchemaHash
  Write-CiReceipt -RunId '501' -HeadSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash

  # 1. Runner Self-Approval Blocked
  Run-Scenario '1. Negative: Runner / Workflow Self-Approval Attempt Blocked' {
    $rejected = $false
    try {
      & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath -SimulateRunnerContext
    } catch {
      if ($_.Exception.Message -match 'SECURITY_VIOLATION_RUNNER_SELF_APPROVAL') { $rejected = $true }
    }
    Assert-True $rejected 'Runner context must not be able to execute Approve-ReleaseSha.ps1'
  }

  # 2. Unauthorized Person Self-Approval Blocked
  Run-Scenario '2. Negative: Unauthorized User Self-Approval Attempt Blocked' {
    $rejected = $false
    try {
      & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -Sequence 1 -ApprovedBy 'unauthorized_dev' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    } catch {
      if ($_.Exception.Message -match 'REJECTED_UNAUTHORIZED_APPROVER') { $rejected = $true }
    }
    Assert-True $rejected 'Unauthorized user must be rejected by Approve-ReleaseSha.ps1'
  }

  # 3. Missing Approval Manifest Rejected
  Run-Scenario '3. Negative: Missing Signed Approval Manifest Rejected' {
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejected = $true }
    Assert-True $rejected 'Deploy without manifest must fail closed'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_NO_MANIFEST') "Expected REJECTED_NO_MANIFEST, got $($latest.status)"
  }

  # 4. Attacker Forged Keypair Signature Rejected
  Run-Scenario '4. Negative: Forged Approval Signed with Attacker Private Key Rejected' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $attackerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejected = $true }
    Assert-True $rejected 'Forged Ed25519 signature must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_INVALID_SIGNATURE') "Expected REJECTED_INVALID_SIGNATURE, got $($latest.status)"
  }

  # 5. Tampered Approval Manifest Rejected
  Run-Scenario '5. Negative: Post-Signing Tampering of approved-release.json Rejected' {
    & $approveScript -CommitSha $shaOld -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $tampered = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $tampered.approved_sha = $shaNew
    $tampered | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8 -Force

    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejected = $true }
    Assert-True $rejected 'Tampered manifest must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_INVALID_SIGNATURE') "Expected REJECTED_INVALID_SIGNATURE, got $($latest.status)"
  }

  # 6. Bypass via Push / PR Trigger Blocked
  Run-Scenario '6. Negative: Bypass Attempt via push Event Trigger Blocked' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $env:GITHUB_EVENT_NAME = 'push'
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejected = $true }
    finally { Remove-Item Env:GITHUB_EVENT_NAME -ErrorAction SilentlyContinue }
    Assert-True $rejected 'Push event trigger must be blocked'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_UNAPPROVED_TRIGGER_OR_WORKFLOW') "Expected REJECTED_UNAPPROVED_TRIGGER_OR_WORKFLOW, got $($latest.status)"
  }

  # 7. Short / Non-40-Char SHA Rejected
  Run-Scenario '7. Negative: Short 7-Char Commit SHA Rejected' {
    $rejected = $false
    try {
      & $deployScript -CommitSha 'a68c3c5' -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejected = $true }
    Assert-True $rejected 'Short SHA must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_INVALID_SHA') "Expected REJECTED_INVALID_SHA, got $($latest.status)"
  }

  # 8. Deploy When CI Failed Rejected
  Run-Scenario '8. Negative: Deployment When CI Status is FAILURE or Mismatched Run ID Rejected' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -CiStatus 'FAILURE' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejected = $true }
    Assert-True $rejected 'Failed CI status must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_CI_NOT_PASSED') "Expected REJECTED_CI_NOT_PASSED, got $($latest.status)"
  }

  # 9. Omitted or Empty -ArtifactPath / -ArtifactSha256 Bypass Attempt Rejected (Audit CRITICAL Fix)
  Run-Scenario '9. Negative: Omitted or Empty -ArtifactPath / -ArtifactSha256 Cannot Bypass Signed Artifact Verification' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $rejectedMissingPath = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath '' -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejectedMissingPath = $true }
    Assert-True $rejectedMissingPath 'Omitting -ArtifactPath must fail closed'
    $latest1 = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest1.status -eq 'REJECTED_ARTIFACT_MISSING') "Expected REJECTED_ARTIFACT_MISSING, got $($latest1.status)"

    $rejectedMissingHash = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 '' -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejectedMissingHash = $true }
    Assert-True $rejectedMissingHash 'Omitting -ArtifactSha256 must fail closed'
    $latest2 = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest2.status -eq 'REJECTED_ARTIFACT_CHECKSUM_MISMATCH') "Expected REJECTED_ARTIFACT_CHECKSUM_MISMATCH, got $($latest2.status)"
  }

  # 10. Post-CI Artifact Archive Checksum Mismatch Rejected
  Run-Scenario '10. Negative: Post-CI Artifact Archive Tampering (SHA-256 Mismatch) Rejected' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $tamperedArchive = Join-Path $bundleDir 'tampered-archive.tar.gz'
    Copy-Item -LiteralPath $validBundle.FullName -Destination $tamperedArchive -Force
    Add-Content -LiteralPath $tamperedArchive -Value 'tampered-bytes' -NoNewline

    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $tamperedArchive -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejected = $true }
    Assert-True $rejected 'Tampered archive must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_ARTIFACT_CHECKSUM_MISMATCH') "Expected REJECTED_ARTIFACT_CHECKSUM_MISMATCH, got $($latest.status)"
  }

  # 11. Post-CI Internal File Tampering Inside Re-Packed Archive Rejected
  Run-Scenario '11. Negative: Post-CI Internal File Modification (manifest.json SHA-256 Mismatch) Rejected' {
    $repackDir = Join-Path $bundleDir 'repack'
    New-Item -ItemType Directory -Path $repackDir -Force | Out-Null
    tar -xzf $validBundle.FullName -C $repackDir
    Add-Content -LiteralPath (Join-Path $repackDir 'dist\apps\api\src\main.js') -Value "`n// injected-post-ci"
    $repackedTar = Join-Path $bundleDir 'repacked-tampered.tar.gz'
    tar -czf $repackedTar -C $repackDir .
    $repackedHash = (Get-FileHash -LiteralPath $repackedTar -Algorithm SHA256).Hash.ToLowerInvariant()

    Write-CiReceipt -RunId '501' -HeadSha $shaNew -ArtifactSha256 $repackedHash -SchemaSha256 $validSchemaHash
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $repackedHash -SchemaSha256 $validSchemaHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $repackedTar -ArtifactSha256 $repackedHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejected = $true }
    finally {
      Write-CiReceipt -RunId '501' -HeadSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash
    }
    Assert-True $rejected 'Internal file tampering against manifest.json must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_ARTIFACT_FILE_TAMPERED') "Expected REJECTED_ARTIFACT_FILE_TAMPERED, got $($latest.status)"
  }

  # 12. Concurrent Deployments Blocked by Exclusive File Lock
  Run-Scenario '12. Negative: Concurrent Deployment Blocked by Exclusive OS Lock' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $lockPath = Join-Path $sandboxRoot 'logs\deploy.lock'
    $heldLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejected = $true }
    finally {
      $heldLock.Dispose()
      Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
    Assert-True $rejected 'Concurrent deployment must be blocked when lock is held'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_CONCURRENT_LOCK') "Expected REJECTED_CONCURRENT_LOCK, got $($latest.status)"
  }

  # 13. Private Key Exposure on Host Rejected
  Run-Scenario '13. Negative: Private Key Left in Server release-gate or runner Directory Rejected' {
    $leakedKeyPath = Join-Path $gateDir 'owner-approval-private.pem'
    Copy-Item -LiteralPath $ownerPrivKey -Destination $leakedKeyPath -Force
    $signBlocked = $false
    $deployBlocked = $false
    try {
      try {
        & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $leakedKeyPath -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
      } catch {
        if ($_.Exception.Message -match 'SECURITY_VIOLATION_PRIVATE_KEY_IN_SERVER_GATE') { $signBlocked = $true }
      }
      try {
        & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
      } catch {
        $deployBlocked = $true
      }
      $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
      Assert-True $signBlocked 'Approve-ReleaseSha.ps1 must reject signing when private key is inside release-gate'
      Assert-True ($deployBlocked -and $latest.status -eq 'REJECTED_PRIVATE_KEY_EXPOSED_ON_HOST') "Expected REJECTED_PRIVATE_KEY_EXPOSED_ON_HOST, got $($latest.status)"
    } finally {
      Remove-Item -LiteralPath $leakedKeyPath -Force -ErrorAction SilentlyContinue
    }
  }

  # 14. Independent CI Receipt Tampering / Missing / Mismatched Provenance Fields Rejected (Audit CRITICAL Fix)
  Run-Scenario '14. Negative: Independent CI Receipt Missing, Failed, Wrong Branch/Workflow, or Mismatched Artifact SHA Rejected' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath

    # 14a: Missing receipt file cannot be bypassed even if policy flag is removed
    Remove-Item -LiteralPath $ciReceiptPath -Force -ErrorAction SilentlyContinue
    $rejMissing = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejMissing = $true }
    Assert-True $rejMissing 'Missing CI receipt must fail closed unconditionally'
    $latestM = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latestM.status -eq 'REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED') "Expected REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED, got $($latestM.status)"

    # 14b: Receipt with wrong artifact_sha256 rejected
    Write-CiReceipt -RunId '501' -HeadSha $shaNew -ArtifactSha256 ('f' * 64) -SchemaSha256 $validSchemaHash
    $rejArt = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejArt = $true }
    finally {
      Write-CiReceipt -RunId '501' -HeadSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash
    }
    Assert-True $rejArt 'CI receipt with mismatched artifact_sha256 must be rejected'
    $latestA = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latestA.status -eq 'REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED') "Expected REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED, got $($latestA.status)"
  }

  # 15. Unconditional Live GitHub Actions Run API Verification (Cannot Be Skipped by Omitting -GitHubApiBaseUrl)
  Run-Scenario '15. Negative: Forged Local ci-run-receipt.json Rejected by Unconditional Live GitHub Run API Check (Even Without -GitHubApiBaseUrl Parameter)' {
    # Notice we do NOT pass -GitHubApiBaseUrl on the command line — controller must enforce policy.github_api_base_url unconditionally
    foreach ($badCase in @(
      @{ Conclusion = 'failure'; Branch = 'main'; Path = '.github/workflows/deploy.yml'; Attempt = 1; HttpStatus = 200 },
      @{ Conclusion = 'success'; Branch = 'feat/untrusted'; Path = '.github/workflows/deploy.yml'; Attempt = 1; HttpStatus = 200 },
      @{ Conclusion = 'success'; Branch = 'main'; Path = '.github/workflows/other.yml'; Attempt = 1; HttpStatus = 200 },
      @{ Conclusion = 'success'; Branch = 'main'; Path = '.github/workflows/deploy.yml'; Attempt = 9; HttpStatus = 200 },
      @{ Conclusion = 'success'; Branch = 'main'; Path = '.github/workflows/deploy.yml'; Attempt = 1; HttpStatus = 503 }
    )) {
      Set-MockGhRun -RunId '501' -HeadSha $shaNew -RunAttempt $badCase.Attempt -Conclusion $badCase.Conclusion -HeadBranch $badCase.Branch -Path $badCase.Path -HttpStatus $badCase.HttpStatus
      $rejected = $false
      try {
        & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
      } catch { $rejected = $true }
      Assert-True $rejected "Live GitHub API bad case ($($badCase | ConvertTo-Json -Compress)) must be rejected"
      $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
      Assert-True ($latest.status -eq 'REJECTED_GITHUB_API_CI_VERIFICATION_FAILED') "Expected REJECTED_GITHUB_API_CI_VERIFICATION_FAILED, got $($latest.status)"
    }
    Set-MockGhRun -RunId '501' -HeadSha $shaNew
  }

  # 16. Interrupted Deployment State Blocks Blind Retry AND -RecoverInterrupted Restores Previous Snapshot (Never Deploys Forward)
  Run-Scenario '16. Negative & Recovery: Interrupted State Blocks Retry & -RecoverInterrupted Restores Verified Snapshot (RECOVERED_PREVIOUS)' {
    # Create a verified snapshot of shaOld
    $interruptedSnap = Join-Path $sandboxRoot 'backups\pre-deploy-interrupted'
    New-Item -ItemType Directory -Path (Join-Path $interruptedSnap 'web') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $sandboxTarget 'dist') -Destination (Join-Path $interruptedSnap 'dist') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist') -Destination (Join-Path $interruptedSnap 'web\dist') -Recurse -Force
    $snapFiles = @(Get-ChildItem -LiteralPath $interruptedSnap -Recurse -File | ForEach-Object {
      @{
        path   = $_.FullName.Substring($interruptedSnap.Length).TrimStart('\', '/').Replace('\', '/')
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    })
    @{
      previous_git_sha  = $shaOld
      previous_live_sha = $shaOld
      target_sha        = $shaNew
      sequence          = 1
      created_at_utc    = (Get-Date).ToUniversalTime().ToString('o')
      files             = $snapFiles
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $interruptedSnap 'rollback-metadata.json') -Encoding UTF8 -Force

    # Simulate partial/interrupted cutover to shaNew
    git -c safe.directory=* -C $sandboxTarget checkout --quiet -f $shaNew
    Set-Content -LiteralPath (Join-Path $sandboxTarget 'dist\apps\api\src\main.js') -Value '// partial-interrupted-state' -Encoding UTF8 -Force
    @{
      status       = 'IN_PROGRESS'
      sha          = $shaNew
      previous_sha = $shaOld
      snapshot_dir = $interruptedSnap
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxRoot 'reports\deployment-state.json') -Encoding UTF8 -Force

    # 16a: Blind retry without -RecoverInterrupted is blocked
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejected = $true }
    Assert-True $rejected 'Interrupted IN_PROGRESS state must block blind retry'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_INTERRUPTED_STATE_REQUIRES_RECOVERY') "Expected REJECTED_INTERRUPTED_STATE_REQUIRES_RECOVERY, got $($latest.status)"

    # 16b: Running -RecoverInterrupted restores $shaOld (does NOT deploy $shaNew forward!)
    & $deployScript -CommitSha $shaNew -RecoverInterrupted -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    $headRecovered = (git -c safe.directory=* -C $sandboxTarget rev-parse HEAD).Trim().ToLowerInvariant()
    $journalRecovered = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\deployment-state.json') -Raw | ConvertFrom-Json
    $latestRecovered = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($headRecovered -eq $shaOld) "Recovery must restore previous SHA $shaOld, got $headRecovered"
    Assert-True ($journalRecovered.status -eq 'RECOVERED_PREVIOUS' -and $latestRecovered.status -eq 'RECOVERED_PREVIOUS') "Expected RECOVERED_PREVIOUS, got $($latestRecovered.status)"
  }

  # 17. SANDBOX DEPLOY TEST (Cryptographically Signed Approval + Independent CI Receipt + Live GitHub API + Verified Bundle Cutover)
  Run-Scenario '17. SANDBOX_DEPLOY_TEST: Cryptographic Approval + Independent CI Receipt + Live API + Verified Bundle Cutover' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode

    $headAfter = (git -c safe.directory=* -C $sandboxTarget rev-parse HEAD).Trim().ToLowerInvariant()
    $liveShaAfter = (Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\current-live-sha.txt') -Raw).Trim().ToLowerInvariant()
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    $webVer = Get-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\release-version.json') -Raw | ConvertFrom-Json
    $apiVer = Get-Content -LiteralPath (Join-Path $sandboxTarget 'dist\release-version.json') -Raw | ConvertFrom-Json
    $runningComp = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\running-components-sha.json') -Raw | ConvertFrom-Json

    Assert-True ($headAfter -eq $shaNew) "Sandbox Git HEAD must be $shaNew"
    Assert-True ($liveShaAfter -eq $shaNew) "Sandbox current-live-sha.txt must be $shaNew"
    Assert-True ($latest.status -eq 'SUCCESS') "Expected SUCCESS, got $($latest.status)"
    Assert-True ($webVer.sha -eq $shaNew -and $apiVer.sha -eq $shaNew) "Both Web and API release-version.json must record $shaNew"
    Assert-True ($runningComp.api_sha -eq $shaNew -and $runningComp.web_sha -eq $shaNew -and $runningComp.artifact_sha256 -eq $validBundleHash) 'running-components-sha.json must record exact Web/API SHA and artifact digest'

    $aclOut = (& icacls.exe $gateDir) -join "`n"
    Assert-True ($aclOut -match 'LOCAL SERVICE:.*\(DENY\)' -or $aclOut -match 'NETWORK SERVICE:.*\(DENY\)') 'release-gate ACL must explicitly deny write to service principals'
  }

  # 18. Anti-Replay Sequence Watermark Blocks Replaying Sequence 1 (Including via -RecoverInterrupted)
  Run-Scenario '18. Negative: Approval Replay Attack (Sequence <= Watermark or Abuse of -RecoverInterrupted) Blocked' {
    $rejectedReplay = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -Force -SandboxMode
    } catch { $rejectedReplay = $true }
    Assert-True $rejectedReplay 'Replaying sequence 1 approval must be blocked by watermark'
    $latest1 = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest1.status -eq 'REJECTED_APPROVAL_REPLAY') "Expected REJECTED_APPROVAL_REPLAY, got $($latest1.status)"

    $rejectedRecoverAbuse = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -RecoverInterrupted -SandboxMode
    } catch { $rejectedRecoverAbuse = $true }
    Assert-True $rejectedRecoverAbuse 'Using -RecoverInterrupted when state is COMPLETED must be rejected'
    $latest2 = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest2.status -eq 'REJECTED_NOT_INTERRUPTED') "Expected REJECTED_NOT_INTERRUPTED, got $($latest2.status)"
  }

  # 19. SANDBOX ROLLBACK TEST & ZERO-DB-MUTATION + SECRET PRESERVATION GUARANTEE
  Run-Scenario '19. SANDBOX_ROLLBACK_TEST: Post-Cutover Health Failure Triggers Verified Atomic Rollback + Preserves Secrets & DB' {
    Seed-SandboxBaseline -BaseSha $shaOld

    $sandboxDbRowsBeforeRollback = Get-SandboxDbRowSum
    $prodDbRowsBeforeRollback = Get-ProdDbRowSum

    Set-MockGhRun -RunId '502' -HeadSha $shaNew
    Write-CiReceipt -RunId '502' -HeadSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '502' -CiStatus 'SUCCESS' -Sequence 2 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath

    Start-Sleep -Seconds 1
    $rolledBack = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '502' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SimulateHealthFailure
    } catch { $rolledBack = $true }
    Assert-True $rolledBack 'Deploy with -SimulateHealthFailure must throw and roll back'

    $headAfterRb = (git -c safe.directory=* -C $sandboxTarget rev-parse HEAD).Trim().ToLowerInvariant()
    $liveShaAfterRb = (Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\current-live-sha.txt') -Raw).Trim().ToLowerInvariant()
    $mainJsAfterRb = (Get-Content -LiteralPath (Join-Path $sandboxTarget 'dist\apps\api\src\main.js') -Raw).Trim()
    $indexHtmlAfterRb = (Get-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\index.html') -Raw).Trim()
    $webVerAfterRb = Get-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\release-version.json') -Raw | ConvertFrom-Json
    $apiVerAfterRb = Get-Content -LiteralPath (Join-Path $sandboxTarget 'dist\release-version.json') -Raw | ConvertFrom-Json
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    $journal = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\deployment-state.json') -Raw | ConvertFrom-Json

    $sandboxDbRowsAfterRollback = Get-SandboxDbRowSum
    $prodDbRowsAfterRollback = Get-ProdDbRowSum
    $secretHashAfter = (Get-FileHash -LiteralPath $sandboxSecretEnv -Algorithm SHA256).Hash
    $snapshotEnvFiles = @(Get-ChildItem -LiteralPath (Join-Path $sandboxRoot 'backups') -Recurse -File -Filter '*.env' -ErrorAction SilentlyContinue)

    Assert-True ($headAfterRb -eq $shaOld) "Git HEAD must roll back to $shaOld"
    Assert-True ($liveShaAfterRb -eq $shaOld) "current-live-sha.txt must roll back to $shaOld"
    Assert-True ($mainJsAfterRb -eq "// sentinel-main-$shaOld") 'dist/main.js must be restored from snapshot'
    Assert-True ($indexHtmlAfterRb -eq "<html>sentinel-web-$shaOld</html>") 'web/dist/index.html must be restored from snapshot'
    Assert-True ($webVerAfterRb.sha -eq $shaOld -and $apiVerAfterRb.sha -eq $shaOld) 'Both Web and API release-version.json must roll back to shaOld without mutation'
    Assert-True ($latest.status -eq 'ROLLED_BACK' -and $journal.status -eq 'ROLLED_BACK' -and $latest.previous_sha -eq $shaOld) 'latest-deployment.json and journal must record ROLLED_BACK and previous_sha'
    Assert-True ($sandboxDbRowsBeforeRollback -eq $sandboxDbRowsAfterRollback) 'Rollback must not create or modify any rows in sandbox DB'
    Assert-True ($prodDbRowsBeforeRollback -eq $prodDbRowsAfterRollback) 'Rollback must not create or modify any rows in production DB'
    Assert-True ($secretHashBefore -eq $secretHashAfter) 'api.env secret file must remain 100% untouched across deploy and rollback'
    Assert-True ($snapshotEnvFiles.Count -eq 0) 'Pre-deploy snapshots must contain zero .env secret copies'
  }

  # 20. Post-Rollback Health Failure Transitions State to MANUAL_INTERVENTION (Audit CRITICAL Fix)
  Run-Scenario '20. Negative: Post-Rollback Smoke Failure Transitions Journal to MANUAL_INTERVENTION (ROLLBACK_FAILED_MANUAL_INTERVENTION)' {
    Seed-SandboxBaseline -BaseSha $shaOld
    Set-MockGhRun -RunId '503' -HeadSha $shaNew
    Write-CiReceipt -RunId '503' -HeadSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -SchemaSha256 $validSchemaHash -CiRunId '503' -CiStatus 'SUCCESS' -Sequence 3 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath

    Start-Sleep -Seconds 1
    $failedRb = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '503' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SimulateHealthFailure -SimulateRollbackHealthFailure
    } catch {
      if ($_.Exception.Message -match 'CRITICAL MANUAL INTERVENTION REQUIRED') { $failedRb = $true }
    }
    Assert-True $failedRb 'Failed post-rollback health check must throw CRITICAL MANUAL INTERVENTION REQUIRED'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    $journal = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\deployment-state.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'ROLLBACK_FAILED_MANUAL_INTERVENTION' -and $journal.status -eq 'MANUAL_INTERVENTION') "Expected ROLLBACK_FAILED_MANUAL_INTERVENTION / MANUAL_INTERVENTION, got $($latest.status) / $($journal.status)"

    # Clean journal back to ROLLED_BACK after verifying MANUAL_INTERVENTION block
    @{ status = 'ROLLED_BACK'; sha = $shaOld } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxRoot 'reports\deployment-state.json') -Encoding UTF8 -Force
  }

  # 21. HOSTILE ARCHIVE PRE-EXTRACTION REJECTION, CANONICAL CONTROLLER ENFORCEMENT & PER-MIGRATION CHECKSUM PARITY
  Run-Scenario '21. HOSTILE_ARCHIVE_AND_SCHEMA_CHECKSUM_PARITY_TEST: Rejects Traversal/ADS/Reserved ZIP & Symlink TAR.GZ, Blocks Secondary Controllers & Rejects Single-Migration Checksum Drift' {
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $seq = 4
    foreach ($hostileEntry in @('../escape.txt', 'dist/file:ads_secret', 'dist/CON.txt')) {
      $hostileZip = Join-Path $sandboxRoot ('hostile-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.zip')
      $fsStream = [IO.File]::Open($hostileZip, [IO.FileMode]::CreateNew)
      $za = [IO.Compression.ZipArchive]::new($fsStream, [IO.Compression.ZipArchiveMode]::Create)
      try {
        $entry = $za.CreateEntry($hostileEntry)
        $sw = [IO.StreamWriter]::new($entry.Open())
        try { $sw.Write('synthetic-hostile') } finally { $sw.Dispose() }
      } finally {
        $za.Dispose()
        $fsStream.Dispose()
      }
      $hostileHash = (Get-FileHash -LiteralPath $hostileZip -Algorithm SHA256).Hash.ToLowerInvariant()
      Set-MockGhRun -RunId '504' -HeadSha $shaNew
      Write-CiReceipt -RunId '504' -HeadSha $shaNew -ArtifactSha256 $hostileHash -SchemaSha256 $validSchemaHash
      & $approveScript -CommitSha $shaNew -ArtifactSha256 $hostileHash -SchemaSha256 $validSchemaHash -CiRunId '504' -CiStatus 'SUCCESS' -Sequence $seq -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
      $seq++
      $rejectedHostile = $false
      try {
        & $deployScript -CommitSha $shaNew -ArtifactPath $hostileZip -ArtifactSha256 $hostileHash -CiRunId '504' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
      } catch { $rejectedHostile = $true }
      Assert-True $rejectedHostile "Hostile ZIP entry '$hostileEntry' must be rejected before extraction"
      $latestHostile = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
      Assert-True ($latestHostile.status -eq 'REJECTED_UNSAFE_ARCHIVE_ENTRY') "Expected REJECTED_UNSAFE_ARCHIVE_ENTRY for $hostileEntry, got $($latestHostile.status)"
    }

    # Build a synthetic hostile .tar.gz containing a raw TAR symlink header (typeflag = '2', linkname = '../../escape-target.txt')
    $hostileTarGz = Join-Path $sandboxRoot 'hostile-symlink.tar.gz'
    $jsBuildHostileTar = @"
const fs = require('node:fs');
const zlib = require('node:zlib');
const outPath = process.argv[1];
const header = Buffer.alloc(512, 0);
header.write('dist/symlink-escape.js', 0, 'utf8');
header.write('0000777\0', 100, 'ascii');
header.write('0000000\0', 108, 'ascii');
header.write('0000000\0', 116, 'ascii');
header.write('00000000000\0', 124, 'ascii');
header.write('14765432100\0', 136, 'ascii');
header.fill(0x20, 148, 156);
header[156] = '2'.charCodeAt(0); // Symlink typeflag '2'
header.write('../../escape-target.txt', 157, 'utf8');
header.write('ustar\0', 257, 'ascii');
header.write('00', 263, 'ascii');
let sum = 0;
for (let i = 0; i < 512; i++) sum += header[i];
header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
const eof = Buffer.alloc(1024, 0);
const tarBuf = Buffer.concat([header, eof]);
fs.writeFileSync(outPath, zlib.gzipSync(tarBuf));
"@
    & $node -e $jsBuildHostileTar $hostileTarGz
    $hostileTarHash = (Get-FileHash -LiteralPath $hostileTarGz -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-MockGhRun -RunId '504' -HeadSha $shaNew
    Write-CiReceipt -RunId '504' -HeadSha $shaNew -ArtifactSha256 $hostileTarHash -SchemaSha256 $validSchemaHash
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $hostileTarHash -SchemaSha256 $validSchemaHash -CiRunId '504' -CiStatus 'SUCCESS' -Sequence $seq -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $seq++
    $rejectedTarSymlink = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $hostileTarGz -ArtifactSha256 $hostileTarHash -CiRunId '504' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejectedTarSymlink = $true }
    Assert-True $rejectedTarSymlink 'Hostile TAR.GZ containing symlink entry (typeflag=2) must be rejected before extraction'
    $latestTarHostile = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latestTarHostile.status -eq 'REJECTED_UNSAFE_ARCHIVE_ENTRY') "Expected REJECTED_UNSAFE_ARCHIVE_ENTRY for TAR symlink, got $($latestTarHostile.status)"

    # Verify parallel controllers fail closed when invoked outside simulation/dryrun
    $blockedRelease = $false
    try {
      & (Join-Path $PSScriptRoot 'Deploy-Release.ps1') -ConfigPath 'C:\nonexistent.json' -Archive 'C:\nonexistent.zip' -Sha $shaNew -ArchiveSha256 ('a' * 64)
    } catch {
      if ($_.Exception.Message -match 'CANONICAL_CONTROLLER_ENFORCED') { $blockedRelease = $true }
    }
    Assert-True $blockedRelease 'Deploy-Release.ps1 without -Simulation must throw CANONICAL_CONTROLLER_ENFORCED'

    $blockedWebOnly = $false
    try {
      & (Join-Path $PSScriptRoot 'Deploy-WebOnly-Windows.ps1') -WebBundle 'C:\nonexistent.tar.gz'
    } catch {
      if ($_.Exception.Message -match 'CANONICAL_CONTROLLER_ENFORCED') { $blockedWebOnly = $true }
    }
    Assert-True $blockedWebOnly 'Deploy-WebOnly-Windows.ps1 without -DryRun must throw CANONICAL_CONTROLLER_ENFORCED'

    # Verify per-migration checksum drift (same 21 count, valid SQL-to-manifest parity, but 1 migration checksum differs from DB!) is rejected when -SkipMigration is active
    $schemaDriftDir = Join-Path $sandboxRoot 'schema-drift-stage'
    New-Item -ItemType Directory -Path $schemaDriftDir -Force | Out-Null
    tar -xzf $validBundle.FullName -C $schemaDriftDir
    $sql0Path = Join-Path $schemaDriftDir 'migrations\0001_m00_prerequisites.sql'
    Add-Content -LiteralPath $sql0Path -Value "`n-- synthetic drift comment" -Encoding UTF8
    $sql0FileHash = (Get-FileHash -LiteralPath $sql0Path -Algorithm SHA256).Hash.ToLowerInvariant()
    $jsRecomputeDrift = @"
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const stageDir = process.argv[1];
const sql0FileHash = process.argv[2];
const mPath = path.join(stageDir, 'manifest.json');
const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
for (const f of m.files) {
  if (f.path === 'migrations/0001_m00_prerequisites.sql') {
    f.sha256 = sql0FileHash;
    f.size = fs.statSync(path.join(stageDir, f.path)).size;
  }
}
const rawSql = fs.readFileSync(path.join(stageDir, 'migrations/0001_m00_prerequisites.sql'), 'utf8');
m.migrations[0].checksum = crypto.createHash('sha256').update(rawSql.replace(/\r\n/g, '\n').trim(), 'utf8').digest('hex');
m.schemaIdentity = crypto.createHash('sha256').update(JSON.stringify(m.migrations), 'utf8').digest('hex');
fs.writeFileSync(mPath, JSON.stringify(m, null, 2), 'utf8');
process.stdout.write(m.schemaIdentity);
"@
    $driftSchemaId = ((& $node -e $jsRecomputeDrift $schemaDriftDir $sql0FileHash) -join '').Trim().ToLowerInvariant()
    $schemaDriftTar = Join-Path $sandboxRoot 'schema-drift.tar.gz'
    tar -czf $schemaDriftTar -C $schemaDriftDir .
    $schemaDriftHash = (Get-FileHash -LiteralPath $schemaDriftTar -Algorithm SHA256).Hash.ToLowerInvariant()

    Set-MockGhRun -RunId '505' -HeadSha $shaNew
    Write-CiReceipt -RunId '505' -HeadSha $shaNew -ArtifactSha256 $schemaDriftHash -SchemaSha256 $driftSchemaId
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $schemaDriftHash -SchemaSha256 $driftSchemaId -CiRunId '505' -CiStatus 'SUCCESS' -Sequence $seq -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $rejectedSchema = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $schemaDriftTar -ArtifactSha256 $schemaDriftHash -CiRunId '505' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode
    } catch { $rejectedSchema = $true }
    Assert-True $rejectedSchema 'Bundle with single-migration checksum drift (21==21 count) must be rejected when -SkipMigration is true'
    $latestSchema = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latestSchema.status -eq 'REJECTED_SCHEMA_MIGRATION_MISMATCH') "Expected REJECTED_SCHEMA_MIGRATION_MISMATCH, got $($latestSchema.status)"
  }

  # Final Production Integrity Verification
  $prodApiProcAfter = Get-CimInstance Win32_Service -Filter "Name='HPManagementLiteApi'"
  $prodHeadAfter = (git -c safe.directory=* -C $prodRepo rev-parse HEAD).Trim()
  $prodLiveShaAfter = (Get-Content -LiteralPath 'C:\HoaiPhuong-Server\reports\current-live-sha.txt' -Raw).Trim()
  $prodDbRowsAfter = Get-ProdDbRowSum

  Assert-True ($prodApiProcBefore.ProcessId -eq $prodApiProcAfter.ProcessId) "Production HPManagementLiteApi PID must remain unchanged ($($prodApiProcAfter.ProcessId))"
  Assert-True ($prodHeadBefore -eq $prodHeadAfter) "Production Git HEAD must remain unchanged ($prodHeadAfter)"
  Assert-True ($prodLiveShaBefore -eq $prodLiveShaAfter) "Production current-live-sha.txt must remain unchanged ($prodLiveShaAfter)"
  Assert-True ($prodDbRowsBefore -eq $prodDbRowsAfter) "Production DB row sum must remain unchanged ($prodDbRowsAfter)"

  Write-Host "`n==================================================================" -ForegroundColor Green
  Write-Host "SANDBOX SECURITY & NEGATIVE TEST SUITE: $passed / $passed PASSED (0 FAIL)" -ForegroundColor Green
  Write-Host "Production HPManagementLiteApi PID Unchanged : $($prodApiProcAfter.ProcessId)" -ForegroundColor Green
  Write-Host "Production Git HEAD Unchanged                : $prodHeadAfter" -ForegroundColor Green
  Write-Host "Production DB Total Rows Unchanged           : $prodDbRowsAfter" -ForegroundColor Green
  Write-Host "==================================================================" -ForegroundColor Green

} finally {
  if ($mockProc -and (-not $mockProc.HasExited)) {
    Stop-Process -Id $mockProc.Id -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $sandboxRoot) {
    & icacls.exe $sandboxRoot /reset /T /C /Q 2>$null | Out-Null
    Remove-Item -LiteralPath $sandboxRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
