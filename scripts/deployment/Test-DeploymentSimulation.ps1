# Focused controller integration tests. Temporary staging files only; no service, DB, DNS or secrets.
#requires -Version 5.1
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
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
    $files=@(Get-ChildItem -LiteralPath $d -File -Recurse | ForEach-Object {@{path=$_.FullName.Substring($d.Length).TrimStart('\','/').Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}})
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
    Check 'Child process rollback fails closed with non-zero exit code when Get-FileHash is unavailable, on hash mismatch, and on schema mismatch' {
        $psExe=(Get-Process -Id $PID).Path
        $rbScript=Join-Path $PSScriptRoot 'Rollback-Release.ps1'
        $validSha='1'*40;$tamperedSha='2'*40;$schemaBadSha='3'*40
        $validFix=Fixture $validSha 'qa-schema'
        $tamperedFix=Fixture $tamperedSha 'qa-schema'
        $schemaBadFix=Fixture $schemaBadSha 'different-schema'
        Copy-Item -LiteralPath $validFix.dir -Destination (Join-Path $root ('releases/'+$validSha)) -Recurse
        Copy-Item -LiteralPath $tamperedFix.dir -Destination (Join-Path $root ('releases/'+$tamperedSha)) -Recurse
        Copy-Item -LiteralPath $schemaBadFix.dir -Destination (Join-Path $root ('releases/'+$schemaBadSha)) -Recurse
        Set-Content -LiteralPath (Join-Path $root ('releases/'+$tamperedSha+'/web/index.html')) -Value 'corrupted after manifest'

        function Invoke-ChildPs([string[]]$ArgList) {
            $outFile=Join-Path $qa ('child-'+[guid]::NewGuid().ToString('N')+'.out')
            $errFile=Join-Path $qa ('child-'+[guid]::NewGuid().ToString('N')+'.err')
            $quotedArgs=@($ArgList | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_.Replace('"', '\"')) + '"' } else { $_ } }) -join ' '
            $proc=Start-Process -FilePath $psExe -ArgumentList $quotedArgs -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
            $stdErr=if(Test-Path -LiteralPath $errFile){Get-Content -LiteralPath $errFile -Raw}else{''}
            return @{ExitCode=$proc.ExitCode;StdErr=[string]$stdErr}
        }

        # 1) Missing Get-FileHash environment must exit non-zero, emit Get-FileHash error to stderr, and keep pointer unchanged
        $noHashCmd="Import-Module Microsoft.PowerShell.Management, Microsoft.PowerShell.Utility -ErrorAction SilentlyContinue; `$uDll=[Microsoft.PowerShell.Commands.ConvertFromJsonCommand].Assembly.Location; Remove-Module Microsoft.PowerShell.Utility -Force -ErrorAction SilentlyContinue; Remove-Item Function:\Get-FileHash -ErrorAction SilentlyContinue; if(`$PSVersionTable.PSEdition -eq 'Desktop' -and `$uDll){Import-Module `$uDll -ErrorAction SilentlyContinue}; `$PSModuleAutoLoadingPreference='None'; & '$($rbScript.Replace("'","''"))' -ConfigPath '$($configPath.Replace("'","''"))' -Sha '$validSha' -Simulation"
        $encodedNoHash=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($noHashCmd))
        $rNoHash=Invoke-ChildPs @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encodedNoHash)
        Assert ($rNoHash.ExitCode -ne 0) ('Missing Get-FileHash must return non-zero exit code, got '+$rNoHash.ExitCode)
        Assert ($rNoHash.StdErr -match 'Get-FileHash') ('Missing Get-FileHash must write Get-FileHash diagnostic to stderr, got: '+$rNoHash.StdErr)
        Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($oldSha)) 'Missing Get-FileHash changed pointer'

        # 2) Normal module environment: hash mismatch must exit non-zero, write integrity error to stderr, and keep pointer unchanged
        $rBadHash=Invoke-ChildPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$rbScript,'-ConfigPath',$configPath,'-Sha',$tamperedSha,'-Simulation')
        Assert ($rBadHash.ExitCode -ne 0) 'Hash tampering must return non-zero exit code'
        Assert ($rBadHash.StdErr -match 'integrity failure') 'Hash tampering must report integrity failure on stderr'
        Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($oldSha)) 'Hash tampering changed pointer'

        # 3) Normal module environment: schema mismatch must exit non-zero, write schema error to stderr, and keep pointer unchanged
        $rBadSchema=Invoke-ChildPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$rbScript,'-ConfigPath',$configPath,'-Sha',$schemaBadSha,'-Simulation')
        Assert ($rBadSchema.ExitCode -ne 0) 'Schema mismatch must return non-zero exit code'
        Assert ($rBadSchema.StdErr -match 'Schema mismatch; migration is manual only') 'Schema mismatch must report error on stderr'
        Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($oldSha)) 'Schema mismatch changed pointer'

        # 4) Normal module environment: valid rollback succeeds with exit code 0 and switches pointer, then restores $oldSha
        $rValid=Invoke-ChildPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$rbScript,'-ConfigPath',$configPath,'-Sha',$validSha,'-Simulation')
        Assert ($rValid.ExitCode -eq 0) ('Valid child rollback must exit 0, got '+$rValid.ExitCode+' stderr='+$rValid.StdErr)
        Assert ([string]::IsNullOrWhiteSpace($rValid.StdErr)) 'Valid child rollback must not emit stderr'
        Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($validSha)) 'Valid child rollback did not update pointer'
        $rRestore=Invoke-ChildPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$rbScript,'-ConfigPath',$configPath,'-Sha',$oldSha,'-Simulation')
        Assert ($rRestore.ExitCode -eq 0) 'Restoring baseline pointer must exit 0'
    }
    Check 'Interrupted deployment blocks blind retry' {$journal=Join-Path $root 'deployment-state.json';Set-Content $journal '{"status":"in_progress"}';Reject {& "$PSScriptRoot/Deploy-Release.ps1" -ConfigPath $configPath -Archive $new.zip -Sha $newSha -ArchiveSha256 $new.digest -Simulation};Assert ((Get-Content (Join-Path $root 'simulation-current.txt') -Raw).Trim().EndsWith($oldSha)) 'Interrupted state changed active release'}
    Write-Output "RESULT: $passed PASS / 0 FAIL / 0 SKIP (simulation only; Windows service integration NOT TESTED)"
} finally {
    # The only recursive deletion in the toolset is this freshly generated, synthetic test directory.
    if ($qa.StartsWith([IO.Path]::GetTempPath()) -and (Split-Path $qa -Leaf).StartsWith('management-lite-deployment-qa-')) { Remove-Item -LiteralPath $qa -Recurse -Force }
}
