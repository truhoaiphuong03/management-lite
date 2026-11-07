#requires -Version 5.1
<#
.SYNOPSIS
  Owner-Locked Cutover Script for HPManagementLiteWeb Static Server (v0.9.7).
  - Switches C:\HoaiPhuong-Server\scripts\serve-management-web.cjs from the legacy no-store script
    to delegate directly to canonical C:\HoaiPhuong-Server\apps\management-lite\scripts\runtime\serve-web.cjs
    (enabling immutable 1-year browser + Cloudflare cache on /assets/*, in-memory Brotli/Gzip, ETag, and CSP).
  - Strictly enforces OS Kernel High-Integrity Elevated Administrator token (UAC) on Production.
  - Creates SHA-256 verified backup before mutation and automatically rolls back on any verification failure.
#>
[CmdletBinding()]
param(
  [string]$ServerRoot = 'C:\HoaiPhuong-Server',
  [string]$WebServiceName = 'HPManagementLiteWeb',
  [string]$WebBaseUrl = 'http://127.0.0.1:3001',
  [switch]$DryRun,
  [switch]$SandboxMode,
  [switch]$SkipServiceRestart,
  [switch]$SimulateVerificationFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not ('ManagementLiteWebCutoverTokenSecurity' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class ManagementLiteWebCutoverTokenSecurity {
  private const int TokenIntegrityLevel = 25;
  private const uint SE_GROUP_INTEGRITY = 0x00000020;

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool GetTokenInformation(
    IntPtr TokenHandle,
    int TokenInformationClass,
    IntPtr TokenInformation,
    int TokenInformationLength,
    out int ReturnLength
  );

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool IsValidSid(IntPtr pSid);

  public static string GetTokenIntegritySid(IntPtr tokenHandle) {
    if (tokenHandle == IntPtr.Zero) return null;
    int returnLength = 0;
    GetTokenInformation(tokenHandle, TokenIntegrityLevel, IntPtr.Zero, 0, out returnLength);
    if (returnLength <= 0) return null;
    IntPtr buffer = Marshal.AllocHGlobal(returnLength);
    try {
      if (!GetTokenInformation(tokenHandle, TokenIntegrityLevel, buffer, returnLength, out returnLength)) {
        return null;
      }
      IntPtr pSid = Marshal.ReadIntPtr(buffer);
      if (pSid == IntPtr.Zero || !IsValidSid(pSid)) {
        return null;
      }
      uint attributes = (uint)Marshal.ReadInt32(buffer, IntPtr.Size);
      if ((attributes & SE_GROUP_INTEGRITY) == 0) {
        return null;
      }
      return new SecurityIdentifier(pSid).Value;
    } catch {
      return null;
    } finally {
      Marshal.FreeHGlobal(buffer);
    }
  }

  public static bool EvaluateKernelElevation(bool isAdminMember, string integritySid) {
    if (!isAdminMember) return false;
    if (string.IsNullOrWhiteSpace(integritySid)) return false;
    string normalized = integritySid.Trim().ToUpperInvariant();
    return normalized == "S-1-16-12288" || normalized == "S-1-16-16384";
  }
}
"@
}

$realProdPrefix = [IO.Path]::GetFullPath('C:\HoaiPhuong-Server').TrimEnd('\', '/')
$normServerRoot = [IO.Path]::GetFullPath($ServerRoot).TrimEnd('\', '/')
$targetsProduction = (-not $SandboxMode) -or $normServerRoot.Equals($realProdPrefix, [StringComparison]::OrdinalIgnoreCase) -or $normServerRoot.StartsWith("$realProdPrefix\", [StringComparison]::OrdinalIgnoreCase)

if ($SandboxMode -and ($normServerRoot.Equals($realProdPrefix, [StringComparison]::OrdinalIgnoreCase) -or $normServerRoot.StartsWith("$realProdPrefix\", [StringComparison]::OrdinalIgnoreCase))) {
  throw "SANDBOX_VIOLATION_PRODUCTION_PATH_FORBIDDEN: SandboxMode cannot target Production ServerRoot '$ServerRoot'."
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isElevatedAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$integritySid = [ManagementLiteWebCutoverTokenSecurity]::GetTokenIntegritySid($identity.Token)
$hasHighIntegrity = [ManagementLiteWebCutoverTokenSecurity]::EvaluateKernelElevation($isElevatedAdmin, $integritySid)

if ($targetsProduction -and (-not $DryRun) -and (-not $hasHighIntegrity)) {
  throw 'SECURITY_VIOLATION_NON_ELEVATED_TOKEN: Switch-ProductionWebServerToServeWeb.ps1 requires an OS Kernel High-Integrity Elevated Administrator token (Run as Administrator).'
}

$canonicalServeWeb = Join-Path $normServerRoot 'apps\management-lite\scripts\runtime\serve-web.cjs'
$canonicalWebRoot = Join-Path $normServerRoot 'apps\management-lite\apps\web\dist'
$legacyEntryScript = Join-Path $normServerRoot 'scripts\serve-management-web.cjs'

if (-not (Test-Path -LiteralPath $canonicalServeWeb -PathType Leaf)) {
  throw "MISSING_CANONICAL_SERVE_WEB: Expected '$canonicalServeWeb' to exist. Deploy v0.5.4+ first."
}
if (-not (Test-Path -LiteralPath (Join-Path $canonicalWebRoot 'index.html') -PathType Leaf)) {
  throw "MISSING_WEB_DIST: Expected '$(Join-Path $canonicalWebRoot 'index.html')' to exist."
}

$escapedServeWeb = $canonicalServeWeb.Replace('\', '/')
$escapedWebRoot = $canonicalWebRoot.Replace('\', '/')

$delegatorContent = @"
#!/usr/bin/env node
'use strict';
/**
 * Managed Owner-Locked Delegator for HPManagementLiteWeb.
 * Delegates static serving (immutable /assets/* cache, Brotli/Gzip, ETag, CSP) and /api/* keep-alive proxy
 * to the repository-tracked scripts/runtime/serve-web.cjs inside apps/management-lite.
 */
process.env.WEB_ROOT = process.env.WEB_ROOT || '$escapedWebRoot';
const host = process.env.WEB_HOST || '127.0.0.1';
const port = Number(process.env.WEB_PORT || 3001);
const { createWebServer } = require('$escapedServeWeb');
createWebServer().listen(port, host, () => {
  console.log('HPManagementLiteWeb serving via canonical serve-web.cjs on http://' + host + ':' + port);
});
"@

if ($DryRun) {
  Write-Host "[DRY-RUN] Canonical serve-web.cjs verified at: $canonicalServeWeb" -ForegroundColor Cyan
  Write-Host "[DRY-RUN] Target wrapper path: $legacyEntryScript" -ForegroundColor Cyan
  Write-Host "[DRY-RUN] Zero files modified and zero services restarted." -ForegroundColor Green
  exit 0
}

$backupDir = Join-Path $normServerRoot 'backups\web-server-script'
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $legacyEntryScript) -Force | Out-Null

$hadPriorScript = Test-Path -LiteralPath $legacyEntryScript -PathType Leaf
$priorBytes = if ($hadPriorScript) { [IO.File]::ReadAllBytes($legacyEntryScript) } else { $null }
$ts = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')

if ($hadPriorScript) {
  $backupPath = Join-Path $backupDir "serve-management-web.$ts.cjs.bak"
  [IO.File]::WriteAllBytes($backupPath, $priorBytes)
  $backupSha = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
  @{
    backedUpAtUtc = $ts
    sourcePath    = $legacyEntryScript
    sha256        = $backupSha
  } | ConvertTo-Json | Set-Content -LiteralPath "$backupPath.sha256.json" -Encoding UTF8 -Force
  Write-Host "[BACKUP] Saved previous serve-management-web.cjs ($backupSha) -> $backupPath" -ForegroundColor Cyan
}

$nodeExe = Join-Path $realProdPrefix 'config\runtime\node-v22.14.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { $nodeExe = 'node' }

try {
  $tmpPath = "$legacyEntryScript.stage-$PID"
  [IO.File]::WriteAllText($tmpPath, $delegatorContent, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tmpPath -Destination $legacyEntryScript -Force

  if (-not $SkipServiceRestart -and (-not $SandboxMode)) {
    Write-Host "[SERVICE] Restarting Windows service '$WebServiceName'..." -ForegroundColor Cyan
    Restart-Service -Name $WebServiceName -Force
    Start-Sleep -Seconds 2
  }

  if ($SimulateVerificationFailure) {
    throw 'SIMULATED_WEB_HEADER_VERIFICATION_FAILURE'
  }

  if (-not $SkipServiceRestart) {
    $probeJs = @'
const http = require('node:http');
const base = process.argv[1];
function get(pathname) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathname, base);
    const req = http.request(u, { headers: { 'Accept-Encoding': 'br, gzip' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('probe timeout')));
    req.end();
  });
}
(async () => {
  let rootRes = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      const r = await get('/');
      if (r.status === 200 && r.headers['etag'] && r.headers['content-security-policy']) {
        rootRes = r;
        break;
      }
      lastErr = new Error('Root returned status=' + r.status + ' etag=' + Boolean(r.headers['etag']) + ' csp=' + Boolean(r.headers['content-security-policy']));
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!rootRes) throw lastErr || new Error('Root verification timed out');
  const zlib = require('node:zlib');
  const html = rootRes.headers['content-encoding'] === 'br'
    ? zlib.brotliDecompressSync(rootRes.body).toString('utf8')
    : rootRes.body.toString('utf8');
  const m = html.match(/\/assets\/[^"']+\.js/);
  if (!m) throw new Error('Could not locate hashed JS asset in index.html');
  const assetRes = await get(m[0]);
  if (assetRes.status !== 200) throw new Error('Asset returned status ' + assetRes.status);
  const cc = String(assetRes.headers['cache-control'] || '');
  if (!cc.includes('immutable') || !cc.includes('max-age=31536000')) {
    throw new Error('Asset Cache-Control is not immutable: ' + cc);
  }
  console.log('VERIFIED_OK:' + m[0] + '|cc=' + cc + '|enc=' + (assetRes.headers['content-encoding'] || 'none'));
})().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
'@
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $probeOut = (& $nodeExe -e $probeJs $WebBaseUrl 2>&1 | ForEach-Object { "$_" }) -join "`n"
      $probeExit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $prevEap
    }
    if ($probeExit -ne 0 -or $probeOut -notmatch 'VERIFIED_OK:') {
      throw "Post-cutover HTTP verification failed: $probeOut"
    }
    Write-Host "[VERIFIED] $probeOut" -ForegroundColor Green
  }
} catch {
  $errMsg = $_.Exception.Message
  Write-Host "[ROLLBACK] Cutover failed ($errMsg). Restoring previous serve-management-web.cjs..." -ForegroundColor Yellow
  if ($hadPriorScript -and $null -ne $priorBytes) {
    [IO.File]::WriteAllBytes($legacyEntryScript, $priorBytes)
  } elseif (Test-Path -LiteralPath $legacyEntryScript -PathType Leaf) {
    Remove-Item -LiteralPath $legacyEntryScript -Force -ErrorAction SilentlyContinue
  }
  if (-not $SkipServiceRestart -and (-not $SandboxMode)) {
    Restart-Service -Name $WebServiceName -Force -ErrorAction SilentlyContinue
  }
  throw "WEB_SERVER_CUTOVER_ROLLED_BACK: $errMsg"
}
