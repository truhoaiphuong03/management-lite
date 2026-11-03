import React, { useEffect, useId, useRef } from 'react';

export interface CatalogModalDialogProps {
  open: boolean;
  title: string;
  subtitle?: string | undefined;
  testId?: string | undefined;
  maxWidth?: string | undefined;
  onClose: () => void;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const CatalogModalDialog: React.FC<CatalogModalDialogProps> = ({
  open,
  title,
  subtitle,
  testId,
  maxWidth = '540px',
  onClose,
  children,
}) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const container = dialogRef.current;
    const focusTimer = setTimeout(() => {
      if (!container) return;
      const preferred = container.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])',
      );
      if (preferred) {
        preferred.focus();
        return;
      }
      const firstFocusable =
        container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      firstFocusable?.focus();
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && container) {
        const nodes = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (!first || !last) return;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (!active || active === first || !container.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last) {
          e.preventDefault();
          first.focus();
        }
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
          // Ignore focus restoration error
        }
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1150,
        backgroundColor: 'rgba(2, 6, 23, 0.78)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
        overflowY: 'auto',
        boxSizing: 'border-box',
      }}
    >
      <div
        ref={dialogRef}
        style={{
          width: '100%',
          maxWidth,
          maxHeight: 'calc(100dvh - 24px)',
          overflowY: 'auto',
          margin: 'auto',
          backgroundColor: 'var(--surface-color)',
          border: '1px solid var(--border-color)',
          borderRadius: '14px',
          padding: '18px',
          color: 'var(--text-color)',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.55)',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '10px',
            marginBottom: '12px',
          }}
        >
          <div>
            <h3
              id={titleId}
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: 700,
                color: 'var(--text-color)',
              }}
            >
              {title}
            </h3>
            {subtitle && (
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: '12.5px',
                  color: 'var(--muted-color)',
                  lineHeight: 1.45,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            data-dialog-close="true"
            aria-label="Đóng hộp thoại"
            onClick={onClose}
            style={{
              minWidth: '44px',
              minHeight: '44px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'transparent',
              color: 'var(--muted-color)',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '14px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {children}
      </div>
    </div>
  );
};
