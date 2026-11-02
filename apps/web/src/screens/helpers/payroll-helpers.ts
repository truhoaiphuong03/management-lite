export function formatVnd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '0 đ';
  return new Intl.NumberFormat('vi-VN').format(amount) + ' đ';
}

export function resolveVietQrBankCode(
  bankName: string | null | undefined,
): string {
  const raw = (bankName || '').toLowerCase().trim();
  if (!raw) return 'VCB';
  if (raw.includes('vietcombank') || raw === 'vcb') return 'VCB';
  if (raw.includes('techcombank') || raw === 'tcb') return 'TCB';
  if (raw.includes('vietinbank') || raw === 'icb' || raw === 'ctg')
    return 'ICB';
  if (raw.includes('bidv')) return 'BIDV';
  if (raw.includes('agribank') || raw.includes(' nông nghiệp') || raw === 'vba')
    return 'VBA';
  if (raw.includes('mb') || raw.includes('quân đội')) return 'MB';
  if (raw.includes('acb') || raw.includes('á châu')) return 'ACB';
  if (raw.includes('vpbank') || raw === 'vpb') return 'VPB';
  if (raw.includes('tpbank') || raw === 'tpb') return 'TPB';
  if (raw.includes('sacombank') || raw === 'stb') return 'STB';
  if (raw.includes('hdbank') || raw === 'hdb') return 'HDB';
  if (raw.includes('vib')) return 'VIB';
  if (raw.includes('shb')) return 'SHB';
  if (raw.includes('msb') || raw.includes('hàng hải')) return 'MSB';
  if (raw.includes('ocb') || raw.includes('phương đông')) return 'OCB';
  if (raw.includes('seabank')) return 'SEAB';
  if (raw.includes('lpbank') || raw.includes('liên việt')) return 'LPB';
  if (raw.includes('eximbank') || raw === 'eib') return 'EIB';
  return raw.replace(/[^a-z0-9]/g, '').toUpperCase() || 'VCB';
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
