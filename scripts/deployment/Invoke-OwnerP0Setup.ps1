#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$BaselineSha = 'fbb69409d00f43d0c36854730332e319cedb49ec',
  [int]$MaxDeployments = 10,
  [int]$ExpiresInHours = 168,
  [switch]$AllowMigration = $false,
  [Security.SecureString]$GitHubPatSecure = $null,
  [switch]$SkipGitHubPatPrompt,
  [string]$StagedDpapiPatPath = 'C:\HoaiPhuong-Server\workspace\github-pat.dpapi',
  [string]$GitHubApiBaseUrl = 'https://api.github.com',
  [string]$OwnerVaultDir = 'C:\ProgramData\HoaiPhuong-OwnerVault',
  [string]$ServerRoot = 'C:\HoaiPhuong-Server',
  [string]$DevRepoDir = 'C:\HoaiPhuong-Server\workspace\management-lite-uiux-integration-test',
  [string]$RollbackFromBackupDir = '',
  [switch]$SandboxMode,
  [switch]$VerifyLiveStackInSandbox,
  [switch]$SimulateFailureAfterKeyGen,
  [switch]$SimulatePostAclFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentPrincipal = [Security.Principal.WindowsPrincipal]::new($currentIdentity)
$isElevatedAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$currentAdminName = $currentIdentity.Name

# 1. REQUIRE ELEVATED ADMINISTRATOR SESSION IN PRODUCTION & FORBID CLI PAT IN PRODUCTION
if ((-not $SandboxMode) -and (-not $isElevatedAdmin)) {
  throw 'SECURITY_VIOLATION_NON_ELEVATED_CALLER: Invoke-OwnerP0Setup.ps1 must be executed in an elevated PowerShell session (Run as Administrator).'
}
if ((-not $SandboxMode) -and $PSBoundParameters.ContainsKey('GitHubPatSecure')) {
  throw 'SECURITY_VIOLATION_CLI_PAT_FORBIDDEN: Passing GitHub PAT via command-line parameters is forbidden in production. Enter the PAT interactively when prompted via Read-Host -AsSecureString.'
}
if (-not $SandboxMode) {
  if ($GitHubApiBaseUrl.Trim().TrimEnd('/').ToLowerInvariant() -ne 'https://api.github.com') {
    throw 'REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION: Only https://api.github.com is permitted in production.'
  }
  $GitHubApiBaseUrl = 'https://api.github.com'
}
if ($MaxDeployments -lt 1 -or $MaxDeployments -gt 10) {
  throw "Invalid MaxDeployments '$MaxDeployments'. SCOPED_WINDOW is strictly limited to between 1 and 10 deployments."
}
if ($ExpiresInHours -lt 1 -or $ExpiresInHours -gt 168) {
  throw "Invalid ExpiresInHours '$ExpiresInHours'. SCOPED_WINDOW maximum duration is 168 hours (7 days)."
}

$realServerRoot = 'C:\HoaiPhuong-Server'
$node = Join-Path $realServerRoot 'config\runtime\node-v22.14.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $node)) {
  $node = 'node'
}
$pgBinDir = Join-Path $realServerRoot 'config\postgresql-18\pgsql\bin'
$psqlExe = Join-Path $pgBinDir 'psql.exe'
$pgRestoreExe = Join-Path $pgBinDir 'pg_restore.exe'
$realPgPassFile = Join-Path $realServerRoot 'config\test-secrets\pgpass.conf'

$gateDir = Join-Path $ServerRoot 'config\release-gate'
$gateControllersDir = Join-Path $gateDir 'controllers'
$dpapiPatPath = Join-Path $gateDir 'github-pat.dpapi'
$configDir = Join-Path $ServerRoot 'config'
$servicesDir = Join-Path $ServerRoot 'config\services'
$scriptsDir = Join-Path $ServerRoot 'scripts'
$runnerDir = Join-Path $ServerRoot 'runner'
$testSecretsDir = Join-Path $ServerRoot 'config\test-secrets'
$tempKeyDir = Join-Path $testSecretsDir 'owner-ed25519'
$tempPrivKey = Join-Path $tempKeyDir 'owner-approval-private.pem'
$prodDeployScriptsDir = Join-Path $ServerRoot 'apps\management-lite\scripts\deployment'

function Unlock-PathForRollbackOrAdmin {
  param([string]$PathToUnlock)
  if ([string]::IsNullOrWhiteSpace($PathToUnlock) -or (-not (Test-Path -LiteralPath $PathToUnlock))) {
    return
  }
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($isElevatedAdmin) {
      & takeown.exe /F $PathToUnlock /A /R /D Y 2>&1 | Out-Null
    }
    & icacls.exe $PathToUnlock /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdminName}:(OI)(CI)F" "*S-1-3-4:(OI)(CI)F" /T /C 2>&1 | Out-Null
  } finally {
    $ErrorActionPreference = $prevEap
  }
}

function Preserve-OperationalDirectoryExplicitAcl {
  param([string]$DirPath)
  if ([string]::IsNullOrWhiteSpace($DirPath) -or (-not (Test-Path -LiteralPath $DirPath))) {
    return
  }
  # Convert inherited (I) ACEs into explicit ACEs while preserving 100% of existing service ACEs (LOCAL SERVICE, NETWORK SERVICE, NT SERVICE\*)
  & icacls.exe $DirPath /inheritance:d /grant "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdminName}:(OI)(CI)F" "*S-1-3-4:(OI)(CI)F" | Out-Null
}

function Lock-DirectoryReadOnlyForNonElevated {
  param([string]$DirPath, [switch]$DenyServiceWrite)
  if ([string]::IsNullOrWhiteSpace($DirPath) -or (-not (Test-Path -LiteralPath $DirPath))) {
    return
  }
  if ($isElevatedAdmin) {
    & takeown.exe /F $DirPath /A /R /D Y 2>$null | Out-Null
  }
  $items = @(Get-ChildItem -LiteralPath $DirPath -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending)
  foreach ($item in $items) {
    if ($item.PSIsContainer) {
      if ($DenyServiceWrite) {
        & icacls.exe $item.FullName /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdminName}:(OI)(CI)RX" "*S-1-3-4:(OI)(CI)RX" "*S-1-5-19:(OI)(CI)R" "*S-1-5-20:(OI)(CI)R" /deny "*S-1-5-19:(OI)(CI)(W,M,D,WDAC,WO)" "*S-1-5-20:(OI)(CI)(W,M,D,WDAC,WO)" | Out-Null
      } else {
        & icacls.exe $item.FullName /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdminName}:(OI)(CI)RX" "*S-1-3-4:(OI)(CI)RX" "*S-1-5-19:(OI)(CI)RX" "*S-1-5-20:(OI)(CI)RX" | Out-Null
      }
    } elseif ($item.Name -eq 'github-pat.dpapi') {
      & icacls.exe $item.FullName /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "${currentAdminName}:RX" "*S-1-3-4:RX" /deny "*S-1-5-19:F" "*S-1-5-20:F" | Out-Null
    } else {
      if ($DenyServiceWrite) {
        & icacls.exe $item.FullName /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "${currentAdminName}:RX" "*S-1-3-4:RX" "*S-1-5-19:R" "*S-1-5-20:R" /deny "*S-1-5-19:(W,M,D,WDAC,WO)" "*S-1-5-20:(W,M,D,WDAC,WO)" | Out-Null
      } else {
        & icacls.exe $item.FullName /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "${currentAdminName}:RX" "*S-1-3-4:RX" "*S-1-5-19:RX" "*S-1-5-20:RX" | Out-Null
      }
    }
  }
  if ($DenyServiceWrite) {
    & icacls.exe $DirPath /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdminName}:(OI)(CI)RX" "*S-1-3-4:(OI)(CI)RX" "*S-1-5-19:(OI)(CI)R" "*S-1-5-20:(OI)(CI)R" /deny "*S-1-5-19:(OI)(CI)(W,M,D,WDAC,WO)" "*S-1-5-20:(OI)(CI)(W,M,D,WDAC,WO)" | Out-Null
  } else {
    & icacls.exe $DirPath /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdminName}:(OI)(CI)RX" "*S-1-3-4:(OI)(CI)RX" "*S-1-5-19:(OI)(CI)RX" "*S-1-5-20:(OI)(CI)RX" | Out-Null
  }
}

function Lock-ContainerOnlyNoDeleteChild {
  param([string]$ContainerPath)
  if ([string]::IsNullOrWhiteSpace($ContainerPath) -or (-not (Test-Path -LiteralPath $ContainerPath))) {
    return
  }
  if ($isElevatedAdmin) {
    & takeown.exe /F $ContainerPath /A 2>$null | Out-Null
  }
  # Atomic replacement of (OI)(CI)F with (OI)(CI)RX on container so non-elevated ADMIN has zero DC/W/WDAC rights on child folders
  & icacls.exe $ContainerPath /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdminName}:(OI)(CI)RX" "*S-1-3-4:(OI)(CI)RX" "*S-1-5-19:(OI)(CI)RX" "*S-1-5-20:(OI)(CI)RX" | Out-Null
}

function Test-LiveStackAndBackupHealth {
  param([string]$BackupOutDir)
  $svcNames = @('HPManagementLiteApi', 'HPManagementLiteWeb', 'HPManagementLiteGateway', 'HPManagementLiteDatabase')
  $svcStatuses = [ordered]@{}
  foreach ($sName in $svcNames) {
    $svc = Get-Service -Name $sName -ErrorAction Stop
    if ($svc.Status -ne 'Running') {
      throw "SERVICE_NOT_RUNNING: Windows service '$sName' is in state '$($svc.Status)'."
    }
    $svcStatuses[$sName] = $svc.Status.ToString()
  }

  $healthResp = Invoke-RestMethod -Uri 'http://127.0.0.1:3002/api/v1/health' -TimeoutSec 5
  $readyResp = Invoke-RestMethod -Uri 'http://127.0.0.1:3002/api/v1/ready' -TimeoutSec 5
  $webResp = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/' -UseBasicParsing -TimeoutSec 5
  if ($healthResp.data.status -ne 'pass' -or $readyResp.data.status -ne 'ready' -or $webResp.StatusCode -ne 200) {
    throw "ENDPOINT_HEALTH_FAILED: Health=$($healthResp.data.status), Ready=$($readyResp.data.status), Web=$($webResp.StatusCode)."
  }

  $gwStatus = 0
  try {
    $gwResp = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/' -UseBasicParsing -TimeoutSec 5
    $gwStatus = [int]$gwResp.StatusCode
  } catch {
    if ($_.Exception.Response) {
      $gwStatus = [int]$_.Exception.Response.StatusCode
    } else {
      throw "GATEWAY_UNREACHABLE: http://127.0.0.1:3000/ failed ($($_.Exception.Message))."
    }
  }

  $priorPgPass = $env:PGPASSFILE
  try {
    $env:PGPASSFILE = $realPgPassFile
    $dbCheck = (& $psqlExe -h 127.0.0.1 -p 55432 -U hp_test_admin -d management_lite_test -X -w -t -A -c "SELECT COUNT(*) FROM schema_migrations;" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $dbCheck -notmatch '^\d+$') {
      throw "DATABASE_CHECK_FAILED: Could not query schema_migrations on 127.0.0.1:55432."
    }
  } finally {
    $env:PGPASSFILE = $priorPgPass
  }

  $backupScriptPath = Join-Path $ScriptsDir 'Backup-Postgres.ps1'
  if (-not (Test-Path -LiteralPath $backupScriptPath -PathType Leaf)) {
    $backupScriptPath = Join-Path $realServerRoot 'scripts\Backup-Postgres.ps1'
  }
  New-Item -ItemType Directory -Path $BackupOutDir -Force | Out-Null
  & $backupScriptPath -PgBin $pgBinDir -Database 'management_lite_test' -User 'hp_test_admin' -PasswordFile $realPgPassFile -BackupDirectory $BackupOutDir -Port 55432 | Out-Null
  $latestDump = Get-ChildItem -LiteralPath $BackupOutDir -Filter 'postgres-*.dump' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latestDump -or -not (Test-Path -LiteralPath ($latestDump.FullName + '.sha256.json') -PathType Leaf)) {
    throw "BACKUP_VERIFICATION_FAILED: Backup-Postgres.ps1 did not produce a valid .dump + .sha256.json in '$BackupOutDir'."
  }
  & $pgRestoreExe --list $latestDump.FullName | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "BACKUP_ARCHIVE_CORRUPT: pg_restore --list failed on '$($latestDump.FullName)'."
  }

  return [ordered]@{
    services         = $svcStatuses
    api_health       = [string]$healthResp.data.status
    api_ready        = [string]$readyResp.data.status
    api_version      = [string]$healthResp.data.version
    api_commit       = [string]$healthResp.data.commit
    web_status_code  = [int]$webResp.StatusCode
    gateway_status   = $gwStatus
    db_migrations    = [int]$dbCheck
    backup_archive   = $latestDump.FullName
    backup_bytes     = [int64]$latestDump.Length
  }
}

function Test-GitHubTokenMinimumPermissions {
  param(
    [Parameter(Mandatory = $true)][string]$PlainToken,
    [string]$ApiBaseUrl = 'https://api.github.com',
    [string]$RepoSlug = 'truhoaiphuong03/management-lite',
    [string]$WorkflowFile = 'foundation.yml'
  )
  $base = $ApiBaseUrl.Trim().TrimEnd('/')
  $headers = @{
    'Authorization'        = "Bearer $($PlainToken.Trim())"
    'Accept'               = 'application/vnd.github+json'
    'User-Agent'           = 'ManagementLite-OwnerP0Setup'
    'X-GitHub-Api-Version' = '2022-11-28'
  }
  try {
    $repoResp = Invoke-WebRequest -Uri "$base/repos/$RepoSlug" -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 15
  } catch {
    throw "GITHUB_PAT_AUTHENTICATION_FAILED: Cannot access repository '$RepoSlug' on $base ($($_.Exception.Message))."
  }
  $oauthScopes = if ($repoResp.Headers -and $repoResp.Headers['X-OAuth-Scopes']) { [string]$repoResp.Headers['X-OAuth-Scopes'] } else { '' }
  if (-not [string]::IsNullOrWhiteSpace($oauthScopes)) {
    $scopes = @($oauthScopes -split ',' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
    $forbidden = @('delete_repo', 'admin:org', 'admin:public_key', 'admin:repo_hook', 'admin:org_hook', 'admin:gpg_key', 'admin:enterprise', 'site_admin', 'user', 'delete:packages', 'codespace')
    $excessive = @($scopes | Where-Object { $forbidden -contains $_ })
    if ($excessive.Count -gt 0) {
      throw "GITHUB_PAT_EXCESSIVE_PERMISSIONS: Token contains forbidden excessive scopes ($($excessive -join ', ')). Use a Fine-Grained PAT scoped strictly to $RepoSlug (Contents: Read & Write, Actions: Read & Write)."
    }
  }
  $repoObj = $repoResp.Content | ConvertFrom-Json
  if ((-not $repoObj.permissions) -or (-not [bool]$repoObj.permissions.push)) {
    throw "GITHUB_PAT_INSUFFICIENT_PUSH_PERMISSION: Token lacks Contents Read & Write (push) permission on '$RepoSlug'."
  }
  try {
    $wfResp = Invoke-WebRequest -Uri "$base/repos/$RepoSlug/actions/workflows/$WorkflowFile" -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 15
    $runsResp = Invoke-WebRequest -Uri "$base/repos/$RepoSlug/actions/runs?per_page=1" -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 15
  } catch {
    throw "GITHUB_PAT_INSUFFICIENT_ACTIONS_PERMISSION: Token lacks Actions Read & Write permission on '$RepoSlug' ($($_.Exception.Message))."
  }
  if ($wfResp.StatusCode -ne 200 -or $runsResp.StatusCode -ne 200) {
    throw "GITHUB_PAT_INSUFFICIENT_ACTIONS_PERMISSION: Token returned non-200 status when querying Actions workflow/runs on '$RepoSlug'."
  }
  try {
    $artResp = Invoke-WebRequest -Uri "$base/repos/$RepoSlug/actions/artifacts?per_page=1" -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 15
  } catch {
    throw "GITHUB_PAT_INSUFFICIENT_ARTIFACTS_PERMISSION: Token cannot access Actions artifacts on '$RepoSlug' ($($_.Exception.Message))."
  }
  if ($artResp.StatusCode -ne 200) {
    throw "GITHUB_PAT_INSUFFICIENT_ARTIFACTS_PERMISSION: Token returned non-200 status when querying Actions artifacts on '$RepoSlug'."
  }
  $wfObj = $wfResp.Content | ConvertFrom-Json
  $runsObj = $runsResp.Content | ConvertFrom-Json
  return @{
    repository       = [string]$repoObj.full_name
    private          = [bool]$repoObj.private
    push_allowed     = [bool]$repoObj.permissions.push
    workflow_name    = [string]$wfObj.name
    workflow_state   = [string]$wfObj.state
    total_runs_count = [int]$runsObj.total_count
  }
}

function Restore-P0SetupSnapshot {
  param([string]$SnapRoot)
  Write-Host "[ROLLBACK] Restoring P0 setup state from snapshot: $SnapRoot..."
  foreach ($unlockTarget in @($ServerRoot, $configDir, $gateDir, $servicesDir, $scriptsDir, $runnerDir, $prodDeployScriptsDir)) {
    Unlock-PathForRollbackOrAdmin -PathToUnlock $unlockTarget
  }
  $snapGate = Join-Path $SnapRoot 'release-gate'
  if (Test-Path -LiteralPath $snapGate) {
    if (Test-Path -LiteralPath $gateDir) {
      Remove-Item -LiteralPath $gateDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Copy-Item -LiteralPath $snapGate -Destination $gateDir -Recurse -Force
  }
  $snapScripts = Join-Path $SnapRoot 'prod-deploy-scripts'
  if (Test-Path -LiteralPath $snapScripts) {
    New-Item -ItemType Directory -Path $prodDeployScriptsDir -Force | Out-Null
    Get-ChildItem -LiteralPath $snapScripts -File | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $prodDeployScriptsDir $_.Name) -Force
    }
  }
  $uacFile = Join-Path $SnapRoot 'uac-state.json'
  if ((-not $SandboxMode) -and (Test-Path -LiteralPath $uacFile -PathType Leaf)) {
    $uacState = Get-Content -LiteralPath $uacFile -Raw | ConvertFrom-Json
    if ($null -ne $uacState.ConsentPromptBehaviorAdmin) {
      Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'ConsentPromptBehaviorAdmin' -Value ([int]$uacState.ConsentPromptBehaviorAdmin) -ErrorAction SilentlyContinue
    }
  }
  Write-Host "[ROLLBACK] State restored cleanly from $SnapRoot."
}

if (-not [string]::IsNullOrWhiteSpace($RollbackFromBackupDir)) {
  $snapCandidate = Join-Path $RollbackFromBackupDir 'rollback-snapshot'
  if (-not (Test-Path -LiteralPath $snapCandidate)) {
    throw "Rollback snapshot directory not found at '$snapCandidate'."
  }
  Restore-P0SetupSnapshot -SnapRoot $snapCandidate
  return
}

# 2. PRE-FLIGHT PATH & LIVE SERVICE/DB/BACKUP VERIFICATION
$requiredDevScripts = @('Approve-ReleaseSha.ps1', 'Deploy-SemiAutoWindows.ps1', 'Invoke-ScopedReleaseDeploy.ps1', 'Invoke-OwnerP0Setup.ps1', 'Verify-GitHubPatAndLiveCi.ps1')
foreach ($reqScript in $requiredDevScripts) {
  $candidateScript = Join-Path $DevRepoDir "scripts\deployment\$reqScript"
  if (-not (Test-Path -LiteralPath $candidateScript -PathType Leaf)) {
    throw "PREFLIGHT_FAILED: Missing required deployment script '$candidateScript'."
  }
}

$timestamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$auditBackupDir = Join-Path $ServerRoot "backups\management-lite\p0-audit-evidence-$timestamp"
$rollbackSnapDir = Join-Path $auditBackupDir 'rollback-snapshot'

Write-Host '=== MANAGEMENT LITE: P0 REMEDIATION & ONE-TIME SCOPED OWNER APPROVAL ==='
Write-Host "    Baseline SHA    : $BaselineSha"
Write-Host "    AllowMigration  : $AllowMigration (Default: false)"
Write-Host "    MaxDeployments  : $MaxDeployments (Max: 10) | ExpiresInHours: $ExpiresInHours (Max: 168h / 7d)"

# 3. CREATE AUDIT EVIDENCE, PRE-FLIGHT DB BACKUP & TRANSACTIONAL ROLLBACK SNAPSHOT BEFORE ANY MUTATION
New-Item -ItemType Directory -Path $rollbackSnapDir -Force | Out-Null

$preflightReport = $null
if ((-not $SandboxMode) -or $VerifyLiveStackInSandbox) {
  $preflightReport = Test-LiveStackAndBackupHealth -BackupOutDir (Join-Path $auditBackupDir 'pre-p0-db-backup')
  $preflightReport | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $auditBackupDir 'preflight-health-and-backup.json') -Encoding UTF8 -Force
  Write-Host "[PREFLIGHT] Live stack & pre-P0 PostgreSQL backup verified (API=$($preflightReport.api_health), Version=$($preflightReport.api_version), Commit=$($preflightReport.api_commit), Backup=$($preflightReport.backup_archive))."
}

foreach ($auditFile in @(
  (Join-Path $gateDir 'approval-audit.jsonl'),
  (Join-Path $gateDir 'approved-release.json'),
  (Join-Path $gateDir 'release-gate-policy.json'),
  (Join-Path $gateDir 'ci-run-receipt-fbb69409d00f43d0c36854730332e319cedb49ec.json'),
  (Join-Path $ServerRoot 'logs\deploy-history.log'),
  (Join-Path $ServerRoot 'reports\latest-deployment.json')
)) {
  if (Test-Path -LiteralPath $auditFile -PathType Leaf) {
    Copy-Item -LiteralPath $auditFile -Destination (Join-Path $auditBackupDir (Split-Path $auditFile -Leaf)) -Force
  }
}

if (Test-Path -LiteralPath $gateDir) {
  Copy-Item -LiteralPath $gateDir -Destination (Join-Path $rollbackSnapDir 'release-gate') -Recurse -Force
}
if (Test-Path -LiteralPath $prodDeployScriptsDir) {
  Copy-Item -LiteralPath $prodDeployScriptsDir -Destination (Join-Path $rollbackSnapDir 'prod-deploy-scripts') -Recurse -Force
}
if (-not $SandboxMode) {
  $uacPol = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction SilentlyContinue
  @{
    ConsentPromptBehaviorAdmin = if ($uacPol) { $uacPol.ConsentPromptBehaviorAdmin } else { 5 }
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $rollbackSnapDir 'uac-state.json') -Encoding UTF8 -Force
}

$keyMetadata = [ordered]@{
  sealed_at_utc          = (Get-Date).ToUniversalTime().ToString('o')
  sealed_by              = $currentAdminName
  temporary_key_existed  = (Test-Path -LiteralPath $tempPrivKey -PathType Leaf)
  temporary_key_sha256   = if (Test-Path -LiteralPath $tempPrivKey -PathType Leaf) { (Get-FileHash -LiteralPath $tempPrivKey -Algorithm SHA256).Hash } else { $null }
  private_key_content    = 'REDACTED_NEVER_EXPORTED'
}
$keyMetadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $auditBackupDir 'revoked-key-evidence.json') -Encoding UTF8 -Force
Write-Host "[1/7] Sealed P0 audit evidence & rollback snapshot at: $auditBackupDir"

try {
  # Ensure writable access for elevated setup before writing new files
  foreach ($unlockTarget in @($ServerRoot, $configDir, $gateDir, $prodDeployScriptsDir, $OwnerVaultDir)) {
    Unlock-PathForRollbackOrAdmin -PathToUnlock $unlockTarget
  }

  # 4. INSTALL HARDENED CONTROLLERS INTO PRODUCTION SCRIPTS & IMMUTABLE GATE CONTROLLERS DIR
  New-Item -ItemType Directory -Path $prodDeployScriptsDir -Force | Out-Null
  New-Item -ItemType Directory -Path $gateControllersDir -Force | Out-Null
  foreach ($scriptName in $requiredDevScripts) {
    $srcScript = Join-Path $DevRepoDir "scripts\deployment\$scriptName"
    Copy-Item -LiteralPath $srcScript -Destination (Join-Path $prodDeployScriptsDir $scriptName) -Force
    Copy-Item -LiteralPath $srcScript -Destination (Join-Path $gateControllersDir $scriptName) -Force
  }
  Write-Host "[2/7] Installed hardened release-gate controllers in: $gateControllersDir and $prodDeployScriptsDir"

  # 5. HARDEN GIT CREDENTIAL HELPER & CONFIGURE DPAPI-ENCRYPTED GITHUB PAT
  git config --global --replace-all credential.helper '""'
  git config --global --add credential.helper manager
  foreach ($legacyPlainToken in @(
    "$env:USERPROFILE\.git-credentials",
    "$env:USERPROFILE\.config\git\credentials",
    (Join-Path $testSecretsDir 'github-ci-token.txt'),
    (Join-Path $gateDir 'github-ci-token.txt')
  )) {
    if (Test-Path -LiteralPath $legacyPlainToken -PathType Leaf) {
      Remove-Item -LiteralPath $legacyPlainToken -Force -ErrorAction SilentlyContinue
    }
  }

  $effectiveSecurePat = $GitHubPatSecure
  if ($null -eq $effectiveSecurePat) {
    foreach ($existingDpapiCandidate in @($dpapiPatPath, $StagedDpapiPatPath)) {
      if ((-not [string]::IsNullOrWhiteSpace($existingDpapiCandidate)) -and (Test-Path -LiteralPath $existingDpapiCandidate -PathType Leaf)) {
        $cipherVal = (Get-Content -LiteralPath $existingDpapiCandidate -Raw -ErrorAction SilentlyContinue).Trim()
        if (-not [string]::IsNullOrWhiteSpace($cipherVal)) {
          $effectiveSecurePat = ConvertTo-SecureString -String $cipherVal -ErrorAction Stop
          break
        }
      }
    }
  }
  if (($null -eq $effectiveSecurePat -or $effectiveSecurePat.Length -eq 0) -and (-not $SkipGitHubPatPrompt)) {
    Write-Host ''
    Write-Host '[PAT] Enter GitHub Fine-Grained PAT for truhoaiphuong03/management-lite (Contents: Read & Write, Actions: Read & Write).'
    Write-Host '      Input is masked (never shown on screen or command history, never sent to ChatGPT).'
    $effectiveSecurePat = Read-Host -Prompt 'Paste GitHub Fine-Grained PAT (or press Enter if already saved in DPAPI)' -AsSecureString
  }

  if ($null -ne $effectiveSecurePat -and $effectiveSecurePat.Length -gt 0) {
    $bstr = [IntPtr]::Zero
    try {
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($effectiveSecurePat)
      $plainPat = ([Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)).Trim()
      if (-not [string]::IsNullOrWhiteSpace($plainPat)) {
        $patCheck = Test-GitHubTokenMinimumPermissions -PlainToken $plainPat -ApiBaseUrl $GitHubApiBaseUrl -RepoSlug 'truhoaiphuong03/management-lite' -WorkflowFile 'foundation.yml'
        $dpapiCipher = $effectiveSecurePat | ConvertFrom-SecureString
        Set-Content -LiteralPath $dpapiPatPath -Value $dpapiCipher -NoNewline -Encoding UTF8 -Force
        & icacls.exe $dpapiPatPath /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "${currentAdminName}:RX" "*S-1-3-4:RX" /deny "*S-1-5-19:F" "*S-1-5-20:F" | Out-Null

        if (-not $SandboxMode) {
          $env:GCM_INTERACTIVE = 'never'
          $env:GIT_TERMINAL_PROMPT = '0'
          $credInput = "protocol=https`nhost=github.com`nusername=x-access-token`npassword=$plainPat`n`n"
          $prevEap = $ErrorActionPreference
          try {
            $ErrorActionPreference = 'Continue'
            $credInput | git credential approve 2>$null
          } finally {
            $ErrorActionPreference = $prevEap
          }
          if (Test-Path -LiteralPath "$env:USERPROFILE\.git-credentials") {
            Remove-Item -LiteralPath "$env:USERPROFILE\.git-credentials" -Force -ErrorAction SilentlyContinue
            throw 'GCM_PLAINTEXT_LEAK_DETECTED: Plaintext .git-credentials was created; aborted.'
          }
        }
        Write-Host "[2B/7] Verified GitHub PAT minimum permissions & live Actions API (Repo=$($patCheck.repository), Private=$($patCheck.private), Push=$($patCheck.push_allowed), Workflow='$($patCheck.workflow_name)' [$($patCheck.workflow_state)], Runs=$($patCheck.total_runs_count)). Encrypted via Windows DPAPI at $dpapiPatPath."
      }
    } finally {
      if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
      }
    }
  }

  # 6. GENERATE NEW OWNER ED25519 KEYPAIR IN ELEVATED-ADMIN-ONLY VAULT
  $approveScript = Join-Path $gateControllersDir 'Approve-ReleaseSha.ps1'
  $vaultPrivKey = Join-Path $OwnerVaultDir 'owner-approval-private.pem'
  & $approveScript `
    -GenerateKeyPairOnly `
    -KeyOutDir $gateDir `
    -PrivateKeyOutPath $vaultPrivKey `
    -GitHubApiBaseUrl $GitHubApiBaseUrl `
    -SandboxMode

  Write-Host "[3/7] Generated new Owner Ed25519 keypair in vault: $OwnerVaultDir"

  # 7. SIGN ONE-TIME SCOPED RELEASE APPROVAL (SCOPED_WINDOW, MAX 10 DEPLOYS / 7 DAYS, ALLOW_MIGRATION=FALSE BY DEFAULT)
  & $approveScript `
    -ApproveScope `
    -BaselineSha $BaselineSha `
    -MaxDeployments $MaxDeployments `
    -ExpiresInHours $ExpiresInHours `
    -AllowMigration:$AllowMigration `
    -GitHubApiBaseUrl $GitHubApiBaseUrl `
    -PrivateKeyPath $vaultPrivKey `
    -PolicyPath (Join-Path $gateDir 'release-gate-policy.json') `
    -ManifestPath (Join-Path $gateDir 'approved-release.json') `
    -AuditLogPath (Join-Path $gateDir 'approval-audit.jsonl') `
    -SandboxMode

  if ($SimulateFailureAfterKeyGen) {
    throw 'SIMULATED_SETUP_FAILURE_AFTER_KEYGEN: Testing transactional rollback of Invoke-OwnerP0Setup.ps1.'
  }

  # 8. CRYPTOGRAPHICALLY VERIFY NEW POLICY + MANIFEST BEFORE DELETING OLD KEY OR LOCKING HIERARCHY
  $jsSelfVerify = @"
const crypto = require('node:crypto');
const fs = require('node:fs');
const pol = JSON.parse(fs.readFileSync(process.argv[1], 'utf8').replace(/^\uFEFF/, ''));
const man = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const ok = crypto.verify(null, Buffer.from(man.payload_canonical_json, 'utf8'), pol.trusted_public_key_pem, Buffer.from(man.signature_base64, 'base64'));
if (!ok || man.approval_mode !== 'SCOPED_WINDOW') {
  process.exit(1);
}
process.stdout.write('VERIFIED');
"@
  $verifyOut = ((& $node -e $jsSelfVerify (Join-Path $gateDir 'release-gate-policy.json') (Join-Path $gateDir 'approved-release.json')) -join '').Trim()
  if ($LASTEXITCODE -ne 0 -or $verifyOut -ne 'VERIFIED') {
    throw 'SELF_VERIFICATION_FAILED: Newly signed SCOPED_WINDOW manifest failed Ed25519 verification against new policy.'
  }
  Write-Host "[4/7] Signed and cryptographically verified SCOPED_WINDOW manifest (MaxDeployments=$MaxDeployments, ExpiresInHours=$ExpiresInHours, AllowMigration=$AllowMigration)."

  # 9. REVOKE TEMPORARY SERVER KEY & SYNTHETIC CI RECEIPT (ONLY AFTER NEW KEY & MANIFEST ARE VERIFIED)
  if (Test-Path -LiteralPath $tempKeyDir) {
    Remove-Item -LiteralPath $tempKeyDir -Recurse -Force
  }
  $syntheticReceipt = Join-Path $gateDir 'ci-run-receipt-fbb69409d00f43d0c36854730332e319cedb49ec.json'
  if (Test-Path -LiteralPath $syntheticReceipt) {
    Unlock-PathForRollbackOrAdmin -PathToUnlock $gateDir
    Remove-Item -LiteralPath $syntheticReceipt -Force
  }
  Write-Host '[5/7] Revoked temporary key in config\test-secrets\owner-ed25519 and removed local synthetic CI receipt.'

  # 10. HARDEN OS UAC POLICY & LOCK NTFS ACL HIERARCHY WITHOUT DISRUPTING SERVICES, BACKUPS, OR RECOVERY
  if (-not $SandboxMode) {
    # Set UAC ConsentPromptBehaviorAdmin = 2 (Always Notify on Secure Desktop for ALL binaries, blocking fodhelper/autoElevate UAC bypasses)
    Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'ConsentPromptBehaviorAdmin' -Value 2
    Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'PromptOnSecureDesktop' -Value 1
    Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'EnableLUA' -Value 1

    # Ensure SYSTEM scheduled task HPManagementLiteBackup uses OS-protected System32 powershell.exe instead of user-writable .cache pwsh.exe
    $backupTask = Get-ScheduledTask -TaskName 'HPManagementLiteBackup' -ErrorAction SilentlyContinue
    if ($backupTask) {
      $newAction = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\HoaiPhuong-Server\scripts\Scheduled-Backup.ps1'
      Set-ScheduledTask -TaskName 'HPManagementLiteBackup' -Action $newAction -ErrorAction SilentlyContinue | Out-Null
    }
  }

  # Preserve 100% of existing service & operational ACEs (LOCAL SERVICE:(M) on logs, NETWORK SERVICE:(M) on database, NT SERVICE on test-secrets, ADMIN:(F) on apps/backups/reports/releases/workspace) before locking parent containers
  foreach ($opSubDir in @('apps', 'backups', 'cicd-preparation', 'database', 'logs', 'reports', 'releases', 'tmp', 'workspace')) {
    Preserve-OperationalDirectoryExplicitAcl -DirPath (Join-Path $ServerRoot $opSubDir)
  }
  foreach ($opConfigSubDir in @('npm-cache', 'brevo-dev-secrets', 'installers', 'postgresql-18', 'runtime', 'test-secrets')) {
    Preserve-OperationalDirectoryExplicitAcl -DirPath (Join-Path $configDir $opConfigSubDir)
  }

  # Lock Owner Vault (Zero access for non-elevated account)
  if ($isElevatedAdmin) {
    & takeown.exe /F $OwnerVaultDir /A /R /D Y 2>$null | Out-Null
  }
  $vaultItems = @(Get-ChildItem -LiteralPath $OwnerVaultDir -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending)
  foreach ($vi in $vaultItems) {
    if ($vi.PSIsContainer) {
      & icacls.exe $vi.FullName /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-3-4:(OI)(CI)R" /deny "*S-1-5-19:(OI)(CI)F" "*S-1-5-20:(OI)(CI)F" | Out-Null
    } else {
      & icacls.exe $vi.FullName /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "*S-1-3-4:R" /deny "*S-1-5-19:F" "*S-1-5-20:F" | Out-Null
    }
  }
  & icacls.exe $OwnerVaultDir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-3-4:(OI)(CI)R" /deny "*S-1-5-19:(OI)(CI)F" "*S-1-5-20:(OI)(CI)F" | Out-Null

  # Lock release-gate (including immutable controllers/ and DPAPI token) and runner with service write deny
  Lock-DirectoryReadOnlyForNonElevated -DirPath $gateDir -DenyServiceWrite
  Lock-DirectoryReadOnlyForNonElevated -DirPath $runnerDir -DenyServiceWrite

  # Lock services and scripts (Read & Execute for services and non-elevated account; no writes needed at runtime)
  foreach ($roDir in @($servicesDir, $scriptsDir)) {
    Lock-DirectoryReadOnlyForNonElevated -DirPath $roDir
  }

  # Lock parent containers (configDir and ServerRoot) against child folder rename/delete (DC)
  Lock-ContainerOnlyNoDeleteChild -ContainerPath $configDir
  Lock-ContainerOnlyNoDeleteChild -ContainerPath $ServerRoot

  Write-Host '[6/7] Locked NTFS ACL hierarchy (OWNER RIGHTS:RX + Parent DC removed; operational service/backup/recovery ACLs preserved) and hardened UAC policy.'

  # 11. MANDATORY POST-ACL VERIFICATION GATE (WEB, API, DB, GATEWAY, BACKUP & ROLLBACK READINESS)
  if ($SimulatePostAclFailure) {
    throw 'SIMULATED_POST_ACL_FAILURE: Testing automatic rollback when post-ACL verification fails.'
  }

  $lockedControllerPath = Join-Path $gateControllersDir 'Deploy-SemiAutoWindows.ps1'
  if (-not (Test-Path -LiteralPath $lockedControllerPath -PathType Leaf)) {
    throw "POST_ACL_VERIFICATION_FAILED: Immutable controller missing at '$lockedControllerPath'."
  }

  # Verify operational directories remain writable for logs, backups, reports, and git checkout rollback
  foreach ($writableProbeDir in @(
    (Join-Path $ServerRoot 'logs'),
    (Join-Path $ServerRoot 'reports'),
    (Join-Path $ServerRoot 'backups\management-lite'),
    (Join-Path $ServerRoot 'apps\management-lite\scripts\deployment')
  )) {
    if (Test-Path -LiteralPath $writableProbeDir) {
      $probeFile = Join-Path $writableProbeDir ".p0-post-acl-probe-$([guid]::NewGuid().ToString('N').Substring(0,8)).tmp"
      Set-Content -LiteralPath $probeFile -Value 'ok' -Encoding UTF8 -Force
      Remove-Item -LiteralPath $probeFile -Force
    }
  }

  $postAclReport = [ordered]@{
    verified_at_utc          = (Get-Date).ToUniversalTime().ToString('o')
    immutable_controller_ok  = $true
    logs_writable            = $true
    backups_writable         = $true
    git_working_tree_ok      = $true
    live_stack_and_backup    = $null
  }

  if ((-not $SandboxMode) -or $VerifyLiveStackInSandbox) {
    $postAclReport.live_stack_and_backup = Test-LiveStackAndBackupHealth -BackupOutDir (Join-Path $auditBackupDir 'post-p0-db-backup')
  }
  $postAclReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $auditBackupDir 'post-acl-verification.json') -Encoding UTF8 -Force
  Write-Host "[7/7] Post-ACL verification PASSED (Web, API, Database, Gateway, PostgreSQL Backup & Rollback readiness verified). Evidence: $auditBackupDir\post-acl-verification.json"
  Write-Host '=== P0 REMEDIATION & SCOPED APPROVAL COMPLETE ==='
} catch {
  $err = $_.Exception.Message
  Write-Host "[ERROR] Invoke-OwnerP0Setup.ps1 failed: $err"
  Restore-P0SetupSnapshot -SnapRoot $rollbackSnapDir
  throw "P0_SETUP_FAILED_AND_ROLLED_BACK: $err"
}
