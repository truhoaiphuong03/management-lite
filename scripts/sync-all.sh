#!/usr/bin/env bash
# Dùng: sync-all.sh start  (trước khi làm việc: pull)  |  sync-all.sh end  (sau khi làm: commit+push)
ROOT="${PROJECTS_DIR:-$HOME/Projects}"
REPOS="management-lite tiktok-ai-factory tiktok-ai-factory-v4 video-automation-v1"
BASE="https://github.com/truhoaiphuong03"
MODE="${1:-start}"
for r in $REPOS; do
  echo "=== $r"
  [ -d "$ROOT/$r/.git" ] || { git clone "$BASE/$r.git" "$ROOT/$r" || continue; }
  cd "$ROOT/$r" || continue
  git fetch --all --prune -q
  if [ "$MODE" = "start" ]; then
    if [ -n "$(git status --porcelain)" ]; then echo "!! Có thay đổi chưa commit -> DỪNG, hãy commit/stash trước"; continue; fi
    git pull --ff-only || echo "!! Không ff được (nhánh phân kỳ) -> xử lý tay"
  else
    if [ -n "$(git status --porcelain)" ]; then git add -A && git commit -m "sync: $(hostname) $(date +%F_%H:%M)"; fi
    git pull --rebase --autostash && git push
  fi
  git status -sb | head -1
done
