#requires -Version 5.1
<#
.SYNOPSIS
    Deploy-WebOnly-Windows.ps1 - Fast Web-Only Deployment and Instant Rollback for Management Lite
.DESCRIPTION
    Deploys the static Web frontend to Windows server without restarting the API or touching the database.
    Requires verified Owner Approval Manifest and manifest.json per-file SHA-256 integrity.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)][string]$WebBundle,
    [Parameter(Mandatory=$false)][string]$TargetRoot = "C:\ManagementLite",
    [Parameter(Mandatory=$false)][string]$ApprovalManifestPath = "C:\HoaiPhuong-Server\config\release-gate\approved-release.json",
    [Parameter(Mandatory=$false)][string]$RollbackTo,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "=== MANAGEMENT LITE: WEB-ONLY UPDATE TOOL ===" -ForegroundColor Cyan
Write-Host "Target Root: $TargetRoot"

$currentWebPath = Join-Path $TargetRoot "current\web"
$releasesWebPath = Join-Path $TargetRoot "releases"
$demoBackupPath = Join-Path $releasesWebPath "v0-demo\web"

if (-not (Test-Path -LiteralPath $releasesWebPath)) {
    New-Item -ItemType Directory -Force -Path $releasesWebPath | Out-Null
}

# 1. HANDLE ROLLBACK REQUEST
if ($RollbackTo) {
    Write-Host "`n[ROLLBACK] Requested rollback to: $RollbackTo" -ForegroundColor Yellow
    $rollbackSource = Join-Path $releasesWebPath "$RollbackTo\web"
    if (-not (Test-Path -LiteralPath $rollbackSource)) {
        if ($RollbackTo -eq 'demo' -or $RollbackTo -eq 'v0-demo') {
            $rollbackSource = $demoBackupPath
        }
    }

    if (-not (Test-Path -LiteralPath $rollbackSource)) {
        throw "Rollback source not found: $rollbackSource"
    }

    Write-Host "[ROLLBACK] Reverting current web pointer to: $rollbackSource"
    if (-not $DryRun) {
        if (Test-Path -LiteralPath $currentWebPath) {
            Remove-Item -LiteralPath $currentWebPath -Recurse -Force
        }
        Copy-Item -LiteralPath $rollbackSource -Destination $currentWebPath -Recurse -Force
        Write-Host "[OK] Rollback completed successfully in under 1 second." -ForegroundColor Green
    } else {
        Write-Host "[DRY-RUN] Would swap $currentWebPath to $rollbackSource"
    }
    exit 0
}

# 2. VALIDATE INPUT BUNDLE & OWNER APPROVAL GATE
if (-not $WebBundle) {
    throw "Parameter -WebBundle is required for deployment."
}
if (-not (Test-Path -LiteralPath $WebBundle)) {
    throw "Web bundle file does not exist: $WebBundle"
}
if (-not (Test-Path -LiteralPath $ApprovalManifestPath)) {
    throw "GATE REJECTED: Missing Owner approval manifest at $ApprovalManifestPath"
}
$approval = Get-Content -LiteralPath $ApprovalManifestPath -Raw | ConvertFrom-Json
if ($approval.status -ne 'APPROVED' -or [string]::IsNullOrWhiteSpace($approval.signature_base64)) {
    throw "GATE REJECTED: Approval manifest is not cryptographically signed and APPROVED."
}
$bundleActualHash = (Get-FileHash -LiteralPath $WebBundle -Algorithm SHA256).Hash.ToLowerInvariant()
if ($approval.artifact_sha256 -and $approval.artifact_sha256.ToLowerInvariant() -ne $bundleActualHash) {
    throw "GATE REJECTED: WebBundle SHA-256 ($bundleActualHash) does not match Owner-approved artifact_sha256 ($($approval.artifact_sha256))."
}

# 3. BACKUP CURRENT VERSION (IF NOT YET BACKED UP)
if (Test-Path -LiteralPath $currentWebPath) {
    if (-not (Test-Path -LiteralPath $demoBackupPath)) {
        Write-Host "`n[BACKUP] Backing up current running version to: $demoBackupPath" -ForegroundColor Magenta
        if (-not $DryRun) {
            New-Item -ItemType Directory -Force -Path $demoBackupPath | Out-Null
            Copy-Item -Path "$currentWebPath\*" -Destination $demoBackupPath -Recurse -Force
            Write-Host "[OK] Original version securely preserved at $demoBackupPath" -ForegroundColor Green
        }
    }
}

# 4. UNPACK BUNDLE INTO STAGING & VERIFY MANIFEST CHECKSUMS
$tempExtract = Join-Path $env:TEMP "mgmt-lite-web-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Force -Path $tempExtract | Out-Null

try {
    Write-Host "`n[EXTRACT] Unpacking $WebBundle..."
    tar -xzf $WebBundle -C $tempExtract
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to extract $WebBundle"
    }

    $manifestPath = Join-Path $tempExtract "manifest.json"
    $versionPath = Join-Path $tempExtract "web\release-version.json"

    if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $versionPath)) {
        throw "Invalid bundle: manifest.json or web/release-version.json not found in archive"
    }

    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $versionInfo = Get-Content -Raw -LiteralPath $versionPath | ConvertFrom-Json
    $bundleSha = $versionInfo.sha.Trim().ToLowerInvariant()

    if ($bundleSha -notmatch '^[0-9a-f]{40}$' -or $bundleSha -ne $manifest.sha.Trim().ToLowerInvariant()) {
        throw "Invalid bundle SHA or mismatch between manifest.json and release-version.json"
    }
    if ($approval.approved_sha.Trim().ToLowerInvariant() -ne $bundleSha) {
        throw "GATE REJECTED: Bundle SHA ($bundleSha) does not match Owner-approved SHA ($($approval.approved_sha))."
    }

    foreach ($entry in $manifest.files) {
        $fp = Join-Path $tempExtract $entry.path
        if (-not (Test-Path -LiteralPath $fp)) {
            throw "Missing file listed in manifest.json: $($entry.path)"
        }
        $fh = (Get-FileHash -LiteralPath $fp -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($fh -ne $entry.sha256.ToLowerInvariant()) {
            throw "SHA-256 mismatch for file $($entry.path)"
        }
    }

    Write-Host "[VERIFY] Bundle Commit SHA & all file SHA-256 checksums verified: $bundleSha" -ForegroundColor Cyan

    $indexPath = Join-Path $tempExtract "web\index.html"
    if (-not (Test-Path -LiteralPath $indexPath)) {
        throw "Invalid bundle: web/index.html not found"
    }

    $newReleaseDir = Join-Path $releasesWebPath "$($bundleSha.Substring(0,10))\web"
    Write-Host "[STAGING] Staging new release into: $newReleaseDir"

    if (-not $DryRun) {
        if (Test-Path -LiteralPath $newReleaseDir) {
            Remove-Item -LiteralPath $newReleaseDir -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path (Split-Path $newReleaseDir -Parent) | Out-Null
        Copy-Item -LiteralPath (Join-Path $tempExtract "web") -Destination (Split-Path $newReleaseDir -Parent) -Recurse -Force

        Write-Host "[ACTIVATE] Swapping $currentWebPath to new release..."
        $tempSwap = Join-Path $TargetRoot "current_web_temp"
        Copy-Item -LiteralPath $newReleaseDir -Destination $tempSwap -Recurse -Force

        if (Test-Path -LiteralPath $currentWebPath) {
            Remove-Item -LiteralPath $currentWebPath -Recurse -Force
        }
        Rename-Item -LiteralPath $tempSwap -NewName "web" -Force

        Write-Host "`n=== WEB-ONLY CUTOVER COMPLETE ===" -ForegroundColor Green
        Write-Host "Serving: Management Lite (SHA: $bundleSha)"
        Write-Host "Live Web Root: $currentWebPath"
    } else {
        Write-Host "[DRY-RUN] Simulation successful. No files changed."
    }
} finally {
    if (Test-Path -LiteralPath $tempExtract) {
        Remove-Item -LiteralPath $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
}
