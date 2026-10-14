#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [switch]$GenerateKeyPairOnly,
  [Parameter(Mandatory = $false)]
  [string]$KeyOutDir,
  [Parameter(Mandatory = $false)]
  [string]$PrivateKeyOutPath,
  [Parameter(Mandatory = $false)]
  [string]$CommitSha,
  [Parameter(Mandatory = $false)]
  [string]$ArtifactSha256,
  [Parameter(Mandatory = $false)]
  [string]$CiRunId = '1',
  [Parameter(Mandatory = $false)]
  [int]$CiRunAttempt = 1,
  [Parameter(Mandatory = $false)]
  [string]$CiStatus = 'SUCCESS',
  [Parameter(Mandatory = $false)]
  [string]$WorkflowPath = '.github/workflows/deploy.yml',
  [Parameter(Mandatory = $false)]
  [string]$SourceBranch = 'main',
  [Parameter(Mandatory = $false)]
  [string]$SchemaSha256 = '',
  [Parameter(Mandatory = $false)]
  [string]$GitHubApiBaseUrl = 'https://api.github.com',
  [Parameter(Mandatory = $false)]
  [int]$Sequence = 1,
  [Parameter(Mandatory = $false)]
  [string]$ApprovedBy,
  [Parameter(Mandatory = $false)]
  [string]$PrivateKeyPath,
  [Parameter(Mandatory = $false)]
  [string]$PolicyPath = 'C:\HoaiPhuong-Server\config\release-gate\release-gate-policy.json',
  [Parameter(Mandatory = $false)]
  [string]$ManifestPath = 'C:\HoaiPhuong-Server\config\release-gate\approved-release.json',
  [Parameter(Mandatory = $false)]
  [string]$AuditLogPath = 'C:\HoaiPhuong-Server\config\release-gate\approval-audit.jsonl',
  [string]$Reason = 'Owner cryptographically signed SHA release approval',
  [switch]$AllowMigration,
  [int]$ExpiresInMinutes = 120,
  [switch]$SimulateRunnerContext
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$node = 'C:\HoaiPhuong-Server\config\runtime\node-v22.14.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $node)) {
  $node = 'node'
}

# 1. BLOCK EXECUTION FROM GITHUB ACTIONS RUNNER / WORKFLOW CONTEXT
if ($SimulateRunnerContext -or $env:GITHUB_ACTIONS -eq 'true' -or (-not [string]::IsNullOrWhiteSpace($env:RUNNER_TRACKING_ID)) -or (-not [string]::IsNullOrWhiteSpace($env:GITHUB_WORKFLOW))) {
  throw 'SECURITY_VIOLATION_RUNNER_SELF_APPROVAL: Approve-ReleaseSha.ps1 cannot be executed inside a GitHub Actions runner or workflow context.'
}

function Set-ReleaseGateAcl {
  param([string]$TargetPath)
  $currentAdmin = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $TargetPath /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdmin}:(OI)(CI)F" "*S-1-5-19:(OI)(CI)R" "*S-1-5-20:(OI)(CI)R" /deny "*S-1-5-19:(OI)(CI)(W,M,D,WDAC,WO)" "*S-1-5-20:(OI)(CI)(W,M,D,WDAC,WO)" | Out-Null
}

# 2. OPTIONAL KEYPAIR & POLICY INITIALIZATION MODE (FOR SANDBOX OR OWNER KEY CEREMONY)
if ($GenerateKeyPairOnly) {
  if ([string]::IsNullOrWhiteSpace($KeyOutDir)) {
    throw 'KeyOutDir is required when -GenerateKeyPairOnly is specified.'
  }
  if (-not (Test-Path -LiteralPath $KeyOutDir)) {
    New-Item -ItemType Directory -Path $KeyOutDir -Force | Out-Null
  }
  $privPath = if (-not [string]::IsNullOrWhiteSpace($PrivateKeyOutPath)) {
    $privParent = Split-Path -Path $PrivateKeyOutPath -Parent
    if (-not (Test-Path -LiteralPath $privParent)) {
      New-Item -ItemType Directory -Path $privParent -Force | Out-Null
    }
    $PrivateKeyOutPath
  } else {
    Join-Path $KeyOutDir 'owner-approval-private.pem'
  }
  $pubPath = Join-Path $KeyOutDir 'owner-approval-public.pem'
  $polPath = Join-Path $KeyOutDir 'release-gate-policy.json'

  $jsKeyGen = @"
const crypto = require('node:crypto');
const fs = require('node:fs');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubSha256 = crypto.createHash('sha256').update(pubPem, 'utf8').digest('hex');
fs.writeFileSync(process.argv[1], privPem, 'utf8');
fs.writeFileSync(process.argv[2], pubPem, 'utf8');
const policy = {
  version: 1,
  repository: 'truhoaiphuong03/management-lite',
  allowed_approvers: ['Owner', 'truhoaiphuong03'],
  require_independent_ci_receipt: true,
  require_github_api_verification: true,
  github_api_base_url: process.argv[4] || 'https://api.github.com',
  allowed_ci_events: ['workflow_dispatch'],
  allowed_workflow_paths: ['.github/workflows/deploy.yml'],
  allowed_source_branch: 'main',
  trusted_public_key_sha256: pubSha256,
  trusted_public_key_pem: pubPem
};
fs.writeFileSync(process.argv[3], JSON.stringify(policy, null, 2), 'utf8');
"@
  & $node -e $jsKeyGen $privPath $pubPath $polPath $GitHubApiBaseUrl
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to generate Ed25519 keypair and policy.'
  }
  Set-ReleaseGateAcl -TargetPath $KeyOutDir
  Write-Host "[OK] Generated Ed25519 Owner public policy in $KeyOutDir (Private key at $privPath)"
  return
}

# 3. VALIDATE INPUTS & POLICY FOR SIGNING
$normalizedSha = $CommitSha.Trim().ToLowerInvariant()
if ($normalizedSha -notmatch '^[0-9a-f]{40}$') {
  throw "Invalid CommitSha '$CommitSha'. Must be a full 40-character hexadecimal Git SHA."
}
$normalizedArtifactHash = $ArtifactSha256.Trim().ToLowerInvariant()
if ($normalizedArtifactHash -notmatch '^[0-9a-f]{64}$') {
  throw "Invalid ArtifactSha256 '$ArtifactSha256'. Must be a 64-character hexadecimal SHA-256 digest."
}
$normalizedSchemaHash = $SchemaSha256.Trim().ToLowerInvariant()
if ($normalizedSchemaHash -notmatch '^[0-9a-f]{64}$') {
  throw "Invalid SchemaSha256 '$SchemaSha256'. Must be a 64-character hexadecimal SHA-256 digest."
}
if ($CiRunId -notmatch '^[0-9]+$' -or $CiRunAttempt -lt 1) {
  throw "Invalid CiRunId '$CiRunId' or CiRunAttempt '$CiRunAttempt'."
}
if ([string]::IsNullOrWhiteSpace($ApprovedBy)) {
  throw 'ApprovedBy is mandatory.'
}
if ([string]::IsNullOrWhiteSpace($PrivateKeyPath) -or -not (Test-Path -LiteralPath $PrivateKeyPath)) {
  throw 'PrivateKeyPath (Owner Ed25519 private key) is required to sign approval.'
}
if (-not (Test-Path -LiteralPath $PolicyPath)) {
  throw "Release gate policy not found at '$PolicyPath'."
}

# Enforce off-server / isolated key custody: Private key must NEVER reside inside release-gate or runner directories
$resolvedPrivPath = [IO.Path]::GetFullPath($PrivateKeyPath)
$resolvedGateDir = [IO.Path]::GetFullPath((Split-Path -Path $ManifestPath -Parent))
$resolvedPolicyDir = [IO.Path]::GetFullPath((Split-Path -Path $PolicyPath -Parent))
if ($resolvedPrivPath.StartsWith($resolvedGateDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    $resolvedPrivPath.StartsWith($resolvedPolicyDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    $resolvedPrivPath -match '(?i)\\runner\\') {
  throw "SECURITY_VIOLATION_PRIVATE_KEY_IN_SERVER_GATE: Owner Ed25519 private key ($resolvedPrivPath) must not be stored inside the server release-gate or runner directory."
}

$policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
$allowedApprovers = @($policy.allowed_approvers)
if ($allowedApprovers -notcontains $ApprovedBy.Trim()) {
  throw "REJECTED_UNAUTHORIZED_APPROVER: '$ApprovedBy' is not an authorized Owner approver."
}

$parentDir = Split-Path -Path $ManifestPath -Parent
if (-not (Test-Path -LiteralPath $parentDir)) {
  New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
}

$nowUtc = (Get-Date).ToUniversalTime()
$expiresUtc = $nowUtc.AddMinutes($ExpiresInMinutes)
$winPrincipal = [Security.Principal.WindowsIdentity]::GetCurrent().Name

$payloadObj = [ordered]@{
  version           = 1
  repository        = 'truhoaiphuong03/management-lite'
  approved_sha      = $normalizedSha
  artifact_sha256   = $normalizedArtifactHash
  schema_sha256     = $normalizedSchemaHash
  ci_run_id         = $CiRunId.Trim()
  ci_run_attempt    = [int]$CiRunAttempt
  ci_status         = $CiStatus.Trim().ToUpperInvariant()
  workflow_path     = $WorkflowPath.Trim()
  source_branch     = $SourceBranch.Trim()
  sequence          = [int]$Sequence
  approved_by       = $ApprovedBy.Trim()
  windows_principal = $winPrincipal
  reason            = $Reason.Trim()
  allow_migration   = [bool]$AllowMigration
  approved_at_utc   = $nowUtc.ToString('o')
  expires_at_utc    = $expiresUtc.ToString('o')
}
$canonicalJson = $payloadObj | ConvertTo-Json -Compress

$envelope = [ordered]@{
  status                 = 'APPROVED'
  approved_sha           = $normalizedSha
  artifact_sha256        = $normalizedArtifactHash
  schema_sha256          = $normalizedSchemaHash
  ci_run_id              = $CiRunId.Trim()
  ci_run_attempt         = [int]$CiRunAttempt
  ci_status              = $CiStatus.Trim().ToUpperInvariant()
  workflow_path          = $WorkflowPath.Trim()
  source_branch          = $SourceBranch.Trim()
  sequence               = [int]$Sequence
  approved_by            = $ApprovedBy.Trim()
  windows_principal      = $winPrincipal
  allow_migration        = [bool]$AllowMigration
  approved_at_utc        = $payloadObj.approved_at_utc
  expires_at_utc         = $payloadObj.expires_at_utc
  payload_canonical_json = $canonicalJson
  signature_algorithm    = 'Ed25519'
  signature_base64       = ''
}

$envelope | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8 -Force

$prevHash = '0' * 64
if (Test-Path -LiteralPath $AuditLogPath) {
  $lastLine = Get-Content -LiteralPath $AuditLogPath | Select-Object -Last 1
  if ($lastLine) {
    $lastObj = $lastLine | ConvertFrom-Json
    if ($lastObj.entry_hash) { $prevHash = $lastObj.entry_hash }
  }
}

$jsSign = @"
const crypto = require('node:crypto');
const fs = require('node:fs');
const privPem = fs.readFileSync(process.argv[1], 'utf8').replace(/^\uFEFF/, '');
const manifestPath = process.argv[2];
const prevHash = process.argv[3];
const envObj = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
const payload = envObj.payload_canonical_json;
const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), privPem).toString('base64');
envObj.signature_base64 = sig;
fs.writeFileSync(manifestPath, JSON.stringify(envObj, null, 2), 'utf8');
const entryHash = crypto.createHash('sha256').update(prevHash + '|' + payload + '|' + sig, 'utf8').digest('hex');
process.stdout.write(entryHash);
"@
$entryHash = ((& $node -e $jsSign $PrivateKeyPath $ManifestPath $prevHash) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($entryHash)) {
  throw 'Failed to compute Ed25519 signature over approval payload.'
}

# 4. APPEND HASH-CHAINED IMMUTABLE AUDIT LOG ENTRY
$auditEntry = [ordered]@{
  timestamp_utc     = $nowUtc.ToString('o')
  sequence          = [int]$Sequence
  approved_sha      = $normalizedSha
  artifact_sha256   = $normalizedArtifactHash
  schema_sha256     = $normalizedSchemaHash
  ci_run_id         = $CiRunId.Trim()
  ci_run_attempt    = [int]$CiRunAttempt
  workflow_path     = $WorkflowPath.Trim()
  source_branch     = $SourceBranch.Trim()
  approved_by       = $ApprovedBy.Trim()
  windows_principal = $winPrincipal
  allow_migration   = [bool]$AllowMigration
  prev_audit_hash   = $prevHash
  entry_hash        = $entryHash
} | ConvertTo-Json -Compress
Add-Content -LiteralPath $AuditLogPath -Value $auditEntry -Encoding UTF8

# 5. ENFORCE WINDOWS ACL ON RELEASE-GATE DIRECTORY
Set-ReleaseGateAcl -TargetPath $parentDir

Write-Host "[OK] Ed25519-signed Owner SHA approval recorded at: $ManifestPath"
Write-Host "     SHA             : $normalizedSha"
Write-Host "     Artifact SHA256 : $normalizedArtifactHash"
Write-Host "     CI Run ID       : $CiRunId (attempt=$CiRunAttempt, status=$CiStatus, workflow=$WorkflowPath, branch=$SourceBranch)"
Write-Host "     Sequence        : $Sequence"
Write-Host "     Approved By     : $($payloadObj.approved_by) ($winPrincipal)"
Write-Host "     Audit Hash      : $entryHash"
