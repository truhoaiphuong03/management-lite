# Focused controller integration tests. Temporary staging files only; no service, DB, DNS or secrets.
#requires -Version 7.4
$ErrorActionPreference='Stop'
$passed=0
$qa=Join-Path ([IO.Path]::GetTempPath()) ('management-lite-deployment-qa-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qa | Out-Null
function Check([string]$Name,[scriptblock]$Body) { & $Body; $script:passed++; Write-Output "PASS $Name" }
function Assert([bool]$Condition,[string]$Message) { if(!$Condition){throw $Message} }
function Reject([scriptblock]$Body) { $rejected=$false;try{& $Body}catch{$rejected=$true};Assert $rejected 'Expected fail-closed rejection' }
function Fixture([string]$Sha,[string]$Schema='qa-schema') {
    $d=Join-Path $qa ('fixture-'+$Sha)
    foreach($p in @('dist/apps/api/src','web')){New-Item -ItemType Directory -Path (Join-Path $d $p) -Force | Out-Null}
    Set-Content -LiteralPath (Join-Path $d 'dist/apps/api/src/main.js') -Value '// synthetic only'
    Set-Content -LiteralPath (Join-Path $d 'package.json') -Value '{"type":"module"}'
    Set-Content -LiteralPath (Join-Path $d 'web/index.html') -Value '<html>QA only</html>'
    Set-Content -LiteralPath (Join-Path $d 'web/release-version.json') -Value ('{"sha":"'+$Sha+'"}')
    $files=@(Get-ChildItem -LiteralPath $d -File -Recurse | ForEach-Object {@{path=[IO.Path]::GetRelativePath($d,$_.FullName).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}})
    @{sha=$Sha;platform='win32';arch='x64';node='22.14.0';schemaIdentity=$Schema;migrations=@();files=$files}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $d 'release.json')
    $zip=Join-Path $qa ($Sha+'.zip');[IO.Compression.ZipFile]::CreateFromDirectory($d,$zip)
    return @{dir=$d;zip=$zip;digest=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()}
}
try {
    Check 'PowerShell parser accepts every controller' {
        foreach($f in Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object Extension -in '.ps1','.psm1'){
            $tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseFile($f.FullName,[ref]$tokens,[ref]$errors)|Out-Null
            Assert ($errors.Count -eq 0) ('Parser error: '+$f.Name)
        }
    }
    $root=Join-Path $qa 'managed';New-Item -ItemType Directory -Path (Join-Path $root 'releases') -Force|Out-Null
    Set-Content -LiteralPath (Join-Path $root '.management-lite-managed-root') -Value 'isolated simulation'
    $oldSha='a'*40;$newSha='b'*40;$badSha='c'*40
    $old=Fixture $oldSha;$new=Fixture $newSha;$bad=Fixture $badSha
    Copy-Item -LiteralPath $old.dir -Destination (Join-Path $root ('releases/'+$oldSha)) -Recurse
    Set-Content -LiteralPath (Join-Path $root 'simulation-current.txt') -Value (Join-Path $root ('releases/'+$oldSha))
    $config=@{Enabled=$true;Environment='staging';AllowSimulation=$true;Root=$root;SimulationSchema='qa-schema';SimulationFailSha=$badSha}
    $configPath=Join-Path $qa 'config.json';$config|ConvertTo-Json|Set-Content -LiteralPath $configPath
    Import-Module (Join-Path $PSScriptRoot 'Release.Common.psm1') -Force
    Check 'Production cannot invoke simulation' {$p=Join-Path $qa 'production.json';(@{Enabled=$true;Environment='production';AllowSimulation=$true;Root=$root})|ConvertTo-Json|Set-Content $p;Reject {Read-DeployConfig $p -Simulation}}
    Check 'Disabled config fails closed' {$p=Join-Path $qa 'disabled.json';(@{Enabled=$false})|ConvertTo-Json|Set-Content $p;Reject {Read-DeployConfig $p -Simulation}}
    Check 'Concurrent deploy lock is exclusive' {$one=Enter-DeployLock ([pscustomobject]$config);try{Reject {Enter-DeployLock ([pscustomobject]$config)}}finally{$one.Dispose()}}
    Check 'Archive digest mismatch cannot switch release' {Reject {& "$PSScriptRoot/Deploy-Release.ps1" -ConfigPath $configPath -Archive $new.zip -Sha $newSha -ArchiveSha256 ('0'*64) -Simulation};Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($oldSha)) 'Pointer changed'}
    Check 'Valid isolated release activates and records backup' {& "$PSScriptRoot/Deploy-Release.ps1" -ConfigPath $configPath -Archive $new.zip -Sha $newSha -ArchiveSha256 $new.digest -Simulation;Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($newSha)) 'New release not active';Assert (Test-Path (Join-Path $root 'last-success.json')) 'No success record'}
    Check 'Existing immutable release cannot be overwritten' {Reject {& "$PSScriptRoot/Deploy-Release.ps1" -ConfigPath $configPath -Archive $new.zip -Sha $newSha -ArchiveSha256 $new.digest -Simulation}}
    Check 'Health failure rolls back code and retains failed release' {Reject {& "$PSScriptRoot/Deploy-Release.ps1" -ConfigPath $configPath -Archive $bad.zip -Sha $badSha -ArchiveSha256 $bad.digest -Simulation};Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($newSha)) 'Automatic rollback failed';Assert (Test-Path (Join-Path $root ('releases/'+$badSha))) 'Failed release lost'}
    Check 'Manual rollback preserves external protected file' {$protected=Join-Path $root 'external-synthetic-config.txt';Set-Content $protected 'synthetic sentinel';$before=(Get-FileHash $protected).Hash;& "$PSScriptRoot/Rollback-Release.ps1" -ConfigPath $configPath -Sha $oldSha -Simulation;Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($oldSha)) 'Manual rollback failed';Assert ((Get-FileHash $protected).Hash -eq $before) 'External config changed'}
    Check 'Schema mismatch blocks deployment before switch' {$sha='d'*40;$f=Fixture $sha 'different-schema';Reject {& "$PSScriptRoot/Deploy-Release.ps1" -ConfigPath $configPath -Archive $f.zip -Sha $sha -ArchiveSha256 $f.digest -Simulation};Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($oldSha)) 'Schema failure switched pointer'}
    Check 'Zip traversal is rejected' {$zip=Join-Path $qa 'traversal.zip';$z=[IO.Compression.ZipFile]::Open($zip,'Create');try{$entry=$z.CreateEntry('../escape.txt');$w=[IO.StreamWriter]::new($entry.Open());$w.Write('QA');$w.Dispose()}finally{$z.Dispose()};$digest=(Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant();Reject {Expand-VerifiedRelease $zip $digest ('e'*40) ([pscustomobject]$config)};Assert (!(Test-Path (Join-Path $root 'escape.txt'))) 'Traversal escaped'}
    Check 'Environment files in archive are rejected' {$zip=Join-Path $qa 'environment.zip';$z=[IO.Compression.ZipFile]::Open($zip,'Create');try{$entry=$z.CreateEntry('dist/.env');$w=[IO.StreamWriter]::new($entry.Open());$w.Write('SYNTHETIC_SENTINEL_ONLY');$w.Dispose()}finally{$z.Dispose()};$digest=(Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant();Reject {Expand-VerifiedRelease $zip $digest ('f'*40) ([pscustomobject]$config)}}
    Check 'File tampering blocks manual rollback before service switch' {$file=Join-Path $root ('releases/'+$newSha+'/web/index.html');Set-Content $file 'tampered synthetic fixture';Reject {& "$PSScriptRoot/Rollback-Release.ps1" -ConfigPath $configPath -Sha $newSha -Simulation};Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($oldSha)) 'Tampered release activated'}
    Check 'Interrupted deployment blocks blind retry' {$journal=Join-Path $root 'deployment-state.json';Set-Content $journal '{"status":"in_progress"}';Reject {& "$PSScriptRoot/Deploy-Release.ps1" -ConfigPath $configPath -Archive $new.zip -Sha $newSha -ArchiveSha256 $new.digest -Simulation};Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($oldSha)) 'Interrupted state changed active release'}
    Write-Output "RESULT: $passed PASS / 0 FAIL / 0 SKIP (simulation only; Windows service integration NOT TESTED)"
} finally {
    # The only recursive deletion in the toolset is this freshly generated, synthetic test directory.
    if ($qa.StartsWith([IO.Path]::GetTempPath()) -and (Split-Path $qa -Leaf).StartsWith('management-lite-deployment-qa-')) { Remove-Item -LiteralPath $qa -Recurse -Force }
}
