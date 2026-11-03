import React, { useEffect, useRef } from 'react';
import type { PdfPreviewState } from './types.js';
import {
  PqDownloadIcon,
  PqPrinterIcon,
  PqShieldIcon,
} from './PrintQuoteIcons.js';

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
        backgroundColor: 'rgba(2, 6, 23, 0.8)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px',
        overscrollBehavior: 'contain',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '940px',
          maxHeight: 'calc(100dvh - 28px)',
          backgroundColor: 'var(--surface-color)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          boxShadow: '0 24px 60px rgba(2, 6, 23, 0.55)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <strong style={{ fontSize: '15px', fontWeight: 700 }}>
              {previewState.title}
            </strong>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '12px',
                color: 'var(--success-text)',
                fontWeight: 600,
              }}
            >
              <PqShieldIcon size={13} />
              <span>
                Bản gửi khách an toàn — Ẩn 100% giá gốc nhà in & lợi nhuận
              </span>
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="pq-modal-download-pdf-btn"
              className="pq-btn pq-btn-primary"
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
            >
              <PqDownloadIcon size={15} />
              <span>Tải PDF ({previewState.quoteCode}.pdf)</span>
            </button>
            <button
              type="button"
              className="pq-btn pq-btn-accent"
              onClick={() => onPrintWindow(previewState.html)}
            >
              <PqPrinterIcon size={15} />
              <span>In A4</span>
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              className="pq-btn pq-btn-secondary"
              onClick={onClose}
            >
              Đóng
            </button>
          </div>
        </div>

        <div
          style={{
            padding: '16px',
            backgroundColor: 'rgba(15, 23, 42, 0.35)',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          <iframe
            title="Xem trước PDF A4 Báo giá in ấn"
            srcDoc={previewState.html}
            style={{
              display: 'block',
              width: '100%',
              maxWidth: '820px',
              margin: '0 auto',
              height: '72vh',
              border: '1px solid rgba(148, 163, 184, 0.25)',
              borderRadius: '8px',
              backgroundColor: '#FFFFFF',
              boxShadow: '0 16px 40px rgba(2, 6, 23, 0.35)',
            }}
          />
        </div>
      </div>
    </div>
  );
};
