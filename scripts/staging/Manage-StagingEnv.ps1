<#
.SYNOPSIS
    Manage-StagingEnv.ps1 — Isolated Staging Environment Controller (W2B.7 / F1 / OA-24)
.DESCRIPTION
    Manages a strictly isolated local Staging environment on loopback ports:
      - Web: 127.0.0.1:4001 (served via scripts/runtime/serve-web.cjs with CSP/XFO/HSTS/Brotli)
      - API: 127.0.0.1:4002 (dist/apps/api/src/main.js)
      - DB : 127.0.0.1:55433 (C:\ML-Test PostgreSQL cluster, database management_lite_staging_test)
      - Cookie: SESSION_COOKIE_NAME=ml_staging_session (prevents browser cookie collision with Prod mglite_session)
    Fail-closed against Production ports (3000, 3001, 3002, 55432) and C:\HoaiPhuong-Server.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('VerifyConfig', 'Start', 'Stop', 'Status', 'SmokeTest')]
    [string]$Action,
    [string]$TestRoot = 'C:\ML-Test',
    [string]$RepoPath = '',
    [int]$WebPort = 4001,
    [int]$ApiPort = 4002,
    [int]$DbPort = 55433,
    [string]$DbName = 'management_lite_staging_test'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoPath)) {
    $ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
    $RepoPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir '..\..'))
} else {
    $RepoPath = [System.IO.Path]::GetFullPath($RepoPath)
}

$ForbiddenPorts = @(3000, 3001, 3002, 3004, 3005, 3007, 3008, 3017, 3018, 3027, 3028, 3401, 3462, 55432)
foreach ($p in @($WebPort, $ApiPort, $DbPort)) {
    if ($ForbiddenPorts -contains $p) {
        throw "STAGING_ISOLATION_VIOLATION: Port $p is in the prohibited operational/production port list."
    }
}
if ($RepoPath -match '(?i)^C:\\HoaiPhuong-Server') {
    throw "STAGING_ISOLATION_VIOLATION: RepoPath cannot point inside C:\HoaiPhuong-Server."
}
if ($DbName -notmatch '(?i)test|staging') {
    throw "STAGING_ISOLATION_VIOLATION: Staging database name '$DbName' must explicitly contain 'staging' or 'test'."
}

$StagingWorkDir = Join-Path $TestRoot 'work\staging-env'
$PidFile = Join-Path $StagingWorkDir 'staging-pids.json'
$NodeExe = Join-Path $TestRoot 'runtime\node\node.exe'
if (-not (Test-Path -LiteralPath $NodeExe)) {
    $NodeExe = (Get-Command node -ErrorAction Stop).Source
}

function Test-PortListening([int]$PortToCheck) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $c.BeginConnect('127.0.0.1', $PortToCheck, $null, $null)
        if ($ar.AsyncWaitHandle.WaitOne(250)) { $c.EndConnect($ar); return $true }
        return $false
    } catch { return $false } finally { $c.Close() }
}

switch ($Action) {
    'VerifyConfig' {
        $result = [ordered]@{
            status              = 'PASS'
            repo_path           = $RepoPath
            test_root           = $TestRoot
            web_origin          = "http://127.0.0.1:$WebPort"
            api_origin          = "http://127.0.0.1:$ApiPort"
            db_host_port        = "127.0.0.1:$DbPort"
            db_name             = $DbName
            session_cookie_name = 'ml_staging_session'
            prod_ports_blocked  = $ForbiddenPorts
            serve_web_exists    = (Test-Path -LiteralPath (Join-Path $RepoPath 'scripts\runtime\serve-web.cjs'))
            api_main_exists     = (Test-Path -LiteralPath (Join-Path $RepoPath 'dist\apps\api\src\main.js'))
            web_dist_exists     = (Test-Path -LiteralPath (Join-Path $RepoPath 'apps\web\dist\index.html'))
        }
        $result | ConvertTo-Json -Depth 4
    }

    'Status' {
        $pids = if (Test-Path -LiteralPath $PidFile) { Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json } else { $null }
        [ordered]@{
            web_port_listening = (Test-PortListening $WebPort)
            api_port_listening = (Test-PortListening $ApiPort)
            db_port_listening  = (Test-PortListening $DbPort)
            pid_record         = $pids
        } | ConvertTo-Json -Depth 4
    }

    'Start' {
        New-Item -ItemType Directory -Force -Path $StagingWorkDir | Out-Null

        # Stop any stale staging processes tracked in PidFile first
        if (Test-Path -LiteralPath $PidFile) {
            $oldPids = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
            foreach ($prop in @('web_pid', 'api_pid')) {
                $targetPid = $oldPids.$prop
                if ($targetPid) {
                    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
                    if ($proc -and $proc.ProcessName -eq 'node') {
                        Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
                    }
                }
            }
            Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        }

        if ((Test-PortListening $WebPort) -or (Test-PortListening $ApiPort)) {
            throw "STAGING_START_ABORTED: WebPort ($WebPort) or ApiPort ($ApiPort) is already in use by another process."
        }

        $ServeWebScript = Join-Path $RepoPath 'scripts\runtime\serve-web.cjs'
        $ApiMainScript = Join-Path $RepoPath 'dist\apps\api\src\main.js'
        $WebDistIndex = Join-Path $RepoPath 'apps\web\dist\index.html'
        if (-not (Test-Path -LiteralPath $ServeWebScript)) { throw "Missing $ServeWebScript" }
        if (-not (Test-Path -LiteralPath $ApiMainScript)) { throw "Missing $ApiMainScript (run npm run build first)" }
        if (-not (Test-Path -LiteralPath $WebDistIndex)) { throw "Missing $WebDistIndex (run npm run build:web first)" }

        # Ensure isolated PostgreSQL cluster on $DbPort is running (without piping stdout from background postgres.exe)
        if (-not (Test-PortListening $DbPort)) {
            $PgCtlExe = Join-Path $TestRoot 'pgsql\bin\pg_ctl.exe'
            $PgIsReadyExe = Join-Path $TestRoot 'pgsql\bin\pg_isready.exe'
            $PgDataDir = Join-Path $TestRoot 'pgdata'
            $PgLogDir = Join-Path $TestRoot 'log'
            if (-not (Test-Path -LiteralPath $PgCtlExe)) {
                throw "Missing isolated PostgreSQL binary at $PgCtlExe (run Manage-TestEnv.ps1 -Action Create first)."
            }
            New-Item -ItemType Directory -Force -Path $PgLogDir | Out-Null
            $null = Start-Process -FilePath $PgCtlExe `
                -ArgumentList @('start', '-D', "`"$PgDataDir`"", '-l', "`"$PgLogDir\postgres.log`"", '-t', '60') `
                -RedirectStandardOutput (Join-Path $PgLogDir 'pgctl-staging.out') `
                -RedirectStandardError (Join-Path $PgLogDir 'pgctl-staging.err') `
                -WindowStyle Hidden
            for ($i = 0; $i -lt 60; $i++) {
                Start-Sleep -Milliseconds 500
                if (Test-PortListening $DbPort) {
                    & $PgIsReadyExe -h 127.0.0.1 -p $DbPort -U ml_test_admin -d postgres 2>$null | Out-Null
                    if ($LASTEXITCODE -eq 0) { break }
                }
            }
        }
        if (-not (Test-PortListening $DbPort)) {
            throw "STAGING_START_ABORTED: Isolated PostgreSQL cluster is not listening on 127.0.0.1:$DbPort."
        }

        $AdminPwPath = Join-Path $TestRoot 'secrets\admin.pw'
        $PsqlExe = Join-Path $TestRoot 'pgsql\bin\psql.exe'
        if (-not (Test-Path -LiteralPath $AdminPwPath)) {
            throw "Missing test admin password at $AdminPwPath"
        }
        $RawPw = (Get-Content -LiteralPath $AdminPwPath -Raw).Trim()
        $EscapedPw = [uri]::EscapeDataString($RawPw)
        $DbUrl = "postgresql://ml_test_admin:$EscapedPw@127.0.0.1:$DbPort/$DbName"

        # Create staging database if not exists
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $env:PGPASSWORD = $RawPw
        try {
            $existsOut = & $PsqlExe -h 127.0.0.1 -p $DbPort -U ml_test_admin -d postgres -X -A -t -c "SELECT 1 FROM pg_database WHERE datname = '$DbName';" 2>&1
            if (($existsOut -join '').Trim() -ne '1') {
                & $PsqlExe -h 127.0.0.1 -p $DbPort -U ml_test_admin -d postgres -X -A -t -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DbName;" 2>&1 | Out-Null
            }
            $liveSysId = (& $PsqlExe -h 127.0.0.1 -p $DbPort -U ml_test_admin -d postgres -X -A -t -c "SELECT system_identifier::text FROM pg_control_system();" 2>&1 | Select-Object -First 1).Trim()
        } finally {
            Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
            $ErrorActionPreference = $prevEap
        }

        # Run migrations against $DbName using the repository's canonical migrate.mjs
        $RepoForward = $RepoPath.Replace('\', '/')
        $MigrateScript = Join-Path $RepoPath 'scripts\migrate.mjs'
        $env:DATABASE_URL = $DbUrl
        try {
            Push-Location $RepoPath
            try {
                & $NodeExe $MigrateScript | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "Staging database migration failed ($LASTEXITCODE)" }
            } finally {
                Pop-Location
            }
        } finally {
            Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
        }

        # Ephemeral secrets for this staging session
        $SecretsFile = Join-Path $StagingWorkDir 'staging-secrets.json'
        $CsrfSecret = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
        $AccountSecretKey = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
        if (Test-Path -LiteralPath $SecretsFile) {
            try {
                $savedSecrets = Get-Content -LiteralPath $SecretsFile -Raw | ConvertFrom-Json
                if ($savedSecrets.csrf_secret) { $CsrfSecret = $savedSecrets.csrf_secret }
                if ($savedSecrets.account_secret_key) { $AccountSecretKey = $savedSecrets.account_secret_key }
            } catch {}
        }
        [IO.File]::WriteAllText($SecretsFile, ([ordered]@{
            csrf_secret        = $CsrfSecret
            account_secret_key = $AccountSecretKey
        } | ConvertTo-Json))

        # Seed unified QA accounts if .env.qa-credentials.local exists (or create default local QA credentials)
        $QaCredsFile = Join-Path $RepoPath '.env.qa-credentials.local'
        if (-not (Test-Path -LiteralPath $QaCredsFile)) {
            $MainCredsFile = 'C:\Projects\management-lite\.env.qa-credentials.local'
            if (Test-Path -LiteralPath $MainCredsFile) {
                Copy-Item -LiteralPath $MainCredsFile -Destination $QaCredsFile -Force
            }
        }
        if (Test-Path -LiteralPath $QaCredsFile) {
            $env:NODE_ENV = 'test'
            $env:TEST_DATABASE_URL = $DbUrl
            $env:CONFIRM_ISOLATED_TEST_DB = 'true'
            $env:VERIFY_QA_SYSTEM_IDENTIFIER = $liveSysId
            $env:ACCOUNT_SECRET_KEY = $AccountSecretKey
            try {
                Push-Location $RepoPath
                try {
                    & $NodeExe (Join-Path $RepoPath 'scripts\seed-unified-qa.mjs') | Out-Null
                } finally {
                    Pop-Location
                }
            } finally {
                foreach ($k in @('NODE_ENV', 'TEST_DATABASE_URL', 'CONFIRM_ISOLATED_TEST_DB', 'VERIFY_QA_SYSTEM_IDENTIFIER', 'ACCOUNT_SECRET_KEY')) {
                    Remove-Item "Env:$k" -ErrorAction SilentlyContinue
                }
            }
        }

        # Create launcher scripts for API and Web with isolated env vars
        $ApiLauncher = Join-Path $StagingWorkDir 'start-staging-api.cjs'
        [IO.File]::WriteAllText($ApiLauncher, @"
'use strict';
process.env.NODE_ENV = 'development';
process.env.HOST = '127.0.0.1';
process.env.PORT = '$ApiPort';
process.env.DATABASE_URL = '$DbUrl';
process.env.SESSION_COOKIE_NAME = 'ml_staging_session';
process.env.ALLOWED_ORIGINS = 'http://127.0.0.1:$WebPort,http://localhost:$WebPort';
process.env.CSRF_SECRET = '$CsrfSecret';
process.env.ACCOUNT_SECRET_KEY = '$AccountSecretKey';
process.chdir('$($RepoPath.Replace('\', '\\'))');
import('file:///$RepoForward/dist/apps/api/src/main.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
"@)

        $ApiOutLog = Join-Path $StagingWorkDir 'api.out.log'
        $ApiErrLog = Join-Path $StagingWorkDir 'api.err.log'
        $WebOutLog = Join-Path $StagingWorkDir 'web.out.log'
        $WebErrLog = Join-Path $StagingWorkDir 'web.err.log'

        $apiProc = Start-Process -FilePath $NodeExe -ArgumentList @($ApiLauncher) -WorkingDirectory $RepoPath -RedirectStandardOutput $ApiOutLog -RedirectStandardError $ApiErrLog -WindowStyle Hidden -PassThru

        # Launch serve-web.cjs directly as an independent entry module so require.main === module holds
        $env:WEB_ROOT = Join-Path $RepoPath 'apps\web\dist'
        $env:WEB_HOST = '127.0.0.1'
        $env:WEB_PORT = "$WebPort"
        $env:API_HOST = '127.0.0.1'
        $env:API_PORT = "$ApiPort"
        try {
            $webProc = Start-Process -FilePath $NodeExe -ArgumentList @($ServeWebScript) -WorkingDirectory $RepoPath -RedirectStandardOutput $WebOutLog -RedirectStandardError $WebErrLog -WindowStyle Hidden -PassThru
        } finally {
            foreach ($wk in @('WEB_ROOT', 'WEB_HOST', 'WEB_PORT', 'API_HOST', 'API_PORT')) {
                Remove-Item "Env:$wk" -ErrorAction SilentlyContinue
            }
        }

        $pidData = [ordered]@{
            web_pid    = $webProc.Id
            api_pid    = $apiProc.Id
            web_port   = $WebPort
            api_port   = $ApiPort
            db_port    = $DbPort
            db_name    = $DbName
            repo_path  = $RepoPath
            started_at = (Get-Date).ToString('o')
        }
        [IO.File]::WriteAllText($PidFile, ($pidData | ConvertTo-Json -Depth 4))

        $ready = $false
        for ($i = 0; $i -lt 40; $i++) {
            Start-Sleep -Milliseconds 500
            if ((Test-PortListening $ApiPort) -and (Test-PortListening $WebPort)) {
                $ready = $true
                break
            }
        }
        if (-not $ready) {
            throw "STAGING_START_TIMEOUT: API ($ApiPort) or Web ($WebPort) did not start within 20s. Check logs in $StagingWorkDir."
        }

        [ordered]@{
            status             = 'STARTED'
            web_origin         = "http://127.0.0.1:$WebPort"
            api_origin         = "http://127.0.0.1:$ApiPort"
            db_host_port       = "127.0.0.1:$DbPort"
            db_name            = $DbName
            web_port_listening = (Test-PortListening $WebPort)
            api_port_listening = (Test-PortListening $ApiPort)
            db_port_listening  = (Test-PortListening $DbPort)
            pid_record         = $pidData
        } | ConvertTo-Json -Depth 4
    }

    'SmokeTest' {
        $webListening = Test-PortListening $WebPort
        $apiListening = Test-PortListening $ApiPort
        $dbListening = Test-PortListening $DbPort
        if (-not ($webListening -and $apiListening -and $dbListening)) {
            throw "STAGING_SMOKE_FAILED: Ports not all listening (web=$webListening, api=$apiListening, db=$dbListening)."
        }

        $apiHealthRes = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/api/v1/health" -UseBasicParsing -TimeoutSec 10
        $webLoginRes = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort/login" -UseBasicParsing -TimeoutSec 10
        $proxyHealthRes = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort/api/v1/health" -UseBasicParsing -TimeoutSec 10

        $cspHeader = [string]$webLoginRes.Headers['Content-Security-Policy']
        $xfoHeader = [string]$webLoginRes.Headers['X-Frame-Options']
        $nosniffHeader = [string]$webLoginRes.Headers['X-Content-Type-Options']

        $passed = (
            $apiHealthRes.StatusCode -eq 200 -and
            $webLoginRes.StatusCode -eq 200 -and
            $proxyHealthRes.StatusCode -eq 200 -and
            $cspHeader.Length -gt 0 -and
            $xfoHeader -eq 'DENY' -and
            $nosniffHeader -eq 'nosniff'
        )
        if (-not $passed) {
            throw "STAGING_SMOKE_FAILED: Unexpected status or missing security headers."
        }

        [ordered]@{
            status               = 'PASS'
            api_health_status    = $apiHealthRes.StatusCode
            web_login_status     = $webLoginRes.StatusCode
            proxy_health_status  = $proxyHealthRes.StatusCode
            has_csp_header       = ($cspHeader.Length -gt 0)
            x_frame_options      = $xfoHeader
            x_content_type_nosniff = $nosniffHeader
        } | ConvertTo-Json -Depth 4
    }

    'Stop' {
        if (Test-Path -LiteralPath $PidFile) {
            $pids = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
            foreach ($prop in @('web_pid', 'api_pid')) {
                $targetPid = $pids.$prop
                if ($targetPid) {
                    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
                    if ($proc -and $proc.ProcessName -eq 'node') {
                        Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
                    }
                }
            }
            Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        }
        Write-Output "STAGING_STOPPED: web_listening=$(Test-PortListening $WebPort) api_listening=$(Test-PortListening $ApiPort)"
    }
}
