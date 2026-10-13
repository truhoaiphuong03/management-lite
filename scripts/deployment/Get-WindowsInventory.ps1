# Read-only, deliberately excludes service command lines, environment, usernames/passwords and config contents.
# Run on staging/production only when its operator authorizes read-only inventory.
[CmdletBinding()]
param([string]$ApplicationRoot, [string]$Domain='ql.hoaiphuong.click')
$ErrorActionPreference='Stop'
if (!$IsWindows) { throw 'Windows inventory cannot be verified on this host.' }
$services=Get-CimInstance Win32_Service | Where-Object { $_.Name -match 'Management|Postgre|Caddy|W3SVC|WinSW|NSSM' }
$node=Get-Command node.exe -ErrorAction SilentlyContinue
$pg=Get-Command psql.exe -ErrorAction SilentlyContinue
@{
    observedAt=[DateTime]::UtcNow.ToString('o')
    os=(Get-CimInstance Win32_OperatingSystem).Caption
    services=@($services | Select-Object Name,State,StartMode,ProcessId)
    nodeVersion=$(if($node){ & $node.Source --version }else{'NOT_FOUND_ON_PATH'})
    postgresqlClientVersion=$(if($pg){ & $pg.Source --version }else{'NOT_FOUND_ON_PATH'})
    applicationRootExists=($ApplicationRoot -and (Test-Path -LiteralPath $ApplicationRoot))
    listeningPorts=@(Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess)
    firewallProfiles=@(Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction)
    dns=@(Resolve-DnsName $Domain -ErrorAction SilentlyContinue | Select-Object Name,Type,IPAddress,NameHost)
    remaining='Operator must verify service wrapper paths, runtime config, backups/restores, proxy/TLS and database identity privately; not collected automatically.'
} | ConvertTo-Json -Depth 5
