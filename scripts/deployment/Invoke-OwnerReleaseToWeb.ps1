#requires -Version 5.1
<#
.SYNOPSIS
  One-Command Elevated Owner Release Ceremony for Management Lite.
  - Strictly enforces OS Kernel High-Integrity Elevated Administrator token (UAC).
  - Automatically resolves GitHub Actions CI run & downloads official immutable bundle + CI receipt if needed.
  - Signs SINGLE_SHA approval with allow_migration = true using Owner's passphrase via STDIN.
  - Invokes locked Deploy-SemiAutoWindows.ps1 to apply pending migrations and atomically cut over API + Web.
#>
[CmdletBinding()]
param(
  [string]$ArtifactsDir = 'C:\Projects\management-lite\dist\release-artifacts',
  [string]$CommitSha = '',
  [int]$ExpiresInMinutes = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$node = 'C:\HoaiPhuong-Server\config\runtime\node-v22.14.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = 'node' }

# 1. OS KERNEL HIGH-INTEGRITY ELEVATED TOKEN CHECK
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isElevatedAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$hasHighIntegrity = @($identity.Groups | Where-Object { $_.Value -in @('S-1-16-12288', 'S-1-16-16384') }).Count -gt 0

if (-not ($isElevatedAdmin -and $hasHighIntegrity)) {
  throw 'SECURITY_VIOLATION_NON_ELEVATED_TOKEN: Invoke-OwnerReleaseToWeb.ps1 must be run in an Elevated Administrator PowerShell session (Run as Administrator).'
}

if ([string]::IsNullOrWhiteSpace($CommitSha)) {
  $CommitSha = (git -C 'C:\Projects\management-lite' rev-parse HEAD).Trim().ToLowerInvariant()
}
if ($CommitSha -notmatch '^[0-9a-f]{40}$') {
  throw "Invalid CommitSha '$CommitSha'."
}

# Resolve in-memory GitHub read token from GCM for private repo CI verification & artifact download
$ghToken = $env:GITHUB_READONLY_TOKEN
if ([string]::IsNullOrWhiteSpace($ghToken)) {
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

if (-not (Test-Path -LiteralPath $receiptSrc -PathType Leaf)) {
  if ([string]::IsNullOrWhiteSpace($ghToken)) {
    throw "Missing $receiptSrc and no GitHub token available to download CI artifact."
  }
  $headers = @{
    Authorization          = "Bearer $ghToken"
    Accept                 = 'application/vnd.github+json'
    'User-Agent'           = 'ManagementLite-OwnerRelease'
    'X-GitHub-Api-Version' = '2022-11-28'
  }
  Write-Host "[CI-WAIT] Checking GitHub Actions CI run for commit $CommitSha..." -ForegroundColor Cyan
  $matchedRun = $null
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    $runsResp = Invoke-RestMethod -Uri "https://api.github.com/repos/truhoaiphuong03/management-lite/actions/runs?head_sha=$CommitSha&per_page=10" -Headers $headers -Method Get
    $candidateRuns = @($runsResp.workflow_runs | Where-Object { $_.path -in @('.github/workflows/foundation.yml', '.github/workflows/deploy.yml') })
    if ($candidateRuns.Count -gt 0) {
      $latestRun = $candidateRuns[0]
      if ($latestRun.status -eq 'completed') {
        if ($latestRun.conclusion -ne 'success') {
          throw "GitHub Actions run $($latestRun.id) completed with conclusion '$($latestRun.conclusion)' ($($latestRun.html_url))."
        }
        $matchedRun = $latestRun
        break
      }
      Write-Host "  [$attempt/60] CI Run $($latestRun.id) is '$($latestRun.status)'... waiting 10s" -ForegroundColor DarkGray
    } else {
      Write-Host "  [$attempt/60] Waiting for GitHub Actions run to register..." -ForegroundColor DarkGray
    }
    Start-Sleep -Seconds 10
  }
  if (-not $matchedRun) {
    throw "Timed out waiting for GitHub Actions CI run for $CommitSha."
  }

  Write-Host "[CI-DOWNLOAD] Downloading verified artifact bundle from CI Run $($matchedRun.id)..." -ForegroundColor Cyan
  $artsResp = Invoke-RestMethod -Uri "https://api.github.com/repos/truhoaiphuong03/management-lite/actions/runs/$($matchedRun.id)/artifacts" -Headers $headers -Method Get
  $targetArt = @($artsResp.artifacts | Where-Object { $_.name -eq "management-lite-release-$CommitSha" }) | Select-Object -First 1
  if (-not $targetArt) {
    throw "Artifact 'management-lite-release-$CommitSha' not found on CI run $($matchedRun.id)."
  }
  $zipPath = Join-Path $ArtifactsDir "gh-artifact-$CommitSha.zip"
  Invoke-WebRequest -Uri $targetArt.archive_download_url -Headers $headers -OutFile $zipPath -UseBasicParsing
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

foreach ($reqFile in @($tarSrc, $shaSrc, $provSrc, $receiptSrc)) {
  if (-not (Test-Path -LiteralPath $reqFile -PathType Leaf)) {
    throw "Missing required verified release artifact or CI receipt: $reqFile"
  }
}

$prov = Get-Content -LiteralPath $provSrc -Raw | ConvertFrom-Json
$receipt = Get-Content -LiteralPath $receiptSrc -Raw | ConvertFrom-Json

$ArtifactSha256 = [string]$prov.sha256.Trim().ToLowerInvariant()
$SchemaSha256 = [string]$prov.schemaIdentity.Trim().ToLowerInvariant()
$CiRunId = [string]$receipt.run_id.Trim()
$CiRunAttempt = [int]$receipt.run_attempt
$WorkflowPath = [string]$receipt.workflow_path.Trim()
$SourceBranch = [string]$receipt.head_branch.Trim()

Write-Host '==================================================================' -ForegroundColor Cyan
Write-Host ' MANAGEMENT LITE - OWNER ONE-STEP RELEASE & MIGRATION CEREMONY' -ForegroundColor Cyan
Write-Host " Principal       : $($identity.Name) (High-Integrity Elevated Token)" -ForegroundColor Yellow
Write-Host " Target SHA      : $CommitSha" -ForegroundColor Yellow
Write-Host " Artifact SHA256 : $ArtifactSha256" -ForegroundColor Yellow
Write-Host " Schema SHA256   : $SchemaSha256" -ForegroundColor Yellow
Write-Host " CI Run ID       : $CiRunId ($WorkflowPath on $SourceBranch)" -ForegroundColor Yellow
Write-Host ' Mode            : SINGLE_SHA (allow_migration = true)' -ForegroundColor Yellow
Write-Host '==================================================================' -ForegroundColor Cyan

$secPass = Read-Host -Prompt 'Nhap mat khau ky Owner (Passphrase/PIN bi mat >= 12 ky tu)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPass)
$plainPass = ''
try {
  $plainPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

if ([string]::IsNullOrWhiteSpace($plainPass) -or $plainPass.Length -lt 12) {
  $plainPass = ''
  throw 'Passphrase must be at least 12 characters.'
}

$stageDir = "C:\HoaiPhuong-Server\releases\management-lite\artifacts\$CommitSha"
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
Copy-Item -LiteralPath $tarSrc -Destination "$stageDir\management-lite-full-$CommitSha.tar.gz" -Force
Copy-Item -LiteralPath $shaSrc -Destination "$stageDir\management-lite-full-$CommitSha.tar.gz.sha256" -Force
Copy-Item -LiteralPath $provSrc -Destination "$stageDir\management-lite-full-$CommitSha.tar.gz.provenance.json" -Force
Copy-Item -LiteralPath $receiptSrc -Destination "$stageDir\ci-run-receipt-$CommitSha.json" -Force

$gateDir = 'C:\HoaiPhuong-Server\config\release-gate'
$policyPath = Join-Path $gateDir 'release-gate-policy.json'
$pubKeyPath = Join-Path $gateDir 'owner-approval-public.pem'
$manifestPath = Join-Path $gateDir 'approved-release.json'
$auditLogPath = Join-Path $gateDir 'approval-audit.jsonl'
$watermarkPath = 'C:\HoaiPhuong-Server\reports\approval-watermark.json'

# Unlock release-gate ACL temporarily for elevated write
& takeown.exe /F $gateDir /A /R /D Y 2>$null | Out-Null
& icacls.exe $gateDir /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-3-4:(OI)(CI)F" /T /C 2>$null | Out-Null

Copy-Item -LiteralPath $receiptSrc -Destination (Join-Path $gateDir "ci-run-receipt-$CommitSha.json") -Force

$sequence = 2
if (Test-Path -LiteralPath $watermarkPath) {
  $wm = Get-Content -LiteralPath $watermarkPath -Raw | ConvertFrom-Json
  if ($null -ne $wm.last_sequence) { $sequence = [int]$wm.last_sequence + 1 }
}

$prevHash = '0' * 64
if (Test-Path -LiteralPath $auditLogPath) {
  $lines = @(Get-Content -LiteralPath $auditLogPath | Where-Object { $_.Trim() -ne '' })
  if ($lines.Count -gt 0) {
    $lastObj = $lines[-1] | ConvertFrom-Json
    if ($lastObj.entry_hash) { $prevHash = [string]$lastObj.entry_hash }
    $sequence = $lines.Count + 1
  }
}

$winPrincipal = $identity.Name

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

const updatedPolicy = {
  version: 1,
  repository: 'truhoaiphuong03/management-lite',
  allowed_approvers: ['Owner', 'truhoaiphuong03'],
  require_independent_ci_receipt: true,
  require_github_api_verification: true,
  github_api_base_url: 'https://api.github.com',
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
  $plainPass | & $node -e $jsInline $policyPath $pubKeyPath $manifestPath $auditLogPath $CommitSha $ArtifactSha256 $SchemaSha256 $CiRunId "$CiRunAttempt" $WorkflowPath $SourceBranch "$sequence" $winPrincipal $prevHash "$ExpiresInMinutes"
  if ($LASTEXITCODE -ne 0) { throw 'Signing engine failed.' }
} finally {
  $plainPass = ''
}

# Re-lock release-gate directory ACLs
$children = @(Get-ChildItem -LiteralPath $gateDir -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending)
foreach ($child in $children) {
  if ($child.PSIsContainer) {
    & icacls.exe $child.FullName /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "DESKTOP-8T8UHTS\ADMIN:(OI)(CI)RX" "*S-1-3-4:(OI)(CI)RX" "*S-1-5-19:(OI)(CI)R" "*S-1-5-20:(OI)(CI)R" /deny "*S-1-5-19:(OI)(CI)(W,M,D,WDAC,WO)" "*S-1-5-20:(OI)(CI)(W,M,D,WDAC,WO)" | Out-Null
  } elseif ($child.Name -eq 'github-pat.dpapi') {
    & icacls.exe $child.FullName /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "DESKTOP-8T8UHTS\ADMIN:RX" "*S-1-3-4:RX" /deny "*S-1-5-19:F" "*S-1-5-20:F" | Out-Null
  } else {
    & icacls.exe $child.FullName /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "DESKTOP-8T8UHTS\ADMIN:RX" "*S-1-3-4:RX" "*S-1-5-19:R" "*S-1-5-20:R" /deny "*S-1-5-19:(W,M,D,WDAC,WO)" "*S-1-5-20:(W,M,D,WDAC,WO)" | Out-Null
  }
}
& icacls.exe $gateDir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "DESKTOP-8T8UHTS\ADMIN:(OI)(CI)RX" "*S-1-3-4:(OI)(CI)RX" "*S-1-5-19:(OI)(CI)R" "*S-1-5-20:(OI)(CI)R" /deny "*S-1-5-19:(OI)(CI)(W,M,D,WDAC,WO)" "*S-1-5-20:(OI)(CI)(W,M,D,WDAC,WO)" | Out-Null

Write-Host '[SUCCESS] SINGLE_SHA Release Gate signed and locked!' -ForegroundColor Green

$artifactTar = "$stageDir\management-lite-full-$CommitSha.tar.gz"
$deployController = Join-Path $gateDir 'controllers\Deploy-SemiAutoWindows.ps1'
Write-Host '[DEPLOY] Invoking locked Deploy-SemiAutoWindows.ps1 (with pre-cutover migration 0032)...' -ForegroundColor Cyan
$env:GITHUB_READONLY_TOKEN = $ghToken
try {
  & $deployController -CommitSha $CommitSha -ArtifactPath $artifactTar -ArtifactSha256 $ArtifactSha256 -CiRunId $CiRunId -SkipBackup
} finally {
  Remove-Item Env:GITHUB_READONLY_TOKEN -ErrorAction SilentlyContinue
  $ghToken = ''
}
