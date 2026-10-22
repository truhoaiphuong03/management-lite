# Dùng: .\sync-all.ps1 start | end   (Windows)
param([string]$Mode = "start")
$Root = if ($env:PROJECTS_DIR) { $env:PROJECTS_DIR } else { "$HOME\Projects" }
$Base = "https://github.com/truhoaiphuong03"
foreach ($r in "management-lite","tiktok-ai-factory","tiktok-ai-factory-v4","video-automation-v1") {
  Write-Host "=== $r"
  if (-not (Test-Path "$Root\$r\.git")) { git clone "$Base/$r.git" "$Root\$r"; if ($LASTEXITCODE) { continue } }
  Set-Location "$Root\$r"
  git fetch --all --prune -q
  $dirty = git status --porcelain
  if ($Mode -eq "start") {
    if ($dirty) { Write-Host "!! Co thay doi chua commit -> DUNG"; continue }
    git pull --ff-only
  } else {
    if ($dirty) { git add -A; git commit -m "sync: $env:COMPUTERNAME $(Get-Date -Format 'yyyy-MM-dd_HH:mm')" }
    git pull --rebase --autostash; git push
  }
  git status -sb | Select-Object -First 1
}
