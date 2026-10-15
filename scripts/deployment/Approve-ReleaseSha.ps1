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
  [string]$ArtifactPath = '',
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
  [string]$ApprovedBy = 'Owner',
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
  [switch]$ApproveScope,
  [string]$BaselineSha = '',
  [int]$MaxDeployments = 20,
  [int]$ExpiresInMinutes = 120,
  [int]$ExpiresInHours = 0,
  [switch]$AllowControllerChanges,
  [switch]$SandboxMode,
  [switch]$EnforceProductionGate,
  [switch]$SimulateRunnerContext,
  [switch]$SimulateAgentContext,
  [switch]$SimulateNonElevatedCaller
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

# 1B. DETECT PRODUCTION GATE TARGET & ENFORCE OS KERNEL UAC ELEVATION + BLOCK AI AGENT SELF-APPROVAL
$realProdServerPrefix = [IO.Path]::GetFullPath('C:\HoaiPhuong-Server') + [IO.Path]::DirectorySeparatorChar
$targetGatePaths = if ($GenerateKeyPairOnly) {
  @($KeyOutDir, $PrivateKeyOutPath) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
} else {
  @($PolicyPath, $ManifestPath, $AuditLogPath, $PrivateKeyPath) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}
$targetsProductionHost = $EnforceProductionGate -or (
  (-not $SandboxMode) -and @(
    $targetGatePaths | Where-Object {
      $fullP = [IO.Path]::GetFullPath($_) + [IO.Path]::DirectorySeparatorChar
      $fullP.StartsWith($realProdServerPrefix, [StringComparison]::OrdinalIgnoreCase)
    }
  ).Count -gt 0
)

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentPrincipal = [Security.Principal.WindowsPrincipal]::new($currentIdentity)
$isElevatedAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$isAiAgentEnvironment = $SimulateAgentContext -or
  ($env:PAGER -eq 'cat') -or
  (-not [string]::IsNullOrWhiteSpace($env:ANTIGRAVITY_AGENT)) -or
  (-not [string]::IsNullOrWhiteSpace($env:ANTIGRAVITY_CLI_ALIAS)) -or
  (-not [string]::IsNullOrWhiteSpace($env:CODEX_CI)) -or
  (-not [string]::IsNullOrWhiteSpace($env:CODEX_SANDBOX)) -or
  (-not [string]::IsNullOrWhiteSpace($env:CLAUDE_CODE)) -or
  (-not [string]::IsNullOrWhiteSpace($env:CURSOR_TRACE_ID))

if ($SimulateAgentContext -or ($targetsProductionHost -and $isAiAgentEnvironment)) {
  throw 'SECURITY_VIOLATION_AGENT_SELF_APPROVAL: Approve-ReleaseSha.ps1 cannot be executed by an AI Agent or automated subprocess for production release-gate paths. Only the human Owner in an independent interactive console session may generate keys or sign approvals.'
}

if ($SimulateNonElevatedCaller -or ($targetsProductionHost -and (-not $isElevatedAdmin))) {
  throw 'SECURITY_VIOLATION_NON_ELEVATED_CALLER: Production release-gate operations (key generation, policy update, or Owner approval signing) require an elevated Administrator token (UAC Secure Desktop). Non-elevated sessions (such as AI Agent processes) are blocked at the OS kernel token level.'
}

if ($targetsProductionHost) {
  $normGhUrl = if ([string]::IsNullOrWhiteSpace($GitHubApiBaseUrl)) { 'https://api.github.com' } else { $GitHubApiBaseUrl.Trim().TrimEnd('/').ToLowerInvariant() }
  if ($normGhUrl -ne 'https://api.github.com') {
    throw "REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION: Production release gate strictly requires official https://api.github.com (custom or loopback GitHubApiBaseUrl '$GitHubApiBaseUrl' is forbidden)."
  }
  $GitHubApiBaseUrl = 'https://api.github.com'
}

function Assert-OffServerPrivateKeyPath {
  param([string]$CandidateKeyPath, [string]$GateDirPath, [string]$PolicyDirPath, [bool]$IsProdTarget)
  $resolvedPriv = [IO.Path]::GetFullPath($CandidateKeyPath)
  if (-not [string]::IsNullOrWhiteSpace($GateDirPath)) {
    $resolvedGate = [IO.Path]::GetFullPath($GateDirPath)
    if ($resolvedPriv.StartsWith($resolvedGate + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "SECURITY_VIOLATION_PRIVATE_KEY_IN_SERVER_GATE: Owner Ed25519 private key ($resolvedPriv) must not reside inside release-gate directory."
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($PolicyDirPath)) {
    $resolvedPol = [IO.Path]::GetFullPath($PolicyDirPath)
    if ($resolvedPriv.StartsWith($resolvedPol + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "SECURITY_VIOLATION_PRIVATE_KEY_IN_SERVER_GATE: Owner Ed25519 private key ($resolvedPriv) must not reside inside policy directory."
    }
  }
  if ($resolvedPriv -match '(?i)\\(runner|test-secrets|release-gate)\\') {
    throw "SECURITY_VIOLATION_PRIVATE_KEY_IN_SERVER_GATE: Owner Ed25519 private key ($resolvedPriv) must never reside in runner, test-secrets, or release-gate directories."
  }
  if ($IsProdTarget -and $resolvedPriv.StartsWith($realProdServerPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "SECURITY_VIOLATION_PRIVATE_KEY_IN_SERVER_GATE: For production release signing, Owner Ed25519 private key ($resolvedPriv) must reside outside C:\HoaiPhuong-Server (e.g., C:\ProgramData\HoaiPhuong-OwnerVault or Owner removable media)."
  }
}

function Set-ReleaseGateAcl {
  param([string]$TargetPath, [bool]$IsProdTarget = $false)
  $currentAdmin = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  if ($IsProdTarget) {
    # Production: Only SYSTEM and Elevated Administrators (UAC) have Full Control (F). Non-elevated user account (Anty) gets Read-Only (RX).
    & icacls.exe $TargetPath /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdmin}:(OI)(CI)RX" "*S-1-5-19:(OI)(CI)R" "*S-1-5-20:(OI)(CI)R" /deny "*S-1-5-19:(OI)(CI)(W,M,D,WDAC,WO)" "*S-1-5-20:(OI)(CI)(W,M,D,WDAC,WO)" | Out-Null
  } else {
    & icacls.exe $TargetPath /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdmin}:(OI)(CI)F" "*S-1-5-19:(OI)(CI)R" "*S-1-5-20:(OI)(CI)R" /deny "*S-1-5-19:(OI)(CI)(W,M,D,WDAC,WO)" "*S-1-5-20:(OI)(CI)(W,M,D,WDAC,WO)" | Out-Null
  }
}

function Set-OwnerVaultAcl {
  param([string]$VaultDir, [bool]$IsProdTarget = $false)
  if ($IsProdTarget -and (-not [string]::IsNullOrWhiteSpace($VaultDir)) -and (Test-Path -LiteralPath $VaultDir)) {
    # Production: Only SYSTEM and Elevated Administrators (UAC) can read or write the Owner private key vault. Non-elevated user account (Anty) has ZERO access.
    & icacls.exe $VaultDir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" /deny "*S-1-5-19:(OI)(CI)F" "*S-1-5-20:(OI)(CI)F" | Out-Null
  }
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
  Assert-OffServerPrivateKeyPath -CandidateKeyPath $privPath -GateDirPath '' -PolicyDirPath '' -IsProdTarget $targetsProductionHost
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
  Set-OwnerVaultAcl -VaultDir (Split-Path -Path $privPath -Parent) -IsProdTarget $targetsProductionHost
  Set-ReleaseGateAcl -TargetPath $KeyOutDir -IsProdTarget $targetsProductionHost
  Write-Host "[OK] Generated Ed25519 Owner public policy in $KeyOutDir (Private key at $privPath)"
  return
}

# 2B. AUTO-DISCOVER METADATA FROM ARTIFACT PROVENANCE & WATERMARK FOR SIMPLE 1-COMMAND OWNER CEREMONY
if (-not [string]::IsNullOrWhiteSpace($ArtifactPath)) {
  $provCandidate = "$ArtifactPath.provenance.json"
  if (Test-Path -LiteralPath $provCandidate -PathType Leaf) {
    $provData = Get-Content -LiteralPath $provCandidate -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($CommitSha)) {
      if (($provData.PSObject.Properties.Name -contains 'commitSha') -and $provData.commitSha) {
        $CommitSha = [string]$provData.commitSha
      } elseif (($provData.PSObject.Properties.Name -contains 'sha') -and $provData.sha) {
        $CommitSha = [string]$provData.sha
      }
    }
    if ([string]::IsNullOrWhiteSpace($ArtifactSha256) -and ($provData.PSObject.Properties.Name -contains 'sha256') -and $provData.sha256) {
      $ArtifactSha256 = [string]$provData.sha256
    }
    if ([string]::IsNullOrWhiteSpace($SchemaSha256) -and ($provData.PSObject.Properties.Name -contains 'schemaIdentity') -and $provData.schemaIdentity) {
      $SchemaSha256 = [string]$provData.schemaIdentity
    }
  }
}
if (-not $PSBoundParameters.ContainsKey('Sequence')) {
  $policyParentDir = Split-Path -Path ([IO.Path]::GetFullPath($PolicyPath)) -Parent
  $relativeWmCandidate = [IO.Path]::GetFullPath((Join-Path $policyParentDir '..\..\reports\approval-watermark.json'))
  $wmCandidate = if (Test-Path -LiteralPath $relativeWmCandidate -PathType Leaf) {
    $relativeWmCandidate
  } else {
    'C:\HoaiPhuong-Server\reports\approval-watermark.json'
  }
  if (Test-Path -LiteralPath $wmCandidate -PathType Leaf) {
    try {
      $wmData = Get-Content -LiteralPath $wmCandidate -Raw | ConvertFrom-Json
      if (($wmData.PSObject.Properties.Name -contains 'last_sequence') -and ($null -ne $wmData.last_sequence)) {
        $Sequence = [int]$wmData.last_sequence + 1
      }
    } catch {
      # Keep default Sequence = 1 if watermark cannot be parsed
    }
  }
}

if ([string]::IsNullOrWhiteSpace($PrivateKeyPath) -and $targetsProductionHost) {
  $PrivateKeyPath = 'C:\ProgramData\HoaiPhuong-OwnerVault\owner-approval-private.pem'
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

# Enforce off-server / isolated key custody: Private key must NEVER reside inside release-gate, runner, test-secrets, or production server root
Assert-OffServerPrivateKeyPath -CandidateKeyPath $PrivateKeyPath -GateDirPath (Split-Path -Path $ManifestPath -Parent) -PolicyDirPath (Split-Path -Path $PolicyPath -Parent) -IsProdTarget $targetsProductionHost

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
$winPrincipal = [Security.Principal.WindowsIdentity]::GetCurrent().Name

if ($ApproveScope) {
  # 3A. ONE-TIME SCOPED RELEASE GRANT MODE (SCOPED_WINDOW)
  $normalizedBaselineSha = if ($BaselineSha) { $BaselineSha.Trim().ToLowerInvariant() } else { '' }
  if ($normalizedBaselineSha -notmatch '^[0-9a-f]{40}$') {
    throw "Invalid BaselineSha '$BaselineSha'. Must be a full 40-character hexadecimal Git SHA."
  }
  if ($MaxDeployments -lt 1 -or $MaxDeployments -gt 100) {
    throw "Invalid MaxDeployments '$MaxDeployments'. Must be between 1 and 100."
  }
  $effectiveScopeMinutes = if ($ExpiresInHours -gt 0) {
    $ExpiresInHours * 60
  } elseif ($PSBoundParameters.ContainsKey('ExpiresInMinutes')) {
    $ExpiresInMinutes
  } else {
    10080 # Default 7 days (168 hours) for one-time scoped approval
  }
  $expiresUtc = $nowUtc.AddMinutes($effectiveScopeMinutes)

  $payloadObj = [ordered]@{
    version                  = 2
    approval_mode            = 'SCOPED_WINDOW'
    repository               = 'truhoaiphuong03/management-lite'
    baseline_sha             = $normalizedBaselineSha
    workflow_path            = $WorkflowPath.Trim()
    source_branch            = $SourceBranch.Trim()
    max_deployments          = [int]$MaxDeployments
    allow_migration          = [bool]$AllowMigration
    allow_controller_changes = [bool]$AllowControllerChanges
    sequence                 = [int]$Sequence
    approved_by              = $ApprovedBy.Trim()
    windows_principal        = $winPrincipal
    reason                   = $Reason.Trim()
    approved_at_utc          = $nowUtc.ToString('o')
    expires_at_utc           = $expiresUtc.ToString('o')
  }
  $canonicalJson = $payloadObj | ConvertTo-Json -Compress

  $envelope = [ordered]@{
    status                   = 'APPROVED'
    approval_mode            = 'SCOPED_WINDOW'
    baseline_sha             = $normalizedBaselineSha
    workflow_path            = $WorkflowPath.Trim()
    source_branch            = $SourceBranch.Trim()
    max_deployments          = [int]$MaxDeployments
    allow_migration          = [bool]$AllowMigration
    allow_controller_changes = [bool]$AllowControllerChanges
    sequence                 = [int]$Sequence
    approved_by              = $ApprovedBy.Trim()
    windows_principal        = $winPrincipal
    approved_at_utc          = $payloadObj.approved_at_utc
    expires_at_utc           = $payloadObj.expires_at_utc
    payload_canonical_json   = $canonicalJson
    signature_algorithm      = 'Ed25519'
    signature_base64         = ''
  }
} else {
  # 3B. SINGLE-COMMIT SHA APPROVAL MODE (SINGLE_SHA)
  $normalizedSha = if ($CommitSha) { $CommitSha.Trim().ToLowerInvariant() } else { '' }
  if ($normalizedSha -notmatch '^[0-9a-f]{40}$') {
    throw "Invalid CommitSha '$CommitSha'. Must be a full 40-character hexadecimal Git SHA."
  }
  $normalizedArtifactHash = if ($ArtifactSha256) { $ArtifactSha256.Trim().ToLowerInvariant() } else { '' }
  if ($normalizedArtifactHash -notmatch '^[0-9a-f]{64}$') {
    throw "Invalid ArtifactSha256 '$ArtifactSha256'. Must be a 64-character hexadecimal SHA-256 digest."
  }
  $normalizedSchemaHash = if ($SchemaSha256) { $SchemaSha256.Trim().ToLowerInvariant() } else { '' }
  if ($normalizedSchemaHash -notmatch '^[0-9a-f]{64}$') {
    throw "Invalid SchemaSha256 '$SchemaSha256'. Must be a 64-character hexadecimal SHA-256 digest."
  }
  if ($CiRunId -notmatch '^[0-9]+$' -or $CiRunAttempt -lt 1) {
    throw "Invalid CiRunId '$CiRunId' or CiRunAttempt '$CiRunAttempt'."
  }
  $effectiveSingleMinutes = if ($ExpiresInHours -gt 0) { $ExpiresInHours * 60 } else { $ExpiresInMinutes }
  $expiresUtc = $nowUtc.AddMinutes($effectiveSingleMinutes)

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
  approval_mode     = if ($ApproveScope) { 'SCOPED_WINDOW' } else { 'SINGLE_SHA' }
  approved_sha      = if ($ApproveScope) { $normalizedBaselineSha } else { $normalizedSha }
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
Set-ReleaseGateAcl -TargetPath $parentDir -IsProdTarget $targetsProductionHost

if ($ApproveScope) {
  Write-Host "[OK] Ed25519-signed Owner SCOPED_WINDOW approval recorded at: $ManifestPath"
  Write-Host "     Baseline SHA    : $normalizedBaselineSha (Branch=$SourceBranch, Workflow=$WorkflowPath)"
  Write-Host "     Max Deployments : $MaxDeployments (Expires=$($payloadObj.expires_at_utc))"
  Write-Host "     Sequence        : $Sequence | AllowMigration=$AllowMigration | AllowControllerChanges=$AllowControllerChanges"
  Write-Host "     Approved By     : $($payloadObj.approved_by) ($winPrincipal)"
  Write-Host "     Audit Hash      : $entryHash"
} else {
  Write-Host "[OK] Ed25519-signed Owner SHA approval recorded at: $ManifestPath"
  Write-Host "     SHA             : $normalizedSha"
  Write-Host "     Artifact SHA256 : $normalizedArtifactHash"
  Write-Host "     CI Run ID       : $CiRunId (attempt=$CiRunAttempt, status=$CiStatus, workflow=$WorkflowPath, branch=$SourceBranch)"
  Write-Host "     Sequence        : $Sequence"
  Write-Host "     Approved By     : $($payloadObj.approved_by) ($winPrincipal)"
  Write-Host "     Audit Hash      : $entryHash"
}
