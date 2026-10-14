#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$CommitSha,
  [Parameter(Mandatory = $true)]
  [string]$OwnerApprovedSha,
  [string]$ApprovalManifestPath = 'C:\HoaiPhuong-Server\config\release-gate\approved-release.json',
  [switch]$Force,
  [switch]$SkipMigration = $true,
  [string]$ServerRoot = 'C:\HoaiPhuong-Server',
  [string]$TargetDir = 'C:\HoaiPhuong-Server\apps\management-lite',
  [string]$DbTarget = 'management_lite_test',
  [string]$HealthUrl = 'http://127.0.0.1:3002/api/v1/health',
  [string]$ReadyUrl = 'http://127.0.0.1:3002/api/v1/ready',
  [string]$WebUrl = 'http://127.0.0.1:3001/',
  [switch]$SandboxMode,
  [switch]$SkipBuildInSandbox,
  [switch]$SimulateHealthFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$normalizedSha = $CommitSha.Trim().ToLowerInvariant()
$normalizedApprovedSha = $OwnerApprovedSha.Trim().ToLowerInvariant()

$logsDir = Join-Path $ServerRoot 'logs'
$reportsDir = Join-Path $ServerRoot 'reports'
$backupsDir = Join-Path $ServerRoot 'backups'
foreach ($d in @($logsDir, $reportsDir, $backupsDir)) {
  if (-not (Test-Path -LiteralPath $d)) {
    New-Item -ItemType Directory -Path $d -Force | Out-Null
  }
}

$lockFile = Join-Path $logsDir 'deploy.lock'
$deployLog = Join-Path $logsDir 'deploy-history.log'
$runtimeLog = Join-Path $logsDir 'deploy-runtime.log'
$currentShaFile = Join-Path $reportsDir 'current-live-sha.txt'
$latestDeployJson = Join-Path $reportsDir 'latest-deployment.json'

$realServerRoot = 'C:\HoaiPhuong-Server'
$node = Join-Path $realServerRoot 'config\runtime\node-v22.14.0-win-x64\node.exe'
$psql = Join-Path $realServerRoot 'config\postgresql-18\pgsql\bin\psql.exe'
$pgPassFile = Join-Path $realServerRoot 'config\test-secrets\pgpass.conf'
$backupScript = Join-Path $realServerRoot 'scripts\Backup-Postgres.ps1'
$startTime = Get-Date

function Write-DeployLog {
  param([string]$Message, [string]$Level = 'INFO')
  $timeStr = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $formatted = "[$timeStr][$Level] $Message"
  Write-Host $formatted
  Add-Content -LiteralPath $runtimeLog -Value $formatted -ErrorAction SilentlyContinue
}

function Record-DeployResult {
  param([string]$Status, [string]$Sha, [string]$Message, [int]$DurationMs, [string]$PreviousSha = '')
  $record = [ordered]@{
    timestamp    = (Get-Date -Format o)
    sha          = $Sha
    previous_sha = $PreviousSha
    status       = $Status
    sandbox      = [bool]$SandboxMode
    message      = $Message
    duration_ms  = $DurationMs
  }
  $json = $record | ConvertTo-Json -Compress
  Add-Content -LiteralPath $deployLog -Value $json -ErrorAction SilentlyContinue
  $record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $latestDeployJson -Encoding UTF8 -Force
}

function Test-ApplicationSmoke {
  param([string]$ExpectedSha, [int]$MaxAttempts = 10)
  if ($SimulateHealthFailure) {
    if (-not $SandboxMode) {
      throw 'SimulateHealthFailure is only allowed in -SandboxMode.'
    }
    Write-DeployLog 'SANDBOX: Simulating post-deploy health check failure...' 'WARN'
    return $false
  }

  $versionFile = Join-Path $TargetDir 'apps\web\dist\release-version.json'
  if (-not (Test-Path -LiteralPath $versionFile)) {
    Write-DeployLog "Missing release-version.json at $versionFile" 'WARN'
    return $false
  }
  $versionJson = Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json
  if ($versionJson.sha -ne $ExpectedSha) {
    Write-DeployLog "release-version.json SHA mismatch: expected $ExpectedSha, got $($versionJson.sha)" 'WARN'
    return $false
  }

  for ($i = 1; $i -le $MaxAttempts; $i++) {
    try {
      $h = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 3
      $rdy = Invoke-RestMethod -Uri $ReadyUrl -TimeoutSec 3
      $w = (Invoke-WebRequest -Uri $WebUrl -UseBasicParsing -TimeoutSec 3).StatusCode
      if ($h.data.status -eq 'pass' -and $rdy.data.status -eq 'ready' -and $w -eq 200) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $false
}

Write-DeployLog "=== MANAGEMENT LITE: SEMI-AUTO DEPLOY (OWNER SHA GATE) ==="
Write-DeployLog "Target Commit SHA : $normalizedSha (SandboxMode=$SandboxMode)"

# 1. OWNER SHA APPROVAL GATE (FAIL-CLOSED BEFORE LOCK OR MUTATION)
if ($normalizedSha -notmatch '^[0-9a-f]{40}$') {
  Record-DeployResult -Status 'REJECTED_INVALID_SHA' -Sha $normalizedSha -Message 'CommitSha must be a full 40-character hexadecimal Git SHA' -DurationMs 0
  throw "GATE REJECTED: CommitSha '$CommitSha' must be a full 40-character hexadecimal Git SHA."
}

if ($normalizedSha -ne $normalizedApprovedSha) {
  Record-DeployResult -Status 'REJECTED_SHA_MISMATCH' -Sha $normalizedSha -Message 'OwnerApprovedSha does not match CommitSha' -DurationMs 0
  throw "GATE REJECTED: OwnerApprovedSha '$OwnerApprovedSha' does not match CommitSha '$CommitSha'."
}

if (-not (Test-Path -LiteralPath $ApprovalManifestPath)) {
  Record-DeployResult -Status 'REJECTED_NO_MANIFEST' -Sha $normalizedSha -Message "Missing Owner approval manifest at $ApprovalManifestPath" -DurationMs 0
  throw "GATE REJECTED: Owner approval manifest not found at '$ApprovalManifestPath'."
}

$manifest = Get-Content -LiteralPath $ApprovalManifestPath -Raw | ConvertFrom-Json
if ($manifest.status -ne 'APPROVED' -or $manifest.approved_sha.Trim().ToLowerInvariant() -ne $normalizedSha) {
  Record-DeployResult -Status 'REJECTED_UNAPPROVED_SHA' -Sha $normalizedSha -Message "Manifest SHA ($($manifest.approved_sha)) or status ($($manifest.status)) does not match $normalizedSha" -DurationMs 0
  throw "GATE REJECTED: Manifest does not approve SHA '$normalizedSha' (manifest approved_sha='$($manifest.approved_sha)', status='$($manifest.status)')."
}

$expiresUtc = [DateTimeOffset]::Parse($manifest.expires_at_utc).UtcDateTime
if ((Get-Date).ToUniversalTime() -gt $expiresUtc) {
  Record-DeployResult -Status 'REJECTED_EXPIRED_APPROVAL' -Sha $normalizedSha -Message "Owner approval manifest expired at $($manifest.expires_at_utc)" -DurationMs 0
  throw "GATE REJECTED: Owner approval manifest expired at $($manifest.expires_at_utc)."
}

if ((-not $SkipMigration) -and (-not [bool]$manifest.allow_migration)) {
  Record-DeployResult -Status 'REJECTED_UNAPPROVED_MIGRATION' -Sha $normalizedSha -Message 'Migration requested but allow_migration is false in Owner approval manifest' -DurationMs 0
  throw "GATE REJECTED: Migration execution requested (-SkipMigration:`$false), but Owner manifest has allow_migration=false."
}

Write-DeployLog "Owner SHA Approval Gate PASSED (ApprovedBy=$($manifest.approved_by), Expires=$($manifest.expires_at_utc))."

# 2. CONCURRENCY MUTEX LOCK
if (Test-Path -LiteralPath $lockFile) {
  try {
    $lockData = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
    $lockPid = [int]$lockData.pid
    $proc = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
    if ($proc) {
      throw "Concurrent deployment in progress (PID: $lockPid, SHA: $($lockData.sha)). Aborting."
    } else {
      Write-DeployLog "Stale lock file found for dead PID $lockPid. Removing..." 'WARN'
      Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
    }
  } catch [System.Management.Automation.RuntimeException] {
    throw $_
  } catch {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  }
}

$lockPayload = @{ pid = $PID; started_at = (Get-Date -Format o); sha = $normalizedSha } | ConvertTo-Json
Set-Content -LiteralPath $lockFile -Value $lockPayload -Encoding UTF8 -Force

$snapshotDir = $null
$previousGitSha = ''
$previousLiveSha = ''

try {
  $previousGitSha = (git -c safe.directory=* -C $TargetDir rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
  if (Test-Path -LiteralPath $currentShaFile) {
    $previousLiveSha = (Get-Content -LiteralPath $currentShaFile -Raw).Trim().ToLowerInvariant()
  } else {
    $previousLiveSha = $previousGitSha
  }

  # 3. DUPLICATE DEPLOY DETECTION (Normalized 40-char or prefix comparison)
  if (-not $Force -and $previousGitSha -eq $normalizedSha -and ($previousLiveSha -eq $normalizedSha -or $normalizedSha.StartsWith($previousLiveSha))) {
    Write-DeployLog "Commit SHA $normalizedSha is already live ($previousGitSha). Skipping (use -Force to re-deploy)." 'INFO'
    $duration = [int]((Get-Date) - $startTime).TotalMilliseconds
    Record-DeployResult -Status 'SKIPPED' -Sha $normalizedSha -PreviousSha $previousGitSha -Message 'Already live on server' -DurationMs $duration
    return
  }

  # 4. PRE-DEPLOY SNAPSHOT (ZERO SECRET COPYING) & DB BACKUP
  $ts = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $snapshotDir = Join-Path $backupsDir "pre-deploy-$ts"
  Write-DeployLog "Creating recovery snapshot at: $snapshotDir (Zero plaintext secrets copied)..."
  New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null

  @{
    previous_git_sha  = $previousGitSha
    previous_live_sha = $previousLiveSha
    target_sha        = $normalizedSha
    created_at_utc    = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $snapshotDir 'rollback-metadata.json') -Encoding UTF8 -Force

  if (Test-Path -LiteralPath (Join-Path $TargetDir 'dist')) {
    Copy-Item -LiteralPath (Join-Path $TargetDir 'dist') -Destination (Join-Path $snapshotDir 'dist') -Recurse -Force
  }
  if (Test-Path -LiteralPath (Join-Path $TargetDir 'apps\web\dist')) {
    New-Item -ItemType Directory -Path (Join-Path $snapshotDir 'web') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $TargetDir 'apps\web\dist') -Destination (Join-Path $snapshotDir 'web\dist') -Recurse -Force
  }

  Write-DeployLog "Running pre-deploy PostgreSQL backup for database '$DbTarget'..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File $backupScript -PgBin "$realServerRoot\config\postgresql-18\pgsql\bin" -Database $DbTarget -User hp_test_admin -PasswordFile $pgPassFile -Port 55432 -BackupDir (Join-Path $ServerRoot 'backups\postgres')
  if ($LASTEXITCODE -ne 0) {
    throw "Pre-deploy PostgreSQL backup failed for $DbTarget."
  }

  # 5. GIT FETCH & EXACT SHA CHECKOUT
  Write-DeployLog "Checking out exact Git commit SHA: $normalizedSha..."
  $env:GIT_TERMINAL_PROMPT = '0'
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    git -c safe.directory=* -C $TargetDir cat-file -e "$normalizedSha^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-DeployLog "Commit $normalizedSha not found locally; fetching from origin..."
      git -c safe.directory=* -C $TargetDir fetch --quiet origin --all --tags --prune 2>$null
      git -c safe.directory=* -C $TargetDir fetch --quiet origin $normalizedSha 2>$null
    }

    git -c safe.directory=* -C $TargetDir checkout --quiet -f $normalizedSha 2>$null
    $checkoutExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
  if ($checkoutExit -ne 0) {
    throw "Failed to checkout Git commit $normalizedSha"
  }

  $checkedOutSha = (git -c safe.directory=* -C $TargetDir rev-parse HEAD).Trim().ToLowerInvariant()
  if ($checkedOutSha -ne $normalizedSha) {
    throw "Git HEAD ($checkedOutSha) does not match target SHA ($normalizedSha) after checkout."
  }

  # 6. BUILD API & WEB + WRITE RELEASE-VERSION.JSON
  $env:PATH = "$realServerRoot\config\runtime\node-v22.14.0-win-x64;$env:PATH"
  if (-not ($SandboxMode -and $SkipBuildInSandbox)) {
    Write-DeployLog "Building Backend API..."
    cmd /c "cd /d `"$TargetDir`" && npm run build"
    if ($LASTEXITCODE -ne 0) {
      throw "Backend API build failed (npm run build)"
    }

    Write-DeployLog "Building Frontend Web..."
    cmd /c "cd /d `"$TargetDir`" && npm run build:web"
    if ($LASTEXITCODE -ne 0) {
      throw "Frontend Web build failed (npm run build:web)"
    }
  } else {
    Write-DeployLog "SANDBOX: Using pre-built artifacts in sandbox target directory."
  }

  $webDistDir = Join-Path $TargetDir 'apps\web\dist'
  if (-not (Test-Path -LiteralPath $webDistDir)) {
    New-Item -ItemType Directory -Path $webDistDir -Force | Out-Null
  }
  @{
    sha         = $normalizedSha
    deployed_at = (Get-Date).ToUniversalTime().ToString('o')
    environment = $(if ($SandboxMode) { 'sandbox' } else { 'production' })
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $webDistDir 'release-version.json') -Encoding UTF8 -Force

  # 7. CONTROLLED DATABASE MIGRATION (ONLY WHEN EXPLICITLY APPROVED)
  if (-not $SkipMigration) {
    Write-DeployLog "Executing approved database migrations on '$DbTarget'..."
    $pass = ([IO.File]::ReadAllText($pgPassFile).Trim() -split ':')[-1]
    $env:DATABASE_URL = "postgresql://hp_test_admin:${pass}@127.0.0.1:55432/$DbTarget"
    try {
      & $node "$TargetDir\scripts\migrate.mjs"
      if ($LASTEXITCODE -ne 0) {
        throw "Database migration script failed on $DbTarget"
      }
    } finally {
      Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }

    $env:PGPASSFILE = $pgPassFile
    $grantSql = @"
GRANT CONNECT ON DATABASE $DbTarget TO hp_app_test;
GRANT USAGE ON SCHEMA public TO hp_app_test;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO hp_app_test;
REVOKE UPDATE,DELETE ON audit_events FROM hp_app_test;
REVOKE ALL ON schema_migrations FROM hp_app_test;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO hp_app_test;
"@
    $grantSql | & $psql -h 127.0.0.1 -p 55432 -U hp_test_admin -d $DbTarget -v ON_ERROR_STOP=1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "PostgreSQL privilege enforcement failed on $DbTarget"
    }
  } else {
    Write-DeployLog "Database migration skipped (-SkipMigration=true)."
  }

  # 8. SERVICE CUTOVER (PRODUCTION ONLY)
  if (-not $SandboxMode) {
    Write-DeployLog "Restarting Windows service HPManagementLiteApi..."
    Restart-Service HPManagementLiteApi -Force
    Start-Sleep -Seconds 3
  } else {
    Write-DeployLog "SANDBOX: Skipping production Windows service restart (Zero production impact)."
  }

  # 9. READ-ONLY POST-DEPLOY SMOKE VERIFICATION
  Write-DeployLog "Running read-only post-deploy smoke checks..."
  if (-not (Test-ApplicationSmoke -ExpectedSha $normalizedSha -MaxAttempts 10)) {
    throw "Post-deploy smoke verification failed (health/ready/web/version check)."
  }

  # 10. COMMIT LIVE STATE POINTER
  Set-Content -LiteralPath $currentShaFile -Value $normalizedSha -Encoding UTF8 -Force
  $duration = [int]((Get-Date) - $startTime).TotalMilliseconds
  Record-DeployResult -Status 'SUCCESS' -Sha $normalizedSha -PreviousSha $previousGitSha -Message 'Deployment completed and verified' -DurationMs $duration
  Write-DeployLog "=== DEPLOY SUCCESSFUL: $normalizedSha (${duration}ms) ===" 'SUCCESS'

} catch {
  $errMsg = $_.Exception.Message
  Write-DeployLog "DEPLOY FAILED: $errMsg. INITIATING ATOMIC ROLLBACK..." 'ERROR'

  if ($snapshotDir -and (Test-Path -LiteralPath $snapshotDir)) {
    try {
      if ($previousGitSha -match '^[0-9a-f]{40}$') {
        Write-DeployLog "Restoring Git working tree to previous SHA: $previousGitSha..."
        $prevEapRb = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          git -c safe.directory=* -C $TargetDir checkout --quiet -f $previousGitSha 2>$null
        } finally {
          $ErrorActionPreference = $prevEapRb
        }
      }
      if (Test-Path -LiteralPath (Join-Path $snapshotDir 'dist')) {
        Write-DeployLog "Restoring Backend dist from snapshot..."
        if (Test-Path -LiteralPath (Join-Path $TargetDir 'dist')) {
          Remove-Item -LiteralPath (Join-Path $TargetDir 'dist') -Recurse -Force
        }
        Copy-Item -LiteralPath (Join-Path $snapshotDir 'dist') -Destination (Join-Path $TargetDir 'dist') -Recurse -Force
      }
      if (Test-Path -LiteralPath (Join-Path $snapshotDir 'web\dist')) {
        Write-DeployLog "Restoring Frontend web/dist from snapshot..."
        if (Test-Path -LiteralPath (Join-Path $TargetDir 'apps\web\dist')) {
          Remove-Item -LiteralPath (Join-Path $TargetDir 'apps\web\dist') -Recurse -Force
        }
        Copy-Item -LiteralPath (Join-Path $snapshotDir 'web\dist') -Destination (Join-Path $TargetDir 'apps\web\dist') -Recurse -Force
      }
      if (-not [string]::IsNullOrWhiteSpace($previousLiveSha)) {
        Set-Content -LiteralPath $currentShaFile -Value $previousLiveSha -Encoding UTF8 -Force
      }

      if (-not $SandboxMode) {
        Restart-Service HPManagementLiteApi -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
      }
      Write-DeployLog "Atomic rollback completed (Git HEAD + dist + web/dist + current-live-sha restored to $previousGitSha)." 'WARN'
    } catch {
      Write-DeployLog "CRITICAL: Rollback encountered an error: $($_.Exception.Message)" 'ERROR'
    }
  }

  $duration = [int]((Get-Date) - $startTime).TotalMilliseconds
  Record-DeployResult -Status 'ROLLED_BACK' -Sha $normalizedSha -PreviousSha $previousGitSha -Message $errMsg -DurationMs $duration
  throw "Deployment failed and rolled back to ${previousGitSha}: $errMsg"
} finally {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
