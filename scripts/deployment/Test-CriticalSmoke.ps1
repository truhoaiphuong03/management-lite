# Administrator installs this trusted adapter outside the release artifact.
# No production login, payroll write, Owner mutation or Google Drive operation.
param([Parameter(Mandatory)][string]$ExpectedSha)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$c = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deployment.config.json') -Raw | ConvertFrom-Json
$service = Get-CimInstance Win32_Service -Filter ("Name='" + $c.ApiService.Replace("'", "''") + "'")
if ($service.State -ne 'Running' -or !$service.ProcessId) { throw 'API service unavailable.' }
$port = ([uri]$c.ApiHealthBase).Port
$listener = @(Get-NetTCPConnection -LocalPort $port -State Listen)
if ($listener.Count -ne 1) { throw 'Unexpected API listener inventory.' }
$process = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $listener[0].OwningProcess)
$expectedEntry = Join-Path $c.Root 'current\dist\apps\api\src\main.js'
if ($process.ExecutablePath -ine $c.NodePath -or !$process.CommandLine.Contains($expectedEntry)) { throw 'API listener does not run managed entrypoint.' }
$ancestor=$process; $owned=$false
for ($i=0;$i -lt 5;$i++) {
    if ($ancestor.ProcessId -eq $service.ProcessId) { $owned=$true; break }
    $ancestor=Get-CimInstance Win32_Process -Filter ("ProcessId=" + $ancestor.ParentProcessId)
    if (!$ancestor) { break }
}
if (!$owned) { throw 'API listener is outside managed service process tree.' }
foreach ($route in @('/api/v1/auth/me','/api/v1/accounts','/api/v1/payroll/periods')) {
    $response=Invoke-WebRequest -Uri ($c.ApiHealthBase.TrimEnd('/')+$route) -SkipHttpErrorCheck -TimeoutSec 5
    if ($response.StatusCode -ne 401) { throw 'Unauthenticated access contract failed.' }
}
$v=Invoke-RestMethod -Uri ($c.WebHealthBase.TrimEnd('/')+'/release-version.json') -TimeoutSec 10
if ($v.sha -cne $ExpectedSha) { throw 'Web SHA mismatch.' }
