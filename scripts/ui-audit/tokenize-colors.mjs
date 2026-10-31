// Codemod (idempotent): thay màu hex cứng trong style inline bằng biến theme-aware.
// Chỉ đổi literal '#RRGGBB' có thuộc tính gần nhất là color / backgroundColor|background / border*.
// Dùng: node scripts/ui-audit/tokenize-colors.mjs <file...>
import { readFileSync, writeFileSync } from 'node:fs';

const TEXT = {
  '#94A3B8': 'var(--muted-color)', '#64748B': 'var(--muted-color)',
  '#F8FAFC': 'var(--text-color)', '#F1F5F9': 'var(--text-color)', '#E2E8F0': 'var(--text-color)',
  '#CBD5E1': 'var(--text-secondary)',
  '#14B8A6': 'var(--accent-text)', '#2DD4BF': 'var(--accent-text)',
  '#38BDF8': 'var(--info-text)', '#7DD3FC': 'var(--info-text)',
  '#10B981': 'var(--success-text)', '#34D399': 'var(--success-text)', '#6EE7B7': 'var(--success-text)',
  '#EF4444': 'var(--danger-text)', '#F87171': 'var(--danger-text)', '#FCA5A5': 'var(--danger-text)',
  '#F59E0B': 'var(--warning-text)', '#FBBF24': 'var(--warning-text)', '#FCD34D': 'var(--warning-text)',
};
const BG = {
  '#0F172A': 'var(--surface-subtle)', '#0B1220': 'var(--bg-color)',
  '#1E293B': 'var(--surface-hover)', '#151F30': 'var(--surface-color)',
  '#14B8A6': 'var(--primary-color)',
};
const BORDER = {
  '#334155': 'var(--border-color)', '#1E293B': 'var(--border-subtle)',
  '#475569': 'var(--border-hover)',
};
// Nền "đặc" mà chữ sáng phải giữ nguyên (nút đỏ/xanh...).
const SOLID_BG = /backgroundColor:\s*'#(DC2626|EF4444|B91C1C|059669|10B981|0D9488|14B8A6|2563EB|7C3AED)'/i;

let total = 0;
for (const file of process.argv.slice(2)) {
  let t = readFileSync(file, 'utf8');
  let n = 0;
  t = t.replace(/'(#[0-9a-fA-F]{6})'/g, (m, hex, offset, str) => {
    const H = hex.toUpperCase();
    const back = str.slice(Math.max(0, offset - 400), offset);
    const props = [...back.matchAll(/\b([A-Za-z]+):\s/g)];
    const prop = props.length ? props[props.length - 1][1] : '';
    let rep;
    if (prop === 'color') {
      if (H === '#F8FAFC' || H === '#F1F5F9' || H === '#E2E8F0') {
        const near = str.slice(Math.max(0, offset - 500), offset + 500);
        if (SOLID_BG.test(near)) return m;
      }
      rep = TEXT[H];
    } else if (prop === 'backgroundColor' || prop === 'background') rep = BG[H];
    else if (/^border[A-Za-z]*Color$/.test(prop)) rep = BORDER[H];
    if (!rep) return m;
    n++;
    return `'${rep}'`;
  });
  // chuỗi viền: '1px solid #334155'
  t = t.replace(/(\d+px (?:solid|dashed) )(#334155|#1E293B|#475569)\b/gi, (m, pre, hex) => {
    n++;
    return pre + BORDER[hex.toUpperCase()];
  });
  if (n) writeFileSync(file, t);
  console.log(`${file}: ${n}`);
  total += n;
}
console.log('total', total);
