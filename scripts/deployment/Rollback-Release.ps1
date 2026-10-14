#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigPath, [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$Sha, [switch]$Simulation)
Import-Module (Join-Path $PSScriptRoot 'Release.Common.psm1') -Force
if (-not $Simulation) {
    throw 'CANONICAL_CONTROLLER_ENFORCED: Non-simulation rollback must use scripts/deployment/Deploy-SemiAutoWindows.ps1 with Ed25519 Owner signature.'
}
$c = Read-DeployConfig $ConfigPath -Simulation:$Simulation
$lock = Enter-DeployLock $c
try {
    $target = Join-Path $c.Root ('releases/' + $Sha)
    $m = Assert-LocalReleaseIntegrity $target
    if ($m.sha -cne $Sha) { throw 'Rollback identity mismatch.' }
    foreach ($file in $m.files) {
        $path=[IO.Path]::GetFullPath((Join-Path $target $file.path))
        if (!$path.StartsWith($target + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256) { throw 'Rollback integrity failure.' }
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
        @{status='manual_rollback_completed';sha=$Sha} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $c.Root 'deployment-state.json')
    } catch {
        Set-AppService $c Stop -Simulation:$Simulation
        Set-CurrentRelease $c $previous -Simulation:$Simulation
        Set-AppService $c Start -Simulation:$Simulation
        Write-DeployEvent $c 'MANUAL_ROLLBACK_FAILED' $Sha
        throw 'Rollback failed; previous pointer restored. Operator must verify health.'
    }
} finally { $lock.Dispose() }
