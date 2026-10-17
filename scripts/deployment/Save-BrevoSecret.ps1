# Run interactively as the Windows identity that will launch the API.
# DPAPI CurrentUser ciphertext is only usable by that Windows identity.
param([Parameter(Mandatory=$true)][string]$SecretPath)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows only' }
$target = [IO.Path]::GetFullPath($SecretPath)
if ([IO.Path]::GetExtension($target) -ne '.dpapi') { throw 'Use a .dpapi path outside the repository' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\') + '\'
if ($target.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw 'Secrets must be outside the repository' }
if (Test-Path -LiteralPath $target) { throw 'Secret already exists; rotate deliberately using a new path' }
$parent = Split-Path -Parent $target
$newParent = -not (Test-Path -LiteralPath $parent)
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
if ($newParent) { Set-Acl -LiteralPath $parent -AclObject $acl }
$secret = Read-Host 'Brevo API key (hidden; do not paste it in chat)' -AsSecureString
try {
  if ($secret.Length -lt 20) { throw 'API key is missing or too short' }
  $encrypted = ConvertFrom-SecureString -SecureString $secret
  [IO.File]::WriteAllText($target, $encrypted, [Text.Encoding]::ASCII)
  $fileAcl = New-Object Security.AccessControl.FileSecurity
  $fileAcl.SetAccessRuleProtection($true, $false)
  $fileAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))
  Set-Acl -LiteralPath $target -AclObject $fileAcl
  Write-Host 'Encrypted key saved. No service was changed or restarted.'
} finally { $secret.Dispose() }
