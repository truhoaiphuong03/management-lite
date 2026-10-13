$ErrorActionPreference='Stop'
$base=Join-Path ([IO.Path]::GetTempPath()) ('management-lite-extractor-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $base | Out-Null
$scriptPath=Join-Path $PSScriptRoot 'Expand-ReleaseSafely.ps1'
$cases=@(
 @{Name='traversal';Entries=@('../escape.txt')},
 @{Name='ads';Entries=@('payload/web/file:secret')},
 @{Name='secret';Entries=@('payload/.env')},
 @{Name='duplicate';Entries=@('payload/A.txt','payload/a.txt')},
 @{Name='collision';Entries=@('payload/parent','payload/parent/child')},
 @{Name='device';Entries=@('payload/CON.txt')}
)
$results=@()
foreach($case in $cases){
 $archive=Join-Path $base ($case.Name+'.zip')
 $stream=[IO.File]::Open($archive,[IO.FileMode]::CreateNew)
 $zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
 try{foreach($entry in $case.Entries){$item=$zip.CreateEntry($entry);$writer=[IO.StreamWriter]::new($item.Open());try{$writer.Write('synthetic')}finally{$writer.Dispose()}}}finally{$zip.Dispose();$stream.Dispose()}
 $dest=Join-Path $base ('extract-'+$case.Name);$reason='NOT_REJECTED'
 try{& $scriptPath -Archive $archive -ApprovedRoot $base -Destination $dest | Out-Null}catch{$reason=$_.Exception.Message}
 $results+=[pscustomobject]@{Case=$case.Name;Passed=($reason -match '^ZIP_' -and -not (Test-Path $dest));Reason=$reason}
}
$results|ConvertTo-Json
if(@($results|Where-Object {-not $_.Passed}).Count){exit 1}
