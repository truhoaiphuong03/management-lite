[CmdletBinding()]
param(
  [string]$EncryptedFile = '',
  [string]$OutputFile = '',
  [string]$Tag = '',
  [switch]$Latest,
  [string]$OutputDir = 'C:\HP-Offsite\restore',
  [string]$PassphraseFile = 'C:\HP-Offsite\passphrase.txt',
  [string]$Repo = 'truhoaiphuong03/management-lite-backups',
  [string]$LogDir = 'C:\HP-Offsite\logs',
  [string]$PgBin = 'C:\HoaiPhuong-Server\config\postgresql-18\pgsql\bin',
  [string]$NodeExe = ''
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$logDate = (Get-Date).ToUniversalTime().ToString('yyyyMMdd')
$logFile = Join-Path $LogDir "offsite-restore-$logDate.log"

function Write-RestoreLog {
  param(
    [Parameter(Mandatory)][string]$Message,
    [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
  )
  $ts = (Get-Date).ToUniversalTime().ToString('o')
  $line = "[$ts] [$Level] $Message"
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  if ($Level -eq 'ERROR') {
    Write-Error $line -ErrorAction Continue
  } else {
    Write-Host $line
  }
}

try {
  if ([string]::IsNullOrWhiteSpace($NodeExe)) {
    $srvNode = 'C:\HoaiPhuong-Server\config\runtime\node-v22.14.0-win-x64\node.exe'
    $testNode = 'C:\ML-Test\runtime\node-v22.14.0-win-x64\node.exe'
    if (Test-Path -LiteralPath $srvNode) {
      $NodeExe = $srvNode
    } elseif (Test-Path -LiteralPath $testNode) {
      $NodeExe = $testNode
    } else {
      $NodeExe = 'node'
    }
  }

  $pgRestoreExe = Join-Path $PgBin 'pg_restore.exe'
  if (-not (Test-Path -LiteralPath $pgRestoreExe)) {
    $altPgRestore = 'C:\ML-Test\pgsql\bin\pg_restore.exe'
    if (Test-Path -LiteralPath $altPgRestore) {
      $pgRestoreExe = $altPgRestore
    }
  }

  $coreScript = Join-Path $PSScriptRoot 'offsite-backup-core.mjs'
  if (-not (Test-Path -LiteralPath $coreScript)) {
    throw "Missing core script at '$coreScript'."
  }

  # Guard against writing into C:\HoaiPhuong-Server
  $targetCheck = if (-not [string]::IsNullOrWhiteSpace($OutputFile)) { $OutputFile } else { $OutputDir }
  $fullTarget = [IO.Path]::GetFullPath($targetCheck)
  if ($fullTarget.StartsWith('C:\HoaiPhuong-Server', [StringComparison]::OrdinalIgnoreCase)) {
    throw "FORBIDDEN_PRODUCTION_WRITE: Refusing to restore directly into C:\HoaiPhuong-Server ('$fullTarget')."
  }

  # Local file decryption mode
  if (-not [string]::IsNullOrWhiteSpace($EncryptedFile)) {
    if ([string]::IsNullOrWhiteSpace($OutputFile)) {
      New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
      $baseName = (Split-Path $EncryptedFile -Leaf) -replace '\.enc$', ''
      $OutputFile = Join-Path $OutputDir $baseName
    }
    Write-RestoreLog "Decrypting local file '$EncryptedFile' -> '$OutputFile'..."
    $decOut = & $NodeExe $coreScript decrypt --in $EncryptedFile --out $OutputFile --passphrase-file $PassphraseFile 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Decryption failed: $($decOut -join ' ')"
    }
    $decRes = ($decOut -join "`n") | ConvertFrom-Json
    if ((Test-Path -LiteralPath $pgRestoreExe) -and $OutputFile.EndsWith('.dump')) {
      $toc = @(& $pgRestoreExe --list $OutputFile 2>&1)
      if ($LASTEXITCODE -ne 0) {
        throw "pg_restore --list failed on decrypted dump '$OutputFile'."
      }
      Write-RestoreLog "Verified decrypted dump with pg_restore --list ($($toc.Count) lines)."
    }
    Write-RestoreLog "SUCCESS: Restored plaintext file to '$OutputFile' (SHA256=$($decRes.plaintextSha256))."
    $decOut -join "`n"
    exit 0
  }

  # Remote GitHub Release download + decryption mode
  if ($Latest -and [string]::IsNullOrWhiteSpace($Tag)) {
    Write-RestoreLog "Resolving latest release in '$Repo'..."
    $prunePreview = & $NodeExe $coreScript prune-releases --repo $Repo --tag-prefix 'backup-' --dry-run 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to list releases from '$Repo': $($prunePreview -join ' ')"
    }
    $previewObj = ($prunePreview -join "`n") | ConvertFrom-Json
    if (-not $previewObj.keptTags -or $previewObj.keptTags.Count -eq 0) {
      throw "No 'backup-*' releases found in '$Repo'."
    }
    $Tag = $previewObj.keptTags[0]
  }

  if ([string]::IsNullOrWhiteSpace($Tag)) {
    throw "Specify either -EncryptedFile <path>, -Tag <release-tag>, or -Latest."
  }

  $destSubDir = Join-Path $OutputDir $Tag
  $dlDir = Join-Path $destSubDir 'encrypted'
  New-Item -ItemType Directory -Path $dlDir -Force | Out-Null

  Write-RestoreLog "Downloading release '$Tag' from '$Repo' to '$dlDir'..."
  $dlOut = & $NodeExe $coreScript download-release --repo $Repo --tag $Tag --dest-dir $dlDir 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Download failed: $($dlOut -join ' ')"
  }

  $manifests = @(Get-ChildItem -LiteralPath $dlDir -Filter '*.sha256.json' -File)
  if ($manifests.Count -eq 0) {
    throw "No .sha256.json manifest found in release '$Tag'."
  }

  $restoredFiles = @()
  foreach ($mf in $manifests) {
    $mfObj = Get-Content -LiteralPath $mf.FullName -Raw | ConvertFrom-Json
    $encTarget = Join-Path $dlDir $mfObj.encrypted_name
    $plainOut = Join-Path $destSubDir $mfObj.original_name
    Write-RestoreLog "Decrypting '$($mfObj.encrypted_name)' -> '$plainOut'..."
    $decOut = & $NodeExe $coreScript decrypt --in $encTarget --out $plainOut --passphrase-file $PassphraseFile --manifest $mf.FullName 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Decryption failed for '$($mfObj.encrypted_name)': $($decOut -join ' ')"
    }
    if ((Test-Path -LiteralPath $pgRestoreExe) -and $plainOut.EndsWith('.dump')) {
      $toc = @(& $pgRestoreExe --list $plainOut 2>&1)
      if ($LASTEXITCODE -ne 0) {
        throw "pg_restore --list verification failed for '$plainOut'."
      }
      Write-RestoreLog "pg_restore --list verified '$plainOut' ($($toc.Count) lines)."
    }
    $restoredFiles += $plainOut
  }

  Write-RestoreLog "SUCCESS: Release '$Tag' downloaded, decrypted, and verified in '$destSubDir'."
  [PSCustomObject]@{
    status        = 'SUCCESS'
    tag           = $Tag
    outputDir     = $destSubDir
    restoredFiles = $restoredFiles
  } | ConvertTo-Json -Depth 4
} catch {
  Write-RestoreLog "FAILED: $($_.Exception.Message)" -Level 'ERROR'
  exit 1
}
