#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ConfigPath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$Sha,
    [switch]$Simulation
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$lock = $null
try {
    $missingCmdlets = @(
        foreach ($requiredCmdlet in @(
            'Get-FileHash',
            'Import-Module',
            'Get-Content',
            'Set-Content',
            'Add-Content',
            'ConvertFrom-Json',
            'ConvertTo-Json',
            'Join-Path',
            'Split-Path',
            'Test-Path',
            'Get-Item',
            'New-Item'
        )) {
            if ($null -eq (Get-Command -Name $requiredCmdlet -ErrorAction SilentlyContinue)) {
                $requiredCmdlet
            }
        }
    )
    if ($missingCmdlets.Count -gt 0) {
        throw ("Required cmdlet(s) not recognized or unavailable in this PowerShell environment: " + ($missingCmdlets -join ', '))
    }
    $selfHash = Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256 -ErrorAction Stop
    if ($null -eq $selfHash -or [string]::IsNullOrWhiteSpace([string]$selfHash.Hash)) {
        throw "Cmdlet 'Get-FileHash' failed self-verification."
    }

    Import-Module ([IO.Path]::Combine($PSScriptRoot, 'Release.Common.psm1')) -Force -ErrorAction Stop
    if (-not $Simulation) {
        throw 'CANONICAL_CONTROLLER_ENFORCED: Non-simulation rollback must use scripts/deployment/Deploy-SemiAutoWindows.ps1 with Ed25519 Owner signature.'
    }
    $c = Read-DeployConfig $ConfigPath -Simulation:$Simulation
    $lock = Enter-DeployLock $c
    $target = [IO.Path]::GetFullPath((Join-Path $c.Root ('releases/' + $Sha)))
    $m = Assert-LocalReleaseIntegrity $target
    if ($m.sha -cne $Sha) { throw 'Rollback identity mismatch.' }
    foreach ($file in @($m.files)) {
        $path = [IO.Path]::GetFullPath((Join-Path $target $file.path))
        if (
            !$path.StartsWith($target + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            ((Get-VerifiedFileSha256 -LiteralPath $path) -cne [string]$file.sha256)
        ) {
            throw 'Rollback integrity failure.'
        }
    }
    Assert-ReleaseSchema $c $m -Simulation:$Simulation
    $previous = Get-CurrentRelease $c -Simulation:$Simulation
    try {
        Set-AppService $c Stop -Simulation:$Simulation
        New-ReleaseBackup $c $Sha -Simulation:$Simulation | Out-Null
        Set-CurrentRelease $c $target -Simulation:$Simulation
        Set-AppService $c Start -Simulation:$Simulation
        Test-ReleaseHealth $c $Sha -Simulation:$Simulation
        Write-DeployEvent $c 'MANUAL_ROLLBACK' $Sha
        @{ status = 'manual_rollback_completed'; sha = $Sha } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $c.Root 'deployment-state.json')
    } catch {
        Set-AppService $c Stop -Simulation:$Simulation
        Set-CurrentRelease $c $previous -Simulation:$Simulation
        Set-AppService $c Start -Simulation:$Simulation
        Write-DeployEvent $c 'MANUAL_ROLLBACK_FAILED' $Sha
        throw 'Rollback failed; previous pointer restored. Operator must verify health.'
    }
} catch {
    $errMsg = if ($null -ne $_.Exception -and -not [string]::IsNullOrWhiteSpace($_.Exception.Message)) {
        $_.Exception.Message
    } else {
        [string]$_
    }
    if ($errMsg -notmatch '^ROLLBACK_FAILED_CLOSED:') {
        $errMsg = "ROLLBACK_FAILED_CLOSED: $errMsg"
    }
    throw $errMsg
} finally {
    if ($null -ne $lock) {
        $lock.Dispose()
    }
}
