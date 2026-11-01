#requires -Version 5.1
<#
.SYNOPSIS
  Manage-TestEnv.ps1 - creates and operates the ISOLATED TEST environment (C:\ML-Test, PostgreSQL on 127.0.0.1:55433).
.DESCRIPTION
  Actions: Create | Start | Stop | Status | RunTests | Remove
  Isolation guarantees (asserted by the script, fail-closed):
    * everything lives under C:\ML-Test (never under C:\HoaiPhuong-Server);
    * PostgreSQL listens on 127.0.0.1:55433 only (never 55432), brand-new cluster => different system_identifier than Production;
    * binaries are COPIED from the Production runtime directories (read-only source) so that nothing runs from Production paths;
    * no Production account, key, password or dump is used; roles/passwords are random and stored only in C:\ML-Test\secrets;
    * test processes get their connection settings through process-scoped environment variables only.
  Never touches: the Production cluster (55432), its data directory, services, ACLs, firewall, Cloudflare, release gate.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Create', 'Start', 'Stop', 'Status', 'RunTests', 'RunTestsPerFile', 'Remove')][string]$Action,
    [string[]]$TestPaths = @('tests/backend', 'tests/database'),
    [string]$RepoPath = 'C:\Projects\management-lite-remediation',
    [string[]]$OnlyFiles = @()
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = 'C:\ML-Test'
$Port = 55433
$ProdPort = 55432
$ProdRoot = 'C:\HoaiPhuong-Server'
$SrcPg = "$ProdRoot\config\postgresql-18\pgsql"
$SrcNode = "$ProdRoot\config\runtime\node-v22.14.0-win-x64"
$ProdData = "$ProdRoot\database\postgres-test"
$Bin = "$Root\pgsql\bin"
$Data = "$Root\pgdata"
$Secrets = "$Root\secrets"
$NodeExe = "$Root\runtime\node\node.exe"

function Assert-Safe {
    if ([IO.Path]::GetFullPath($Root) -ne 'C:\ML-Test') { throw 'root must be C:\ML-Test' }
    if ($Port -eq $ProdPort) { throw 'test port equals production port' }
}
function Port-Listening([int]$p) { [bool](Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) }
function Test-Pid-Ours { @(Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $_.CommandLine -match 'ML-Test' }) }
function Read-Pw([string]$name) { (Get-Content -LiteralPath "$Secrets\$name" -Raw).Trim() }
function Psql([string]$db, [string]$sql, [string]$user = 'ml_test_admin') {
    $ErrorActionPreference = 'Continue'   # psql NOTICE lines arrive on stderr; success is decided by the exit code
    $env:PGPASSWORD = Read-Pw 'admin.pw'
    try { $o = & "$Bin\psql.exe" -h 127.0.0.1 -p $Port -U $user -d $db -X -A -t -v ON_ERROR_STOP=1 -c $sql 2>&1; if ($LASTEXITCODE -ne 0) { throw "psql failed: $($o -join ' ')" }; return $o } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}
function Prod-SystemId {
    $cd = & "$SrcPg\bin\pg_controldata.exe" -D $ProdData 2>&1
    return (($cd | Select-String 'Database system identifier') -split ':')[-1].Trim()
}
function Start-Cluster {
    if (Port-Listening $Port) { Write-Host "already listening on $Port"; return }
    Start-Process -FilePath "$Bin\pg_ctl.exe" -ArgumentList @('start', '-D', "`"$Data`"", '-l', "`"$Root\log\postgres.log`"", '-t', '60') -RedirectStandardOutput "$Root\log\pgctl.out" -RedirectStandardError "$Root\log\pgctl.err" -WindowStyle Hidden
    for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Seconds 1; if (Port-Listening $Port) { Write-Host "cluster up on 127.0.0.1:$Port"; return } }
    throw "cluster did not start within 60s (see $Root\log)"
}
function Stop-Cluster {
    if (-not (Port-Listening $Port)) { Write-Host 'cluster not running'; return }
    Start-Process -FilePath "$Bin\pg_ctl.exe" -ArgumentList @('stop', '-D', "`"$Data`"", '-m', 'fast', '-t', '60') -RedirectStandardOutput "$Root\log\pgctl-stop.out" -RedirectStandardError "$Root\log\pgctl-stop.err" -WindowStyle Hidden -Wait
    Start-Sleep -Seconds 2
    if (Port-Listening $Port) { throw 'cluster still listening after stop' }
    Write-Host 'cluster stopped'
}

$TestPaths = @($TestPaths | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$OnlyFiles = @($OnlyFiles | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
Assert-Safe
switch ($Action) {
    'Create' {
        if (Test-Path -LiteralPath $Root) { throw "$Root already exists; refusing" }
        if (Port-Listening $Port) { throw "port $Port is in use" }
        if (@(Test-Pid-Ours).Count -gt 0) { throw 'a postgres process referencing ML-Test is running' }
        foreach ($n in 'PGPORT', 'PGHOST', 'PGDATA', 'PGUSER', 'PGPASSWORD', 'PGPASSFILE', 'DATABASE_URL', 'TEST_DATABASE_URL', 'ACCOUNT_SECRET_KEY', 'STORAGE_DRIVE_ENCRYPTION_KEY_HEX') { if ([Environment]::GetEnvironmentVariable($n)) { throw "environment variable $n is set; refusing" } }
        if ((Get-PSDrive C).Free -lt 3GB) { throw 'less than 3 GB free on C:' }
        New-Item -ItemType Directory -Path $Root, "$Root\log", "$Root\work", $Secrets | Out-Null
        # restrict secrets dir to the current user + SYSTEM + Administrators (own directory, not production)
        & icacls $Secrets /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
        # copy runtimes (sources are read-only)
        & robocopy $SrcNode "$Root\runtime\node" /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null; if ($LASTEXITCODE -ge 8) { throw "robocopy node failed ($LASTEXITCODE)" }
        foreach ($d in 'bin', 'lib', 'share') { & robocopy "$SrcPg\$d" "$Root\pgsql\$d" /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null; if ($LASTEXITCODE -ge 8) { throw "robocopy pgsql\$d failed ($LASTEXITCODE)" } }
        Write-Host ("node runtime: " + (& $NodeExe -v))
        $chars = [char[]]'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        foreach ($f in 'admin.pw', 'app_test.pw', 'app_runtime.pw') { [IO.File]::WriteAllText("$Secrets\$f", (-join ((1..28) | ForEach-Object { $chars | Get-Random }))) }
        & "$Bin\initdb.exe" -D $Data -U ml_test_admin "--pwfile=$Secrets\admin.pw" --auth=scram-sha-256 -E UTF8 --locale=C --data-checksums 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
        Add-Content -Path "$Data\postgresql.conf" -Value "`n# --- ML isolated TEST cluster ---`nlisten_addresses='127.0.0.1'`nport=$Port`nmax_connections=30`nshared_buffers=64MB`nwork_mem=4MB`nmax_wal_size=256MB`npassword_encryption=scram-sha-256`nssl=off`ncluster_name='ml_test_isolated'`nlog_statement='none'`nlog_connections=on`n"
        [IO.File]::WriteAllText("$Data\pg_hba.conf", "local all all scram-sha-256`nhost all all 127.0.0.1/32 scram-sha-256`nhost all all ::1/128 scram-sha-256`nhost replication all 0.0.0.0/0 reject`nhost replication all ::/0 reject`n")
        Start-Cluster
        Psql 'postgres' "create role hp_app_test login nosuperuser nocreatedb nocreaterole password '$(Read-Pw 'app_test.pw')'" | Out-Null
        Psql 'postgres' "create role hp_app_runtime login nosuperuser nocreatedb nocreaterole password '$(Read-Pw 'app_runtime.pw')'" | Out-Null
        Psql 'postgres' 'create database management_lite_integration_test' | Out-Null
        Psql 'postgres' 'create database fin_qa_isolated' | Out-Null
        $id = (Psql 'postgres' 'select system_identifier::text from pg_control_system()' | Select-Object -First 1).Trim()
        $prodId = Prod-SystemId
        if ($id -eq $prodId) { throw 'ABORT: system_identifier equals production' }
        $marker = [ordered]@{ purpose = 'ISOLATED TEST ENVIRONMENT - NOT PRODUCTION'; created = (Get-Date).ToString('s'); port = $Port; system_identifier = $id; databases = @('management_lite_integration_test', 'fin_qa_isolated'); node = (& $NodeExe -v); server = (Psql 'postgres' 'show server_version' | Select-Object -First 1).Trim() }
        [IO.File]::WriteAllText("$Root\ML-TEST-ENV.json", ($marker | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        Write-Host "Create OK. system_identifier differs from production: True"
    }
    'Start' { Start-Cluster }
    'Stop' { Stop-Cluster }
    'Status' {
        $m = if (Test-Path "$Root\ML-TEST-ENV.json") { Get-Content "$Root\ML-TEST-ENV.json" -Raw | ConvertFrom-Json } else { $null }
        [pscustomobject]@{
            root_exists = (Test-Path $Root)
            marker = [bool]$m
            test_port_listening = (Port-Listening $Port)
            test_postgres_processes = @(Test-Pid-Ours).Count
            listen_addresses_non_loopback = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -notin '127.0.0.1', '::1' }).Count
            prod_port_listening = (Port-Listening $ProdPort)
            prod_listener_pid = (Get-NetTCPConnection -State Listen -LocalPort $ProdPort -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)
            identifier_differs_from_prod = if ($m) { ($m.system_identifier -ne (Prod-SystemId)) } else { $null }
        } | Format-List | Out-String
    }
    'RunTests' {
        if (-not (Test-Path "$Root\ML-TEST-ENV.json")) { throw 'test environment not created' }
        if (-not (Port-Listening $Port)) { Start-Cluster }
        $m = Get-Content "$Root\ML-TEST-ENV.json" -Raw | ConvertFrom-Json
        $liveId = (Psql 'postgres' 'select system_identifier::text from pg_control_system()' | Select-Object -First 1).Trim()
        if ($liveId -ne $m.system_identifier) { throw 'running cluster identifier differs from marker' }
        if ($liveId -eq (Prod-SystemId)) { throw 'ABORT: running cluster is the production cluster' }
        $pw = [uri]::EscapeDataString((Read-Pw 'admin.pw'))
        foreach ($n in 'ACCOUNT_SECRET_KEY', 'STORAGE_DRIVE_ENCRYPTION_KEY_HEX', 'DATABASE_URL', 'BREVO_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_CLIENT_SECRET', 'HP_BRIDGE_SECRET', 'CSRF_SECRET', 'ADMIN_PASSWORD') { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
        $env:NODE_ENV = 'test'
        $env:TEST_DATABASE_URL = "postgresql://ml_test_admin:$pw@127.0.0.1:$Port/management_lite_integration_test"
        $env:CONFIRM_ISOLATED_TEST_DB = 'true'
        $env:FIN_QA_DATABASE_URL = "postgresql://ml_test_admin:$pw@127.0.0.1:$Port/fin_qa_isolated"
        $env:FIN_QA_CONFIRM_ISOLATED = 'yes'
        $env:VERIFY_QA_SYSTEM_IDENTIFIER = $liveId
        $env:FIN_TEST_SYSTEM_IDENTIFIER = $liveId
        $env:PATH = "$Root\runtime\node;$env:PATH"
        Push-Location $RepoPath
        try {
            foreach ($tp in $TestPaths) {
                Write-Host "=== node --test $tp"
                & $NodeExe --test "$tp/*.test.mjs"
                Write-Host "exit $LASTEXITCODE for $tp"
            }
        } finally {
            Pop-Location
            foreach ($n in 'TEST_DATABASE_URL', 'CONFIRM_ISOLATED_TEST_DB', 'FIN_QA_DATABASE_URL', 'FIN_QA_CONFIRM_ISOLATED', 'VERIFY_QA_SYSTEM_IDENTIFIER', 'FIN_TEST_SYSTEM_IDENTIFIER', 'NODE_ENV') { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
        }
    }
    'RunTestsPerFile' {
        # Every test FILE gets its own brand-new databases (like the CI "fresh database per file" gate).
        if (-not (Test-Path "$Root\ML-TEST-ENV.json")) { throw 'test environment not created' }
        if (-not (Port-Listening $Port)) { Start-Cluster }
        $m = Get-Content "$Root\ML-TEST-ENV.json" -Raw | ConvertFrom-Json
        $liveId = (Psql 'postgres' 'select system_identifier::text from pg_control_system()' | Select-Object -First 1).Trim()
        if ($liveId -ne $m.system_identifier) { throw 'running cluster identifier differs from marker' }
        if ($liveId -eq (Prod-SystemId)) { throw 'ABORT: running cluster is the production cluster' }
        $pw = [uri]::EscapeDataString((Read-Pw 'admin.pw'))
        foreach ($n in 'ACCOUNT_SECRET_KEY', 'STORAGE_DRIVE_ENCRYPTION_KEY_HEX', 'DATABASE_URL', 'BREVO_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_CLIENT_SECRET', 'HP_BRIDGE_SECRET', 'CSRF_SECRET', 'ADMIN_PASSWORD') { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
        $run = Get-Date -Format 'yyyyMMdd-HHmmss'
        $outDir = "$Root\work\$run"
        New-Item -ItemType Directory -Force $outDir | Out-Null
        $env:PATH = "$Root\runtime\node;$env:PATH"
        # Tests that must NOT run here (reported as BLOCKED, never executed):
        #  - the cutover test drives Deploy-SemiAutoWindows.ps1, which (even with -SandboxMode) reads the REAL pgpass and
        #    connects to the PRODUCTION cluster (port 55432) as hp_test_admin -> unsafe for an isolated environment.
        #  - the *endpoint / staging-session tests need a running isolated QA API+web (QA_API_BASE / QA_WEB_BASE) = staging (Wave 2B).
        $blocked = @{
            'auth-remember-01-cutover-fallback.test.mjs' = 'BLOCKED: controller connects to production port 55432 with real pgpass'
            'audit-endpoint.test.mjs' = 'BLOCKED: needs QA_API_BASE/QA_WEB_BASE (staging)'
            'issues-endpoint.test.mjs' = 'BLOCKED: needs QA_API_BASE/QA_WEB_BASE (staging)'
            'reports-endpoint.test.mjs' = 'BLOCKED: needs QA_API_BASE/QA_WEB_BASE (staging)'
            'unified-staging-session.test.mjs' = 'BLOCKED: needs QA_API_BASE/QA_WEB_BASE (staging)'
        }
        # Suites that expect an already migrated database (CI list + the ones that failed with "relation does not exist")
        $premigrated = @('att-mvp.test.mjs', 'rep-mvp.test.mjs', 'work.test.mjs', 'schedule.test.mjs', 'acc-e2e.test.mjs', 'comprehensive-business-e2e.test.mjs', 'privileged-script-safety.test.mjs', 'recover-owner-access.test.mjs')
        New-Item -ItemType Directory -Force "$RepoPath\.local" | Out-Null
        $migScript = "$RepoPath\.local\_migrate.mjs"
        [IO.File]::WriteAllText($migScript, @"
import { runMigrations, loadMigrationFiles } from 'file:///$($RepoPath.Replace('\','/'))/dist/packages/database/src/migrator.js';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.MIG_URL });
try { await runMigrations(pool, loadMigrationFiles('packages/database/src/migrations')); } finally { await pool.end(); }
"@)
        $sentinel = 'management_lite_test_sentinel'
        Psql 'postgres' "drop database if exists $sentinel with (force)" | Out-Null
        Psql 'postgres' "create database $sentinel" | Out-Null
        $summary = New-Object System.Collections.Generic.List[object]
        Push-Location $RepoPath
        try {
            $files = @()
            foreach ($tp in $TestPaths) { $files += Get-ChildItem -Path (Join-Path $RepoPath $tp) -Filter '*.test.mjs' -File | Sort-Object Name }
            if ($OnlyFiles.Count -gt 0) { $files = @($files | Where-Object { $OnlyFiles -contains $_.Name }) }
            $i = 0
            foreach ($file in $files) {
                $i++
                $tag = ('{0:D3}' -f $i)
                if ($blocked.ContainsKey($file.Name)) {
                    $summary.Add([pscustomobject]@{ file = "$($file.Directory.Name)/$($file.Name)"; exit = 'BLOCKED'; tests = 0; pass = 0; fail = 0; skipped = 0; secs = 0; log = $blocked[$file.Name] })
                    continue
                }
                $db1 = "management_lite_test_$tag"
                $db2 = "fin_qa_$tag"
                Psql 'postgres' "drop database if exists $db1 with (force)" | Out-Null
                Psql 'postgres' "drop database if exists $db2 with (force)" | Out-Null
                Psql 'postgres' "create database $db1" | Out-Null
                Psql 'postgres' "create database $db2" | Out-Null
                $env:NODE_ENV = 'test'
                $env:TEST_DATABASE_URL = "postgresql://ml_test_admin:$pw@127.0.0.1:$Port/$db1"
                $env:CONFIRM_ISOLATED_TEST_DB = 'true'
                $env:FIN_QA_DATABASE_URL = "postgresql://ml_test_admin:$pw@127.0.0.1:$Port/$db2"
                $env:FIN_QA_CONFIRM_ISOLATED = 'yes'
                $env:VERIFY_QA_SYSTEM_IDENTIFIER = $liveId
                $env:FIN_TEST_SYSTEM_IDENTIFIER = $liveId
                $env:DATABASE_URL = "postgresql://ml_test_admin:$pw@127.0.0.1:$Port/$sentinel"
                $env:ACCOUNT_SECRET_KEY = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })   # throw-away TEST key, never a production key
                Remove-Item Env:CSRF_SECRET -ErrorAction SilentlyContinue
                if ($premigrated -contains $file.Name) {
                    $env:MIG_URL = $env:TEST_DATABASE_URL
                    $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
                    & $NodeExe $migScript 2>&1 | Out-Null
                    $migCode = $LASTEXITCODE
                    $ErrorActionPreference = $prevEap
                    Remove-Item Env:MIG_URL -ErrorAction SilentlyContinue
                    if ($migCode -ne 0) { Write-Host "warn: premigration failed for $($file.Name)" }
                }
                $log = "$outDir\$tag-$($file.BaseName).log"
                $sw = [Diagnostics.Stopwatch]::StartNew()
                & $NodeExe --test $file.FullName *> $log
                $code = $LASTEXITCODE
                $sw.Stop()
                $txt = Get-Content -LiteralPath $log -Raw
                $get = { param($k) $mm = [regex]::Match($txt, "(?m)^#\s+$k\s+(\d+)"); if ($mm.Success) { [int]$mm.Groups[1].Value } else { $mm2 = [regex]::Match($txt, "(?m)^\S\s$k\s+(\d+)"); if ($mm2.Success) { [int]$mm2.Groups[1].Value } else { -1 } } }
                $summary.Add([pscustomobject]@{ file = "$($file.Directory.Name)/$($file.Name)"; exit = $code; tests = (& $get 'tests'); pass = (& $get 'pass'); fail = (& $get 'fail'); skipped = (& $get 'skipped'); secs = [math]::Round($sw.Elapsed.TotalSeconds, 1); log = $log })
                foreach ($n in 'TEST_DATABASE_URL', 'CONFIRM_ISOLATED_TEST_DB', 'FIN_QA_DATABASE_URL', 'FIN_QA_CONFIRM_ISOLATED', 'VERIFY_QA_SYSTEM_IDENTIFIER', 'FIN_TEST_SYSTEM_IDENTIFIER', 'NODE_ENV', 'DATABASE_URL', 'ACCOUNT_SECRET_KEY') { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
                foreach ($db in @($db1, $db2)) { try { Psql 'postgres' "drop database if exists $db with (force)" | Out-Null } catch { Write-Host "warn: could not drop $db" } }
            }
        } finally { Pop-Location }
        $tables = (Psql $sentinel "select count(*) from pg_tables where schemaname='public'" | Select-Object -First 1).Trim()
        Write-Host "sentinel DB tables (must be 0): $tables"
        Psql 'postgres' "drop database if exists $sentinel with (force)" | Out-Null
        $summary | Export-Csv -NoTypeInformation -Path "$outDir\summary.csv"
        $summary | Format-Table file, exit, tests, pass, fail, skipped, secs -AutoSize | Out-String -Width 200
        $t = [pscustomobject]@{ files = $summary.Count; files_with_nonzero_exit = @($summary | Where-Object { $_.exit -ne 0 }).Count; tests = ($summary | Measure-Object tests -Sum).Sum; pass = ($summary | Measure-Object pass -Sum).Sum; fail = ($summary | Measure-Object fail -Sum).Sum; skipped = ($summary | Measure-Object skipped -Sum).Sum }
        "TOTAL: files=$($t.files) nonzero-exit=$($t.files_with_nonzero_exit) tests=$($t.tests) pass=$($t.pass) fail=$($t.fail) skipped=$($t.skipped)"
        "results: $outDir"
    }
    'Remove' {
        if (-not (Test-Path -LiteralPath $Root)) { Write-Host 'nothing to remove'; return }
        if (Port-Listening $Port) { Stop-Cluster }
        if (@(Test-Pid-Ours).Count -gt 0) { throw 'postgres processes still running' }
        $junc = @(Get-ChildItem -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.LinkType }).Count
        if ($junc -gt 0) { throw "refusing: $junc junction(s) under $Root" }
        Remove-Item -LiteralPath $Root -Recurse -Force
        Write-Host "removed $Root"
    }
}
