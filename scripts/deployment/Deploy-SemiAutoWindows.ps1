#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$CommitSha,
  [Parameter(Mandatory = $false)]
  [string]$ArtifactPath = '',
  [Parameter(Mandatory = $false)]
  [string]$ArtifactSha256 = '',
  [Parameter(Mandatory = $false)]
  [string]$CiRunId = '1',
  [Parameter(Mandatory = $false)]
  [string]$CiRunReceiptPath = '',
  [Parameter(Mandatory = $false)]
  [string]$GitHubApiBaseUrl = '',
  [string]$PolicyPath = 'C:\HoaiPhuong-Server\config\release-gate\release-gate-policy.json',
  [string]$ApprovalManifestPath = 'C:\HoaiPhuong-Server\config\release-gate\approved-release.json',
  [switch]$Force,
  [switch]$SkipMigration = $true,
  [switch]$RunMigrations,
  [switch]$RecoverInterrupted,
  [string]$ServerRoot = 'C:\HoaiPhuong-Server',
  [string]$TargetDir = 'C:\HoaiPhuong-Server\apps\management-lite',
  [string]$DbTarget = 'management_lite_test',
  [string]$DbHost = '127.0.0.1',
  [int]$DbPort = 55432,
  [string]$DbUser = 'hp_test_admin',
  [string]$PgPassFilePath = '',
  [string]$PgBinDir = '',
  [string]$HealthUrl = 'http://127.0.0.1:3002/api/v1/health',
  [string]$ReadyUrl = 'http://127.0.0.1:3002/api/v1/ready',
  [string]$WebUrl = 'http://127.0.0.1:3001/',
  [switch]$SandboxMode,
  [switch]$SkipBuildInSandbox,
  [switch]$SimulateHealthFailure,
  [switch]$SimulateRollbackHealthFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($RunMigrations) {
  $SkipMigration = $false
}

$normalizedSha = $CommitSha.Trim().ToLowerInvariant()
$normalizedArtifactSha = $ArtifactSha256.Trim().ToLowerInvariant()

$realServerRoot = 'C:\HoaiPhuong-Server'
$normRealRoot = [IO.Path]::GetFullPath($realServerRoot).TrimEnd('\', '/').ToLowerInvariant()
if ($SandboxMode) {
  $normServerRootCheck = [IO.Path]::GetFullPath($ServerRoot).TrimEnd('\', '/').ToLowerInvariant()
  if ($normServerRootCheck -eq $normRealRoot -or $normServerRootCheck.StartsWith("$normRealRoot\")) {
    throw "SANDBOX_VIOLATION_PRODUCTION_PATH_FORBIDDEN: SandboxMode cannot use Production ServerRoot '$ServerRoot'."
  }
  if ($PSBoundParameters.ContainsKey('TargetDir')) {
    $normTargetDirCheck = [IO.Path]::GetFullPath($TargetDir).TrimEnd('\', '/').ToLowerInvariant()
    if ($normTargetDirCheck -eq $normRealRoot -or $normTargetDirCheck.StartsWith("$normRealRoot\")) {
      throw "SANDBOX_VIOLATION_PRODUCTION_PATH_FORBIDDEN: SandboxMode cannot use Production TargetDir '$TargetDir'."
    }
  } else {
    $TargetDir = Join-Path $ServerRoot 'apps\management-lite'
  }
}

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
$stateJournalFile = Join-Path $reportsDir 'deployment-state.json'
$watermarkFile = Join-Path $reportsDir 'approval-watermark.json'
$runningComponentsFile = Join-Path $reportsDir 'running-components-sha.json'

if ($SandboxMode) {
  $nodeCandidates = @(
    @(
      'C:\ML-Test\runtime\node\node.exe',
      (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  )
  $node = if ($nodeCandidates.Count -gt 0) { $nodeCandidates[0] } else { 'node' }

  $pgBinCandidates = @(
    @(
      $PgBinDir,
      'C:\ML-Test\pgsql\bin'
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath (Join-Path $_ 'psql.exe')) }
  )
  $resolvedPgBin = if ($pgBinCandidates.Count -gt 0) { $pgBinCandidates[0] } else { 'C:\ML-Test\pgsql\bin' }
  $psql = Join-Path $resolvedPgBin 'psql.exe'
  $pgPassFile = if (-not [string]::IsNullOrWhiteSpace($PgPassFilePath)) {
    $PgPassFilePath
  } else {
    Join-Path $ServerRoot 'config\sandbox-db\pgpass.conf'
  }
  $backupScript = ''
} else {
  $node = Join-Path $realServerRoot 'config\runtime\node-v22.14.0-win-x64\node.exe'
  if (-not (Test-Path -LiteralPath $node)) { $node = 'node' }
  $resolvedPgBin = if (-not [string]::IsNullOrWhiteSpace($PgBinDir)) { $PgBinDir } else { Join-Path $realServerRoot 'config\postgresql-18\pgsql\bin' }
  $psql = Join-Path $resolvedPgBin 'psql.exe'
  $pgPassFile = if (-not [string]::IsNullOrWhiteSpace($PgPassFilePath)) { $PgPassFilePath } else { Join-Path $realServerRoot 'config\test-secrets\pgpass.conf' }
  $backupScript = Join-Path $realServerRoot 'scripts\Backup-Postgres.ps1'
}
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
  $resolvedVer = '0.1.0'
  try {
    $apiVerCandidate = Join-Path $TargetDir 'dist\release-version.json'
    if (Test-Path -LiteralPath $apiVerCandidate) {
      $verJson = Get-Content -LiteralPath $apiVerCandidate -Raw | ConvertFrom-Json
      if ($verJson.version) {
        $resolvedVer = [string]$verJson.version
      }
    }
  } catch {
    # Ignore optional version read error
  }
  $record = [ordered]@{
    timestamp    = (Get-Date -Format o)
    version      = $resolvedVer
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

if ($SandboxMode) {
  if ($PSBoundParameters.ContainsKey('DbPort') -and $DbPort -eq 55432) {
    Record-DeployResult -Status 'REJECTED_SANDBOX_PRODUCTION_PORT_FORBIDDEN' -Sha $normalizedSha -Message 'SandboxMode is strictly forbidden from targeting Production port 55432' -DurationMs 0
    throw 'SANDBOX_VIOLATION_PRODUCTION_PORT_55432_FORBIDDEN: SandboxMode is strictly forbidden from targeting Production port 55432.'
  }
  if ($PSBoundParameters.ContainsKey('DbUser') -and $DbUser -ieq 'hp_test_admin') {
    Record-DeployResult -Status 'REJECTED_SANDBOX_PRODUCTION_CREDENTIAL_FORBIDDEN' -Sha $normalizedSha -Message 'SandboxMode is strictly forbidden from using Production credential hp_test_admin' -DurationMs 0
    throw 'SANDBOX_VIOLATION_PRODUCTION_CREDENTIAL_FORBIDDEN: SandboxMode is strictly forbidden from using Production credential hp_test_admin.'
  }
  if (-not [string]::IsNullOrWhiteSpace($PgPassFilePath)) {
    $normPgPassArg = [IO.Path]::GetFullPath($PgPassFilePath).TrimEnd('\', '/').ToLowerInvariant()
    if ($normPgPassArg -eq $normRealRoot -or $normPgPassArg.StartsWith("$normRealRoot\")) {
      Record-DeployResult -Status 'REJECTED_SANDBOX_PRODUCTION_PGPASS_FORBIDDEN' -Sha $normalizedSha -Message "SandboxMode is strictly forbidden from reading Production pgpass.conf ('$PgPassFilePath')" -DurationMs 0
      throw 'SANDBOX_VIOLATION_PRODUCTION_PGPASS_FORBIDDEN: SandboxMode is strictly forbidden from reading Production pgpass.conf.'
    }
  }
}

function Assert-SandboxDatabaseIsolation {
  if (-not $SandboxMode) { return }
  if ($env:CONFIRM_ISOLATED_TEST_DB -ne 'true' -and $env:CONFIRM_ISOLATED_TEST_DB -ne '1') {
    Record-DeployResult -Status 'REJECTED_SANDBOX_DB_UNCONFIRMED' -Sha $normalizedSha -Message 'SandboxMode database operation requires CONFIRM_ISOLATED_TEST_DB=true' -DurationMs 0
    throw 'SANDBOX_VIOLATION_UNCONFIRMED_TEST_DB: CONFIRM_ISOLATED_TEST_DB=true is required for SandboxMode database operations.'
  }
  if ($DbPort -eq 55432 -or ($env:TEST_DATABASE_URL -and $env:TEST_DATABASE_URL -match ':55432(/|$)') -or ($env:DATABASE_URL -and $env:DATABASE_URL -match ':55432(/|$)')) {
    Record-DeployResult -Status 'REJECTED_SANDBOX_PRODUCTION_PORT_FORBIDDEN' -Sha $normalizedSha -Message "SandboxMode is forbidden from connecting to Production port 55432 (DbPort=$DbPort)" -DurationMs 0
    throw 'SANDBOX_VIOLATION_PRODUCTION_PORT_55432_FORBIDDEN: SandboxMode is strictly forbidden from connecting to Production port 55432.'
  }
  if ([string]::IsNullOrWhiteSpace($DbUser) -or $DbUser -ieq 'hp_test_admin' -or ($env:TEST_DATABASE_URL -and $env:TEST_DATABASE_URL -match '(?i)//hp_test_admin[:@]') -or ($env:DATABASE_URL -and $env:DATABASE_URL -match '(?i)//hp_test_admin[:@]')) {
    Record-DeployResult -Status 'REJECTED_SANDBOX_PRODUCTION_CREDENTIAL_FORBIDDEN' -Sha $normalizedSha -Message "SandboxMode is forbidden from using Production credential '$DbUser'" -DurationMs 0
    throw 'SANDBOX_VIOLATION_PRODUCTION_CREDENTIAL_FORBIDDEN: SandboxMode is strictly forbidden from using Production credential hp_test_admin.'
  }
  if ([string]::IsNullOrWhiteSpace($pgPassFile)) {
    Record-DeployResult -Status 'REJECTED_SANDBOX_PRODUCTION_PGPASS_FORBIDDEN' -Sha $normalizedSha -Message 'SandboxMode requires an isolated pgpass.conf file' -DurationMs 0
    throw 'SANDBOX_VIOLATION_PRODUCTION_PGPASS_FORBIDDEN: SandboxMode requires an isolated pgpass.conf file.'
  }
  $normPgPass = [IO.Path]::GetFullPath($pgPassFile).TrimEnd('\', '/').ToLowerInvariant()
  if ($normPgPass -eq $normRealRoot -or $normPgPass.StartsWith("$normRealRoot\")) {
    Record-DeployResult -Status 'REJECTED_SANDBOX_PRODUCTION_PGPASS_FORBIDDEN' -Sha $normalizedSha -Message "SandboxMode is forbidden from reading Production pgpass.conf ('$pgPassFile')" -DurationMs 0
    throw 'SANDBOX_VIOLATION_PRODUCTION_PGPASS_FORBIDDEN: SandboxMode is strictly forbidden from reading Production pgpass.conf.'
  }
  if (-not (Test-Path -LiteralPath $pgPassFile -PathType Leaf)) {
    Record-DeployResult -Status 'REJECTED_SANDBOX_PRODUCTION_PGPASS_FORBIDDEN' -Sha $normalizedSha -Message "Isolated sandbox pgpass.conf not found at '$pgPassFile'" -DurationMs 0
    throw "SANDBOX_VIOLATION_PRODUCTION_PGPASS_FORBIDDEN: Isolated sandbox pgpass.conf not found at '$pgPassFile'."
  }
  $pgPassContent = [IO.File]::ReadAllText($pgPassFile)
  if ($pgPassContent -match '(?m):55432:' -or $pgPassContent -match '(?i):hp_test_admin:') {
    Record-DeployResult -Status 'REJECTED_SANDBOX_PRODUCTION_CREDENTIAL_FORBIDDEN' -Sha $normalizedSha -Message 'Sandbox pgpass.conf contains forbidden Production port 55432 or user hp_test_admin' -DurationMs 0
    throw 'SANDBOX_VIOLATION_PRODUCTION_CREDENTIAL_FORBIDDEN: Sandbox pgpass.conf contains forbidden Production port 55432 or user hp_test_admin.'
  }
}

function Write-RunningComponentsProof {
  param([string]$Sha, [string]$ArtifactDigest)
  $apiMain = Join-Path $TargetDir 'dist\apps\api\src\main.js'
  $webIndex = Join-Path $TargetDir 'apps\web\dist\index.html'
  $apiVerFile = Join-Path $TargetDir 'dist\release-version.json'
  $webVerFile = Join-Path $TargetDir 'apps\web\dist\release-version.json'

  if (-not (Test-Path -LiteralPath $apiMain) -or -not (Test-Path -LiteralPath $webIndex) -or
      -not (Test-Path -LiteralPath $apiVerFile) -or -not (Test-Path -LiteralPath $webVerFile)) {
    throw 'Missing deployed runtime entrypoints or release-version.json files.'
  }

  $apiVerObj = Get-Content -LiteralPath $apiVerFile -Raw | ConvertFrom-Json
  $webVerObj = Get-Content -LiteralPath $webVerFile -Raw | ConvertFrom-Json
  $apiMainHash = (Get-FileHash -LiteralPath $apiMain -Algorithm SHA256).Hash.ToLowerInvariant()
  $webIndexHash = (Get-FileHash -LiteralPath $webIndex -Algorithm SHA256).Hash.ToLowerInvariant()

  # Never overwrite dist/release-version.json or apps/web/dist/release-version.json (preserve artifact immutability)
  @{
    sha               = $Sha
    api_sha           = [string]$apiVerObj.sha
    web_sha           = [string]$webVerObj.sha
    artifact_sha256   = $ArtifactDigest
    api_main_sha256   = $apiMainHash
    web_index_sha256  = $webIndexHash
    verified_at_utc   = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $runningComponentsFile -Encoding UTF8 -Force
}

function Test-ApplicationSmoke {
  param(
    [string]$ExpectedSha,
    [int]$MaxAttempts = 10,
    [switch]$IsRollbackVerification
  )
  if ($IsRollbackVerification) {
    if ($SimulateRollbackHealthFailure) {
      if (-not $SandboxMode) {
        throw 'SimulateRollbackHealthFailure is only allowed in -SandboxMode.'
      }
      Write-DeployLog 'SANDBOX: Simulating post-rollback health check failure...' 'WARN'
      return $false
    }
  } else {
    if ($SimulateHealthFailure) {
      if (-not $SandboxMode) {
        throw 'SimulateHealthFailure is only allowed in -SandboxMode.'
      }
      Write-DeployLog 'SANDBOX: Simulating post-deploy health check failure...' 'WARN'
      return $false
    }
  }

  $webVersionFile = Join-Path $TargetDir 'apps\web\dist\release-version.json'
  $apiVersionFile = Join-Path $TargetDir 'dist\release-version.json'
  $apiMainFile = Join-Path $TargetDir 'dist\apps\api\src\main.js'
  $webIndexFile = Join-Path $TargetDir 'apps\web\dist\index.html'
  if (-not (Test-Path -LiteralPath $webVersionFile) -or
      -not (Test-Path -LiteralPath $apiVersionFile) -or
      -not (Test-Path -LiteralPath $apiMainFile) -or
      -not (Test-Path -LiteralPath $webIndexFile)) {
    Write-DeployLog 'Missing Web/API release-version.json or entrypoints' 'WARN'
    return $false
  }
  $webVer = Get-Content -LiteralPath $webVersionFile -Raw | ConvertFrom-Json
  $apiVer = Get-Content -LiteralPath $apiVersionFile -Raw | ConvertFrom-Json
  if ($webVer.sha.Trim().ToLowerInvariant() -ne $ExpectedSha -or $apiVer.sha.Trim().ToLowerInvariant() -ne $ExpectedSha) {
    Write-DeployLog "release-version.json SHA mismatch (Web=$($webVer.sha), API=$($apiVer.sha), Expected=$ExpectedSha)" 'WARN'
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

function Invoke-AtomicRuntimeSwap {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDistDir,
    [Parameter(Mandatory = $true)][string]$SourceWebDistDir,
    [string]$SourcePackageJson = ''
  )
  $swapId = [guid]::NewGuid().ToString('N').Substring(0, 8)
  $liveDist = Join-Path $TargetDir 'dist'
  $liveWebParent = Join-Path $TargetDir 'apps\web'
  $liveWebDist = Join-Path $liveWebParent 'dist'
  $livePkg = Join-Path $TargetDir 'package.json'

  if (-not (Test-Path -LiteralPath $liveWebParent)) {
    New-Item -ItemType Directory -Path $liveWebParent -Force | Out-Null
  }

  $stageDist = Join-Path $TargetDir ".dist.stage-$swapId"
  $stageWebDist = Join-Path $liveWebParent ".dist.stage-$swapId"
  $stagePkg = Join-Path $TargetDir ".package.json.stage-$swapId"
  $prevDist = Join-Path $TargetDir ".dist.prev-$swapId"
  $prevWebDist = Join-Path $liveWebParent ".dist.prev-$swapId"

  try {
    # 1. Stage directories on the same NTFS volume before touching live paths
    Copy-Item -LiteralPath $SourceDistDir -Destination $stageDist -Recurse -Force
    Copy-Item -LiteralPath $SourceWebDistDir -Destination $stageWebDist -Recurse -Force
    if (-not [string]::IsNullOrWhiteSpace($SourcePackageJson) -and (Test-Path -LiteralPath $SourcePackageJson -PathType Leaf)) {
      Copy-Item -LiteralPath $SourcePackageJson -Destination $stagePkg -Force
    }

    if (-not (Test-Path -LiteralPath (Join-Path $stageDist 'apps\api\src\main.js') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $stageDist 'release-version.json') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $stageWebDist 'index.html') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $stageWebDist 'release-version.json') -PathType Leaf)) {
      throw 'Staged runtime directories are missing required entrypoints or release-version.json.'
    }

    # 2. Same-volume atomic directory swap via [System.IO.Directory]::Move
    $distMovedToPrev = $false
    $distSwapped = $false
    $webMovedToPrev = $false
    $webSwapped = $false

    try {
      if (Test-Path -LiteralPath $liveDist) {
        [System.IO.Directory]::Move($liveDist, $prevDist)
        $distMovedToPrev = $true
      }
      [System.IO.Directory]::Move($stageDist, $liveDist)
      $distSwapped = $true

      if (Test-Path -LiteralPath $liveWebDist) {
        [System.IO.Directory]::Move($liveWebDist, $prevWebDist)
        $webMovedToPrev = $true
      }
      [System.IO.Directory]::Move($stageWebDist, $liveWebDist)
      $webSwapped = $true

      if (Test-Path -LiteralPath $stagePkg -PathType Leaf) {
        [System.IO.File]::Copy($stagePkg, $livePkg, $true)
      }
    } catch {
      $swapErr = $_.Exception.Message
      if ($webSwapped -and (Test-Path -LiteralPath $liveWebDist)) {
        Remove-Item -LiteralPath $liveWebDist -Recurse -Force -ErrorAction SilentlyContinue
      }
      if ($webMovedToPrev -and (Test-Path -LiteralPath $prevWebDist) -and -not (Test-Path -LiteralPath $liveWebDist)) {
        [System.IO.Directory]::Move($prevWebDist, $liveWebDist)
      }
      if ($distSwapped -and (Test-Path -LiteralPath $liveDist)) {
        Remove-Item -LiteralPath $liveDist -Recurse -Force -ErrorAction SilentlyContinue
      }
      if ($distMovedToPrev -and (Test-Path -LiteralPath $prevDist) -and -not (Test-Path -LiteralPath $liveDist)) {
        [System.IO.Directory]::Move($prevDist, $liveDist)
      }
      throw "Atomic runtime directory swap failed: $swapErr"
    }
  } finally {
    foreach ($cleanupPath in @($stageDist, $stageWebDist, $stagePkg, $prevDist, $prevWebDist)) {
      if (Test-Path -LiteralPath $cleanupPath) {
        Remove-Item -LiteralPath $cleanupPath -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

function Get-DatabaseSchemaAndAuthState {
  Assert-SandboxDatabaseIsolation
  $env:PGPASSFILE = $pgPassFile
  $regLines = @(& $psql -h $DbHost -p $DbPort -U $DbUser -d $DbTarget -X -w -t -A -c "SET default_transaction_read_only = on; SELECT CASE WHEN to_regclass('public.schema_migrations') IS NOT NULL THEN 'YES' ELSE 'NO' END;" 2>$null | Where-Object { $_ -and $_ -ne 'SET' })
  if ($LASTEXITCODE -ne 0 -or $regLines.Count -eq 0) {
    throw "Failed to query schema_migrations existence from '$DbTarget'"
  }
  $tableExists = ($regLines[0].Trim() -eq 'YES')
  if (-not $tableExists) {
    return @{
      table_exists       = $false
      mig_lines          = @()
      mig_count          = 0
      schema_identity    = ''
      has_0023           = $false
      remember_me_column = $false
    }
  }

  $dbMigLines = @(& $psql -h $DbHost -p $DbPort -U $DbUser -d $DbTarget -X -w -t -A -c "SET default_transaction_read_only = on; SELECT id || ':' || checksum FROM schema_migrations ORDER BY id;" 2>$null | Where-Object { $_ -and $_ -ne 'SET' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to query schema_migrations rows from '$DbTarget'"
  }

  $colLines = @(& $psql -h $DbHost -p $DbPort -U $DbUser -d $DbTarget -X -w -t -A -c "SET default_transaction_read_only = on; SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auth_sessions' AND column_name = 'remember_me') THEN 'PRESENT' ELSE 'MISSING' END;" 2>$null | Where-Object { $_ -and $_ -ne 'SET' })
  if ($LASTEXITCODE -ne 0 -or $colLines.Count -eq 0) {
    throw "Failed to query information_schema.columns for auth_sessions.remember_me from '$DbTarget'"
  }
  $hasRememberMeCol = ($colLines[0].Trim() -eq 'PRESENT')

  $jsComputeDbSchema = @"
const crypto = require('node:crypto');
const raw = process.argv[1] || '';
const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const migs = lines.map(l => {
  const idx = l.indexOf(':');
  return { id: l.slice(0, idx), checksum: l.slice(idx + 1).toLowerCase() };
});
process.stdout.write(crypto.createHash('sha256').update(JSON.stringify(migs), 'utf8').digest('hex'));
"@
  $joinedMigs = $dbMigLines -join "`n"
  $dbSchemaIdentity = if ($dbMigLines.Count -gt 0) { ((& $node -e $jsComputeDbSchema $joinedMigs) -join '').Trim().ToLowerInvariant() } else { '' }
  $has0023InTable = [bool]($dbMigLines | Where-Object { $_ -match '^0023_auth_session_remember_me:' })

  return @{
    table_exists       = $true
    mig_lines          = $dbMigLines
    mig_count          = $dbMigLines.Count
    schema_identity    = $dbSchemaIdentity
    has_0023           = ($has0023InTable -or $hasRememberMeCol)
    has_0023_migration = $has0023InTable
    remember_me_column = $hasRememberMeCol
  }
}

function Get-ReleaseCompatibilityDescriptor {
  param(
    [string]$ReleaseDir,
    [string]$GitSha = '',
    [psobject]$RollbackMetadata = $null
  )
  $schemaId = ''
  $migCount = 0
  $maxMigId = ''
  $has0023 = $false
  $authPolicy = ''
  $explicitMeta = $false

  if ($null -ne $RollbackMetadata) {
    if (($RollbackMetadata.PSObject.Properties.Name -contains 'previous_schema_identity') -and -not [string]::IsNullOrWhiteSpace([string]$RollbackMetadata.previous_schema_identity)) {
      $schemaId = [string]$RollbackMetadata.previous_schema_identity.Trim().ToLowerInvariant()
    }
    if (($RollbackMetadata.PSObject.Properties.Name -contains 'previous_migration_count') -and $null -ne $RollbackMetadata.previous_migration_count) {
      $migCount = [int]$RollbackMetadata.previous_migration_count
    }
    if (($RollbackMetadata.PSObject.Properties.Name -contains 'previous_max_migration_id') -and -not [string]::IsNullOrWhiteSpace([string]$RollbackMetadata.previous_max_migration_id)) {
      $maxMigId = [string]$RollbackMetadata.previous_max_migration_id
    }
    if ($RollbackMetadata.PSObject.Properties.Name -contains 'previous_has_0023') {
      $has0023 = [bool]$RollbackMetadata.previous_has_0023
      $explicitMeta = $true
    }
    if (($RollbackMetadata.PSObject.Properties.Name -contains 'previous_auth_policy') -and -not [string]::IsNullOrWhiteSpace([string]$RollbackMetadata.previous_auth_policy)) {
      $authPolicy = [string]$RollbackMetadata.previous_auth_policy
      $explicitMeta = $true
    }
  }

  $apiVerPath = if ($ReleaseDir) { Join-Path $ReleaseDir 'dist\release-version.json' } else { '' }
  if ($apiVerPath -and (Test-Path -LiteralPath $apiVerPath -PathType Leaf)) {
    try {
      $verObj = Get-Content -LiteralPath $apiVerPath -Raw | ConvertFrom-Json
      if ([string]::IsNullOrWhiteSpace($schemaId) -and ($verObj.PSObject.Properties.Name -contains 'schemaIdentity') -and -not [string]::IsNullOrWhiteSpace([string]$verObj.schemaIdentity)) {
        $schemaId = [string]$verObj.schemaIdentity.Trim().ToLowerInvariant()
      }
      if ($migCount -eq 0 -and ($verObj.PSObject.Properties.Name -contains 'migrationCount') -and $null -ne $verObj.migrationCount) {
        $migCount = [int]$verObj.migrationCount
      }
      if ([string]::IsNullOrWhiteSpace($maxMigId) -and ($verObj.PSObject.Properties.Name -contains 'maxMigrationId') -and -not [string]::IsNullOrWhiteSpace([string]$verObj.maxMigrationId)) {
        $maxMigId = [string]$verObj.maxMigrationId
      }
      if ([string]::IsNullOrWhiteSpace($authPolicy) -and ($verObj.PSObject.Properties.Name -contains 'authPolicyVersion') -and -not [string]::IsNullOrWhiteSpace([string]$verObj.authPolicyVersion)) {
        $authPolicy = [string]$verObj.authPolicyVersion
        $explicitMeta = $true
      }
      if ($maxMigId -eq '0023_auth_session_remember_me' -or $authPolicy -eq 'auth-remember-01') {
        $has0023 = $true
      }
    } catch { }
  }

  if ([string]::IsNullOrWhiteSpace($schemaId) -or (-not $explicitMeta)) {
    $migCandidateDir = ''
    if ($ReleaseDir) {
      $cand1 = Join-Path $ReleaseDir 'migrations'
      $cand2 = Join-Path $ReleaseDir 'packages\database\src\migrations'
      if (Test-Path -LiteralPath $cand1 -PathType Container) { $migCandidateDir = $cand1 }
      elseif (Test-Path -LiteralPath $cand2 -PathType Container) { $migCandidateDir = $cand2 }
    }

    if (-not [string]::IsNullOrWhiteSpace($migCandidateDir)) {
      $jsInspectDirMigs = @"
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[1];
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const migs = files.map(f => {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim();
  return { id: f.replace(/\.sql$/, ''), checksum: crypto.createHash('sha256').update(raw, 'utf8').digest('hex') };
});
const schemaIdentity = migs.length > 0 ? crypto.createHash('sha256').update(JSON.stringify(migs), 'utf8').digest('hex') : '';
const has0023 = migs.some(m => m.id === '0023_auth_session_remember_me');
process.stdout.write(JSON.stringify({
  schemaIdentity,
  migrationCount: migs.length,
  maxMigrationId: migs.length > 0 ? migs[migs.length - 1].id : '',
  has0023
}));
"@
      $dirMigJson = ((& $node -e $jsInspectDirMigs $migCandidateDir) -join '').Trim()
      if (-not [string]::IsNullOrWhiteSpace($dirMigJson)) {
        $dirMigObj = $dirMigJson | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace($schemaId)) { $schemaId = [string]$dirMigObj.schemaIdentity }
        if ($migCount -eq 0) { $migCount = [int]$dirMigObj.migrationCount }
        if ([string]::IsNullOrWhiteSpace($maxMigId)) { $maxMigId = [string]$dirMigObj.maxMigrationId }
        if (-not $explicitMeta) { $has0023 = [bool]$dirMigObj.has0023 }
      }
    } elseif ($GitSha -match '^[0-9a-f]{40}$' -and (Test-Path -LiteralPath (Join-Path $TargetDir '.git'))) {
      $jsInspectGitMigs = @"
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const repo = process.argv[1];
const sha = process.argv[2];
try {
  const namesRaw = execFileSync('git', ['-c', 'safe.directory=*', '-C', repo, 'ls-tree', '--name-only', sha + ':packages/database/src/migrations'], { encoding: 'utf8' });
  const files = namesRaw.split(/\r?\n/).map(s => s.trim()).filter(f => f.endsWith('.sql')).sort();
  const migs = files.map(f => {
    const raw = execFileSync('git', ['-c', 'safe.directory=*', '-C', repo, 'show', sha + ':packages/database/src/migrations/' + f], { encoding: 'utf8' }).replace(/\r\n/g, '\n').trim();
    return { id: f.replace(/\.sql$/, ''), checksum: crypto.createHash('sha256').update(raw, 'utf8').digest('hex') };
  });
  const schemaIdentity = migs.length > 0 ? crypto.createHash('sha256').update(JSON.stringify(migs), 'utf8').digest('hex') : '';
  const has0023 = migs.some(m => m.id === '0023_auth_session_remember_me');
  process.stdout.write(JSON.stringify({
    schemaIdentity,
    migrationCount: migs.length,
    maxMigrationId: migs.length > 0 ? migs[migs.length - 1].id : '',
    has0023
  }));
} catch (e) {
  process.stdout.write('');
}
"@
      $gitMigJson = ((& $node -e $jsInspectGitMigs $TargetDir $GitSha) -join '').Trim()
      if (-not [string]::IsNullOrWhiteSpace($gitMigJson)) {
        $gitMigObj = $gitMigJson | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace($schemaId)) { $schemaId = [string]$gitMigObj.schemaIdentity }
        if ($migCount -eq 0) { $migCount = [int]$gitMigObj.migrationCount }
        if ([string]::IsNullOrWhiteSpace($maxMigId)) { $maxMigId = [string]$gitMigObj.maxMigrationId }
        if (-not $explicitMeta) { $has0023 = [bool]$gitMigObj.has0023 }
      }
    }
  }

  # Also inspect compiled auth/service.js if present to verify remember_me policy support in code
  $authServicePath = if ($ReleaseDir) { Join-Path $ReleaseDir 'dist\apps\api\src\auth\service.js' } else { '' }
  if ($authServicePath -and (Test-Path -LiteralPath $authServicePath -PathType Leaf)) {
    $svcContent = Get-Content -LiteralPath $authServicePath -Raw
    if ($svcContent.Length -gt 100) {
      if ($svcContent -notmatch 'remember_me' -or $svcContent -notmatch 'getRememberMeMaxAgeSeconds') {
        $has0023 = $false
        $authPolicy = 'legacy-pre-0023'
      }
    }
  }

  if ([string]::IsNullOrWhiteSpace($authPolicy)) {
    $authPolicy = if ($has0023) { 'auth-remember-01' } else { 'legacy-pre-0023' }
  }

  return @{
    schema_identity = $schemaId
    migration_count = $migCount
    max_migration   = $maxMigId
    has_0023        = [bool]$has0023
    auth_policy     = $authPolicy
  }
}

function Restore-VerifiedSnapshot {
  param(
    [string]$SnapshotPath,
    [string]$ExpectedPreviousSha,
    [string]$FailedSha,
    [string]$JournalSuccessStatus = 'ROLLED_BACK',
    [string]$ResultSuccessStatus = 'ROLLED_BACK',
    [string]$FailureReason = ''
  )
  $rbMetaFile = if ($SnapshotPath) { Join-Path $SnapshotPath 'rollback-metadata.json' } else { '' }
  @{
    status              = 'ROLLING_BACK'
    sha                 = $ExpectedPreviousSha
    failed_sha          = $FailedSha
    snapshot_dir        = $SnapshotPath
    rolling_back_at_utc = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $stateJournalFile -Encoding UTF8 -Force

  try {
    if ([string]::IsNullOrWhiteSpace($SnapshotPath) -or (-not (Test-Path -LiteralPath $SnapshotPath)) -or (-not (Test-Path -LiteralPath $rbMetaFile))) {
      throw "Snapshot directory or rollback-metadata.json missing ($SnapshotPath)."
    }
    $rbMeta = Get-Content -LiteralPath $rbMetaFile -Raw | ConvertFrom-Json
    if ($ExpectedPreviousSha -notmatch '^[0-9a-f]{40}$' -or $rbMeta.previous_git_sha.Trim().ToLowerInvariant() -ne $ExpectedPreviousSha) {
      throw "Snapshot metadata previous_git_sha ($($rbMeta.previous_git_sha)) does not match expected ($ExpectedPreviousSha)."
    }

    # Verify every file in the pre-deploy snapshot against recorded SHA-256 digests before restoring
    $metaFiles = @($rbMeta.files)
    if ($metaFiles.Count -eq 0) {
      throw 'Snapshot rollback-metadata.json contains zero verified files.'
    }
    foreach ($sf in $metaFiles) {
      $sfPath = [IO.Path]::GetFullPath((Join-Path $SnapshotPath $sf.path))
      if (-not $sfPath.StartsWith([IO.Path]::GetFullPath($SnapshotPath) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
          -not (Test-Path -LiteralPath $sfPath -PathType Leaf)) {
        throw "Snapshot file missing or invalid path: $($sf.path)"
      }
      $sfHash = (Get-FileHash -LiteralPath $sfPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($sfHash -ne $sf.sha256.ToLowerInvariant()) {
        throw "Snapshot integrity check failed for $($sf.path) (expected $($sf.sha256), actual $sfHash)."
      }
    }

    if (-not (Test-Path -LiteralPath (Join-Path $SnapshotPath 'dist')) -or -not (Test-Path -LiteralPath (Join-Path $SnapshotPath 'web\dist'))) {
      throw 'Snapshot is missing required dist or web\dist directory.'
    }

    # MANDATORY ROLLBACK SCHEMA & AUTH-REMEMBER-01 POLICY COMPATIBILITY GATE (BEFORE RUNTIME RESTORE)
    $dbStateForRb = Get-DatabaseSchemaAndAuthState
    $snapCompat = Get-ReleaseCompatibilityDescriptor -ReleaseDir $SnapshotPath -GitSha $ExpectedPreviousSha -RollbackMetadata $rbMeta
    $incompatReasons = @()
    if ($dbStateForRb.has_0023 -and ((-not $snapCompat.has_0023) -or $snapCompat.auth_policy -ne 'auth-remember-01')) {
      $incompatReasons += "Database '$DbTarget' has migration 0023_auth_session_remember_me applied (auth-remember-01 session policy), but rollback target $ExpectedPreviousSha has auth_policy='$($snapCompat.auth_policy)' (has_0023=$($snapCompat.has_0023)). Code-only rollback would violate AUTH-REMEMBER-01 session security policy"
    }
    if (-not [string]::IsNullOrWhiteSpace($snapCompat.schema_identity) -and -not [string]::IsNullOrWhiteSpace($dbStateForRb.schema_identity) -and $snapCompat.schema_identity -ne $dbStateForRb.schema_identity) {
      $incompatReasons += "Database '$DbTarget' schema_identity ($($dbStateForRb.schema_identity), $($dbStateForRb.mig_count) migrations) does not match rollback target $ExpectedPreviousSha schema_identity ($($snapCompat.schema_identity), $($snapCompat.migration_count) migrations)"
    }
    if ($snapCompat.migration_count -gt 0 -and $dbStateForRb.mig_count -ne $snapCompat.migration_count) {
      $incompatReasons += "Database '$DbTarget' has $($dbStateForRb.mig_count) applied migrations, but rollback target $ExpectedPreviousSha expects $($snapCompat.migration_count) migrations"
    }

    if ($incompatReasons.Count -gt 0) {
      $incompatDetail = $incompatReasons -join '; '
      Write-DeployLog "STOP/NO-GO: Blocking incompatible code-only rollback to $ExpectedPreviousSha ($incompatDetail)." 'ERROR'
      if (-not $SandboxMode) {
        Stop-Service HPManagementLiteApi -Force -ErrorAction SilentlyContinue
      }
      @{
        status                   = 'STOP_NO_GO_INCOMPATIBLE_ROLLBACK'
        sha                      = $ExpectedPreviousSha
        failed_sha               = $FailedSha
        snapshot_dir             = $SnapshotPath
        db_schema_identity       = $dbStateForRb.schema_identity
        db_migration_count       = $dbStateForRb.mig_count
        snapshot_schema_identity = $snapCompat.schema_identity
        snapshot_migration_count = $snapCompat.migration_count
        snapshot_auth_policy     = $snapCompat.auth_policy
        rollback_error           = $incompatDetail
        safe_recovery_options    = @(
          '1. SAFE FORWARD RECOVERY (ZERO DATA LOSS): Deploy an Owner-signed 0023-compatible hotfix bundle with -Force and -SkipMigration.',
          '2. FULL MAINTENANCE RESTORE: Only inside an Owner-approved maintenance window, restore the pre-deploy PostgreSQL backup alongside the pre-0023 snapshot.'
        )
        stopped_at_utc           = (Get-Date).ToUniversalTime().ToString('o')
      } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateJournalFile -Encoding UTF8 -Force

      $duration = [int]((Get-Date) - $startTime).TotalMilliseconds
      Record-DeployResult -Status 'ROLLBACK_BLOCKED_INCOMPATIBLE_SCHEMA_OR_AUTH_POLICY' -Sha $FailedSha -PreviousSha $ExpectedPreviousSha -Message "STOP/NO-GO: Deploy failed ($FailureReason) AND rollback to $ExpectedPreviousSha blocked ($incompatDetail)" -DurationMs $duration
      throw "STOP_NO_GO_INCOMPATIBLE_ROLLBACK: Deployment of $FailedSha failed ($FailureReason) and code-only rollback to $ExpectedPreviousSha was BLOCKED ($incompatDetail)."
    }

    Write-DeployLog "Rollback target $ExpectedPreviousSha verified compatible with database schema ($($dbStateForRb.mig_count) migrations) and auth policy ($($snapCompat.auth_policy))."
    Write-DeployLog "Restoring Git working tree to previous SHA: $ExpectedPreviousSha..."
    $prevEapRb = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      git -c safe.directory=* -C $TargetDir checkout --quiet -f $ExpectedPreviousSha 2>$null
      $rbGitExit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $prevEapRb
    }
    $actualRestoredGit = (git -c safe.directory=* -C $TargetDir rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
    if ($rbGitExit -ne 0 -or $actualRestoredGit -ne $ExpectedPreviousSha) {
      throw "Failed to restore Git working tree to $ExpectedPreviousSha (actual=$actualRestoredGit)."
    }

    Invoke-AtomicRuntimeSwap -SourceDistDir (Join-Path $SnapshotPath 'dist') -SourceWebDistDir (Join-Path $SnapshotPath 'web\dist') -SourcePackageJson (Join-Path $SnapshotPath 'package.json')

    Set-Content -LiteralPath $currentShaFile -Value $ExpectedPreviousSha -Encoding UTF8 -Force
    Write-RunningComponentsProof -Sha $ExpectedPreviousSha -ArtifactDigest 'restored-verified-snapshot'

    if (-not $SandboxMode) {
      Restart-Service HPManagementLiteApi -Force
      Start-Sleep -Seconds 3
    }

    if (-not (Test-ApplicationSmoke -ExpectedSha $ExpectedPreviousSha -MaxAttempts 10 -IsRollbackVerification)) {
      throw "Post-rollback smoke verification failed for restored SHA $ExpectedPreviousSha."
    }

    @{
      status             = $JournalSuccessStatus
      sha                = $ExpectedPreviousSha
      failed_sha         = $FailedSha
      snapshot_dir       = $SnapshotPath
      rolled_back_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $stateJournalFile -Encoding UTF8 -Force

    $duration = [int]((Get-Date) - $startTime).TotalMilliseconds
    Record-DeployResult -Status $ResultSuccessStatus -Sha $FailedSha -PreviousSha $ExpectedPreviousSha -Message $FailureReason -DurationMs $duration
    Write-DeployLog "Atomic rollback & post-rollback health verification succeeded (restored to $ExpectedPreviousSha)." 'WARN'
  } catch {
    $rbErr = $_.Exception.Message
    if ($rbErr -match '^STOP_NO_GO_INCOMPATIBLE_ROLLBACK:') {
      throw $rbErr
    }
    Write-DeployLog "CRITICAL: Rollback verification failed ($rbErr). Transitioning to MANUAL_INTERVENTION." 'ERROR'
    @{
      status                     = 'MANUAL_INTERVENTION'
      sha                        = $ExpectedPreviousSha
      failed_sha                 = $FailedSha
      snapshot_dir               = $SnapshotPath
      rollback_error             = $rbErr
      manual_intervention_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $stateJournalFile -Encoding UTF8 -Force

    $duration = [int]((Get-Date) - $startTime).TotalMilliseconds
    Record-DeployResult -Status 'ROLLBACK_FAILED_MANUAL_INTERVENTION' -Sha $FailedSha -PreviousSha $ExpectedPreviousSha -Message "Deploy failed ($FailureReason) AND rollback failed ($rbErr)" -DurationMs $duration
    throw "CRITICAL MANUAL INTERVENTION REQUIRED: Deployment of $FailedSha failed ($FailureReason) and rollback to $ExpectedPreviousSha failed verification ($rbErr)."
  }
}

Write-DeployLog "=== MANAGEMENT LITE: HARDENED SEMI-AUTO DEPLOY (CRYPTOGRAPHIC OWNER GATE) ==="
Write-DeployLog "Target Commit SHA : $normalizedSha (SandboxMode=$SandboxMode, RecoverInterrupted=$RecoverInterrupted)"

# 1. WORKFLOW TRIGGER & BYPASS PATH PROTECTION
if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_EVENT_NAME)) {
  if ($env:GITHUB_EVENT_NAME -ne 'workflow_dispatch') {
    Record-DeployResult -Status 'REJECTED_UNAPPROVED_TRIGGER_OR_WORKFLOW' -Sha $normalizedSha -Message "Event '$($env:GITHUB_EVENT_NAME)' is forbidden for deployment; only workflow_dispatch is allowed" -DurationMs 0
    throw "GATE REJECTED: Trigger event '$($env:GITHUB_EVENT_NAME)' is forbidden. Deployment requires workflow_dispatch."
  }
}

# 2. STRICT 40-CHAR SHA VALIDATION
if ($normalizedSha -notmatch '^[0-9a-f]{40}$') {
  Record-DeployResult -Status 'REJECTED_INVALID_SHA' -Sha $normalizedSha -Message 'CommitSha must be a full 40-character hexadecimal Git SHA' -DurationMs 0
  throw "GATE REJECTED: CommitSha '$CommitSha' must be a full 40-character hexadecimal Git SHA."
}

# 2B. OFF-SERVER KEY CUSTODY ENFORCEMENT (REJECT IF ANY PRIVATE KEY IS LEFT IN SERVER RELEASE-GATE, RUNNER, OR TEST-SECRETS)
function Test-HostPrivateKeyCustodyFile {
  param([System.IO.FileInfo]$CandidateFile)
  if ($null -eq $CandidateFile) { return $true }
  $fileName = [string]$CandidateFile.Name
  $fileExt = [string]$CandidateFile.Extension

  # 1. Explicit private key container extensions (.key, .pfx, .p12, .pkcs12, .jks, .keystore)
  if ($fileExt -match '^(?i)\.(key|pfx|p12|pkcs12|jks|keystore)$') {
    return $true
  }

  # 2. Standard .NET runtime assemblies (System.Private.*.dll / .pdb / .exe):
  #    Allow only if readable, non-empty, and confirmed not to contain PEM/JSON private key markers (fail-closed if unreadable or disguised key).
  if ($fileExt -match '^(?i)\.(dll|pdb|exe)$' -and $fileName -match '^(?i)System\.Private\.[A-Za-z0-9_.]+\.(dll|pdb|exe)$') {
    $stream = $null
    try {
      $stream = [IO.File]::Open($CandidateFile.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      $bufLen = [int][Math]::Min(4096, $stream.Length)
      if ($bufLen -le 0) {
        return $true
      }
      $buf = New-Object byte[] $bufLen
      $readBytes = $stream.Read($buf, 0, $bufLen)
      $headStr = [Text.Encoding]::ASCII.GetString($buf, 0, $readBytes)
      if ($headStr -match '(?i)(-----\s*BEGIN\s+([A-Z0-9\s]+)?PRIVATE\s+KEY|"private_key"\s*:)') {
        return $true
      }
      return $false
    } catch {
      return $true
    } finally {
      if ($null -ne $stream) { $stream.Dispose() }
    }
  }

  # 3. Explicit Owner signing key or SSH/TLS private key filenames
  if ($fileName -match '(?i)(owner[-_.]?(approval[-_.]?)?private|(^|[-_.])private[-_.]?key([-.]|$)|^id_(rsa|ed25519|ecdsa|dsa)(\.|$))') {
    if ($fileExt -ieq '.pub') { return $false }
    return $true
  }

  # 4. Standalone 'private' token in filename (excluding benign source/header/doc/compiled runtime files)
  if ($fileName -match '(?i)(^|[-_.])private([-.]|$)' -and $fileExt -notmatch '^(?i)\.(dll|pdb|exe|h|c|cpp|py|pyc|js|mjs|cjs|jsx|ts|tsx|md|html|doctree|png|svg|css)$') {
    return $true
  }

  # 5. PEM file content inspection (Fail-closed if unreadable, empty, private key, or unrecognized PEM header)
  if ($fileExt -ieq '.pem') {
    $pemRaw = $null
    try {
      $pemRaw = [IO.File]::ReadAllText($CandidateFile.FullName, [Text.Encoding]::UTF8)
    } catch {
      return $true
    }
    if ([string]::IsNullOrWhiteSpace($pemRaw)) {
      return $true
    }
    if ($pemRaw -match '(?i)(-----\s*BEGIN\s+([A-Z0-9\s]+)?PRIVATE\s+KEY|"private_key"\s*:)') {
      return $true
    }
    if ($pemRaw -notmatch '(?i)(-----\s*BEGIN\s+(PUBLIC\s+KEY|CERTIFICATE|TRUSTED\s+CERTIFICATE)\s*-----|^#\s*REVOKED\s+PUBLIC\s+KEY|^UNENROLLED\s*$)') {
      return $true
    }
  }

  return $false
}

$gateScanDirs = @(
  (Split-Path -Path $PolicyPath -Parent),
  (Split-Path -Path $ApprovalManifestPath -Parent),
  (Join-Path $ServerRoot 'runner'),
  (Join-Path $ServerRoot 'config\test-secrets'),
  (Join-Path $ServerRoot 'config\release-gate')
)
if (-not $SandboxMode) {
  $gateScanDirs += (Join-Path $ServerRoot 'config')
}
$gateScanDirs = @($gateScanDirs | Where-Object { $_ } | Select-Object -Unique)
foreach ($scanDir in $gateScanDirs) {
  if ($scanDir -and (Test-Path -LiteralPath $scanDir)) {
    $scanEnumErrors = $null
    $scannedFiles = @(Get-ChildItem -LiteralPath $scanDir -File -Recurse -ErrorAction SilentlyContinue -ErrorVariable scanEnumErrors)
    if ($scanEnumErrors -and $scanEnumErrors.Count -gt 0) {
      $errDetail = ($scanEnumErrors | ForEach-Object { $_.Exception.Message }) -join '; '
      Record-DeployResult -Status 'REJECTED_PRIVATE_KEY_EXPOSED_ON_HOST' -Sha $normalizedSha -Message "Fail-closed: Unable to verify host key custody state in '$scanDir' ($errDetail)" -DurationMs 0
      throw "GATE REJECTED: Fail-closed key custody check could not verify directory '$scanDir' ($errDetail)."
    }
    $suspectKeyFiles = @($scannedFiles | Where-Object { Test-HostPrivateKeyCustodyFile -CandidateFile $_ })
    if ($suspectKeyFiles.Count -gt 0) {
      $exposedNames = ($suspectKeyFiles | ForEach-Object { $_.Name }) -join ', '
      Record-DeployResult -Status 'REJECTED_PRIVATE_KEY_EXPOSED_ON_HOST' -Sha $normalizedSha -Message "Private key file detected in host gate/runner/test-secrets directory ($exposedNames)" -DurationMs 0
      throw "GATE REJECTED: Owner private key exposure detected on host ($exposedNames). Private signing key must never reside in release-gate, test-secrets, or runner directories."
    }
  }
}

# 3. DEDICATED INTERRUPTED DEPLOYMENT RECOVERY MODE (RESTORES PREVIOUS RELEASE ONLY — NEVER DEPLOYS FORWARD OR BYPASSES REPLAY WATERMARK)
if ($RecoverInterrupted) {
  $lockStreamRecover = $null
  try {
    $lockStreamRecover = [IO.File]::Open($lockFile, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  } catch {
    Record-DeployResult -Status 'REJECTED_CONCURRENT_LOCK' -Sha $normalizedSha -Message 'Concurrent deployment lock is held by another active process' -DurationMs 0
    throw 'GATE REJECTED: Concurrent deployment is already in progress (exclusive lock held).'
  }
  try {
    if (-not (Test-Path -LiteralPath $stateJournalFile)) {
      Record-DeployResult -Status 'REJECTED_NOT_INTERRUPTED' -Sha $normalizedSha -Message '-RecoverInterrupted invoked but no deployment-state.json exists' -DurationMs 0
      throw 'GATE REJECTED: -RecoverInterrupted is only valid when deployment-state.json is in IN_PROGRESS or ROLLING_BACK state.'
    }
    $journalRecover = Get-Content -LiteralPath $stateJournalFile -Raw | ConvertFrom-Json
    if ($journalRecover.status -eq 'STOP_NO_GO_INCOMPATIBLE_ROLLBACK') {
      Record-DeployResult -Status 'ROLLBACK_BLOCKED_INCOMPATIBLE_SCHEMA_OR_AUTH_POLICY' -Sha $normalizedSha -Message '-RecoverInterrupted blocked because journal is in STOP_NO_GO_INCOMPATIBLE_ROLLBACK state' -DurationMs 0
      throw 'STOP_NO_GO_INCOMPATIBLE_ROLLBACK: Cannot recover by rolling back to an incompatible pre-0023 snapshot. Deploy a signed 0023-compatible release instead.'
    }
    if ($journalRecover.status -notin @('IN_PROGRESS', 'ROLLING_BACK')) {
      Record-DeployResult -Status 'REJECTED_NOT_INTERRUPTED' -Sha $normalizedSha -Message "-RecoverInterrupted invoked when journal status is '$($journalRecover.status)' (must be IN_PROGRESS or ROLLING_BACK)" -DurationMs 0
      throw "GATE REJECTED: -RecoverInterrupted cannot be used when journal status is '$($journalRecover.status)'. Normal deployments must use a fresh sequence number."
    }
    $recPrevSha = if ($journalRecover.PSObject.Properties.Name -contains 'previous_sha') { [string]$journalRecover.previous_sha } else { '' }
    $recFailedSha = if ($journalRecover.PSObject.Properties.Name -contains 'sha') { [string]$journalRecover.sha } else { $normalizedSha }
    $recSnapDir = if ($journalRecover.PSObject.Properties.Name -contains 'snapshot_dir') { [string]$journalRecover.snapshot_dir } else { '' }

    Restore-VerifiedSnapshot -SnapshotPath $recSnapDir -ExpectedPreviousSha $recPrevSha.Trim().ToLowerInvariant() -FailedSha $recFailedSha.Trim().ToLowerInvariant() -JournalSuccessStatus 'RECOVERED_PREVIOUS' -ResultSuccessStatus 'RECOVERED_PREVIOUS' -FailureReason 'Recovered interrupted deployment back to verified pre-deploy snapshot'
    return
  } finally {
    if ($lockStreamRecover) { $lockStreamRecover.Dispose() }
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  }
}

# 3B. MANDATORY SIGNED ARTIFACT ARGUMENT CHECK (NO LOCAL REBUILD OR ARTIFACT BYPASS PERMITTED)
if ([string]::IsNullOrWhiteSpace($ArtifactPath) -or (-not (Test-Path -LiteralPath $ArtifactPath -PathType Leaf))) {
  Record-DeployResult -Status 'REJECTED_ARTIFACT_MISSING' -Sha $normalizedSha -Message "Mandatory pre-built release artifact is missing or not found ('$ArtifactPath')" -DurationMs 0
  throw "GATE REJECTED: Mandatory pre-built release artifact (-ArtifactPath) is missing or does not exist ('$ArtifactPath'). Local host builds are forbidden."
}
if ($normalizedArtifactSha -notmatch '^[0-9a-f]{64}$') {
  Record-DeployResult -Status 'REJECTED_ARTIFACT_CHECKSUM_MISMATCH' -Sha $normalizedSha -Message "Mandatory -ArtifactSha256 must be a 64-character lowercase hex SHA-256 digest ('$ArtifactSha256')" -DurationMs 0
  throw "GATE REJECTED: Mandatory -ArtifactSha256 must be a valid 64-character hexadecimal SHA-256 digest."
}

# 4. CRYPTOGRAPHIC ED25519 OWNER APPROVAL GATE
if (-not (Test-Path -LiteralPath $PolicyPath)) {
  Record-DeployResult -Status 'REJECTED_NO_POLICY' -Sha $normalizedSha -Message "Missing release-gate-policy.json at $PolicyPath" -DurationMs 0
  throw "GATE REJECTED: Release gate policy not found at '$PolicyPath'."
}
if (-not (Test-Path -LiteralPath $ApprovalManifestPath)) {
  Record-DeployResult -Status 'REJECTED_NO_MANIFEST' -Sha $normalizedSha -Message "Missing Owner approval manifest at $ApprovalManifestPath" -DurationMs 0
  throw "GATE REJECTED: Owner approval manifest not found at '$ApprovalManifestPath'."
}

$policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
$manifest = Get-Content -LiteralPath $ApprovalManifestPath -Raw | ConvertFrom-Json

if ($manifest.status -ne 'APPROVED' -or $manifest.signature_algorithm -ne 'Ed25519' -or [string]::IsNullOrWhiteSpace($manifest.signature_base64) -or [string]::IsNullOrWhiteSpace($manifest.payload_canonical_json)) {
  Record-DeployResult -Status 'REJECTED_INVALID_SIGNATURE' -Sha $normalizedSha -Message 'Manifest missing Ed25519 signature or canonical payload' -DurationMs 0
  throw 'GATE REJECTED: Manifest is missing Ed25519 cryptographic signature or canonical payload.'
}

# Verify public key fingerprint & Ed25519 signature over canonical payload
$jsVerify = @"
const crypto = require('node:crypto');
const fs = require('node:fs');
const policy = JSON.parse(fs.readFileSync(process.argv[1], 'utf8').replace(/^\uFEFF/, ''));
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const pubPem = policy.trusted_public_key_pem;
const expectedFp = policy.trusted_public_key_sha256;
const payloadStr = manifest.payload_canonical_json;
const sigB64 = manifest.signature_base64;
const actualFp = crypto.createHash('sha256').update(pubPem, 'utf8').digest('hex');
if (actualFp !== expectedFp) {
  process.stdout.write('KEY_FINGERPRINT_MISMATCH');
  process.exit(0);
}
try {
  const ok = crypto.verify(null, Buffer.from(payloadStr, 'utf8'), pubPem, Buffer.from(sigB64, 'base64'));
  process.stdout.write(ok ? 'VALID' : 'INVALID_SIG');
} catch (e) {
  process.stdout.write('INVALID_SIG');
}
"@
$sigOut = & $node -e $jsVerify $PolicyPath $ApprovalManifestPath
$sigCheck = if ($sigOut) { ($sigOut -join '').Trim() } else { 'INVALID_SIG' }
if ($sigCheck -ne 'VALID') {
  Record-DeployResult -Status 'REJECTED_INVALID_SIGNATURE' -Sha $normalizedSha -Message "Ed25519 signature verification failed ($sigCheck)" -DurationMs 0
  throw "GATE REJECTED: Ed25519 cryptographic signature verification failed ($sigCheck)."
}

# Ensure outer envelope fields match signed canonical payload (prevent envelope/payload split tampering)
$signedPayload = $manifest.payload_canonical_json | ConvertFrom-Json
$approvalMode = if ($signedPayload.PSObject.Properties.Name -contains 'approval_mode' -and -not [string]::IsNullOrWhiteSpace([string]$signedPayload.approval_mode)) {
  ([string]$signedPayload.approval_mode).Trim().ToUpperInvariant()
} else {
  'SINGLE_SHA'
}

$expectedRepo = if ($policy.PSObject.Properties.Name -contains 'repository') { [string]$policy.repository } else { 'truhoaiphuong03/management-lite' }
if ($signedPayload.repository -ne $expectedRepo) {
  Record-DeployResult -Status 'REJECTED_REPOSITORY_MISMATCH' -Sha $normalizedSha -Message "Signed repository '$($signedPayload.repository)' does not match policy '$expectedRepo'" -DurationMs 0
  throw "GATE REJECTED: Signed repository '$($signedPayload.repository)' does not match policy '$expectedRepo'."
}

$allowedApprovers = @($policy.allowed_approvers)
if ($allowedApprovers -notcontains $signedPayload.approved_by) {
  Record-DeployResult -Status 'REJECTED_UNAUTHORIZED_APPROVER' -Sha $normalizedSha -Message "Approver '$($signedPayload.approved_by)' is not authorized" -DurationMs 0
  throw "GATE REJECTED: Approver '$($signedPayload.approved_by)' is not in policy allowed_approvers."
}

$expiresUtc = [DateTimeOffset]::Parse($signedPayload.expires_at_utc).UtcDateTime
$nowCheckUtc = (Get-Date).ToUniversalTime()

if ($approvalMode -eq 'SCOPED_WINDOW') {
  if ($manifest.approval_mode -ne $signedPayload.approval_mode -or
      $manifest.baseline_sha -ne $signedPayload.baseline_sha -or
      $manifest.workflow_path -ne $signedPayload.workflow_path -or
      $manifest.source_branch -ne $signedPayload.source_branch -or
      [int]$manifest.max_deployments -ne [int]$signedPayload.max_deployments -or
      [int]$manifest.sequence -ne [int]$signedPayload.sequence -or
      $manifest.approved_by -ne $signedPayload.approved_by -or
      [bool]$manifest.allow_migration -ne [bool]$signedPayload.allow_migration -or
      [bool]$manifest.allow_controller_changes -ne [bool]$signedPayload.allow_controller_changes -or
      $manifest.expires_at_utc -ne $signedPayload.expires_at_utc) {
    Record-DeployResult -Status 'REJECTED_INVALID_SIGNATURE' -Sha $normalizedSha -Message 'Outer manifest fields tampered relative to signed canonical SCOPED_WINDOW payload' -DurationMs 0
    throw 'GATE REJECTED: Scoped manifest envelope fields do not match signed canonical payload.'
  }
  if ([string]$signedPayload.baseline_sha -notmatch '^[0-9a-f]{40}$' -or [int]$signedPayload.max_deployments -lt 1 -or [int]$signedPayload.max_deployments -gt 10) {
    Record-DeployResult -Status 'REJECTED_INVALID_SIGNATURE' -Sha $normalizedSha -Message 'Scoped payload is missing valid 40-char baseline_sha or max_deployments (must be 1..10)' -DurationMs 0
    throw 'GATE REJECTED: Scoped approval payload is missing valid 40-character baseline_sha or max_deployments (1..10).'
  }
  if ($nowCheckUtc -gt $expiresUtc -or ($expiresUtc - $nowCheckUtc).TotalDays -gt 7.1) {
    Record-DeployResult -Status 'REJECTED_EXPIRED_APPROVAL' -Sha $normalizedSha -Message "Owner scoped approval expired or exceeds 7d max TTL ($($signedPayload.expires_at_utc))" -DurationMs 0
    throw "GATE REJECTED: Owner scoped approval expired or exceeds 7d max TTL at $($signedPayload.expires_at_utc)."
  }
} else {
  if ($manifest.approved_sha -ne $signedPayload.approved_sha -or
      $manifest.artifact_sha256 -ne $signedPayload.artifact_sha256 -or
      $manifest.schema_sha256 -ne $signedPayload.schema_sha256 -or
      $manifest.ci_run_id -ne $signedPayload.ci_run_id -or
      [int]$manifest.ci_run_attempt -ne [int]$signedPayload.ci_run_attempt -or
      $manifest.ci_status -ne $signedPayload.ci_status -or
      $manifest.workflow_path -ne $signedPayload.workflow_path -or
      $manifest.source_branch -ne $signedPayload.source_branch -or
      [int]$manifest.sequence -ne [int]$signedPayload.sequence -or
      $manifest.approved_by -ne $signedPayload.approved_by -or
      [bool]$manifest.allow_migration -ne [bool]$signedPayload.allow_migration -or
      $manifest.expires_at_utc -ne $signedPayload.expires_at_utc) {
    Record-DeployResult -Status 'REJECTED_INVALID_SIGNATURE' -Sha $normalizedSha -Message 'Outer manifest fields tampered relative to signed canonical payload' -DurationMs 0
    throw 'GATE REJECTED: Manifest envelope fields do not match signed canonical payload.'
  }
  if ([string]$signedPayload.schema_sha256 -notmatch '^[0-9a-f]{64}$') {
    Record-DeployResult -Status 'REJECTED_SCHEMA_MIGRATION_MISMATCH' -Sha $normalizedSha -Message 'Signed payload is missing valid 64-char hex schema_sha256' -DurationMs 0
    throw 'GATE REJECTED: Signed approval payload is missing valid 64-character schema_sha256.'
  }
  if ($signedPayload.approved_sha.Trim().ToLowerInvariant() -ne $normalizedSha) {
    Record-DeployResult -Status 'REJECTED_UNAPPROVED_SHA' -Sha $normalizedSha -Message "Signed SHA ($($signedPayload.approved_sha)) does not match requested SHA ($normalizedSha)" -DurationMs 0
    throw "GATE REJECTED: Signed SHA '$($signedPayload.approved_sha)' does not match requested SHA '$normalizedSha'."
  }
  if ($nowCheckUtc -gt $expiresUtc -or ($expiresUtc - $nowCheckUtc).TotalHours -gt 24.1) {
    Record-DeployResult -Status 'REJECTED_EXPIRED_APPROVAL' -Sha $normalizedSha -Message "Owner approval expired or exceeds 24h max TTL ($($signedPayload.expires_at_utc))" -DurationMs 0
    throw "GATE REJECTED: Owner approval expired or exceeds 24h max TTL at $($signedPayload.expires_at_utc)."
  }
}

if ((-not $SkipMigration) -and (-not [bool]$signedPayload.allow_migration)) {
  Record-DeployResult -Status 'REJECTED_UNAPPROVED_MIGRATION' -Sha $normalizedSha -Message 'Migration requested but allow_migration is false in signed Owner manifest' -DurationMs 0
  throw 'GATE REJECTED: Migration requested (-SkipMigration:$false), but signed Owner manifest has allow_migration=false.'
}

# 5. MANDATORY CI STATUS, INDEPENDENT CI RECEIPT & LIVE GITHUB API VERIFICATION GATE
if ($approvalMode -ne 'SCOPED_WINDOW') {
  if ($signedPayload.ci_status -ne 'SUCCESS' -or $signedPayload.ci_run_id -ne $CiRunId.Trim()) {
    Record-DeployResult -Status 'REJECTED_CI_NOT_PASSED' -Sha $normalizedSha -Message "CI check failed or mismatched (signed status=$($signedPayload.ci_status), run_id=$($signedPayload.ci_run_id), requested=$CiRunId)" -DurationMs 0
    throw "GATE REJECTED: Exact-SHA CI has not passed (ci_status='$($signedPayload.ci_status)', ci_run_id='$($signedPayload.ci_run_id)')."
  }
}

$expectedWorkflowPath = [string]$signedPayload.workflow_path
$expectedSourceBranch = [string]$signedPayload.source_branch
$allowedWorkflows = if ($policy.PSObject.Properties.Name -contains 'allowed_workflow_paths' -and $null -ne $policy.allowed_workflow_paths) { @($policy.allowed_workflow_paths) } else { @('.github/workflows/deploy.yml') }
$allowedEvents = if ($policy.PSObject.Properties.Name -contains 'allowed_ci_events' -and $null -ne $policy.allowed_ci_events) { @($policy.allowed_ci_events) } else { @('workflow_dispatch') }
$policyBranch = if ($policy.PSObject.Properties.Name -contains 'allowed_source_branch' -and -not [string]::IsNullOrWhiteSpace([string]$policy.allowed_source_branch)) { [string]$policy.allowed_source_branch } else { 'main' }

# 5A. UNCONDITIONAL INDEPENDENT CI RECEIPT CHECK (CANNOT BE DISABLED BY POLICY OR CALLER)
$resolvedCiReceipt = $CiRunReceiptPath
if ([string]::IsNullOrWhiteSpace($resolvedCiReceipt)) {
  $gateDir = Split-Path -Path $PolicyPath -Parent
  $candidate1 = Join-Path $gateDir "ci-run-receipt-$normalizedSha.json"
  $candidate2 = Join-Path $gateDir 'ci-run-receipt.json'
  if (Test-Path -LiteralPath $candidate1) { $resolvedCiReceipt = $candidate1 }
  elseif (Test-Path -LiteralPath $candidate2) { $resolvedCiReceipt = $candidate2 }
}

if ([string]::IsNullOrWhiteSpace($resolvedCiReceipt) -or (-not (Test-Path -LiteralPath $resolvedCiReceipt -PathType Leaf))) {
  Record-DeployResult -Status 'REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED' -Sha $normalizedSha -Message 'Missing mandatory independent CI run receipt JSON' -DurationMs 0
  throw 'GATE REJECTED: Independent CI run receipt JSON is mandatory and missing.'
}

$ciReceipt = Get-Content -LiteralPath $resolvedCiReceipt -Raw | ConvertFrom-Json
$isSyntheticReceipt = (
  (($ciReceipt.PSObject.Properties.Name -contains 'synthetic_local') -and [bool]$ciReceipt.synthetic_local) -or
  (($ciReceipt.PSObject.Properties.Name -contains 'simulated') -and [bool]$ciReceipt.simulated) -or
  ((-not $SandboxMode) -and (
    (-not ($ciReceipt.PSObject.Properties.Name -contains 'generated_at_utc')) -or
    [string]::IsNullOrWhiteSpace([string]$ciReceipt.generated_at_utc)
  ))
)
if ($isSyntheticReceipt) {
  Record-DeployResult -Status 'REJECTED_SYNTHETIC_CI_RECEIPT' -Sha $normalizedSha -Message 'Self-created or synthetic CI receipt is forbidden' -DurationMs 0
  throw 'GATE REJECTED: Self-created or synthetic CI receipt is forbidden in production.'
}
if (($ciReceipt.PSObject.Properties.Name -contains 'workflow_run_url') -and (-not [string]::IsNullOrWhiteSpace([string]$ciReceipt.workflow_run_url))) {
  if (([string]$ciReceipt.workflow_run_url).Trim() -notmatch "^https://github\.com/$([regex]::Escape($expectedRepo))/actions/runs/\d+") {
    Record-DeployResult -Status 'REJECTED_SYNTHETIC_CI_RECEIPT' -Sha $normalizedSha -Message 'CI receipt workflow_run_url does not point to official GitHub Actions run' -DurationMs 0
    throw 'GATE REJECTED: CI receipt workflow_run_url does not point to official GitHub Actions run.'
  }
}

$receiptRunId = if ($ciReceipt.PSObject.Properties.Name -contains 'run_id') { [string]$ciReceipt.run_id } elseif ($ciReceipt.PSObject.Properties.Name -contains 'id') { [string]$ciReceipt.id } else { '' }
$receiptAttempt = if ($ciReceipt.PSObject.Properties.Name -contains 'run_attempt' -and $null -ne $ciReceipt.run_attempt) { [int]$ciReceipt.run_attempt } else { 0 }
$receiptSha = if ($ciReceipt.PSObject.Properties.Name -contains 'head_sha') { [string]$ciReceipt.head_sha } else { '' }
$receiptStatus = if ($ciReceipt.PSObject.Properties.Name -contains 'status') { [string]$ciReceipt.status } else { '' }
$receiptConclusion = if ($ciReceipt.PSObject.Properties.Name -contains 'conclusion') { [string]$ciReceipt.conclusion } else { '' }
$receiptEvent = if ($ciReceipt.PSObject.Properties.Name -contains 'event') { [string]$ciReceipt.event } else { '' }
$receiptRepo = if ($ciReceipt.PSObject.Properties.Name -contains 'repository') { [string]$ciReceipt.repository } else { '' }
$receiptBranch = if ($ciReceipt.PSObject.Properties.Name -contains 'head_branch' -and -not [string]::IsNullOrWhiteSpace([string]$ciReceipt.head_branch)) { [string]$ciReceipt.head_branch } else { '' }
$receiptWorkflow = if ($ciReceipt.PSObject.Properties.Name -contains 'workflow_path' -and -not [string]::IsNullOrWhiteSpace([string]$ciReceipt.workflow_path)) { [string]$ciReceipt.workflow_path } else { '' }
$receiptArtifactSha = if ($ciReceipt.PSObject.Properties.Name -contains 'artifact_sha256' -and -not [string]::IsNullOrWhiteSpace([string]$ciReceipt.artifact_sha256)) { [string]$ciReceipt.artifact_sha256 } else { '' }
$receiptSchemaSha = if ($ciReceipt.PSObject.Properties.Name -contains 'schema_sha256' -and -not [string]::IsNullOrWhiteSpace([string]$ciReceipt.schema_sha256)) { [string]$ciReceipt.schema_sha256 } else { '' }

$expectedRunAttempt = if ($approvalMode -eq 'SCOPED_WINDOW') { $receiptAttempt } else { [int]$signedPayload.ci_run_attempt }
$expectedArtifactSha = if ($approvalMode -eq 'SCOPED_WINDOW') { $normalizedArtifactSha } else { [string]$signedPayload.artifact_sha256.Trim().ToLowerInvariant() }
$expectedSchemaSha = if ($approvalMode -eq 'SCOPED_WINDOW') { $receiptSchemaSha.Trim().ToLowerInvariant() } else { [string]$signedPayload.schema_sha256.Trim().ToLowerInvariant() }

if ($receiptRunId.Trim() -ne $CiRunId.Trim() -or
    $receiptAttempt -lt 1 -or
    $receiptAttempt -ne $expectedRunAttempt -or
    $receiptSha.Trim().ToLowerInvariant() -ne $normalizedSha -or
    $receiptStatus.Trim().ToLowerInvariant() -ne 'completed' -or
    $receiptConclusion.Trim().ToLowerInvariant() -ne 'success' -or
    $receiptRepo.Trim() -ne $expectedRepo -or
    ($allowedEvents -notcontains $receiptEvent.Trim().ToLowerInvariant()) -or
    $receiptBranch.Trim() -ne $expectedSourceBranch -or
    $receiptBranch.Trim() -ne $policyBranch -or
    ($allowedWorkflows -notcontains $receiptWorkflow.Trim()) -or
    $receiptWorkflow.Trim() -ne $expectedWorkflowPath -or
    $receiptArtifactSha.Trim().ToLowerInvariant() -ne $expectedArtifactSha -or
    $expectedSchemaSha -notmatch '^[0-9a-f]{64}$' -or
    $receiptSchemaSha.Trim().ToLowerInvariant() -ne $expectedSchemaSha) {
  Record-DeployResult -Status 'REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED' -Sha $normalizedSha -Message "Independent CI receipt verification failed (run=$receiptRunId/$receiptAttempt, sha=$receiptSha, status=$receiptStatus, conclusion=$receiptConclusion, event=$receiptEvent, branch=$receiptBranch, workflow=$receiptWorkflow, artifact=$receiptArtifactSha, schema=$receiptSchemaSha)" -DurationMs 0
  throw "GATE REJECTED: Independent CI receipt verification failed (run=$receiptRunId/$receiptAttempt, sha=$receiptSha, status=$receiptStatus, conclusion=$receiptConclusion, event=$receiptEvent, branch=$receiptBranch, workflow=$receiptWorkflow)."
}
Write-DeployLog "Independent CI Run Receipt verified (RunId=$receiptRunId, Attempt=$receiptAttempt, HeadSha=$receiptSha, Branch=$receiptBranch, Workflow=$receiptWorkflow)."

# 5B. UNCONDITIONAL LIVE GITHUB ACTIONS RUN API VERIFICATION (NEVER SKIPPED, HARD-LOCKED TO OFFICIAL API IN PRODUCTION)
if (-not $SandboxMode) {
  if ((-not [string]::IsNullOrWhiteSpace($GitHubApiBaseUrl)) -and ($GitHubApiBaseUrl.Trim().TrimEnd('/').ToLowerInvariant() -ne 'https://api.github.com')) {
    Record-DeployResult -Status 'REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION' -Sha $normalizedSha -Message "Non-official GitHub API URL ('$GitHubApiBaseUrl') is forbidden when SandboxMode is disabled" -DurationMs 0
    throw "GATE REJECTED: Non-official GitHub API URL ('$GitHubApiBaseUrl') is forbidden in production. Only https://api.github.com is permitted."
  }
  if (($policy.PSObject.Properties.Name -contains 'github_api_base_url') -and (-not [string]::IsNullOrWhiteSpace([string]$policy.github_api_base_url))) {
    $policyApiNorm = ([string]$policy.github_api_base_url).Trim().TrimEnd('/').ToLowerInvariant()
    if ($policyApiNorm -ne 'https://api.github.com') {
      Record-DeployResult -Status 'REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION' -Sha $normalizedSha -Message "Policy github_api_base_url override ('$($policy.github_api_base_url)') is forbidden when SandboxMode is disabled" -DurationMs 0
      throw "GATE REJECTED: Policy github_api_base_url override ('$($policy.github_api_base_url)') is forbidden in production. Only https://api.github.com is permitted."
    }
  }
  $resolvedApiBase = 'https://api.github.com'
} else {
  $resolvedApiBase = $GitHubApiBaseUrl
  if ([string]::IsNullOrWhiteSpace($resolvedApiBase) -and ($policy.PSObject.Properties.Name -contains 'github_api_base_url')) {
    $resolvedApiBase = [string]$policy.github_api_base_url
  }
  if ([string]::IsNullOrWhiteSpace($resolvedApiBase)) {
    $resolvedApiBase = 'https://api.github.com'
  }
}

$runApiUrl = "$($resolvedApiBase.TrimEnd('/'))/repos/$expectedRepo/actions/runs/$($CiRunId.Trim())"
$apiHeaders = @{
  'Accept'               = 'application/vnd.github+json'
  'User-Agent'           = 'ManagementLite-HostReleaseController'
  'X-GitHub-Api-Version' = '2022-11-28'
}
$resolvedGhToken = $env:GITHUB_READONLY_TOKEN
if ([string]::IsNullOrWhiteSpace($resolvedGhToken)) {
  foreach ($dpapiCandidate in @(
    (Join-Path (Split-Path -Path $PolicyPath -Parent) 'github-pat.dpapi'),
    'C:\HoaiPhuong-Server\config\release-gate\github-pat.dpapi'
  )) {
    if ($dpapiCandidate -and (Test-Path -LiteralPath $dpapiCandidate -PathType Leaf)) {
      $bstr = [IntPtr]::Zero
      try {
        $cipherText = (Get-Content -LiteralPath $dpapiCandidate -Raw -ErrorAction SilentlyContinue).Trim()
        if (-not [string]::IsNullOrWhiteSpace($cipherText)) {
          $secStr = ConvertTo-SecureString -String $cipherText -ErrorAction Stop
          $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secStr)
          $candidateVal = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
          if (-not [string]::IsNullOrWhiteSpace($candidateVal)) {
            $resolvedGhToken = $candidateVal.Trim()
            break
          }
        }
      } catch {
        # Ignore decryption failure and continue fail-closed check
      } finally {
        if ($bstr -ne [IntPtr]::Zero) {
          [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
      }
    }
  }
}
if (-not [string]::IsNullOrWhiteSpace($resolvedGhToken)) {
  $apiHeaders['Authorization'] = "Bearer $resolvedGhToken"
}
try {
  $apiRun = Invoke-RestMethod -Uri $runApiUrl -Headers $apiHeaders -Method Get -TimeoutSec 10
} catch {
  Record-DeployResult -Status 'REJECTED_GITHUB_API_CI_VERIFICATION_FAILED' -Sha $normalizedSha -Message "Failed to query live GitHub Actions run API ($runApiUrl): $($_.Exception.Message)" -DurationMs 0
  throw "GATE REJECTED: Failed to verify CI run against live GitHub Actions API ($runApiUrl)."
}

$liveId = if ($apiRun.PSObject.Properties.Name -contains 'id') { [string]$apiRun.id } else { '' }
$liveAttempt = if ($apiRun.PSObject.Properties.Name -contains 'run_attempt' -and $null -ne $apiRun.run_attempt) { [int]$apiRun.run_attempt } else { 0 }
$liveSha = if ($apiRun.PSObject.Properties.Name -contains 'head_sha') { [string]$apiRun.head_sha } else { '' }
$liveStatus = if ($apiRun.PSObject.Properties.Name -contains 'status') { [string]$apiRun.status } else { '' }
$liveConclusion = if ($apiRun.PSObject.Properties.Name -contains 'conclusion') { [string]$apiRun.conclusion } else { '' }
$liveEvent = if ($apiRun.PSObject.Properties.Name -contains 'event') { [string]$apiRun.event } else { '' }
$liveBranch = if ($apiRun.PSObject.Properties.Name -contains 'head_branch' -and -not [string]::IsNullOrWhiteSpace([string]$apiRun.head_branch)) { [string]$apiRun.head_branch } else { '' }
$livePath = if ($apiRun.PSObject.Properties.Name -contains 'path' -and -not [string]::IsNullOrWhiteSpace([string]$apiRun.path)) { [string]$apiRun.path } else { '' }
$liveHtmlUrl = if ($apiRun.PSObject.Properties.Name -contains 'html_url' -and -not [string]::IsNullOrWhiteSpace([string]$apiRun.html_url)) { [string]$apiRun.html_url } else { '' }

if (-not $SandboxMode) {
  if ($liveHtmlUrl.Trim() -notmatch "^https://github\.com/$([regex]::Escape($expectedRepo))/actions/runs/\d+$") {
    Record-DeployResult -Status 'REJECTED_GITHUB_API_CI_VERIFICATION_FAILED' -Sha $normalizedSha -Message "Live GitHub API response html_url ('$liveHtmlUrl') does not match official GitHub Actions run URL" -DurationMs 0
    throw "GATE REJECTED: Live GitHub API response html_url ('$liveHtmlUrl') does not match official GitHub Actions run URL."
  }
}

if ($liveId.Trim() -ne $CiRunId.Trim() -or
    $liveAttempt -ne $expectedRunAttempt -or
    $liveSha.Trim().ToLowerInvariant() -ne $normalizedSha -or
    $liveStatus.Trim().ToLowerInvariant() -ne 'completed' -or
    $liveConclusion.Trim().ToLowerInvariant() -ne 'success' -or
    ($allowedEvents -notcontains $liveEvent.Trim().ToLowerInvariant()) -or
    $liveBranch.Trim() -ne $expectedSourceBranch -or
    $liveBranch.Trim() -ne $policyBranch -or
    ($allowedWorkflows -notcontains $livePath.Trim()) -or
    $livePath.Trim() -ne $expectedWorkflowPath) {
  Record-DeployResult -Status 'REJECTED_GITHUB_API_CI_VERIFICATION_FAILED' -Sha $normalizedSha -Message "Live GitHub API run verification failed (id=$liveId/$liveAttempt, sha=$liveSha, status=$liveStatus, conclusion=$liveConclusion, event=$liveEvent, branch=$liveBranch, path=$livePath)" -DurationMs 0
  throw "GATE REJECTED: Live GitHub Actions API run verification failed (id=$liveId/$liveAttempt, sha=$liveSha, status=$liveStatus, conclusion=$liveConclusion, event=$liveEvent, branch=$liveBranch, path=$livePath)."
}
Write-DeployLog "Live GitHub Actions API Run verified (RunId=$liveId, Attempt=$liveAttempt, HeadSha=$liveSha, Branch=$liveBranch, Path=$livePath, Event=$liveEvent)."

# 6. UNCONDITIONAL ANTI-REPLAY & SCOPED QUOTA WATERMARK GATE
$lastSequence = 0
$wmScopedUsed = 0
$wmDeployedRuns = @()
if (Test-Path -LiteralPath $watermarkFile) {
  $wmObj = Get-Content -LiteralPath $watermarkFile -Raw | ConvertFrom-Json
  $lastSequence = [int]$wmObj.last_sequence
  if (($wmObj.PSObject.Properties.Name -contains 'scoped_deployments_used') -and ($null -ne $wmObj.scoped_deployments_used) -and ([int]$wmObj.last_sequence -eq [int]$signedPayload.sequence)) {
    $wmScopedUsed = [int]$wmObj.scoped_deployments_used
  }
  if (($wmObj.PSObject.Properties.Name -contains 'deployed_runs') -and ($null -ne $wmObj.deployed_runs) -and ([int]$wmObj.last_sequence -eq [int]$signedPayload.sequence)) {
    $wmDeployedRuns = @($wmObj.deployed_runs | ForEach-Object { [string]$_ })
  }
}
$currentRunKey = "${normalizedSha}:$($CiRunId.Trim())"
if ($approvalMode -eq 'SCOPED_WINDOW') {
  if ([int]$signedPayload.sequence -lt $lastSequence) {
    Record-DeployResult -Status 'REJECTED_APPROVAL_REPLAY' -Sha $normalizedSha -Message "Scoped approval sequence $($signedPayload.sequence) < watermark $lastSequence" -DurationMs 0
    throw "GATE REJECTED: Superseded scoped approval sequence ($($signedPayload.sequence) < watermark $lastSequence)."
  }
  if ($wmDeployedRuns -contains $currentRunKey) {
    Record-DeployResult -Status 'REJECTED_APPROVAL_REPLAY' -Sha $normalizedSha -Message "CI run $currentRunKey was already deployed under scoped sequence $($signedPayload.sequence)" -DurationMs 0
    throw "GATE REJECTED: Approval replay detected ($currentRunKey already deployed)."
  }
  if ($wmScopedUsed -ge [int]$signedPayload.max_deployments) {
    Record-DeployResult -Status 'REJECTED_SCOPE_QUOTA_EXCEEDED' -Sha $normalizedSha -Message "Scoped approval quota exceeded ($wmScopedUsed / $($signedPayload.max_deployments))" -DurationMs 0
    throw "GATE REJECTED: Scoped approval deployment quota ($($signedPayload.max_deployments)) exceeded."
  }
} else {
  if ([int]$signedPayload.sequence -le $lastSequence) {
    Record-DeployResult -Status 'REJECTED_APPROVAL_REPLAY' -Sha $normalizedSha -Message "Approval sequence $($signedPayload.sequence) <= watermark $lastSequence" -DurationMs 0
    throw "GATE REJECTED: Approval replay detected (sequence $($signedPayload.sequence) <= watermark $lastSequence)."
  }
}

Write-DeployLog "Cryptographic Ed25519 Owner Approval Gate PASSED (Mode=$approvalMode, Seq=$($signedPayload.sequence), ApprovedBy=$($signedPayload.approved_by))."

# 7. EXCLUSIVE OS FILE HANDLE MUTEX LOCK
$lockStream = $null
try {
  $lockStream = [IO.File]::Open($lockFile, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $lockBytes = [Text.Encoding]::UTF8.GetBytes((@{ pid = $PID; started_at = (Get-Date -Format o); sha = $normalizedSha } | ConvertTo-Json -Compress))
  $lockStream.SetLength(0)
  $lockStream.Write($lockBytes, 0, $lockBytes.Length)
  $lockStream.Flush($true)
} catch {
  Record-DeployResult -Status 'REJECTED_CONCURRENT_LOCK' -Sha $normalizedSha -Message 'Concurrent deployment lock is held by another active process' -DurationMs 0
  throw 'GATE REJECTED: Concurrent deployment is already in progress (exclusive lock held).'
}

$snapshotDir = $null
$stagingExtractDir = $null
$previousGitSha = ''
$previousLiveSha = ''
$switchStarted = $false

try {
  # 8. INTERRUPTED DEPLOYMENT JOURNAL CHECK
  if (Test-Path -LiteralPath $stateJournalFile) {
    $journalState = Get-Content -LiteralPath $stateJournalFile -Raw | ConvertFrom-Json
    if ($journalState.status -in @('IN_PROGRESS', 'ROLLING_BACK', 'MANUAL_INTERVENTION')) {
      Record-DeployResult -Status 'REJECTED_INTERRUPTED_STATE_REQUIRES_RECOVERY' -Sha $normalizedSha -Message "Previous deployment requires recovery or operator intervention (status=$($journalState.status))" -DurationMs 0
      throw "GATE REJECTED: Deployment state '$($journalState.status)' detected. Run with -RecoverInterrupted or perform operator recovery before retrying."
    }
    if ($journalState.status -eq 'STOP_NO_GO_INCOMPATIBLE_ROLLBACK' -and (-not $Force)) {
      Record-DeployResult -Status 'REJECTED_STOP_NO_GO_REQUIRES_FORWARD_RECOVERY' -Sha $normalizedSha -Message 'System is in STOP_NO_GO_INCOMPATIBLE_ROLLBACK state; forward recovery requires explicit -Force with a signed 0023-compatible bundle' -DurationMs 0
      throw 'GATE REJECTED: Deployment state STOP_NO_GO_INCOMPATIBLE_ROLLBACK detected. Code-only rollback is blocked; pass -Force with a newly signed schema/auth-compatible release bundle for safe forward recovery.'
    }
  }

  $previousGitSha = (git -c safe.directory=* -C $TargetDir rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
  if (Test-Path -LiteralPath $currentShaFile) {
    $previousLiveSha = (Get-Content -LiteralPath $currentShaFile -Raw).Trim().ToLowerInvariant()
  } else {
    $previousLiveSha = $previousGitSha
  }

  # 9. DUPLICATE DEPLOY DETECTION
  if (-not $Force -and $previousGitSha -eq $normalizedSha -and ($previousLiveSha -eq $normalizedSha -or $normalizedSha.StartsWith($previousLiveSha))) {
    Write-DeployLog "Commit SHA $normalizedSha is already live ($previousGitSha). Skipping (use -Force to re-deploy)." 'INFO'
    $duration = [int]((Get-Date) - $startTime).TotalMilliseconds
    Record-DeployResult -Status 'SKIPPED' -Sha $normalizedSha -PreviousSha $previousGitSha -Message 'Already live on server' -DurationMs $duration
    return
  }

  # 9B. SCOPED WINDOW LINEAGE & PROTECTED PATH BOUNDARY CHECK
  if ($approvalMode -eq 'SCOPED_WINDOW') {
    $baselineShaNorm = [string]$signedPayload.baseline_sha.Trim().ToLowerInvariant()
    $prevEapScope = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      git -c safe.directory=* -C $TargetDir cat-file -e "$normalizedSha^{commit}" 2>$null
      if ($LASTEXITCODE -ne 0) {
        git -c safe.directory=* -C $TargetDir fetch --quiet origin --all --tags --prune 2>$null
        git -c safe.directory=* -C $TargetDir fetch --quiet origin $normalizedSha 2>$null
      }
      git -c safe.directory=* -C $TargetDir merge-base --is-ancestor $baselineShaNorm $normalizedSha 2>$null
      $isAncestorExit = $LASTEXITCODE
      $diffPaths = @(git -c safe.directory=* -C $TargetDir diff --name-only "$baselineShaNorm..$normalizedSha" 2>$null | ForEach-Object { $_.Trim().Replace('\', '/') } | Where-Object { $_ })
    } finally {
      $ErrorActionPreference = $prevEapScope
    }
    if ($isAncestorExit -ne 0) {
      Record-DeployResult -Status 'REJECTED_OUT_OF_SCOPE_LINEAGE' -Sha $normalizedSha -Message "Commit $normalizedSha is not a descendant of approved baseline $baselineShaNorm" -DurationMs 0
      throw "GATE REJECTED: Commit $normalizedSha is not a descendant of Owner-approved baseline $baselineShaNorm."
    }
    if (-not [bool]$signedPayload.allow_controller_changes) {
      $protectedTouched = @($diffPaths | Where-Object { $_ -match '^(scripts/deployment/|\.github/workflows/)' })
      if ($protectedTouched.Count -gt 0) {
        $touchedStr = $protectedTouched -join ', '
        Record-DeployResult -Status 'REJECTED_OUT_OF_SCOPE_PATH_MODIFICATION' -Sha $normalizedSha -Message "Scoped release modified protected controller/workflow paths ($touchedStr)" -DurationMs 0
        throw "GATE REJECTED: Scoped release cannot modify protected controller or workflow files ($touchedStr) without explicit Owner approval."
      }
    }
    if (-not [bool]$signedPayload.allow_migration) {
      $migrationTouched = @($diffPaths | Where-Object { $_ -match '^(database/migrations/|packages/db/migrations/|apps/api/src/database/migrations/)' })
      if ($migrationTouched.Count -gt 0) {
        $migStr = $migrationTouched -join ', '
        Record-DeployResult -Status 'REJECTED_UNAPPROVED_MIGRATION' -Sha $normalizedSha -Message "Scoped release modified database migrations ($migStr) while allow_migration=false" -DurationMs 0
        throw "GATE REJECTED: Scoped release cannot add or modify database migrations ($migStr) when allow_migration is false."
      }
    }
    Write-DeployLog "Scoped release lineage & path boundary verified (Descendant of $baselineShaNorm, Quota=$($wmScopedUsed + 1)/$($signedPayload.max_deployments), AllowMigration=$($signedPayload.allow_migration))."
  }

  # 10. MANDATORY ARTIFACT INTEGRITY, PROVENANCE, BUILD READINESS, SCHEMA PREFLIGHT & PER-FILE SHA-256 VERIFICATION (BEFORE ANY MUTATION)
  $verifiedArtifactDigest = $expectedArtifactSha
  $actualArchiveHash = (Get-FileHash -LiteralPath $ArtifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualArchiveHash -ne $normalizedArtifactSha -or $actualArchiveHash -ne $verifiedArtifactDigest) {
    Record-DeployResult -Status 'REJECTED_ARTIFACT_CHECKSUM_MISMATCH' -Sha $normalizedSha -Message "Archive SHA-256 ($actualArchiveHash) does not match requested ($normalizedArtifactSha) or verified ($verifiedArtifactDigest)" -DurationMs 0
    throw "GATE REJECTED: Artifact SHA-256 mismatch (actual=$actualArchiveHash, expected=$verifiedArtifactDigest)."
  }

  $sidecarShaPath = "$ArtifactPath.sha256"
  if (Test-Path -LiteralPath $sidecarShaPath -PathType Leaf) {
    $sidecarHash = ((Get-Content -LiteralPath $sidecarShaPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    if ($sidecarHash -ne $actualArchiveHash) {
      Record-DeployResult -Status 'REJECTED_ARTIFACT_CHECKSUM_MISMATCH' -Sha $normalizedSha -Message "Sidecar .sha256 ($sidecarHash) does not match archive hash ($actualArchiveHash)" -DurationMs 0
      throw "GATE REJECTED: Sidecar .sha256 digest ($sidecarHash) does not match archive ($actualArchiveHash)."
    }
  }

  $sidecarProvPath = "$ArtifactPath.provenance.json"
  if (Test-Path -LiteralPath $sidecarProvPath -PathType Leaf) {
    $sidecarProv = Get-Content -LiteralPath $sidecarProvPath -Raw | ConvertFrom-Json
    $provCommitSha = if (($sidecarProv.PSObject.Properties.Name -contains 'commitSha') -and $sidecarProv.commitSha) { [string]$sidecarProv.commitSha } elseif (($sidecarProv.PSObject.Properties.Name -contains 'sha') -and $sidecarProv.sha) { [string]$sidecarProv.sha } else { '' }
    if ($sidecarProv.sha256.Trim().ToLowerInvariant() -ne $actualArchiveHash -or
        $provCommitSha.Trim().ToLowerInvariant() -ne $normalizedSha -or
        $sidecarProv.schemaIdentity.Trim().ToLowerInvariant() -ne $expectedSchemaSha) {
      Record-DeployResult -Status 'REJECTED_ARTIFACT_CHECKSUM_MISMATCH' -Sha $normalizedSha -Message 'Sidecar .provenance.json sha256, commitSha, or schemaIdentity mismatch' -DurationMs 0
      throw 'GATE REJECTED: Sidecar .provenance.json does not match archive SHA-256, CommitSha, or verified schema_sha256.'
    }
  }

  $stagingExtractDir = Join-Path ([IO.Path]::GetTempPath()) ('ml-artifact-verify-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $stagingExtractDir -Force | Out-Null

  function Assert-SafeArchiveEntryPath {
    param([string]$RawEntryName, [Collections.Generic.HashSet[string]]$SeenSet)
    $trimmed = $RawEntryName.Replace('\', '/').TrimEnd('/')
    if ([string]::IsNullOrWhiteSpace($trimmed)) { return }
    if ($RawEntryName.Contains('\') -or $trimmed.Contains(':') -or $trimmed.StartsWith('/') -or $trimmed.Contains([char]0)) {
      Record-DeployResult -Status 'REJECTED_UNSAFE_ARCHIVE_ENTRY' -Sha $normalizedSha -Message "Unsafe archive path or NTFS ADS rejected: $RawEntryName" -DurationMs 0
      throw "GATE REJECTED: Unsafe archive entry path (traversal/ADS/absolute): $RawEntryName"
    }
    if (-not $SeenSet.Add($trimmed)) {
      Record-DeployResult -Status 'REJECTED_UNSAFE_ARCHIVE_ENTRY' -Sha $normalizedSha -Message "Duplicate archive entry path rejected: $trimmed" -DurationMs 0
      throw "GATE REJECTED: Duplicate archive entry path: $trimmed"
    }
    foreach ($part in $trimmed.Split('/')) {
      if ([string]::IsNullOrWhiteSpace($part) -or $part -in @('.', '..') -or $part -match '[. ]$|[<>"|?*\x00-\x1f]' -or $part -match '^(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') {
        Record-DeployResult -Status 'REJECTED_UNSAFE_ARCHIVE_ENTRY' -Sha $normalizedSha -Message "Unsafe path segment or Windows device name in archive: $RawEntryName" -DurationMs 0
        throw "GATE REJECTED: Unsafe path segment or Windows reserved device name in archive: $RawEntryName"
      }
      if ($part -match '^(?i)\.env(?:\.|$)|^(?i)(secrets?|uploads?|backups?|logs?|\.git)$|(?i)\.(dump|pem|key|pfx|p12|wfw)$|^(?i)runtime-private\.json$') {
        Record-DeployResult -Status 'REJECTED_FORBIDDEN_FILE_IN_ARTIFACT' -Sha $normalizedSha -Message "Forbidden secret/dump entry in archive pre-scan: $RawEntryName" -DurationMs 0
        throw "GATE REJECTED: Forbidden secret/dump entry detected during archive pre-scan: $RawEntryName"
      }
    }
  }

  if ($ArtifactPath.EndsWith('.tar.gz')) {
    $jsTarHeaderCheck = @"
const fs = require('node:fs');
const zlib = require('node:zlib');
const file = process.argv[1];
const raw = zlib.gunzipSync(fs.readFileSync(file));
let offset = 0;
let count = 0;
let totalBytes = 0;
while (offset + 512 <= raw.length) {
  const block = raw.subarray(offset, offset + 512);
  let allZero = true;
  for (let i = 0; i < 512; i++) {
    if (block[i] !== 0) { allZero = false; break; }
  }
  if (allZero) break;
  const name = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  const prefix = block.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
  const fullName = prefix ? (prefix + '/' + name) : name;
  const sizeOctal = block.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
  const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
  const typeflag = block[156] === 0 ? '0' : String.fromCharCode(block[156]);
  const linkname = block.subarray(157, 257).toString('utf8').replace(/\0.*$/, '');
  if (typeflag !== '0' && typeflag !== '5') {
    process.stdout.write('UNSAFE_TAR_TYPE:' + typeflag + ':' + fullName + '->' + linkname);
    process.exit(0);
  }
  if (linkname.length > 0) {
    process.stdout.write('UNSAFE_TAR_LINKNAME:' + fullName + '->' + linkname);
    process.exit(0);
  }
  count++;
  totalBytes += size;
  if (count > 30000 || size > 256 * 1024 * 1024 || totalBytes > 1024 * 1024 * 1024) {
    process.stdout.write('QUOTA_EXCEEDED:' + fullName);
    process.exit(0);
  }
  const blocks = Math.ceil(size / 512);
  offset += 512 + blocks * 512;
}
process.stdout.write('OK:' + count);
"@
    $tarHeaderStatus = ((& $node -e $jsTarHeaderCheck $ArtifactPath) -join '').Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($tarHeaderStatus)) {
      Record-DeployResult -Status 'REJECTED_ARTIFACT_CORRUPT' -Sha $normalizedSha -Message 'Failed to parse .tar.gz headers before extraction' -DurationMs 0
      throw 'GATE REJECTED: Corrupt .tar.gz archive.'
    }
    if ($tarHeaderStatus.StartsWith('UNSAFE_TAR_TYPE:') -or $tarHeaderStatus.StartsWith('UNSAFE_TAR_LINKNAME:') -or $tarHeaderStatus.StartsWith('QUOTA_EXCEEDED:')) {
      Record-DeployResult -Status 'REJECTED_UNSAFE_ARCHIVE_ENTRY' -Sha $normalizedSha -Message "Unsafe TAR header entry rejected before extraction ($tarHeaderStatus)" -DurationMs 0
      throw "GATE REJECTED: Unsafe TAR symlink/hardlink/special entry rejected pre-extraction ($tarHeaderStatus)."
    }

    $tarVerboseEntries = @(tar -tvzf $ArtifactPath 2>$null)
    foreach ($tv in $tarVerboseEntries) {
      if ($tv -match '^[lhcbps]' -or $tv -match '\s->\s' -or $tv -match '\slink to\s') {
        Record-DeployResult -Status 'REJECTED_UNSAFE_ARCHIVE_ENTRY' -Sha $normalizedSha -Message "Symlink/hardlink detected in tar -tvzf pre-scan: $tv" -DurationMs 0
        throw "GATE REJECTED: TAR symlink or hardlink detected pre-extraction: $tv"
      }
    }

    $tarEntries = @(tar -tzf $ArtifactPath 2>$null)
    if ($LASTEXITCODE -ne 0 -or $tarEntries.Count -eq 0 -or $tarEntries.Count -gt 30000) {
      Record-DeployResult -Status 'REJECTED_ARTIFACT_CORRUPT' -Sha $normalizedSha -Message 'Failed to list or validate .tar.gz archive entries before extraction' -DurationMs 0
      throw 'GATE REJECTED: Corrupt or oversized .tar.gz archive.'
    }
    $seenTar = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($te in $tarEntries) {
      $cleanTe = ($te -replace '^\./', '')
      if (-not [string]::IsNullOrWhiteSpace($cleanTe) -and -not $cleanTe.EndsWith('/')) {
        Assert-SafeArchiveEntryPath -RawEntryName $cleanTe -SeenSet $seenTar
      }
    }
    tar -xzf $ArtifactPath -C $stagingExtractDir
    if ($LASTEXITCODE -ne 0) {
      Record-DeployResult -Status 'REJECTED_ARTIFACT_CORRUPT' -Sha $normalizedSha -Message 'Failed to extract .tar.gz artifact' -DurationMs 0
      throw 'GATE REJECTED: Failed to extract .tar.gz release artifact.'
    }
  } elseif ($ArtifactPath.EndsWith('.zip')) {
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $zipArchive = [IO.Compression.ZipFile]::OpenRead($ArtifactPath)
    try {
      if ($zipArchive.Entries.Count -eq 0 -or $zipArchive.Entries.Count -gt 30000) {
        Record-DeployResult -Status 'REJECTED_UNSAFE_ARCHIVE_ENTRY' -Sha $normalizedSha -Message 'ZIP entry count out of bounds' -DurationMs 0
        throw 'GATE REJECTED: ZIP archive entry count out of safe bounds.'
      }
      $seenZip = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
      $totalUncompressed = [long]0
      foreach ($ze in $zipArchive.Entries) {
        if (-not $ze.FullName.EndsWith('/')) {
          Assert-SafeArchiveEntryPath -RawEntryName $ze.FullName -SeenSet $seenZip
        }
        $attrKind = ([uint32]$ze.ExternalAttributes -shr 16) -band 0xF000
        if ($attrKind -eq 0xA000 -or ($ze.ExternalAttributes -band 0x400)) {
          Record-DeployResult -Status 'REJECTED_UNSAFE_ARCHIVE_ENTRY' -Sha $normalizedSha -Message "Symlink/reparse entry rejected in ZIP: $($ze.FullName)" -DurationMs 0
          throw "GATE REJECTED: Symlink or reparse point entry in ZIP archive: $($ze.FullName)"
        }
        $totalUncompressed += $ze.Length
        if ($ze.Length -gt 256MB -or $totalUncompressed -gt 1GB -or ($ze.Length -gt 1MB -and ($ze.Length / [Math]::Max(1, $ze.CompressedLength)) -gt 300)) {
          Record-DeployResult -Status 'REJECTED_UNSAFE_ARCHIVE_ENTRY' -Sha $normalizedSha -Message "ZIP quota or compression ratio exceeded: $($ze.FullName)" -DurationMs 0
          throw "GATE REJECTED: ZIP archive quota or compression ratio exceeded: $($ze.FullName)"
        }
      }
    } finally {
      $zipArchive.Dispose()
    }
    [IO.Compression.ZipFile]::ExtractToDirectory($ArtifactPath, $stagingExtractDir)
  } else {
    Record-DeployResult -Status 'REJECTED_ARTIFACT_CORRUPT' -Sha $normalizedSha -Message "Unsupported artifact format: $ArtifactPath" -DurationMs 0
    throw "GATE REJECTED: Unsupported artifact format: $ArtifactPath"
  }

  # Verify post-extraction that zero items are ReparsePoints (symlinks/junctions) or escape stagingExtractDir
  $stageRootPrefix = [IO.Path]::GetFullPath($stagingExtractDir) + [IO.Path]::DirectorySeparatorChar
  $allExtractedItems = @(Get-ChildItem -LiteralPath $stagingExtractDir -Recurse -Force)
  foreach ($item in $allExtractedItems) {
    $resolvedItemPath = [IO.Path]::GetFullPath($item.FullName)
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (-not $resolvedItemPath.StartsWith($stageRootPrefix, [StringComparison]::OrdinalIgnoreCase))) {
      Record-DeployResult -Status 'REJECTED_UNSAFE_ARCHIVE_ENTRY' -Sha $normalizedSha -Message "Extracted item is a ReparsePoint or escapes staging root: $($item.FullName)" -DurationMs 0
      throw "GATE REJECTED: Extracted item is a ReparsePoint or escapes staging directory: $($item.FullName)"
    }
  }

  # Scan all unpacked files for forbidden files (.env, .pem, .key, .dump, or .sql outside migrations/)
  $allExtractedFiles = @(Get-ChildItem -LiteralPath $stagingExtractDir -Recurse -File)
  foreach ($ef in $allExtractedFiles) {
    $relName = $ef.FullName.Substring($stagingExtractDir.Length).TrimStart('\', '/').Replace('\', '/')
    if ($relName -match '(^|/)\.env($|\.)|\.(pem|key|pfx|p12|dump)$' -or ($relName -match '\.sql$' -and $relName -notmatch '^migrations/')) {
      Record-DeployResult -Status 'REJECTED_FORBIDDEN_FILE_IN_ARTIFACT' -Sha $normalizedSha -Message "Forbidden file in artifact: $relName" -DurationMs 0
      throw "GATE REJECTED: Forbidden secret/dump file detected in artifact: $relName"
    }
  }

  $bundleManifestPath = Join-Path $stagingExtractDir 'manifest.json'
  if (-not (Test-Path -LiteralPath $bundleManifestPath -PathType Leaf)) {
    Record-DeployResult -Status 'REJECTED_ARTIFACT_FILE_TAMPERED' -Sha $normalizedSha -Message 'manifest.json missing from artifact bundle' -DurationMs 0
    throw 'GATE REJECTED: manifest.json missing inside artifact bundle.'
  }
  $bundleManifest = Get-Content -LiteralPath $bundleManifestPath -Raw | ConvertFrom-Json
  if ($bundleManifest.sha.Trim().ToLowerInvariant() -ne $normalizedSha) {
    Record-DeployResult -Status 'REJECTED_ARTIFACT_FILE_TAMPERED' -Sha $normalizedSha -Message "manifest.json SHA ($($bundleManifest.sha)) != $normalizedSha" -DurationMs 0
    throw "GATE REJECTED: Bundle manifest.json SHA ($($bundleManifest.sha)) does not match target SHA ($normalizedSha)."
  }

  $nonManifestCount = @($allExtractedFiles | Where-Object { $_.FullName -ne $bundleManifestPath }).Count
  if ($nonManifestCount -ne @($bundleManifest.files).Count) {
    Record-DeployResult -Status 'REJECTED_ARTIFACT_FILE_TAMPERED' -Sha $normalizedSha -Message "Unpacked file count ($nonManifestCount) != manifest file count ($(@($bundleManifest.files).Count))" -DurationMs 0
    throw 'GATE REJECTED: Unpacked file inventory count does not match manifest.json.'
  }

  foreach ($mf in $bundleManifest.files) {
    $fp = [IO.Path]::GetFullPath((Join-Path $stagingExtractDir $mf.path))
    if (-not $fp.StartsWith($stagingExtractDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $fp -PathType Leaf)) {
      Record-DeployResult -Status 'REJECTED_ARTIFACT_FILE_TAMPERED' -Sha $normalizedSha -Message "Missing or invalid file path in manifest: $($mf.path)" -DurationMs 0
      throw "GATE REJECTED: Missing or unsafe file path in manifest: $($mf.path)"
    }
    $fh = (Get-FileHash -LiteralPath $fp -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($fh -ne $mf.sha256.ToLowerInvariant()) {
      Record-DeployResult -Status 'REJECTED_ARTIFACT_FILE_TAMPERED' -Sha $normalizedSha -Message "File checksum mismatch in artifact: $($mf.path)" -DurationMs 0
      throw "GATE REJECTED: Post-CI artifact file tampering detected on $($mf.path)."
    }
  }

  # 10A. CANDIDATE BUILD READINESS & AUTH POLICY VERIFICATION (BEFORE MIGRATION OR CUTOVER)
  foreach ($reqEntry in @('dist/apps/api/src/main.js', 'dist/apps/api/src/auth/service.js', 'dist/packages/database/src/migrator.js', 'dist/packages/database/src/migrations/catalog.js', 'dist/release-version.json', 'web/index.html', 'web/release-version.json', 'package.json')) {
    $reqFullPath = Join-Path $stagingExtractDir $reqEntry
    if (-not (Test-Path -LiteralPath $reqFullPath -PathType Leaf) -or (Get-Item -LiteralPath $reqFullPath).Length -eq 0) {
      Record-DeployResult -Status 'REJECTED_BUILD_NOT_READY' -Sha $normalizedSha -Message "Candidate build is not ready: missing or empty required file '$reqEntry'" -DurationMs 0
      throw "GATE REJECTED: Candidate build is not ready; missing or empty required file '$reqEntry'."
    }
  }
  $bundledApiVer = Get-Content -LiteralPath (Join-Path $stagingExtractDir 'dist/release-version.json') -Raw | ConvertFrom-Json
  $bundledWebVer = Get-Content -LiteralPath (Join-Path $stagingExtractDir 'web/release-version.json') -Raw | ConvertFrom-Json
  if ($bundledApiVer.sha.Trim().ToLowerInvariant() -ne $normalizedSha -or $bundledWebVer.sha.Trim().ToLowerInvariant() -ne $normalizedSha) {
    Record-DeployResult -Status 'REJECTED_ARTIFACT_FILE_TAMPERED' -Sha $normalizedSha -Message 'Bundled release-version.json SHA mismatch' -DurationMs 0
    throw 'GATE REJECTED: Bundled dist/release-version.json or web/release-version.json SHA does not match target SHA.'
  }

  # Recompute normalized SQL checksums from unpacked migrations/*.sql and verify 1:1 against manifest.migrations, manifest.schemaIdentity, signed schema_sha256, and CI receipt schema_sha256
  if (-not ($bundleManifest.PSObject.Properties.Name -contains 'migrations') -or $null -eq $bundleManifest.migrations -or @($bundleManifest.migrations).Count -eq 0 -or
      -not ($bundleManifest.PSObject.Properties.Name -contains 'schemaIdentity') -or [string]$bundleManifest.schemaIdentity -notmatch '^[0-9a-f]{64}$') {
    Record-DeployResult -Status 'REJECTED_SCHEMA_MIGRATION_MISMATCH' -Sha $normalizedSha -Message 'Bundle manifest.json is missing valid migrations or 64-char schemaIdentity' -DurationMs 0
    throw 'GATE REJECTED: Bundle manifest.json is missing valid migrations array or 64-char schemaIdentity.'
  }
  $manifestMigs = @($bundleManifest.migrations)
  $expectedBundleSchemaId = [string]$bundleManifest.schemaIdentity.Trim().ToLowerInvariant()
  if ($expectedBundleSchemaId -ne $expectedSchemaSha -or
      $expectedBundleSchemaId -ne $receiptSchemaSha.Trim().ToLowerInvariant()) {
    Record-DeployResult -Status 'REJECTED_SCHEMA_MIGRATION_MISMATCH' -Sha $normalizedSha -Message "Bundle schemaIdentity ($expectedBundleSchemaId) != expected ($expectedSchemaSha) or receipt ($receiptSchemaSha)" -DurationMs 0
    throw 'GATE REJECTED: Bundle schemaIdentity does not match verified schema_sha256 and CI receipt schema_sha256.'
  }

  if (($bundledApiVer.PSObject.Properties.Name -contains 'schemaIdentity') -and -not [string]::IsNullOrWhiteSpace([string]$bundledApiVer.schemaIdentity)) {
    if ([string]$bundledApiVer.schemaIdentity.Trim().ToLowerInvariant() -ne $expectedBundleSchemaId) {
      Record-DeployResult -Status 'REJECTED_BUILD_NOT_READY' -Sha $normalizedSha -Message "dist/release-version.json schemaIdentity ($($bundledApiVer.schemaIdentity)) != manifest ($expectedBundleSchemaId)" -DurationMs 0
      throw 'GATE REJECTED: Candidate dist/release-version.json schemaIdentity does not match manifest.json.'
    }
  }

  $jsVerifySqlMigs = @"
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const stageDir = process.argv[1];
const manifest = JSON.parse(fs.readFileSync(path.join(stageDir, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const migDir = path.join(stageDir, 'migrations');
if (!fs.existsSync(migDir)) { process.stdout.write('MISSING_MIG_DIR'); process.exit(0); }
const sqlFiles = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
const computedMigs = sqlFiles.map(filename => {
  const raw = fs.readFileSync(path.join(migDir, filename), 'utf8');
  const norm = raw.replace(/\r\n/g, '\n').trim();
  return {
    id: filename.replace(/\.sql$/, ''),
    checksum: crypto.createHash('sha256').update(norm, 'utf8').digest('hex')
  };
});
const computedSchemaId = crypto.createHash('sha256').update(JSON.stringify(computedMigs), 'utf8').digest('hex');
if (computedSchemaId !== manifest.schemaIdentity || JSON.stringify(computedMigs) !== JSON.stringify(manifest.migrations)) {
  process.stdout.write('MIGRATION_SQL_MISMATCH');
  process.exit(0);
}
process.stdout.write('VALID');
"@
  $migCheckOut = ((& $node -e $jsVerifySqlMigs $stagingExtractDir) -join '').Trim()
  if ($migCheckOut -ne 'VALID') {
    Record-DeployResult -Status 'REJECTED_SCHEMA_MIGRATION_MISMATCH' -Sha $normalizedSha -Message "Unpacked migrations/*.sql files do not match manifest.migrations or schemaIdentity ($migCheckOut)" -DurationMs 0
    throw "GATE REJECTED: Unpacked migrations/*.sql files do not match manifest.migrations or schemaIdentity ($migCheckOut)."
  }

  $bundleHas0023 = [bool]($manifestMigs | Where-Object { $_.id -eq '0023_auth_session_remember_me' })
  if ($bundleHas0023) {
    $candidateAuthSvc = Get-Content -LiteralPath (Join-Path $stagingExtractDir 'dist/apps/api/src/auth/service.js') -Raw
    if ($candidateAuthSvc -notmatch 'remember_me' -or $candidateAuthSvc -notmatch 'getRememberMeMaxAgeSeconds') {
      Record-DeployResult -Status 'REJECTED_BUILD_NOT_READY' -Sha $normalizedSha -Message 'Candidate build includes 0023_auth_session_remember_me but compiled auth/service.js lacks remember_me policy enforcement' -DurationMs 0
      throw 'GATE REJECTED: Candidate build auth/service.js does not implement AUTH-REMEMBER-01 session policy.'
    }
  }

  # 10B. MANDATORY DATABASE SCHEMA PREFLIGHT CHECK (RUNS BEFORE SNAPSHOT, MIGRATION, OR CUTOVER)
  $dbPreflight = $null
  try {
    $dbPreflight = Get-DatabaseSchemaAndAuthState
  } catch {
    if ($_.Exception.Message -match '^SANDBOX_VIOLATION_') {
      throw
    }
    Record-DeployResult -Status 'REJECTED_SCHEMA_MIGRATION_MISMATCH' -Sha $normalizedSha -Message "Failed to query schema_migrations from '$DbTarget': $($_.Exception.Message)" -DurationMs 0
    throw "GATE REJECTED: Failed to query schema_migrations from '$DbTarget'."
  }

  if ($dbPreflight.mig_count -gt $manifestMigs.Count) {
    Record-DeployResult -Status 'REJECTED_SCHEMA_MIGRATION_MISMATCH' -Sha $normalizedSha -Message "Database '$DbTarget' has $($dbPreflight.mig_count) applied migrations which exceeds candidate bundle ($($manifestMigs.Count) migrations)" -DurationMs 0
    throw "GATE REJECTED: Database '$DbTarget' schema version ($($dbPreflight.mig_count) migrations) is ahead of candidate bundle ($($manifestMigs.Count) migrations)."
  }

  for ($mIdx = 0; $mIdx -lt $dbPreflight.mig_count; $mIdx++) {
    $expectedPair = "$($manifestMigs[$mIdx].id):$($manifestMigs[$mIdx].checksum.ToLowerInvariant())"
    $actualPair = $dbPreflight.mig_lines[$mIdx].Trim().ToLowerInvariant()
    if ($actualPair -ne $expectedPair.ToLowerInvariant()) {
      Record-DeployResult -Status 'REJECTED_SCHEMA_MIGRATION_MISMATCH' -Sha $normalizedSha -Message "Migration checksum/id mismatch at index $mIdx (bundle=$expectedPair, db=$actualPair)" -DurationMs 0
      throw "GATE REJECTED: Schema migration id/checksum mismatch at index $mIdx (bundle=$expectedPair, db=$actualPair)."
    }
  }

  if ($dbPreflight.has_0023 -and (-not $bundleHas0023)) {
    Record-DeployResult -Status 'REJECTED_SCHEMA_MIGRATION_MISMATCH' -Sha $normalizedSha -Message "Database '$DbTarget' has 0023_auth_session_remember_me applied, but candidate bundle lacks 0023_auth_session_remember_me" -DurationMs 0
    throw "GATE REJECTED: Cannot deploy pre-0023 bundle onto database '$DbTarget' with AUTH-REMEMBER-01 (0023) applied."
  }

  if ($SkipMigration) {
    if ($dbPreflight.mig_count -ne $manifestMigs.Count) {
      Record-DeployResult -Status 'REJECTED_SCHEMA_MIGRATION_MISMATCH' -Sha $normalizedSha -Message "Bundle has $($manifestMigs.Count) migrations but DB '$DbTarget' has $($dbPreflight.mig_count) applied migrations while -SkipMigration is active" -DurationMs 0
      throw "GATE REJECTED: Schema migration count mismatch (bundle=$($manifestMigs.Count), DB=$($dbPreflight.mig_count)) while -SkipMigration is true. Migration must complete before cutover."
    }
    if ($bundleHas0023 -and (-not $dbPreflight.remember_me_column)) {
      Record-DeployResult -Status 'REJECTED_SCHEMA_MIGRATION_MISMATCH' -Sha $normalizedSha -Message "Bundle requires 0023_auth_session_remember_me but column auth_sessions.remember_me is missing in '$DbTarget'" -DurationMs 0
      throw "GATE REJECTED: Column auth_sessions.remember_me is missing in '$DbTarget'; migration 0023 must be applied before cutover."
    }
  }

  Write-DeployLog "Candidate build readiness, artifact checksum, provenance, $(@($bundleManifest.files).Count) file hashes, and preflight schema checks verified (DB migrations=$($dbPreflight.mig_count)/$($manifestMigs.Count), SkipMigration=$SkipMigration)."

  # 11. PRE-DEPLOY SNAPSHOT (WITH SCHEMA & AUTH POLICY METADATA + ZERO SECRET COPYING) + PRE-MIGRATION DB BACKUP
  $prevCompat = Get-ReleaseCompatibilityDescriptor -ReleaseDir $TargetDir -GitSha $previousGitSha
  $ts = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $snapshotDir = Join-Path $backupsDir "pre-deploy-$ts"
  Write-DeployLog "Creating verified recovery snapshot at: $snapshotDir (Zero plaintext secrets copied, prevSchema=$($prevCompat.schema_identity), prevAuthPolicy=$($prevCompat.auth_policy))..."
  New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null

  if (-not (Test-Path -LiteralPath (Join-Path $TargetDir 'dist')) -or -not (Test-Path -LiteralPath (Join-Path $TargetDir 'apps\web\dist'))) {
    throw "Current target directory '$TargetDir' is missing dist or apps\web\dist required for atomic rollback snapshot."
  }
  Copy-Item -LiteralPath (Join-Path $TargetDir 'dist') -Destination (Join-Path $snapshotDir 'dist') -Recurse -Force
  New-Item -ItemType Directory -Path (Join-Path $snapshotDir 'web') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $TargetDir 'apps\web\dist') -Destination (Join-Path $snapshotDir 'web\dist') -Recurse -Force
  if (Test-Path -LiteralPath (Join-Path $TargetDir 'package.json')) {
    Copy-Item -LiteralPath (Join-Path $TargetDir 'package.json') -Destination (Join-Path $snapshotDir 'package.json') -Force
  }

  $snapshotFiles = @(Get-ChildItem -LiteralPath $snapshotDir -Recurse -File | ForEach-Object {
    @{
      path   = $_.FullName.Substring($snapshotDir.Length).TrimStart('\', '/').Replace('\', '/')
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  })

  @{
    previous_git_sha          = $previousGitSha
    previous_live_sha         = $previousLiveSha
    previous_schema_identity  = $prevCompat.schema_identity
    previous_migration_count  = $prevCompat.migration_count
    previous_max_migration_id = $prevCompat.max_migration
    previous_has_0023         = [bool]$prevCompat.has_0023
    previous_auth_policy      = $prevCompat.auth_policy
    target_sha                = $normalizedSha
    sequence                  = [int]$signedPayload.sequence
    created_at_utc            = (Get-Date).ToUniversalTime().ToString('o')
    files                     = $snapshotFiles
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $snapshotDir 'rollback-metadata.json') -Encoding UTF8 -Force

  Assert-SandboxDatabaseIsolation
  Write-DeployLog "Running pre-deploy PostgreSQL backup for database '$DbTarget' (before any migration or cutover)..."
  $pgBackupDir = Join-Path $ServerRoot 'backups\postgres'
  if ($SandboxMode) {
    New-Item -ItemType Directory -Path $pgBackupDir -Force | Out-Null
    $dumpExe = Join-Path $resolvedPgBin 'pg_dump.exe'
    $restoreExe = Join-Path $resolvedPgBin 'pg_restore.exe'
    $dumpSuffix = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N')
    $dumpArchive = Join-Path $pgBackupDir ("postgres-$dumpSuffix.dump")
    $dumpPartial = "$dumpArchive.partial"
    $priorPgPass = $env:PGPASSFILE
    try {
      $env:PGPASSFILE = (Resolve-Path -LiteralPath $pgPassFile).Path
      & $dumpExe "--host=$DbHost" "--port=$DbPort" "--username=$DbUser" "--dbname=$DbTarget" --no-password --format=custom "--file=$dumpPartial"
      if ($LASTEXITCODE -ne 0) {
        throw "Sandbox pg_dump failed for $DbTarget."
      }
      & $restoreExe --list $dumpPartial | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Sandbox pg_restore --list verification failed for $DbTarget."
      }
      Move-Item -LiteralPath $dumpPartial -Destination $dumpArchive -ErrorAction Stop
      Get-FileHash -LiteralPath $dumpArchive -Algorithm SHA256 | Select-Object Algorithm, Hash, Path | ConvertTo-Json | Set-Content -LiteralPath "$dumpArchive.sha256.json" -Encoding UTF8
    } finally {
      $env:PGPASSFILE = $priorPgPass
    }
  } else {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $backupScript -PgBin $resolvedPgBin -Database $DbTarget -User $DbUser -PasswordFile $pgPassFile -Port $DbPort -BackupDir $pgBackupDir
    if ($LASTEXITCODE -ne 0) {
      throw "Pre-deploy PostgreSQL backup failed for $DbTarget."
    }
  }

  # 12. ADVANCE ANTI-REPLAY WATERMARK & EXECUTE PRE-CUTOVER DATABASE MIGRATIONS (BEFORE SWITCHING API/WEB BUILD)
  @{
    last_sequence           = [int]$signedPayload.sequence
    last_sha                = $normalizedSha
    approval_mode           = $approvalMode
    scoped_deployments_used = if ($approvalMode -eq 'SCOPED_WINDOW') { $wmScopedUsed + 1 } else { 0 }
    deployed_runs           = if ($approvalMode -eq 'SCOPED_WINDOW') { @($wmDeployedRuns + $currentRunKey) } else { @($currentRunKey) }
    updated_at_utc          = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $watermarkFile -Encoding UTF8 -Force

  if (-not $SkipMigration) {
    Assert-SandboxDatabaseIsolation
    Write-DeployLog "Executing approved database migrations on '$DbTarget' from verified staging bundle BEFORE runtime cutover..."
    @{
      status          = 'IN_PROGRESS'
      phase           = 'PRE_CUTOVER_MIGRATION'
      sha             = $normalizedSha
      previous_sha    = $previousGitSha
      sequence        = [int]$signedPayload.sequence
      snapshot_dir    = $snapshotDir
      started_at_utc  = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $stateJournalFile -Encoding UTF8 -Force

    $resolvedNodeModules = ''
    $nmCandidates = if ($SandboxMode) {
      @(
        (Join-Path $TargetDir 'node_modules'),
        (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'node_modules')
      )
    } else {
      @(
        (Join-Path $TargetDir 'node_modules'),
        (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'node_modules'),
        (Join-Path $realServerRoot 'apps\management-lite\node_modules'),
        (Join-Path $realServerRoot 'workspace\management-lite-dev\node_modules')
      )
    }
    foreach ($nmCand in $nmCandidates) {
      if ($nmCand -and (Test-Path -LiteralPath $nmCand)) {
        $resolvedNodeModules = $nmCand
        break
      }
    }

    $stagingNodeModules = Join-Path $stagingExtractDir 'node_modules'
    $pass = ([IO.File]::ReadAllText($pgPassFile).Trim() -split ':')[-1]
    $env:DATABASE_URL = "postgresql://${DbUser}:${pass}@${DbHost}:${DbPort}/$DbTarget"
    try {
      if (-not [string]::IsNullOrWhiteSpace($resolvedNodeModules) -and (-not (Test-Path -LiteralPath $stagingNodeModules))) {
        New-Item -ItemType Junction -Path $stagingNodeModules -Target $resolvedNodeModules | Out-Null
      }

      $jsStagedMigrate = @"
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const stageDir = process.argv[2];
const { createDatabasePool, closeDatabasePool, checkDatabaseHealth } = await import(
  pathToFileURL(path.join(stageDir, 'dist/packages/database/src/pool.js')).href
);
const { loadMigrationFiles, runMigrations } = await import(
  pathToFileURL(path.join(stageDir, 'dist/packages/database/src/migrator.js')).href
);
const pool = createDatabasePool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
try {
  const health = await checkDatabaseHealth(pool);
  if (!health.connected) {
    throw new Error('Database unreachable: ' + (health.error || 'unknown'));
  }
  const migs = loadMigrationFiles(path.join(stageDir, 'migrations'));
  const res = await runMigrations(pool, migs);
  process.stdout.write('MIGRATED_OK:' + JSON.stringify(res));
} finally {
  await closeDatabasePool(pool);
}
"@
      $migRunnerPath = Join-Path $stagingExtractDir 'run-staged-migration.mjs'
      Set-Content -LiteralPath $migRunnerPath -Value $jsStagedMigrate -Encoding UTF8 -Force
      try {
        $prevEapMig = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          $migOut = (& $node $migRunnerPath $stagingExtractDir 2>&1) -join "`n"
          $migExit = $LASTEXITCODE
        } finally {
          $ErrorActionPreference = $prevEapMig
        }
        if ($migExit -ne 0 -or $migOut -notmatch 'MIGRATED_OK:') {
          throw "Staged database migration failed on '$DbTarget' ($migOut)"
        }
      } finally {
        Remove-Item -LiteralPath $migRunnerPath -Force -ErrorAction SilentlyContinue
      }

      # Mandatory Post-Migration Schema & Auth Column Verification before allowing cutover
      $dbPostMig = Get-DatabaseSchemaAndAuthState
      if ($dbPostMig.mig_count -ne $manifestMigs.Count -or $dbPostMig.schema_identity -ne $expectedBundleSchemaId) {
        throw "Post-migration schema verification failed on '$DbTarget' (expected $($manifestMigs.Count) migrations / $expectedBundleSchemaId, actual $($dbPostMig.mig_count) / $($dbPostMig.schema_identity))"
      }
      if ($bundleHas0023 -and (-not $dbPostMig.remember_me_column)) {
        throw "Post-migration verification failed: column auth_sessions.remember_me is missing in '$DbTarget' after migration 0023"
      }
      Write-DeployLog "Pre-cutover database migration and schema verification succeeded on '$DbTarget' ($($dbPostMig.mig_count)/$($manifestMigs.Count) migrations applied, remember_me_column=$($dbPostMig.remember_me_column))."
    } catch {
      $migErr = $_.Exception.Message
      Write-DeployLog "PRE-CUTOVER MIGRATION FAILED: $migErr. Live API/Web build was NOT switched." 'ERROR'
      @{
        status             = 'MIGRATION_FAILED_PRE_CUTOVER'
        sha                = $normalizedSha
        previous_sha       = $previousGitSha
        snapshot_dir       = $snapshotDir
        migration_error    = $migErr
        failed_at_utc      = (Get-Date).ToUniversalTime().ToString('o')
      } | ConvertTo-Json | Set-Content -LiteralPath $stateJournalFile -Encoding UTF8 -Force
      $duration = [int]((Get-Date) - $startTime).TotalMilliseconds
      Record-DeployResult -Status 'MIGRATION_FAILED_PRE_CUTOVER' -Sha $normalizedSha -PreviousSha $previousGitSha -Message "Pre-cutover database migration failed ($migErr); live build untouched" -DurationMs $duration
      throw "MIGRATION_FAILED_PRE_CUTOVER: $migErr"
    } finally {
      Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $stagingNodeModules) {
        [IO.Directory]::Delete($stagingNodeModules)
      }
    }
  } else {
    Write-DeployLog "Database migration skipped (-SkipMigration=true); preflight confirmed schema parity ($($dbPreflight.mig_count)/$($manifestMigs.Count) migrations)."
  }

  # 13. RECORD RUNTIME_CUTOVER JOURNAL & ATOMICALLY SWITCH GIT + API/WEB RUNTIME (ONLY AFTER MIGRATION & SCHEMA VERIFICATION SUCCEEDED)
  @{
    status          = 'IN_PROGRESS'
    phase           = 'RUNTIME_CUTOVER'
    sha             = $normalizedSha
    previous_sha    = $previousGitSha
    sequence        = [int]$signedPayload.sequence
    snapshot_dir    = $snapshotDir
    started_at_utc  = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $stateJournalFile -Encoding UTF8 -Force

  $switchStarted = $true

  Write-DeployLog "Checking out exact Git commit SHA: $normalizedSha..."
  $env:GIT_TERMINAL_PROMPT = '0'
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    git -c safe.directory=* -C $TargetDir cat-file -e "$normalizedSha^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) {
      git -c safe.directory=* -C $TargetDir fetch --quiet origin --all --tags --prune 2>$null
      git -c safe.directory=* -C $TargetDir fetch --quiet origin $normalizedSha 2>$null
    }
    git -c safe.directory=* -C $TargetDir cat-file -e "$normalizedSha^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0 -and (Test-Path -LiteralPath 'C:\Projects\management-lite\.git')) {
      git -c safe.directory=* -C $TargetDir fetch --quiet 'C:\Projects\management-lite' $normalizedSha 2>$null
    }
    git -c safe.directory=* -C $TargetDir checkout --quiet -f $normalizedSha 2>$null
    $checkoutExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
  if ($checkoutExit -ne 0) {
    throw "Failed to checkout Git commit $normalizedSha"
  }

  Write-DeployLog "Deploying verified pre-built artifacts from bundle via same-volume atomic directory swap (Zero host compilation)..."
  Invoke-AtomicRuntimeSwap -SourceDistDir (Join-Path $stagingExtractDir 'dist') -SourceWebDistDir (Join-Path $stagingExtractDir 'web') -SourcePackageJson (Join-Path $stagingExtractDir 'package.json')

  Write-RunningComponentsProof -Sha $normalizedSha -ArtifactDigest $verifiedArtifactDigest

  # 14. SERVICE CUTOVER (PRODUCTION ONLY)
  if (-not $SandboxMode) {
    Write-DeployLog "Restarting Windows service HPManagementLiteApi..."
    Restart-Service HPManagementLiteApi -Force
    Start-Sleep -Seconds 3
  } else {
    Write-DeployLog "SANDBOX: Skipping production Windows service restart (Zero production impact)."
  }

  # 15. READ-ONLY POST-DEPLOY SMOKE VERIFICATION
  Write-DeployLog "Running read-only post-deploy smoke checks..."
  if (-not (Test-ApplicationSmoke -ExpectedSha $normalizedSha -MaxAttempts 10)) {
    throw "Post-deploy smoke verification failed (health/ready/web/version check)."
  }

  # 16. COMMIT LIVE STATE POINTER & COMPLETED JOURNAL
  Set-Content -LiteralPath $currentShaFile -Value $normalizedSha -Encoding UTF8 -Force
  @{
    status           = 'COMPLETED'
    sha              = $normalizedSha
    previous_sha     = $previousGitSha
    sequence         = [int]$signedPayload.sequence
    completed_at_utc = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $stateJournalFile -Encoding UTF8 -Force

  $duration = [int]((Get-Date) - $startTime).TotalMilliseconds
  Record-DeployResult -Status 'SUCCESS' -Sha $normalizedSha -PreviousSha $previousGitSha -Message 'Deployment completed and verified' -DurationMs $duration
  Write-DeployLog "=== DEPLOY SUCCESSFUL: $normalizedSha (${duration}ms) ===" 'SUCCESS'

} catch {
  $errMsg = $_.Exception.Message
  if (-not $switchStarted) {
    Write-DeployLog "PRE-CUTOVER GATE OR PREFLIGHT REJECTED: $errMsg" 'ERROR'
    throw $errMsg
  }

  Write-DeployLog "POST-CUTOVER DEPLOY FAILED: $errMsg. INITIATING VERIFIED ATOMIC ROLLBACK..." 'ERROR'
  Restore-VerifiedSnapshot -SnapshotPath $snapshotDir -ExpectedPreviousSha $previousGitSha -FailedSha $normalizedSha -JournalSuccessStatus 'ROLLED_BACK' -ResultSuccessStatus 'ROLLED_BACK' -FailureReason $errMsg
  throw "Deployment failed and cleanly rolled back to ${previousGitSha}: $errMsg"
} finally {
  if ($stagingExtractDir -and (Test-Path -LiteralPath $stagingExtractDir)) {
    Remove-Item -LiteralPath $stagingExtractDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($lockStream) {
    $lockStream.Dispose()
  }
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
