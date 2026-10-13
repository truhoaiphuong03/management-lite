# Configure WinSW/NSSM once to run this administrator-installed script.
param([string]$Root='C:\ManagementLite')
$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath (Join-Path $Root 'controller/deployment.config.json') -Raw | ConvertFrom-Json
$entry=Join-Path $Root 'current/dist/apps/api/src/main.js'
# External environment file is never copied from a release. Existing ACCOUNT_SECRET_KEY is retained.
$runtimeEnv=Join-Path $Root 'protected/runtime.env'
Set-Location (Join-Path $Root 'current')
& $config.NodePath "--env-file=$runtimeEnv" $entry
exit $LASTEXITCODE
