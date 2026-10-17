<#
.SYNOPSIS
  Local administrative script on Windows 1 (DESKTOP-8T8UHTS) to reset DEV Owner password
  on the isolated database (management_lite_integration_test) without depending on email delivery.
  - Never touches Production DB (management_lite_test).
  - Never prints passwords to console or logs.
#>
param(
  [switch]$GenerateRandom,
  [string]$DevPasswordFile = 'C:\HoaiPhuong-Server\config\test-secrets\dev-owner-password.txt'
)

$ErrorActionPreference = 'Stop'
$WorkspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$PgPassFile    = 'C:\HoaiPhuong-Server\config\test-secrets\pgpass.conf'
$NodeExe       = 'C:\HoaiPhuong-Server\config\runtime\node-v22.14.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $NodeExe)) {
  $NodeExe = 'node'
}

if (-not (Test-Path -LiteralPath $PgPassFile)) {
  throw "Missing DB configuration file: $PgPassFile"
}

$pgLine = (Get-Content -LiteralPath $PgPassFile | Where-Object { $_ -and $_ -notmatch '^#' } | Select-Object -First 1).Trim()
$parts = $pgLine -split ':', 5
$env:TEST_DATABASE_URL = "postgresql://$($parts[3]):$([uri]::EscapeDataString($parts[4]))@$($parts[0]):$($parts[1])/management_lite_integration_test"
$env:CONFIRM_ISOLATED_TEST_DB = 'true'
$env:NODE_ENV = 'development'

$plainPassword = $null
try {
  if ($GenerateRandom) {
    $bytes = New-Object byte[] 18
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $tokenPart = [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', '9').Replace('=', '')
    $plainPassword = "MgLiteDev!$($tokenPart)#2026"
  } else {
    $sec1 = Read-Host 'Enter new password for DEV Owner (hidden input, min 8 chars)' -AsSecureString
    $sec2 = Read-Host 'Confirm new password for DEV Owner' -AsSecureString
    $ptr1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec1)
    $ptr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec2)
    try {
      $p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr1)
      $p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr2)
      if ($p1 -ne $p2) {
        throw 'Password confirmation does not match.'
      }
      if ($p1.Length -lt 8) {
        throw 'Password must be at least 8 characters long.'
      }
      $plainPassword = $p1
    } finally {
      if ($ptr1 -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr1) }
      if ($ptr2 -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr2) }
      $sec1.Dispose()
      $sec2.Dispose()
    }
  }

  $parentDir = Split-Path -Parent $DevPasswordFile
  if (-not (Test-Path -LiteralPath $parentDir)) {
    New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
  }
  [IO.File]::WriteAllText($DevPasswordFile, $plainPassword, [Text.Encoding]::ASCII)

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $DevPasswordFile /inheritance:r /grant:r "$($identity):(F)" | Out-Null

  $stdinPayload = "y`n$plainPassword`n$plainPassword`n"
  $stdinPayload | & $NodeExe (Join-Path $WorkspaceRoot 'scripts\recover-owner-access.mjs')
  if ($LASTEXITCODE -ne 0) {
    throw "DEV Owner password recovery failed (ExitCode=$LASTEXITCODE)."
  }

  Write-Host "[DEV-OWNER-RECOVERY] Saved local DEV password (ACL restricted to $identity) at: $DevPasswordFile" -ForegroundColor Green
} finally {
  $plainPassword = $null
  Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:CONFIRM_ISOLATED_TEST_DB -ErrorAction SilentlyContinue
}
