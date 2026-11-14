import { resolveVietQrBankCode } from '../../../../../packages/contracts/src/vietqr.js';

export { resolveVietQrBankCode };

export function formatVnd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '0 đ';
  return new Intl.NumberFormat('vi-VN').format(amount) + ' đ';
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '0p';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}p`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}p`;
}

export function formatDateDisplay(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function getCurrentMonth(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function shiftMonth(monthStr: string, offset: number): string {
  const [yStr, mStr] = monthStr.split('-');
  let y = parseInt(yStr || '2026', 10);
  let m = parseInt(mStr || '10', 10) + offset;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}
