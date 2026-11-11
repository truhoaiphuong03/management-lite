import React, { useState } from 'react';
import { AppButton } from '../../../../packages/ui/src/components/index.js';
import type { ExportExcelToDriveResponseData } from '../../../../packages/contracts/src/index.js';

export interface ExportDriveExcelButtonProps {
  label?: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'destructive' | 'quiet';
  testId?: string;
  onSuccess?: (data: ExportExcelToDriveResponseData) => void;
  onError?: (message: string) => void;
}

async function resolveCsrfToken(): Promise<string> {
  try {
    const meRes = await fetch('/api/v1/auth/me', { credentials: 'include' });
    if (meRes.ok) {
      const meBody = await meRes.json();
      const tok = meBody?.data?.csrf_token || '';
      if (tok) return tok;
    }
  } catch {
    // fallback to cookie
  }
  if (typeof document !== 'undefined') {
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return '';
}

export const ExportDriveExcelButton: React.FC<ExportDriveExcelButtonProps> = ({
  label = 'Xuất Excel (Drive riêng tư)',
  size = 'sm',
  variant = 'secondary',
  testId = 'btn-export-excel-drive',
  onSuccess,
  onError,
}) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExportExcelToDriveResponseData | null>(
    null,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleExport = async () => {
    if (loading) return;
    setLoading(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const csrf = await resolveCsrfToken();
      const res = await fetch('/api/v1/storage/drive/export-excel', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify({}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          payload?.error?.message ||
          payload?.message ||
          `Không thể xuất Excel lên Google Drive (HTTP ${res.status}).`;
        setErrorMsg(msg);
        onError?.(msg);
        return;
      }
      const data = payload?.data as ExportExcelToDriveResponseData;
      setResult(data);
      onSuccess?.(data);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Lỗi kết nối khi xuất Excel lên Google Drive.';
      setErrorMsg(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '6px' }}>
      <AppButton
        variant={variant}
        size={size}
        disabled={loading}
        onClick={handleExport}
        data-testid={testId}
        title="Xuất 4 sheet (Nhân viên, Chấm công, Lương, Thu chi) vào thư mục Google Drive riêng tư (không chia sẻ công khai)"
      >
        {loading ? '⏳ Đang lưu lên Drive…' : `📊 ${label}`}
      </AppButton>

      {result && (
        <div
          role="status"
          data-testid={`${testId}-success`}
          style={{
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: '#ECFDF5',
            border: '1px solid #A7F3D0',
            color: '#065F46',
            fontSize: '12px',
            lineHeight: 1.45,
            maxWidth: '420px',
          }}
        >
          <div
            style={{
              fontWeight: 700,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>✅ Đã lưu Excel vào Google Drive riêng tư</span>
            <button
              type="button"
              onClick={() => setResult(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#047857',
                cursor: 'pointer',
                fontWeight: 700,
                padding: '0 4px',
              }}
              aria-label="Đóng thông báo"
            >
              ×
            </button>
          </div>
          <div style={{ marginTop: '4px' }}>
            Tệp: <strong>{result.file_name}</strong> • Thư mục:{' '}
            <strong>{result.folder_name}</strong> (🔒 Riêng tư, không chia sẻ
            công khai)
          </div>
          <div style={{ marginTop: '2px', color: '#047857' }}>
            4 Sheet: Nhân viên ({result.sheets.employees}) • Chấm công (
            {result.sheets.attendance}) • Lương ({result.sheets.payroll}) • Thu
            chi ({result.sheets.finance})
          </div>
          <div
            style={{
              marginTop: '6px',
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <a
              href={result.drive_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#047857',
                fontWeight: 700,
                textDecoration: 'underline',
              }}
            >
              Mở file trên Google Drive ↗
            </a>
            <a
              href={result.folder_drive_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#047857',
                fontWeight: 600,
                textDecoration: 'underline',
              }}
            >
              Mở thư mục riêng tư ↗
            </a>
          </div>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          data-testid={`${testId}-error`}
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#991B1B',
            fontSize: '12px',
            lineHeight: 1.4,
            maxWidth: '420px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '8px',
          }}
        >
          <span>⚠️ {errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#991B1B',
              cursor: 'pointer',
              fontWeight: 700,
              padding: '0 4px',
            }}
            aria-label="Đóng cảnh báo"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};
