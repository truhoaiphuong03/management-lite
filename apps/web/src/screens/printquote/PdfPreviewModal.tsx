import React, { useEffect, useRef } from 'react';
import type { PdfPreviewState } from './types.js';

export interface PdfPreviewModalProps {
  previewState: PdfPreviewState | null;
  onClose: () => void;
  onDownloadSavedPdf: (quoteId: string, quoteCode: string) => void;
  onDownloadLivePdf: () => void;
  onPrintWindow: (html: string) => void;
}

export const PdfPreviewModal: React.FC<PdfPreviewModalProps> = ({
  previewState,
  onClose,
  onDownloadSavedPdf,
  onDownloadLivePdf,
  onPrintWindow,
}) => {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!previewState || typeof document === 'undefined') return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusTimer = setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        try {
          prev.focus();
        } catch {
          // Ignore focus restore error
        }
      }
    };
  }, [previewState]);

  if (!previewState) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={previewState.title}
      data-testid="pq-pdf-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        backgroundColor: 'rgba(2, 6, 23, 0.82)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '900px',
          maxHeight: 'calc(100dvh - 24px)',
          backgroundColor: 'var(--surface-color)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <strong style={{ fontSize: '14px' }}>
            {previewState.title} (Chỉ hiển thị giá bán — Ẩn 100% giá nhà in &
            lợi nhuận)
          </strong>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="pq-modal-download-pdf-btn"
              onClick={() => {
                if (previewState.quoteId) {
                  onDownloadSavedPdf(
                    previewState.quoteId,
                    previewState.quoteCode,
                  );
                } else {
                  onDownloadLivePdf();
                }
              }}
              style={{
                minHeight: '44px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--primary-color)',
                color: 'var(--inverse-text)',
                fontWeight: 700,
                fontSize: '12.5px',
                cursor: 'pointer',
              }}
            >
              ⬇️ Tải file .PDF ({previewState.quoteCode}.pdf)
            </button>
            <button
              type="button"
              onClick={() => onPrintWindow(previewState.html)}
              style={{
                minHeight: '44px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid var(--accent-text)',
                backgroundColor: 'var(--accent-soft)',
                color: 'var(--accent-text)',
                fontWeight: 700,
                fontSize: '12.5px',
                cursor: 'pointer',
              }}
            >
              🖨️ Mở cửa sổ In A4
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              style={{
                minHeight: '44px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'transparent',
                color: 'var(--text-color)',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Đóng
            </button>
          </div>
        </div>

        <iframe
          title="Xem trước PDF A4 Báo giá in ấn"
          srcDoc={previewState.html}
          style={{
            width: '100%',
            height: '75vh',
            border: 'none',
            backgroundColor: '#FFFFFF',
          }}
        />
      </div>
    </div>
  );
};
