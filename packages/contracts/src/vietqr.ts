export interface OwnerPaymentBankInfo {
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder?: string | null | undefined;
}

export interface VietQrUrlParams extends OwnerPaymentBankInfo {
  amountVnd?: number | null | undefined;
  addInfo?: string | null | undefined;
  template?: 'compact2' | 'compact' | 'qr_only' | undefined;
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
  if (raw.includes('agribank') || raw.includes('nông nghiệp') || raw === 'vba')
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

export function normalizeVietQrAccountDigits(
  accountNumber: string | null | undefined,
): string {
  const cleaned = (accountNumber || '').replace(/[\s.-]+/g, '').trim();
  if (!/^[A-Za-z0-9]{6,25}$/.test(cleaned)) return '';
  return cleaned;
}

export function buildVietQrImageUrl(params: VietQrUrlParams): string | null {
  const accNo = normalizeVietQrAccountDigits(params.bankAccountNumber);
  if (!accNo || !params.bankName?.trim()) return null;

  const bankCode = resolveVietQrBankCode(params.bankName);
  const tpl = params.template || 'compact2';
  const search = new URLSearchParams();
  const amount = Math.max(0, Math.round(Number(params.amountVnd) || 0));
  if (amount > 0) {
    search.set('amount', String(amount));
  }
  if (params.addInfo && params.addInfo.trim()) {
    search.set('addInfo', params.addInfo.trim().slice(0, 60));
  }
  if (params.bankAccountHolder && params.bankAccountHolder.trim()) {
    search.set('accountName', params.bankAccountHolder.trim().slice(0, 60));
  }
  const qs = search.toString();
  return `https://img.vietqr.io/image/${encodeURIComponent(bankCode)}-${encodeURIComponent(accNo)}-${tpl}.png${qs ? `?${qs}` : ''}`;
}
