#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ConfigPath,
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][string]$Sha,
    [Parameter(Mandatory)][string]$ArchiveSha256,
    [switch]$Simulation
)
Import-Module (Join-Path $PSScriptRoot 'Release.Common.psm1') -Force
$c = Read-DeployConfig $ConfigPath -Simulation:$Simulation
$lock = Enter-DeployLock $c
$previous=$null; $switchAttempted=$false
try {
    $journalPath=Join-Path $c.Root 'deployment-state.json'
    if (Test-Path -LiteralPath $journalPath) {
        $journal=Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
        if ($journal.status -eq 'in_progress') { throw 'Interrupted deployment requires operator recovery before retry.' }
    }
    $previous = Get-CurrentRelease $c -Simulation:$Simulation
    $oldManifest = Assert-LocalReleaseIntegrity $previous
    # Rollback must remain schema-compatible; first production install is a separate approved task.
    $release = Expand-VerifiedRelease $Archive $ArchiveSha256 $Sha $c
    Assert-ReleaseSchema $c $release.Manifest -Simulation:$Simulation
    Assert-ReleaseSchema $c $oldManifest -Simulation:$Simulation
    if (!$Simulation) {
        $node = & $c.NodePath --version
        if ($node.Trim() -ne 'v22.14.0') { throw 'Node runtime version mismatch.' }
    }
    # Pause writes before database + receipt backup to avoid a cross-resource snapshot race.
    # A maintenance window is required; all application writers/workers must belong to this service.
    @{status='in_progress';sha=$Sha;previous=$oldManifest.sha;startedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $journalPath
    $switchAttempted=$true
    Set-AppService $c Stop -Simulation:$Simulation
    $backup = New-ReleaseBackup $c $Sha -Simulation:$Simulation
    Write-DeployEvent $c 'BACKUP_CREATED' $Sha
    Set-CurrentRelease $c $release.Path -Simulation:$Simulation
    Set-AppService $c Start -Simulation:$Simulation
    Test-ReleaseHealth $c $Sha -Simulation:$Simulation
    @{sha=$Sha; previous=$oldManifest.sha; backup=$backup; deployedAt=[DateTime]::UtcNow.ToString('o')} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $c.Root 'last-success.json')
    Write-DeployEvent $c 'DEPLOYED' $Sha
    @{status='completed';sha=$Sha;previous=$oldManifest.sha} | ConvertTo-Json | Set-Content -LiteralPath $journalPath
} catch {
    Write-DeployEvent $c 'DEPLOY_FAILED' $Sha
    if ($switchAttempted -and $previous) {
        try {
            Set-AppService $c Stop -Simulation:$Simulation
            Set-CurrentRelease $c $previous -Simulation:$Simulation
            Set-AppService $c Start -Simulation:$Simulation
            Test-ReleaseHealth $c $oldManifest.sha -Simulation:$Simulation
            Write-DeployEvent $c 'ROLLED_BACK' $oldManifest.sha
            @{status='rolled_back';sha=$oldManifest.sha;failedSha=$Sha} | ConvertTo-Json | Set-Content -LiteralPath $journalPath
        } catch { Write-DeployEvent $c 'ROLLBACK_FAILED_OPERATOR_REQUIRED' $Sha; throw 'Deploy and rollback failed; operator required. No database restore performed.' }
    }
    throw 'Deployment rejected/failed. See local sanitized history. No database restore performed.'
} finally { $lock.Dispose() }
