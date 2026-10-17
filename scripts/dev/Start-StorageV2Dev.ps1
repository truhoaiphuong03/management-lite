<#
.SYNOPSIS
  Khởi chạy môi trường DEV cô lập cho STORAGE V2 trên Windows 1 (DESKTOP-8T8UHTS)
  - DEV Web UI (Vite Proxy): http://localhost:3101/storage
  - DEV API Server:          http://127.0.0.1:3102
  - Isolated DEV DB:         management_lite_integration_test (port 55432)
  - Không đụng Production (3001/3002), V3 (3000) hay Cloudflared.
#>
param(
  [switch]$EnableLan,
  [switch]$EnableBrevo
)

$ErrorActionPreference = 'Stop'
$WorkspaceRoot   = 'C:\HoaiPhuong-Server\workspace\management-lite-uiux-integration-test'
$OAuthEnvFile    = 'C:\HoaiPhuong-Server\config\test-secrets\google-drive-oauth.env'
$PgPassFile      = 'C:\HoaiPhuong-Server\config\test-secrets\pgpass.conf'
$BrevoSecretFile = 'C:\HoaiPhuong-Server\config\brevo-dev-secrets\api-key.dpapi'

if (Test-Path $OAuthEnvFile) {
  Get-Content $OAuthEnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and $line -notmatch '^#' -and $line.Contains('=')) {
      $kv = $line -split '=', 2
      [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim(), 'Process')
    }
  }
}

$pgLine = (Get-Content $PgPassFile | Where-Object { $_ -and $_ -notmatch '^#' } | Select-Object -First 1).Trim()
$parts = $pgLine -split ':', 5
$env:DATABASE_URL = "postgresql://$($parts[3]):$([uri]::EscapeDataString($parts[4]))@$($parts[0]):$($parts[1])/management_lite_integration_test"
$env:PORT = '3102'
$env:HOST = '127.0.0.1'
$env:NODE_ENV = 'development'
$env:VITE_PORT = '3101'
$env:VITE_API_TARGET = 'http://127.0.0.1:3102'
$env:PASSWORD_RESET_ORIGIN = 'http://localhost:3101'
if ($EnableLan) {
  $env:VITE_HOST_LAN = 'true'
}

if ($EnableBrevo -and (Test-Path -LiteralPath $BrevoSecretFile)) {
  $secret = Get-Content -LiteralPath $BrevoSecretFile -Raw | ConvertTo-SecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  try {
    $env:BREVO_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $secret.Dispose()
  }
}

Write-Host "[STORAGE-V2-DEV] GOOGLE_DRIVE_LIVE_ENABLED = $($env:GOOGLE_DRIVE_LIVE_ENABLED)" -ForegroundColor Cyan
Write-Host "[STORAGE-V2-DEV] GOOGLE_REDIRECT_URI       = $($env:GOOGLE_REDIRECT_URI)" -ForegroundColor Cyan
Write-Host "[STORAGE-V2-DEV] BREVO_CONFIGURED          = $([bool]$env:BREVO_API_KEY)" -ForegroundColor Cyan
Write-Host "[STORAGE-V2-DEV] DEV Web URL               = http://localhost:3101/storage" -ForegroundColor Green
Write-Host "[STORAGE-V2-DEV] DEV API URL               = http://127.0.0.1:3102" -ForegroundColor Green
