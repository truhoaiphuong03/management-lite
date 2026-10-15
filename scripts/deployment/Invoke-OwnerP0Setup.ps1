#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$BaselineSha = 'fbb69409d00f43d0c36854730332e319cedb49ec',
  [int]$MaxDeployments = 20,
  [int]$ExpiresInHours = 168,
  [switch]$AllowMigration = $true,
  [string]$OwnerVaultDir = 'C:\ProgramData\HoaiPhuong-OwnerVault',
  [string]$ServerRoot = 'C:\HoaiPhuong-Server',
  [string]$DevRepoDir = 'C:\HoaiPhuong-Server\workspace\management-lite-uiux-integration-test'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 1. REQUIRE ELEVATED ADMINISTRATOR SESSION (UAC SECURE DESKTOP)
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentPrincipal = [Security.Principal.WindowsPrincipal]::new($currentIdentity)
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'SECURITY_VIOLATION_NON_ELEVATED_CALLER: Invoke-OwnerP0Setup.ps1 must be executed in an elevated PowerShell session (Run as Administrator).'
}

$gateDir = Join-Path $ServerRoot 'config\release-gate'
$tempKeyDir = Join-Path $ServerRoot 'config\test-secrets\owner-ed25519'
$tempPrivKey = Join-Path $tempKeyDir 'owner-approval-private.pem'
$prodDeployScriptsDir = Join-Path $ServerRoot 'apps\management-lite\scripts\deployment'
$auditBackupDir = Join-Path $ServerRoot ("backups\p0-audit-evidence-" + (Get-Date).ToString('yyyyMMdd-HHmmss'))

Write-Host '=== MANAGEMENT LITE: P0 REMEDIATION & ONE-TIME SCOPED OWNER APPROVAL ==='

# 2. SEAL AUDIT EVIDENCE WITHOUT EXPOSING PRIVATE KEY CONTENT
New-Item -ItemType Directory -Path $auditBackupDir -Force | Out-Null
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

$keyMetadata = [ordered]@{
  sealed_at_utc          = (Get-Date).ToUniversalTime().ToString('o')
  sealed_by              = $currentIdentity.Name
  temporary_key_existed  = (Test-Path -LiteralPath $tempPrivKey -PathType Leaf)
  temporary_key_sha256   = if (Test-Path -LiteralPath $tempPrivKey -PathType Leaf) { (Get-FileHash -LiteralPath $tempPrivKey -Algorithm SHA256).Hash } else { $null }
  private_key_content    = 'REDACTED_NEVER_EXPORTED'
}
$keyMetadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $auditBackupDir 'revoked-key-evidence.json') -Encoding UTF8 -Force
Write-Host "[1/5] Sealed P0 audit evidence at: $auditBackupDir"

# 3. REVOKE TEMPORARY SERVER KEY & SYNTHETIC CI RECEIPT
if (Test-Path -LiteralPath $tempKeyDir) {
  Remove-Item -LiteralPath $tempKeyDir -Recurse -Force
}
$syntheticReceipt = Join-Path $gateDir 'ci-run-receipt-fbb69409d00f43d0c36854730332e319cedb49ec.json'
if (Test-Path -LiteralPath $syntheticReceipt) {
  Remove-Item -LiteralPath $syntheticReceipt -Force
}
Write-Host '[2/5] Revoked temporary key in config\test-secrets\owner-ed25519 and removed local synthetic CI receipt.'

# 4. INSTALL HARDENED CONTROLLERS INTO PRODUCTION SCRIPTS DIRECTORY
foreach ($scriptName in @('Approve-ReleaseSha.ps1', 'Deploy-SemiAutoWindows.ps1', 'Invoke-OwnerP0Setup.ps1')) {
  $srcScript = Join-Path $DevRepoDir "scripts\deployment\$scriptName"
  if (Test-Path -LiteralPath $srcScript -PathType Leaf) {
    Copy-Item -LiteralPath $srcScript -Destination (Join-Path $prodDeployScriptsDir $scriptName) -Force
  }
}
Write-Host "[3/5] Updated hardened release-gate controllers in: $prodDeployScriptsDir"

# 5. GENERATE NEW OWNER ED25519 KEYPAIR IN ELEVATED-ADMIN-ONLY VAULT & LOCK NTFS ACLS
$approveScript = Join-Path $prodDeployScriptsDir 'Approve-ReleaseSha.ps1'
$vaultPrivKey = Join-Path $OwnerVaultDir 'owner-approval-private.pem'
& $approveScript -GenerateKeyPairOnly -KeyOutDir $gateDir -PrivateKeyOutPath $vaultPrivKey -EnforceProductionGate
Write-Host "[4/5] Generated new Owner Ed25519 keypair in Elevated-Admin vault ($OwnerVaultDir) and locked release-gate ACL (Read-Only for non-elevated account)."

# 6. SIGN ONE-TIME SCOPED RELEASE APPROVAL (SCOPED_WINDOW)
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
  -EnforceProductionGate
Write-Host "[5/5] Signed One-Time Scoped Release Approval (SCOPED_WINDOW) for baseline $BaselineSha."
Write-Host '=== P0 REMEDIATION & SCOPED APPROVAL COMPLETE ==='
