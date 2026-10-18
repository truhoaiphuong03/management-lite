# Explicit process-only injection. Does not modify a service or persist plaintext.
param(
  [Parameter(Mandatory=$true)][string]$SecretPath,
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$EntryPoint
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows only' }
if ($env:BREVO_API_KEY) { throw 'BREVO_API_KEY is already set; remove it before using DPAPI' }
$secret = Get-Content -LiteralPath $SecretPath -Raw | ConvertTo-SecureString
$ptr = [IntPtr]::Zero
try {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  $env:BREVO_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  & $NodePath $EntryPoint
  $result = $LASTEXITCODE
} finally {
  Remove-Item Env:BREVO_API_KEY -ErrorAction SilentlyContinue
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $secret.Dispose()
}
exit $result
