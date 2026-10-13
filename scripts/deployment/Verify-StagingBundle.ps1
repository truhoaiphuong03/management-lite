param(
  [Parameter(Mandatory = $true)][string]$BundleDirectory,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $BundleDirectory).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked root rejected' }
$manifest = Get-Content -LiteralPath (Join-Path $root 'staging-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.sha -cne $ExpectedCommit -or $manifest.repository -ne 'truhoaiphuong03/management-lite' -or $manifest.productionApproved -ne $false -or $manifest.target.platform -ne 'win32' -or $manifest.target.arch -ne 'x64') { throw 'Staging provenance mismatch' }
$all = @(Get-ChildItem -LiteralPath $root -Recurse -Force)
if (@($all | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Linked content rejected' }
$seen = @{}
foreach ($entry in $manifest.files) {
  $relative = [string]$entry.path
  if ($relative -match '(^/|\\|:|(^|/)\.\.(/|$)|(^|/)\.env)' -or $relative -eq 'staging-manifest.json' -or $seen.ContainsKey($relative) -or $entry.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid manifest path or digest' }
  $seen[$relative] = $true
  $file = [IO.Path]::GetFullPath((Join-Path $root $relative))
  if (!$file.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Missing or escaped payload' }
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) { throw 'Payload checksum mismatch' }
}
if (@($all | Where-Object { !$_.PSIsContainer }).Count -ne $seen.Count + 1) { throw 'Unexpected payload files' }
Write-Output "PASS staging provenance and $($seen.Count) payload checksums; Windows runtime remains separate"
