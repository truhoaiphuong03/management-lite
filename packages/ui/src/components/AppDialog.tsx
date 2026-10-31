import React, { useEffect, useRef, useCallback, useId } from 'react';
import { TOKENS, THEME_COLORS } from '../tokens.js';
import { AppButton } from './AppButton.js';
import { CloseIcon } from './Icons.js';

export interface AppDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  confirmVariant?: 'primary' | 'destructive';
  isLoading?: boolean;
  maxWidth?: string;
  children?: React.ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(', ');

function isElementVisible(el: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  if (el.hasAttribute('hidden')) return false;
  if (el.style.display === 'none' || el.style.visibility === 'hidden')
    return false;
  if (
    typeof window !== 'undefined' &&
    typeof window.getComputedStyle === 'function'
  ) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  return candidates.filter(isElementVisible);
}

export const AppDialog: React.FC<AppDialogProps> = ({
  isOpen,
  onClose,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Hủy',
  onConfirm,
  confirmVariant = 'primary',
  isLoading = false,
  maxWidth = '500px',
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const reactId = useId();

  // Latest props live in refs so the focus-trap effect below does not re-run (and re-steal focus
  // to the first control) every time a parent re-renders, e.g. on each keystroke in a form.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const handleClose = useCallback(() => {
    if (isLoadingRef.current) return;
    onCloseRef.current();
  }, []);

  // Accessibility: Focus trap, Escape key, and body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElement.current =
      document.activeElement as HTMLElement | null;

    const timer = setTimeout(() => {
      if (dialogRef.current) {
        const focusable = getFocusableElements(dialogRef.current);
        if (focusable.length > 0) {
          focusable[0]?.focus();
        } else {
          dialogRef.current.focus();
        }
      }
    }, 30);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }

      if (e.key === 'Tab') {
        if (!dialogRef.current) return;
        const focusable = getFocusableElements(dialogRef.current);

        // If no focusable elements inside dialog (e.g. isLoading=true with disabled buttons)
        if (focusable.length === 0) {
          e.preventDefault();
          if (document.activeElement !== dialogRef.current) {
            dialogRef.current.focus();
          }
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        // Handle focus initially outside or escaped outside dialog
        if (!dialogRef.current.contains(document.activeElement)) {
          e.preventDefault();
          if (e.shiftKey) {
            last?.focus();
          } else {
            first?.focus();
          }
          return;
        }

        if (e.shiftKey) {
          if (
            document.activeElement === first ||
            document.activeElement === dialogRef.current
          ) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (
            document.activeElement === last ||
            document.activeElement === dialogRef.current
          ) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const titleId = `dialog-title-${reactId}`;
  const descId = description ? `dialog-desc-${reactId}` : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: THEME_COLORS.overlay, // rgba(11, 18, 32, 0.85)
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        zIndex: 1000,
        boxSizing: 'border-box',
        overscrollBehavior: 'contain',
        animation: 'fadeIn 0.15s ease',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          outline: 'none',
          backgroundColor: THEME_COLORS.surface, // #151F30
          border: `1px solid ${THEME_COLORS.border}`,
          borderRadius: TOKENS.radii.lg, // 16px
          boxShadow: TOKENS.shadows.xl,
          maxWidth,
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: `1px solid ${THEME_COLORS.borderSubtle}`,
          }}
        >
          <h3
            id={titleId}
            style={{
              fontSize: TOKENS.typography.fontSize.lg,
              fontWeight: TOKENS.typography.fontWeight.bold,
              color: THEME_COLORS.text,
              margin: 0,
              lineHeight: TOKENS.typography.lineHeight.tight,
            }}
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            disabled={isLoading}
            aria-label="Đóng hộp thoại"
            style={{
              background: 'transparent',
              border: 'none',
              color: THEME_COLORS.muted,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: TOKENS.touchTarget.minWidth,
              minHeight: TOKENS.touchTarget.minHeight,
              width: '44px',
              height: '44px',
              padding: 0,
              borderRadius: TOKENS.radii.xs,
              transition: 'color 0.15s ease, background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = THEME_COLORS.text;
              e.currentTarget.style.backgroundColor =
                'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = THEME_COLORS.muted;
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '20px 24px',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            flex: 1,
            color: THEME_COLORS.textSecondary,
            fontSize: TOKENS.typography.fontSize.md,
            lineHeight: TOKENS.typography.lineHeight.relaxed,
          }}
        >
          {description && (
            <p
              id={descId}
              style={{
                marginTop: 0,
                marginBottom: children ? '16px' : 0,
                color: THEME_COLORS.muted,
                fontSize: TOKENS.typography.fontSize.md,
              }}
            >
              {description}
            </p>
          )}
          {children}
        </div>

        {/* Footer Actions */}
        {(onConfirm || cancelLabel) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '12px',
              padding: '16px 24px',
              borderTop: `1px solid ${THEME_COLORS.borderSubtle}`,
              backgroundColor: THEME_COLORS.surfaceSubtle,
            }}
          >
            {cancelLabel && (
              <AppButton
                variant="quiet"
                onClick={handleClose}
                disabled={isLoading}
              >
                {cancelLabel}
              </AppButton>
            )}
            {onConfirm && confirmLabel && (
              <AppButton
                variant={confirmVariant}
                onClick={onConfirm}
                isLoading={isLoading}
              >
                {confirmLabel}
              </AppButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
