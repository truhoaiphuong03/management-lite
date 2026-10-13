[CmdletBinding()]
param([Parameter(Mandatory)][string]$Archive,[Parameter(Mandatory)][string]$ApprovedRoot,[Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference='Stop'
$base=[IO.Path]::GetFullPath($ApprovedRoot).TrimEnd('\')
$target=[IO.Path]::GetFullPath($Destination)
if(-not $target.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'EXTRACTION_ROOT_ESCAPE'}
if(Test-Path -LiteralPath $target){throw 'EXTRACTION_TARGET_EXISTS'}
$ancestor=Split-Path $target -Parent
while($ancestor){if((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'REPARSE_EXTRACTION_ROOT'};$parent=Split-Path $ancestor -Parent;if($parent -eq $ancestor){break};$ancestor=$parent}
$zip=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive).Path)
try{
 if($zip.Entries.Count -gt 30000){throw 'ZIP_TOO_MANY_ENTRIES'}
 $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
 $total=[long]0
 foreach($entry in $zip.Entries){
  $name=$entry.FullName.TrimEnd('/')
  if(-not $name -or $name.Contains('\') -or $name.Contains(':') -or $name.StartsWith('/') -or $name.Contains([char]0)){throw 'ZIP_UNSAFE_PATH'}
  if(-not $names.Add($name)){throw 'ZIP_DUPLICATE_PATH'}
  foreach($part in $name.Split('/')){
   if(-not $part -or $part -in @('.','..') -or $part -match '[. ]$|[<>"|?*\x00-\x1f]' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)'){throw 'ZIP_UNSAFE_PATH'}
   if($part -match '^\.env(?:\.|$)|^(secrets?|uploads?|backups?|logs?|\.git)$|\.(dump|sql|pem|key|pfx|p12|wfw)$|^runtime-private\.json$'){throw 'ZIP_FORBIDDEN_PAYLOAD'}
  }
  $kind=([uint32]$entry.ExternalAttributes -shr 16) -band 0xF000
  if($kind -eq 0xA000 -or ($entry.ExternalAttributes -band 0x400)){throw 'ZIP_LINK_ENTRY'}
  $total+=$entry.Length
  if($entry.Length -gt 256MB -or $total -gt 1GB -or ($entry.Length -gt 1MB -and $entry.Length/[Math]::Max(1,$entry.CompressedLength) -gt 300)){throw 'ZIP_QUOTA_EXCEEDED'}
 }
 # Validate file/directory collisions before writing anything.
 $fileNames=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
 foreach($entry in $zip.Entries){if(-not $entry.FullName.EndsWith('/')){[void]$fileNames.Add($entry.FullName)}}
 foreach($entry in $zip.Entries){$parts=$entry.FullName.TrimEnd('/').Split('/');for($i=1;$i -lt $parts.Count;$i++){if($fileNames.Contains(($parts[0..($i-1)] -join '/'))){throw 'ZIP_FILE_DIRECTORY_COLLISION'}}}
 if((Get-PSDrive -Name ([IO.Path]::GetPathRoot($target).Substring(0,1))).Free -lt $total*2+256MB){throw 'EXTRACTION_DISK_RESERVE'}
 New-Item -ItemType Directory -Path $target | Out-Null
 foreach($entry in $zip.Entries){
  $dest=Join-Path $target $entry.FullName
  if($entry.FullName.EndsWith('/')){New-Item -ItemType Directory -Path $dest -Force|Out-Null;continue}
  New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force|Out-Null
  $input=$entry.Open();$output=[IO.File]::Open($dest,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$input.CopyTo($output);$output.Flush($true)}finally{$output.Dispose();$input.Dispose()}
 }
 [pscustomobject]@{Status='EXTRACTED';Entries=$zip.Entries.Count;Bytes=$total;Destination=$target}|ConvertTo-Json -Compress
}finally{$zip.Dispose()}
