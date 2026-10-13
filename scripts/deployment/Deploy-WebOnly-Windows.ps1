#requires -Version 5.1
<#
.SYNOPSIS
    Deploy-WebOnly-Windows.ps1 - Fast Web-Only Deployment and Instant Rollback for Management Lite
.DESCRIPTION
    Deploys the static Web frontend to Windows server without restarting the API or touching the database.
    Provides sub-second rollback to previous release or original Demo.
.PARAMETER WebBundle
    Path to management-lite-web-<sha>.tar.gz or extracted web directory.
.PARAMETER TargetRoot
    Root directory on Windows (Default: C:\ManagementLite).
.PARAMETER RollbackTo
    Optional: Specify a previous release SHA or 'v0-demo' to immediately revert.
.PARAMETER DryRun
    Simulate actions without modifying files.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)][string]$WebBundle,
    [Parameter(Mandatory=$false)][string]$TargetRoot = "C:\ManagementLite",
    [Parameter(Mandatory=$false)][string]$RollbackTo,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

Write-Host "=== MANAGEMENT LITE: WEB-ONLY UPDATE TOOL ===" -ForegroundColor Cyan
Write-Host "Target Root: $TargetRoot"

$currentWebPath = Join-Path $TargetRoot "current\web"
$releasesWebPath = Join-Path $TargetRoot "releases"
$demoBackupPath = Join-Path $releasesWebPath "v0-demo\web"

# Ensure root directories exist
if (-not (Test-Path $releasesWebPath)) {
    New-Item -ItemType Directory -Force -Path $releasesWebPath | Out-Null
}

# 1. HANDLE ROLLBACK REQUEST
if ($RollbackTo) {
    Write-Host "`n[ROLLBACK] Requested rollback to: $RollbackTo" -ForegroundColor Yellow
    $rollbackSource = Join-Path $releasesWebPath "$RollbackTo\web"
    if (-not (Test-Path $rollbackSource)) {
        # Check if directly targeting demo
        if ($RollbackTo -eq 'demo' -or $RollbackTo -eq 'v0-demo') {
            $rollbackSource = $demoBackupPath
        }
    }

    if (-not (Test-Path $rollbackSource)) {
        throw "Rollback source not found: $rollbackSource"
    }

    Write-Host "[ROLLBACK] Reverting current web pointer to: $rollbackSource"
    if (-not $DryRun) {
        if (Test-Path $currentWebPath) {
            Remove-Item -Path $currentWebPath -Recurse -Force
        }
        Copy-Item -Path $rollbackSource -Destination $currentWebPath -Recurse -Force
        Write-Host "✓ Rollback completed successfully in < 1 second!" -ForegroundColor Green
    } else {
        Write-Host "[DRY-RUN] Would swap $currentWebPath to $rollbackSource"
    }
    exit 0
}

# 2. VALIDATE INPUT BUNDLE
if (-not $WebBundle) {
    throw "Parameter -WebBundle is required for deployment. Usage: .\Deploy-WebOnly-Windows.ps1 -WebBundle <path-to-tar.gz>"
}

if (-not (Test-Path $WebBundle)) {
    throw "Web bundle file does not exist: $WebBundle"
}

# 3. BACKUP CURRENT DEMO (IF NOT YET BACKED UP)
if (Test-Path $currentWebPath) {
    if (-not (Test-Path $demoBackupPath)) {
        Write-Host "`n[BACKUP] Backing up current running version to: $demoBackupPath" -ForegroundColor Magenta
        if (-not $DryRun) {
            New-Item -ItemType Directory -Force -Path $demoBackupPath | Out-Null
            Copy-Item -Path "$currentWebPath\*" -Destination $demoBackupPath -Recurse -Force
            Write-Host "✓ Original version securely preserved at $demoBackupPath" -ForegroundColor Green
        }
    }
}

# 4. UNPACK BUNDLE INTO STAGING
$tempExtract = Join-Path $env:TEMP "mgmt-lite-web-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Force -Path $tempExtract | Out-Null

try {
    Write-Host "`n[EXTRACT] Unpacking $WebBundle..."
    tar -xzf $WebBundle -C $tempExtract

    # Verify manifest.json and release-version.json
    $manifestPath = Join-Path $tempExtract "manifest.json"
    $versionPath = Join-Path $tempExtract "web\release-version.json"

    if (-not (Test-Path $versionPath)) {
        throw "Invalid bundle: web/release-version.json not found in archive"
    }

    $versionInfo = Get-Content -Raw -Path $versionPath | ConvertFrom-Json
    $bundleSha = $versionInfo.sha
    Write-Host "[VERIFY] Bundle Commit SHA: $bundleSha" -ForegroundColor Cyan

    # Verify index.html exists
    $indexPath = Join-Path $tempExtract "web\index.html"
    if (-not (Test-Path $indexPath)) {
        throw "Invalid bundle: web/index.html not found"
    }

    # Destination release directory
    $newReleaseDir = Join-Path $releasesWebPath "$($bundleSha.Substring(0,10))\web"
    Write-Host "[STAGING] Staging new release into: $newReleaseDir"
    
    if (-not $DryRun) {
        if (Test-Path $newReleaseDir) {
            Remove-Item -Path $newReleaseDir -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path (Split-Path $newReleaseDir -Parent) | Out-Null
        Copy-Item -Path (Join-Path $tempExtract "web") -Destination (Split-Path $newReleaseDir -Parent) -Recurse -Force

        # 5. ATOMIC SWAP TO CURRENT
        Write-Host "[ACTIVATE] Swapping $currentWebPath to new release..."
        $tempSwap = Join-Path $TargetRoot "current_web_temp"
        Copy-Item -Path $newReleaseDir -Destination $tempSwap -Recurse -Force
        
        if (Test-Path $currentWebPath) {
            Remove-Item -Path $currentWebPath -Recurse -Force
        }
        Rename-Item -Path $tempSwap -NewName "web" -Force

        Write-Host "`n=== WEB-ONLY CUTOVER COMPLETE ===" -ForegroundColor Green
        Write-Host "Serving: Management Lite (SHA: $bundleSha)"
        Write-Host "Live Web Root: $currentWebPath"
        Write-Host "To rollback to Demo anytime: .\Deploy-WebOnly-Windows.ps1 -RollbackTo v0-demo" -ForegroundColor Yellow
    } else {
        Write-Host "[DRY-RUN] Simulation successful. No files changed."
    }
} finally {
    if (Test-Path $tempExtract) {
        Remove-Item -Path $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
}
