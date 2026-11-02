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
    [string]$RepoPath = (Resolve-Path "$PSScriptRoot\..\..").Path,
    [int]$WebPort = 4001,
    [int]$ApiPort = 4002,
    [int]$DbPort = 55433,
    [string]$DbName = 'management_lite_staging_test'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
