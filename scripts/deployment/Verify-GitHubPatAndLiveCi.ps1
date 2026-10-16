#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CommitSha = '',
  [string]$RepoSlug = 'truhoaiphuong03/management-lite',
  [string]$WorkflowFile = 'foundation.yml',
  [string]$SourceBranch = 'anty/dev-complete-rc',
  [string]$GitHubApiBaseUrl = 'https://api.github.com',
  [string]$DevRepoDir = 'C:\HoaiPhuong-Server\workspace\management-lite-uiux-integration-test',
  [string]$DpapiTokenPath = 'C:\HoaiPhuong-Server\workspace\github-pat.dpapi',
  [string]$ReportOutPath = 'C:\HoaiPhuong-Server\reports\github-pat-live-ci-verification.json',
  [Security.SecureString]$GitHubPatSecure = $null,
  [switch]$VerifyExistingOnly,
  [switch]$SkipLiveCiTrigger,
  [int]$PollIntervalSeconds = 15,
  [int]$TimeoutMinutes = 30,
  [switch]$SandboxMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentAdminName = $currentIdentity.Name

$normalizedBranch = ($SourceBranch -replace '^refs/heads/', '').Trim()
if ([string]::IsNullOrWhiteSpace($normalizedBranch) -or ($normalizedBranch.ToLowerInvariant() -in @('main', 'master'))) {
  throw "FORBIDDEN_MAIN_BRANCH_PUSH: Verify-GitHubPatAndLiveCi.ps1 is strictly forbidden from pushing to '$SourceBranch'. Only DEV branches (default: 'anty/dev-complete-rc') are permitted during PAT and CI verification."
}

if ((-not $SandboxMode) -and $PSBoundParameters.ContainsKey('GitHubPatSecure')) {
  throw 'SECURITY_VIOLATION_CLI_PAT_FORBIDDEN: Passing GitHub PAT via command-line parameters is forbidden outside SandboxMode. Run this script without -GitHubPatSecure and paste the PAT at the masked Read-Host -AsSecureString prompt.'
}
if (-not $SandboxMode) {
  if ($GitHubApiBaseUrl.Trim().TrimEnd('/').ToLowerInvariant() -ne 'https://api.github.com') {
    throw 'REJECTED_NON_OFFICIAL_GITHUB_API: Only https://api.github.com is permitted.'
  }
  $GitHubApiBaseUrl = 'https://api.github.com'
}

# 1. HARDEN GIT CREDENTIAL HELPER (DISABLE SYSTEM-LEVEL PLAINTEXT 'store', ENFORCE 'manager' / WINCRED ONLY)
git config --global --replace-all credential.helper '""'
git config --global --add credential.helper manager
foreach ($plainCredFile in @(
  "$env:USERPROFILE\.git-credentials",
  "$env:USERPROFILE\.config\git\credentials",
  'C:\HoaiPhuong-Server\config\test-secrets\github-ci-token.txt',
  'C:\HoaiPhuong-Server\config\release-gate\github-ci-token.txt'
)) {
  if (Test-Path -LiteralPath $plainCredFile -PathType Leaf) {
    Remove-Item -LiteralPath $plainCredFile -Force -ErrorAction SilentlyContinue
  }
}

$dpapiParent = Split-Path -Path $DpapiTokenPath -Parent
if (-not (Test-Path -LiteralPath $dpapiParent)) {
  New-Item -ItemType Directory -Path $dpapiParent -Force | Out-Null
}

# 2. ACQUIRE OR LOAD DPAPI-ENCRYPTED GITHUB PAT
$effectiveSecurePat = $GitHubPatSecure
if ($null -eq $effectiveSecurePat) {
  if ((Test-Path -LiteralPath $DpapiTokenPath -PathType Leaf) -and $VerifyExistingOnly) {
    $existingCipher = (Get-Content -LiteralPath $DpapiTokenPath -Raw -ErrorAction Stop).Trim()
    $effectiveSecurePat = ConvertTo-SecureString -String $existingCipher -ErrorAction Stop
  } elseif (-not $VerifyExistingOnly) {
    Write-Host ''
    Write-Host '=== STEP 1: ONE-TIME GITHUB FINE-GRAINED PAT INPUT (MASKED, DPAPI & WINCRED) ==='
    Write-Host "    Repository : $RepoSlug (Private)"
    Write-Host '    Permissions: Contents (Read and write), Actions (Read and write), Metadata (Read-only)'
    Write-Host '    Security   : Never passed via CLI args, never stored in plaintext, never printed to logs.'
    $prompted = Read-Host -Prompt 'Paste GitHub Fine-Grained PAT here (or press Enter if already saved in DPAPI)' -AsSecureString
    if ($null -ne $prompted -and $prompted.Length -gt 0) {
      $effectiveSecurePat = $prompted
    } elseif (Test-Path -LiteralPath $DpapiTokenPath -PathType Leaf) {
      $existingCipher = (Get-Content -LiteralPath $DpapiTokenPath -Raw -ErrorAction Stop).Trim()
      $effectiveSecurePat = ConvertTo-SecureString -String $existingCipher -ErrorAction Stop
    }
  }
}

if ($null -eq $effectiveSecurePat -or $effectiveSecurePat.Length -eq 0) {
  throw "MISSING_GITHUB_PAT: No GitHub PAT found at '$DpapiTokenPath'. Run Verify-GitHubPatAndLiveCi.ps1 interactively and paste the PAT at the masked prompt."
}

$bstr = [IntPtr]::Zero
try {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($effectiveSecurePat)
  $plainPat = ([Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)).Trim()
  if ([string]::IsNullOrWhiteSpace($plainPat)) {
    throw 'EMPTY_GITHUB_PAT: Decrypted PAT is empty.'
  }

  # 3. SAVE DPAPI CIPHERTEXT & VERIFY DPAPI + GIT CREDENTIAL MANAGER UNDER CURRENT WINDOWS ACCOUNT
  if (-not (Test-Path -LiteralPath $DpapiTokenPath -PathType Leaf) -or -not $VerifyExistingOnly) {
    $dpapiCipher = $effectiveSecurePat | ConvertFrom-SecureString
    if (Test-Path -LiteralPath $DpapiTokenPath -PathType Leaf) {
      & icacls.exe $DpapiTokenPath /grant:r "${currentAdminName}:F" | Out-Null
    }
    Set-Content -LiteralPath $DpapiTokenPath -Value $dpapiCipher -NoNewline -Encoding UTF8 -Force
    & icacls.exe $DpapiTokenPath /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "${currentAdminName}:RX" "*S-1-3-4:RX" /deny "*S-1-5-19:F" "*S-1-5-20:F" | Out-Null
  }

  # Verify DPAPI file on disk is encrypted blob (starts with 01000000d08c9ddf) and never contains plaintext
  $rawDiskDpapi = (Get-Content -LiteralPath $DpapiTokenPath -Raw).Trim()
  if ($rawDiskDpapi -notmatch '^01000000d08c9ddf' -or $rawDiskDpapi.Contains($plainPat)) {
    Remove-Item -LiteralPath $DpapiTokenPath -Force -ErrorAction SilentlyContinue
    throw 'DPAPI_VERIFICATION_FAILED: File on disk is not a valid Windows DPAPI encrypted blob.'
  }

  # Verify DPAPI round-trip decryption under current Windows account
  $roundTripSec = ConvertTo-SecureString -String $rawDiskDpapi -ErrorAction Stop
  $rtBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($roundTripSec)
  try {
    $roundTripPlain = ([Runtime.InteropServices.Marshal]::PtrToStringAuto($rtBstr)).Trim()
    if ($roundTripPlain -ne $plainPat) {
      throw 'DPAPI_ROUNDTRIP_MISMATCH: Decrypted DPAPI token did not match original SecureString.'
    }
  } finally {
    if ($rtBstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($rtBstr)
    }
  }

  # Register & verify Git Credential Manager (WinCred) without creating plaintext ~/.git-credentials
  $credHost = if ($SandboxMode) { 'sandbox-github-gcm-verify.example.invalid' } else { 'github.com' }
  $env:GCM_INTERACTIVE = 'never'
  $env:GIT_TERMINAL_PROMPT = '0'
  $env:GCM_CREDENTIAL_STORE = 'wincredman'
  if ($SandboxMode) {
    $env:GCM_PROVIDER = 'generic'
  }
  $approveInput = "protocol=https`nhost=$credHost`nusername=x-access-token`npassword=$plainPat`n`n"
  $fillInput = "protocol=https`nhost=$credHost`nusername=x-access-token`n`n"
  $prevEap = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    if (-not $SandboxMode) {
      git config --global credential.helper manager 2>$null
      git config --global "credential.https://$credHost.username" x-access-token 2>$null
    }
    $approveInput | git -c credential.helper= -c credential.helper=manager credential approve 2>$null
  } finally {
    $ErrorActionPreference = $prevEap
  }

  $plainCredCreated = (Test-Path -LiteralPath "$env:USERPROFILE\.git-credentials") -or (Test-Path -LiteralPath "$env:USERPROFILE\.config\git\credentials")
  if ($plainCredCreated) {
    Remove-Item -LiteralPath "$env:USERPROFILE\.git-credentials" -Force -ErrorAction SilentlyContinue
    throw 'GCM_PLAINTEXT_LEAK_DETECTED: Plaintext .git-credentials file was created! Aborting.'
  }

  $prevEap = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $fillLines = @($fillInput | git -c credential.helper= -c credential.helper=manager credential fill 2>$null)
    if ($SandboxMode) {
      $approveInput | git -c credential.helper= -c credential.helper=manager credential reject 2>$null
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }
  $gcmRetrievedOk = (($fillLines -join "`n") -match 'password=.+')
  if (-not $gcmRetrievedOk) {
    throw "GCM_VERIFICATION_FAILED: Git Credential Manager failed to retrieve credential for host '$credHost' under account '$currentAdminName'."
  }
  Write-Host "[PASS] Condition 2 Verified: Windows DPAPI & Git Credential Manager round-trip succeeded for account '$currentAdminName' (PlaintextFile=False, TokenPrinted=False)."

  # 4. VERIFY REAL GITHUB API AUTHENTICATION, MINIMUM PERMISSIONS & WORKFLOW ACCESS
  $apiBase = $GitHubApiBaseUrl.Trim().TrimEnd('/')
  $headers = @{
    'Authorization'        = "Bearer $plainPat"
    'Accept'               = 'application/vnd.github+json'
    'User-Agent'           = 'ManagementLite-PatLiveVerifier'
    'X-GitHub-Api-Version' = '2022-11-28'
  }

  $repoResp = Invoke-WebRequest -Uri "$apiBase/repos/$RepoSlug" -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 15
  $oauthScopes = if ($repoResp.Headers -and $repoResp.Headers['X-OAuth-Scopes']) { [string]$repoResp.Headers['X-OAuth-Scopes'] } else { '' }
  if (-not [string]::IsNullOrWhiteSpace($oauthScopes)) {
    $scopes = @($oauthScopes -split ',' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
    $forbidden = @('delete_repo', 'admin:org', 'admin:public_key', 'admin:repo_hook', 'admin:org_hook', 'admin:gpg_key', 'admin:enterprise', 'site_admin', 'user', 'delete:packages', 'codespace')
    $excessive = @($scopes | Where-Object { $forbidden -contains $_ })
    if ($excessive.Count -gt 0) {
      throw "GITHUB_PAT_EXCESSIVE_PERMISSIONS: Token contains forbidden excessive scopes ($($excessive -join ', '))."
    }
  }
  $repoObj = $repoResp.Content | ConvertFrom-Json
  if ((-not $repoObj.permissions) -or (-not [bool]$repoObj.permissions.push)) {
    throw "GITHUB_PAT_INSUFFICIENT_PUSH_PERMISSION: Token lacks Contents Read & Write (push) permission on '$RepoSlug'."
  }

  $wfResp = Invoke-WebRequest -Uri "$apiBase/repos/$RepoSlug/actions/workflows/$WorkflowFile" -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 15
  $wfObj = $wfResp.Content | ConvertFrom-Json
  if ($wfResp.StatusCode -ne 200 -or $wfObj.state -ne 'active') {
    throw "GITHUB_WORKFLOW_INACTIVE_OR_INACCESSIBLE: Workflow '$WorkflowFile' state is '$($wfObj.state)'."
  }

  $artListResp = Invoke-WebRequest -Uri "$apiBase/repos/$RepoSlug/actions/artifacts?per_page=1" -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 15
  if ($artListResp.StatusCode -ne 200) {
    throw "GITHUB_PAT_INSUFFICIENT_ARTIFACTS_PERMISSION: Cannot list artifacts on '$RepoSlug'."
  }

  Write-Host "[PASS] GitHub PAT Auth & Minimum Scope Verified: Repo=$($repoObj.full_name) (Private=$($repoObj.private), Push=$($repoObj.permissions.push)), Workflow='$($wfObj.name)' ($($wfObj.state))."

  # 5. PUSH DEV COMMIT TO DEV BRANCH ONLY (NEVER main), RUN REAL GITHUB ACTIONS CI, READ RESULT & DOWNLOAD VALID ARTIFACT
  if ([string]::IsNullOrWhiteSpace($CommitSha)) {
    $CommitSha = (git -C $DevRepoDir rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
  } else {
    $CommitSha = $CommitSha.Trim().ToLowerInvariant()
  }
  if ($CommitSha -notmatch '^[0-9a-f]{40}$') {
    throw "INVALID_COMMIT_SHA: CommitSha '$CommitSha' must be a 40-character hexadecimal Git SHA."
  }

  $ciResultSummary = $null
  if (-not $SkipLiveCiTrigger) {
    if (-not $SandboxMode) {
      Write-Host "[CI] Pushing DEV commit $CommitSha exclusively to DEV branch origin/$normalizedBranch via Git Credential Manager (origin/main is untouched)..."
      $prevEapPush = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        git -C $DevRepoDir push origin "${CommitSha}:refs/heads/$normalizedBranch"
        $pushExit = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $prevEapPush
      }
      if ($pushExit -ne 0) {
        throw "GIT_PUSH_FAILED: Failed to push $CommitSha to origin/$normalizedBranch via Git Credential Manager."
      }
      Start-Sleep -Seconds 5
    }

    $runsUrl = "$apiBase/repos/$RepoSlug/actions/workflows/$WorkflowFile/runs?head_sha=$CommitSha&per_page=10"
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    $completedRun = $null
    while ((Get-Date) -lt $deadline) {
      $pollRuns = Invoke-RestMethod -Uri $runsUrl -Headers $headers -Method Get -TimeoutSec 15
      $candidate = @($pollRuns.workflow_runs | Where-Object {
        $_.head_sha -eq $CommitSha -and (
          [string]::IsNullOrWhiteSpace([string]$_.head_branch) -or $_.head_branch -eq $normalizedBranch
        )
      }) | Select-Object -First 1
      if ($candidate) {
        if ($candidate.status -eq 'completed') {
          if ($candidate.conclusion -ne 'success') {
            throw "GITHUB_CI_RUN_FAILED: Run $($candidate.id) finished with conclusion '$($candidate.conclusion)' ($($candidate.html_url))."
          }
          $completedRun = $candidate
          break
        }
        Write-Host "[CI] Waiting for real GitHub Actions run $($candidate.id) on branch '$normalizedBranch' (status=$($candidate.status))..."
      } else {
        Write-Host "[CI] Waiting for GitHub Actions to register run for commit $CommitSha on branch '$normalizedBranch'..."
      }
      Start-Sleep -Seconds $PollIntervalSeconds
    }
    if (-not $completedRun) {
      throw "GITHUB_CI_TIMEOUT: Timed out waiting for GitHub Actions run for $CommitSha on branch '$normalizedBranch'."
    }

    $runId = [string]$completedRun.id
    $artifactsResp = Invoke-RestMethod -Uri "$apiBase/repos/$RepoSlug/actions/runs/$runId/artifacts" -Headers $headers -Method Get -TimeoutSec 15
    $expectedArtifactName = "management-lite-release-$CommitSha"
    $artifactMeta = @($artifactsResp.artifacts | Where-Object { $_.name -eq $expectedArtifactName -and (-not $_.expired) }) | Select-Object -First 1
    if (-not $artifactMeta) {
      throw "GITHUB_ARTIFACT_MISSING: Artifact '$expectedArtifactName' not found on run $runId."
    }

    $dlDir = if ($SandboxMode) {
      Join-Path ([IO.Path]::GetTempPath()) "ml-pat-ci-verify-$CommitSha"
    } else {
      "C:\HoaiPhuong-Server\releases\management-lite\artifacts\$CommitSha"
    }
    if (Test-Path -LiteralPath $dlDir) {
      Remove-Item -LiteralPath $dlDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $dlDir -Force | Out-Null
    $zipPath = Join-Path $dlDir "$expectedArtifactName.zip"
    Invoke-WebRequest -Uri $artifactMeta.archive_download_url -Headers $headers -OutFile $zipPath -UseBasicParsing -TimeoutSec 120

    $actualZipSha = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if (($artifactMeta.PSObject.Properties.Name -contains 'digest') -and (-not [string]::IsNullOrWhiteSpace([string]$artifactMeta.digest))) {
      $expectedZipSha = ([string]$artifactMeta.digest -replace '^sha256:', '').Trim().ToLowerInvariant()
      if ($expectedZipSha -match '^[0-9a-f]{64}$' -and $actualZipSha -ne $expectedZipSha) {
        throw "GITHUB_ARTIFACT_DIGEST_MISMATCH: Downloaded ZIP SHA-256 ($actualZipSha) != GitHub digest ($expectedZipSha)."
      }
    }

    Expand-Archive -LiteralPath $zipPath -DestinationPath $dlDir -Force
    Remove-Item -LiteralPath $zipPath -Force

    $bundleTar = Join-Path $dlDir "management-lite-full-$CommitSha.tar.gz"
    $shaFile = Join-Path $dlDir "management-lite-full-$CommitSha.tar.gz.sha256"
    $receiptFile = Join-Path $dlDir "ci-run-receipt-$CommitSha.json"
    if (-not (Test-Path -LiteralPath $bundleTar -PathType Leaf) -or
        -not (Test-Path -LiteralPath $shaFile -PathType Leaf) -or
        -not (Test-Path -LiteralPath $receiptFile -PathType Leaf)) {
      throw "GITHUB_ARTIFACT_INCOMPLETE: Missing tar.gz, .sha256, or ci-run-receipt-$CommitSha.json in downloaded artifact."
    }

    $expectedTarSha = ((Get-Content -LiteralPath $shaFile -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actualTarSha = (Get-FileHash -LiteralPath $bundleTar -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualTarSha -ne $expectedTarSha) {
      throw "GITHUB_BUNDLE_TAR_SHA_MISMATCH: Actual tar.gz SHA-256 ($actualTarSha) != .sha256 file ($expectedTarSha)."
    }

    $receiptObj = Get-Content -LiteralPath $receiptFile -Raw | ConvertFrom-Json
    if (([string]$receiptObj.head_sha).Trim().ToLowerInvariant() -ne $CommitSha) {
      throw "GITHUB_RECEIPT_SHA_MISMATCH: Receipt head_sha ($($receiptObj.head_sha)) != requested CommitSha ($CommitSha)."
    }
    $ciResultSummary = [ordered]@{
      run_id            = $runId
      html_url          = [string]$completedRun.html_url
      head_sha          = [string]$completedRun.head_sha
      head_branch       = $normalizedBranch
      status            = [string]$completedRun.status
      conclusion        = [string]$completedRun.conclusion
      artifact_name     = $expectedArtifactName
      artifact_zip_sha  = $actualZipSha
      bundle_tar_sha256 = $actualTarSha
      schema_sha256     = [string]$receiptObj.schema_sha256
      artifact_dir      = $dlDir
    }
    Write-Host "[PASS] Condition 1 Verified: Real GitHub Actions Run $runId on DEV branch '$normalizedBranch' PASSED and valid artifact downloaded & verified (Bundle SHA256=$actualTarSha)."
  }

  $reportDir = Split-Path -Path $ReportOutPath -Parent
  if (-not (Test-Path -LiteralPath $reportDir)) {
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
  }
  $verificationReport = [ordered]@{
    verified_at_utc          = (Get-Date).ToUniversalTime().ToString('o')
    windows_account          = $currentAdminName
    target_dev_branch        = $normalizedBranch
    main_branch_pushed       = $false
    dpapi_token_path         = $DpapiTokenPath
    dpapi_blob_verified      = $true
    gcm_wincred_verified     = $true
    plaintext_cred_exists    = $false
    token_logged_or_printed  = $false
    repository               = [string]$repoObj.full_name
    private_repository       = [bool]$repoObj.private
    push_permission          = [bool]$repoObj.permissions.push
    workflow_name            = [string]$wfObj.name
    workflow_state           = [string]$wfObj.state
    live_ci_and_artifact     = $ciResultSummary
  }
  $verificationReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReportOutPath -Encoding UTF8 -Force
  Write-Host "[OK] Saved sanitized PAT & Live CI verification report to: $ReportOutPath"
} finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
