#requires -Version 5.1
<#
.SYNOPSIS
  Test-ProdProvenance.ps1 - READ-ONLY release provenance check for Management Lite (Production).
.DESCRIPTION
  Detects out-of-gate changes to the production web/API by cross-checking:
    1. release-version.json (disk, dist, and as served over HTTP)
    2. deploy-history.log (last SUCCESS entry) + current-live-sha.txt + running-components-sha.json
    3. the asset files referenced by the served index.html (hash on disk vs hash served)
    4. dist files whose mtime is NEWER than the recorded releasedAt (writes after the last gated release)
    5. the Git HEAD of a reference repository (informational)
  The script NEVER writes to the production tree. It only reads files and issues HTTP GET to the given URL.
  Optional -OutFile writes the JSON report to a path you choose (must NOT be under ProdRoot / LogsRoot).
  Exit codes: 0 = consistent, 2 = drift detected, 3 = could not verify.
#>
[CmdletBinding()]
param(
    [string]$ProdRoot = 'C:\HoaiPhuong-Server\apps\management-lite',
    [string]$ServerRoot = 'C:\HoaiPhuong-Server',
    [string]$WebUrl = 'http://127.0.0.1:3001',
    [string]$RepoPath = '',
    [string]$OutFile = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-Json([string]$p) {
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    try { return (Get-Content -LiteralPath $p -Raw | ConvertFrom-Json) } catch { return $null }
}
function Sha256-Bytes([byte[]]$b) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($h.ComputeHash($b))).Replace('-', '').ToLowerInvariant() } finally { $h.Dispose() }
}

if ($OutFile) {
    $full = [IO.Path]::GetFullPath($OutFile)
    foreach ($forbidden in @($ProdRoot, $ServerRoot)) {
        if ($full.StartsWith([IO.Path]::GetFullPath($forbidden), [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to write report under production path: $full"
        }
    }
}

$findings = New-Object System.Collections.Generic.List[string]
$report = [ordered]@{ checked_at_utc = (Get-Date).ToUniversalTime().ToString('o') }

# 1. release-version.json (disk locations + served)
$rvRoot = Read-Json (Join-Path $ProdRoot 'release-version.json')
$rvDisk = Read-Json (Join-Path $ProdRoot 'dist\release-version.json')   # authoritative for the API (apps/api/src/release-info.ts)
$rvDist = Read-Json (Join-Path $ProdRoot 'apps\web\dist\release-version.json')   # authoritative for the web
$rvServed = $null
$webOk = $true
try {
    $r = Invoke-WebRequest -Uri ($WebUrl.TrimEnd('/') + '/release-version.json') -UseBasicParsing -TimeoutSec 10
    $rvServed = $r.Content | ConvertFrom-Json
} catch { $webOk = $false; $findings.Add('WARN: cannot GET release-version.json from ' + $WebUrl) }
function Prop($o, [string]$n) { if ($null -eq $o) { return $null } $p = $o.PSObject.Properties[$n]; if ($p) { return $p.Value } return $null }
function Brief($o) { if ($null -eq $o) { return $null } return [ordered]@{ version = (Prop $o 'version'); sha = (Prop $o 'sha'); releasedAt = (Prop $o 'releasedAt'); releasedBy = (Prop $o 'releasedBy') } }
$report.release_version = [ordered]@{ api_dist = (Brief $rvDisk); web_dist = (Brief $rvDist); served = (Brief $rvServed); legacy_root_file = (Brief $rvRoot) }
$recordedSha = if ($rvDisk) { ($rvDisk.sha + '').ToLowerInvariant() } else { '' }
if ($rvServed -and $rvDisk -and $rvServed.sha -ne $rvDisk.sha) { $findings.Add('DRIFT: served release-version sha differs from API dist/release-version.json') }
if ($rvDist -and $rvDisk -and $rvDist.sha -ne $rvDisk.sha) { $findings.Add('DRIFT: web dist release-version sha differs from API dist/release-version.json') }
if ($rvRoot -and $rvDisk -and $rvRoot.sha -ne $rvDisk.sha) { $findings.Add('INFO: legacy root release-version.json is stale (not used by API/web)') }

# 2. gate records
$hist = Join-Path $ServerRoot 'logs\deploy-history.log'
$lastGate = $null
if (Test-Path -LiteralPath $hist) {
    foreach ($line in (Get-Content -LiteralPath $hist -Tail 40)) {
        try { $j = $line | ConvertFrom-Json; if ($j.status -eq 'SUCCESS') { $lastGate = $j } } catch { }
    }
}
$liveSha = $null
$liveFile = Join-Path $ServerRoot 'reports\current-live-sha.txt'
if (Test-Path -LiteralPath $liveFile) { $liveSha = (Get-Content -LiteralPath $liveFile -Raw).Trim().ToLowerInvariant() }
$running = Read-Json (Join-Path $ServerRoot 'reports\running-components-sha.json')
$report.gate = [ordered]@{
    last_success_sha = if ($lastGate) { $lastGate.sha } else { $null }
    last_success_version = if ($lastGate) { $lastGate.version } else { $null }
    last_success_time = if ($lastGate) { $lastGate.timestamp } else { $null }
    current_live_sha = $liveSha
    running_api_sha = if ($running) { $running.api_sha } else { $null }
    running_web_sha = if ($running) { $running.web_sha } else { $null }
}
if ($lastGate -and $recordedSha -and (($lastGate.sha + '').ToLowerInvariant() -ne $recordedSha)) { $findings.Add('DRIFT: release-version sha is not the last SUCCESS in deploy-history.log') }
if ($liveSha -and $recordedSha -and $liveSha -ne $recordedSha) { $findings.Add('DRIFT: current-live-sha.txt differs from release-version sha') }

# 3. served index.html assets: disk hash vs served hash
$assetReport = @()
try {
    $idx = Invoke-WebRequest -Uri ($WebUrl.TrimEnd('/') + '/') -UseBasicParsing -TimeoutSec 10
    $assets = [regex]::Matches($idx.Content, '/assets/[^"''\s<>]+') | ForEach-Object { $_.Value } | Sort-Object -Unique
    foreach ($a in $assets) {
        $disk = Join-Path $ProdRoot ('apps\web\dist' + ($a -replace '/', '\'))
        $served = Invoke-WebRequest -Uri ($WebUrl.TrimEnd('/') + $a) -UseBasicParsing -TimeoutSec 20
        $sh = Sha256-Bytes ($served.RawContentStream.ToArray())
        $dh = $null; $mt = $null
        if (Test-Path -LiteralPath $disk) { $dh = (Get-FileHash -LiteralPath $disk -Algorithm SHA256).Hash.ToLowerInvariant(); $mt = (Get-Item -LiteralPath $disk).LastWriteTime.ToString('s') }
        $assetReport += [ordered]@{ asset = $a; served_sha256_12 = $sh.Substring(0, 12); disk_sha256_12 = if ($dh) { $dh.Substring(0, 12) } else { $null }; disk_mtime = $mt }
        if ($dh -and $dh -ne $sh) { $findings.Add("DRIFT: served $a differs from disk file") }
    }
} catch { $webOk = $false; $findings.Add('WARN: cannot fetch index.html/assets from ' + $WebUrl) }
$report.served_assets = $assetReport

# 4. writes after the recorded release time
$newer = @()
if ($rvDisk -and $rvDisk.releasedAt) {
    $rel = [DateTime]::Parse($rvDisk.releasedAt).ToLocalTime()
    $distDir = Join-Path $ProdRoot 'apps\web\dist'
    if (Test-Path -LiteralPath $distDir) {
        $newer = @(Get-ChildItem -LiteralPath $distDir -Recurse -File | Where-Object { $_.LastWriteTime -gt $rel } | Sort-Object LastWriteTime)
    }
    $bundles = @($newer | Where-Object { $_.Name -like 'index-*.js' })
    $report.dist_files_newer_than_release = [ordered]@{ released_at_local = $rel.ToString('s'); count = $newer.Count; newest = if ($newer.Count) { $newer[-1].LastWriteTime.ToString('s') } else { $null }; distinct_main_bundles_written_after_release = $bundles.Count; bundle_write_times = @($bundles | ForEach-Object { $_.LastWriteTime.ToString('HH:mm:ss') }) }
    if ($newer.Count -gt 0) { $findings.Add("DRIFT: $($newer.Count) dist file(s) ($($bundles.Count) main bundle(s)) modified after the recorded release time (out-of-gate writes)") }
}

# 5. reference repo (informational)
if ($RepoPath -and (Test-Path -LiteralPath $RepoPath)) {
    $head = (& git --no-optional-locks -C $RepoPath rev-parse HEAD 2>$null)
    $report.repo_head = $head
    if ($head -and $recordedSha -and $head -ne $recordedSha) {
        $ahead = (& git --no-optional-locks -C $RepoPath rev-list --count "$recordedSha..HEAD" 2>$null)
        $report.repo_commits_ahead_of_release = $ahead
        if ($ahead -and [int]$ahead -gt 0) { $findings.Add("INFO: repository HEAD is $ahead commit(s) ahead of the recorded release") }
    }
}

$drift = @($findings | Where-Object { $_ -like 'DRIFT*' }).Count
$report.findings = @($findings)
$report.verdict = if (-not $webOk -and $drift -eq 0) { 'UNVERIFIED' } elseif ($drift -gt 0) { 'DRIFT' } else { 'CONSISTENT' }
$json = $report | ConvertTo-Json -Depth 6
if ($OutFile) { [IO.File]::WriteAllText($full, $json, (New-Object Text.UTF8Encoding($false))) }
$json
if ($report.verdict -eq 'DRIFT') { exit 2 } elseif ($report.verdict -eq 'UNVERIFIED') { exit 3 } else { exit 0 }

