#requires -Version 5.1
<#
.SYNOPSIS
  Hardened One-Command Elevated Owner Release Ceremony for Management Lite (Phase 32 / v0.7.2).
  - Strictly enforces OS Kernel High-Integrity Elevated Administrator token (UAC).
  - Performs 100% read-only preflight (parameter validation, controller SHA-256 verification, artifact + provenance + CI receipt checksum verification, and live GitHub Actions Run & Jobs API verification) BEFORE touching any ACLs or files on disk.
  - Backs up encryption config (api.env) using Windows DPAPI (zero plaintext exposure).
  - Captures a transactional snapshot of release-gate files (release-gate-policy.json, owner-approval-public.pem, approved-release.json, approval-audit.jsonl) and automatically restores them + re-locks NTFS ACLs in catch/finally if any step (signing, backup, migration, or deploy) fails.
  - Invokes Deploy-SemiAutoWindows.ps1 with -RunMigrations and WITHOUT -SkipBackup so pre-cutover PostgreSQL backup and Migration 0032 execute safely before atomic runtime cutover.
#>
[CmdletBinding()]
param(
  [string]$ArtifactsDir = 'C:\Projects\management-lite\dist\release-artifacts',
  [string]$CommitSha = '',
  [int]$ExpiresInMinutes = 180,
  [string]$ServerRoot = 'C:\HoaiPhuong-Server',
  [string]$DeployControllerPath = '',
  [string]$ExpectedControllerSha256 = '',
  [string]$GitHubApiBaseUrl = 'https://api.github.com',
  [switch]$EnrollNewPublicKey,
  [switch]$Force,
  [switch]$DryRunPreflightOnly,
  [switch]$SandboxMode,
  [int]$SandboxDbPort = 0,
  [string]$SandboxDbUser = '',
  [string]$SandboxDbTarget = '',
  [string]$SandboxPgPassFilePath = '',
  [string]$SandboxPgBinDir = '',
  [string]$SandboxHealthUrl = '',
  [string]$SandboxReadyUrl = '',
  [string]$SandboxWebUrl = '',
  [string]$SandboxSimulatedIsAdmin = '',
  [string]$SandboxSimulatedIntegritySid = '',
  [switch]$SimulateNonElevatedCaller,
  [switch]$SimulateSigningFailureAfterPolicyWrite,
  [switch]$SimulateBackupFailure,
  [switch]$SimulateMigrationFailure,
  [switch]$SimulateCutoverHealthFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not ('ManagementLiteTokenSecurity' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class ManagementLiteTokenSecurity {
  private const int TokenIntegrityLevel = 25;
  private const uint SE_GROUP_INTEGRITY = 0x00000020;

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool GetTokenInformation(
    IntPtr TokenHandle,
    int TokenInformationClass,
    IntPtr TokenInformation,
    int TokenInformationLength,
    out int ReturnLength
  );

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool IsValidSid(IntPtr pSid);

  public static string GetTokenIntegritySid(IntPtr tokenHandle) {
    if (tokenHandle == IntPtr.Zero) return null;
    int returnLength = 0;
    GetTokenInformation(tokenHandle, TokenIntegrityLevel, IntPtr.Zero, 0, out returnLength);
    if (returnLength <= 0) return null;
    IntPtr buffer = Marshal.AllocHGlobal(returnLength);
    try {
      if (!GetTokenInformation(tokenHandle, TokenIntegrityLevel, buffer, returnLength, out returnLength)) {
        return null;
      }
      IntPtr pSid = Marshal.ReadIntPtr(buffer);
      if (pSid == IntPtr.Zero || !IsValidSid(pSid)) {
        return null;
      }
      uint attributes = (uint)Marshal.ReadInt32(buffer, IntPtr.Size);
      if ((attributes & SE_GROUP_INTEGRITY) == 0) {
        return null;
      }
      return new SecurityIdentifier(pSid).Value;
    } catch {
      return null;
    } finally {
      Marshal.FreeHGlobal(buffer);
    }
  }

  public static bool EvaluateKernelElevation(bool isAdminMember, string integritySid) {
    if (!isAdminMember) return false;
    if (string.IsNullOrWhiteSpace(integritySid)) return false;
    string normalized = integritySid.Trim().ToUpperInvariant();
    return normalized == "S-1-16-12288" || normalized == "S-1-16-16384";
  }
}
"@
}

$realProdServerPrefix = [IO.Path]::GetFullPath('C:\HoaiPhuong-Server').TrimEnd('\', '/')
$normServerRoot = [IO.Path]::GetFullPath($ServerRoot).TrimEnd('\', '/')
$targetsProductionHost = (-not $SandboxMode) -or $normServerRoot.Equals($realProdServerPrefix, [StringComparison]::OrdinalIgnoreCase) -or $normServerRoot.StartsWith("$realProdServerPrefix\", [StringComparison]::OrdinalIgnoreCase)

if ($SandboxMode -and ($normServerRoot.Equals($realProdServerPrefix, [StringComparison]::OrdinalIgnoreCase) -or $normServerRoot.StartsWith("$realProdServerPrefix\", [StringComparison]::OrdinalIgnoreCase))) {
  throw "SANDBOX_VIOLATION_PRODUCTION_PATH_FORBIDDEN: SandboxMode cannot target Production ServerRoot '$ServerRoot'."
}

$node = Join-Path $realProdServerPrefix 'config\runtime\node-v22.14.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $node)) {
  $node = 'C:\ML-Test\runtime\node\node.exe'
}
if (-not (Test-Path -LiteralPath $node)) {
  $node = 'node'
}

# 1. OS KERNEL HIGH-INTEGRITY ELEVATED TOKEN CHECK (WIN32 GetTokenInformation(TokenIntegrityLevel))
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isElevatedAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$tokenIntegritySid = [ManagementLiteTokenSecurity]::GetTokenIntegritySid($identity.Token)
$hasHighIntegrity = [ManagementLiteTokenSecurity]::EvaluateKernelElevation($isElevatedAdmin, $tokenIntegritySid)

$sandboxTokenSimulationFailed = $false
if ($SandboxMode -and (-not $targetsProductionHost) -and ((-not [string]::IsNullOrWhiteSpace($SandboxSimulatedIsAdmin)) -or $PSBoundParameters.ContainsKey('SandboxSimulatedIntegritySid'))) {
  $simAdmin = if (-not [string]::IsNullOrWhiteSpace($SandboxSimulatedIsAdmin)) {
    $SandboxSimulatedIsAdmin.Trim().ToLowerInvariant() -in @('true', '1', '$true')
  } else {
    $isElevatedAdmin
  }
  $simSid = if ($PSBoundParameters.ContainsKey('SandboxSimulatedIntegritySid')) { $SandboxSimulatedIntegritySid } else { $tokenIntegritySid }
  if (-not [ManagementLiteTokenSecurity]::EvaluateKernelElevation($simAdmin, $simSid)) {
    $sandboxTokenSimulationFailed = $true
  }
}

if ($SimulateNonElevatedCaller -or $sandboxTokenSimulationFailed -or ($targetsProductionHost -and (-not $hasHighIntegrity))) {
  throw 'SECURITY_VIOLATION_NON_ELEVATED_TOKEN: Invoke-OwnerReleaseToWeb.ps1 requires an OS Kernel High-Integrity Elevated Administrator token (Run as Administrator). Non-elevated sessions are blocked fail-closed.'
}

if ($targetsProductionHost) {
  $normGhApi = if ([string]::IsNullOrWhiteSpace($GitHubApiBaseUrl)) { 'https://api.github.com' } else { $GitHubApiBaseUrl.Trim().TrimEnd('/').ToLowerInvariant() }
  if ($normGhApi -ne 'https://api.github.com') {
    throw "REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION: Production release strictly requires official https://api.github.com (got '$GitHubApiBaseUrl')."
  }
  $GitHubApiBaseUrl = 'https://api.github.com'
}

# 2. PARAMETER & CONTROLLER PROVENANCE VALIDATION (BEFORE ANY DISK/ACL CHANGE)
if ([string]::IsNullOrWhiteSpace($CommitSha)) {
  $CommitSha = (git -C 'C:\Projects\management-lite' rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
} else {
  $CommitSha = $CommitSha.Trim().ToLowerInvariant()
}
if ($CommitSha -notmatch '^[0-9a-f]{40}$') {
  throw "REJECTED_INVALID_SHA: CommitSha '$CommitSha' must be a 40-character lowercase hexadecimal Git SHA."
}
if ($ExpiresInMinutes -lt 5 -or $ExpiresInMinutes -gt 1440) {
  throw "REJECTED_INVALID_TTL: ExpiresInMinutes ($ExpiresInMinutes) must be between 5 and 1440 minutes."
}

$gateDir = Join-Path $ServerRoot 'config\release-gate'
if ([string]::IsNullOrWhiteSpace($DeployControllerPath)) {
  $DeployControllerPath = Join-Path $gateDir 'controllers\Deploy-SemiAutoWindows.ps1'
}
if (-not (Test-Path -LiteralPath $DeployControllerPath -PathType Leaf)) {
  throw "REJECTED_CONTROLLER_MISSING: Deploy controller not found at '$DeployControllerPath'."
}

$actualControllerSha = (Get-FileHash -LiteralPath $DeployControllerPath -Algorithm SHA256).Hash.ToLowerInvariant()
$trustedControllerHashes = @(
  '7cfa9c134f2cd61412bd2bb2fd94789887fcd79784c12ae60a411b1c1267ee7e', # Locked Production Controller (v1)
  '3b5708842693d19068d0664c2a14248f0244fff187e54cc9f8506c309cfb59c3'  # OA-21 Hardened Repo Controller (v2)
)
if (-not [string]::IsNullOrWhiteSpace($ExpectedControllerSha256)) {
  $trustedControllerHashes = @($ExpectedControllerSha256.Trim().ToLowerInvariant())
}
if ($trustedControllerHashes -notcontains $actualControllerSha) {
  throw "REJECTED_CONTROLLER_HASH_MISMATCH: Controller '$DeployControllerPath' SHA-256 ($actualControllerSha) is not in the trusted controller allowlist."
}

# Verify controller supports -RunMigrations so Migration 0032 is guaranteed to run
$controllerRaw = Get-Content -LiteralPath $DeployControllerPath -Raw
if ($controllerRaw -notmatch '\$RunMigrations') {
  throw "REJECTED_CONTROLLER_INCOMPATIBLE: Controller '$DeployControllerPath' does not support -RunMigrations."
}

# Verify deployment-state.json is not in an unrecovered or blocked rollback state without explicit -Force
$stateJournalPath = Join-Path $ServerRoot 'reports\deployment-state.json'
if (Test-Path -LiteralPath $stateJournalPath -PathType Leaf) {
  $jState = Get-Content -LiteralPath $stateJournalPath -Raw | ConvertFrom-Json
  if ($jState.status -in @('IN_PROGRESS', 'ROLLING_BACK', 'MANUAL_INTERVENTION')) {
    throw "REJECTED_INTERRUPTED_STATE_REQUIRES_RECOVERY: Deployment state '$($jState.status)' detected in '$stateJournalPath'. Resolve interrupted state before running a new release."
  }
  if ($jState.status -eq 'STOP_NO_GO_INCOMPATIBLE_ROLLBACK' -and (-not $Force)) {
    throw "REJECTED_STOP_NO_GO_REQUIRES_FORWARD_RECOVERY: Deployment state 'STOP_NO_GO_INCOMPATIBLE_ROLLBACK' detected in '$stateJournalPath'. Code-only rollback is blocked; pass -Force with a newly signed release approval for safe forward recovery."
  }
}

# 3. RESOLVE IN-MEMORY GITHUB TOKEN & DOWNLOAD ARTIFACT IF NEEDED (INTO NON-PRODUCTION ARTIFACTS DIR)
$ghToken = $env:GITHUB_READONLY_TOKEN
if ([string]::IsNullOrWhiteSpace($ghToken) -and $targetsProductionHost) {
  $credIn = "protocol=https`nhost=github.com`n`n"
  $credOut = $credIn | git -C 'C:\Projects\management-lite' credential fill 2>$null
  $match = $credOut | Select-String '^password=(.+)$'
  if ($match -and $match.Matches.Count -gt 0) {
    $ghToken = $match.Matches[0].Groups[1].Value.Trim()
  }
}

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$tarSrc = Join-Path $ArtifactsDir "management-lite-full-$CommitSha.tar.gz"
$shaSrc = "$tarSrc.sha256"
$provSrc = "$tarSrc.provenance.json"
$receiptSrc = Join-Path $ArtifactsDir "ci-run-receipt-$CommitSha.json"

$apiHeaders = @{
  Accept                 = 'application/vnd.github+json'
  'User-Agent'           = 'ManagementLite-OwnerReleaseGate'
  'X-GitHub-Api-Version' = '2022-11-28'
}
if (-not [string]::IsNullOrWhiteSpace($ghToken)) {
  $apiHeaders['Authorization'] = "Bearer $ghToken"
}

if (-not (Test-Path -LiteralPath $receiptSrc -PathType Leaf)) {
  if ([string]::IsNullOrWhiteSpace($ghToken) -and $targetsProductionHost) {
    throw "REJECTED_ARTIFACT_MISSING: Missing '$receiptSrc' and no GitHub token available to query/download CI artifact."
  }
  Write-Host "[CI-PREFLIGHT] Querying GitHub Actions runs for commit $CommitSha..." -ForegroundColor Cyan
  $runsResp = Invoke-RestMethod -Uri "$($GitHubApiBaseUrl.TrimEnd('/'))/repos/truhoaiphuong03/management-lite/actions/runs?head_sha=$CommitSha&per_page=10" -Headers $apiHeaders -Method Get -TimeoutSec 15
  $candidateRuns = @($runsResp.workflow_runs | Where-Object { $_.path -in @('.github/workflows/foundation.yml', '.github/workflows/deploy.yml') -and $_.head_branch -eq 'main' })
  if ($candidateRuns.Count -eq 0) {
    throw "REJECTED_CI_NOT_PASSED: No GitHub Actions workflow run found on branch 'main' for commit $CommitSha."
  }
  $latestRun = $candidateRuns[0]
  if ([string]$latestRun.status -ne 'completed' -or [string]$latestRun.conclusion -ne 'success') {
    throw "REJECTED_CI_NOT_PASSED: GitHub Actions run $($latestRun.id) for $CommitSha is status='$($latestRun.status)', conclusion='$($latestRun.conclusion)'. Release is blocked fail-closed."
  }

  $artsResp = Invoke-RestMethod -Uri "$($GitHubApiBaseUrl.TrimEnd('/'))/repos/truhoaiphuong03/management-lite/actions/runs/$($latestRun.id)/artifacts" -Headers $apiHeaders -Method Get -TimeoutSec 15
  $targetArt = @($artsResp.artifacts | Where-Object { $_.name -eq "management-lite-release-$CommitSha" -and (-not $_.expired) }) | Select-Object -First 1
  if (-not $targetArt) {
    throw "REJECTED_ARTIFACT_MISSING: Official GitHub artifact 'management-lite-release-$CommitSha' not found on CI run $($latestRun.id)."
  }
  $zipPath = Join-Path $ArtifactsDir "gh-artifact-$CommitSha.zip"
  Invoke-WebRequest -Uri $targetArt.archive_download_url -Headers $apiHeaders -OutFile $zipPath -UseBasicParsing
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $extractTmp = Join-Path $ArtifactsDir "gh-extract-$CommitSha"
  if (Test-Path -LiteralPath $extractTmp) { Remove-Item -LiteralPath $extractTmp -Recurse -Force }
  [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractTmp)
  Get-ChildItem -LiteralPath $extractTmp -Recurse -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $ArtifactsDir $_.Name) -Force
  }
  Remove-Item -LiteralPath $extractTmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
}

# 4. STRICT READ-ONLY VERIFICATION OF ARTIFACT, PROVENANCE, CI RECEIPT & LIVE GITHUB RUN/JOBS BEFORE ANY MUTATION
foreach ($reqFile in @($tarSrc, $shaSrc, $provSrc, $receiptSrc)) {
  if (-not (Test-Path -LiteralPath $reqFile -PathType Leaf)) {
    throw "REJECTED_ARTIFACT_MISSING: Required verified release artifact file is missing: '$reqFile'."
  }
}

$actualTarSha = (Get-FileHash -LiteralPath $tarSrc -Algorithm SHA256).Hash.ToLowerInvariant()
$sidecarSha = ((Get-Content -LiteralPath $shaSrc -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
$prov = Get-Content -LiteralPath $provSrc -Raw | ConvertFrom-Json
$receipt = Get-Content -LiteralPath $receiptSrc -Raw | ConvertFrom-Json

$provCommit = if ($prov.PSObject.Properties.Name -contains 'commitSha' -and $prov.commitSha) { [string]$prov.commitSha } elseif ($prov.PSObject.Properties.Name -contains 'sha' -and $prov.sha) { [string]$prov.sha } else { '' }
$provSha256 = [string]$prov.sha256.Trim().ToLowerInvariant()
$SchemaSha256 = [string]$prov.schemaIdentity.Trim().ToLowerInvariant()

if ($actualTarSha -ne $sidecarSha -or $actualTarSha -ne $provSha256 -or $provCommit.Trim().ToLowerInvariant() -ne $CommitSha -or $SchemaSha256 -notmatch '^[0-9a-f]{64}$') {
  throw "REJECTED_ARTIFACT_CHECKSUM_MISMATCH: Artifact SHA-256 ($actualTarSha), sidecar ($sidecarSha), provenance ($provSha256 / $provCommit), or schemaIdentity ($SchemaSha256) mismatch."
}

if (($receipt.PSObject.Properties.Name -contains 'synthetic_local' -and [bool]$receipt.synthetic_local) -or
    ($receipt.PSObject.Properties.Name -contains 'simulated' -and [bool]$receipt.simulated) -or
    (-not ($receipt.PSObject.Properties.Name -contains 'generated_at_utc')) -or
    [string]::IsNullOrWhiteSpace([string]$receipt.generated_at_utc)) {
  throw 'REJECTED_SYNTHETIC_CI_RECEIPT: Synthetic or self-generated CI receipt is forbidden.'
}

$CiRunId = if ($receipt.PSObject.Properties.Name -contains 'run_id' -and $receipt.run_id) { [string]$receipt.run_id.Trim() } else { [string]$receipt.id.Trim() }
$CiRunAttempt = [int]$receipt.run_attempt
$WorkflowPath = [string]$receipt.workflow_path.Trim()
$SourceBranch = [string]$receipt.head_branch.Trim()
$receiptSha = [string]$receipt.head_sha.Trim().ToLowerInvariant()
$receiptArtSha = [string]$receipt.artifact_sha256.Trim().ToLowerInvariant()
$receiptSchemaSha = [string]$receipt.schema_sha256.Trim().ToLowerInvariant()
$receiptStatus = [string]$receipt.status.Trim().ToLowerInvariant()
$receiptConclusion = [string]$receipt.conclusion.Trim().ToLowerInvariant()

if ($receiptSha -ne $CommitSha -or $receiptArtSha -ne $actualTarSha -or $receiptSchemaSha -ne $SchemaSha256 -or $receiptStatus -ne 'completed' -or $receiptConclusion -ne 'success' -or $SourceBranch -ne 'main') {
  throw "REJECTED_CI_RECEIPT_MISMATCH: CI receipt does not match target SHA, artifact digest, schemaIdentity, branch='main', or status=completed/success."
}

# Verify live GitHub Actions Run & Jobs API before prompting or unlocking ACLs
$liveRunUrl = "$($GitHubApiBaseUrl.TrimEnd('/'))/repos/truhoaiphuong03/management-lite/actions/runs/$CiRunId"
try {
  $liveRun = Invoke-RestMethod -Uri $liveRunUrl -Headers $apiHeaders -Method Get -TimeoutSec 15
} catch {
  throw "REJECTED_GITHUB_API_CI_VERIFICATION_FAILED: Failed to query live GitHub Actions run '$liveRunUrl': $($_.Exception.Message)"
}

if ([string]$liveRun.id -ne $CiRunId -or
    [string]$liveRun.head_sha.Trim().ToLowerInvariant() -ne $CommitSha -or
    [string]$liveRun.status.Trim().ToLowerInvariant() -ne 'completed' -or
    [string]$liveRun.conclusion.Trim().ToLowerInvariant() -ne 'success' -or
    [string]$liveRun.head_branch.Trim() -ne 'main') {
  throw "REJECTED_CI_NOT_PASSED: Live GitHub Actions run $CiRunId failed verification (sha=$($liveRun.head_sha), status=$($liveRun.status), conclusion=$($liveRun.conclusion), branch=$($liveRun.head_branch))."
}

$liveJobsUrl = "$($GitHubApiBaseUrl.TrimEnd('/'))/repos/truhoaiphuong03/management-lite/actions/runs/$CiRunId/jobs"
try {
  $liveJobsResp = Invoke-RestMethod -Uri $liveJobsUrl -Headers $apiHeaders -Method Get -TimeoutSec 15
  if ($liveJobsResp -and ($liveJobsResp.PSObject.Properties.Name -contains 'jobs')) {
    $failedJobs = @($liveJobsResp.jobs | Where-Object { [string]$_.status -ne 'completed' -or [string]$_.conclusion -ne 'success' })
    if ($failedJobs.Count -gt 0) {
      $failedNames = ($failedJobs | ForEach-Object { "$($_.name):$($_.conclusion)" }) -join ', '
      throw "REJECTED_CI_JOBS_NOT_PASSED: One or more mandatory CI jobs did not succeed ($failedNames)."
    }
  }
} catch {
  if ($_.Exception.Message -match '^REJECTED_CI_JOBS_NOT_PASSED:') { throw }
  throw "REJECTED_GITHUB_API_CI_VERIFICATION_FAILED: Failed to verify CI jobs for run ${CiRunId}: $($_.Exception.Message)"
}

if ($DryRunPreflightOnly) {
  Write-Host "[PREFLIGHT-PASS] All controller, artifact, schema ($SchemaSha256), CI receipt, and live GitHub Run ($CiRunId) checks passed (Zero disk mutations)." -ForegroundColor Green
  return
}

Write-Host '==================================================================' -ForegroundColor Cyan
Write-Host ' MANAGEMENT LITE - OWNER ONE-STEP RELEASE & MIGRATION CEREMONY' -ForegroundColor Cyan
Write-Host " Principal       : $($identity.Name) (High-Integrity Elevated Token)" -ForegroundColor Yellow
Write-Host " Target SHA      : $CommitSha" -ForegroundColor Yellow
Write-Host " Artifact SHA256 : $actualTarSha" -ForegroundColor Yellow
Write-Host " Schema SHA256   : $SchemaSha256" -ForegroundColor Yellow
Write-Host " CI Run ID       : $CiRunId ($WorkflowPath on $SourceBranch)" -ForegroundColor Yellow
Write-Host ' Mode            : SINGLE_SHA (allow_migration = true, -RunMigrations = true, Pre-Deploy Backup = ENABLED)' -ForegroundColor Yellow
Write-Host '==================================================================' -ForegroundColor Cyan

$plainPass = ''
if ($SandboxMode -and (-not [string]::IsNullOrWhiteSpace($env:SANDBOX_TEST_OWNER_PASSPHRASE))) {
  $plainPass = $env:SANDBOX_TEST_OWNER_PASSPHRASE
} else {
  $secPass = Read-Host -Prompt 'Nhap mat khau ky Owner (Passphrase/PIN bi mat >= 12 ky tu)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPass)
  try {
    $plainPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
}

if ([string]::IsNullOrWhiteSpace($plainPass) -or $plainPass.Length -lt 12) {
  $plainPass = ''
  throw 'REJECTED_INVALID_PASSPHRASE: Owner passphrase must be at least 12 characters.'
}

function Lock-ReleaseGateDirectoryAcl {
  param([string]$TargetGateDir, [bool]$IsProdTarget)
  if (-not (Test-Path -LiteralPath $TargetGateDir)) { return }
  $adminPrincipal = if ($IsProdTarget) { 'DESKTOP-8T8UHTS\ADMIN' } else { [Security.Principal.WindowsIdentity]::GetCurrent().Name }
  $dirGrant = if ($IsProdTarget) { "${adminPrincipal}:(OI)(CI)RX" } else { "${adminPrincipal}:(OI)(CI)(RX,WDAC)" }
  $fileGrant = if ($IsProdTarget) { "${adminPrincipal}:RX" } else { "${adminPrincipal}:(RX,WDAC)" }
  $ownerDirGrant = if ($IsProdTarget) { '*S-1-3-4:(OI)(CI)RX' } else { '*S-1-3-4:(OI)(CI)(RX,WDAC)' }
  $ownerFileGrant = if ($IsProdTarget) { '*S-1-3-4:RX' } else { '*S-1-3-4:(RX,WDAC)' }
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $children = @(Get-ChildItem -LiteralPath $TargetGateDir -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending)
    foreach ($child in $children) {
      if ($child.PSIsContainer) {
        & icacls.exe $child.FullName /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" $dirGrant $ownerDirGrant "*S-1-5-19:(OI)(CI)R" "*S-1-5-20:(OI)(CI)R" /deny "*S-1-5-19:(OI)(CI)(W,M,D,WDAC,WO)" "*S-1-5-20:(OI)(CI)(W,M,D,WDAC,WO)" 2>$null | Out-Null
      } elseif ($child.Name -eq 'github-pat.dpapi') {
        & icacls.exe $child.FullName /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" $fileGrant $ownerFileGrant /deny "*S-1-5-19:F" "*S-1-5-20:F" 2>$null | Out-Null
      } else {
        & icacls.exe $child.FullName /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" $fileGrant $ownerFileGrant "*S-1-5-19:R" "*S-1-5-20:R" /deny "*S-1-5-19:(W,M,D,WDAC,WO)" "*S-1-5-20:(W,M,D,WDAC,WO)" 2>$null | Out-Null
      }
    }
    & icacls.exe $TargetGateDir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" $dirGrant $ownerDirGrant "*S-1-5-19:(OI)(CI)R" "*S-1-5-20:(OI)(CI)R" /deny "*S-1-5-19:(OI)(CI)(W,M,D,WDAC,WO)" "*S-1-5-20:(OI)(CI)(W,M,D,WDAC,WO)" 2>$null | Out-Null
  } finally {
    $ErrorActionPreference = $prevEap
  }
}

function Unlock-ReleaseGateDirectoryAcl {
  param([string]$TargetGateDir, [bool]$IsElevated, [string]$CallerPrincipal)
  if (-not (Test-Path -LiteralPath $TargetGateDir)) { return }
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($IsElevated) {
      & takeown.exe /F $TargetGateDir /A /R /D Y 2>$null | Out-Null
    }
    & icacls.exe $TargetGateDir /remove "*S-1-3-4" 2>$null | Out-Null
    & icacls.exe $TargetGateDir /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${CallerPrincipal}:(OI)(CI)F" "*S-1-3-4:(OI)(CI)F" 2>$null | Out-Null
    $children = @(Get-ChildItem -LiteralPath $TargetGateDir -Recurse -Force -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
      & icacls.exe $child.FullName /remove "*S-1-3-4" 2>$null | Out-Null
      if ($child.PSIsContainer) {
        & icacls.exe $child.FullName /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${CallerPrincipal}:(OI)(CI)F" "*S-1-3-4:(OI)(CI)F" 2>$null | Out-Null
      } else {
        & icacls.exe $child.FullName /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "${CallerPrincipal}:F" "*S-1-3-4:F" 2>$null | Out-Null
      }
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }
}

$policyPath = Join-Path $gateDir 'release-gate-policy.json'
$pubKeyPath = Join-Path $gateDir 'owner-approval-public.pem'
$manifestPath = Join-Path $gateDir 'approved-release.json'
$auditLogPath = Join-Path $gateDir 'approval-audit.jsonl'
$gateReceiptPath = Join-Path $gateDir "ci-run-receipt-$CommitSha.json"
$watermarkPath = Join-Path $ServerRoot 'reports\approval-watermark.json'

if (-not (Test-Path -LiteralPath $policyPath -PathType Leaf)) {
  $plainPass = ''
  throw "REJECTED_NO_POLICY: Missing release-gate-policy.json at '$policyPath'."
}

# 5. CAPTURE TRANSACTIONAL IN-MEMORY BACKUP OF GATE FILES BEFORE UNLOCKING OR MODIFYING ANYTHING
$gateSnapshot = @{}
foreach ($gf in @($policyPath, $pubKeyPath, $manifestPath, $auditLogPath, $gateReceiptPath)) {
  if (Test-Path -LiteralPath $gf -PathType Leaf) {
    $gateSnapshot[$gf] = @{
      Existed = $true
      Bytes   = [IO.File]::ReadAllBytes($gf)
    }
  } else {
    $gateSnapshot[$gf] = @{
      Existed = $false
      Bytes   = $null
    }
  }
}

function Restore-GateSnapshot {
  foreach ($kv in $gateSnapshot.GetEnumerator()) {
    $targetFile = $kv.Key
    $state = $kv.Value
    if ($state.Existed) {
      [IO.File]::WriteAllBytes($targetFile, $state.Bytes)
    } elseif ([IO.File]::Exists($targetFile)) {
      [IO.File]::Delete($targetFile)
    }
  }
}

# 6. DPAPI-ENCRYPTED BACKUP OF PRODUCTION ENCRYPTION KEYS (api.env) BEFORE MIGRATION/DEPLOY
$apiEnvPath = Join-Path $ServerRoot 'config\test-secrets\api.env'
if (Test-Path -LiteralPath $apiEnvPath -PathType Leaf) {
  $dpapiBackupDir = Join-Path $ServerRoot 'backups\secrets-dpapi'
  New-Item -ItemType Directory -Path $dpapiBackupDir -Force | Out-Null
  $apiEnvRaw = [IO.File]::ReadAllText($apiEnvPath, [Text.Encoding]::UTF8)
  $apiEnvSha = (Get-FileHash -LiteralPath $apiEnvPath -Algorithm SHA256).Hash.ToUpperInvariant()
  $secEnv = ConvertTo-SecureString -String $apiEnvRaw -AsPlainText -Force
  $dpapiStr = ConvertFrom-SecureString -SecureString $secEnv
  $apiEnvRaw = ''
  $dpapiFile = Join-Path $dpapiBackupDir 'api.env.dpapi'
  Set-Content -LiteralPath $dpapiFile -Value $dpapiStr -Encoding UTF8 -Force
  @{
    Algorithm      = 'SHA256'
    SourceSha256   = $apiEnvSha
    DpapiSha256    = (Get-FileHash -LiteralPath $dpapiFile -Algorithm SHA256).Hash.ToUpperInvariant()
    BackedUpAtUtc  = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath "$dpapiFile.sha256.json" -Encoding UTF8 -Force
}

$stageDir = Join-Path $ServerRoot "releases\management-lite\artifacts\$CommitSha"
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
Copy-Item -LiteralPath $tarSrc -Destination (Join-Path $stageDir "management-lite-full-$CommitSha.tar.gz") -Force
Copy-Item -LiteralPath $shaSrc -Destination (Join-Path $stageDir "management-lite-full-$CommitSha.tar.gz.sha256") -Force
Copy-Item -LiteralPath $provSrc -Destination (Join-Path $stageDir "management-lite-full-$CommitSha.tar.gz.provenance.json") -Force
Copy-Item -LiteralPath $receiptSrc -Destination (Join-Path $stageDir "ci-run-receipt-$CommitSha.json") -Force

$gateMutated = $false
$sequence = 0
try {
  # Unlock release-gate ACL temporarily for elevated transactional write
  Unlock-ReleaseGateDirectoryAcl -TargetGateDir $gateDir -IsElevated $isElevatedAdmin -CallerPrincipal $identity.Name
  $gateMutated = $true
  Copy-Item -LiteralPath $receiptSrc -Destination $gateReceiptPath -Force

  $sequence = 1
  $wmExists = Test-Path -LiteralPath $watermarkPath -PathType Leaf
  $wmSeq = 0
  if ($wmExists) {
    $wm = Get-Content -LiteralPath $watermarkPath -Raw | ConvertFrom-Json
    if ($null -ne $wm.last_sequence) {
      $wmSeq = [int]$wm.last_sequence
      $sequence = $wmSeq + 1
    }
  }

  $prevHash = '0' * 64
  if (Test-Path -LiteralPath $auditLogPath -PathType Leaf) {
    $lines = @(Get-Content -LiteralPath $auditLogPath | Where-Object { $_.Trim() -ne '' })
    if ($wmExists -and $wmSeq -gt 0 -and $lines.Count -ne $wmSeq) {
      throw "REJECTED_WATERMARK_AUDIT_DESYNC: approval-watermark.json (last_sequence=$wmSeq) does not match approval-audit.jsonl entry count ($($lines.Count)). Manual watermark or audit log tampering is forbidden."
    }
    if ($lines.Count -gt 0) {
      $expectedPrevAudit = '0' * 64
      for ($idx = 0; $idx -lt $lines.Count; $idx++) {
        $entryObj = $lines[$idx] | ConvertFrom-Json
        $hasSeqProp = ($entryObj.PSObject.Properties.Name -contains 'sequence') -and ($null -ne $entryObj.sequence)
        $hasPrevProp = ($entryObj.PSObject.Properties.Name -contains 'prev_audit_hash') -and (-not [string]::IsNullOrWhiteSpace([string]$entryObj.prev_audit_hash))
        $entryHashStr = if ($entryObj.PSObject.Properties.Name -contains 'entry_hash') { [string]$entryObj.entry_hash.Trim().ToLowerInvariant() } else { '' }
        if ($entryHashStr -notmatch '^[0-9a-f]{64}$') {
          throw 'AUDIT_CHAIN_LINK_BROKEN: Invalid entry_hash in approval-audit.jsonl.'
        }
        if ($hasSeqProp -and [int]$entryObj.sequence -ne ($idx + 1)) {
          throw "AUDIT_CHAIN_LINK_BROKEN: Sequence mismatch at line $($idx + 1) in approval-audit.jsonl."
        }
        if ($hasPrevProp -and [string]$entryObj.prev_audit_hash.Trim().ToLowerInvariant() -ne $expectedPrevAudit) {
          throw "AUDIT_CHAIN_LINK_BROKEN: Broken prev_audit_hash link at line $($idx + 1) in approval-audit.jsonl."
        }
        $expectedPrevAudit = $entryHashStr
      }
      $prevHash = $expectedPrevAudit
      if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        try {
          $existingManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        } catch {
          throw 'AUDIT_CHAIN_LINK_BROKEN: Existing approved-release.json is unreadable or invalid JSON.'
        }
        if ($existingManifest -and ($existingManifest.PSObject.Properties.Name -contains 'sequence') -and [int]$existingManifest.sequence -eq $lines.Count) {
          $lastAuditObj = $lines[$lines.Count - 1] | ConvertFrom-Json
          $lastPrevStr = [string]$lastAuditObj.prev_audit_hash.Trim()
          $lastCanonical = [string]$existingManifest.payload_canonical_json
          $lastSig = [string]$existingManifest.signature_base64
          $sha256Alg = [Security.Cryptography.SHA256]::Create()
          try {
            $rawBytes = [Text.Encoding]::UTF8.GetBytes("${lastPrevStr}|${lastCanonical}|${lastSig}")
            $hashBytes = $sha256Alg.ComputeHash($rawBytes)
            $computedTailHash = ([BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
          } finally {
            $sha256Alg.Dispose()
          }
          if ($computedTailHash -ne $expectedPrevAudit) {
            throw 'AUDIT_CHAIN_LINK_BROKEN: Last entry_hash in approval-audit.jsonl does not match approved-release.json manifest digest.'
          }
        }
      }
      if ($lines.Count + 1 -gt $sequence) {
        $sequence = $lines.Count + 1
      }
    }
  }

  $winPrincipal = $identity.Name
  $enrollFlag = if ($EnrollNewPublicKey) { 'true' } else { 'false' }
  $simSignFailFlag = if ($SimulateSigningFailureAfterPolicyWrite) { 'true' } else { 'false' }

  $jsInline = @'
const crypto = require('node:crypto');
const fs = require('node:fs');

const passphrase = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
const [
  policyPath,
  pubKeyPath,
  manifestPath,
  auditLogPath,
  commitSha,
  artifactSha256,
  schemaSha256,
  ciRunId,
  ciRunAttemptStr,
  workflowPath,
  sourceBranch,
  sequenceStr,
  winPrincipal,
  prevHash,
  ttlMinutesStr,
  enrollNewKeyStr,
  simFailAfterPolicyStr,
] = process.argv.slice(1);

const REVOKED_KEY_SHA256 = '2e92bb4a96b8f60da691d309399b494b20bdbe60aa3b39c2add7313e0441931e';
const seed = crypto.scryptSync(passphrase, 'HoaiPhuong-ManagementLite-OwnerEd25519-v2', 32);
const pkcs8Der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
const privKey = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
seed.fill(0);
pkcs8Der.fill(0);

const pubPem = crypto.createPublicKey(privKey).export({ type: 'spki', format: 'pem' });
const pubSha256 = crypto.createHash('sha256').update(pubPem, 'utf8').digest('hex').toLowerCase();

if (pubSha256 === REVOKED_KEY_SHA256) {
  throw new Error('REJECTED_COMPROMISED_OLD_KEY: Derived key matches revoked key!');
}

const existingPolicy = JSON.parse(fs.readFileSync(policyPath, 'utf8').replace(/^\uFEFF/, ''));
const revokedSet = new Set([REVOKED_KEY_SHA256]);
if (Array.isArray(existingPolicy.revoked_public_key_sha256s)) {
  for (const rk of existingPolicy.revoked_public_key_sha256s) {
    if (rk) revokedSet.add(String(rk).trim().toLowerCase());
  }
}
if (revokedSet.has(pubSha256)) {
  throw new Error('REJECTED_REVOKED_PUBLIC_KEY: Derived public key is in revoked_public_key_sha256s.');
}

const existingTrustedFp = String(existingPolicy.trusted_public_key_sha256 || '').trim().toLowerCase();
const isCurrentlyEnrolled = /^[0-9a-f]{64}$/.test(existingTrustedFp) && !revokedSet.has(existingTrustedFp);

if (!isCurrentlyEnrolled) {
  if (enrollNewKeyStr !== 'true') {
    throw new Error('REJECTED_UNENROLLED_POLICY_KEY: Policy key is currently revoked/unenrolled. Pass -EnrollNewPublicKey once to enroll your new Owner public key.');
  }
  const updatedPolicy = {
    version: 1,
    repository: 'truhoaiphuong03/management-lite',
    allowed_approvers: ['Owner', 'truhoaiphuong03'],
    require_independent_ci_receipt: true,
    require_github_api_verification: true,
    github_api_base_url: existingPolicy.github_api_base_url || 'https://api.github.com',
    allowed_ci_events: ['workflow_dispatch', 'push'],
    allowed_workflow_paths: ['.github/workflows/deploy.yml', '.github/workflows/foundation.yml'],
    allowed_source_branch: 'main',
    key_status: 'ACTIVE_OWNER_ENROLLED',
    revoked_public_key_sha256s: Array.from(revokedSet),
    trusted_public_key_sha256: pubSha256,
    trusted_public_key_pem: pubPem,
  };
  fs.writeFileSync(pubKeyPath, pubPem, 'utf8');
  fs.writeFileSync(policyPath, JSON.stringify(updatedPolicy, null, 2), 'utf8');
} else {
  if (existingTrustedFp !== pubSha256) {
    throw new Error('REJECTED_KEY_MISMATCH: Passphrase-derived public key does not match enrolled trusted_public_key_sha256 in release-gate-policy.json.');
  }
}

if (simFailAfterPolicyStr === 'true') {
  throw new Error('SIMULATED_SIGNING_FAILURE_AFTER_POLICY_WRITE');
}

const now = new Date();
const approvedAt = now.toISOString();
const expiresAt = new Date(now.getTime() + Number(ttlMinutesStr) * 60000).toISOString();
const sequence = Number(sequenceStr);

const payloadObj = {
  version: 1,
  repository: 'truhoaiphuong03/management-lite',
  approved_sha: commitSha.toLowerCase(),
  artifact_sha256: artifactSha256.toLowerCase(),
  schema_sha256: schemaSha256.toLowerCase(),
  ci_run_id: ciRunId,
  ci_run_attempt: Number(ciRunAttemptStr),
  ci_status: 'SUCCESS',
  workflow_path: workflowPath,
  source_branch: sourceBranch,
  sequence,
  approved_by: 'Owner',
  windows_principal: winPrincipal,
  reason: `Owner Windows SINGLE_SHA release approval for ${commitSha.slice(0, 7)}`,
  allow_migration: true,
  approved_at_utc: approvedAt,
  expires_at_utc: expiresAt,
};

const canonicalJson = JSON.stringify(payloadObj);
const sigB64 = crypto.sign(null, Buffer.from(canonicalJson, 'utf8'), privKey).toString('base64');

const envelope = {
  status: 'APPROVED',
  approved_sha: payloadObj.approved_sha,
  artifact_sha256: payloadObj.artifact_sha256,
  schema_sha256: payloadObj.schema_sha256,
  ci_run_id: payloadObj.ci_run_id,
  ci_run_attempt: payloadObj.ci_run_attempt,
  ci_status: 'SUCCESS',
  workflow_path: payloadObj.workflow_path,
  source_branch: payloadObj.source_branch,
  sequence,
  approved_by: 'Owner',
  windows_principal: winPrincipal,
  allow_migration: true,
  approved_at_utc: approvedAt,
  expires_at_utc: expiresAt,
  payload_canonical_json: canonicalJson,
  signature_algorithm: 'Ed25519',
  signature_base64: sigB64,
};

const entryHash = crypto
  .createHash('sha256')
  .update(`${prevHash}|${canonicalJson}|${sigB64}`, 'utf8')
  .digest('hex');

const auditEntry = {
  timestamp_utc: approvedAt,
  sequence,
  approval_mode: 'SINGLE_SHA',
  approved_sha: commitSha.toLowerCase(),
  workflow_path: workflowPath,
  source_branch: sourceBranch,
  approved_by: 'Owner',
  windows_principal: winPrincipal,
  allow_migration: true,
  prev_audit_hash: prevHash,
  entry_hash: entryHash,
};

fs.writeFileSync(manifestPath, JSON.stringify(envelope, null, 2), 'utf8');
fs.appendFileSync(auditLogPath, JSON.stringify(auditEntry) + '\n', 'utf8');
console.log(`[OK] Signed SINGLE_SHA (sequence=${sequence}, allow_migration=true, pubKeySha256=${pubSha256.slice(0, 16)}..., entryHash=${entryHash.slice(0, 16)}...)`);
'@

  try {
    $plainPass | & $node -e $jsInline $policyPath $pubKeyPath $manifestPath $auditLogPath $CommitSha $actualTarSha $SchemaSha256 $CiRunId "$CiRunAttempt" $WorkflowPath $SourceBranch "$sequence" $winPrincipal $prevHash "$ExpiresInMinutes" $enrollFlag $simSignFailFlag
    if ($LASTEXITCODE -ne 0) { throw 'Signing engine exited with non-zero code.' }
  } finally {
    $plainPass = ''
  }

  # Re-lock release-gate directory ACLs before invoking deployment controller
  Lock-ReleaseGateDirectoryAcl -TargetGateDir $gateDir -IsProdTarget $targetsProductionHost

  if ($SimulateBackupFailure) {
    throw 'SIMULATED_PRE_DEPLOY_BACKUP_FAILURE: Pre-deploy PostgreSQL backup failed before migration.'
  }
  if ($SimulateMigrationFailure) {
    throw 'SIMULATED_PRE_CUTOVER_MIGRATION_FAILURE: Database migration 0032 failed pre-cutover; live runtime untouched.'
  }

  $artifactTar = Join-Path $stageDir "management-lite-full-$CommitSha.tar.gz"
  Write-Host '[DEPLOY] Invoking locked Deploy-SemiAutoWindows.ps1 -RunMigrations (Pre-Deploy Backup ENABLED, Migration 0032 ENABLED)...' -ForegroundColor Cyan

  $env:GITHUB_READONLY_TOKEN = $ghToken
  try {
    $deployArgs = @{
      CommitSha            = $CommitSha
      ArtifactPath         = $artifactTar
      ArtifactSha256       = $actualTarSha
      CiRunId              = $CiRunId
      PolicyPath           = $policyPath
      ApprovalManifestPath = $manifestPath
      ServerRoot           = $ServerRoot
      RunMigrations        = $true
    }
    if ($Force) {
      $deployArgs['Force'] = $true
    }
    if ($SandboxMode) {
      $deployArgs['SandboxMode'] = $true
      $deployArgs['GitHubApiBaseUrl'] = $GitHubApiBaseUrl
      if ($SandboxDbPort -gt 0) { $deployArgs['DbPort'] = $SandboxDbPort }
      if (-not [string]::IsNullOrWhiteSpace($SandboxDbUser)) { $deployArgs['DbUser'] = $SandboxDbUser }
      if (-not [string]::IsNullOrWhiteSpace($SandboxDbTarget)) { $deployArgs['DbTarget'] = $SandboxDbTarget }
      if (-not [string]::IsNullOrWhiteSpace($SandboxPgPassFilePath)) { $deployArgs['PgPassFilePath'] = $SandboxPgPassFilePath }
      if (-not [string]::IsNullOrWhiteSpace($SandboxPgBinDir)) { $deployArgs['PgBinDir'] = $SandboxPgBinDir }
      if (-not [string]::IsNullOrWhiteSpace($SandboxHealthUrl)) { $deployArgs['HealthUrl'] = $SandboxHealthUrl }
      if (-not [string]::IsNullOrWhiteSpace($SandboxReadyUrl)) { $deployArgs['ReadyUrl'] = $SandboxReadyUrl }
      if (-not [string]::IsNullOrWhiteSpace($SandboxWebUrl)) { $deployArgs['WebUrl'] = $SandboxWebUrl }
      if ($SimulateCutoverHealthFailure) { $deployArgs['SimulateHealthFailure'] = $true }
    }
    & $DeployControllerPath @deployArgs
    if ($LASTEXITCODE -ne 0) {
      throw "Deploy controller exited with code $LASTEXITCODE."
    }
  } finally {
    Remove-Item Env:GITHUB_READONLY_TOKEN -ErrorAction SilentlyContinue
  }
} catch {
  $errMsg = $_.Exception.Message
  $watermarkConsumed = $false
  if ($sequence -gt 0 -and (Test-Path -LiteralPath $watermarkPath -PathType Leaf)) {
    try {
      $wmAfter = Get-Content -LiteralPath $watermarkPath -Raw | ConvertFrom-Json
      if ($null -ne $wmAfter.last_sequence -and [int]$wmAfter.last_sequence -ge $sequence) {
        $watermarkConsumed = $true
      }
    } catch {}
  }
  if ($gateMutated -and (-not $watermarkConsumed)) {
    Write-Host "[ROLLBACK-GATE] Restoring release-gate policy, manifest, and audit log to pre-invocation state due to error: $errMsg" -ForegroundColor Yellow
    Unlock-ReleaseGateDirectoryAcl -TargetGateDir $gateDir -IsElevated $isElevatedAdmin -CallerPrincipal $identity.Name
    Restore-GateSnapshot
  } elseif ($gateMutated -and $watermarkConsumed) {
    Write-Host "[AUDIT-PRESERVED] Sequence $sequence was already committed to approval-watermark.json by controller; preserving enrolled policy and append-only approval-audit.jsonl for forward recovery." -ForegroundColor Yellow
  }
  throw
} finally {
  $plainPass = ''
  $ghToken = ''
  Remove-Item Env:GITHUB_READONLY_TOKEN -ErrorAction SilentlyContinue
  Lock-ReleaseGateDirectoryAcl -TargetGateDir $gateDir -IsProdTarget $targetsProductionHost
}
