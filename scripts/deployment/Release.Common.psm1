# Compatible with Windows PowerShell 5.1 and PowerShell 7+. No migrations, npm, git checkout, or database restore in this controller.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

function Read-DeployConfig([string]$Path, [switch]$Simulation) {
    $c = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ($c.Enabled -ne $true) { throw 'Deployment is disabled locally.' }
    if ($Simulation -and ($c.Environment -ne 'staging' -or !$c.AllowSimulation)) { throw 'Simulation requires isolated staging.' }
    $isWinHost = ($PSVersionTable.PSVersion.Major -le 5) -or ([bool](Get-Variable -Name IsWindows -ValueOnly -ErrorAction SilentlyContinue))
    if (!$Simulation -and !$isWinHost) { throw 'Real deployment requires Windows.' }
    if ($c.Environment -notin @('staging','production')) { throw 'Invalid environment.' }
    if (!(Test-Path -LiteralPath (Join-Path $c.Root '.management-lite-managed-root'))) { throw 'Managed-root marker missing.' }
    if ((Get-Item -LiteralPath $c.Root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Root must not be a link.' }
    foreach ($child in @('releases','backups')) {
        $p=Join-Path $c.Root $child
        if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Managed directories must not be links.' }
    }
    return $c
}

function Enter-DeployLock($Config) {
    # Exclusive OS file handle survives competing workflow jobs; crash releases handle.
    return [IO.File]::Open((Join-Path $Config.Root 'deployment.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
}

function Write-DeployEvent($Config, [string]$Status, [string]$Sha) {
    $line = @{ timestamp = [DateTime]::UtcNow.ToString('o'); status = $Status; sha = $Sha; workflowRun=$env:GITHUB_RUN_ID } | ConvertTo-Json -Compress
    try { Add-Content -LiteralPath (Join-Path $Config.Root 'deployment-history.jsonl') -Value $line }
    catch { Write-Warning ('Local history write failed; workflow log fallback: '+$line) }
}

function Get-CurrentRelease($Config, [switch]$Simulation) {
    $p = Join-Path $Config.Root 'current'
    if ($Simulation) { return (Get-Content -LiteralPath (Join-Path $Config.Root 'simulation-current.txt') -Raw).Trim() }
    $item = Get-Item -LiteralPath $p
    if (!($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Current must be a managed junction.' }
    return [IO.Path]::GetFullPath([string]$item.Target)
}

function Set-CurrentRelease($Config, [string]$Target, [switch]$Simulation) {
    $parent = [IO.Path]::GetFullPath((Join-Path $Config.Root 'releases')) + [IO.Path]::DirectorySeparatorChar
    $full = [IO.Path]::GetFullPath($Target)
    if (!$full.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $full)) { throw 'Target outside releases.' }
    if ($Simulation) { [IO.File]::WriteAllText((Join-Path $Config.Root 'simulation-current.txt'), $full); return }
    $current = Join-Path $Config.Root 'current'
    if (Test-Path -LiteralPath $current) {
        $old = Get-Item -LiteralPath $current
        if (!($old.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing to replace ordinary directory.' }
        # Delete the junction only; never recurse into its target.
        [IO.Directory]::Delete($current)
    }
    New-Item -ItemType Junction -Path $current -Target $full | Out-Null
}

function Set-AppService($Config, [ValidateSet('Stop','Start')]$Action, [switch]$Simulation) {
    if ($Simulation) { return }
    $s = Get-Service -Name $Config.ApiService -ErrorAction Stop
    if ($Action -eq 'Stop') { Stop-Service -Name $s.Name; $s.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) }
    else { Start-Service -Name $s.Name; $s.WaitForStatus('Running', [TimeSpan]::FromSeconds(30)) }
}

function Invoke-Pg($Config, [string]$Tool, [string[]]$Arguments) {
    $names = @('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSFILE','PGOPTIONS','PGPASSWORD','PGSERVICE','PGSERVICEFILE')
    $saved = @{}
    foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name); [Environment]::SetEnvironmentVariable($name, $null) }
    try {
        $env:PGHOST = $Config.Database.Host; $env:PGPORT = [string]$Config.Database.Port
        $env:PGDATABASE = $Config.Database.Name; $env:PGUSER = $Config.Database.BackupUser
        $env:PGPASSFILE = $Config.Database.PassFile; $env:PGOPTIONS = '-c default_transaction_read_only=on'
        $output = & (Join-Path $Config.PgBin $Tool) @Arguments 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL read-only operation failed; inspect private server diagnostics.' }
        return $output
    } finally { foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) } }
}

function Assert-ReleaseSchema($Config, $Manifest, [switch]$Simulation) {
    if ($Simulation) {
        if ($Config.SimulationSchema -ne $Manifest.schemaIdentity) { throw 'Schema mismatch; migration is manual only.' }
        if (($Config.PSObject.Properties.Name -contains 'SimulationAuthPolicy') -and -not [string]::IsNullOrWhiteSpace([string]$Config.SimulationAuthPolicy)) {
            $manifestPolicy = if ($Manifest.PSObject.Properties.Name -contains 'authPolicyVersion') { [string]$Manifest.authPolicyVersion } else { '' }
            if ($manifestPolicy -cne [string]$Config.SimulationAuthPolicy) {
                throw "ROLLBACK_BLOCKED_INCOMPATIBLE_SCHEMA_OR_AUTH_POLICY: Release authPolicyVersion '$manifestPolicy' is incompatible with active policy '$($Config.SimulationAuthPolicy)'."
            }
        }
        return
    }
    $identity = Invoke-Pg $Config 'psql.exe' @('-X','-w','-At','-c', "SELECT json_build_object('database',current_database(),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()))") | ConvertFrom-Json
    if ($identity.database -cne $Config.Database.Name -or $identity.systemIdentifier -cne $Config.Database.ExpectedSystemIdentifier) { throw 'Database binding mismatch; no backup or deployment allowed.' }
    $raw = Invoke-Pg $Config 'psql.exe' @('-X','-w','-At','-c', "SELECT COALESCE(json_agg(m ORDER BY id),'[]'::json) FROM (SELECT id,checksum FROM schema_migrations) m")
    $rows = @($raw | ConvertFrom-Json)
    $expected = @($Manifest.migrations)
    if ($rows.Count -ne $expected.Count) { throw 'Schema mismatch; migration is manual only.' }
    for ($i=0; $i -lt $rows.Count; $i++) {
        if ($rows[$i].id -cne $expected[$i].id -or $rows[$i].checksum -cne $expected[$i].checksum) { throw 'Schema checksum mismatch.' }
    }
}

function New-ReleaseBackup($Config, [string]$Sha, [switch]$Simulation) {
    $dest = Join-Path $Config.Root ('backups/' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '-' + $Sha)
    New-Item -ItemType Directory -Path $dest | Out-Null
    if ($Simulation) { Set-Content -LiteralPath (Join-Path $dest 'SIMULATION-ONLY.txt') -Value 'No real database backup.'; return $dest }
    # Protected key/config backup is produced by the administrator's separate encrypted backup job.
    $protected = Get-Item -LiteralPath $Config.ProtectedConfigBackup
    if ($protected.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddHours(-24)) { throw 'Protected config/key backup is stale.' }
    Invoke-Pg $Config 'pg_dump.exe' @('-w','-Fc','--file', (Join-Path $dest 'database.dump')) | Out-Null
    Invoke-Pg $Config 'pg_restore.exe' @('--list', (Join-Path $dest 'database.dump')) | Out-Null
    foreach ($path in $Config.DataPaths) {
        Copy-Item -LiteralPath $path -Destination (Join-Path $dest ([IO.Path]::GetFileName($path))) -Recurse
    }
    # Keys/config remain external and are never modified or printed.
    return $dest
}

function Test-ReleaseHealth($Config, [string]$Sha, [switch]$Simulation) {
    if ($Simulation) {
        if ($Config.SimulationFailSha -eq $Sha) { throw 'Synthetic candidate health failure.' }
        return
    }
    $base = $Config.ApiHealthBase.TrimEnd('/')
    $ready = $false
    for ($i=0; $i -lt 12; $i++) {
        try {
            $h = Invoke-RestMethod -Uri ($base + '/api/v1/health') -TimeoutSec 5
            $r = Invoke-RestMethod -Uri ($base + '/api/v1/ready') -TimeoutSec 5
            if ($h.success -and $h.data.status -eq 'pass' -and $r.success -and $r.data.status -eq 'ready') { $ready=$true; break }
        } catch { }
        Start-Sleep -Seconds 2
    }
    if (!$ready) { throw 'Liveness/readiness failed.' }
    $web = Invoke-WebRequest -Uri ($Config.WebHealthBase.TrimEnd('/') + '/login') -TimeoutSec 10
    if ($web.StatusCode -ne 200 -or $web.Content -notmatch '<html') { throw 'Web health failed.' }
    $version = Invoke-RestMethod -Uri ($Config.WebHealthBase.TrimEnd('/') + '/release-version.json') -TimeoutSec 10
    if ($version.sha -cne $Sha) { throw 'Served web release SHA mismatch.' }
    # Administrator-installed, reviewed read-only smoke adapter, outside artifact/release tree.
    & $Config.SmokeScript -ExpectedSha $Sha
    if (!$?) { throw 'Critical functional smoke failed.' }
}

function Expand-VerifiedRelease([string]$Archive, [string]$ExpectedDigest, [string]$Sha, $Config) {
    if ($Sha -cnotmatch '^[0-9a-f]{40}$') { throw 'Full immutable SHA required.' }
    if ($ExpectedDigest -cnotmatch '^[0-9a-f]{64}$' -or (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedDigest) { throw 'Archive checksum mismatch.' }
    $target = Join-Path $Config.Root ('releases/' + $Sha)
    if (Test-Path -LiteralPath $target) { throw 'Release exists; immutable releases cannot be overwritten.' }
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\','/')
            if ($name -match '(^/|:|(^|/)\.\.(/|$)|(^|/)\.env($|\.)|^(secrets|data)/|[. ]($|/))' -or !$names.Add($name)) { throw 'Unsafe/duplicate archive path.' }
            if (($entry.ExternalAttributes -shr 16 -band 0xF000) -eq 0xA000) { throw 'Archive symlinks rejected.' }
            if ($name -ne 'release.json' -and $name -ne 'package.json' -and $name -notmatch '^(dist|node_modules|web)/') { throw 'Unexpected release path.' }
        }
        [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $target)
    } finally { $zip.Dispose() }
    $m = Get-Content -LiteralPath (Join-Path $target 'release.json') -Raw | ConvertFrom-Json
    if ($m.sha -cne $Sha -or $m.platform -ne 'win32' -or $m.arch -ne 'x64' -or $m.node -ne '22.14.0') { throw 'Release identity/platform mismatch.' }
    $actual = @(Get-ChildItem -LiteralPath $target -File -Recurse | Where-Object { $_.Name -ne 'release.json' -or $_.DirectoryName -ne $target })
    if ($actual.Count -ne @($m.files).Count) { throw 'Release file inventory mismatch.' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $m.files) {
        $path = [IO.Path]::GetFullPath((Join-Path $target $file.path))
        if (!$path.StartsWith($target + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or !$seen.Add($path)) { throw 'Invalid manifest path.' }
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256) { throw 'Release file checksum mismatch.' }
    }
    foreach ($required in @('dist/apps/api/src/main.js','web/index.html','web/release-version.json','package.json')) {
        if (!(Test-Path -LiteralPath (Join-Path $target $required))) { throw 'Incomplete release.' }
    }
    return @{ Path=$target; Manifest=$m }
}

function Assert-LocalReleaseIntegrity([string]$Target) {
    $m=Get-Content -LiteralPath (Join-Path $Target 'release.json') -Raw | ConvertFrom-Json
    if ($m.sha -cnotmatch '^[0-9a-f]{40}$' -or (Split-Path $Target -Leaf) -cne $m.sha) { throw 'Previous release identity mismatch.' }
    foreach ($file in $m.files) {
        $path=[IO.Path]::GetFullPath((Join-Path $Target $file.path))
        if (!$path.StartsWith($Target+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256) { throw 'Previous release integrity failure.' }
    }
    return $m
}
Export-ModuleMember -Function *
