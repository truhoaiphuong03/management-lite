#requires -Version 5.1
<#
.SYNOPSIS
  Set-FreezeFlag.ps1 - creates / removes the ML_FREEZE flag used by the optional pre-push guard.
.DESCRIPTION
  The flag stores ONLY the SHA-256 of an Owner passphrase (never the passphrase itself).
  Run by the Owner. The passphrase is read as a secure string; it is not echoed or logged.
  Usage:
    Set-FreezeFlag.ps1 -RepoPath <repo> -Enable [-BlockAll] [-BlockCommitMain]
    Set-FreezeFlag.ps1 -RepoPath <repo> -Disable
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RepoPath,
    [switch]$Enable,
    [switch]$Disable,
    [switch]$BlockAll,
    [switch]$BlockCommitMain
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$common = (& git -C $RepoPath rev-parse --git-common-dir).Trim()
if (-not [IO.Path]::IsPathRooted($common)) { $common = Join-Path $RepoPath $common }
$flag = Join-Path $common 'ML_FREEZE'
if ($Disable) { if (Test-Path -LiteralPath $flag) { Remove-Item -LiteralPath $flag -Force; Write-Host "Freeze flag removed: $flag" } else { Write-Host 'No freeze flag present.' }; return }
if (-not $Enable) { Write-Host "Flag present: $(Test-Path -LiteralPath $flag)"; return }
$sec = Read-Host -AsSecureString 'Owner passphrase (stored only as SHA-256)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$sha = [Security.Cryptography.SHA256]::Create()
$hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($plain)))).Replace('-', '').ToLowerInvariant()
$plain = $null
$lines = @($hash)
if ($BlockAll) { $lines += 'block_all=1' }
if ($BlockCommitMain) { $lines += 'block_commit_main=1' }
[IO.File]::WriteAllText($flag, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
Write-Host "Freeze flag written: $flag"
