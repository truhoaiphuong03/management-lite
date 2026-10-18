<#
.SYNOPSIS
  Verify Cloudflare DNS records for hoaiphuong.click, authenticate domain on Brevo,
  and create/verify sender no-reply@hoaiphuong.click (Management Lite).
  - Never prints API keys or secrets.
  - Never modifies DNS unless -ApplyCloudflareDnsApprovedByOwner and a valid Cloudflare token are explicitly provided.
#>
param(
  [switch]$AuthenticateBrevo,
  [switch]$EnsureSender,
  [switch]$ApplyCloudflareDnsApprovedByOwner,
  [string]$CloudflareTokenDpapiPath = 'C:\HoaiPhuong-Server\config\brevo-dev-secrets\cf-dns-token.dpapi',
  [string]$BrevoSecretFile = 'C:\HoaiPhuong-Server\config\brevo-dev-secrets\api-key.dpapi'
)

$ErrorActionPreference = 'Stop'
$Domain = 'hoaiphuong.click'
$SenderEmail = 'no-reply@hoaiphuong.click'
$SenderName  = 'Management Lite'

$ExpectedRecords = @(
  @{ Type = 'TXT';   Host = '@';                 Fqdn = 'hoaiphuong.click';                   Value = 'brevo-code:740e49f42481bcfb114476298c20c552'; Proxied = $false },
  @{ Type = 'CNAME'; Host = 'brevo1._domainkey'; Fqdn = 'brevo1._domainkey.hoaiphuong.click'; Value = 'b1.hoaiphuong-click.dkim.brevo.com';          Proxied = $false },
  @{ Type = 'CNAME'; Host = 'brevo2._domainkey'; Fqdn = 'brevo2._domainkey.hoaiphuong.click'; Value = 'b2.hoaiphuong-click.dkim.brevo.com';          Proxied = $false },
  @{ Type = 'TXT';   Host = '_dmarc';            Fqdn = '_dmarc.hoaiphuong.click';            Value = 'v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com'; Proxied = $false }
)

if ($ApplyCloudflareDnsApprovedByOwner) {
  if (-not (Test-Path -LiteralPath $CloudflareTokenDpapiPath)) {
    throw "Missing Cloudflare DPAPI token file at: $CloudflareTokenDpapiPath"
  }
  $cfSec = Get-Content -LiteralPath $CloudflareTokenDpapiPath -Raw | ConvertTo-SecureString
  $cfPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($cfSec)
  try {
    $cfToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($cfPtr)
    $cfHeaders = @{ 'Authorization' = "Bearer $cfToken"; 'Content-Type' = 'application/json' }
    $zones = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones?name=$Domain" -Method GET -Headers $cfHeaders
    if (-not $zones.result -or $zones.result.Count -eq 0) {
      throw "Cloudflare zone not found for $Domain"
    }
    $zoneId = $zones.result[0].id
    foreach ($rec in $ExpectedRecords) {
      $existing = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?type=$($rec.Type)&name=$($rec.Fqdn)" -Method GET -Headers $cfHeaders
      $matched = $existing.result | Where-Object { $_.content -eq $rec.Value } | Select-Object -First 1
      if ($null -ne $matched) {
        Write-Host "[CF-DNS] Already exists: [$($rec.Type)] $($rec.Fqdn) -> $($rec.Value)" -ForegroundColor Green
      } else {
        $payload = @{
          type    = $rec.Type
          name    = $rec.Fqdn
          content = $rec.Value
          ttl     = 3600
        }
        if ($rec.Type -eq 'CNAME') {
          $payload.proxied = $false
        }
        $created = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" -Method POST -Headers $cfHeaders -Body ($payload | ConvertTo-Json -Compress)
        if (-not $created.success) {
          throw "Failed to create Cloudflare DNS record $($rec.Fqdn)"
        }
        Write-Host "[CF-DNS] Created: [$($rec.Type)] $($rec.Fqdn) -> $($rec.Value)" -ForegroundColor Cyan
      }
    }
  } finally {
    if ($cfPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($cfPtr) }
    $cfSec.Dispose()
    $cfToken = $null
  }
}

Write-Host "=== 1. PUBLIC DNS VERIFICATION (1.1.1.1) ===" -ForegroundColor Cyan
$allDnsReady = $true
foreach ($rec in $ExpectedRecords) {
  $found = $false
  try {
    $ans = Resolve-DnsName -Name $rec.Fqdn -Type $rec.Type -Server 1.1.1.1 -ErrorAction Stop
    if ($rec.Type -eq 'TXT') {
      $txtMatch = $ans | Where-Object { $_.Strings -contains $rec.Value }
      if ($txtMatch) { $found = $true }
    } elseif ($rec.Type -eq 'CNAME') {
      $cnameMatch = $ans | Where-Object { $_.NameHost -and $_.NameHost.TrimEnd('.') -ieq $rec.Value.TrimEnd('.') }
      if ($cnameMatch) { $found = $true }
    }
  } catch {
    $found = $false
  }

  if ($found) {
    Write-Host "[PASS] [$($rec.Type)] $($rec.Fqdn) = $($rec.Value)" -ForegroundColor Green
  } else {
    Write-Host "[MISSING] [$($rec.Type)] $($rec.Fqdn) -> Expected: $($rec.Value)" -ForegroundColor Yellow
    $allDnsReady = $false
  }
}

Write-Host "`n=== 2. BREVO DOMAIN & SENDER STATUS ===" -ForegroundColor Cyan
$secret = Get-Content -LiteralPath $BrevoSecretFile -Raw | ConvertTo-SecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $headers = @{ 'api-key' = $apiKey; 'accept' = 'application/json'; 'content-type' = 'application/json' }

  if ($AuthenticateBrevo -and $allDnsReady) {
    try {
      $authRes = Invoke-RestMethod -Uri "https://api.brevo.com/v3/senders/domains/$Domain/authenticate" -Method PUT -Headers $headers
      Write-Host "[BREVO] Triggered domain authentication: $($authRes | ConvertTo-Json -Compress)" -ForegroundColor Cyan
    } catch {
      Write-Host "[BREVO] Domain authenticate API warning: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }

  $domDetail = Invoke-RestMethod -Uri "https://api.brevo.com/v3/senders/domains/$Domain" -Method GET -Headers $headers
  Write-Host ("Domain: {0} | verified={1} | authenticated={2}" -f $domDetail.domain, $domDetail.verified, $domDetail.authenticated)

  $sendersList = Invoke-RestMethod -Uri 'https://api.brevo.com/v3/senders' -Method GET -Headers $headers
  $targetSender = $sendersList.senders | Where-Object { $_.email -eq $SenderEmail } | Select-Object -First 1

  if ($EnsureSender -and $null -eq $targetSender -and $domDetail.authenticated -eq $true) {
    $createBody = (@{ name = $SenderName; email = $SenderEmail } | ConvertTo-Json -Compress)
    $createdSender = Invoke-RestMethod -Uri 'https://api.brevo.com/v3/senders' -Method POST -Headers $headers -Body $createBody
    Write-Host "[BREVO] Created sender $SenderEmail (id=$($createdSender.id))" -ForegroundColor Green
    $sendersList = Invoke-RestMethod -Uri 'https://api.brevo.com/v3/senders' -Method GET -Headers $headers
    $targetSender = $sendersList.senders | Where-Object { $_.email -eq $SenderEmail } | Select-Object -First 1
  }

  if ($null -ne $targetSender) {
    Write-Host ("Sender: {0} <{1}> | active={2}" -f $targetSender.name, $targetSender.email, $targetSender.active) -ForegroundColor Green
  } else {
    Write-Host ("Sender: {0} <{1}> | NOT CREATED YET (Waiting for domain authentication)" -f $SenderName, $SenderEmail) -ForegroundColor Yellow
  }
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $secret.Dispose()
  $apiKey = $null
}
