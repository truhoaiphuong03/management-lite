param(
  [switch]$VerifyOnly,
  [ValidateSet('AllSafe','ServerAtBoot','DevHubScripts','LegacyHubScripts','StartupVbs','RegistryRun')]
  [string[]]$Component = @('AllSafe'),
  [switch]$ForceReEnableLegacyAutoDeploy
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BackupDir = $PSScriptRoot
$ManifestPath = Join-Path $BackupDir 'manifest-sha256.json'
if (-not (Test-Path -LiteralPath $ManifestPath)) {
  throw "MISSING_BACKUP_MANIFEST: $ManifestPath"
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
foreach ($entry in $manifest) {
  $bakFile = Join-Path $BackupDir $entry.file
  if (-not (Test-Path -LiteralPath $bakFile)) {
    throw "MISSING_BACKUP_FILE: $bakFile"
  }
  $actualHash = (Get-FileHash -LiteralPath $bakFile -Algorithm SHA256).Hash
  if ($actualHash -ne $entry.sha256) {
    throw "BACKUP_HASH_MISMATCH: $($entry.file) expected $($entry.sha256) got $actualHash"
  }
}

if ($VerifyOnly) {
  $drillDir = 'C:\ML-Test\work\hub-restore-drill-oa20'
  if (Test-Path -LiteralPath $drillDir) {
    Remove-Item -LiteralPath $drillDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $drillDir -Force | Out-Null

  foreach ($entry in $manifest) {
    $src = Join-Path $BackupDir $entry.file
    $dst = Join-Path $drillDir $entry.file
    Copy-Item -LiteralPath $src -Destination $dst -Force
    $dstHash = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash
    if ($dstHash -ne $entry.sha256) {
      throw "DRILL_RESTORE_HASH_MISMATCH: $($entry.file)"
    }
  }

  # Validate XML and JSON parseability
  [xml]$task1 = Get-Content -LiteralPath (Join-Path $drillDir 'Task-HoaiPhuong-Anty-AtBoot.xml') -Raw
  [xml]$task2 = Get-Content -LiteralPath (Join-Path $drillDir 'Task-AntyRemoteHubServer24x7.xml') -Raw
  $regObj = Get-Content -LiteralPath (Join-Path $drillDir 'HKCU-Run-AntyRemoteHubServer24x7.json') -Raw | ConvertFrom-Json
  if (-not $task1.Task -or -not $task2.Task -or -not $regObj.name) {
    throw 'DRILL_PARSE_VALIDATION_FAILED'
  }

  Write-Output ("OA20_BACKUP_VERIFY_PASS: files={0} drill_dir={1}" -f $manifest.Count, $drillDir)
  exit 0
}

foreach ($comp in $Component) {
  switch ($comp) {
    'ServerAtBoot' {
      Copy-Item -LiteralPath (Join-Path $BackupDir 'server-atboot.ps1.bak') -Destination 'C:\ProgramData\HoaiPhuong\ServerStartup\server-atboot.ps1' -Force
      Write-Output 'RESTORED: C:\ProgramData\HoaiPhuong\ServerStartup\server-atboot.ps1'
    }
    'DevHubScripts' {
      Copy-Item -LiteralPath (Join-Path $BackupDir 'dev-server-daemon.mjs.bak') -Destination 'C:\Projects-Dev\anty-remote-hub\src\server-daemon.mjs' -Force
      Copy-Item -LiteralPath (Join-Path $BackupDir 'dev-sync-live-web.mjs.bak') -Destination 'C:\Projects-Dev\anty-remote-hub\src\sync-live-web.mjs' -Force
      Write-Output 'RESTORED: C:\Projects-Dev\anty-remote-hub\src\{server-daemon.mjs,sync-live-web.mjs}'
    }
    'LegacyHubScripts' {
      if (-not $ForceReEnableLegacyAutoDeploy) {
        throw 'REFUSED_LEGACY_AUTO_DEPLOY_RESTORE: Pass -ForceReEnableLegacyAutoDeploy explicitly if Owner approves restoring unguarded legacy scripts.'
      }
      Copy-Item -LiteralPath (Join-Path $BackupDir 'legacy-server-daemon.mjs.bak') -Destination 'C:\Projects\anty-remote-hub\src\server-daemon.mjs' -Force
      Copy-Item -LiteralPath (Join-Path $BackupDir 'legacy-sync-live-web.mjs.bak') -Destination 'C:\Projects\anty-remote-hub\src\sync-live-web.mjs' -Force
      Copy-Item -LiteralPath (Join-Path $BackupDir 'legacy-index.mjs.bak') -Destination 'C:\Projects\anty-remote-hub\src\index.mjs' -Force
      Write-Output 'RESTORED: C:\Projects\anty-remote-hub\src\{server-daemon.mjs,sync-live-web.mjs,index.mjs}'
    }
    'StartupVbs' {
      if (-not $ForceReEnableLegacyAutoDeploy) {
        throw 'REFUSED_LEGACY_VBS_RESTORE: Pass -ForceReEnableLegacyAutoDeploy explicitly if Owner approves restoring legacy VBS launchers.'
      }
      Copy-Item -LiteralPath (Join-Path $BackupDir 'anty-daemon-hidden.vbs.bak') -Destination 'C:\Projects\anty-daemon-hidden.vbs' -Force
      Copy-Item -LiteralPath (Join-Path $BackupDir 'Startup-anty-remote-hub.vbs.bak') -Destination 'C:\Users\ADMIN\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\anty-remote-hub.vbs' -Force
      Write-Output 'RESTORED: Legacy VBS launchers'
    }
    'RegistryRun' {
      if (-not $ForceReEnableLegacyAutoDeploy) {
        throw 'REFUSED_LEGACY_REGISTRY_RESTORE: Pass -ForceReEnableLegacyAutoDeploy explicitly if Owner approves restoring HKCU Run value.'
      }
      $regMeta = Get-Content -LiteralPath (Join-Path $BackupDir 'HKCU-Run-AntyRemoteHubServer24x7.json') -Raw | ConvertFrom-Json
      Set-ItemProperty -Path $regMeta.key -Name $regMeta.name -Value $regMeta.value -Type String
      Write-Output 'RESTORED: HKCU Run AntyRemoteHubServer24x7'
    }
  }
}
