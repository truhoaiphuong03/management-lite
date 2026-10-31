/**
 * Responsive tables: trên màn hình hẹp (<= 768px) mỗi dòng bảng hiển thị dạng thẻ
 * (nhãn cột lấy từ <thead>), thay vì bắt người dùng cuộn ngang.
 * CSS tương ứng nằm ở `.rt-cards` trong packages/ui/src/tokens.css.
 * Bảng nhiều cột (ma trận/bảng công) hoặc có `data-no-cards` giữ nguyên kiểu cuộn ngang.
 */
export const RESPONSIVE_TABLE_MAX_COLUMNS = 8;

export function enhanceTables(root: ParentNode): void {
  root.querySelectorAll('table').forEach((table) => {
    if (table.hasAttribute('data-no-cards')) return;
    const heads = Array.from(table.querySelectorAll('thead th')).map((th) =>
      (th.textContent ?? '').trim(),
    );
    if (heads.length === 0 || heads.length > RESPONSIVE_TABLE_MAX_COLUMNS) {
      return;
    }
    table.classList.add('rt-cards');
    table.querySelectorAll('tbody tr').forEach((tr) => {
      let col = 0;
      Array.from(tr.children).forEach((cell) => {
        if (cell.tagName !== 'TD') return;
        const span = Number(cell.getAttribute('colspan') ?? 1);
        if (span > 1) {
          cell.setAttribute('data-colspan', 'true');
          col += span;
          return;
        }
        const label = heads[col] ?? '';
        if (cell.getAttribute('data-label') !== label) {
          cell.setAttribute('data-label', label);
        }
        const rawText = (cell.textContent ?? '').trim();
        const isEmptyPlaceholder =
          col > 0 &&
          !cell.querySelector('button, a, input, select') &&
          (rawText === '' ||
            rawText === '—' ||
            rawText === '--' ||
            rawText === '-' ||
            rawText === 'Chưa gán' ||
            rawText === 'Chưa phân nhóm' ||
            rawText === 'Không có');
        if (isEmptyPlaceholder) {
          cell.setAttribute('data-empty', 'true');
        } else {
          cell.removeAttribute('data-empty');
        }
        col += 1;
      });
    });
  });
}

export function enableResponsiveTables(root: HTMLElement | null): () => void {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhanceTables(root);
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  schedule();
  return () => observer.disconnect();
}
