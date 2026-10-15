#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$BaselineSha = 'fbb69409d00f43d0c36854730332e319cedb49ec',
  [int]$MaxDeployments = 20,
  [int]$ExpiresInHours = 168,
  [switch]$AllowMigration = $false,
  [string]$GitHubToken = '',
  [string]$OwnerVaultDir = 'C:\ProgramData\HoaiPhuong-OwnerVault',
  [string]$ServerRoot = 'C:\HoaiPhuong-Server',
  [string]$DevRepoDir = 'C:\HoaiPhuong-Server\workspace\management-lite-uiux-integration-test',
  [string]$RollbackFromBackupDir = '',
  [switch]$SandboxMode,
  [switch]$SimulateFailureAfterKeyGen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentPrincipal = [Security.Principal.WindowsPrincipal]::new($currentIdentity)
$isElevatedAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$currentAdminName = $currentIdentity.Name

# 1. REQUIRE ELEVATED ADMINISTRATOR SESSION IN PRODUCTION (UAC SECURE DESKTOP)
if ((-not $SandboxMode) -and (-not $isElevatedAdmin)) {
  throw 'SECURITY_VIOLATION_NON_ELEVATED_CALLER: Invoke-OwnerP0Setup.ps1 must be executed in an elevated PowerShell session (Run as Administrator).'
}

$node = 'C:\HoaiPhuong-Server\config\runtime\node-v22.14.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $node)) {
  $node = 'node'
}

$gateDir = Join-Path $ServerRoot 'config\release-gate'
$gateControllersDir = Join-Path $gateDir 'controllers'
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
  if ($isElevatedAdmin) {
    & takeown.exe /F $PathToUnlock /A /R /D Y 2>$null | Out-Null
  }
  & icacls.exe $PathToUnlock /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdminName}:(OI)(CI)F" "*S-1-3-4:(OI)(CI)F" /T /C 2>$null | Out-Null
}

function Lock-DirectoryReadOnlyForNonElevated {
  param([string]$DirPath)
  if ([string]::IsNullOrWhiteSpace($DirPath) -or (-not (Test-Path -LiteralPath $DirPath))) {
    return
  }
  if ($isElevatedAdmin) {
    & takeown.exe /F $DirPath /A /R /D Y 2>$null | Out-Null
  }
  $items = @(Get-ChildItem -LiteralPath $DirPath -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending)
  foreach ($item in $items) {
    if ($item.PSIsContainer) {
      & icacls.exe $item.FullName /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdminName}:(OI)(CI)RX" "*S-1-3-4:(OI)(CI)RX" "*S-1-5-19:(OI)(CI)RX" "*S-1-5-20:(OI)(CI)RX" | Out-Null
    } else {
      & icacls.exe $item.FullName /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "${currentAdminName}:RX" "*S-1-3-4:RX" "*S-1-5-19:RX" "*S-1-5-20:RX" | Out-Null
    }
  }
  & icacls.exe $DirPath /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdminName}:(OI)(CI)RX" "*S-1-3-4:(OI)(CI)RX" "*S-1-5-19:(OI)(CI)RX" "*S-1-5-20:(OI)(CI)RX" | Out-Null
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

# 2. PRE-FLIGHT PATH VERIFICATION
$requiredDevScripts = @('Approve-ReleaseSha.ps1', 'Deploy-SemiAutoWindows.ps1', 'Invoke-ScopedReleaseDeploy.ps1', 'Invoke-OwnerP0Setup.ps1')
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
Write-Host "    MaxDeployments  : $MaxDeployments | ExpiresInHours: $ExpiresInHours"

# 3. CREATE AUDIT EVIDENCE & TRANSACTIONAL ROLLBACK SNAPSHOT BEFORE ANY MUTATION
New-Item -ItemType Directory -Path $rollbackSnapDir -Force | Out-Null
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
Write-Host "[1/6] Sealed P0 audit evidence & rollback snapshot at: $auditBackupDir"

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
  Write-Host "[2/6] Installed hardened release-gate controllers in: $gateControllersDir and $prodDeployScriptsDir"

  # 5. OPTIONAL GITHUB CI PAT CONFIGURATION
  if (-not [string]::IsNullOrWhiteSpace($GitHubToken)) {
    New-Item -ItemType Directory -Path $testSecretsDir -Force | Out-Null
    $tokenPath = Join-Path $testSecretsDir 'github-ci-token.txt'
    Set-Content -LiteralPath $tokenPath -Value $GitHubToken.Trim() -NoNewline -Encoding UTF8 -Force
    & icacls.exe $tokenPath /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "${currentAdminName}:RX" "*S-1-3-4:RX" /deny "*S-1-5-19:F" "*S-1-5-20:F" | Out-Null
    Write-Host "[2B/6] Stored GitHub CI token at $tokenPath (Read-Only for non-elevated account)."
  }

  # 6. GENERATE NEW OWNER ED25519 KEYPAIR IN ELEVATED-ADMIN-ONLY VAULT
  $approveScript = Join-Path $gateControllersDir 'Approve-ReleaseSha.ps1'
  $vaultPrivKey = Join-Path $OwnerVaultDir 'owner-approval-private.pem'
  & $approveScript `
    -GenerateKeyPairOnly `
    -KeyOutDir $gateDir `
    -PrivateKeyOutPath $vaultPrivKey `
    -SandboxMode

  Write-Host "[3/6] Generated new Owner Ed25519 keypair in vault: $OwnerVaultDir"

  # 7. SIGN ONE-TIME SCOPED RELEASE APPROVAL (SCOPED_WINDOW, ALLOW_MIGRATION=FALSE BY DEFAULT)
  & $approveScript `
    -ApproveScope `
    -BaselineSha $BaselineSha `
    -MaxDeployments $MaxDeployments `
    -ExpiresInHours $ExpiresInHours `
    -AllowMigration:$AllowMigration `
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
  Write-Host "[4/6] Signed and cryptographically verified SCOPED_WINDOW manifest (AllowMigration=$AllowMigration)."

  # 9. REVOKE TEMPORARY SERVER KEY & SYNTHETIC CI RECEIPT (ONLY AFTER NEW KEY & MANIFEST ARE VERIFIED)
  if (Test-Path -LiteralPath $tempKeyDir) {
    Remove-Item -LiteralPath $tempKeyDir -Recurse -Force
  }
  $syntheticReceipt = Join-Path $gateDir 'ci-run-receipt-fbb69409d00f43d0c36854730332e319cedb49ec.json'
  if (Test-Path -LiteralPath $syntheticReceipt) {
    Unlock-PathForRollbackOrAdmin -PathToUnlock $gateDir
    Remove-Item -LiteralPath $syntheticReceipt -Force
  }
  Write-Host '[5/6] Revoked temporary key in config\test-secrets\owner-ed25519 and removed local synthetic CI receipt.'

  # 10. HARDEN OS UAC POLICY & LOCK NTFS ACL HIERARCHY (BLOCKS WRITE, RENAME, DELETE, AND ICACLS BY NON-ELEVATED ACCOUNT)
  if (-not $SandboxMode) {
    # Set UAC ConsentPromptBehaviorAdmin = 2 (Always Notify on Secure Desktop for ALL binaries, blocking fodhelper/autoElevate UAC bypasses)
    Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'ConsentPromptBehaviorAdmin' -Value 2
    Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'PromptOnSecureDesktop' -Value 1
    Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'EnableLUA' -Value 1
  }

  # Ensure writable runtime directories keep explicit FullControl for non-elevated account before locking parent containers
  foreach ($writableSubDir in @('apps', 'logs', 'reports', 'backups', 'releases', 'workspace')) {
    $wPath = Join-Path $ServerRoot $writableSubDir
    if (Test-Path -LiteralPath $wPath) {
      & icacls.exe $wPath /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${currentAdminName}:(OI)(CI)F" "*S-1-3-4:(OI)(CI)F" "*S-1-5-19:(OI)(CI)RX" "*S-1-5-20:(OI)(CI)RX" | Out-Null
    }
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

  # Lock release-gate, services, scripts, runner, and production deployment scripts (Read-Only + OWNER RIGHTS:RX for non-elevated account)
  foreach ($roDir in @($gateDir, $servicesDir, $scriptsDir, $runnerDir, $prodDeployScriptsDir)) {
    Lock-DirectoryReadOnlyForNonElevated -DirPath $roDir
  }

  # Lock parent containers (configDir and ServerRoot) against child folder rename/delete (DC)
  Lock-ContainerOnlyNoDeleteChild -ContainerPath $configDir
  Lock-ContainerOnlyNoDeleteChild -ContainerPath $ServerRoot

  Write-Host '[6/6] Locked NTFS ACL hierarchy (OWNER RIGHTS:RX + Parent DC removed) and hardened UAC policy.'
  Write-Host '=== P0 REMEDIATION & SCOPED APPROVAL COMPLETE ==='
} catch {
  $err = $_.Exception.Message
  Write-Host "[ERROR] Invoke-OwnerP0Setup.ps1 failed: $err"
  Restore-P0SetupSnapshot -SnapRoot $rollbackSnapDir
  throw "P0_SETUP_FAILED_AND_ROLLED_BACK: $err"
}
