#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$CommitSha,
  [Parameter(Mandatory = $true)]
  [string]$ApprovedBy,
  [string]$Reason = 'Owner approved SHA release',
  [switch]$AllowMigration,
  [int]$ExpiresInMinutes = 120,
  [string]$ManifestPath = 'C:\HoaiPhuong-Server\config\release-gate\approved-release.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$normalizedSha = $CommitSha.Trim().ToLowerInvariant()
if ($normalizedSha -notmatch '^[0-9a-f]{40}$') {
  throw "Invalid CommitSha '$CommitSha'. Must be a full 40-character hexadecimal Git SHA."
}
if ([string]::IsNullOrWhiteSpace($ApprovedBy)) {
  throw "ApprovedBy is mandatory."
}

$parentDir = Split-Path -Path $ManifestPath -Parent
if (-not (Test-Path -LiteralPath $parentDir)) {
  New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
}

$nowUtc = (Get-Date).ToUniversalTime()
$expiresUtc = $nowUtc.AddMinutes($ExpiresInMinutes)

$payload = [ordered]@{
  status          = 'APPROVED'
  approved_sha    = $normalizedSha
  approved_by     = $ApprovedBy.Trim()
  reason          = $Reason.Trim()
  allow_migration = [bool]$AllowMigration
  approved_at_utc = $nowUtc.ToString('o')
  expires_at_utc  = $expiresUtc.ToString('o')
}

$payload | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8 -Force
Write-Host "[OK] Owner SHA approval recorded at: $ManifestPath"
Write-Host "     SHA            : $normalizedSha"
Write-Host "     Approved By    : $($payload.approved_by)"
Write-Host "     AllowMigration : $($payload.allow_migration)"
Write-Host "     Expires (UTC)  : $($payload.expires_at_utc)"
