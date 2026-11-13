#!/usr/bin/env bash
# ==============================================================================
# Safe MacBook DEV Workspace & Worktree Cleanup Utility (management-lite)
# ------------------------------------------------------------------------------
# Mặc định chạy ở chế độ KIỂM TRA AN TOÀN (--dry-run): KHÔNG xóa bất kỳ tệp nào.
# Chỉ thực sự gỡ worktree đã merge sạch & dọn bộ nhớ đệm khi truyền --apply.
#
# Quy tắc bảo vệ dữ liệu tuyệt đối:
#   1. KHÔNG đụng vào thư mục repo chính (management-lite).
#   2. KHÔNG xóa bất kỳ worktree/thư mục nào còn thay đổi chưa commit (dirty).
#   3. KHÔNG xóa bất kỳ nhánh/worktree nào chưa merge vào origin/main.
#   4. KHÔNG xóa dữ liệu PostgreSQL DEV (:55499), tệp .env*, hoặc bản sao lưu.
#
# Cách dùng trên MacBook Terminal:
#   1) Xem trước danh sách thư mục có thể dọn (An toàn 100%):
#      bash scripts/ops/cleanup-macbook-dev.sh
#   2) Thực thi dọn dẹp các mục [CÓ THỂ DỌN AN TOÀN]:
#      bash scripts/ops/cleanup-macbook-dev.sh --apply
# ==============================================================================

set -euo pipefail

APPLY=0
PROJECTS_DIR="${HOME}/Projects"
MAIN_REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --dry-run)
      APPLY=0
      shift
      ;;
    --projects-dir)
      PROJECTS_DIR="$2"
      shift 2
      ;;
    --repo)
      MAIN_REPO="$2"
      shift 2
      ;;
    -h|--help)
      echo "Cách dùng: bash scripts/ops/cleanup-macbook-dev.sh [--dry-run | --apply] [--projects-dir ~/Projects]"
      exit 0
      ;;
    *)
      echo "Tham số không hợp lệ: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${MAIN_REPO}" ]]; then
  if [[ -d "${PROJECTS_DIR}/management-lite/.git" ]]; then
    MAIN_REPO="${PROJECTS_DIR}/management-lite"
  else
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    CANDIDATE_REPO="$(cd "${SCRIPT_DIR}/../.." && pwd)"
    if [[ -e "${CANDIDATE_REPO}/.git" ]]; then
      COMMON_GIT_DIR="$(git -C "${CANDIDATE_REPO}" rev-parse --git-common-dir)"
      MAIN_REPO="$(cd "${CANDIDATE_REPO}" && cd "${COMMON_GIT_DIR}/.." && pwd)"
    fi
  fi
fi

if [[ -z "${MAIN_REPO}" || ! -d "${MAIN_REPO}" ]]; then
  echo "❌ Không tìm thấy thư mục gốc management-lite trong ${PROJECTS_DIR}." >&2
  echo "   Hãy truyền rõ: bash scripts/ops/cleanup-macbook-dev.sh --projects-dir <đường-dẫn>" >&2
  exit 1
fi

MAIN_REPO="$(cd "${MAIN_REPO}" && pwd)"
PROJECTS_DIR="$(cd "$(dirname "${MAIN_REPO}")" && pwd)"

echo "======================================================================"
if [[ "${APPLY}" -eq 1 ]]; then
  echo "🧹 CHẾ ĐỘ THỰC THI (--apply) — Dọn worktree đã merge & cache trên MacBook"
else
  echo "🔍 CHẾ ĐỘ KIỂM TRA AN TOÀN (--dry-run) — Chưa xóa bất kỳ thư mục nào"
fi
echo "📂 Thư mục gốc Projects : ${PROJECTS_DIR}"
echo "🏠 Repo chính (Bảo vệ)  : ${MAIN_REPO}"
echo "======================================================================"

echo ""
echo "⏳ Đang đồng bộ tham chiếu origin/main và prune metadata worktree rỗng..."
git -C "${MAIN_REPO}" fetch origin main --quiet || true
if [[ "${APPLY}" -eq 1 ]]; then
  git -C "${MAIN_REPO}" worktree prune
fi

ORIGIN_MAIN_SHA="$(git -C "${MAIN_REPO}" rev-parse origin/main 2>/dev/null || git -C "${MAIN_REPO}" rev-parse main)"
echo "📌 Mốc chuẩn origin/main: ${ORIGIN_MAIN_SHA:0:7}"
echo ""

SAFE_COUNT=0
KEPT_COUNT=0
CLEANED_COUNT=0

echo "----------------------------------------------------------------------"
echo "1️⃣  KIỂM TRA CÁC GIT WORKTREE LIÊN KẾT VỚI MANAGEMENT-LITE"
echo "----------------------------------------------------------------------"

WT_PATHS=()
while IFS= read -r line; do
  if [[ "${line}" == worktree\ * ]]; then
    WT_PATHS+=("${line#worktree }")
  fi
done < <(git -C "${MAIN_REPO}" worktree list --porcelain)

for WT in "${WT_PATHS[@]}"; do
  if [[ ! -d "${WT}" ]]; then
    echo "  ⚪ [ĐÃ MẤT THƯ MỤC] ${WT} -> sẽ được git worktree prune làm sạch metadata"
    continue
  fi

  WT_REAL="$(cd "${WT}" && pwd)"
  SIZE_HUMAN="$(du -sh "${WT_REAL}" 2>/dev/null | awk '{print $1}' || echo '?')"

  if [[ "${WT_REAL}" == "${MAIN_REPO}" ]]; then
    echo "  🛡️  [GIỮ - REPO CHÍNH]      ${WT_REAL} (${SIZE_HUMAN})"
    KEPT_COUNT=$((KEPT_COUNT + 1))
    continue
  fi

  # Bảo vệ nếu chứa dữ liệu DB cục bộ hoặc .env riêng
  if find "${WT_REAL}" -maxdepth 2 \( -name "PG_VERSION" -o -name "*.pgdata" -o -name ".env.local" -o -name ".env.production" \) 2>/dev/null | grep -q .; then
    echo "  🛡️  [GIỮ - CÓ ENV/DB RIÊNG] ${WT_REAL} (${SIZE_HUMAN})"
    KEPT_COUNT=$((KEPT_COUNT + 1))
    continue
  fi

  DIRTY="$(git -C "${WT_REAL}" status --porcelain 2>/dev/null || echo 'ERR')"
  if [[ -n "${DIRTY}" ]]; then
    echo "  ⚠️  [GIỮ - CHƯA COMMIT]     ${WT_REAL} (${SIZE_HUMAN})"
    KEPT_COUNT=$((KEPT_COUNT + 1))
    continue
  fi

  WT_HEAD="$(git -C "${WT_REAL}" rev-parse HEAD 2>/dev/null || echo '')"
  WT_BRANCH="$(git -C "${WT_REAL}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'detached')"

  if [[ -n "${WT_HEAD}" ]] && git -C "${MAIN_REPO}" merge-base --is-ancestor "${WT_HEAD}" "${ORIGIN_MAIN_SHA}" 2>/dev/null; then
    SAFE_COUNT=$((SAFE_COUNT + 1))
    if [[ "${APPLY}" -eq 1 ]]; then
      echo "  🗑️  [ĐANG GỠ WORKTREE SẠCH] ${WT_REAL} (nhánh: ${WT_BRANCH}, ${SIZE_HUMAN})"
      git -C "${MAIN_REPO}" worktree remove "${WT_REAL}"
      if [[ "${WT_BRANCH}" != "main" && "${WT_BRANCH}" != "HEAD" && "${WT_BRANCH}" != "detached" ]]; then
        git -C "${MAIN_REPO}" branch -d "${WT_BRANCH}" >/dev/null 2>&1 || true
      fi
      CLEANED_COUNT=$((CLEANED_COUNT + 1))
    else
      echo "  ✅ [CÓ THỂ DỌN AN TOÀN]     ${WT_REAL} (nhánh: ${WT_BRANCH} đã nằm trong origin/main, ${SIZE_HUMAN})"
    fi
  else
    echo "  🔒 [GIỮ - CHƯA MERGE MAIN]  ${WT_REAL} (nhánh: ${WT_BRANCH} @ ${WT_HEAD:0:7}, ${SIZE_HUMAN})"
    KEPT_COUNT=$((KEPT_COUNT + 1))
  fi
done

echo ""
echo "----------------------------------------------------------------------"
echo "2️⃣  KIỂM TRA THƯ MỤC ANH EM (SIBLING CLONES / QA / CACHE) TRONG ${PROJECTS_DIR}"
echo "----------------------------------------------------------------------"

shopt -s nullglob
for DIR in "${PROJECTS_DIR}"/management-lite* "${PROJECTS_DIR}"/ml-* "${PROJECTS_DIR}"/printquote*; do
  [[ -d "${DIR}" ]] || continue
  DIR_REAL="$(cd "${DIR}" && pwd)"
  [[ "${DIR_REAL}" == "${MAIN_REPO}" ]] && continue

  # Bỏ qua nếu đã xử lý ở danh sách git worktree ở mục 1
  ALREADY_SEEN=0
  for WT in "${WT_PATHS[@]}"; do
    if [[ -d "${WT}" && "$(cd "${WT}" && pwd)" == "${DIR_REAL}" ]]; then
      ALREADY_SEEN=1
      break
    fi
  done
  [[ "${ALREADY_SEEN}" -eq 1 ]] && continue

  SIZE_HUMAN="$(du -sh "${DIR_REAL}" 2>/dev/null | awk '{print $1}' || echo '?')"
  echo "  📌 [THƯ MỤC ĐỘC LẬP - KIỂM TRA TAY] ${DIR_REAL} (${SIZE_HUMAN}) — không tự xóa để bảo toàn dữ liệu"
done
shopt -u nullglob

echo ""
echo "----------------------------------------------------------------------"
echo "3️⃣  BỘ NHỚ ĐỆM TẠM (.DS_Store, node_modules/.cache, .tmp)"
echo "----------------------------------------------------------------------"

DS_COUNT="$(find "${PROJECTS_DIR}" -maxdepth 4 -name ".DS_Store" 2>/dev/null | wc -l | tr -d ' ')"
echo "  • Tệp .DS_Store rác trên macOS (tối đa 4 cấp): ${DS_COUNT} tệp"

if [[ -d "${MAIN_REPO}/node_modules/.cache" ]]; then
  CACHE_SIZE="$(du -sh "${MAIN_REPO}/node_modules/.cache" 2>/dev/null | awk '{print $1}' || echo '0B')"
  echo "  • Bộ nhớ đệm build (${MAIN_REPO}/node_modules/.cache): ${CACHE_SIZE}"
else
  echo "  • Bộ nhớ đệm build (node_modules/.cache): 0B (sạch)"
fi

if [[ "${APPLY}" -eq 1 ]]; then
  find "${PROJECTS_DIR}" -maxdepth 4 -name ".DS_Store" -delete 2>/dev/null || true
  rm -rf "${MAIN_REPO}/node_modules/.cache" "${MAIN_REPO}/.tmp" 2>/dev/null || true
  git -C "${MAIN_REPO}" worktree prune
  echo "  ✅ Đã dọn sạch .DS_Store, node_modules/.cache và prune metadata worktree."
fi

echo ""
echo "======================================================================"
if [[ "${APPLY}" -eq 1 ]]; then
  echo "🎉 HOÀN TẤT: Đã gỡ an toàn ${CLEANED_COUNT} worktree đã merge, giữ nguyên ${KEPT_COUNT} thư mục quan trọng."
else
  echo "📊 TỔNG KẾT DRY-RUN: Phát hiện ${SAFE_COUNT} worktree đã merge có thể dọn an toàn, ${KEPT_COUNT} thư mục được bảo vệ."
  echo "👉 Để thực sự dọn các mục [CÓ THỂ DỌN AN TOÀN], chạy lại với cờ --apply:"
  echo "   bash scripts/ops/cleanup-macbook-dev.sh --apply"
fi
echo "======================================================================"
