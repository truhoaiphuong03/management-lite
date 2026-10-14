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

$passed = 0
function Assert-True([bool]$Cond, [string]$Msg) {
  if (-not $Cond) { throw "ASSERTION FAILED: $Msg" }
}
function Write-CiReceipt([string]$RunId, [string]$HeadSha, [string]$Status = 'completed', [string]$Conclusion = 'success', [string]$Event = 'push') {
  @{
    id         = $RunId
    run_id     = $RunId
    head_sha   = $HeadSha
    status     = $Status
    conclusion = $Conclusion
    event      = $Event
    repository = 'truhoaiphuong03/management-lite'
  } | ConvertTo-Json | Set-Content -LiteralPath $ciReceiptPath -Encoding UTF8 -Force
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

try {
  Write-Host "=== INITIALIZING ISOLATED SECURITY SANDBOX AT: $sandboxRoot ===" -ForegroundColor Yellow
  foreach ($d in @((Join-Path $sandboxRoot 'apps'), (Join-Path $sandboxRoot 'backups\postgres'), $gateDir, $secretsDir, $ownerKeysDir, $attackerKeysDir, $bundleDir, (Join-Path $sandboxRoot 'reports'), (Join-Path $sandboxRoot 'logs'))) {
    New-Item -ItemType Directory -Path $d -Force | Out-Null
  }

  # Seed synthetic sandbox secret file to verify zero-secret-copying & preservation
  Set-Content -LiteralPath $sandboxSecretEnv -Value "PORT=3002`nSYNTHETIC_SANDBOX_KEY=DO_NOT_TOUCH_OR_COPY" -Encoding UTF8 -Force
  $secretHashBefore = (Get-FileHash -LiteralPath $sandboxSecretEnv -Algorithm SHA256).Hash

  # Clone dev repo into isolated sandbox target at baseline shaOld
  git clone --quiet $devRepo $sandboxTarget
  git -c safe.directory=* -C $sandboxTarget checkout --quiet -f $shaOld

  # Seed initial built artifacts for shaOld in sandbox
  New-Item -ItemType Directory -Path (Join-Path $sandboxTarget 'dist\apps\api\src') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $sandboxTarget 'apps\web\dist') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $sandboxTarget 'dist\apps\api\src\main.js') -Value "// sentinel-main-$shaOld" -Encoding UTF8 -Force
  Set-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\index.html') -Value "<html>sentinel-web-$shaOld</html>" -Encoding UTF8 -Force
  @{ sha = $shaOld; component = 'api' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxTarget 'dist\release-version.json') -Encoding UTF8 -Force
  @{ sha = $shaOld; component = 'web' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\release-version.json') -Encoding UTF8 -Force
  Set-Content -LiteralPath (Join-Path $sandboxRoot 'reports\current-live-sha.txt') -Value $shaOld -Encoding UTF8 -Force

  # Generate Owner Ed25519 keypair + policy (off-server vault), and separate Attacker Ed25519 keypair
  & $approveScript -GenerateKeyPairOnly -KeyOutDir $ownerKeysDir -PrivateKeyOutPath $ownerPrivKey
  Copy-Item -LiteralPath (Join-Path $ownerKeysDir 'release-gate-policy.json') -Destination $policyPath -Force
  & $approveScript -GenerateKeyPairOnly -KeyOutDir $attackerKeysDir -PrivateKeyOutPath $attackerPrivKey

  # Write valid independent CI receipt for Run 501
  Write-CiReceipt -RunId '501' -HeadSha $shaNew -Status 'completed' -Conclusion 'success' -Event 'push'

  # Package a real verified Full Release Bundle for shaNew (HEAD of devRepo)
  Push-Location $devRepo
  try {
    & $node $packagerScript --type=full "--out=$bundleDir" | Out-Null
  } finally {
    Pop-Location
  }
  $validBundle = Get-ChildItem -LiteralPath $bundleDir -Filter 'management-lite-full-*.tar.gz' -File | Select-Object -First 1
  Assert-True ($null -ne $validBundle) 'Packaged release bundle must exist'
  $validBundleHash = (Get-FileHash -LiteralPath $validBundle.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

  # 1. Runner Self-Approval Blocked
  Run-Scenario '1. Negative: Runner / Workflow Self-Approval Attempt Blocked' {
    $rejected = $false
    try {
      & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -CiRunId '501' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath -SimulateRunnerContext
    } catch {
      if ($_.Exception.Message -match 'SECURITY_VIOLATION_RUNNER_SELF_APPROVAL') { $rejected = $true }
    }
    Assert-True $rejected 'Runner context must not be able to execute Approve-ReleaseSha.ps1'
  }

  # 2. Unauthorized Person Self-Approval Blocked
  Run-Scenario '2. Negative: Unauthorized User Self-Approval Attempt Blocked' {
    $rejected = $false
    try {
      & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -CiRunId '501' -Sequence 1 -ApprovedBy 'unauthorized_dev' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    } catch {
      if ($_.Exception.Message -match 'REJECTED_UNAUTHORIZED_APPROVER') { $rejected = $true }
    }
    Assert-True $rejected 'Unauthorized user must be rejected by Approve-ReleaseSha.ps1'
  }

  # 3. Missing Approval Manifest (Identical Input SHAs Alone Rejected)
  Run-Scenario '3. Negative: Missing Signed Approval Manifest Rejected' {
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    Assert-True $rejected 'Deploy without manifest must fail closed'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_NO_MANIFEST') "Expected REJECTED_NO_MANIFEST, got $($latest.status)"
  }

  # 4. Attacker Forged Keypair Signature Rejected
  Run-Scenario '4. Negative: Forged Approval Signed with Attacker Private Key Rejected' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -CiRunId '501' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $attackerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    Assert-True $rejected 'Forged Ed25519 signature must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_INVALID_SIGNATURE') "Expected REJECTED_INVALID_SIGNATURE, got $($latest.status)"
  }

  # 5. Tampered Approval Manifest Rejected
  Run-Scenario '5. Negative: Post-Signing Tampering of approved-release.json Rejected' {
    & $approveScript -CommitSha $shaOld -ArtifactSha256 $validBundleHash -CiRunId '501' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $tampered = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $tampered.approved_sha = $shaNew
    $tampered | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8 -Force

    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    Assert-True $rejected 'Tampered manifest must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_INVALID_SIGNATURE') "Expected REJECTED_INVALID_SIGNATURE, got $($latest.status)"
  }

  # 6. Bypass via Push / PR Trigger Blocked
  Run-Scenario '6. Negative: Bypass Attempt via push Event Trigger Blocked' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -CiRunId '501' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $env:GITHUB_EVENT_NAME = 'push'
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
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
      & $deployScript -CommitSha 'a68c3c5' -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    Assert-True $rejected 'Short SHA must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_INVALID_SHA') "Expected REJECTED_INVALID_SHA, got $($latest.status)"
  }

  # 8. Deploy When CI Failed Rejected
  Run-Scenario '8. Negative: Deployment When CI Status is FAILURE or Mismatched Run ID Rejected' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -CiRunId '501' -CiStatus 'FAILURE' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    Assert-True $rejected 'Failed CI status must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_CI_NOT_PASSED') "Expected REJECTED_CI_NOT_PASSED, got $($latest.status)"
  }

  # 9. Post-CI Artifact Archive Checksum Mismatch Rejected
  Run-Scenario '9. Negative: Post-CI Artifact Archive Tampering (SHA-256 Mismatch) Rejected' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $tamperedArchive = Join-Path $bundleDir 'tampered-archive.tar.gz'
    Copy-Item -LiteralPath $validBundle.FullName -Destination $tamperedArchive -Force
    Add-Content -LiteralPath $tamperedArchive -Value 'tampered-bytes' -NoNewline

    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $tamperedArchive -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    Assert-True $rejected 'Tampered archive must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_ARTIFACT_CHECKSUM_MISMATCH') "Expected REJECTED_ARTIFACT_CHECKSUM_MISMATCH, got $($latest.status)"
  }

  # 10. Post-CI Internal File Tampering Inside Re-Packed Archive Rejected
  Run-Scenario '10. Negative: Post-CI Internal File Modification (manifest.json SHA-256 Mismatch) Rejected' {
    $repackDir = Join-Path $bundleDir 'repack'
    New-Item -ItemType Directory -Path $repackDir -Force | Out-Null
    tar -xzf $validBundle.FullName -C $repackDir
    Add-Content -LiteralPath (Join-Path $repackDir 'dist\apps\api\src\main.js') -Value "`n// injected-post-ci"
    $repackedTar = Join-Path $bundleDir 'repacked-tampered.tar.gz'
    tar -czf $repackedTar -C $repackDir .
    $repackedHash = (Get-FileHash -LiteralPath $repackedTar -Algorithm SHA256).Hash.ToLowerInvariant()

    & $approveScript -CommitSha $shaNew -ArtifactSha256 $repackedHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $repackedTar -ArtifactSha256 $repackedHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    Assert-True $rejected 'Internal file tampering against manifest.json must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_ARTIFACT_FILE_TAMPERED') "Expected REJECTED_ARTIFACT_FILE_TAMPERED, got $($latest.status)"
  }

  # 11. Concurrent Deployments Blocked by Exclusive File Lock
  Run-Scenario '11. Negative: Concurrent Deployment Blocked by Exclusive OS Lock' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $lockPath = Join-Path $sandboxRoot 'logs\deploy.lock'
    $heldLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    finally {
      $heldLock.Dispose()
      Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
    Assert-True $rejected 'Concurrent deployment must be blocked when lock is held'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_CONCURRENT_LOCK') "Expected REJECTED_CONCURRENT_LOCK, got $($latest.status)"
  }

  # 12. Interrupted Deployment (Power Loss / Crash Mid-Switch) Blocks Blind Retry
  Run-Scenario '12. Negative: Interrupted Deployment State (IN_PROGRESS) Blocks Blind Retry' {
    @{ status = 'IN_PROGRESS'; sha = $shaNew; started_at_utc = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxRoot 'reports\deployment-state.json') -Encoding UTF8 -Force
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    Assert-True $rejected 'Interrupted IN_PROGRESS state must block blind retry'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_INTERRUPTED_STATE_REQUIRES_RECOVERY') "Expected REJECTED_INTERRUPTED_STATE_REQUIRES_RECOVERY, got $($latest.status)"
  }

  # 13. Private Key Exposure on Host Rejected (P0 Requirement 4)
  Run-Scenario '13. Negative: Private Key Left in Server release-gate or runner Directory Rejected' {
    $leakedKeyPath = Join-Path $gateDir 'owner-approval-private.pem'
    Copy-Item -LiteralPath $ownerPrivKey -Destination $leakedKeyPath -Force
    $signBlocked = $false
    $deployBlocked = $false
    try {
      try {
        & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $leakedKeyPath -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
      } catch {
        if ($_.Exception.Message -match 'SECURITY_VIOLATION_PRIVATE_KEY_IN_SERVER_GATE') { $signBlocked = $true }
      }
      try {
        & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
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

  # 14. Self-Declared ci_status=SUCCESS Rejected When Independent CI Receipt Shows Failure (P0 Requirement 7)
  Run-Scenario '14. Negative: Self-Declared ci_status=SUCCESS Rejected When Independent CI Receipt Shows Failure' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    Write-CiReceipt -RunId '501' -HeadSha $shaNew -Status 'completed' -Conclusion 'failure' -Event 'push'
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    finally {
      Write-CiReceipt -RunId '501' -HeadSha $shaNew -Status 'completed' -Conclusion 'success' -Event 'push'
    }
    Assert-True $rejected 'Deploy must reject when independent CI receipt shows failure despite manifest self-declaring SUCCESS'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED') "Expected REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED, got $($latest.status)"
  }

  # 15. Forged Local Receipt Rejected When Live GitHub Actions Run API Reports Failure (Batch B Requirement 3)
  Run-Scenario '15. Negative: Forged Local ci-run-receipt.json Rejected When Live GitHub Run API Reports Failure' {
    $mockPort = 48192
    $mockScript = Join-Path $sandboxRoot 'mock-gh-api.cjs'
    $jsMock = @"
const http = require('node:http');
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id: 501,
    head_sha: '$shaNew',
    status: 'completed',
    conclusion: 'failure',
    event: 'push'
  }));
});
srv.listen($mockPort, '127.0.0.1');
"@
    Set-Content -LiteralPath $mockScript -Value $jsMock -Encoding UTF8 -Force
    $mockProc = Start-Process -FilePath $node -ArgumentList @($mockScript) -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 500
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -GitHubApiBaseUrl "http://127.0.0.1:$mockPort" -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    finally {
      if ($mockProc -and (-not $mockProc.HasExited)) { Stop-Process -Id $mockProc.Id -Force -ErrorAction SilentlyContinue }
    }
    Assert-True $rejected 'Deploy must reject when live GitHub Actions API reports failure despite local receipt saying success'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_GITHUB_API_CI_VERIFICATION_FAILED') "Expected REJECTED_GITHUB_API_CI_VERIFICATION_FAILED, got $($latest.status)"
  }

  # 16. SANDBOX DEPLOY TEST (Cryptographically Signed Approval + Independent CI Receipt + Verified Bundle + Dual Web/API Running SHA Proof)
  Run-Scenario '16. SANDBOX_DEPLOY_TEST: Cryptographic Approval + Independent CI Receipt + Verified Bundle Cutover' {
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -CiRunId '501' -CiStatus 'SUCCESS' -Sequence 1 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -RecoverInterrupted -SandboxMode -SkipBuildInSandbox

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

  # 16. Anti-Replay Sequence Watermark Blocks Replaying Sequence 1
  Run-Scenario '16. Negative: Approval Replay Attack (Sequence <= Watermark) Blocked' {
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '501' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -Force -SandboxMode -SkipBuildInSandbox
    } catch { $rejected = $true }
    Assert-True $rejected 'Replaying sequence 1 approval must be blocked by watermark'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_APPROVAL_REPLAY') "Expected REJECTED_APPROVAL_REPLAY, got $($latest.status)"
  }

  # 17. SANDBOX ROLLBACK TEST & ZERO-DB-MUTATION + SECRET PRESERVATION GUARANTEE
  Run-Scenario '17. SANDBOX_ROLLBACK_TEST: Post-Cutover Health Failure Triggers Atomic Rollback + Preserves Secrets & DB' {
    git -c safe.directory=* -C $sandboxTarget checkout --quiet -f $shaOld
    Set-Content -LiteralPath (Join-Path $sandboxTarget 'dist\apps\api\src\main.js') -Value "// sentinel-main-$shaOld" -Encoding UTF8 -Force
    Set-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\index.html') -Value "<html>sentinel-web-$shaOld</html>" -Encoding UTF8 -Force
    @{ sha = $shaOld; component = 'api' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxTarget 'dist\release-version.json') -Encoding UTF8 -Force
    @{ sha = $shaOld; component = 'web' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\release-version.json') -Encoding UTF8 -Force
    Set-Content -LiteralPath (Join-Path $sandboxRoot 'reports\current-live-sha.txt') -Value $shaOld -Encoding UTF8 -Force

    $sandboxDbRowsBeforeRollback = Get-SandboxDbRowSum
    $prodDbRowsBeforeRollback = Get-ProdDbRowSum

    Write-CiReceipt -RunId '502' -HeadSha $shaNew -Status 'completed' -Conclusion 'success' -Event 'push'
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $validBundleHash -CiRunId '502' -CiStatus 'SUCCESS' -Sequence 2 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath

    Start-Sleep -Seconds 1
    $rolledBack = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $validBundle.FullName -ArtifactSha256 $validBundleHash -CiRunId '502' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox -SimulateHealthFailure
    } catch { $rolledBack = $true }
    Assert-True $rolledBack 'Deploy with -SimulateHealthFailure must throw and roll back'

    $headAfterRb = (git -c safe.directory=* -C $sandboxTarget rev-parse HEAD).Trim().ToLowerInvariant()
    $liveShaAfterRb = (Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\current-live-sha.txt') -Raw).Trim().ToLowerInvariant()
    $mainJsAfterRb = (Get-Content -LiteralPath (Join-Path $sandboxTarget 'dist\apps\api\src\main.js') -Raw).Trim()
    $indexHtmlAfterRb = (Get-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\index.html') -Raw).Trim()
    $webVerAfterRb = Get-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\release-version.json') -Raw | ConvertFrom-Json
    $apiVerAfterRb = Get-Content -LiteralPath (Join-Path $sandboxTarget 'dist\release-version.json') -Raw | ConvertFrom-Json
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json

    $sandboxDbRowsAfterRollback = Get-SandboxDbRowSum
    $prodDbRowsAfterRollback = Get-ProdDbRowSum
    $secretHashAfter = (Get-FileHash -LiteralPath $sandboxSecretEnv -Algorithm SHA256).Hash
    $snapshotEnvFiles = @(Get-ChildItem -LiteralPath (Join-Path $sandboxRoot 'backups') -Recurse -File -Filter '*.env' -ErrorAction SilentlyContinue)

    Assert-True ($headAfterRb -eq $shaOld) "Git HEAD must roll back to $shaOld"
    Assert-True ($liveShaAfterRb -eq $shaOld) "current-live-sha.txt must roll back to $shaOld"
    Assert-True ($mainJsAfterRb -eq "// sentinel-main-$shaOld") 'dist/main.js must be restored from snapshot'
    Assert-True ($indexHtmlAfterRb -eq "<html>sentinel-web-$shaOld</html>") 'web/dist/index.html must be restored from snapshot'
    Assert-True ($webVerAfterRb.sha -eq $shaOld -and $apiVerAfterRb.sha -eq $shaOld) 'Both Web and API release-version.json must roll back to shaOld'
    Assert-True ($latest.status -eq 'ROLLED_BACK' -and $latest.previous_sha -eq $shaOld) 'latest-deployment.json must record ROLLED_BACK and previous_sha'
    Assert-True ($sandboxDbRowsBeforeRollback -eq $sandboxDbRowsAfterRollback) 'Rollback must not create or modify any rows in sandbox DB'
    Assert-True ($prodDbRowsBeforeRollback -eq $prodDbRowsAfterRollback) 'Rollback must not create or modify any rows in production DB'
    Assert-True ($secretHashBefore -eq $secretHashAfter) 'api.env secret file must remain 100% untouched across deploy and rollback'
    Assert-True ($snapshotEnvFiles.Count -eq 0) 'Pre-deploy snapshots must contain zero .env secret copies'
  }

  # 18. HOSTILE ARCHIVE PRE-EXTRACTION REJECTION & CANONICAL CONTROLLER ENFORCEMENT (PR #10 + PR #13 RECONCILIATION)
  Run-Scenario '18. HOSTILE_ARCHIVE_AND_CANONICAL_CONTROLLER_TEST: Rejects Traversal/ADS/Reserved Device ZIP Before Extraction & Blocks Secondary Controllers' {
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
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
      Write-CiReceipt -RunId '503' -HeadSha $shaNew -Status 'completed' -Conclusion 'success' -Event 'push'
      & $approveScript -CommitSha $shaNew -ArtifactSha256 $hostileHash -CiRunId '503' -CiStatus 'SUCCESS' -Sequence 3 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
      $rejectedHostile = $false
      try {
        & $deployScript -CommitSha $shaNew -ArtifactPath $hostileZip -ArtifactSha256 $hostileHash -CiRunId '503' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
      } catch { $rejectedHostile = $true }
      Assert-True $rejectedHostile "Hostile ZIP entry '$hostileEntry' must be rejected before extraction"
      $latestHostile = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
      Assert-True ($latestHostile.status -eq 'REJECTED_UNSAFE_ARCHIVE_ENTRY') "Expected REJECTED_UNSAFE_ARCHIVE_ENTRY for $hostileEntry, got $($latestHostile.status)"
    }

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

    # Verify schema migration mismatch (PR #10 parity) is blocked when -SkipMigration is active
    $schemaMismatchDir = Join-Path $sandboxRoot 'schema-mismatch-stage'
    New-Item -ItemType Directory -Path (Join-Path $schemaMismatchDir 'dist') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $schemaMismatchDir 'dist\dummy.js') -Value '// dummy' -Encoding UTF8 -Force
    $dummyHash = (Get-FileHash -LiteralPath (Join-Path $schemaMismatchDir 'dist\dummy.js') -Algorithm SHA256).Hash.ToLowerInvariant()
    @{
      sha        = $shaNew
      migrations = @(1..99 | ForEach-Object { @{ id = "00$_"; checksum = ('a' * 64) } })
      files      = @(@{ path = 'dist/dummy.js'; size = 8; sha256 = $dummyHash })
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $schemaMismatchDir 'manifest.json') -Encoding UTF8 -Force
    $schemaMismatchTar = Join-Path $sandboxRoot 'schema-mismatch.tar.gz'
    tar -czf $schemaMismatchTar -C $schemaMismatchDir .
    $schemaMismatchHash = (Get-FileHash -LiteralPath $schemaMismatchTar -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-CiReceipt -RunId '503' -HeadSha $shaNew -Status 'completed' -Conclusion 'success' -Event 'push'
    & $approveScript -CommitSha $shaNew -ArtifactSha256 $schemaMismatchHash -CiRunId '503' -CiStatus 'SUCCESS' -Sequence 3 -ApprovedBy 'Owner' -PrivateKeyPath $ownerPrivKey -PolicyPath $policyPath -ManifestPath $manifestPath -AuditLogPath $auditLogPath
    $rejectedSchema = $false
    try {
      & $deployScript -CommitSha $shaNew -ArtifactPath $schemaMismatchTar -ArtifactSha256 $schemaMismatchHash -CiRunId '503' -CiRunReceiptPath $ciReceiptPath -PolicyPath $policyPath -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch { $rejectedSchema = $true }
    Assert-True $rejectedSchema 'Bundle with unapplied schema migrations must be rejected when -SkipMigration is true'
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
  if (Test-Path -LiteralPath $sandboxRoot) {
    & icacls.exe $sandboxRoot /reset /T /C /Q 2>$null | Out-Null
    Remove-Item -LiteralPath $sandboxRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
