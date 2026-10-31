/**
 * Gắn tên truy cập cho ô nhập/chọn chưa có nhãn liên kết (an toàn cho trình đọc màn hình):
 * 1. `<label>` đứng ngay trước ô nhập (không có `for`) → liên kết bằng `htmlFor`/`id`.
 * 2. `<select>` không nhãn → dùng chữ của mục đầu tiên (vd. "Tất cả nhóm").
 * 3. Còn lại dùng `title` / `placeholder` nếu có.
 * Không ghi đè nhãn/aria-label sẵn có.
 */
let uid = 0;

function hasAccessibleName(el: Element): boolean {
  if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) {
    return true;
  }
  if (el.closest('label')) return true;
  const id = el.getAttribute('id');
  if (id && el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)) {
    return true;
  }
  return false;
}

export function labelFormControls(root: ParentNode): void {
  root
    .querySelectorAll('input:not([type="hidden"]), select, textarea')
    .forEach((el) => {
      if (hasAccessibleName(el)) return;
      const prev = el.previousElementSibling;
      if (
        prev instanceof HTMLLabelElement &&
        !prev.htmlFor &&
        (prev.textContent ?? '').trim()
      ) {
        const id = el.getAttribute('id') || `fld-${(uid += 1)}`;
        el.setAttribute('id', id);
        prev.htmlFor = id;
        return;
      }
      let name = '';
      if (el instanceof HTMLSelectElement) {
        name = (el.options[0]?.textContent ?? '').trim();
      }
      name =
        name ||
        el.getAttribute('title') ||
        el.getAttribute('placeholder') ||
        '';
      if (name) el.setAttribute('aria-label', name.trim());
    });
}

export function enableFormLabelling(root: HTMLElement | null): () => void {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      labelFormControls(root);
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  schedule();
  return () => observer.disconnect();
}
