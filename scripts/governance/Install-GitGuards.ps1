#requires -Version 5.1
<#
.SYNOPSIS
  Install-GitGuards.ps1 - installs the optional pre-commit / pre-push guards into ONE repository.
.DESCRIPTION
  Safe by default: runs as a dry run and prints what it would do.
  Refuses the shared working repository unless -OwnerApprovedSharedRepo is passed (Owner decision required).
  Existing hooks are never overwritten: they are copied to <hooks>\_backup-<timestamp>\ first.
  Remove with -Uninstall (restores nothing automatically; use the backup folder).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RepoPath,
    [switch]$Apply,
    [switch]$Uninstall,
    [switch]$OwnerApprovedSharedRepo,
    [string]$SharedRepoPath = 'C:\Projects\management-lite'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath($RepoPath).TrimEnd('\')
if ($repo -ieq [IO.Path]::GetFullPath($SharedRepoPath).TrimEnd('\') -and -not $OwnerApprovedSharedRepo) {
    throw "REFUSED: '$repo' is the shared repository used by other AI sessions. Owner approval is required (-OwnerApprovedSharedRepo)."
}
$common = (& git -C $repo rev-parse --git-common-dir).Trim()
if (-not [IO.Path]::IsPathRooted($common)) { $common = Join-Path $repo $common }
$hooks = Join-Path $common 'hooks'
$src = Join-Path $PSScriptRoot 'hooks'
$names = 'pre-commit', 'pre-push'
Write-Host "Target hooks dir : $hooks"
Write-Host "Mode             : $(if ($Apply -or $Uninstall) { if ($Uninstall) {'UNINSTALL'} else {'APPLY'} } else { 'DRY-RUN' })"
foreach ($n in $names) {
    $dst = Join-Path $hooks $n
    if ($Uninstall) {
        if (Test-Path -LiteralPath $dst) { Write-Host "would remove $dst"; if ($Apply) { Remove-Item -LiteralPath $dst -Force } }
        continue
    }
    $exists = Test-Path -LiteralPath $dst
    Write-Host ("{0}: {1}" -f $n, $(if ($exists) { 'exists -> will be backed up first' } else { 'will be created' }))
    if ($Apply) {
        if ($exists) {
            $bk = Join-Path $hooks ('_backup-' + (Get-Date -Format 'yyyyMMddHHmmss'))
            New-Item -ItemType Directory -Force $bk | Out-Null
            Copy-Item -LiteralPath $dst -Destination (Join-Path $bk $n)
        }
        $text = [IO.File]::ReadAllText((Join-Path $src $n)).Replace("`r`n", "`n")
        [IO.File]::WriteAllText($dst, $text, (New-Object Text.UTF8Encoding($false)))
    }
}
if (-not $Apply) { Write-Host 'Dry run only. Re-run with -Apply to change the hooks.' }
