import { AuthError } from '../auth/service.js';

/**
 * Validates and normalizes an optional date_of_birth value into ISO YYYY-MM-DD.
 * Accepts either YYYY-MM-DD or DD/MM/YYYY. Rejects impossible calendar dates.
 */
export function normalizeDateOfBirth(
  raw: string | null | undefined,
): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  let year: number;
  let month: number;
  let day: number;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const vnMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else if (vnMatch) {
    day = Number(vnMatch[1]);
    month = Number(vnMatch[2]);
    year = Number(vnMatch[3]);
  } else {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Ngày sinh không hợp lệ (định dạng chuẩn YYYY-MM-DD hoặc DD/MM/YYYY)',
      400,
      [{ field: 'date_of_birth', message: 'Ngày sinh không đúng định dạng' }],
    );
  }

  const currentYear = new Date().getUTCFullYear();
  if (year < 1920 || year > currentYear || month < 1 || month > 12 || day < 1) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Ngày sinh nằm ngoài phạm vi hợp lệ',
      400,
      [{ field: 'date_of_birth', message: 'Ngày sinh không hợp lệ' }],
    );
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Ngày ${day}/${month}/${year} không tồn tại trên lịch`,
      400,
      [{ field: 'date_of_birth', message: 'Ngày sinh không tồn tại trên lịch' }],
    );
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Validates and normalizes an optional bank_account_number (digits only, 6..25 digits).
 */
export function normalizeBankAccountNumber(
  raw: string | null | undefined,
): string | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw)
    .trim()
    .replace(/[\s.-]+/g, '');
  if (!cleaned) return null;

  if (!/^\d{6,25}$/.test(cleaned)) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Số tài khoản ngân hàng chỉ được chứa chữ số (từ 6 đến 25 chữ số)',
      400,
      [
        {
          field: 'bank_account_number',
          message: 'Số tài khoản ngân hàng chỉ gồm 6–25 chữ số',
        },
      ],
    );
  }

  return cleaned;
}

/**
 * Task 19.1: Identifies whether a workspace record is a synthetic/test workspace
 * via explicit boolean flag (`is_test`) or known synthetic test prefixes.
 */
export function isTestWorkspaceRecord(workspace: {
  name?: string | null | undefined;
  is_test?: boolean | null | undefined;
}): boolean {
  if (workspace.is_test === true) return true;
  if (workspace.is_test === false) return false;
  const name = (workspace.name || '').trim();
  if (!name) return false;
  return /^(SYNTHETIC\b|TEST(?:WS)?[\s_-]|E2E[\s_-]|AUDIT[\s_-]|BACKUP[\s_-]RESTORE)/i.test(
    name,
  );
}
