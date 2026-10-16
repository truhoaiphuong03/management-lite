#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$CommitSha = '',
  [string]$RepoSlug = 'truhoaiphuong03/management-lite',
  [string]$WorkflowFile = 'deploy.yml',
  [string]$SourceBranch = 'main',
  [string]$GitHubApiBaseUrl = 'https://api.github.com',
  [string]$ServerRoot = 'C:\HoaiPhuong-Server',
  [string]$TargetDir = 'C:\HoaiPhuong-Server\apps\management-lite',
  [string]$PolicyPath = 'C:\HoaiPhuong-Server\config\release-gate\release-gate-policy.json',
  [string]$ApprovalManifestPath = 'C:\HoaiPhuong-Server\config\release-gate\approved-release.json',
  [int]$PollIntervalSeconds = 15,
  [int]$TimeoutMinutes = 30,
  [switch]$SkipMigration = $true,
  [switch]$RunMigrations,
  [switch]$SandboxMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($RunMigrations) {
  $SkipMigration = $false
}

if ([string]::IsNullOrWhiteSpace($CommitSha)) {
  $CommitSha = (git rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
} else {
  $CommitSha = $CommitSha.Trim().ToLowerInvariant()
}

if ($CommitSha -notmatch '^[0-9a-f]{40}$') {
  throw "Invalid CommitSha '$CommitSha'. Must be a 40-character lowercase hexadecimal Git SHA."
}

if (-not $SandboxMode) {
  if ($GitHubApiBaseUrl.Trim().TrimEnd('/').ToLowerInvariant() -ne 'https://api.github.com') {
    throw "REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION: Only https://api.github.com is permitted in production."
  }
  $GitHubApiBaseUrl = 'https://api.github.com'
}

# 1. RESOLVE DPAPI-PROTECTED GITHUB API TOKEN
$ghToken = $env:GITHUB_READONLY_TOKEN
if ([string]::IsNullOrWhiteSpace($ghToken)) {
  $ghToken = $env:GITHUB_TOKEN
}
if ([string]::IsNullOrWhiteSpace($ghToken)) {
  foreach ($dpapiCandidate in @(
    (Join-Path (Split-Path -Path $PolicyPath -Parent) 'github-pat.dpapi'),
    'C:\HoaiPhuong-Server\config\release-gate\github-pat.dpapi'
  )) {
    if ($dpapiCandidate -and (Test-Path -LiteralPath $dpapiCandidate -PathType Leaf)) {
      $bstr = [IntPtr]::Zero
      try {
        $cipherText = (Get-Content -LiteralPath $dpapiCandidate -Raw -ErrorAction SilentlyContinue).Trim()
        if (-not [string]::IsNullOrWhiteSpace($cipherText)) {
          $secStr = ConvertTo-SecureString -String $cipherText -ErrorAction Stop
          $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secStr)
          $val = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
          if (-not [string]::IsNullOrWhiteSpace($val)) {
            $ghToken = $val.Trim()
            break
          }
        }
      } catch {
        # Ignore decryption failure and fail closed below
      } finally {
        if ($bstr -ne [IntPtr]::Zero) {
          [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
      }
    }
  }
}

if ([string]::IsNullOrWhiteSpace($ghToken)) {
  throw 'MISSING_GITHUB_CI_TOKEN: No DPAPI-protected GitHub PAT found at config\release-gate\github-pat.dpapi. Enter a valid GitHub Fine-Grained PAT once via Read-Host -AsSecureString during Invoke-OwnerP0Setup.ps1.'
}

$headers = @{
  'Authorization'        = "Bearer $ghToken"
  'Accept'               = 'application/vnd.github+json'
  'User-Agent'           = 'ManagementLite-ScopedAutoDeploy'
  'X-GitHub-Api-Version' = '2022-11-28'
}

$apiBase = $GitHubApiBaseUrl.Trim().TrimEnd('/')

# 1B. VERIFY MINIMUM PAT PERMISSIONS (PUSH + ACTIONS + ARTIFACTS, NO EXCESSIVE SCOPES)
$repoCheckResp = Invoke-WebRequest -Uri "$apiBase/repos/$RepoSlug" -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 15
$oauthScopesHeader = if ($repoCheckResp.Headers -and $repoCheckResp.Headers['X-OAuth-Scopes']) { [string]$repoCheckResp.Headers['X-OAuth-Scopes'] } else { '' }
if (-not [string]::IsNullOrWhiteSpace($oauthScopesHeader)) {
  $scopeList = @($oauthScopesHeader -split ',' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
  $forbiddenScopes = @('delete_repo', 'admin:org', 'admin:public_key', 'admin:repo_hook', 'admin:org_hook', 'admin:gpg_key', 'admin:enterprise', 'site_admin', 'user', 'delete:packages', 'codespace')
  $excessiveFound = @($scopeList | Where-Object { $forbiddenScopes -contains $_ })
  if ($excessiveFound.Count -gt 0) {
    throw "GITHUB_PAT_EXCESSIVE_PERMISSIONS: Token contains forbidden excessive scopes ($($excessiveFound -join ', ')). Use a Fine-Grained PAT scoped strictly to $RepoSlug (Contents: Read & Write, Actions: Read & Write)."
  }
}
$repoMeta = $repoCheckResp.Content | ConvertFrom-Json
if ((-not $repoMeta.permissions) -or (-not [bool]$repoMeta.permissions.push)) {
  throw "GITHUB_PAT_INSUFFICIENT_PUSH_PERMISSION: Token lacks Contents Read & Write (push) permission on $RepoSlug."
}
$wfCheckResp = Invoke-WebRequest -Uri "$apiBase/repos/$RepoSlug/actions/workflows/$WorkflowFile" -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 15
if ($wfCheckResp.StatusCode -ne 200) {
  throw "GITHUB_PAT_INSUFFICIENT_ACTIONS_PERMISSION: Token cannot read workflow '$WorkflowFile' on $RepoSlug."
}
$artListCheckResp = Invoke-WebRequest -Uri "$apiBase/repos/$RepoSlug/actions/artifacts?per_page=1" -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 15
if ($artListCheckResp.StatusCode -ne 200) {
  throw "GITHUB_PAT_INSUFFICIENT_ARTIFACTS_PERMISSION: Token cannot list/download Actions artifacts on $RepoSlug."
}

# 2. DISCOVER OR TRIGGER WORKFLOW_DISPATCH RUN ON OFFICIAL GITHUB ACTIONS
$runsListUrl = "$apiBase/repos/$RepoSlug/actions/workflows/$WorkflowFile/runs?branch=$SourceBranch&per_page=10"
$existingRunsResp = Invoke-RestMethod -Uri $runsListUrl -Headers $headers -Method Get -TimeoutSec 15
$matchingRun = @($existingRunsResp.workflow_runs | Where-Object {
  $_.head_sha -eq $CommitSha -and $_.event -eq 'workflow_dispatch' -and (
    $_.status -ne 'completed' -or $_.conclusion -eq 'success'
  )
}) | Select-Object -First 1

if (-not $matchingRun) {
  Write-Host "[CI] Triggering GitHub Actions workflow '$WorkflowFile' for commit $CommitSha on branch '$SourceBranch'..."
  $dispatchUrl = "$apiBase/repos/$RepoSlug/actions/workflows/$WorkflowFile/dispatches"
  $dispatchBody = @{
    ref    = $SourceBranch
    inputs = @{
      commit_sha = $CommitSha
    }
  } | ConvertTo-Json -Depth 4
  Invoke-RestMethod -Uri $dispatchUrl -Headers $headers -Method Post -Body $dispatchBody -ContentType 'application/json' -TimeoutSec 15 | Out-Null
  Start-Sleep -Seconds 5
}

# 3. WAIT FOR REAL GITHUB ACTIONS CI COMPLETION
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$completedRun = $null
while ((Get-Date) -lt $deadline) {
  $pollResp = Invoke-RestMethod -Uri $runsListUrl -Headers $headers -Method Get -TimeoutSec 15
  $candidateRun = @($pollResp.workflow_runs | Where-Object { $_.head_sha -eq $CommitSha -and $_.event -eq 'workflow_dispatch' }) | Select-Object -First 1
  if ($candidateRun) {
    if ($candidateRun.status -eq 'completed') {
      if ($candidateRun.conclusion -ne 'success') {
        throw "GITHUB_CI_FAILED: Workflow run $($candidateRun.id) for $CommitSha finished with conclusion '$($candidateRun.conclusion)' ($($candidateRun.html_url))."
      }
      $completedRun = $candidateRun
      break
    }
    Write-Host "[CI] Waiting for GitHub Actions run $($candidateRun.id) (status=$($candidateRun.status))..."
  } else {
    Write-Host "[CI] Waiting for GitHub Actions run for $CommitSha to appear..."
  }
  Start-Sleep -Seconds $PollIntervalSeconds
}

if (-not $completedRun) {
  throw "GITHUB_CI_TIMEOUT: Timed out after $TimeoutMinutes minutes waiting for GitHub Actions run for $CommitSha."
}

$runId = [string]$completedRun.id
Write-Host "[CI] GitHub Actions Run $runId PASSED ($($completedRun.html_url)). Downloading immutable artifact bundle..."

# 4. DOWNLOAD & VERIFY ARTIFACT BUNDLE FROM OFFICIAL GITHUB API
$artifactsUrl = "$apiBase/repos/$RepoSlug/actions/runs/$runId/artifacts"
$artifactsResp = Invoke-RestMethod -Uri $artifactsUrl -Headers $headers -Method Get -TimeoutSec 15
$expectedArtifactName = "management-lite-release-$CommitSha"
$artifactMeta = @($artifactsResp.artifacts | Where-Object { $_.name -eq $expectedArtifactName -and (-not $_.expired) }) | Select-Object -First 1
if (-not $artifactMeta) {
  throw "GITHUB_ARTIFACT_MISSING: Artifact '$expectedArtifactName' not found or expired on GitHub Actions run $runId."
}

$artifactDir = Join-Path $ServerRoot "releases\management-lite\artifacts\$CommitSha"
if (Test-Path -LiteralPath $artifactDir) {
  Remove-Item -LiteralPath $artifactDir -Recurse -Force
}
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null

$zipPath = Join-Path $artifactDir "$expectedArtifactName.zip"
Invoke-WebRequest -Uri $artifactMeta.archive_download_url -Headers $headers -OutFile $zipPath -UseBasicParsing -TimeoutSec 120

if (($artifactMeta.PSObject.Properties.Name -contains 'digest') -and (-not [string]::IsNullOrWhiteSpace([string]$artifactMeta.digest))) {
  $expectedZipDigest = ([string]$artifactMeta.digest -replace '^sha256:', '').Trim().ToLowerInvariant()
  $actualZipDigest = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expectedZipDigest -match '^[0-9a-f]{64}$' -and $actualZipDigest -ne $expectedZipDigest) {
    throw "GITHUB_ARTIFACT_DIGEST_MISMATCH: Downloaded ZIP SHA-256 ($actualZipDigest) does not match GitHub API digest ($expectedZipDigest)."
  }
}

Expand-Archive -LiteralPath $zipPath -DestinationPath $artifactDir -Force
Remove-Item -LiteralPath $zipPath -Force

$bundleTar = Join-Path $artifactDir "management-lite-full-$CommitSha.tar.gz"
$shaFile = Join-Path $artifactDir "management-lite-full-$CommitSha.tar.gz.sha256"
$receiptFile = Join-Path $artifactDir "ci-run-receipt-$CommitSha.json"

if (-not (Test-Path -LiteralPath $bundleTar -PathType Leaf) -or
    -not (Test-Path -LiteralPath $shaFile -PathType Leaf) -or
    -not (Test-Path -LiteralPath $receiptFile -PathType Leaf)) {
  throw "GITHUB_ARTIFACT_INCOMPLETE: Extracted artifact bundle in $artifactDir is missing tar.gz, .sha256, or ci-run-receipt-$CommitSha.json."
}

$bundleSha256 = ((Get-Content -LiteralPath $shaFile -Raw).Trim() -split '\s+')[0].ToLowerInvariant()

# 5. INVOKE IMMUTABLE LOCKED RELEASE CONTROLLER UNDER SCOPED_WINDOW
$lockedController = Join-Path (Split-Path -Path $PolicyPath -Parent) 'controllers\Deploy-SemiAutoWindows.ps1'
$controllerToRun = if (Test-Path -LiteralPath $lockedController -PathType Leaf) {
  $lockedController
} else {
  Join-Path $PSScriptRoot 'Deploy-SemiAutoWindows.ps1'
}

$env:GITHUB_READONLY_TOKEN = $ghToken
& $controllerToRun `
  -CommitSha $CommitSha `
  -CiRunId $runId `
  -ArtifactPath $bundleTar `
  -ArtifactSha256 $bundleSha256 `
  -CiRunReceiptPath $receiptFile `
  -GitHubApiBaseUrl $GitHubApiBaseUrl `
  -PolicyPath $PolicyPath `
  -ApprovalManifestPath $ApprovalManifestPath `
  -ServerRoot $ServerRoot `
  -TargetDir $TargetDir `
  -SkipMigration:$SkipMigration `
  -SandboxMode:$SandboxMode
