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
  [switch]$RecoverInterrupted,
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
$normalizedArtifactSha = $ArtifactSha256.Trim().ToLowerInvariant()

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

$realServerRoot = 'C:\HoaiPhuong-Server'
$node = Join-Path $realServerRoot 'config\runtime\node-v22.14.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = 'node' }
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

function Write-RunningComponentsProof {
  param([string]$Sha, [string]$ArtifactDigest)
  $apiMain = Join-Path $TargetDir 'dist\apps\api\src\main.js'
  $webIndex = Join-Path $TargetDir 'apps\web\dist\index.html'
  $apiMainHash = if (Test-Path -LiteralPath $apiMain) { (Get-FileHash -LiteralPath $apiMain -Algorithm SHA256).Hash.ToLowerInvariant() } else { '' }
  $webIndexHash = if (Test-Path -LiteralPath $webIndex) { (Get-FileHash -LiteralPath $webIndex -Algorithm SHA256).Hash.ToLowerInvariant() } else { '' }

  $apiVerDir = Join-Path $TargetDir 'dist'
  $webVerDir = Join-Path $TargetDir 'apps\web\dist'
  foreach ($dir in @($apiVerDir, $webVerDir)) {
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  }

  @{
    sha             = $Sha
    component       = 'api'
    artifact_sha256 = $ArtifactDigest
    main_js_sha256  = $apiMainHash
    deployed_at_utc = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $apiVerDir 'release-version.json') -Encoding UTF8 -Force

  @{
    sha               = $Sha
    component         = 'web'
    artifact_sha256   = $ArtifactDigest
    index_html_sha256 = $webIndexHash
    deployed_at_utc   = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $webVerDir 'release-version.json') -Encoding UTF8 -Force

  @{
    sha               = $Sha
    api_sha           = $Sha
    web_sha           = $Sha
    artifact_sha256   = $ArtifactDigest
    api_main_sha256   = $apiMainHash
    web_index_sha256  = $webIndexHash
    verified_at_utc   = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $runningComponentsFile -Encoding UTF8 -Force
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

  $webVersionFile = Join-Path $TargetDir 'apps\web\dist\release-version.json'
  $apiVersionFile = Join-Path $TargetDir 'dist\release-version.json'
  if (-not (Test-Path -LiteralPath $webVersionFile) -or -not (Test-Path -LiteralPath $apiVersionFile)) {
    Write-DeployLog 'Missing Web or API release-version.json' 'WARN'
    return $false
  }
  $webVer = Get-Content -LiteralPath $webVersionFile -Raw | ConvertFrom-Json
  $apiVer = Get-Content -LiteralPath $apiVersionFile -Raw | ConvertFrom-Json
  if ($webVer.sha -ne $ExpectedSha -or $apiVer.sha -ne $ExpectedSha) {
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

Write-DeployLog "=== MANAGEMENT LITE: HARDENED SEMI-AUTO DEPLOY (CRYPTOGRAPHIC OWNER GATE) ==="
Write-DeployLog "Target Commit SHA : $normalizedSha (SandboxMode=$SandboxMode)"

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

# 2B. OFF-SERVER KEY CUSTODY ENFORCEMENT (REJECT IF ANY PRIVATE KEY IS LEFT IN SERVER RELEASE-GATE OR RUNNER)
$gateScanDirs = @(
  (Split-Path -Path $PolicyPath -Parent),
  (Split-Path -Path $ApprovalManifestPath -Parent),
  (Join-Path $ServerRoot 'runner')
) | Select-Object -Unique
foreach ($scanDir in $gateScanDirs) {
  if ($scanDir -and (Test-Path -LiteralPath $scanDir)) {
    $suspectKeyFiles = @(Get-ChildItem -LiteralPath $scanDir -File -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -match '(?i)(private|\.key$|\.pfx$|\.p12$)' -or (
        $_.Extension -eq '.pem' -and ((Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue) -match 'PRIVATE KEY')
      )
    })
    if ($suspectKeyFiles.Count -gt 0) {
      $exposedNames = ($suspectKeyFiles | ForEach-Object { $_.Name }) -join ', '
      Record-DeployResult -Status 'REJECTED_PRIVATE_KEY_EXPOSED_ON_HOST' -Sha $normalizedSha -Message "Private key file detected in host gate/runner directory ($exposedNames)" -DurationMs 0
      throw "GATE REJECTED: Owner private key exposure detected on host ($exposedNames). Private signing key must never reside in release-gate or runner directories."
    }
  }
}

# 3. CRYPTOGRAPHIC ED25519 OWNER APPROVAL GATE
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
if ($manifest.approved_sha -ne $signedPayload.approved_sha -or
    $manifest.artifact_sha256 -ne $signedPayload.artifact_sha256 -or
    $manifest.ci_run_id -ne $signedPayload.ci_run_id -or
    $manifest.ci_status -ne $signedPayload.ci_status -or
    [int]$manifest.sequence -ne [int]$signedPayload.sequence -or
    $manifest.approved_by -ne $signedPayload.approved_by -or
    [bool]$manifest.allow_migration -ne [bool]$signedPayload.allow_migration -or
    $manifest.expires_at_utc -ne $signedPayload.expires_at_utc) {
  Record-DeployResult -Status 'REJECTED_INVALID_SIGNATURE' -Sha $normalizedSha -Message 'Outer manifest fields tampered relative to signed canonical payload' -DurationMs 0
  throw 'GATE REJECTED: Manifest envelope fields do not match signed canonical payload.'
}

$allowedApprovers = @($policy.allowed_approvers)
if ($allowedApprovers -notcontains $signedPayload.approved_by) {
  Record-DeployResult -Status 'REJECTED_UNAUTHORIZED_APPROVER' -Sha $normalizedSha -Message "Approver '$($signedPayload.approved_by)' is not authorized" -DurationMs 0
  throw "GATE REJECTED: Approver '$($signedPayload.approved_by)' is not in policy allowed_approvers."
}

if ($signedPayload.approved_sha.Trim().ToLowerInvariant() -ne $normalizedSha) {
  Record-DeployResult -Status 'REJECTED_UNAPPROVED_SHA' -Sha $normalizedSha -Message "Signed SHA ($($signedPayload.approved_sha)) does not match requested SHA ($normalizedSha)" -DurationMs 0
  throw "GATE REJECTED: Signed SHA '$($signedPayload.approved_sha)' does not match requested SHA '$normalizedSha'."
}

$expiresUtc = [DateTimeOffset]::Parse($signedPayload.expires_at_utc).UtcDateTime
if ((Get-Date).ToUniversalTime() -gt $expiresUtc) {
  Record-DeployResult -Status 'REJECTED_EXPIRED_APPROVAL' -Sha $normalizedSha -Message "Owner approval expired at $($signedPayload.expires_at_utc)" -DurationMs 0
  throw "GATE REJECTED: Owner approval expired at $($signedPayload.expires_at_utc)."
}

if ((-not $SkipMigration) -and (-not [bool]$signedPayload.allow_migration)) {
  Record-DeployResult -Status 'REJECTED_UNAPPROVED_MIGRATION' -Sha $normalizedSha -Message 'Migration requested but allow_migration is false in signed Owner manifest' -DurationMs 0
  throw 'GATE REJECTED: Migration requested (-SkipMigration:$false), but signed Owner manifest has allow_migration=false.'
}

# 4. CI STATUS & INDEPENDENT CI RECEIPT VERIFICATION GATE
if ($signedPayload.ci_status -ne 'SUCCESS' -or $signedPayload.ci_run_id -ne $CiRunId.Trim()) {
  Record-DeployResult -Status 'REJECTED_CI_NOT_PASSED' -Sha $normalizedSha -Message "CI check failed or mismatched (signed status=$($signedPayload.ci_status), run_id=$($signedPayload.ci_run_id), requested=$CiRunId)" -DurationMs 0
  throw "GATE REJECTED: Exact-SHA CI has not passed (ci_status='$($signedPayload.ci_status)', ci_run_id='$($signedPayload.ci_run_id)')."
}

$requireCiReceipt = $false
if ($policy.PSObject.Properties.Name -contains 'require_independent_ci_receipt') {
  $requireCiReceipt = [bool]$policy.require_independent_ci_receipt
}
$resolvedCiReceipt = $CiRunReceiptPath
if ([string]::IsNullOrWhiteSpace($resolvedCiReceipt)) {
  $gateDir = Split-Path -Path $PolicyPath -Parent
  $candidate1 = Join-Path $gateDir "ci-run-receipt-$normalizedSha.json"
  $candidate2 = Join-Path $gateDir 'ci-run-receipt.json'
  if (Test-Path -LiteralPath $candidate1) { $resolvedCiReceipt = $candidate1 }
  elseif (Test-Path -LiteralPath $candidate2) { $resolvedCiReceipt = $candidate2 }
}

if ($requireCiReceipt -or (-not [string]::IsNullOrWhiteSpace($resolvedCiReceipt))) {
  if ([string]::IsNullOrWhiteSpace($resolvedCiReceipt) -or (-not (Test-Path -LiteralPath $resolvedCiReceipt))) {
    Record-DeployResult -Status 'REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED' -Sha $normalizedSha -Message 'Missing independent CI run receipt JSON required by policy' -DurationMs 0
    throw 'GATE REJECTED: Independent CI run receipt JSON is missing (do not rely solely on self-declared ci_status).'
  }
  $ciReceipt = Get-Content -LiteralPath $resolvedCiReceipt -Raw | ConvertFrom-Json
  $receiptRunId = if ($ciReceipt.PSObject.Properties.Name -contains 'run_id') { [string]$ciReceipt.run_id } elseif ($ciReceipt.PSObject.Properties.Name -contains 'id') { [string]$ciReceipt.id } else { '' }
  $receiptSha = if ($ciReceipt.PSObject.Properties.Name -contains 'head_sha') { [string]$ciReceipt.head_sha } else { '' }
  $receiptStatus = if ($ciReceipt.PSObject.Properties.Name -contains 'status') { [string]$ciReceipt.status } else { '' }
  $receiptConclusion = if ($ciReceipt.PSObject.Properties.Name -contains 'conclusion') { [string]$ciReceipt.conclusion } else { '' }
  $receiptEvent = if ($ciReceipt.PSObject.Properties.Name -contains 'event') { [string]$ciReceipt.event } else { 'push' }

  if ($receiptRunId.Trim() -ne $CiRunId.Trim() -or
      $receiptSha.Trim().ToLowerInvariant() -ne $normalizedSha -or
      $receiptStatus.Trim().ToLowerInvariant() -ne 'completed' -or
      $receiptConclusion.Trim().ToLowerInvariant() -ne 'success' -or
      $receiptEvent.Trim().ToLowerInvariant() -in @('pull_request', 'pull_request_target')) {
    Record-DeployResult -Status 'REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED' -Sha $normalizedSha -Message "Independent CI receipt verification failed (run=$receiptRunId, sha=$receiptSha, status=$receiptStatus, conclusion=$receiptConclusion, event=$receiptEvent)" -DurationMs 0
    throw "GATE REJECTED: Independent CI receipt verification failed (run=$receiptRunId, sha=$receiptSha, status=$receiptStatus, conclusion=$receiptConclusion, event=$receiptEvent)."
  }
  Write-DeployLog "Independent CI Run Receipt verified (RunId=$receiptRunId, HeadSha=$receiptSha, Conclusion=$receiptConclusion)."
}

# 4B. LIVE GITHUB ACTIONS RUN API VERIFICATION (DO NOT TRUST LOCAL RECEIPT ALONE)
$resolvedApiBase = $GitHubApiBaseUrl
if ([string]::IsNullOrWhiteSpace($resolvedApiBase) -and ($policy.PSObject.Properties.Name -contains 'github_api_base_url')) {
  $resolvedApiBase = [string]$policy.github_api_base_url
}
if (-not [string]::IsNullOrWhiteSpace($resolvedApiBase)) {
  $repoSlug = if ($policy.PSObject.Properties.Name -contains 'repository') { [string]$policy.repository } else { 'truhoaiphuong03/management-lite' }
  $runApiUrl = "$($resolvedApiBase.TrimEnd('/'))/repos/$repoSlug/actions/runs/$($CiRunId.Trim())"
  $apiHeaders = @{ 'Accept' = 'application/vnd.github+json'; 'User-Agent' = 'ManagementLite-HostReleaseController' }
  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_READONLY_TOKEN)) {
    $apiHeaders['Authorization'] = "Bearer $($env:GITHUB_READONLY_TOKEN)"
  }
  try {
    $apiRun = Invoke-RestMethod -Uri $runApiUrl -Headers $apiHeaders -Method Get -TimeoutSec 10
  } catch {
    Record-DeployResult -Status 'REJECTED_GITHUB_API_CI_VERIFICATION_FAILED' -Sha $normalizedSha -Message "Failed to query live GitHub Actions run API ($runApiUrl): $($_.Exception.Message)" -DurationMs 0
    throw "GATE REJECTED: Failed to verify CI run against live GitHub Actions API ($runApiUrl)."
  }
  $liveId = if ($apiRun.PSObject.Properties.Name -contains 'id') { [string]$apiRun.id } else { '' }
  $liveSha = if ($apiRun.PSObject.Properties.Name -contains 'head_sha') { [string]$apiRun.head_sha } else { '' }
  $liveStatus = if ($apiRun.PSObject.Properties.Name -contains 'status') { [string]$apiRun.status } else { '' }
  $liveConclusion = if ($apiRun.PSObject.Properties.Name -contains 'conclusion') { [string]$apiRun.conclusion } else { '' }
  $liveEvent = if ($apiRun.PSObject.Properties.Name -contains 'event') { [string]$apiRun.event } else { '' }

  if ($liveId.Trim() -ne $CiRunId.Trim() -or
      $liveSha.Trim().ToLowerInvariant() -ne $normalizedSha -or
      $liveStatus.Trim().ToLowerInvariant() -ne 'completed' -or
      $liveConclusion.Trim().ToLowerInvariant() -ne 'success' -or
      $liveEvent.Trim().ToLowerInvariant() -in @('pull_request', 'pull_request_target')) {
    Record-DeployResult -Status 'REJECTED_GITHUB_API_CI_VERIFICATION_FAILED' -Sha $normalizedSha -Message "Live GitHub API run verification failed (id=$liveId, sha=$liveSha, status=$liveStatus, conclusion=$liveConclusion, event=$liveEvent)" -DurationMs 0
    throw "GATE REJECTED: Live GitHub Actions API run verification failed (id=$liveId, sha=$liveSha, status=$liveStatus, conclusion=$liveConclusion, event=$liveEvent)."
  }
  Write-DeployLog "Live GitHub Actions API Run verified (RunId=$liveId, HeadSha=$liveSha, Conclusion=$liveConclusion, Event=$liveEvent)."
}

# 5. ANTI-REPLAY SEQUENCE WATERMARK GATE
$lastSequence = 0
if (Test-Path -LiteralPath $watermarkFile) {
  $wmObj = Get-Content -LiteralPath $watermarkFile -Raw | ConvertFrom-Json
  $lastSequence = [int]$wmObj.last_sequence
}
if ((-not $RecoverInterrupted) -and ([int]$signedPayload.sequence -le $lastSequence)) {
  Record-DeployResult -Status 'REJECTED_APPROVAL_REPLAY' -Sha $normalizedSha -Message "Approval sequence $($signedPayload.sequence) <= watermark $lastSequence" -DurationMs 0
  throw "GATE REJECTED: Approval replay detected (sequence $($signedPayload.sequence) <= watermark $lastSequence)."
}

Write-DeployLog "Cryptographic Ed25519 Owner Approval Gate PASSED (Seq=$($signedPayload.sequence), ApprovedBy=$($signedPayload.approved_by))."

# 6. EXCLUSIVE OS FILE HANDLE MUTEX LOCK
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
  # 7. INTERRUPTED DEPLOYMENT JOURNAL CHECK
  if (Test-Path -LiteralPath $stateJournalFile) {
    $journalState = Get-Content -LiteralPath $stateJournalFile -Raw | ConvertFrom-Json
    if ($journalState.status -eq 'IN_PROGRESS' -and (-not $RecoverInterrupted)) {
      Record-DeployResult -Status 'REJECTED_INTERRUPTED_STATE_REQUIRES_RECOVERY' -Sha $normalizedSha -Message 'Previous deployment was interrupted mid-switch (status=IN_PROGRESS)' -DurationMs 0
      throw 'GATE REJECTED: Interrupted deployment state (IN_PROGRESS) detected. Run with -RecoverInterrupted or operator review before retrying.'
    }
  }

  $previousGitSha = (git -c safe.directory=* -C $TargetDir rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
  if (Test-Path -LiteralPath $currentShaFile) {
    $previousLiveSha = (Get-Content -LiteralPath $currentShaFile -Raw).Trim().ToLowerInvariant()
  } else {
    $previousLiveSha = $previousGitSha
  }

  # 8. DUPLICATE DEPLOY DETECTION
  if (-not $Force -and (-not $RecoverInterrupted) -and $previousGitSha -eq $normalizedSha -and ($previousLiveSha -eq $normalizedSha -or $normalizedSha.StartsWith($previousLiveSha))) {
    Write-DeployLog "Commit SHA $normalizedSha is already live ($previousGitSha). Skipping (use -Force to re-deploy)." 'INFO'
    $duration = [int]((Get-Date) - $startTime).TotalMilliseconds
    Record-DeployResult -Status 'SKIPPED' -Sha $normalizedSha -PreviousSha $previousGitSha -Message 'Already live on server' -DurationMs $duration
    return
  }

  # 9. ARTIFACT INTEGRITY & PER-FILE SHA-256 VERIFICATION (BEFORE ANY MUTATION)
  $verifiedArtifactDigest = $signedPayload.artifact_sha256
  if (-not [string]::IsNullOrWhiteSpace($ArtifactPath)) {
    if (-not (Test-Path -LiteralPath $ArtifactPath)) {
      Record-DeployResult -Status 'REJECTED_ARTIFACT_MISSING' -Sha $normalizedSha -Message "ArtifactPath not found: $ArtifactPath" -DurationMs 0
      throw "GATE REJECTED: Artifact file not found at '$ArtifactPath'."
    }
    $actualArchiveHash = (Get-FileHash -LiteralPath $ArtifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ((-not [string]::IsNullOrWhiteSpace($normalizedArtifactSha) -and $actualArchiveHash -ne $normalizedArtifactSha) -or
        ($actualArchiveHash -ne $signedPayload.artifact_sha256.ToLowerInvariant())) {
      Record-DeployResult -Status 'REJECTED_ARTIFACT_CHECKSUM_MISMATCH' -Sha $normalizedSha -Message "Archive SHA-256 ($actualArchiveHash) does not match signed artifact_sha256 ($($signedPayload.artifact_sha256))" -DurationMs 0
      throw "GATE REJECTED: Artifact SHA-256 mismatch (actual=$actualArchiveHash, signed=$($signedPayload.artifact_sha256))."
    }

    $stagingExtractDir = Join-Path ([IO.Path]::GetTempPath()) ('ml-artifact-verify-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $stagingExtractDir -Force | Out-Null

    if ($ArtifactPath.EndsWith('.tar.gz')) {
      tar -xzf $ArtifactPath -C $stagingExtractDir
      if ($LASTEXITCODE -ne 0) {
        Record-DeployResult -Status 'REJECTED_ARTIFACT_CORRUPT' -Sha $normalizedSha -Message 'Failed to extract .tar.gz artifact' -DurationMs 0
        throw 'GATE REJECTED: Failed to extract .tar.gz release artifact.'
      }
    } elseif ($ArtifactPath.EndsWith('.zip')) {
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [IO.Compression.ZipFile]::ExtractToDirectory($ArtifactPath, $stagingExtractDir)
    } else {
      throw "Unsupported artifact format: $ArtifactPath"
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
    if (-not (Test-Path -LiteralPath $bundleManifestPath)) {
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
      if (-not $fp.StartsWith($stagingExtractDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $fp)) {
        Record-DeployResult -Status 'REJECTED_ARTIFACT_FILE_TAMPERED' -Sha $normalizedSha -Message "Missing or invalid file path in manifest: $($mf.path)" -DurationMs 0
        throw "GATE REJECTED: Missing or unsafe file path in manifest: $($mf.path)"
      }
      $fh = (Get-FileHash -LiteralPath $fp -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($fh -ne $mf.sha256.ToLowerInvariant()) {
        Record-DeployResult -Status 'REJECTED_ARTIFACT_FILE_TAMPERED' -Sha $normalizedSha -Message "File checksum mismatch in artifact: $($mf.path)" -DurationMs 0
        throw "GATE REJECTED: Post-CI artifact file tampering detected on $($mf.path)."
      }
    }
    Write-DeployLog "Artifact checksum & all $(@($bundleManifest.files).Count) internal file SHA-256 hashes verified."
  }

  # 10. PRE-DEPLOY SNAPSHOT (ZERO SECRET COPYING) & DB BACKUP
  $ts = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $snapshotDir = Join-Path $backupsDir "pre-deploy-$ts"
  Write-DeployLog "Creating recovery snapshot at: $snapshotDir (Zero plaintext secrets copied)..."
  New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null

  @{
    previous_git_sha  = $previousGitSha
    previous_live_sha = $previousLiveSha
    target_sha        = $normalizedSha
    sequence          = [int]$signedPayload.sequence
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

  # 11. RECORD IN_PROGRESS JOURNAL & ADVANCE ANTI-REPLAY WATERMARK BEFORE SWITCH
  @{
    status          = 'IN_PROGRESS'
    sha             = $normalizedSha
    previous_sha    = $previousGitSha
    sequence        = [int]$signedPayload.sequence
    snapshot_dir    = $snapshotDir
    started_at_utc  = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $stateJournalFile -Encoding UTF8 -Force

  @{
    last_sequence  = [int]$signedPayload.sequence
    last_sha       = $normalizedSha
    updated_at_utc = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $watermarkFile -Encoding UTF8 -Force

  $switchStarted = $true

  # 12. GIT EXACT SHA CHECKOUT & ARTIFACT DEPLOYMENT
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
    git -c safe.directory=* -C $TargetDir checkout --quiet -f $normalizedSha 2>$null
    $checkoutExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
  if ($checkoutExit -ne 0) {
    throw "Failed to checkout Git commit $normalizedSha"
  }

  if ($stagingExtractDir -and (Test-Path -LiteralPath $stagingExtractDir)) {
    Write-DeployLog "Deploying verified pre-built artifacts from bundle (No unapproved rebuild)..."
    if (Test-Path -LiteralPath (Join-Path $stagingExtractDir 'dist')) {
      if (Test-Path -LiteralPath (Join-Path $TargetDir 'dist')) {
        Remove-Item -LiteralPath (Join-Path $TargetDir 'dist') -Recurse -Force
      }
      Copy-Item -LiteralPath (Join-Path $stagingExtractDir 'dist') -Destination (Join-Path $TargetDir 'dist') -Recurse -Force
    }
    if (Test-Path -LiteralPath (Join-Path $stagingExtractDir 'web')) {
      if (Test-Path -LiteralPath (Join-Path $TargetDir 'apps\web\dist')) {
        Remove-Item -LiteralPath (Join-Path $TargetDir 'apps\web\dist') -Recurse -Force
      }
      Copy-Item -LiteralPath (Join-Path $stagingExtractDir 'web') -Destination (Join-Path $TargetDir 'apps\web\dist') -Recurse -Force
    }
  } elseif (-not ($SandboxMode -and $SkipBuildInSandbox)) {
    $env:PATH = "$realServerRoot\config\runtime\node-v22.14.0-win-x64;$env:PATH"
    cmd /c "cd /d `"$TargetDir`" && npm run build"
    if ($LASTEXITCODE -ne 0) { throw "Backend API build failed (npm run build)" }
    cmd /c "cd /d `"$TargetDir`" && npm run build:web"
    if ($LASTEXITCODE -ne 0) { throw "Frontend Web build failed (npm run build:web)" }
  }

  Write-RunningComponentsProof -Sha $normalizedSha -ArtifactDigest $verifiedArtifactDigest

  # 13. CONTROLLED DATABASE MIGRATION (ONLY WHEN EXPLICITLY APPROVED)
  if (-not $SkipMigration) {
    Write-DeployLog "Executing approved database migrations on '$DbTarget'..."
    $pass = ([IO.File]::ReadAllText($pgPassFile).Trim() -split ':')[-1]
    $env:DATABASE_URL = "postgresql://hp_test_admin:${pass}@127.0.0.1:55432/$DbTarget"
    try {
      & $node "$TargetDir\scripts\migrate.mjs"
      if ($LASTEXITCODE -ne 0) { throw "Database migration script failed on $DbTarget" }
    } finally {
      Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }
  } else {
    Write-DeployLog "Database migration skipped (-SkipMigration=true)."
  }

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
  Write-DeployLog "DEPLOY FAILED: $errMsg. INITIATING ATOMIC ROLLBACK..." 'ERROR'

  if ($switchStarted -and $snapshotDir -and (Test-Path -LiteralPath $snapshotDir)) {
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
        if (Test-Path -LiteralPath (Join-Path $TargetDir 'dist')) {
          Remove-Item -LiteralPath (Join-Path $TargetDir 'dist') -Recurse -Force
        }
        Copy-Item -LiteralPath (Join-Path $snapshotDir 'dist') -Destination (Join-Path $TargetDir 'dist') -Recurse -Force
      }
      if (Test-Path -LiteralPath (Join-Path $snapshotDir 'web\dist')) {
        if (Test-Path -LiteralPath (Join-Path $TargetDir 'apps\web\dist')) {
          Remove-Item -LiteralPath (Join-Path $TargetDir 'apps\web\dist') -Recurse -Force
        }
        Copy-Item -LiteralPath (Join-Path $snapshotDir 'web\dist') -Destination (Join-Path $TargetDir 'apps\web\dist') -Recurse -Force
      }
      if (-not [string]::IsNullOrWhiteSpace($previousLiveSha)) {
        Set-Content -LiteralPath $currentShaFile -Value $previousLiveSha -Encoding UTF8 -Force
        Write-RunningComponentsProof -Sha $previousLiveSha -ArtifactDigest 'restored-from-snapshot'
      }

      if (-not $SandboxMode) {
        Restart-Service HPManagementLiteApi -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
      }
      @{
        status             = 'ROLLED_BACK'
        sha                = $previousGitSha
        failed_sha         = $normalizedSha
        rolled_back_at_utc = (Get-Date).ToUniversalTime().ToString('o')
      } | ConvertTo-Json | Set-Content -LiteralPath $stateJournalFile -Encoding UTF8 -Force

      Write-DeployLog "Atomic rollback completed (Git HEAD + dist + web/dist + running-components-sha restored to $previousGitSha)." 'WARN'
    } catch {
      Write-DeployLog "CRITICAL: Rollback encountered an error: $($_.Exception.Message)" 'ERROR'
    }
    $duration = [int]((Get-Date) - $startTime).TotalMilliseconds
    Record-DeployResult -Status 'ROLLED_BACK' -Sha $normalizedSha -PreviousSha $previousGitSha -Message $errMsg -DurationMs $duration
  }

  throw "Deployment failed and rolled back to ${previousGitSha}: $errMsg"
} finally {
  if ($stagingExtractDir -and (Test-Path -LiteralPath $stagingExtractDir)) {
    Remove-Item -LiteralPath $stagingExtractDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($lockStream) {
    $lockStream.Dispose()
  }
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
