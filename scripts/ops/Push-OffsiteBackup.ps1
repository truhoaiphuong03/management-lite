[CmdletBinding()]
param(
  [string]$DumpFile = '',
  [string[]]$BackupSourceDirs = @(
    'C:\HoaiPhuong-Server\backups\postgresql',
    'C:\HoaiPhuong-Server\backups\postgres'
  ),
  [string]$ReceiptDir = 'C:\HoaiPhuong-Server\apps\management-lite\data\receipts',
  [string]$PassphraseFile = 'C:\HP-Offsite\passphrase.txt',
  [string]$StagingRoot = 'C:\HP-Offsite\staging',
  [string]$LogDir = 'C:\HP-Offsite\logs',
  [string]$Repo = 'truhoaiphuong03/management-lite-backups',
  [string]$TagPrefix = 'backup',
  [string]$PgBin = 'C:\HoaiPhuong-Server\config\postgresql-18\pgsql\bin',
  [string]$NodeExe = '',
  [int64]$MaxChunkBytes = 1900000000,
  [int]$DailyKeep = 14,
  [switch]$SkipRetentionPrune
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$logDate = (Get-Date).ToUniversalTime().ToString('yyyyMMdd')
$logFile = Join-Path $LogDir "offsite-backup-$logDate.log"

function Write-OffsiteLog {
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

$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$runStagingDir = Join-Path $StagingRoot $runId

try {
  Write-OffsiteLog "Starting offsite backup run ($runId) for repo '$Repo' (tagPrefix='$TagPrefix')..."

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
    } else {
      throw "Missing pg_restore.exe at '$pgRestoreExe'."
    }
  }

  $coreScript = Join-Path $PSScriptRoot 'offsite-backup-core.mjs'
  if (-not (Test-Path -LiteralPath $coreScript)) {
    throw "Missing core script at '$coreScript'."
  }

  # 1. Resolve latest .dump file (READ-ONLY)
  $resolvedDump = $null
  if (-not [string]::IsNullOrWhiteSpace($DumpFile)) {
    if (-not (Test-Path -LiteralPath $DumpFile -PathType Leaf)) {
      throw "Specified DumpFile does not exist: '$DumpFile'"
    }
    $resolvedDump = Get-Item -LiteralPath $DumpFile
  } else {
    $candidates = @()
    foreach ($dir in $BackupSourceDirs) {
      if (Test-Path -LiteralPath $dir -PathType Container) {
        $candidates += @(Get-ChildItem -LiteralPath $dir -Filter '*.dump' -File)
      }
    }
    if ($candidates.Count -eq 0) {
      throw "No .dump files found in BackupSourceDirs: $($BackupSourceDirs -join ', ')"
    }
    $resolvedDump = $candidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  }

  $sourceSha = (Get-FileHash -LiteralPath $resolvedDump.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $companionShaFile = "$($resolvedDump.FullName).sha256.json"
  if (Test-Path -LiteralPath $companionShaFile -PathType Leaf) {
    $companionObj = Get-Content -LiteralPath $companionShaFile -Raw | ConvertFrom-Json
    if ($companionObj.Hash -and $companionObj.Hash.ToLowerInvariant() -ne $sourceSha) {
      throw "Source dump SHA-256 ($sourceSha) does not match companion .sha256.json ($($companionObj.Hash))."
    }
  }
  Write-OffsiteLog "Selected dump (read-only): $($resolvedDump.Name) (Size=$($resolvedDump.Length) bytes, SHA256=$sourceSha)"

  New-Item -ItemType Directory -Path $runStagingDir -Force | Out-Null
  $stampUtc = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
  $shortSha8 = $sourceSha.Substring(0, 8)
  $shortSha16 = $sourceSha.Substring(0, 16)
  $tagName = "$TagPrefix-$stampUtc-$shortSha8"

  # 2. Encrypt .dump file to staging
  $encDumpName = "postgres-$stampUtc-sha256-$shortSha16.dump.enc"
  $encDumpPath = Join-Path $runStagingDir $encDumpName

  Write-OffsiteLog "Encrypting dump with AES-256-GCM + scrypt -> $encDumpName..."
  $encOut = & $NodeExe $coreScript encrypt --in $resolvedDump.FullName --out $encDumpPath --passphrase-file $PassphraseFile --max-chunk-bytes $MaxChunkBytes 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Encryption failed: $($encOut -join ' ')"
  }
  $encResult = ($encOut -join "`n") | ConvertFrom-Json
  $assetsToUpload = @($encResult.partPaths) + @($encResult.manifestPath)

  # 3. Compress & encrypt receipts directory if non-empty (READ-ONLY on source)
  $receiptCount = 0
  if (-not [string]::IsNullOrWhiteSpace($ReceiptDir) -and (Test-Path -LiteralPath $ReceiptDir -PathType Container)) {
    $receiptFiles = @(Get-ChildItem -LiteralPath $ReceiptDir -Recurse -File)
    $receiptCount = $receiptFiles.Count
    if ($receiptCount -gt 0) {
      $stagingReceiptsZip = Join-Path $runStagingDir "receipts-$stampUtc.zip"
      Compress-Archive -Path (Join-Path $ReceiptDir '*') -DestinationPath $stagingReceiptsZip -Force
      $encReceiptsPath = Join-Path $runStagingDir "receipts-$stampUtc.zip.enc"
      Write-OffsiteLog "Encrypting $receiptCount receipt file(s) -> $(Split-Path $encReceiptsPath -Leaf)..."
      $recEncOut = & $NodeExe $coreScript encrypt --in $stagingReceiptsZip --out $encReceiptsPath --passphrase-file $PassphraseFile --max-chunk-bytes $MaxChunkBytes 2>&1
      if ($LASTEXITCODE -ne 0) {
        throw "Receipts encryption failed: $($recEncOut -join ' ')"
      }
      $recEncResult = ($recEncOut -join "`n") | ConvertFrom-Json
      $assetsToUpload += @($recEncResult.partPaths) + @($recEncResult.manifestPath)
    } else {
      Write-OffsiteLog "ReceiptDir '$ReceiptDir' contains 0 files (nothing extra to archive)."
    }
  }

  # 4. Upload to GitHub Releases
  $releaseNotes = "Encrypted Management Lite Offsite Backup`n- Created UTC: $stampUtc`n- Source Dump: $($resolvedDump.Name)`n- Plaintext SHA-256: $sourceSha`n-Encrypted SHA-256: $($encResult.manifest.encrypted_sha256)`n- Receipts Count: $receiptCount"
  $assetsArg = $assetsToUpload -join ';'

  Write-OffsiteLog "Uploading $($assetsToUpload.Count) asset(s) to GitHub release '$tagName' in '$Repo'..."
  $pushOut = & $NodeExe $coreScript push-release --repo $Repo --tag $tagName --title $tagName --notes $releaseNotes --assets $assetsArg 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub release upload failed: $($pushOut -join ' ')"
  }
  $pushResult = ($pushOut -join "`n") | ConvertFrom-Json
  Write-OffsiteLog "Uploaded release '$tagName' (releaseId=$($pushResult.releaseId)). Starting round-trip verification..."

  # 5. Round-trip self-verification: download -> verify SHA-256 -> decrypt -> pg_restore --list
  $verifyDir = Join-Path $runStagingDir 'verify-download'
  $dlOut = & $NodeExe $coreScript download-release --repo $Repo --tag $tagName --dest-dir $verifyDir 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Verification download failed: $($dlOut -join ' ')"
  }

  $downloadedEncDump = Join-Path $verifyDir $encDumpName
  $downloadedManifest = "$downloadedEncDump.sha256.json"
  if (-not (Test-Path -LiteralPath $downloadedManifest -PathType Leaf)) {
    throw "Verification failed: downloaded manifest missing at '$downloadedManifest'."
  }

  $verifyDecryptedDump = Join-Path $verifyDir 'verified-restored.dump'
  $decOut = & $NodeExe $coreScript decrypt --in $downloadedEncDump --out $verifyDecryptedDump --passphrase-file $PassphraseFile --manifest $downloadedManifest 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Verification decryption failed: $($decOut -join ' ')"
  }

  $verifiedPlainSha = (Get-FileHash -LiteralPath $verifyDecryptedDump -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($verifiedPlainSha -ne $sourceSha) {
    throw "Verification plaintext SHA-256 mismatch! Expected $sourceSha, got $verifiedPlainSha."
  }

  $tocLines = @(& $pgRestoreExe --list $verifyDecryptedDump 2>&1)
  if ($LASTEXITCODE -ne 0 -or $tocLines.Count -lt 5) {
    throw "pg_restore --list verification failed on decrypted dump (exit=$LASTEXITCODE)."
  }
  Write-OffsiteLog "Round-trip verification PASSED: SHA-256 matched ($verifiedPlainSha) and pg_restore --list read $($tocLines.Count) lines."

  # 6. Retention policy: keep 14 daily + 1 monthly
  if (-not $SkipRetentionPrune -and $TagPrefix -eq 'backup') {
    Write-OffsiteLog "Applying retention policy (keep $DailyKeep daily + 1 per month)..."
    $pruneOut = & $NodeExe $coreScript prune-releases --repo $Repo --tag-prefix "$TagPrefix-" --daily-keep $DailyKeep 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Retention pruning failed: $($pruneOut -join ' ')"
    }
    $pruneRes = ($pruneOut -join "`n") | ConvertFrom-Json
    Write-OffsiteLog "Retention complete: kept=$($pruneRes.keptCount), deleted=$($pruneRes.deletedCount)."
  }

  Write-OffsiteLog "SUCCESS: Offsite backup '$tagName' completed and verified."
  [PSCustomObject]@{
    status          = 'SUCCESS'
    tag             = $tagName
    repo            = $Repo
    sourceDump      = $resolvedDump.Name
    plaintextSha256 = $sourceSha
    encryptedSha256 = $encResult.manifest.encrypted_sha256
    tocLineCount    = $tocLines.Count
    receiptsCount   = $receiptCount
    logFile         = $logFile
  } | ConvertTo-Json -Depth 4
} catch {
  Write-OffsiteLog "FAILED: $($_.Exception.Message)" -Level 'ERROR'
  exit 1
} finally {
  if (Test-Path -LiteralPath $runStagingDir) {
    Remove-Item -LiteralPath $runStagingDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
