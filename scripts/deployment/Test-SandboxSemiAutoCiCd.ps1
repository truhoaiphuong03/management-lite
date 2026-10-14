#requires -Version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$devRepo = 'C:\HoaiPhuong-Server\workspace\management-lite-dev'
$prodRepo = 'C:\HoaiPhuong-Server\apps\management-lite'
$approveScript = Join-Path $devRepo 'scripts\deployment\Approve-ReleaseSha.ps1'
$deployScript = Join-Path $devRepo 'scripts\deployment\Deploy-SemiAutoWindows.ps1'

$shaOld = (git -c safe.directory=* -C $devRepo rev-parse 3743e99).Trim().ToLowerInvariant()
$shaNew = (git -c safe.directory=* -C $devRepo rev-parse a68c3c5).Trim().ToLowerInvariant()

$sandboxRoot = Join-Path ([IO.Path]::GetTempPath()) ('ml-semi-auto-sandbox-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$sandboxTarget = Join-Path $sandboxRoot 'apps\management-lite'
$manifestPath = Join-Path $sandboxRoot 'config\release-gate\approved-release.json'

$passed = 0
function Assert-True([bool]$Cond, [string]$Msg) {
  if (-not $Cond) { throw "ASSERTION FAILED: $Msg" }
}
function Run-Scenario([string]$Name, [scriptblock]$Body) {
  Write-Host "`n--- SCENARIO: $Name ---" -ForegroundColor Cyan
  & $Body
  $script:passed++
  Write-Host "[PASS] $Name" -ForegroundColor Green
}

# Record Production Baseline BEFORE sandbox test
$prodApiProcBefore = Get-CimInstance Win32_Service -Filter "Name='HPManagementLiteApi'"
$prodHeadBefore = (git -c safe.directory=* -C $prodRepo rev-parse HEAD).Trim()
$prodLiveShaBefore = (Get-Content -LiteralPath 'C:\HoaiPhuong-Server\reports\current-live-sha.txt' -Raw).Trim()

try {
  Write-Host "=== INITIALIZING ISOLATED SANDBOX AT: $sandboxRoot ===" -ForegroundColor Yellow
  New-Item -ItemType Directory -Path (Join-Path $sandboxRoot 'apps') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $sandboxRoot 'backups\postgres') -Force | Out-Null

  # Clone dev repo into isolated sandbox target
  git clone --quiet $devRepo $sandboxTarget
  git -c safe.directory=* -C $sandboxTarget checkout --quiet -f $shaOld

  # Seed initial built artifacts for shaOld in sandbox
  New-Item -ItemType Directory -Path (Join-Path $sandboxTarget 'dist\apps\api\src') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $sandboxTarget 'apps\web\dist') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $sandboxTarget 'dist\apps\api\src\main.js') -Value "// baseline build for $shaOld" -Encoding UTF8 -Force
  Set-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\index.html') -Value "<html>Management Lite Baseline $shaOld</html>" -Encoding UTF8 -Force
  @{ sha = $shaOld; environment = 'sandbox' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\release-version.json') -Encoding UTF8 -Force
  New-Item -ItemType Directory -Path (Join-Path $sandboxRoot 'reports') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $sandboxRoot 'reports\current-live-sha.txt') -Value $shaOld -Encoding UTF8 -Force

  # 1. Missing Approval Manifest
  Run-Scenario '1. Gate Rejection: Missing Owner Approval Manifest' {
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -OwnerApprovedSha $shaNew -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch {
      $rejected = $true
    }
    Assert-True $rejected 'Deploy without manifest must fail closed'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_NO_MANIFEST') "Expected REJECTED_NO_MANIFEST, got $($latest.status)"
  }

  # 2. Invalid Short SHA
  Run-Scenario '2. Gate Rejection: Short/Non-40-Char SHA Rejected' {
    $rejected = $false
    try {
      & $deployScript -CommitSha 'a68c3c5' -OwnerApprovedSha 'a68c3c5' -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch {
      $rejected = $true
    }
    Assert-True $rejected 'Short SHA must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_INVALID_SHA') "Expected REJECTED_INVALID_SHA, got $($latest.status)"
  }

  # 3. Approved SHA Mismatch
  Run-Scenario '3. Gate Rejection: Unapproved Commit SHA Mismatch' {
    & $approveScript -CommitSha $shaOld -ApprovedBy 'Owner' -Reason 'Approve old baseline only' -ManifestPath $manifestPath
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -OwnerApprovedSha $shaNew -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch {
      $rejected = $true
    }
    Assert-True $rejected 'Unapproved SHA must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_UNAPPROVED_SHA') "Expected REJECTED_UNAPPROVED_SHA, got $($latest.status)"
  }

  # 4. Expired Approval Manifest
  Run-Scenario '4. Gate Rejection: Expired Owner Approval Manifest' {
    & $approveScript -CommitSha $shaNew -ApprovedBy 'Owner' -Reason 'Expired test' -ExpiresInMinutes -5 -ManifestPath $manifestPath
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -OwnerApprovedSha $shaNew -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    } catch {
      $rejected = $true
    }
    Assert-True $rejected 'Expired approval must be rejected'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_EXPIRED_APPROVAL') "Expected REJECTED_EXPIRED_APPROVAL, got $($latest.status)"
  }

  # 5. Unapproved Migration Blocked
  Run-Scenario '5. Gate Rejection: Unapproved Database Migration Blocked' {
    & $approveScript -CommitSha $shaNew -ApprovedBy 'Owner' -Reason 'Code-only release (no migration)' -ExpiresInMinutes 60 -ManifestPath $manifestPath
    $rejected = $false
    try {
      & $deployScript -CommitSha $shaNew -OwnerApprovedSha $shaNew -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SkipMigration:$false -SandboxMode -SkipBuildInSandbox
    } catch {
      $rejected = $true
    }
    Assert-True $rejected 'Unapproved migration must be blocked'
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'REJECTED_UNAPPROVED_MIGRATION') "Expected REJECTED_UNAPPROVED_MIGRATION, got $($latest.status)"
  }

  # 6. SANDBOX DEPLOY TEST (Approved SHA Cutover + Pre-Deploy DB Backup + Zero Secret Proliferation)
  Run-Scenario '6. SANDBOX_DEPLOY_TEST: Approved SHA Cutover & Verification' {
    & $approveScript -CommitSha $shaNew -ApprovedBy 'Owner' -Reason 'Sandbox deploy verification' -ExpiresInMinutes 60 -ManifestPath $manifestPath
    & $deployScript -CommitSha $shaNew -OwnerApprovedSha $shaNew -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox

    $headAfter = (git -c safe.directory=* -C $sandboxTarget rev-parse HEAD).Trim().ToLowerInvariant()
    $liveShaAfter = (Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\current-live-sha.txt') -Raw).Trim().ToLowerInvariant()
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    $relVer = Get-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\release-version.json') -Raw | ConvertFrom-Json

    Assert-True ($headAfter -eq $shaNew) "Sandbox Git HEAD must be $shaNew, got $headAfter"
    Assert-True ($liveShaAfter -eq $shaNew) "Sandbox current-live-sha.txt must be $shaNew, got $liveShaAfter"
    Assert-True ($latest.status -eq 'SUCCESS') "Expected SUCCESS status, got $($latest.status)"
    Assert-True ($relVer.sha -eq $shaNew) "release-version.json SHA must be $shaNew"

    # Verify zero api.env copied into pre-deploy backups
    $envFiles = @(Get-ChildItem -LiteralPath (Join-Path $sandboxRoot 'backups') -Filter '*.env' -Recurse -File)
    Assert-True ($envFiles.Count -eq 0) "Expected 0 .env files in sandbox backups, found $($envFiles.Count)"

    # Verify PostgreSQL backup was created for management_lite_integration_test
    $pgDumps = @(Get-ChildItem -LiteralPath (Join-Path $sandboxRoot 'backups\postgres') -Filter 'postgres-*.dump' -File)
    Assert-True ($pgDumps.Count -ge 1 -and $pgDumps[0].Length -gt 0) 'Pre-deploy PostgreSQL dump must exist and be non-empty'
  }

  # 7. Duplicate Deploy Detection
  Run-Scenario '7. Idempotency: Duplicate Deploy of Same SHA Skipped Without -Force' {
    & $deployScript -CommitSha $shaNew -OwnerApprovedSha $shaNew -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json
    Assert-True ($latest.status -eq 'SKIPPED') "Expected SKIPPED, got $($latest.status)"
  }

  # 8. SANDBOX ROLLBACK TEST (Simulated Health Check Failure -> Atomic Rollback of Git HEAD + dist + web/dist + pointer)
  Run-Scenario '8. SANDBOX_ROLLBACK_TEST: Post-Cutover Failure Triggers Complete Atomic Rollback' {
    # Reset sandbox baseline back to shaOld with verifiable sentinel markers
    git -c safe.directory=* -C $sandboxTarget checkout --quiet -f $shaOld
    Set-Content -LiteralPath (Join-Path $sandboxTarget 'dist\apps\api\src\main.js') -Value "// sentinel-main-$shaOld" -Encoding UTF8 -Force
    Set-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\index.html') -Value "<html>sentinel-web-$shaOld</html>" -Encoding UTF8 -Force
    @{ sha = $shaOld; environment = 'sandbox' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\release-version.json') -Encoding UTF8 -Force
    Set-Content -LiteralPath (Join-Path $sandboxRoot 'reports\current-live-sha.txt') -Value $shaOld -Encoding UTF8 -Force

    Start-Sleep -Seconds 1
    $rolledBack = $false
    try {
      & $deployScript -CommitSha $shaNew -OwnerApprovedSha $shaNew -ApprovalManifestPath $manifestPath -ServerRoot $sandboxRoot -TargetDir $sandboxTarget -DbTarget 'management_lite_integration_test' -SandboxMode -SkipBuildInSandbox -SimulateHealthFailure
    } catch {
      $rolledBack = $true
    }
    Assert-True $rolledBack 'Deploy with -SimulateHealthFailure must throw and roll back'

    $headAfterRollback = (git -c safe.directory=* -C $sandboxTarget rev-parse HEAD).Trim().ToLowerInvariant()
    $liveShaAfterRollback = (Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\current-live-sha.txt') -Raw).Trim().ToLowerInvariant()
    $mainJsAfterRollback = (Get-Content -LiteralPath (Join-Path $sandboxTarget 'dist\apps\api\src\main.js') -Raw).Trim()
    $indexHtmlAfterRollback = (Get-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\index.html') -Raw).Trim()
    $relVerAfterRollback = Get-Content -LiteralPath (Join-Path $sandboxTarget 'apps\web\dist\release-version.json') -Raw | ConvertFrom-Json
    $latest = Get-Content -LiteralPath (Join-Path $sandboxRoot 'reports\latest-deployment.json') -Raw | ConvertFrom-Json

    Assert-True ($headAfterRollback -eq $shaOld) "Git HEAD must roll back to $shaOld, got $headAfterRollback"
    Assert-True ($liveShaAfterRollback -eq $shaOld) "current-live-sha.txt must roll back to $shaOld, got $liveShaAfterRollback"
    Assert-True ($mainJsAfterRollback -eq "// sentinel-main-$shaOld") "dist/main.js must be restored from snapshot"
    Assert-True ($indexHtmlAfterRollback -eq "<html>sentinel-web-$shaOld</html>") "web/dist/index.html must be restored from snapshot"
    Assert-True ($relVerAfterRollback.sha -eq $shaOld) "release-version.json must roll back to $shaOld"
    Assert-True ($latest.status -eq 'ROLLED_BACK') "latest-deployment.json status must be ROLLED_BACK, got $($latest.status)"
    Assert-True ($latest.previous_sha -eq $shaOld) "latest-deployment.json previous_sha must be $shaOld"
  }

  # Verify Zero Production Impact
  $prodApiProcAfter = Get-CimInstance Win32_Service -Filter "Name='HPManagementLiteApi'"
  $prodHeadAfter = (git -c safe.directory=* -C $prodRepo rev-parse HEAD).Trim()
  $prodLiveShaAfter = (Get-Content -LiteralPath 'C:\HoaiPhuong-Server\reports\current-live-sha.txt' -Raw).Trim()

  Assert-True ($prodApiProcBefore.ProcessId -eq $prodApiProcAfter.ProcessId) "Production HPManagementLiteApi PID must remain unchanged ($($prodApiProcBefore.ProcessId) vs $($prodApiProcAfter.ProcessId))"
  Assert-True ($prodHeadBefore -eq $prodHeadAfter) "Production Git HEAD must remain unchanged ($prodHeadBefore)"
  Assert-True ($prodLiveShaBefore -eq $prodLiveShaAfter) "Production current-live-sha.txt must remain unchanged ($prodLiveShaBefore)"

  Write-Host "`n==================================================================" -ForegroundColor Green
  Write-Host "SANDBOX CI/CD SUITE RESULT: $passed / $passed SCENARIOS PASSED (0 FAIL)" -ForegroundColor Green
  Write-Host "Production HPManagementLiteApi PID Unchanged : $($prodApiProcAfter.ProcessId)" -ForegroundColor Green
  Write-Host "Production Git HEAD Unchanged                : $prodHeadAfter" -ForegroundColor Green
  Write-Host "==================================================================" -ForegroundColor Green

} finally {
  if (Test-Path -LiteralPath $sandboxRoot) {
    Remove-Item -LiteralPath $sandboxRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
